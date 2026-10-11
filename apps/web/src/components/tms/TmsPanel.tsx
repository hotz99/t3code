import type { EnvironmentId, ProjectId, ThreadId, TmsLive, TmsTree } from "@t3tools/contracts";
import { ListTreeIcon, NetworkIcon, TriangleAlertIcon, WorkflowIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { DiffPanelShell } from "~/components/DiffPanelShell";
import { Badge } from "~/components/ui/badge";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "~/components/ui/empty";
import { Spinner } from "~/components/ui/spinner";
import { Switch } from "~/components/ui/switch";
import { Toggle, ToggleGroup } from "~/components/ui/toggle-group";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { cn } from "~/lib/utils";
import { useEnvironmentQuery } from "~/state/query";
import { tmsEnvironment } from "~/state/tms";

import { chainOf, indexTree, layoutCausal, outlineRows } from "./causalTree";
import { TmsCausalGraph } from "./TmsCausalGraph";
import { TmsCommentBox, TmsCommentList, useTmsCommentSender } from "./TmsComments";
import { TmsInspector } from "./TmsInspector";
import { LevelChip } from "./TmsLevel";
import { TmsDecisionRow, TmsOutline } from "./TmsOutline";

type TreeMode = "graph" | "outline";

function TmsNotice(props: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <Empty size="compact">
      <EmptyMedia variant="icon">{props.icon}</EmptyMedia>
      <EmptyHeader>
        <EmptyTitle>{props.title}</EmptyTitle>
        <EmptyDescription>{props.children}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

/** The right-panel surface for a TMS project: its tree of causes, live, and an inspector. */
export function TmsPanel(props: {
  environmentId: EnvironmentId;
  projectId: ProjectId;
  threadId: ThreadId | null;
}) {
  const query = useEnvironmentQuery(
    tmsEnvironment.project({
      environmentId: props.environmentId,
      input:
        props.threadId === null
          ? { projectId: props.projectId }
          : { projectId: props.projectId, threadId: props.threadId },
    }),
  );
  const state = query.data;

  if (state === null) {
    return (
      <DiffPanelShell mode="embedded" header={<TmsTitle />}>
        {query.error ? (
          <TmsNotice icon={<TriangleAlertIcon />} title="Could not read the project">
            {query.error}
          </TmsNotice>
        ) : (
          <div className="flex flex-1 items-center justify-center">
            <Spinner size="md" tone="muted" />
          </div>
        )}
      </DiffPanelShell>
    );
  }
  if (state._tag === "notTmsProject") {
    return (
      <DiffPanelShell mode="embedded" header={<TmsTitle />}>
        <TmsNotice icon={<WorkflowIcon />} title="Not a TMS project">
          No <code className="font-mono">.tms/tms.yaml</code> in {state.root}.
        </TmsNotice>
      </DiffPanelShell>
    );
  }
  if (state._tag === "failed") {
    return (
      <DiffPanelShell mode="embedded" header={<TmsTitle />}>
        <TmsNotice icon={<TriangleAlertIcon />} title="tms could not show the tree">
          <span className="block max-h-48 overflow-auto whitespace-pre-wrap text-left font-mono text-2xs">
            {state.message}
          </span>
        </TmsNotice>
      </DiffPanelShell>
    );
  }
  return (
    <TmsWorkbench
      tree={state.tree}
      live={state.live}
      environmentId={props.environmentId}
      threadId={props.threadId}
    />
  );
}

function TmsTitle(props: { children?: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2 text-sm">
      <span className="shrink-0 font-medium">Tree of causes</span>
      {props.children}
    </div>
  );
}

function TmsWorkbench(props: {
  tree: TmsTree;
  live: TmsLive;
  environmentId: EnvironmentId;
  threadId: ThreadId | null;
}) {
  const { tree, live } = props;
  const sender = useTmsCommentSender(props.environmentId, props.threadId);
  const [mode, setMode] = useState<TreeMode>("graph");
  // Null until the user picks: the selected change's entry is selected by default.
  const [selection, setSelection] = useState<{ readonly id: string | null } | null>(null);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const [showEnded, setShowEnded] = useState(false);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const index = useMemo(() => indexTree(tree), [tree]);
  const layout = useMemo(() => layoutCausal(index, collapsed), [index, collapsed]);
  const rows = useMemo(() => outlineRows(index, collapsed), [index, collapsed]);
  const selectedId = selection === null ? live.entry : selection.id;

  const select = useCallback((id: string | null) => setSelection({ id }), []);
  const toggle = useCallback(
    (id: string) =>
      setCollapsed((current) => {
        const next = new Set(current);
        if (!next.delete(id)) next.add(id);
        return next;
      }),
    [],
  );
  const go = useCallback(
    (id: string) => {
      setSelection({ id });
      const chain = chainOf(index, id);
      setCollapsed((current) =>
        chain.some((cause) => current.has(cause))
          ? new Set([...current].filter((cause) => !chain.includes(cause)))
          : current,
      );
      if (index.byId.get(id)?.ended) setShowEnded(true);
      setHoveredId(null);
    },
    [index],
  );

  useEffect(() => {
    if (selectedId === null) return;
    scrollRef.current
      ?.querySelector(`[data-tms-id="${CSS.escape(selectedId)}"]`)
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [selectedId]);

  const hoveringEnded = hoveredId !== null && tree.ended.some((entry) => entry.id === hoveredId);
  const hovered = hoveredId === null ? undefined : index.byId.get(hoveredId);
  const selectedDecision = selectedId === null ? undefined : index.byId.get(selectedId);

  const header = (
    <>
      <TmsTitle>
        <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground text-xs">
          <Tooltip>
            <TooltipTrigger
              render={<span className={cn("truncate", live.change && "font-mono")} />}
            >
              {live.change ?? "no change selected"}
            </TooltipTrigger>
            <TooltipPopup side="bottom">Read from {live.root}</TooltipPopup>
          </Tooltip>
          {live.entry ? (
            <>
              <span className="shrink-0">enters at</span>
              <Badge
                variant="outline"
                size="sm"
                render={<button type="button" onClick={() => go(live.entry ?? "")} />}
              >
                <span className="font-mono">{live.entry}</span>
              </Badge>
            </>
          ) : null}
        </span>
      </TmsTitle>
      <ToggleGroup
        aria-label="Tree layout"
        className="shrink-0"
        variant="segmented"
        value={[mode]}
        onValueChange={(value) => {
          const next = value[0];
          if (next === "graph" || next === "outline") setMode(next);
        }}
      >
        <Toggle aria-label="Graph" value="graph">
          <NetworkIcon className="size-3.5" />
        </Toggle>
        <Toggle aria-label="Outline" value="outline">
          <ListTreeIcon className="size-3.5" />
        </Toggle>
      </ToggleGroup>
    </>
  );

  return (
    <DiffPanelShell mode="embedded" header={header}>
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-border/60 px-3 py-1.5 text-2xs text-muted-foreground">
        {hovered ? (
          // The hovered decision's wording stands in for the legend while the pointer is on it.
          <span className="flex min-w-0 flex-1 items-center gap-1.5">
            <LevelChip level={hovered.level} levels={index.levels} />
            <span className="shrink-0 font-mono">{hovered.id}</span>
            <span className="truncate text-foreground">{hovered.wording}</span>
          </span>
        ) : (
          tree.vocabulary.levels.map(({ level }) => (
            <span key={level} className="flex items-center gap-1">
              <LevelChip level={level} levels={index.levels} />
              {level}
            </span>
          ))
        )}
        <label className="ms-auto flex cursor-pointer items-center gap-1.5">
          <Switch size="sm" checked={showEnded} onCheckedChange={setShowEnded} />
          Show {tree.ended.length} ended
        </label>
      </div>
      <div className="@container/tms flex min-h-0 flex-1 flex-col @3xl/tms:flex-row">
        <div ref={scrollRef} className="min-h-0 min-w-0 flex-1 overflow-auto">
          {tree.nodes.length === 0 ? (
            <p className="p-3 text-muted-foreground text-xs">The tree has no standing decisions.</p>
          ) : mode === "graph" ? (
            <TmsCausalGraph
              index={index}
              layout={layout}
              selectedId={selectedId}
              hoveredId={hoveredId}
              onSelect={select}
              onToggle={toggle}
              onHover={setHoveredId}
            />
          ) : (
            <TmsOutline
              rows={rows}
              levels={index.levels}
              selectedId={selectedId}
              hoveredId={hoveredId}
              onSelect={select}
              onToggle={toggle}
              onHover={setHoveredId}
            />
          )}
          {showEnded && tree.ended.length > 0 ? (
            <div role="tree" aria-label="Ended decisions" className="flex flex-col p-1">
              <h3 className="px-2 pt-2 pb-1 font-medium text-2xs text-muted-foreground uppercase tracking-wide">
                Ended
              </h3>
              {tree.ended.map((decision) => (
                <TmsDecisionRow
                  key={decision.id}
                  decision={decision}
                  levels={index.levels}
                  selected={decision.id === selectedId}
                  dimmed={hoveringEnded && decision.id !== hoveredId}
                  onSelect={select}
                  onHover={setHoveredId}
                />
              ))}
            </div>
          ) : null}
        </div>
        <aside
          aria-label="Decision"
          aria-live="polite"
          className="max-h-[45%] shrink-0 overflow-y-auto border-t border-border/60 @3xl/tms:max-h-none @3xl/tms:w-80 @3xl/tms:border-t-0 @3xl/tms:border-l"
        >
          <TmsInspector index={index} id={selectedId} onGo={go} onHover={setHoveredId} />
          {selectedDecision ? <TmsCommentBox decision={selectedDecision} sender={sender} /> : null}
          {sender ? <TmsCommentList sender={sender} live={index.byId} onGo={go} /> : null}
        </aside>
      </div>
    </DiffPanelShell>
  );
}
