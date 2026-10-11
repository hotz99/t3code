import type { ReactNode } from "react";

import { Badge } from "~/components/ui/badge";

import { currentIdOf, endingOf, type CausalIndex } from "./causalTree";
import { LevelChip, StatusBadge } from "./TmsLevel";

function Section(props: { label: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1">
      <h3 className="font-medium text-2xs text-muted-foreground uppercase tracking-wide">
        {props.label}
      </h3>
      {props.children}
    </section>
  );
}

/** A decision id that selects it; hovering it dims everything else in the tree. */
function DecisionRef(props: {
  id: string;
  known: boolean;
  onGo: (id: string) => void;
  onHover: (id: string | null) => void;
}) {
  if (!props.known) {
    return (
      <Badge variant="outline" size="sm">
        <span className="font-mono">{props.id}</span>
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      size="sm"
      render={
        <button
          type="button"
          onClick={() => props.onGo(props.id)}
          onMouseEnter={() => props.onHover(props.id)}
          onMouseLeave={() => props.onHover(null)}
          onFocus={() => props.onHover(props.id)}
          onBlur={() => props.onHover(null)}
        />
      }
    >
      <span className="font-mono">{props.id}</span>
    </Badge>
  );
}

/** Everything about one decision: what it says, how it stands, what it rests on and uses. */
export function TmsInspector(props: {
  index: CausalIndex;
  id: string | null;
  onGo: (id: string) => void;
  onHover: (id: string | null) => void;
}) {
  const decision = props.id === null ? undefined : props.index.byId.get(props.id);
  if (!decision) {
    return <p className="p-3 text-muted-foreground text-xs">Select a decision to inspect it.</p>;
  }
  const refs = (ids: ReadonlyArray<string>) => (
    <div className="flex flex-wrap gap-1">
      {ids.map((id) => (
        <DecisionRef
          key={id}
          id={id}
          known={props.index.byId.has(id)}
          onGo={props.onGo}
          onHover={props.onHover}
        />
      ))}
    </div>
  );
  const usedBy = props.index.usedBy.get(decision.id) ?? [];
  const ending = endingOf(decision);
  return (
    <div className="flex flex-col gap-3 p-3">
      <header className="flex flex-wrap items-center gap-2">
        <LevelChip level={decision.level} levels={props.index.levels} />
        <span className="font-mono text-sm">{decision.id}</span>
        <StatusBadge decision={decision} levels={props.index.levels} />
      </header>
      <p className="text-sm leading-relaxed">{decision.wording}</p>
      {decision.kind ? (
        <Section label="Kind">
          <p className="text-muted-foreground text-xs">{decision.kind}</p>
        </Section>
      ) : null}
      {decision.cause ? <Section label="Rests on">{refs([decision.cause])}</Section> : null}
      {ending ? (
        <Section label="How it ended">
          <p className="text-muted-foreground text-xs">{ending}</p>
          {decision.ended?.by ? refs([currentIdOf(props.index, decision.id)]) : null}
        </Section>
      ) : null}
      {decision.reworded.length > 0 ? (
        <Section label="Earlier wordings">
          {decision.reworded.map((earlier) => (
            <p key={earlier.wording} className="text-muted-foreground text-xs">
              “{earlier.wording}” · {earlier.reason}
            </p>
          ))}
        </Section>
      ) : null}
      {decision.uses.length > 0 ? <Section label="Uses">{refs(decision.uses)}</Section> : null}
      {usedBy.length > 0 ? (
        <Section label={`Used by ${usedBy.length}`}>{refs(usedBy)}</Section>
      ) : null}
      {decision.code.length > 0 ? (
        <Section label={`Realized by ${decision.code.length} symbols`}>
          <ul className="flex flex-col gap-0.5 font-mono text-2xs text-muted-foreground">
            {decision.code.map((symbol) => (
              <li key={symbol} className="break-all">
                {symbol}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
    </div>
  );
}
