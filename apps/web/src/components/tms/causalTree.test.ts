import type { TmsDecision, TmsTree } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  CAUSAL_METRICS,
  chainOf,
  currentIdOf,
  indexTree,
  layoutCausal,
  levelsOf,
  outlineRows,
  statusOf,
} from "./causalTree";

const decision = (
  id: string,
  level: TmsDecision["level"],
  fields: Partial<TmsDecision> = {},
): TmsDecision => ({
  id,
  level,
  wording: id,
  kind: null,
  cause: null,
  uses: [],
  stands: true,
  accepted: true,
  code: [],
  reworded: [],
  ended: null,
  ...fields,
});

/** What tms declares today; the panel reads levels only from here. */
const VOCABULARY: TmsTree["vocabulary"] = {
  levels: [
    { level: "goal", letter: "G", accepted: true },
    { level: "requirement", letter: "R", accepted: true },
    { level: "concept", letter: "C", accepted: false },
    { level: "law", letter: "L", accepted: false },
  ],
  kinds: ["thing", "relationship", "property"],
};

const tree = (
  nodes: ReadonlyArray<TmsDecision>,
  ended: ReadonlyArray<TmsDecision> = [],
): TmsTree => ({
  vocabulary: VOCABULARY,
  nodes,
  ended,
  quiver: { nodes: [], edges: [] },
});

// G1 ─ R1 ─ C1 ─ L1
//         └─ L2
// R9 rests on R0, which ended: it shows as a root after the goals.
const sample = tree(
  [
    decision("R9", "requirement", { cause: "R0" }),
    decision("G1", "goal"),
    decision("R1", "requirement", { cause: "G1" }),
    decision("C1", "concept", { cause: "R1" }),
    decision("L1", "law", { cause: "C1", uses: ["C1"] }),
    decision("L2", "law", { cause: "R1", uses: ["C1"] }),
  ],
  [decision("R0", "requirement", { ended: { by: "R1", reason: "restated" }, stands: false })],
);

describe("statusOf", () => {
  const levels = levelsOf(tree([]));

  it("names each standing state the way tms does", () => {
    expect(
      statusOf(decision("R", "requirement", { ended: { by: null, reason: "x" } }), levels),
    ).toEqual({ label: "ended", tone: "error" });
    expect(statusOf(decision("R", "requirement", { accepted: false }), levels).label).toBe(
      "awaits acceptance",
    );
    expect(statusOf(decision("C", "concept", { accepted: false }), levels).label).toBe("stands");
    expect(statusOf(decision("L", "law", { stands: false }), levels).label).toBe("unsupported");
    expect(statusOf(decision("G", "goal"), levels).label).toBe("accepted");
  });

  it("takes which levels the developer accepts, and their order, from the vocabulary alone", () => {
    const custom = levelsOf({
      ...tree([]),
      vocabulary: {
        levels: [
          { level: "mission", letter: "M", accepted: true },
          { level: "rule", letter: "U", accepted: false },
        ],
        kinds: [],
      },
    });

    expect(statusOf(decision("M1", "mission", { accepted: false }), custom).label).toBe(
      "awaits acceptance",
    );
    expect(statusOf(decision("U1", "rule", { accepted: false }), custom).label).toBe("stands");
    expect(custom.get("rule")).toEqual({ rank: 1, letter: "U", accepted: false });
  });
});

describe("indexTree", () => {
  it("puts goals first and keeps a decision whose cause ended as a root", () => {
    const index = indexTree(sample);

    expect(index.roots.map((root) => root.id)).toEqual(["G1", "R9"]);
    expect(index.usedBy.get("C1")).toEqual(["L1", "L2"]);
    expect(chainOf(index, "L1")).toEqual(["G1", "R1", "C1"]);
    expect(currentIdOf(index, "R0")).toBe("R1");
  });
});

describe("outlineRows", () => {
  it("walks depth first and hides what a collapsed decision rests over", () => {
    const index = indexTree(sample);

    expect(outlineRows(index, new Set()).map((row) => [row.decision.id, row.depth])).toEqual([
      ["G1", 0],
      ["R1", 1],
      ["C1", 2],
      ["L1", 3],
      ["L2", 2],
      ["R9", 0],
    ]);
    const collapsed = outlineRows(index, new Set(["R1"]));
    expect(collapsed.map((row) => row.decision.id)).toEqual(["G1", "R1", "R9"]);
    expect(collapsed[1]).toMatchObject({ childCount: 2, open: false });
  });
});

describe("layoutCausal", () => {
  const { row, column, boxHeight, pad } = CAUSAL_METRICS;
  const center = (layout: ReturnType<typeof layoutCausal>, id: string) => {
    const box = layout.boxes.find((entry) => entry.id === id);
    if (!box) throw new Error(`no box for ${id}`);
    return { x: box.x, y: box.y + boxHeight / 2, hidden: box.hidden };
  };

  it("sets columns by depth, leaves on consecutive rows and causes between their children", () => {
    const layout = layoutCausal(indexTree(sample), new Set());

    expect(center(layout, "L1")).toMatchObject({ x: pad + 3 * column, y: pad + boxHeight / 2 });
    expect(center(layout, "L2").y).toBe(center(layout, "L1").y + row);
    expect(center(layout, "R1").y).toBe((center(layout, "C1").y + center(layout, "L2").y) / 2);
    expect(center(layout, "R9").x).toBe(pad);
    expect(center(layout, "R9").y).toBeGreaterThan(center(layout, "L2").y + row);
    expect(layout.edges.map((edge) => `${edge.from}>${edge.to}`).toSorted()).toEqual([
      "C1>L1",
      "G1>R1",
      "R1>C1",
      "R1>L2",
    ]);
    for (const box of layout.boxes) {
      expect(box.y + boxHeight).toBeLessThanOrEqual(layout.height);
      expect(box.x + CAUSAL_METRICS.boxWidth).toBeLessThanOrEqual(layout.width);
    }
  });

  it("drops a collapsed decision's subtree and counts what it hides", () => {
    const layout = layoutCausal(indexTree(sample), new Set(["R1"]));

    expect(layout.boxes.map((box) => box.id).toSorted()).toEqual(["G1", "R1", "R9"]);
    expect(center(layout, "R1").hidden).toBe(2);
    expect(layout.edges.map((edge) => edge.to)).toEqual(["R1"]);
  });

  it("terminates on a malformed cycle", () => {
    const looped = tree([
      decision("G1", "goal"),
      decision("A", "requirement", { cause: "B" }),
      decision("B", "requirement", { cause: "A" }),
    ]);

    expect(layoutCausal(indexTree(looped), new Set()).boxes.map((box) => box.id)).toEqual(["G1"]);
  });
});
