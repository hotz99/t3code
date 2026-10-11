import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import { ProjectId, ThreadId, type TmsProjectState } from "@t3tools/contracts";

import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as ProcessRunner from "../processRunner.ts";
import * as TmsProjectService from "./TmsProjectService.ts";

const projectId = ProjectId.make("project-1");
const threadId = ThreadId.make("thread-1");

const decision = (fields: {
  readonly id: string;
  readonly level: string;
  readonly cause?: string | null;
  readonly ended?: { readonly by: string | null; readonly reason: string } | null;
}) => ({
  id: fields.id,
  level: fields.level,
  wording: `${fields.id} wording`,
  kind: fields.level === "concept" ? "thing" : null,
  cause: fields.cause ?? null,
  uses: [],
  stands: fields.ended == null,
  accepted: true,
  code: fields.level === "law" ? ["src/a.ts#f"] : [],
  reworded: [],
  ended: fields.ended ?? null,
});

const VOCABULARY = {
  levels: [
    { level: "goal", letter: "G", accepted: true },
    { level: "requirement", letter: "R", accepted: true },
    { level: "concept", letter: "C", accepted: false },
    { level: "law", letter: "L", accepted: false },
  ],
  kinds: ["thing", "relationship", "property"],
};

const showOutput = (
  extra: ReadonlyArray<ReturnType<typeof decision>> = [],
  header: { readonly format: number; readonly vocabulary: unknown } = {
    format: 1,
    vocabulary: VOCABULARY,
  },
) =>
  JSON.stringify({
    ...header,
    nodes: [{ id: "tms:C1", label: "Decision", kind: "thing", of: null, stands: true }],
    edges: [{ id: "tms:C2", from: "tms:C1", to: "tms:C1", label: "Uses", functional: false }],
    decisions: [
      decision({ id: "tms:G1", level: "goal" }),
      decision({ id: "tms:R1", level: "requirement", cause: "tms:G1" }),
      decision({ id: "tms:C1", level: "concept", cause: "tms:R1" }),
      decision({ id: "tms:L1", level: "law", cause: "tms:C1" }),
      decision({
        id: "tms:R0",
        level: "requirement",
        cause: "tms:G1",
        ended: { by: "tms:R1", reason: "restated" },
      }),
      decision({ id: "tms:L0", level: "law", ended: { by: null, reason: "obsolete" } }),
      ...extra,
    ],
  });

interface RunnerScript {
  readonly output: Ref.Ref<
    | { readonly code: number; readonly stdout: string; readonly stderr: string }
    | { readonly spawnFails: true }
  >;
  readonly calls: Queue.Queue<ProcessRunner.ProcessRunInput>;
}

const makeRunner = (stdout: string) =>
  Effect.gen(function* () {
    const script: RunnerScript = {
      output: yield* Ref.make<
        | { readonly code: number; readonly stdout: string; readonly stderr: string }
        | { readonly spawnFails: true }
      >({ code: 0, stdout, stderr: "" }),
      calls: yield* Queue.unbounded<ProcessRunner.ProcessRunInput>(),
    };
    return script;
  });

const runnerLayer = (script: RunnerScript) =>
  Layer.succeed(ProcessRunner.ProcessRunner, {
    run: (input) =>
      Effect.gen(function* () {
        const output = yield* Ref.get(script.output);
        yield* Queue.offer(script.calls, input);
        if ("spawnFails" in output) {
          return yield* new ProcessRunner.ProcessSpawnError({
            command: input.command,
            argumentCount: input.args.length,
            cause: new Error("ENOENT"),
          });
        }
        return {
          stdout: output.stdout,
          stderr: output.stderr,
          code: ChildProcessSpawner.ExitCode(output.code),
          timedOut: false,
          stdoutTruncated: false,
          stderrTruncated: false,
          stdoutInvalidUtf8: false,
          stderrInvalidUtf8: false,
        };
      }),
  });

const serviceLayer = (input: {
  readonly script: RunnerScript;
  readonly workspaceRoot: string;
  readonly thread?: { readonly projectId: ProjectId; readonly worktreePath: string | null };
  readonly ticks?: Queue.Queue<void>;
}) =>
  TmsProjectService.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        runnerLayer(input.script),
        Layer.mock(ProjectService.ProjectService)({
          getById: (id) =>
            Effect.succeed(
              id === projectId
                ? Option.some({ id, workspaceRoot: input.workspaceRoot } as never)
                : Option.none(),
            ),
        }),
        Layer.mock(ThreadManagementService.ThreadManagementService)({
          getThreadShell: () => Effect.succeed((input.thread ?? null) as never),
        }),
        Layer.succeed(
          TmsProjectService.TmsPollTicks,
          input.ticks ? Stream.fromQueue(input.ticks) : Stream.make(undefined),
        ),
      ),
    ),
  );

/** A checkout with a tms project, its launcher, and one selected change entering at `entry`. */
const makeTmsCheckout = (entry: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3code-tms-" });
    const write = (relative: string, contents: string) =>
      Effect.gen(function* () {
        const file = path.join(root, relative);
        yield* fs.makeDirectory(path.dirname(file), { recursive: true });
        yield* fs.writeFileString(file, contents);
      });
    yield* write(".tms/tms.yaml", "version: 1\n");
    yield* write("bin/tms", "#!/bin/sh\n");
    yield* write(".tms/changes/archive/old/change.yaml", "entry: tms:G1\n");
    yield* write(".tms/changes/other/change.yaml", "entry: tms:G1\n");
    yield* write(".tms/changes/feature/change.yaml", `name: feature\nentry: ${entry}\n`);
    yield* write(".git/HEAD", "ref: refs/heads/main\n");
    yield* write(".git/tms-active-change", "feature\n");
    return { root, write };
  });

const firstState = (input: Parameters<typeof serviceLayer>[0]) =>
  Effect.gen(function* () {
    const service = yield* TmsProjectService.TmsProjectService;
    const states = yield* service.streamProject({ projectId }).pipe(Stream.runCollect);
    return states;
  }).pipe(Effect.provide(serviceLayer(input)));

const asSnapshot = (state: TmsProjectState | undefined) => {
  if (state?._tag !== "snapshot") throw new Error(`expected a snapshot, got ${state?._tag}`);
  return state;
};

it.layer(NodeServices.layer)("TmsProjectService", (it) => {
  describe("streamProject", () => {
    it.effect("splits the CLI's decisions into standing and ended, with the selected change", () =>
      Effect.gen(function* () {
        const { root } = yield* makeTmsCheckout("tms:R1");
        const script = yield* makeRunner(showOutput());

        const states = yield* firstState({ script, workspaceRoot: root });

        const snapshot = asSnapshot(states[0]);
        expect(states).toHaveLength(1);
        expect(snapshot.tree.nodes.map((node) => node.id)).toEqual([
          "tms:G1",
          "tms:R1",
          "tms:C1",
          "tms:L1",
        ]);
        expect(snapshot.tree.ended.map((node) => [node.id, node.ended])).toEqual([
          ["tms:R0", { by: "tms:R1", reason: "restated" }],
          ["tms:L0", { by: null, reason: "obsolete" }],
        ]);
        expect(snapshot.tree.quiver.nodes.map((node) => node.id)).toEqual(["tms:C1"]);
        expect(snapshot.tree.quiver.edges.map((edge) => edge.label)).toEqual(["Uses"]);
        expect(snapshot.live).toEqual({ change: "feature", entry: "tms:R1", root });
        const call = yield* Queue.take(script.calls);
        expect(call.args).toEqual(["change", "show", "--json"]);
        expect(call.cwd).toBe(root);
        expect(call.command.endsWith("/bin/tms")).toBe(true);
      }),
    );

    it.effect("reads the thread's worktree when the thread belongs to the project", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const projectRoot = yield* fs.makeTempDirectoryScoped({ prefix: "t3code-plain-" });
        const { root: worktree } = yield* makeTmsCheckout("tms:R1");
        const script = yield* makeRunner(showOutput());
        const service = TmsProjectService.TmsProjectService;
        const read = (thread: { projectId: ProjectId; worktreePath: string | null }) =>
          service
            .use((tms) => tms.streamProject({ projectId, threadId }).pipe(Stream.runCollect))
            .pipe(Effect.provide(serviceLayer({ script, workspaceRoot: projectRoot, thread })));

        const own = yield* read({ projectId, worktreePath: worktree });
        const foreign = yield* read({
          projectId: ProjectId.make("project-2"),
          worktreePath: worktree,
        });

        expect(asSnapshot(own[0]).live.root).toBe(worktree);
        expect(foreign).toEqual([{ _tag: "notTmsProject", root: projectRoot }]);
      }),
    );

    it.effect("reports a checkout without .tms/tms.yaml as not a tms project", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3code-plain-" });
        const script = yield* makeRunner(showOutput());

        const states = yield* firstState({ script, workspaceRoot: root });

        expect(states).toEqual([{ _tag: "notTmsProject", root }]);
        expect(yield* Queue.size(script.calls)).toBe(0);
      }),
    );

    it.effect("turns a failing, missing or unreadable CLI into a failed state", () =>
      Effect.gen(function* () {
        const { root } = yield* makeTmsCheckout("tms:R1");
        const script = yield* makeRunner(showOutput());

        yield* Ref.set(script.output, { code: 2, stdout: "", stderr: "tms: no such change\n" });
        const exited = yield* firstState({ script, workspaceRoot: root });
        yield* Ref.set(script.output, { code: 0, stdout: "{not json", stderr: "" });
        const garbled = yield* firstState({ script, workspaceRoot: root });
        yield* Ref.set(script.output, { spawnFails: true });
        const unspawned = yield* firstState({ script, workspaceRoot: root });

        expect(exited).toEqual([{ _tag: "failed", root, message: "tms: no such change" }]);
        expect(garbled[0]?._tag).toBe("failed");
        expect(unspawned[0]?._tag === "failed" && unspawned[0].message).toMatch(
          /^Could not run tms/,
        );
      }),
    );

    it("reads levels only from the snapshot's own vocabulary, and refuses another format or an undeclared level by name", () => {
      const read = TmsProjectService.treeOfShowOutput(showOutput());
      expect(read._tag === "Success" && read.success.vocabulary).toEqual(VOCABULARY);

      const custom = TmsProjectService.treeOfShowOutput(
        showOutput([decision({ id: "tms:M1", level: "mission" })], {
          format: 1,
          vocabulary: {
            ...VOCABULARY,
            levels: [{ level: "mission", letter: "M", accepted: true }, ...VOCABULARY.levels],
          },
        }),
      );
      expect(custom._tag).toBe("Success");

      expect(
        TmsProjectService.treeOfShowOutput(
          showOutput([decision({ id: "tms:M1", level: "mission" })]),
        ),
      ).toMatchObject({
        _tag: "Failure",
        failure: "tms emitted a decision its own vocabulary does not declare: tms:M1 (mission).",
      });
      const later = TmsProjectService.treeOfShowOutput(
        showOutput([], { format: 2, vocabulary: VOCABULARY }),
      );
      expect(later._tag === "Failure" && later.failure).toMatch(
        /^tms emits snapshot format 2; this T3 Code build reads format 1\./,
      );
    });

    it("reads a relationship whose endpoint concept declares no kind", () => {
      const shown = JSON.parse(showOutput());
      const read = TmsProjectService.treeOfShowOutput(
        JSON.stringify({
          ...shown,
          nodes: [
            ...shown.nodes,
            { id: "tms:C9", label: "Other", kind: null, of: null, stands: true },
          ],
          edges: [
            ...shown.edges,
            { id: "tms:C3", from: "tms:C1", to: "tms:C9", label: "Uses", functional: false },
          ],
        }),
      );
      expect(read._tag === "Success" && read.success.quiver.nodes.map((node) => node.kind)).toEqual(
        ["thing", null],
      );
    });

    it.effect("fails with project-not-found for an unknown project", () =>
      Effect.gen(function* () {
        const { root } = yield* makeTmsCheckout("tms:R1");
        const script = yield* makeRunner(showOutput());

        const error = yield* TmsProjectService.TmsProjectService.use((tms) =>
          tms.streamProject({ projectId: ProjectId.make("missing") }).pipe(Stream.runCollect),
        ).pipe(Effect.provide(serviceLayer({ script, workspaceRoot: root })), Effect.flip);

        expect(error.reason).toBe("project-not-found");
      }),
    );

    it.effect("runs the CLI only when the inputs move and publishes only a different state", () =>
      Effect.gen(function* () {
        const { root, write } = yield* makeTmsCheckout("tms:R1");
        const script = yield* makeRunner(showOutput());
        const ticks = yield* Queue.unbounded<void>();
        const service = TmsProjectService.TmsProjectService;

        const collecting = yield* service
          .use((tms) => tms.streamProject({ projectId }).pipe(Stream.take(2), Stream.runCollect))
          .pipe(
            Effect.provide(serviceLayer({ script, workspaceRoot: root, ticks })),
            Effect.forkChild,
          );
        yield* Queue.offer(ticks, undefined);
        yield* Queue.take(script.calls);

        // Nothing moved: no run.
        yield* Queue.offer(ticks, undefined);
        // The change file moved but the tree did not: a run, nothing published.
        yield* write(".tms/changes/feature/change.yaml", "name: feature\nentry: tms:R1\n# note\n");
        yield* Queue.offer(ticks, undefined);
        yield* Queue.take(script.calls);
        // The tree moved: a run and a new state.
        yield* Ref.set(script.output, {
          code: 0,
          stdout: showOutput([decision({ id: "tms:L2", level: "law", cause: "tms:C1" })]),
          stderr: "",
        });
        yield* write(".tms/changes/feature/change.yaml", "name: feature\nentry: tms:R2\n");
        yield* Queue.offer(ticks, undefined);
        yield* Queue.take(script.calls);

        const states = yield* Fiber.join(collecting);
        expect(states.map((state) => asSnapshot(state).live.entry)).toEqual(["tms:R1", "tms:R2"]);
        expect(asSnapshot(states[1]).tree.nodes.map((node) => node.id)).toContain("tms:L2");
        expect(yield* Queue.size(script.calls)).toBe(0);
      }),
    );
  });
});
