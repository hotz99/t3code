import { MinusIcon, PlusIcon, ScanIcon } from "lucide-react";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";

import { Button } from "~/components/ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { cn } from "~/lib/utils";

import type { CausalIndex } from "./causalTree";
import {
  focusOf,
  ONTOLOGY_METRICS,
  PAN_ZOOM_IDENTITY,
  zoomAt,
  type OntologyLayout,
  type PanZoom,
  type Point,
} from "./ontologyLayout";
import { levelStroke } from "./TmsLevel";

/** Pointer travel, in screen pixels, past which a press pans instead of selecting. */
const DRAG_THRESHOLD = 4;

function ArrowLabel(props: { at: Point; anchor: "middle" | "start"; text: string; hot: boolean }) {
  const width = props.text.length * ONTOLOGY_METRICS.labelCharWidth + 8;
  const left = props.anchor === "middle" ? props.at.x - width / 2 : props.at.x - 4;
  return (
    <g>
      <rect
        x={left}
        y={props.at.y - 9}
        width={width}
        height={16}
        rx={3}
        className="fill-background"
      />
      <text
        x={props.at.x}
        y={props.at.y + 3}
        textAnchor={props.anchor}
        className={cn("text-2xs italic", props.hot ? "fill-primary" : "fill-muted-foreground")}
      >
        {props.text}
      </text>
    </g>
  );
}

function ZoomButton(props: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            size="icon-xs"
            variant="outline"
            aria-label={props.label}
            onClick={props.onClick}
          />
        }
      >
        {props.children}
      </TooltipTrigger>
      <TooltipPopup side="bottom">{props.label}</TooltipPopup>
    </Tooltip>
  );
}

/**
 * The ontology as boxes and labelled arrows, panned by dragging and zoomed by wheel or pinch.
 * Focusing an entity (hover first, else the selection) dims what it does not touch.
 */
export function TmsOntologyGraph(props: {
  index: CausalIndex;
  layout: OntologyLayout;
  selectedId: string | null;
  hoveredId: string | null;
  onSelect: (id: string | null) => void;
  onHover: (id: string | null) => void;
}) {
  const { index, layout, selectedId, hoveredId } = props;
  const svgRef = useRef<SVGSVGElement>(null);
  const [view, setView] = useState<PanZoom>(PAN_ZOOM_IDENTITY);
  const gesture = useRef({
    pointers: new Map<number, Point>(),
    last: null as Point | null,
    moved: 0,
    pinch: null as number | null,
    dragged: false,
  });
  const markerId = useId();
  const focus = useMemo(
    () => focusOf(layout, hoveredId) ?? focusOf(layout, selectedId),
    [layout, hoveredId, selectedId],
  );

  const toDrawing = (clientX: number, clientY: number): Point => {
    const matrix = svgRef.current?.getScreenCTM();
    if (!matrix) return { x: clientX, y: clientY };
    const point = new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse());
    return { x: point.x, y: point.y };
  };

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    // React's wheel listener is passive, and the page must not scroll while zooming.
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const matrix = svg.getScreenCTM();
      if (!matrix) return;
      const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
      setView((current) => zoomAt(current, point, Math.exp(-event.deltaY * 0.0015)));
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, []);

  const onPointerDown = (event: PointerEvent<SVGSVGElement>) => {
    const state = gesture.current;
    state.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    state.moved = 0;
    state.dragged = false;
    state.last = toDrawing(event.clientX, event.clientY);
  };
  const onPointerMove = (event: PointerEvent<SVGSVGElement>) => {
    const state = gesture.current;
    const previous = state.pointers.get(event.pointerId);
    if (!previous) return;
    state.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    state.moved += Math.abs(event.clientX - previous.x) + Math.abs(event.clientY - previous.y);
    if (state.pointers.size === 2) {
      const [a, b] = [...state.pointers.values()] as [Point, Point];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      if (state.pinch !== null && state.pinch > 0) {
        const centre = toDrawing((a.x + b.x) / 2, (a.y + b.y) / 2);
        const factor = distance / state.pinch;
        setView((current) => zoomAt(current, centre, factor));
      }
      state.pinch = distance;
      return;
    }
    if (state.moved < DRAG_THRESHOLD || state.last === null) return;
    // Capture only once it is a drag, so a plain click still reaches the box under it.
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    const point = toDrawing(event.clientX, event.clientY);
    const last = state.last;
    state.last = point;
    setView((current) => ({
      ...current,
      x: current.x + point.x - last.x,
      y: current.y + point.y - last.y,
    }));
  };
  const onPointerEnd = (event: PointerEvent<SVGSVGElement>) => {
    const state = gesture.current;
    state.pointers.delete(event.pointerId);
    if (state.pointers.size < 2) state.pinch = null;
    if (state.moved >= DRAG_THRESHOLD) state.dragged = true;
  };
  const select = (id: string | null) => {
    if (gesture.current.dragged) return;
    props.onSelect(id);
  };
  const activate = (event: KeyboardEvent, id: string) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    props.onSelect(id);
  };
  const centre = { x: layout.width / 2, y: layout.height / 2 };
  const interactive = (id: string, label: string) => ({
    "data-onto-id": id,
    role: "button",
    tabIndex: 0,
    "aria-label": label,
    "aria-pressed": id === selectedId,
    onClick: () => select(id),
    onKeyDown: (event: KeyboardEvent) => activate(event, id),
    onMouseEnter: () => props.onHover(id),
    onMouseLeave: () => props.onHover(null),
    onFocus: () => props.onHover(id),
    onBlur: () => props.onHover(null),
  });
  const labelOf = (id: string) => layout.boxes.find((box) => box.id === id)?.label ?? id;

  return (
    <div className="relative size-full min-h-64">
      <div className="absolute top-2 right-2 z-10 flex gap-1">
        <ZoomButton label="Zoom in" onClick={() => setView((v) => zoomAt(v, centre, 1.25))}>
          <PlusIcon />
        </ZoomButton>
        <ZoomButton label="Zoom out" onClick={() => setView((v) => zoomAt(v, centre, 0.8))}>
          <MinusIcon />
        </ZoomButton>
        <ZoomButton label="Fit to view" onClick={() => setView(PAN_ZOOM_IDENTITY)}>
          <ScanIcon />
        </ZoomButton>
      </div>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        preserveAspectRatio="xMidYMid meet"
        role="group"
        aria-label="Ontology"
        className="block size-full cursor-grab touch-none select-none active:cursor-grabbing"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onClick={(event) => {
          if (event.target === event.currentTarget) select(null);
        }}
      >
        <defs>
          {(["base", "hot"] as const).map((tone) => (
            <marker
              key={tone}
              id={`${markerId}-${tone}`}
              viewBox="0 0 10 10"
              refX={9}
              refY={5}
              markerWidth={7}
              markerHeight={7}
              orient="auto"
            >
              <path
                d="M0,0 L10,5 L0,10 z"
                className={tone === "hot" ? "fill-primary" : "fill-muted-foreground"}
              />
            </marker>
          ))}
        </defs>
        <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
          {layout.arrows.map((arrow) => {
            const hot = focus?.arrows.has(arrow.id) ?? false;
            const label = arrow.functional ? `${arrow.label} (one)` : arrow.label;
            return (
              <g
                key={arrow.id}
                {...interactive(
                  arrow.id,
                  `${labelOf(arrow.from)} ${arrow.label} ${labelOf(arrow.to)}, ${arrow.id}`,
                )}
                className={cn(
                  "cursor-pointer outline-none transition-opacity duration-150",
                  focus && !hot && "opacity-25",
                )}
              >
                {/* A wide transparent stroke makes the thin arrow easy to hit. */}
                <path d={arrow.path} fill="none" strokeWidth={10} className="stroke-transparent" />
                <path
                  d={arrow.path}
                  fill="none"
                  markerEnd={`url(#${markerId}-${hot ? "hot" : "base"})`}
                  className={cn(
                    hot || arrow.id === selectedId
                      ? "stroke-primary stroke-2"
                      : "stroke-muted-foreground stroke-1",
                  )}
                />
                <ArrowLabel
                  at={arrow.labelAt}
                  anchor={arrow.labelAt.anchor}
                  text={label}
                  hot={hot}
                />
              </g>
            );
          })}
          {layout.attachments.map((attachment) => {
            const hot = focus?.attachments.has(attachment.id) ?? false;
            const decision = index.byId.get(attachment.id);
            return (
              <g
                key={`of:${attachment.id}`}
                className={cn("transition-opacity duration-150", focus && !hot && "opacity-25")}
              >
                <path
                  d={attachment.path}
                  fill="none"
                  className={cn(
                    "[stroke-dasharray:2_3]",
                    decision ? levelStroke(index.levels, decision.level) : "stroke-border",
                    hot ? "stroke-2" : "stroke-1",
                  )}
                />
                <ArrowLabel
                  at={{ x: attachment.labelAt.x + 6, y: attachment.labelAt.y }}
                  anchor="start"
                  text="has property"
                  hot={hot}
                />
              </g>
            );
          })}
          {layout.boxes.map((box) => {
            const decision = index.byId.get(box.id);
            const selected = box.id === selectedId;
            const lit = focus?.boxes.has(box.id) ?? true;
            const unsure = !box.stands || box.detached;
            return (
              <g
                key={box.id}
                {...interactive(box.id, `${box.label}, ${box.id}`)}
                transform={`translate(${box.x - box.width / 2},${box.y - box.height / 2})`}
                className={cn(
                  "group cursor-pointer outline-none transition-opacity duration-150",
                  !lit && "opacity-30",
                )}
              >
                <title>
                  {decision?.wording ?? box.label}
                  {box.detached ? " (what it is a property of is not in the ontology)" : ""}
                </title>
                <rect
                  width={box.width}
                  height={box.height}
                  rx={box.role === "property" ? box.height / 2 : 6}
                  className={cn(
                    "fill-background group-hover:fill-accent group-focus-visible:stroke-ring",
                    selected
                      ? "stroke-primary stroke-2"
                      : box.role === "property" && decision
                        ? cn(levelStroke(index.levels, decision.level), "stroke-1")
                        : box.hub
                          ? "stroke-foreground/40 stroke-2"
                          : "stroke-border stroke-1",
                    unsure && "[stroke-dasharray:4_3]",
                  )}
                />
                <text
                  x={box.width / 2}
                  y={box.height / 2 + 4.5}
                  textAnchor="middle"
                  className={cn(
                    "fill-foreground",
                    box.hub ? "text-sm" : "text-xs",
                    box.role === "property" ? "font-medium" : "font-semibold",
                  )}
                >
                  {box.label}
                </text>
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}
