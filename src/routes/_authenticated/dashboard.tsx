import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, StatusBadge } from "@/lib/ui-bits";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Overview — Meridian RMM" }, { name: "description", content: "Fleet health overview." }] }),
  component: Dashboard,
});

function Dashboard() {
  const { data } = useQuery({
    queryKey: ["overview"],
    queryFn: async () => {
      const [t, d, a] = await Promise.all([
        supabase.from("tenants").select("id, seats"),
        supabase.from("devices").select("id, status, patches_pending"),
        supabase.from("alerts").select("id, title, severity, state, created_at, tenants(name)").neq("state", "resolved").order("created_at", { ascending: false }).limit(8),
      ]);
      return { tenants: t.data ?? [], devices: d.data ?? [], alerts: a.data ?? [] };
    },
  });
  const devices = data?.devices ?? [];
  const stats = [
    { l: "Clients", v: data?.tenants.length ?? 0 },
    { l: "Seats", v: (data?.tenants ?? []).reduce((s, t) => s + t.seats, 0) },
    { l: "Devices online", v: `${devices.filter((d) => d.status === "online").length}/${devices.length}` },
    { l: "Open alerts", v: data?.alerts.length ?? 0 },
    { l: "Patches pending", v: devices.reduce((s, d) => s + d.patches_pending, 0) },
  ];
  return (
    <div>
      <PageHeader title="Overview" sub="Fleet health across all tenants" />
      <div className="grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-5">
        {stats.map((s) => (
          <div key={s.l} className="bg-card p-5">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">{s.l}</p>
            <p className="mt-2 font-display text-3xl font-semibold">{s.v}</p>
          </div>
        ))}
      </div>
      <div className="mt-8 rounded-lg border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="font-display font-semibold">Active alerts</h2>
          <Link to="/alerts" className="text-sm text-primary">View all</Link>
        </div>
        {data?.alerts.length ? data.alerts.map((a) => (
          <div key={a.id} className="flex items-center gap-3 border-b border-border px-5 py-3 last:border-0">
            <StatusBadge value={a.severity} />
            <span className="flex-1 text-sm">{a.title}</span>
            <span className="text-xs text-muted-foreground">{a.tenants?.name}</span>
            <StatusBadge value={a.state} />
          </div>
        )) : <p className="px-5 py-8 text-center text-sm text-muted-foreground">No active alerts. All quiet.</p>}
      </div>
    </div>
  );
}
