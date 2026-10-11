/**
 * Derivation and layout for a TMS tree of causes, free of React so the ontology and workflow
 * views can share it. Every decision has at most one cause; a decision whose cause ended (or is
 * missing) is still live and shows as a root until it is moved.
 */
import type { TmsDecision, TmsTree } from "@t3tools/contracts";

export type TmsStatusLabel = "ended" | "awaits acceptance" | "unsupported" | "accepted" | "stands";

export interface TmsStatus {
  readonly label: TmsStatusLabel;
  readonly tone: "success" | "warning" | "error";
}

/** A level as the snapshot's vocabulary declares it, with its place from goal (0) down. */
export interface TmsLevelInfo {
  readonly rank: number;
  readonly letter: string;
  readonly accepted: boolean;
}

export type TmsLevels = ReadonlyMap<string, TmsLevelInfo>;

export const levelsOf = (tree: TmsTree): TmsLevels =>
  new Map(
    tree.vocabulary.levels.map((level, rank) => [
      level.level,
      { rank, letter: level.letter, accepted: level.accepted },
    ]),
  );

/** Every level a snapshot uses is declared (the server refuses one that is not). */
export const levelOf = (levels: TmsLevels, level: string): TmsLevelInfo =>
  levels.get(level) ?? { rank: levels.size, letter: "?", accepted: false };

export function statusOf(decision: TmsDecision, levels: TmsLevels): TmsStatus {
  const accepted = levelOf(levels, decision.level).accepted;
  if (decision.ended !== null) return { label: "ended", tone: "error" };
  if (accepted && !decision.accepted) {
    return { label: "awaits acceptance", tone: "warning" };
  }
  if (!decision.stands) return { label: "unsupported", tone: "error" };
  return { label: accepted ? "accepted" : "stands", tone: "success" };
}

export function endingOf(decision: TmsDecision): string | null {
  if (decision.ended === null) return null;
  return decision.ended.by === null
    ? `withdrawn: ${decision.ended.reason}`
    : `replaced by ${decision.ended.by}: ${decision.ended.reason}`;
}

export interface CausalIndex {
  /** The snapshot's levels, goal first. */
  readonly levels: TmsLevels;
  /** Every decision, ended ones included. */
  readonly byId: ReadonlyMap<string, TmsDecision>;
  /** Standing decisions by the standing cause they rest on. */
  readonly children: ReadonlyMap<string, ReadonlyArray<TmsDecision>>;
  /** Ids of the standing decisions that use each decision. */
  readonly usedBy: ReadonlyMap<string, ReadonlyArray<string>>;
  /** Goals first, then decisions whose cause is not standing. */
  readonly roots: ReadonlyArray<TmsDecision>;
}

const EMPTY: ReadonlyArray<never> = [];

function push<V>(map: Map<string, V[]>, key: string, value: V) {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

export function indexTree(tree: TmsTree): CausalIndex {
  const byId = new Map<string, TmsDecision>();
  for (const decision of tree.ended) byId.set(decision.id, decision);
  for (const decision of tree.nodes) byId.set(decision.id, decision);
  const standing = new Set(tree.nodes.map((decision) => decision.id));
  const children = new Map<string, TmsDecision[]>();
  const usedBy = new Map<string, string[]>();
  const roots: TmsDecision[] = [];
  for (const decision of tree.nodes) {
    if (decision.cause !== null && standing.has(decision.cause)) {
      push(children, decision.cause, decision);
    } else {
      roots.push(decision);
    }
    for (const used of decision.uses) push(usedBy, used, decision.id);
  }
  const levels = levelsOf(tree);
  const goalsFirst = roots
    .filter((decision) => levelOf(levels, decision.level).rank === 0)
    .concat(roots.filter((decision) => levelOf(levels, decision.level).rank !== 0));
  return { levels, byId, children, usedBy, roots: goalsFirst };
}

export function childrenOf(index: CausalIndex, id: string): ReadonlyArray<TmsDecision> {
  return index.children.get(id) ?? EMPTY;
}

/** The causes above a decision, root first. */
export function chainOf(index: CausalIndex, id: string | null): ReadonlyArray<string> {
  const chain: string[] = [];
  const seen = new Set<string>();
  let cause = id === null ? null : (index.byId.get(id)?.cause ?? null);
  while (cause !== null && !seen.has(cause) && index.byId.has(cause)) {
    seen.add(cause);
    chain.unshift(cause);
    cause = index.byId.get(cause)?.cause ?? null;
  }
  return chain;
}

/** The standing decision an id now names: an ended one's replacement, followed to the end. */
export function currentIdOf(index: CausalIndex, id: string): string {
  const seen = new Set<string>();
  let current = id;
  for (
    let decision = index.byId.get(current);
    decision?.ended?.by && !seen.has(current);
    decision = index.byId.get(current)
  ) {
    seen.add(current);
    current = decision.ended.by;
  }
  return index.byId.has(current) ? current : id;
}

export interface OutlineRow {
  readonly decision: TmsDecision;
  readonly depth: number;
  readonly childCount: number;
  readonly open: boolean;
}

/** Visible rows of the outline, depth first, skipping the descendants of collapsed decisions. */
export function outlineRows(
  index: CausalIndex,
  collapsed: ReadonlySet<string>,
): ReadonlyArray<OutlineRow> {
  const rows: OutlineRow[] = [];
  const seen = new Set<string>();
  const walk = (decision: TmsDecision, depth: number) => {
    if (seen.has(decision.id)) return;
    seen.add(decision.id);
    const children = childrenOf(index, decision.id);
    const open = !collapsed.has(decision.id);
    rows.push({ decision, depth, childCount: children.length, open });
    if (open) for (const child of children) walk(child, depth + 1);
  };
  for (const root of index.roots) walk(root, 0);
  return rows;
}

export interface CausalMetrics {
  readonly row: number;
  readonly column: number;
  readonly boxWidth: number;
  readonly boxHeight: number;
  readonly pad: number;
  /** Extra rows between two root subtrees. */
  readonly rootGap: number;
}

export const CAUSAL_METRICS: CausalMetrics = {
  row: 26,
  column: 168,
  boxWidth: 132,
  boxHeight: 20,
  pad: 12,
  rootGap: 0.6,
};

export interface CausalBox {
  readonly id: string;
  /** Top-left corner. */
  readonly x: number;
  readonly y: number;
  /** Children hidden because the decision is collapsed. */
  readonly hidden: number;
}

export interface CausalEdge {
  readonly from: string;
  readonly to: string;
  /** SVG path from the cause's right edge to the decision's left edge. */
  readonly path: string;
}

export interface CausalLayout {
  readonly width: number;
  readonly height: number;
  readonly boxes: ReadonlyArray<CausalBox>;
  readonly edges: ReadonlyArray<CausalEdge>;
}

/**
 * A left-to-right tidy tree: depth sets the column, leaves take consecutive rows, and a cause
 * sits midway between its first and last visible child.
 */
export function layoutCausal(
  index: CausalIndex,
  collapsed: ReadonlySet<string>,
  metrics: CausalMetrics = CAUSAL_METRICS,
): CausalLayout {
  const { row, column, boxWidth, boxHeight, pad, rootGap } = metrics;
  const centers = new Map<string, { readonly x: number; readonly y: number }>();
  const boxes: CausalBox[] = [];
  const edges: CausalEdge[] = [];
  let leaves = 0;
  let maxDepth = 0;

  const place = (decision: TmsDecision, depth: number): number => {
    maxDepth = Math.max(maxDepth, depth);
    const all = childrenOf(index, decision.id);
    const shown = collapsed.has(decision.id)
      ? EMPTY
      : all.filter((child) => !centers.has(child.id) && child.id !== decision.id);
    // Mark before recursing so a malformed cycle cannot recurse forever.
    centers.set(decision.id, { x: pad + depth * column, y: 0 });
    let y: number;
    if (shown.length === 0) {
      y = pad + boxHeight / 2 + leaves * row;
      leaves += 1;
    } else {
      const ys = shown.map((child) => place(child, depth + 1));
      y = ((ys[0] ?? 0) + (ys[ys.length - 1] ?? 0)) / 2;
    }
    const x = pad + depth * column;
    centers.set(decision.id, { x, y });
    boxes.push({
      id: decision.id,
      x,
      y: y - boxHeight / 2,
      hidden: collapsed.has(decision.id) ? all.length : 0,
    });
    for (const child of shown) {
      const target = centers.get(child.id);
      if (!target) continue;
      const startX = x + boxWidth;
      const midX = (startX + target.x) / 2;
      edges.push({
        from: decision.id,
        to: child.id,
        path: `M${startX},${y} C${midX},${y} ${midX},${target.y} ${target.x},${target.y}`,
      });
    }
    return y;
  };

  for (const root of index.roots) {
    if (centers.has(root.id)) continue;
    place(root, 0);
    leaves += rootGap;
  }

  return {
    width: pad * 2 + maxDepth * column + boxWidth + 4,
    height: boxes.reduce((bottom, box) => Math.max(bottom, box.y + boxHeight), 0) + pad,
    boxes,
    edges,
  };
}
