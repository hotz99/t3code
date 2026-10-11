import type { TmsDecision } from "@t3tools/contracts";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { KeyboardEvent, ReactNode } from "react";

import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";

import type { OutlineRow } from "./causalTree";
import type { TmsLevels } from "./causalTree";
import { LevelChip, StatusBadge } from "./TmsLevel";

const INDENT_PX = 16;

/** One decision as a selectable row: level, id, wording, then its status. */
export function TmsDecisionRow(props: {
  decision: TmsDecision;
  levels: TmsLevels;
  selected: boolean;
  dimmed: boolean;
  depth?: number;
  twisty?: ReactNode;
  onSelect: (id: string) => void;
  onHover: (id: string | null) => void;
}) {
  const { decision } = props;
  const activate = (event: KeyboardEvent) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    props.onSelect(decision.id);
  };
  return (
    <div
      role="treeitem"
      aria-selected={props.selected}
      tabIndex={0}
      data-tms-id={decision.id}
      className={cn(
        "flex h-7 cursor-pointer items-center gap-1.5 rounded-md pe-1.5 text-sm outline-none transition-opacity duration-150 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
        props.selected && "bg-accent",
        props.dimmed && "opacity-20",
      )}
      // Indentation follows the decision's depth in the tree.
      style={{ paddingInlineStart: (props.depth ?? 0) * INDENT_PX + 4 }}
      onClick={() => props.onSelect(decision.id)}
      onKeyDown={activate}
      onMouseEnter={() => props.onHover(decision.id)}
      onMouseLeave={() => props.onHover(null)}
    >
      <span className="flex w-5 shrink-0 justify-center">{props.twisty}</span>
      <LevelChip level={decision.level} levels={props.levels} />
      <span className="shrink-0 font-mono text-muted-foreground text-xs">{decision.id}</span>
      <span
        className={cn(
          "min-w-0 flex-1 truncate",
          decision.ended !== null && "text-muted-foreground line-through",
        )}
      >
        {decision.wording}
      </span>
      {decision.code.length > 0 ? (
        <span
          className="shrink-0 font-mono text-2xs text-muted-foreground"
          aria-label={`${decision.code.length} code symbols realize it`}
        >
          ⌗{decision.code.length}
        </span>
      ) : null}
      <StatusBadge decision={decision} levels={props.levels} />
    </div>
  );
}

/** The causal tree as an indented outline. */
export function TmsOutline(props: {
  rows: ReadonlyArray<OutlineRow>;
  levels: TmsLevels;
  selectedId: string | null;
  hoveredId: string | null;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
  onHover: (id: string | null) => void;
}) {
  const hovering =
    props.hoveredId !== null && props.rows.some((row) => row.decision.id === props.hoveredId);
  return (
    <div role="tree" aria-label="Causal tree" className="flex flex-col p-1">
      {props.rows.map((row) => (
        <TmsDecisionRow
          key={row.decision.id}
          decision={row.decision}
          levels={props.levels}
          depth={row.depth}
          selected={row.decision.id === props.selectedId}
          dimmed={hovering && row.decision.id !== props.hoveredId}
          onSelect={props.onSelect}
          onHover={props.onHover}
          twisty={
            row.childCount > 0 ? (
              <Button
                size="icon-micro"
                variant="ghost-muted"
                aria-label={row.open ? "Collapse" : "Expand"}
                aria-expanded={row.open}
                onClick={(event) => {
                  event.stopPropagation();
                  props.onToggle(row.decision.id);
                }}
              >
                {row.open ? <ChevronDown /> : <ChevronRight />}
              </Button>
            ) : null
          }
        />
      ))}
    </div>
  );
}
