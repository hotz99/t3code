/**
 * Comments on TMS entities, free of React: the record a comment carries, how its delivery reads
 * off T3's own message and run state, and how the state it commented on compares with the live
 * tree. Nothing here writes the tms; the agent changes it through its own commands.
 */
import type {
  ComposerContextId,
  OrchestrationV2ThreadProjection,
  TmsDecision,
  TmsEntityContextRecord,
  TmsEntitySnapshot,
} from "@t3tools/contracts";
import {
  formatComposerContextReference,
  replaceComposerContextReferences,
} from "@t3tools/shared/composerContextReferences";
import * as DateTime from "effect/DateTime";

import { statusOf, type CausalIndex, type TmsLevels } from "./causalTree";

type Message = OrchestrationV2ThreadProjection["messages"][number];
type Run = OrchestrationV2ThreadProjection["runs"][number];

/** What the inspector shows for a decision, as the comment keeps it. */
function decisionSnapshot(decision: TmsDecision, levels: TmsLevels): TmsEntitySnapshot {
  const status =
    decision.ended === null
      ? statusOf(decision, levels).label
      : decision.ended.by === null
        ? "withdrawn"
        : "replaced";
  return {
    level: String(decision.level),
    wording: decision.wording,
    status,
    cause: decision.cause,
  };
}

// The tree snapshot carries no log head, so the revision is a digest of the commented state.
function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function snapshotRevision(id: string, snapshot: TmsEntitySnapshot): string {
  return `d-${fnv1a(JSON.stringify([id, snapshot.level, snapshot.wording, snapshot.status, snapshot.cause]))}`;
}

export function decisionCommentRecord(
  decision: TmsDecision,
  levels: TmsLevels,
  contextId: ComposerContextId,
): TmsEntityContextRecord {
  const snapshot = decisionSnapshot(decision, levels);
  return {
    version: 1,
    kind: "tms-entity",
    contextId,
    label: decision.id.slice(0, 200),
    entity: { type: "decision", id: decision.id },
    snapshot,
    revision: snapshotRevision(decision.id, snapshot),
  };
}

/** The message text: the entity's chip, then the comment. */
export function commentMessageText(record: TmsEntityContextRecord, comment: string): string {
  return `${formatComposerContextReference(record)} ${comment.trim()}`;
}

function commentTextOf(message: Pick<Message, "text">): string {
  return replaceComposerContextReferences(message.text, () => "").trim();
}

function tmsEntityRecordOf(message: Pick<Message, "context">): TmsEntityContextRecord | null {
  const record = message.context?.records.find((candidate) => candidate.kind === "tms-entity");
  return record !== undefined && "entity" in record ? record : null;
}

export type CommentDelivery =
  /** The send is in flight, or the message is recorded but not yet attached to a run. */
  | { readonly state: "submitted" }
  /** Accepted for delivery: its run waits in the thread's queue. */
  | { readonly state: "queued"; readonly position: number | null; readonly held: boolean }
  /** The run carrying it started, or it steered a running run. */
  | { readonly state: "delivered"; readonly via: "run" | "steer" }
  /** It will not reach the agent as it is; the comment is kept so it can be sent again. */
  | { readonly state: "failed"; readonly reason: string };

const NEVER_STARTED: Partial<Record<Run["status"], string>> = {
  failed: "The run failed before it started.",
  cancelled: "It was removed from the queue before it started.",
  interrupted: "It was stopped before it started.",
  rolled_back: "It was rolled back before it started.",
};

/** Delivery of a recorded message, read from the run it started or the run it steered. */
export function deliveryOf(
  message: Pick<Message, "id" | "runId">,
  runs: ReadonlyArray<Run>,
): CommentDelivery {
  const own = runs.find((run) => run.userMessageId === message.id);
  if (own !== undefined) {
    if (own.startedAt !== null) return { state: "delivered", via: "run" };
    const reason = NEVER_STARTED[own.status];
    if (reason !== undefined) return { state: "failed", reason };
    if (own.status === "queued" || own.status === "preparing" || own.status === "starting") {
      return { state: "queued", position: own.queuePosition ?? null, held: own.queueHeld === true };
    }
    return { state: "delivered", via: "run" };
  }
  if (message.runId !== null && runs.some((run) => run.id === message.runId)) {
    return { state: "delivered", via: "steer" };
  }
  return { state: "submitted" };
}

/** A comment the panel sent and has not yet seen in the thread. */
export interface LocalCommentSend {
  readonly messageId: Message["id"];
  readonly record: TmsEntityContextRecord;
  readonly comment: string;
  readonly createdAt: string;
  readonly failure: string | null;
}

export interface TmsComment {
  readonly messageId: Message["id"];
  readonly record: TmsEntityContextRecord;
  readonly comment: string;
  readonly createdAt: string;
  readonly delivery: CommentDelivery;
  /** Only local sends that never reached the thread can be discarded. */
  readonly local: boolean;
}

/** This thread's comments on TMS entities, newest first, local sends included until they land. */
export function threadTmsComments(
  projection: Pick<OrchestrationV2ThreadProjection, "messages" | "runs"> | null,
  local: ReadonlyArray<LocalCommentSend>,
): ReadonlyArray<TmsComment> {
  const comments: TmsComment[] = [];
  const recorded = new Set<string>();
  for (const message of projection?.messages ?? []) {
    if (message.role !== "user") continue;
    const record = tmsEntityRecordOf(message);
    if (record === null) continue;
    recorded.add(message.id);
    comments.push({
      messageId: message.id,
      record,
      comment: commentTextOf(message),
      createdAt: DateTime.formatIso(message.createdAt),
      delivery: deliveryOf(message, projection?.runs ?? []),
      local: false,
    });
  }
  for (const send of local) {
    if (recorded.has(send.messageId)) continue;
    comments.push({
      messageId: send.messageId,
      record: send.record,
      comment: send.comment,
      createdAt: send.createdAt,
      delivery:
        send.failure === null ? { state: "submitted" } : { state: "failed", reason: send.failure },
      local: true,
    });
  }
  return comments.toSorted((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export type SnapshotField = keyof TmsEntitySnapshot;

export type ThenVsNow =
  /** The live tree is not available to compare with. */
  | { readonly state: "unknown" }
  | { readonly state: "same" }
  | {
      readonly state: "changed";
      readonly now: TmsEntitySnapshot;
      readonly fields: ReadonlyArray<SnapshotField>;
    }
  | { readonly state: "gone" };

const SNAPSHOT_FIELDS: ReadonlyArray<SnapshotField> = ["level", "wording", "status", "cause"];

/** The commented state against the live decision with the same id, ended ones included. */
export function thenVsNow(
  record: Pick<TmsEntityContextRecord, "entity" | "snapshot">,
  live: CausalIndex | null,
): ThenVsNow {
  if (live === null) return { state: "unknown" };
  const decision = live.byId.get(record.entity.id);
  if (decision === undefined) return { state: "gone" };
  const now = decisionSnapshot(decision, live.levels);
  const fields = SNAPSHOT_FIELDS.filter((field) => now[field] !== record.snapshot[field]);
  return fields.length === 0 ? { state: "same" } : { state: "changed", now, fields };
}
