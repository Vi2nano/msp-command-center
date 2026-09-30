import { Badge } from "@/components/ui/badge";

export function PageHeader({ title, sub, children }: { title: string; sub?: string; children?: React.ReactNode }) {
  return (
    <div className="mb-6 flex items-end justify-between gap-4">
      <div>
        <h1 className="font-display text-2xl font-semibold">{title}</h1>
        {sub && <p className="text-sm text-muted-foreground">{sub}</p>}
      </div>
      <div className="flex gap-2">{children}</div>
    </div>
  );
}

const tone: Record<string, string> = {
  online: "bg-success text-success-foreground",
  warning: "bg-warning text-warning-foreground",
  offline: "bg-muted text-muted-foreground",
  critical: "bg-destructive text-destructive-foreground",
  info: "bg-secondary text-secondary-foreground",
  open: "bg-destructive text-destructive-foreground",
  acknowledged: "bg-warning text-warning-foreground",
  resolved: "bg-success text-success-foreground",
  new: "bg-primary text-primary-foreground",
  pending: "bg-warning text-warning-foreground",
  closed: "bg-muted text-muted-foreground",
  queued: "bg-secondary text-secondary-foreground",
  running: "bg-primary text-primary-foreground",
  completed: "bg-success text-success-foreground",
  failed: "bg-destructive text-destructive-foreground",
  draft: "bg-muted text-muted-foreground",
  sent: "bg-primary text-primary-foreground",
  paid: "bg-success text-success-foreground",
  void: "bg-muted text-muted-foreground",
};

/** Agent devices that haven't checked in for 5 minutes are shown offline. */
export function effectiveStatus(d: { status: string; source: string; last_seen: string | null }) {
  if (d.source === "agent" && (!d.last_seen || Date.now() - new Date(d.last_seen).getTime() > 5 * 60_000)) return "offline";
  return d.status;
}

export function StatusBadge({ value }: { value: string }) {
  return <Badge className={`font-mono text-[10px] uppercase ${tone[value] ?? ""}`}>{value}</Badge>;
}

export function Meter({ v }: { v: number }) {
  const c = v > 90 ? "bg-destructive" : v > 75 ? "bg-warning" : "bg-primary";
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 overflow-hidden rounded bg-muted"><div className={`h-full ${c}`} style={{ width: `${Math.min(100, v)}%` }} /></div>
      <span className="font-mono text-xs text-muted-foreground">{Math.round(v)}%</span>
    </div>
  );
}
