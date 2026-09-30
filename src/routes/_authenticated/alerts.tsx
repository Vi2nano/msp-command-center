import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { PageHeader, StatusBadge } from "@/lib/ui-bits";
import { useRoles } from "./route";

export const Route = createFileRoute("/_authenticated/alerts")({
  head: () => ({ meta: [{ title: "Alerts — Meridian RMM" }, { name: "description", content: "Alert triage queue." }] }),
  component: Alerts,
});

function Alerts() {
  const qc = useQueryClient();
  const { data: r } = useRoles();
  const { data } = useQuery({
    queryKey: ["alerts"],
    queryFn: async () => (await supabase.from("alerts").select("*, tenants(name), devices(hostname)").order("created_at", { ascending: false })).data ?? [],
  });
  const setState = useMutation({
    mutationFn: async ({ id, state }: { id: string; state: "acknowledged" | "resolved" }) => {
      const { error } = await supabase.from("alerts").update({ state }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries(),
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div>
      <PageHeader title="Alerts" sub="Triage queue across all clients" />
      <div className="rounded-lg border border-border bg-card">
        {(data ?? []).map((a) => (
          <div key={a.id} className="flex items-center gap-4 border-b border-border px-5 py-4 last:border-0">
            <StatusBadge value={a.severity} />
            <div className="flex-1">
              <p className="text-sm font-medium">{a.title}</p>
              <p className="text-xs text-muted-foreground">
                {a.tenants?.name}{a.devices?.hostname ? ` · ${a.devices.hostname}` : ""} · {new Date(a.created_at).toLocaleString()}
              </p>
            </div>
            <StatusBadge value={a.state} />
            {r?.isStaff && a.state === "open" && (
              <Button size="sm" variant="outline" onClick={() => setState.mutate({ id: a.id, state: "acknowledged" })}>Acknowledge</Button>
            )}
            {r?.isStaff && a.state !== "resolved" && (
              <Button size="sm" onClick={() => setState.mutate({ id: a.id, state: "resolved" })}>Resolve</Button>
            )}
          </div>
        ))}
        {!data?.length && <p className="px-5 py-10 text-center text-sm text-muted-foreground">No alerts.</p>}
      </div>
    </div>
  );
}
