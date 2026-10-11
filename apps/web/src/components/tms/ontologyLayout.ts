/**
 * Layout for a TMS ontology, free of React: the quiver `tms change show --json` emits drawn as
 * boxes for things, properties attached under the thing they are `of`, and relationships as
 * labelled arrows. Roles come from the quiver's shape (an edge, a node with an owner, any other
 * node), never from the names of tms's kinds.
 */
import type { TmsQuiverEdge, TmsQuiverNode, TmsTree } from "@t3tools/contracts";

/** What an ontology entity is to the drawing; also the type a comment on it carries. */
export type OntologyRole = "thing" | "property" | "relationship";

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface OntologyBox {
  readonly id: string;
  readonly label: string;
  readonly role: "thing" | "property";
  /** The thing a property is drawn under; null for things and for properties whose owner is not in the quiver. */
  readonly owner: string | null;
  /** A property naming an owner the quiver does not hold. */
  readonly detached: boolean;
  readonly hub: boolean;
  readonly stands: boolean;
  /** Centre. */
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface OntologyArrow {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly label: string;
  readonly functional: boolean;
  /** A relationship from a thing to itself, drawn as a loop on the thing's right edge. */
  readonly loop: boolean;
  readonly path: string;
  readonly labelAt: Point & { readonly anchor: "middle" | "start" };
}

/** The tie between a property and the thing it is of; keyed by the property's id. */
export interface OntologyAttachment {
  readonly id: string;
  readonly owner: string;
  readonly path: string;
  readonly labelAt: Point;
}

export interface OntologyLayout {
  readonly width: number;
  readonly height: number;
  readonly boxes: ReadonlyArray<OntologyBox>;
  readonly arrows: ReadonlyArray<OntologyArrow>;
  readonly attachments: ReadonlyArray<OntologyAttachment>;
}

export interface OntologyMetrics {
  readonly hub: { readonly width: number; readonly height: number };
  readonly thing: { readonly width: number; readonly height: number };
  readonly property: { readonly width: number; readonly height: number };
  /** Width per label character, so a long name widens its box. */
  readonly charWidth: number;
  readonly labelCharWidth: number;
  /** Smallest radius of the arc the other things sit on, and the arc length each one needs. */
  readonly radius: number;
  readonly spacing: number;
  readonly pad: number;
}

export const ONTOLOGY_METRICS: OntologyMetrics = {
  hub: { width: 190, height: 56 },
  thing: { width: 128, height: 38 },
  property: { width: 128, height: 32 },
  charWidth: 8,
  labelCharWidth: 6.4,
  radius: 250,
  spacing: 84,
  pad: 24,
};

const LOOP_REACH = 60;
const LOOP_STEP = 18;
const BORDER_GAP = 4;

/** Where the segment from a box's centre toward a point leaves the box, a little outside it. */
function borderPoint(box: OntologyBox, toward: Point): Point {
  const dx = toward.x - box.x;
  const dy = toward.y - box.y;
  if (dx === 0 && dy === 0) return { x: box.x, y: box.y };
  const k = Math.min(
    dx === 0 ? Infinity : Math.abs((box.width / 2 + BORDER_GAP) / dx),
    dy === 0 ? Infinity : Math.abs((box.height / 2 + BORDER_GAP) / dy),
  );
  return { x: box.x + dx * k, y: box.y + dy * k };
}

const round = (value: number) => Math.round(value * 10) / 10;

/**
 * The thing with the most arrows sits in the middle; the other things sit on an arc to its left,
 * most connected first; a property sits below and right of the thing it is of, and a property
 * whose owner is missing joins a row under everything else.
 */
export function layoutOntology(
  quiver: TmsTree["quiver"],
  metrics: OntologyMetrics = ONTOLOGY_METRICS,
): OntologyLayout {
  if (quiver.nodes.length === 0)
    return { width: 0, height: 0, boxes: [], arrows: [], attachments: [] };
  const ids = new Set(quiver.nodes.map((node) => node.id));
  const edges = quiver.edges.filter((edge) => ids.has(edge.from) && ids.has(edge.to));
  const degree = new Map<string, number>();
  for (const edge of edges) {
    degree.set(edge.from, (degree.get(edge.from) ?? 0) + 1);
    if (edge.to !== edge.from) degree.set(edge.to, (degree.get(edge.to) ?? 0) + 1);
  }
  const placed = new Map<string, OntologyBox>();
  const place = (
    node: TmsQuiverNode,
    size: { readonly width: number; readonly height: number },
    at: Point,
    role: Partial<Pick<OntologyBox, "role" | "owner" | "detached" | "hub">> = {},
  ) =>
    placed.set(node.id, {
      id: node.id,
      label: node.label,
      stands: node.stands,
      role: "thing",
      owner: null,
      detached: false,
      hub: false,
      ...role,
      x: round(at.x),
      y: round(at.y),
      width: Math.max(size.width, Math.ceil(node.label.length * metrics.charWidth + 28)),
      height: size.height,
    });

  const [hub, ...rest] = quiver.nodes
    .filter((node) => node.of === null)
    .toSorted((left, right) => (degree.get(right.id) ?? 0) - (degree.get(left.id) ?? 0));
  if (hub) place(hub, metrics.hub, { x: 0, y: 0 }, { hub: true });
  const radius = Math.max(metrics.radius, ((rest.length - 1) * metrics.spacing) / (Math.PI / 2));
  rest.forEach((node, index) => {
    const angle = Math.PI * (0.75 + 0.5 * (rest.length > 1 ? index / (rest.length - 1) : 0.5));
    place(node, metrics.thing, {
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius * 0.8,
    });
  });

  const slots = new Map<string, number>();
  const detached: TmsQuiverNode[] = [];
  for (const node of quiver.nodes) {
    if (node.of === null) continue;
    const owner = placed.get(node.of);
    if (owner === undefined || owner.role !== "thing") {
      detached.push(node);
      continue;
    }
    const slot = slots.get(owner.id) ?? 0;
    slots.set(owner.id, slot + 1);
    place(
      node,
      metrics.property,
      { x: owner.x + 170 + slot * 150, y: owner.y + owner.height / 2 + 110 },
      { role: "property", owner: owner.id },
    );
  }
  const bottom = Math.max(...[...placed.values()].map((box) => box.y + box.height / 2), 0);
  detached.forEach((node, index) => {
    place(
      node,
      metrics.property,
      { x: (index - (detached.length - 1) / 2) * 150, y: bottom + 90 },
      { role: "property", detached: true },
    );
  });

  // A thing's loops stack down its right edge; the slot is the loop's place in that stack.
  const loopSlot = new Map<string, number>();
  const loopCount = new Map<string, number>();
  for (const edge of edges) {
    if (edge.from !== edge.to) continue;
    const slot = loopCount.get(edge.from) ?? 0;
    loopSlot.set(edge.id, slot);
    loopCount.set(edge.from, slot + 1);
  }

  const unshifted = [...placed.values()];
  const loopReach = edges.flatMap((edge) => {
    const box = placed.get(edge.from);
    return edge.from === edge.to && box
      ? [box.x + box.width / 2 + LOOP_REACH + 10 + labelWidth(edge, metrics)]
      : [];
  });
  const left = Math.min(...unshifted.map((box) => box.x - box.width / 2));
  const top = Math.min(...unshifted.map((box) => box.y - box.height / 2));
  const right = Math.max(...unshifted.map((box) => box.x + box.width / 2), ...loopReach);
  const lowest = Math.max(...unshifted.map((box) => box.y + box.height / 2));
  const dx = metrics.pad - left;
  const dy = metrics.pad - top;
  const boxes = new Map(
    unshifted.map((box) => [box.id, { ...box, x: round(box.x + dx), y: round(box.y + dy) }]),
  );

  const arrows = edges.map((edge): OntologyArrow => {
    const from = boxes.get(edge.from)!;
    const to = boxes.get(edge.to)!;
    const base = {
      id: edge.id,
      from: edge.from,
      to: edge.to,
      label: edge.label,
      functional: edge.functional,
    };
    if (edge.from === edge.to) {
      const x = from.x + from.width / 2;
      const y = from.y - from.height / 2 + 12 + (loopSlot.get(edge.id) ?? 0) * LOOP_STEP;
      return {
        ...base,
        loop: true,
        path: `M${round(x)},${round(y - 4)} C${round(x + LOOP_REACH)},${round(y - 22)} ${round(x + LOOP_REACH)},${round(y + 18)} ${round(x + 6)},${round(y + 5)}`,
        labelAt: { x: round(x + LOOP_REACH + 10), y: round(y), anchor: "start" },
      };
    }
    const segment = segmentBetween(from, to);
    return {
      ...base,
      loop: false,
      path: segment.path,
      labelAt: { ...segment.mid, anchor: "middle" },
    };
  });

  const attachments = [...boxes.values()].flatMap((box): OntologyAttachment[] => {
    const owner = box.owner === null ? undefined : boxes.get(box.owner);
    if (owner === undefined) return [];
    const segment = segmentBetween(owner, box);
    return [{ id: box.id, owner: owner.id, path: segment.path, labelAt: segment.mid }];
  });

  return {
    width: Math.ceil(right - left + metrics.pad * 2),
    height: Math.ceil(lowest - top + metrics.pad * 2),
    boxes: [...boxes.values()],
    arrows,
    attachments,
  };
}

/** A straight segment between two boxes' borders, and its midpoint. */
function segmentBetween(from: OntologyBox, to: OntologyBox) {
  const start = borderPoint(from, to);
  const end = borderPoint(to, from);
  return {
    path: `M${round(start.x)},${round(start.y)} L${round(end.x)},${round(end.y)}`,
    mid: { x: round((start.x + end.x) / 2), y: round((start.y + end.y) / 2) },
  };
}

const labelWidth = (edge: TmsQuiverEdge, metrics: OntologyMetrics) =>
  (edge.label.length + (edge.functional ? 6 : 0)) * metrics.labelCharWidth;

/** The role an id has in the drawing, or null when the ontology does not draw it. */
export function roleOf(layout: OntologyLayout, id: string): OntologyRole | null {
  if (layout.arrows.some((arrow) => arrow.id === id)) return "relationship";
  return layout.boxes.find((box) => box.id === id)?.role ?? null;
}

export interface OntologyFocus {
  readonly boxes: ReadonlySet<string>;
  readonly arrows: ReadonlySet<string>;
  readonly attachments: ReadonlySet<string>;
}

/**
 * What stays lit while an entity is focused: the entity, every relationship it is an end of,
 * and the things at the other end; a property with the thing it is of. Null when the ontology
 * does not draw the id, so nothing dims.
 */
export function focusOf(layout: OntologyLayout, id: string | null): OntologyFocus | null {
  if (id === null || roleOf(layout, id) === null) return null;
  const boxes = new Set<string>();
  const arrows = new Set<string>();
  const attachments = new Set<string>();
  if (layout.boxes.some((box) => box.id === id)) boxes.add(id);
  for (const arrow of layout.arrows) {
    if (arrow.id !== id && arrow.from !== id && arrow.to !== id) continue;
    arrows.add(arrow.id);
    boxes.add(arrow.from);
    boxes.add(arrow.to);
  }
  for (const attachment of layout.attachments) {
    if (attachment.id !== id && attachment.owner !== id) continue;
    attachments.add(attachment.id);
    boxes.add(attachment.id);
    boxes.add(attachment.owner);
  }
  return { boxes, arrows, attachments };
}

export interface OntologyRelation {
  readonly from: string;
  readonly to: string;
  /** The relationship's name; null for a property's tie to the thing it is of. */
  readonly label: string | null;
  /** The decision that states it: the relationship, or the property. */
  readonly by: string;
}

/** Every relation an entity takes part in or states, relationships first. */
export function relationsOf(layout: OntologyLayout, id: string): ReadonlyArray<OntologyRelation> {
  return [
    ...layout.arrows
      .filter((arrow) => arrow.id === id || arrow.from === id || arrow.to === id)
      .map((arrow) => ({ from: arrow.from, to: arrow.to, label: arrow.label, by: arrow.id })),
    ...layout.attachments
      .filter((attachment) => attachment.id === id || attachment.owner === id)
      .map((attachment) => ({
        from: attachment.owner,
        to: attachment.id,
        label: null,
        by: attachment.id,
      })),
  ];
}

export interface PanZoom {
  readonly x: number;
  readonly y: number;
  readonly k: number;
}

export const PAN_ZOOM_IDENTITY: PanZoom = { x: 0, y: 0, k: 1 };
const MIN_ZOOM = 0.4;
const MAX_ZOOM = 4;

/** Scales by `factor` about a point in drawing coordinates, keeping that point still. */
export function zoomAt(view: PanZoom, at: Point, factor: number): PanZoom {
  const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, view.k * factor));
  const ratio = k / view.k;
  return { k, x: at.x - (at.x - view.x) * ratio, y: at.y - (at.y - view.y) * ratio };
}

/**
 * Standing decisions at a level whose decisions carry kinds that have no kind themselves, so
 * the ontology cannot draw them.
 */
export function unkindedOf(tree: TmsTree, layout: OntologyLayout): ReadonlyArray<string> {
  const kindedLevels = new Set(
    [...tree.nodes, ...tree.ended]
      .filter((decision) => decision.kind !== null)
      .map((decision) => decision.level),
  );
  const drawn = new Set([
    ...layout.boxes.map((box) => box.id),
    ...layout.arrows.map((arrow) => arrow.id),
  ]);
  return tree.nodes
    .filter(
      (decision) =>
        decision.kind === null && kindedLevels.has(decision.level) && !drawn.has(decision.id),
    )
    .map((decision) => decision.id);
}

/** How many standing decisions the snapshot has of each kind its vocabulary declares, in its order. */
export function kindCounts(tree: TmsTree): ReadonlyArray<{ kind: string; count: number }> {
  return tree.vocabulary.kinds.map((kind) => ({
    kind,
    count: tree.nodes.filter((decision) => decision.kind === kind).length,
  }));
}
