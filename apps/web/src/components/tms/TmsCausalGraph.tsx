import { useMemo, type KeyboardEvent } from "react";

import { cn } from "~/lib/utils";

import {
  CAUSAL_METRICS,
  chainOf,
  childrenOf,
  levelOf,
  statusOf,
  type CausalIndex,
  type CausalLayout,
} from "./causalTree";
import { levelFill, shortIdOf } from "./TmsLevel";

const { boxWidth, boxHeight } = CAUSAL_METRICS;
const TEXT_BASELINE = 14;
const MONO_CHAR_WIDTH = 6.6;
const ID_START = 24;

/** The short id, cut to fit beside the trailing count. */
const clipId = (id: string, trailing: string) => {
  const short = shortIdOf(id);
  const room = boxWidth - ID_START - 6 - (trailing ? trailing.length * MONO_CHAR_WIDTH + 6 : 0);
  const max = Math.max(3, Math.floor(room / MONO_CHAR_WIDTH));
  return short.length > max ? `${short.slice(0, max - 1)}…` : short;
};

/** The causal tree drawn left to right: each decision beside the cause it rests on. */
export function TmsCausalGraph(props: {
  index: CausalIndex;
  layout: CausalLayout;
  selectedId: string | null;
  hoveredId: string | null;
  onSelect: (id: string | null) => void;
  onToggle: (id: string) => void;
  onHover: (id: string | null) => void;
}) {
  const { index, layout, selectedId, hoveredId } = props;
  const onChain = useMemo(
    () => new Set(selectedId === null ? [] : [selectedId, ...chainOf(index, selectedId)]),
    [index, selectedId],
  );
  const hovering = hoveredId !== null && layout.boxes.some((box) => box.id === hoveredId);

  const activate = (event: KeyboardEvent, id: string) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    props.onSelect(id);
  };

  return (
    <svg
      width={layout.width}
      height={layout.height}
      viewBox={`0 0 ${layout.width} ${layout.height}`}
      role="tree"
      aria-label="Causal tree"
      className="block select-none"
      onClick={(event) => {
        if (event.target === event.currentTarget) props.onSelect(null);
      }}
    >
      {layout.edges.map((edge) => {
        const hot = onChain.has(edge.from) && onChain.has(edge.to);
        return (
          <path
            key={`${edge.from}>${edge.to}`}
            d={edge.path}
            fill="none"
            className={cn(
              "transition-opacity duration-150",
              hot ? "stroke-primary stroke-2" : "stroke-border stroke-1",
              hovering && "opacity-20",
            )}
          />
        );
      })}
      {layout.boxes.map((box) => {
        const decision = index.byId.get(box.id);
        if (!decision) return null;
        const status = statusOf(decision, index.levels);
        const selected = box.id === selectedId;
        const canToggle = childrenOf(index, box.id).length > 0;
        const trailing =
          box.hidden > 0
            ? `+${box.hidden}`
            : decision.code.length
              ? `⌗${decision.code.length}`
              : "";
        return (
          <g
            key={box.id}
            data-tms-id={box.id}
            role="treeitem"
            aria-selected={selected}
            aria-label={`${box.id}, ${status.label}`}
            tabIndex={0}
            transform={`translate(${box.x},${box.y})`}
            className={cn(
              "group cursor-pointer outline-none transition-opacity duration-150",
              hovering && box.id !== hoveredId && "opacity-20",
            )}
            onClick={() => props.onSelect(box.id)}
            onDoubleClick={() => canToggle && props.onToggle(box.id)}
            onKeyDown={(event) => activate(event, box.id)}
            onMouseEnter={() => props.onHover(box.id)}
            onMouseLeave={() => props.onHover(null)}
          >
            <rect
              width={boxWidth}
              height={boxHeight}
              rx={4}
              className={cn(
                "fill-background group-hover:fill-accent group-focus-visible:stroke-ring",
                selected
                  ? "stroke-primary stroke-2"
                  : status.tone === "warning"
                    ? "stroke-warning stroke-1"
                    : status.tone === "error"
                      ? "stroke-destructive stroke-1 [stroke-dasharray:4_3]"
                      : "stroke-border stroke-1",
              )}
            />
            <rect
              width={18}
              height={boxHeight}
              rx={4}
              className={levelFill(index.levels, decision.level)}
            />
            <text
              x={9}
              y={TEXT_BASELINE}
              textAnchor="middle"
              className="fill-background font-mono text-2xs font-semibold"
            >
              {levelOf(index.levels, decision.level).letter}
            </text>
            <text x={ID_START} y={TEXT_BASELINE} className="fill-foreground font-mono text-2xs">
              {clipId(box.id, trailing)}
            </text>
            {trailing ? (
              <text
                x={boxWidth - 6}
                y={TEXT_BASELINE}
                textAnchor="end"
                className="fill-muted-foreground font-mono text-2xs"
              >
                {trailing}
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}
