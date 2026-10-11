/**
 * TmsProjectService - streams the TMS ("tree of causes") state of a project's checkout.
 *
 * The tms CLI stays the authority: the service runs `tms change show --json` in the checkout and
 * reshapes its output. It polls a cheap version key built from file stats (the `.tms` tree, HEAD,
 * the selected change and its acceptances) and runs the CLI only when the key moves; a run whose
 * result equals the last one publishes nothing.
 *
 * @module TmsProjectService
 */
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import {
  TmsDecision,
  TmsProjectLookupError,
  TmsQuiverEdge,
  TmsQuiverNode,
  type TmsProjectState,
  type TmsProjectSubscriptionInput,
} from "@t3tools/contracts";

import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as ProcessRunner from "../processRunner.ts";

const POLL_INTERVAL = Duration.seconds(1);
const CLI_TIMEOUT = Duration.seconds(60);
const CLI_MAX_OUTPUT_BYTES = 64 * 1024 * 1024;
const MAX_MESSAGE_LENGTH = 4_000;
const LAUNCHERS = ["bin/tms", ".claude/bin/tms"] as const;

/** What `tms change show --json` prints. */
const decodeChangeShow = Schema.decodeUnknownEffect(
  Schema.fromJsonString(
    Schema.Struct({
      nodes: Schema.Array(TmsQuiverNode),
      edges: Schema.Array(TmsQuiverEdge),
      decisions: Schema.Array(TmsDecision),
    }),
  ),
);

/** When the checkout is probed for changes; tests drive it by hand. */
export class TmsPollTicks extends Context.Reference<Stream.Stream<void>>(
  "t3/tms/TmsProjectService/TmsPollTicks",
  { defaultValue: () => Stream.tick(POLL_INTERVAL) },
) {}

export class TmsProjectService extends Context.Service<
  TmsProjectService,
  {
    /**
     * The checkout's TMS state now and whenever it changes. Equal states are not repeated.
     * Fails only when the project (or its lookup) is gone; CLI trouble is a `failed` state.
     */
    readonly streamProject: (
      input: TmsProjectSubscriptionInput,
    ) => Stream.Stream<TmsProjectState, TmsProjectLookupError>;
  }
>()("t3/tms/TmsProjectService") {}

interface Probe {
  readonly root: string;
  readonly key: string;
  readonly isTmsProject: boolean;
  readonly change: string | null;
  readonly launcher: string | null;
}

interface Published {
  readonly state: TmsProjectState;
  readonly fingerprint: string;
}

const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const runner = yield* ProcessRunner.ProcessRunner;
  const projects = yield* ProjectService.ProjectService;
  const threads = yield* ThreadManagementService.ThreadManagementService;
  const ticks = yield* TmsPollTicks;

  const statKey = (file: string) =>
    fs.stat(file).pipe(
      Effect.map((info) => `${info.size}:${Option.getOrElse(info.mtime, () => 0).valueOf()}`),
      Effect.orElseSucceed(() => "-"),
    );
  const readText = (file: string) => fs.readFileString(file).pipe(Effect.orElseSucceed(() => ""));
  const exists = (file: string) => fs.exists(file).pipe(Effect.orElseSucceed(() => false));

  const resolveRoot = Effect.fn("TmsProjectService.resolveRoot")(function* (
    input: TmsProjectSubscriptionInput,
  ) {
    const lookupFailed = (cause: unknown) =>
      new TmsProjectLookupError({ projectId: input.projectId, reason: "lookup-failed", cause });
    const project = yield* projects.getById(input.projectId).pipe(Effect.mapError(lookupFailed));
    if (Option.isNone(project)) {
      return yield* new TmsProjectLookupError({
        projectId: input.projectId,
        reason: "project-not-found",
      });
    }
    if (input.threadId === undefined) return project.value.workspaceRoot;
    const thread = yield* threads
      .getThreadShell(input.threadId)
      .pipe(Effect.mapError(lookupFailed));
    return thread?.projectId === input.projectId && thread.worktreePath
      ? thread.worktreePath
      : project.value.workspaceRoot;
  });

  /** The checkout's git dir (per worktree) and common dir (shared), read without spawning git. */
  const gitDirsOf = Effect.fn("TmsProjectService.gitDirsOf")(function* (root: string) {
    const dotGit = path.join(root, ".git");
    const info = yield* fs.stat(dotGit).pipe(Effect.option);
    if (Option.isNone(info)) return null;
    let gitDir = dotGit;
    if (info.value.type !== "Directory") {
      const pointer = /^gitdir:\s*(.+)$/m.exec(yield* readText(dotGit))?.[1]?.trim();
      if (!pointer) return null;
      gitDir = path.resolve(root, pointer);
    }
    const common = (yield* readText(path.join(gitDir, "commondir"))).trim();
    return { gitDir, commonDir: common ? path.resolve(gitDir, common) : gitDir };
  });

  /** The change this checkout selected, or its only open change. */
  const selectedChange = Effect.fn("TmsProjectService.selectedChange")(function* (
    root: string,
    gitDir: string | null,
  ) {
    const changesDir = path.join(root, ".tms", "changes");
    const names = yield* fs.readDirectory(changesDir).pipe(Effect.orElseSucceed(() => []));
    const open = yield* Effect.filter(
      names.filter((name) => name !== "archive").toSorted(),
      (name) => exists(path.join(changesDir, name, "change.yaml")),
    );
    const chosen =
      gitDir === null ? "" : (yield* readText(path.join(gitDir, "tms-active-change"))).trim();
    return open.includes(chosen) ? chosen : open.length === 1 ? (open[0] ?? null) : null;
  });

  const probe = Effect.fn("TmsProjectService.probe")(function* (root: string) {
    const tmsYaml = path.join(root, ".tms", "tms.yaml");
    const isTmsProject = yield* exists(tmsYaml);
    if (!isTmsProject) {
      return { root, key: "not-tms", isTmsProject, change: null, launcher: null } satisfies Probe;
    }
    const dirs = yield* gitDirsOf(root);
    const change = yield* selectedChange(root, dirs?.gitDir ?? null);
    const head = dirs === null ? "" : (yield* readText(path.join(dirs.gitDir, "HEAD"))).trim();
    const headRef = head.startsWith("ref: ") ? head.slice(5).trim() : null;
    const specsDir = path.join(root, ".tms", "specs");
    const specs = yield* fs.readDirectory(specsDir).pipe(Effect.orElseSucceed(() => []));
    const launchers = LAUNCHERS.map((launcher) => path.join(root, launcher));
    const launcherStats = yield* Effect.forEach(launchers, statKey);
    const parts = yield* Effect.all([
      statKey(tmsYaml),
      statKey(path.join(root, ".tms", "changes")),
      change === null
        ? Effect.succeed("")
        : statKey(path.join(root, ".tms", "changes", change, "change.yaml")),
      dirs === null || change === null
        ? Effect.succeed("")
        : statKey(path.join(dirs.commonDir, "tms", "acceptances", change)),
      dirs === null || headRef === null
        ? Effect.succeed("")
        : statKey(path.join(dirs.commonDir, headRef)),
      dirs === null ? Effect.succeed("") : statKey(path.join(dirs.commonDir, "packed-refs")),
      Effect.forEach(specs.toSorted(), (spec) => statKey(path.join(specsDir, spec, "log"))).pipe(
        Effect.map((stats) => stats.join(",")),
      ),
    ]);
    const launcherIndex = launcherStats.findIndex((stat) => stat !== "-");
    return {
      root,
      key: [change ?? "", head, ...launcherStats, ...parts].join("|"),
      isTmsProject,
      change,
      launcher: launcherIndex === -1 ? null : (launchers[launcherIndex] ?? null),
    } satisfies Probe;
  });

  const failed = (root: string, message: string): Published => {
    const bounded =
      message.length > MAX_MESSAGE_LENGTH ? message.slice(-MAX_MESSAGE_LENGTH) : message;
    return {
      state: { _tag: "failed", root, message: bounded },
      fingerprint: ["failed", root, bounded].join("\0"),
    };
  };

  const load = Effect.fn("TmsProjectService.load")(function* (current: Probe) {
    const { root } = current;
    if (!current.isTmsProject) {
      return {
        state: { _tag: "notTmsProject", root },
        fingerprint: ["notTmsProject", root].join("\0"),
      } satisfies Published;
    }
    if (current.launcher === null) {
      return failed(root, `No tms launcher found at ${LAUNCHERS.join(" or ")}.`);
    }
    const entry =
      current.change === null
        ? null
        : (/^entry: (\S+)/m.exec(
            yield* readText(path.join(root, ".tms", "changes", current.change, "change.yaml")),
          )?.[1] ?? null);
    const run = yield* runner
      .run({
        command: current.launcher,
        args: ["change", "show", "--json"],
        cwd: root,
        timeout: CLI_TIMEOUT,
        maxOutputBytes: CLI_MAX_OUTPUT_BYTES,
      })
      .pipe(Effect.result);
    if (run._tag === "Failure") {
      return failed(root, `Could not run tms: ${run.failure.message}`);
    }
    const output = run.success;
    if (output.code !== 0) {
      return failed(root, output.stderr.trim() || `tms exited with code ${String(output.code)}.`);
    }
    const shown = yield* decodeChangeShow(output.stdout).pipe(Effect.option);
    if (Option.isNone(shown)) {
      return failed(root, "tms printed output this version of T3 Code cannot read.");
    }
    const { decisions, nodes, edges } = shown.value;
    const state: TmsProjectState = {
      _tag: "snapshot",
      tree: {
        nodes: decisions.filter((decision) => decision.ended === null),
        ended: decisions.filter((decision) => decision.ended !== null),
        quiver: { nodes, edges },
      },
      live: { change: current.change, entry, root },
    };
    return {
      state,
      fingerprint: ["snapshot", root, current.change ?? "", entry ?? "", output.stdout].join("\0"),
    } satisfies Published;
  });

  const streamProject: TmsProjectService["Service"]["streamProject"] = (input) =>
    ticks.pipe(
      Stream.mapEffect(() => resolveRoot(input).pipe(Effect.flatMap(probe))),
      Stream.changesWith((left, right) => left.root === right.root && left.key === right.key),
      Stream.mapEffect(load),
      Stream.changesWith((left, right) => left.fingerprint === right.fingerprint),
      Stream.map((published) => published.state),
    );

  return TmsProjectService.of({ streamProject });
});

export const layer = Layer.effect(TmsProjectService, make);
