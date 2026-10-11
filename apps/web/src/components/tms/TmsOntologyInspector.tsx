import type { CausalIndex } from "./causalTree";
import { relationsOf, type OntologyLayout } from "./ontologyLayout";
import { DecisionRef, Section } from "./TmsInspector";

/** The relations an ontology entity takes part in or states, each naming the decision behind it. */
export function TmsOntologyRelations(props: {
  index: CausalIndex;
  layout: OntologyLayout;
  id: string;
  onGo: (id: string) => void;
  onHover: (id: string | null) => void;
}) {
  const relations = relationsOf(props.layout, props.id);
  if (relations.length === 0) return null;
  const name = (id: string) => props.layout.boxes.find((box) => box.id === id)?.label ?? id;
  return (
    <div className="px-3 pb-3">
      <Section label="Relations">
        <ul className="flex flex-col gap-1">
          {relations.map((relation) => (
            <li
              key={`${relation.by}:${relation.from}>${relation.to}`}
              className="flex items-center justify-between gap-2 text-xs"
            >
              <span className="min-w-0">
                {name(relation.from)}{" "}
                <i className="text-muted-foreground">{relation.label ?? "has property"}</i>{" "}
                {name(relation.to)}
              </span>
              <DecisionRef
                id={relation.by}
                known={props.index.byId.has(relation.by)}
                onGo={props.onGo}
                onHover={props.onHover}
              />
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}

/** What the ontology inspector says with nothing drawn selected, and what it cannot draw. */
export function TmsOntologyEmpty(props: {
  unkinded: ReadonlyArray<string>;
  index: CausalIndex;
  onGo: (id: string) => void;
  onHover: (id: string | null) => void;
}) {
  return (
    <div className="flex flex-col gap-3 p-3">
      <p className="text-muted-foreground text-xs">Select a thing, property or relationship.</p>
      {props.unkinded.length > 0 ? (
        <Section label={`${props.unkinded.length} without a kind, not drawn`}>
          <div className="flex flex-wrap gap-1">
            {props.unkinded.map((id) => (
              <DecisionRef
                key={id}
                id={id}
                known={props.index.byId.has(id)}
                onGo={props.onGo}
                onHover={props.onHover}
              />
            ))}
          </div>
        </Section>
      ) : null}
    </div>
  );
}
