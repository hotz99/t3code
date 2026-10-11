import type { TmsDecision, TmsQuiverEdge, TmsQuiverNode, TmsTree } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  focusOf,
  kindCounts,
  layoutOntology,
  ONTOLOGY_METRICS,
  relationsOf,
  roleOf,
  unkindedOf,
  zoomAt,
} from "./ontologyLayout";

const node = (id: string, fields: Partial<TmsQuiverNode> = {}): TmsQuiverNode => ({
  id,
  label: id,
  kind: "thing",
  of: null,
  stands: true,
  ...fields,
});

const edge = (id: string, from: string, to: string, label = id): TmsQuiverEdge => ({
  id,
  from,
  to,
  label,
  functional: false,
});

/** The shape of the claude-setup ontology: Decision is the hub, with two loops and a property. */
const QUIVER: TmsTree["quiver"] = {
  nodes: [
    node("Code"),
    node("Developer"),
    node("Decision"),
    node("Stands", { kind: "property", of: "Decision" }),
    node("Workbench", { stands: false }),
  ],
  edges: [
    edge("Accepts", "Developer", "Decision"),
    edge("RestsOn", "Decision", "Decision", "Rests on"),
    edge("Uses", "Decision", "Decision"),
    edge("Realizes", "Code", "Decision"),
  ],
};

const boxOf = (layout: ReturnType<typeof layoutOntology>, id: string) => {
  const box = layout.boxes.find((candidate) => candidate.id === id);
  if (!box) throw new Error(`no box ${id}`);
  return box;
};

describe("layoutOntology", () => {
  it("centres the most connected thing and sets the other things to its left", () => {
    const layout = layoutOntology(QUIVER);
    const hub = boxOf(layout, "Decision");
    expect(hub.hub).toBe(true);
    expect(layout.boxes.filter((box) => box.hub)).toHaveLength(1);
    for (const id of ["Code", "Developer", "Workbench"]) {
      expect(boxOf(layout, id).x).toBeLessThan(hub.x);
    }
  });

  it("hangs a property below and right of the thing it is of, tied to it", () => {
    const layout = layoutOntology(QUIVER);
    const owner = boxOf(layout, "Decision");
    const property = boxOf(layout, "Stands");
    expect(property).toMatchObject({ role: "property", owner: "Decision", detached: false });
    expect(property.x).toBeGreaterThan(owner.x);
    expect(property.y).toBeGreaterThan(owner.y + owner.height / 2);
    expect(layout.attachments).toEqual([
      expect.objectContaining({ id: "Stands", owner: "Decision" }),
    ]);
  });

  it("puts a property whose owner is not drawn as a thing in a row under everything, untied", () => {
    const layout = layoutOntology({
      nodes: [
        ...QUIVER.nodes,
        node("Orphan", { kind: "property", of: "Missing" }),
        node("OfProperty", { kind: "property", of: "Stands" }),
      ],
      edges: QUIVER.edges,
    });
    const lowestTied = Math.max(
      ...layout.boxes.filter((box) => !box.detached).map((box) => box.y + box.height / 2),
    );
    for (const id of ["Orphan", "OfProperty"]) {
      const box = boxOf(layout, id);
      expect(box).toMatchObject({ role: "property", owner: null, detached: true });
      expect(box.y - box.height / 2).toBeGreaterThan(lowestTied);
    }
    expect(layout.attachments.map((attachment) => attachment.id)).toEqual(["Stands"]);
  });

  it("draws a relationship from a thing to itself as a loop, each loop in its own place", () => {
    const layout = layoutOntology(QUIVER);
    const loops = layout.arrows.filter((arrow) => arrow.loop);
    expect(loops.map((arrow) => arrow.id)).toEqual(["RestsOn", "Uses"]);
    expect(new Set(loops.map((arrow) => arrow.path)).size).toBe(2);
    expect(new Set(loops.map((arrow) => arrow.labelAt.y)).size).toBe(2);
    expect(layout.arrows.find((arrow) => arrow.id === "Accepts")?.loop).toBe(false);
  });

  it("drops a relationship whose ends the quiver does not hold", () => {
    const layout = layoutOntology({
      nodes: QUIVER.nodes,
      edges: [...QUIVER.edges, edge("Dangling", "Decision", "Nowhere")],
    });
    expect(layout.arrows.map((arrow) => arrow.id)).not.toContain("Dangling");
  });

  it("fits every box and loop label inside its bounds, and keeps many things apart", () => {
    const many: TmsTree["quiver"] = {
      nodes: [
        node("Hub"),
        ...Array.from({ length: 14 }, (_, index) => node(`Thing with a long name ${index}`)),
      ],
      edges: [
        edge("Self", "Hub", "Hub", "Refers to itself"),
        edge("To", "Thing with a long name 0", "Hub"),
      ],
    };
    for (const quiver of [QUIVER, many]) {
      const layout = layoutOntology(quiver);
      for (const box of layout.boxes) {
        expect(box.x - box.width / 2).toBeGreaterThanOrEqual(0);
        expect(box.y - box.height / 2).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width / 2).toBeLessThanOrEqual(layout.width);
        expect(box.y + box.height / 2).toBeLessThanOrEqual(layout.height);
      }
      for (const arrow of layout.arrows.filter((candidate) => candidate.loop)) {
        expect(
          arrow.labelAt.x + arrow.label.length * ONTOLOGY_METRICS.labelCharWidth,
        ).toBeLessThanOrEqual(layout.width);
      }
    }
    const things = layoutOntology(many).boxes.filter((box) => !box.hub);
    for (const [index, a] of things.entries()) {
      for (const b of things.slice(index + 1)) {
        const apart =
          Math.abs(a.x - b.x) >= (a.width + b.width) / 2 ||
          Math.abs(a.y - b.y) >= (a.height + b.height) / 2;
        expect(apart, `${a.id} overlaps ${b.id}`).toBe(true);
      }
    }
  });

  it("lays out an empty quiver as nothing", () => {
    expect(layoutOntology({ nodes: [], edges: [] })).toEqual({
      width: 0,
      height: 0,
      boxes: [],
      arrows: [],
      attachments: [],
    });
  });
});

describe("roles, focus and relations", () => {
  const layout = layoutOntology(QUIVER);

  it("names an entity's role by its place in the quiver", () => {
    expect(roleOf(layout, "Decision")).toBe("thing");
    expect(roleOf(layout, "Stands")).toBe("property");
    expect(roleOf(layout, "Uses")).toBe("relationship");
    expect(roleOf(layout, "tms:L1")).toBeNull();
  });

  it("keeps a relationship and its two ends lit", () => {
    const focus = focusOf(layout, "Accepts");
    expect([...(focus?.arrows ?? [])]).toEqual(["Accepts"]);
    expect([...(focus?.boxes ?? [])].toSorted()).toEqual(["Decision", "Developer"]);
    expect(focus?.attachments.size).toBe(0);
  });

  it("keeps a thing lit with its relationships, the things at their other ends and its properties", () => {
    const focus = focusOf(layout, "Developer");
    expect([...(focus?.boxes ?? [])].toSorted()).toEqual(["Decision", "Developer"]);
    const hub = focusOf(layout, "Decision");
    expect([...(hub?.arrows ?? [])].toSorted()).toEqual(["Accepts", "Realizes", "RestsOn", "Uses"]);
    expect([...(hub?.attachments ?? [])]).toEqual(["Stands"]);
    expect(hub?.boxes.has("Workbench")).toBe(false);
  });

  it("keeps a property lit with the thing it is of", () => {
    const focus = focusOf(layout, "Stands");
    expect([...(focus?.boxes ?? [])].toSorted()).toEqual(["Decision", "Stands"]);
  });

  it("dims nothing for an id the ontology does not draw", () => {
    expect(focusOf(layout, "tms:L1")).toBeNull();
    expect(focusOf(layout, null)).toBeNull();
  });

  it("lists a thing's relationships, then its properties", () => {
    expect(relationsOf(layout, "Decision")).toEqual([
      { from: "Developer", to: "Decision", label: "Accepts", by: "Accepts" },
      { from: "Decision", to: "Decision", label: "Rests on", by: "RestsOn" },
      { from: "Decision", to: "Decision", label: "Uses", by: "Uses" },
      { from: "Code", to: "Decision", label: "Realizes", by: "Realizes" },
      { from: "Decision", to: "Stands", label: null, by: "Stands" },
    ]);
    expect(relationsOf(layout, "Workbench")).toEqual([]);
  });
});

describe("zoomAt", () => {
  it("keeps the point under the pointer still while scaling", () => {
    const view = zoomAt({ x: 10, y: -20, k: 1.5 }, { x: 300, y: 200 }, 2);
    expect(view.k).toBe(3);
    // The drawing point under (300, 200) before and after is the same.
    expect((300 - view.x) / view.k).toBeCloseTo((300 - 10) / 1.5);
    expect((200 - view.y) / view.k).toBeCloseTo((200 + 20) / 1.5);
  });

  it("clamps the scale", () => {
    expect(zoomAt({ x: 0, y: 0, k: 1 }, { x: 0, y: 0 }, 100).k).toBe(4);
    expect(zoomAt({ x: 0, y: 0, k: 1 }, { x: 0, y: 0 }, 0.01).k).toBe(0.4);
  });
});

const decision = (id: string, level: string, kind: string | null): TmsDecision => ({
  id,
  level,
  wording: id,
  kind,
  cause: null,
  uses: [],
  stands: true,
  accepted: true,
  code: [],
  reworded: [],
  ended: null,
});

describe("kinds", () => {
  /** A vocabulary with names tms does not use today: nothing here may depend on them. */
  const tree: TmsTree = {
    vocabulary: {
      levels: [
        { level: "aim", letter: "A", accepted: true },
        { level: "notion", letter: "N", accepted: false },
      ],
      kinds: ["entity", "link", "trait"],
    },
    nodes: [
      decision("A1", "aim", null),
      decision("N1", "notion", "entity"),
      decision("N2", "notion", "link"),
      decision("N3", "notion", null),
      decision("N4", "notion", "entity"),
    ],
    ended: [],
    quiver: { nodes: [node("N1", { kind: "entity" })], edges: [edge("N2", "N1", "N1")] },
  };

  it("counts standing decisions of each declared kind, in the vocabulary's order", () => {
    expect(kindCounts(tree)).toEqual([
      { kind: "entity", count: 2 },
      { kind: "link", count: 1 },
      { kind: "trait", count: 0 },
    ]);
  });

  it("names the kindless decisions at a level whose decisions carry kinds", () => {
    expect(unkindedOf(tree, layoutOntology(tree.quiver))).toEqual(["N3"]);
  });
});
