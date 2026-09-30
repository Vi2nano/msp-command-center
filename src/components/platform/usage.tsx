export function UsageVsContract({
  actual,
  contracted,
}: {
  actual: number | undefined;
  contracted: number;
}) {
  if (actual === undefined)
    return <span className="font-mono text-muted-foreground">— / {contracted}</span>;
  const over = actual > contracted;
  return (
    <span
      className={`font-mono ${over ? "text-destructive" : ""}`}
      title={over ? "Usage exceeds contract" : undefined}
    >
      {actual} / {contracted}
    </span>
  );
}
