import * as Schema from "effect/Schema";

import { ProjectId, ThreadId } from "./baseSchemas.ts";

/**
 * A TMS ("tree of causes") project as `tms change show --json` describes it, read by the
 * environment that owns the workspace. T3 only reads it; the tms CLI stays the authority.
 */
export const TmsDecisionLevel = Schema.Literals(["goal", "requirement", "concept", "law"]);
export type TmsDecisionLevel = typeof TmsDecisionLevel.Type;

export const TmsDecision = Schema.Struct({
  id: Schema.String,
  level: TmsDecisionLevel,
  wording: Schema.String,
  /** A concept's ontology kind: thing, property or relationship. */
  kind: Schema.NullOr(Schema.String),
  cause: Schema.NullOr(Schema.String),
  uses: Schema.Array(Schema.String),
  stands: Schema.Boolean,
  accepted: Schema.Boolean,
  /** Code symbols (`path#name`) or files that realize it. */
  code: Schema.Array(Schema.String),
  reworded: Schema.Array(Schema.Struct({ wording: Schema.String, reason: Schema.String })),
  /** `by` names the replacement; null when it was withdrawn. */
  ended: Schema.NullOr(Schema.Struct({ by: Schema.NullOr(Schema.String), reason: Schema.String })),
});
export type TmsDecision = typeof TmsDecision.Type;

export const TmsQuiverNode = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  kind: Schema.String,
  of: Schema.NullOr(Schema.String),
  stands: Schema.Boolean,
});
export type TmsQuiverNode = typeof TmsQuiverNode.Type;

export const TmsQuiverEdge = Schema.Struct({
  id: Schema.String,
  from: Schema.String,
  to: Schema.String,
  label: Schema.String,
  functional: Schema.Boolean,
});
export type TmsQuiverEdge = typeof TmsQuiverEdge.Type;

export const TmsTree = Schema.Struct({
  /** Decisions that have not ended. */
  nodes: Schema.Array(TmsDecision),
  /** Decisions that were replaced or withdrawn. */
  ended: Schema.Array(TmsDecision),
  quiver: Schema.Struct({
    nodes: Schema.Array(TmsQuiverNode),
    edges: Schema.Array(TmsQuiverEdge),
  }),
});
export type TmsTree = typeof TmsTree.Type;

export const TmsLive = Schema.Struct({
  /** The change the checkout selected, or its only open change. */
  change: Schema.NullOr(Schema.String),
  /** The decision the selected change enters at. */
  entry: Schema.NullOr(Schema.String),
  /** The checkout the tree was read from: the thread's worktree or the project root. */
  root: Schema.String,
});
export type TmsLive = typeof TmsLive.Type;

export const TmsProjectState = Schema.Union([
  Schema.TaggedStruct("snapshot", { tree: TmsTree, live: TmsLive }),
  Schema.TaggedStruct("notTmsProject", { root: Schema.String }),
  /** The tms CLI is missing, failed, or printed something unreadable. */
  Schema.TaggedStruct("failed", { root: Schema.String, message: Schema.String }),
]);
export type TmsProjectState = typeof TmsProjectState.Type;

export const TmsProjectSubscriptionInput = Schema.Struct({
  projectId: ProjectId,
  /** Read the thread's worktree instead of the project root when it has one. */
  threadId: Schema.optional(ThreadId),
});
export type TmsProjectSubscriptionInput = typeof TmsProjectSubscriptionInput.Type;

const TmsProjectLookupErrorReason = Schema.Literals(["project-not-found", "lookup-failed"]);

export class TmsProjectLookupError extends Schema.TaggedError<TmsProjectLookupError>()(
  "TmsProjectLookupError",
  {
    projectId: ProjectId,
    reason: TmsProjectLookupErrorReason,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return this.reason === "project-not-found"
      ? "The project no longer exists."
      : "Could not look up the project's workspace.";
  }
}
