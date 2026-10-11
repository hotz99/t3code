import type { TmsDecision, TmsDecisionLevel } from "@t3tools/contracts";

import { Badge } from "~/components/ui/badge";
import { cn } from "~/lib/utils";

import { statusOf } from "./causalTree";

export const LEVELS: ReadonlyArray<TmsDecisionLevel> = ["goal", "requirement", "concept", "law"];

export const LEVEL_LETTER: Record<TmsDecisionLevel, string> = {
  goal: "G",
  requirement: "R",
  concept: "C",
  law: "L",
};

const LEVEL_BACKGROUND: Record<TmsDecisionLevel, string> = {
  goal: "bg-amber-600 dark:bg-amber-400",
  requirement: "bg-sky-600 dark:bg-sky-400",
  concept: "bg-violet-600 dark:bg-violet-400",
  law: "bg-emerald-600 dark:bg-emerald-400",
};

export const LEVEL_FILL: Record<TmsDecisionLevel, string> = {
  goal: "fill-amber-600 dark:fill-amber-400",
  requirement: "fill-sky-600 dark:fill-sky-400",
  concept: "fill-violet-600 dark:fill-violet-400",
  law: "fill-emerald-600 dark:fill-emerald-400",
};

/** The id without its project prefix (`tms:R1` → `R1`). */
export const shortIdOf = (id: string) => id.slice(id.indexOf(":") + 1);

export function LevelChip({ level, className }: { level: TmsDecisionLevel; className?: string }) {
  return (
    <span
      aria-label={level}
      className={cn(
        "inline-flex h-4 w-4.5 shrink-0 items-center justify-center rounded-sm font-mono text-3xs font-semibold text-background",
        LEVEL_BACKGROUND[level],
        className,
      )}
    >
      {LEVEL_LETTER[level]}
    </span>
  );
}

export function StatusBadge({ decision }: { decision: TmsDecision }) {
  const status = statusOf(decision);
  const label =
    decision.ended === null ? status.label : decision.ended.by === null ? "withdrawn" : "replaced";
  return (
    <Badge size="sm" variant={status.tone}>
      {label}
    </Badge>
  );
}
