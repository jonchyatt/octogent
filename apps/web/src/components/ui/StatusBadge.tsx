export type StatusBadgeTone = "live" | "idle" | "processing" | "queued" | "blocked" | "warning";

type StatusBadgeProps = {
  tone: StatusBadgeTone;
  label?: string;
  className?: string;
};

export const StatusBadge = ({ tone, label, className }: StatusBadgeProps) => {
  const classes = ["status-badge", "pill", tone, className]
    .filter((value) => Boolean(value))
    .join(" ");
  return <span className={classes}>{label ?? tone.toUpperCase()}</span>;
};
