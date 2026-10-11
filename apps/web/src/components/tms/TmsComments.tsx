import type {
  EnvironmentId,
  ThreadId,
  TmsDecision,
  TmsEntityContextRecord,
  TmsEntitySnapshot,
} from "@t3tools/contracts";
import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Textarea } from "~/components/ui/textarea";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { cn, newMessageId, randomUUID } from "~/lib/utils";
import { useThreadProjection } from "~/state/entities";
import { threadEnvironment } from "~/state/threads";
import { useOrchestrationCommand } from "~/state/use-orchestration-command";
import { toComposerContextId } from "~/lib/composerContextReferences";

import type { CausalIndex, TmsLevels } from "./causalTree";
import { useLocalCommentSends, useTmsCommentSendStore } from "./tmsCommentSendStore";
import {
  commentMessageText,
  decisionCommentRecord,
  thenVsNow,
  threadTmsComments,
  type CommentDelivery,
  type SnapshotField,
  type TmsComment,
} from "./tmsCommentModel";

type SendMode = "queue" | "steer";

export interface TmsCommentSender {
  readonly comments: ReadonlyArray<TmsComment>;
  send: (record: TmsEntityContextRecord, comment: string, mode: SendMode) => void;
  retry: (comment: TmsComment) => void;
  discard: (comment: TmsComment) => void;
}

/**
 * Sends comments to the panel's thread the way an MCP App's approved message goes: straight to
 * the thread, leaving the user's composer draft alone. Queue never steers or interrupts.
 */
export function useTmsCommentSender(
  environmentId: EnvironmentId,
  threadId: ThreadId | null,
): TmsCommentSender | null {
  const threadRef = useMemo(
    () => (threadId === null ? null : scopeThreadRef(environmentId, threadId)),
    [environmentId, threadId],
  );
  const threadKey = threadRef === null ? null : scopedThreadKey(threadRef);
  const projection = useThreadProjection(threadRef)?.projection ?? null;
  const local = useLocalCommentSends(threadKey);
  const startThreadTurn = useOrchestrationCommand(threadEnvironment.startTurn, {
    reportFailure: false,
  });
  const comments = useMemo(() => threadTmsComments(projection, local), [projection, local]);

  useEffect(() => {
    if (threadKey === null || projection === null) return;
    const landed = new Set(projection.messages.map((message) => message.id));
    for (const send of local) {
      if (landed.has(send.messageId)) {
        useTmsCommentSendStore.getState().remove(threadKey, send.messageId);
      }
    }
  }, [local, projection, threadKey]);

  const thread = projection?.thread ?? null;
  const send = useCallback(
    (record: TmsEntityContextRecord, comment: string, mode: SendMode) => {
      if (threadKey === null || threadId === null || thread === null) return;
      const store = useTmsCommentSendStore.getState();
      const messageId = newMessageId();
      const pending = {
        messageId,
        record,
        comment,
        createdAt: new Date().toISOString(),
        failure: null,
      };
      store.put(threadKey, pending);
      void startThreadTurn({
        environmentId,
        input: {
          threadId,
          message: {
            messageId,
            role: "user",
            text: commentMessageText(record, comment),
            attachments: [],
            context: { version: 1, records: [record] },
          },
          runtimeMode: thread.runtimeMode,
          interactionMode: thread.interactionMode,
          dispatchMode: mode,
        },
      })
        .then((result) => (result._tag === "Failure" ? squashAtomCommandFailure(result) : null))
        .catch((error: unknown) => error)
        .then((error) => {
          if (error === null) return;
          store.put(threadKey, {
            ...pending,
            failure: error instanceof Error ? error.message : "The comment could not be sent.",
          });
        });
    },
    [environmentId, startThreadTurn, thread, threadId, threadKey],
  );

  const discard = useCallback(
    (comment: TmsComment) => {
      if (threadKey !== null && comment.local) {
        useTmsCommentSendStore.getState().remove(threadKey, comment.messageId);
      }
    },
    [threadKey],
  );
  const retry = useCallback(
    (comment: TmsComment) => {
      discard(comment);
      send(comment.record, comment.comment, "queue");
    },
    [discard, send],
  );

  if (threadKey === null || thread === null) return null;
  return { comments, send, retry, discard };
}

/** The comment input under a decision: queue by default, interrupt only when asked. */
export function TmsCommentBox(props: {
  decision: TmsDecision;
  levels: TmsLevels;
  sender: TmsCommentSender | null;
}) {
  const [text, setText] = useState("");
  const { sender, decision } = props;
  if (sender === null) {
    return (
      <p className="px-3 pb-3 text-muted-foreground text-xs">
        Comments go to a started thread. Send it a first message, then comment here.
      </p>
    );
  }
  const submit = (mode: SendMode) => {
    if (text.trim().length === 0) return;
    const record = decisionCommentRecord(
      decision,
      props.levels,
      toComposerContextId(`tms-${randomUUID()}`),
    );
    sender.send(record, text, mode);
    setText("");
  };
  return (
    <form
      className="flex flex-col gap-1.5 px-3 pb-3"
      onSubmit={(event) => {
        event.preventDefault();
        submit("queue");
      }}
    >
      <Textarea
        size="sm"
        aria-label={`Comment on ${decision.id}`}
        placeholder={`Comment on ${decision.id}…`}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            submit("queue");
          }
        }}
      />
      <div className="flex items-center justify-end gap-1.5">
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                size="xs"
                variant="ghost-muted"
                disabled={text.trim().length === 0}
                onClick={() => submit("steer")}
              />
            }
          >
            Send now (interrupt)
          </TooltipTrigger>
          <TooltipPopup side="top">Steers the agent's running turn with this comment</TooltipPopup>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="submit"
                size="xs"
                variant="outline"
                disabled={text.trim().length === 0}
              />
            }
          >
            Send
          </TooltipTrigger>
          <TooltipPopup side="top">
            Queues after the agent's current work, without interrupting it
          </TooltipPopup>
        </Tooltip>
      </div>
    </form>
  );
}

const DELIVERY_BADGE: Record<
  CommentDelivery["state"],
  { label: string; variant: "outline" | "info" | "success" | "error" }
> = {
  submitted: { label: "submitted", variant: "outline" },
  queued: { label: "queued", variant: "info" },
  delivered: { label: "delivered", variant: "success" },
  failed: { label: "not delivered", variant: "error" },
};

function deliveryDetail(delivery: CommentDelivery): string {
  switch (delivery.state) {
    case "submitted":
      return "Sent to the thread; waiting for it to be accepted.";
    case "queued":
      return delivery.held
        ? "Queued, but the thread's queue is held until it is resumed."
        : `Queued after the agent's current work${delivery.position === null ? "" : ` (position ${delivery.position})`}.`;
    case "delivered":
      return delivery.via === "steer"
        ? "Steered into the agent's running turn."
        : "The turn carrying it started.";
    case "failed":
      return delivery.reason;
  }
}

function DeliveryBadge(props: { delivery: CommentDelivery }) {
  const badge = DELIVERY_BADGE[props.delivery.state];
  return (
    <Tooltip>
      <TooltipTrigger render={<Badge size="sm" variant={badge.variant} />}>
        {badge.label}
      </TooltipTrigger>
      <TooltipPopup side="top">{deliveryDetail(props.delivery)}</TooltipPopup>
    </Tooltip>
  );
}

function SnapshotLines(props: {
  snapshot: TmsEntitySnapshot;
  changed: ReadonlyArray<SnapshotField>;
}) {
  const mark = (field: SnapshotField) =>
    props.changed.includes(field) ? "text-foreground font-medium" : "text-muted-foreground";
  return (
    <div className="flex flex-col gap-0.5 text-2xs">
      <span>
        <span className={mark("status")}>{props.snapshot.status}</span>
        <span className="text-muted-foreground"> · </span>
        <span className={mark("level")}>{props.snapshot.level}</span>
        {props.snapshot.cause !== null || props.changed.includes("cause") ? (
          <span className={mark("cause")}> · rests on {props.snapshot.cause ?? "nothing"}</span>
        ) : null}
      </span>
      <span className={cn("whitespace-pre-wrap", mark("wording"))}>{props.snapshot.wording}</span>
    </div>
  );
}

/** The state a comment was written against, and the live one when they differ. */
export function TmsThenVsNow(props: {
  record: Pick<TmsEntityContextRecord, "entity" | "snapshot">;
  live: CausalIndex | null;
  /** Show the commented state even when nothing changed. */
  alwaysShowThen?: boolean;
}) {
  const comparison = thenVsNow(props.record, props.live);
  if (comparison.state === "changed") {
    return (
      <div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1">
        <span className="pt-px text-3xs text-muted-foreground uppercase">Then</span>
        <SnapshotLines snapshot={props.record.snapshot} changed={comparison.fields} />
        <span className="pt-px text-3xs text-muted-foreground uppercase">Now</span>
        <SnapshotLines snapshot={comparison.now} changed={comparison.fields} />
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1">
      {props.alwaysShowThen ? (
        <SnapshotLines snapshot={props.record.snapshot} changed={[]} />
      ) : null}
      {comparison.state === "gone" ? (
        <span className="text-2xs text-warning-foreground">No longer in the tree.</span>
      ) : comparison.state === "same" && props.alwaysShowThen ? (
        <span className="text-2xs text-muted-foreground">Unchanged since the comment.</span>
      ) : null}
    </div>
  );
}

/** This thread's comments on the tree, newest first, with delivery and then-vs-now. */
export function TmsCommentList(props: {
  sender: TmsCommentSender;
  live: CausalIndex;
  onGo: (id: string) => void;
}) {
  const { comments } = props.sender;
  if (comments.length === 0) return null;
  return (
    <section aria-label="Comments" className="flex flex-col gap-2 border-t border-border/60 p-3">
      <h3 className="font-medium text-2xs text-muted-foreground uppercase tracking-wide">
        Comments in this thread
      </h3>
      <ul className="flex flex-col gap-2.5">
        {comments.map((comment) => (
          <li key={comment.messageId} className="flex flex-col gap-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge
                variant="outline"
                size="sm"
                render={
                  <button type="button" onClick={() => props.onGo(comment.record.entity.id)} />
                }
              >
                <span className="font-mono">{comment.record.entity.id}</span>
              </Badge>
              <DeliveryBadge delivery={comment.delivery} />
              {comment.delivery.state === "failed" ? (
                <span className="ms-auto flex gap-1">
                  <Button
                    size="micro"
                    variant="outline"
                    onClick={() => props.sender.retry(comment)}
                  >
                    Retry
                  </Button>
                  {comment.local ? (
                    <Button
                      size="micro"
                      variant="ghost-muted"
                      onClick={() => props.sender.discard(comment)}
                    >
                      Discard
                    </Button>
                  ) : null}
                </span>
              ) : null}
            </div>
            <p className="whitespace-pre-wrap text-xs">{comment.comment}</p>
            {comment.delivery.state === "failed" ? (
              <p className="text-2xs text-destructive-foreground">{comment.delivery.reason}</p>
            ) : null}
            <TmsThenVsNow record={comment.record} live={props.live} />
          </li>
        ))}
      </ul>
    </section>
  );
}
