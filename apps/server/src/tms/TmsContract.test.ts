import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as ProcessRunner from "../processRunner.ts";
import { treeOfShowOutput } from "./TmsProjectService.ts";

/**
 * The fork reads what the claude-setup beside it emits: this decodes the real `tms change show
 * --json` of that checkout, so a format or vocabulary change in tms fails here before it reaches
 * a panel. TMS_CLAUDE_SETUP names another checkout; without one beside the fork it passes vacuously.
 */
it.layer(Layer.provideMerge(ProcessRunner.layer, NodeServices.layer))(
  "the tms snapshot contract",
  (it) => {
    describe("claude-setup", () => {
      it.effect("decodes the live snapshot of the claude-setup checkout", () =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const root =
            process.env.TMS_CLAUDE_SETUP ??
            path.resolve(import.meta.dirname, "../../../../../claude-setup");
          const launcher = path.join(root, "bin", "tms");
          if (!(yield* fs.exists(launcher))) return;

          const shown = yield* (yield* ProcessRunner.ProcessRunner).run({
            command: launcher,
            args: ["change", "show", "--json"],
            cwd: root,
            timeout: Duration.seconds(60),
            maxOutputBytes: 64 * 1024 * 1024,
          });
          expect(shown.code, shown.stderr).toBe(0);

          const tree = treeOfShowOutput(shown.stdout);

          expect(tree._tag === "Failure" ? tree.failure : "ok").toBe("ok");
        }),
      );
    });
  },
);
