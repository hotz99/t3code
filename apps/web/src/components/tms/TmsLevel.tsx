import type { TmsDecision } from "@t3tools/contracts";

import { Badge } from "~/components/ui/badge";
import { cn } from "~/lib/utils";

import { levelOf, statusOf, type TmsLevels } from "./causalTree";

/** Colours by place in the vocabulary, goal first; a deeper level reuses them in turn. */
const BACKGROUNDS = [
  "bg-amber-600 dark:bg-amber-400",
  "bg-sky-600 dark:bg-sky-400",
  "bg-violet-600 dark:bg-violet-400",
  "bg-emerald-600 dark:bg-emerald-400",
] as const;

const FILLS = [
  "fill-amber-600 dark:fill-amber-400",
  "fill-sky-600 dark:fill-sky-400",
  "fill-violet-600 dark:fill-violet-400",
  "fill-emerald-600 dark:fill-emerald-400",
] as const;

export const levelFill = (levels: TmsLevels, level: string) =>
  FILLS[levelOf(levels, level).rank % FILLS.length];

/** The id without its project prefix (`tms:R1` → `R1`). */
export const shortIdOf = (id: string) => id.slice(id.indexOf(":") + 1);

export function LevelChip({
  level,
  levels,
  className,
}: {
  level: string;
  levels: TmsLevels;
  className?: string;
}) {
  const info = levelOf(levels, level);
  return (
    <span
      aria-label={level}
      className={cn(
        "inline-flex h-4 w-4.5 shrink-0 items-center justify-center rounded-sm font-mono text-3xs font-semibold text-background",
        BACKGROUNDS[info.rank % BACKGROUNDS.length],
        className,
      )}
    >
      {info.letter}
    </span>
  );
}

export function StatusBadge({ decision, levels }: { decision: TmsDecision; levels: TmsLevels }) {
  const status = statusOf(decision, levels);
  const label =
    decision.ended === null ? status.label : decision.ended.by === null ? "withdrawn" : "replaced";
  return (
    <Badge size="sm" variant={status.tone}>
      {label}
    </Badge>
  );
}
