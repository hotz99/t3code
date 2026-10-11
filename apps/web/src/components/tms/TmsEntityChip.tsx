import type { ScopedThreadRef, TmsEntityContextRecord } from "@t3tools/contracts";
import { WorkflowIcon } from "lucide-react";
import { useMemo } from "react";

import { ContextChipPopover } from "~/components/contextChipParts";
import { useThreadShell } from "~/state/entities";
import { useEnvironmentQuery } from "~/state/query";
import { tmsEnvironment } from "~/state/tms";

import { indexTree } from "./causalTree";
import { TmsThenVsNow } from "./TmsComments";

/** Reads the live tree only while the details are open, so a transcript never polls the checkout. */
function TmsEntityDetails(props: { record: TmsEntityContextRecord; threadRef: ScopedThreadRef }) {
  const shell = useThreadShell(props.threadRef);
  const query = useEnvironmentQuery(
    shell === null
      ? null
      : tmsEnvironment.project({
          environmentId: props.threadRef.environmentId,
          input: { projectId: shell.projectId, threadId: props.threadRef.threadId },
        }),
  );
  const state = query.data;
  const live = useMemo(() => (state?._tag === "snapshot" ? indexTree(state.tree) : null), [state]);
  return <TmsThenVsNow record={props.record} live={live} alwaysShowThen />;
}

/** A sent comment's subject: the TMS entity it names, then and now. */
export function TmsEntityChip(props: {
  record: TmsEntityContextRecord;
  threadRef: ScopedThreadRef | null;
  copyMarkdown?: string;
}) {
  const { record } = props;
  return (
    <ContextChipPopover
      kind="review-comment"
      icon={<WorkflowIcon />}
      label={record.label}
      accessibleLabel={`TMS ${record.entity.type}, ${record.entity.id}`}
      {...(props.copyMarkdown === undefined ? {} : { copyMarkdown: props.copyMarkdown })}
    >
      <div className="flex flex-col gap-2 p-1">
        <span className="font-mono text-xs">
          {record.entity.type} {record.entity.id}
        </span>
        {props.threadRef ? (
          <TmsEntityDetails record={record} threadRef={props.threadRef} />
        ) : (
          <TmsThenVsNow record={record} live={null} alwaysShowThen />
        )}
      </div>
    </ContextChipPopover>
  );
}
