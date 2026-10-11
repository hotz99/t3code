import {
  TmsEntityContextRecord,
  type ComposerContextId,
  type OrchestrationV2ThreadProjection,
  type TmsDecision,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import {
  commentMessageText,
  decisionCommentRecord,
  deliveryOf,
  thenVsNow,
  threadTmsComments,
  type LocalCommentSend,
} from "./tmsCommentModel";

type Projection = Pick<OrchestrationV2ThreadProjection, "messages" | "runs">;
type Message = Projection["messages"][number];
type Run = Projection["runs"][number];

const decision = (id: string, fields: Partial<TmsDecision> = {}): TmsDecision => ({
  id,
  level: "requirement",
  wording: `${id} wording`,
  kind: null,
  cause: "tms:G1",
  uses: [],
  stands: true,
  accepted: true,
  code: [],
  reworded: [],
  ended: null,
  ...fields,
});

const decodeRecord = Schema.decodeUnknownSync(TmsEntityContextRecord);
const at = (iso: string) => DateTime.makeUnsafe(iso);
const ctx = (value: string) => value as ComposerContextId;
const r19 = decisionCommentRecord(decision("tms:R19"), ctx("tms-1"));

const message = (id: string, fields: Partial<Message> = {}): Message =>
  ({
    id,
    threadId: "thread-1",
    runId: null,
    nodeId: null,
    role: "user",
    text: commentMessageText(r19, `comment ${id}`),
    context: { version: 1, records: [r19] },
    attachments: [],
    streaming: false,
    createdAt: at("2026-10-11T10:00:00.000Z"),
    updatedAt: at("2026-10-11T10:00:00.000Z"),
    createdBy: "user",
    creationSource: "web",
    ...fields,
  }) as Message;

const run = (id: string, userMessageId: string, fields: Partial<Run> = {}): Run =>
  ({
    id,
    userMessageId,
    status: "queued",
    startedAt: null,
    ...fields,
  }) as Run;

describe("decisionCommentRecord", () => {
  it("keeps the displayed state and a revision that moves with it", () => {
    expect(r19.entity).toEqual({ type: "decision", id: "tms:R19" });
    expect(r19.snapshot).toEqual({
      level: "requirement",
      wording: "tms:R19 wording",
      status: "accepted",
      cause: "tms:G1",
    });
    expect(decodeRecord(r19)).toEqual(r19);
    expect(decisionCommentRecord(decision("tms:R19"), ctx("tms-2")).revision).toBe(r19.revision);
    expect(
      decisionCommentRecord(decision("tms:R19", { wording: "other" }), ctx("tms-1")).revision,
    ).not.toBe(r19.revision);
  });

  it("names how a decision ended or why it does not stand yet", () => {
    const status = (fields: Partial<TmsDecision>) =>
      decisionCommentRecord(decision("tms:R1", fields), ctx("c")).snapshot.status;
    expect(status({ ended: { by: "tms:R2", reason: "split" } })).toBe("replaced");
    expect(status({ ended: { by: null, reason: "dropped" } })).toBe("withdrawn");
    expect(status({ accepted: false })).toBe("awaits acceptance");
    expect(status({ level: "law", stands: false })).toBe("unsupported");
  });
});

describe("deliveryOf", () => {
  const sent = message("m1");

  it("is submitted until the message reaches a run", () => {
    expect(deliveryOf(sent, [])).toEqual({ state: "submitted" });
  });

  it("is queued while its run waits, with position and hold", () => {
    expect(deliveryOf(sent, [run("r1", "m1", { queuePosition: 2 })])).toEqual({
      state: "queued",
      position: 2,
      held: false,
    });
    expect(deliveryOf(sent, [run("r1", "m1", { queueHeld: true })])).toEqual({
      state: "queued",
      position: null,
      held: true,
    });
    expect(deliveryOf(sent, [run("r1", "m1", { status: "starting" })]).state).toBe("queued");
  });

  it("is delivered once its run started, however the run ended", () => {
    for (const status of ["running", "completed", "failed", "interrupted"] as const) {
      expect(
        deliveryOf(sent, [run("r1", "m1", { status, startedAt: at("2026-10-11T10:01:00Z") })]),
      ).toEqual({ state: "delivered", via: "run" });
    }
  });

  it("is delivered as a steer when it joined another run", () => {
    expect(deliveryOf(message("m1", { runId: "r0" as never }), [run("r0", "m0")])).toEqual({
      state: "delivered",
      via: "steer",
    });
  });

  it("fails, with the reason, when its run ended before starting", () => {
    expect(deliveryOf(sent, [run("r1", "m1", { status: "cancelled" })])).toEqual({
      state: "failed",
      reason: "It was removed from the queue before it started.",
    });
    expect(deliveryOf(sent, [run("r1", "m1", { status: "failed" })]).state).toBe("failed");
  });
});

describe("threadTmsComments", () => {
  const local = (
    messageId: string,
    failure: string | null,
    createdAt: string,
  ): LocalCommentSend => ({
    messageId: messageId as never,
    record: r19,
    comment: "local comment",
    createdAt,
    failure,
  });

  it("lists only user comments on TMS entities, newest first, with their comment text", () => {
    const projection: Projection = {
      messages: [
        message("m1"),
        message("plain", { text: "hello", context: undefined }),
        message("reply", { role: "assistant" }),
        message("m2", { createdAt: at("2026-10-11T10:05:00.000Z") }),
      ],
      runs: [run("r1", "m1", { startedAt: at("2026-10-11T10:00:01Z"), status: "completed" })],
    };
    const comments = threadTmsComments(projection, []);
    expect(comments.map((comment) => comment.messageId)).toEqual(["m2", "m1"]);
    expect(comments[1]).toMatchObject({
      comment: "comment m1",
      record: r19,
      delivery: { state: "delivered", via: "run" },
      local: false,
    });
  });

  it("keeps local sends until the thread has them, and keeps failures", () => {
    const projection: Projection = { messages: [message("m1")], runs: [] };
    const comments = threadTmsComments(projection, [
      local("m1", null, "2026-10-11T10:09:00.000Z"),
      local("m9", "Not connected", "2026-10-11T10:10:00.000Z"),
    ]);
    expect(comments.map((comment) => [comment.messageId, comment.local])).toEqual([
      ["m9", true],
      ["m1", false],
    ]);
    expect(comments[0]!.delivery).toEqual({ state: "failed", reason: "Not connected" });
    expect(
      threadTmsComments(null, [local("m3", null, "2026-10-11T10:00:00.000Z")])[0]!.delivery,
    ).toEqual({ state: "submitted" });
  });
});

describe("thenVsNow", () => {
  const live = (...decisions: TmsDecision[]) => new Map(decisions.map((d) => [d.id, d]));

  it("cannot compare without a live tree", () => {
    expect(thenVsNow(r19, null)).toEqual({ state: "unknown" });
  });

  it("is the same while the decision shows what was commented on", () => {
    expect(thenVsNow(r19, live(decision("tms:R19", { uses: ["tms:C1"] })))).toEqual({
      state: "same",
    });
  });

  it("names the fields that changed and the state now", () => {
    const comparison = thenVsNow(
      r19,
      live(decision("tms:R19", { wording: "new", ended: { by: "tms:R20", reason: "split" } })),
    );
    expect(comparison).toMatchObject({
      state: "changed",
      fields: ["wording", "status"],
      now: { wording: "new", status: "replaced" },
    });
  });

  it("reports a decision that is no longer in the tree", () => {
    expect(thenVsNow(r19, live(decision("tms:R20")))).toEqual({ state: "gone" });
  });
});
