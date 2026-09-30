import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Meter, StatusBadge, effectiveStatus } from "@/lib/ui-bits";
import { useRoles } from "./route";

export const Route = createFileRoute("/_authenticated/devices/$id")({
  head: () => ({ meta: [{ title: "Device — Meridian RMM" }, { name: "description", content: "Device detail and remote scripts." }] }),
  component: DeviceDetail,
});

function DeviceDetail() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const { data: r } = useRoles();
  const { data: d } = useQuery({
    queryKey: ["device", id], refetchInterval: 15000,
    queryFn: async () => (await supabase.from("devices").select("*, tenants(name)").eq("id", id).single()).data,
  });
  const { data: scripts } = useQuery({
    queryKey: ["scripts"], enabled: !!r?.isStaff,
    queryFn: async () => (await supabase.from("scripts").select("*").order("name")).data ?? [],
  });
  const { data: runs } = useQuery({
    queryKey: ["device-runs", id], enabled: !!r?.isStaff, refetchInterval: 5000,
    queryFn: async () => (await supabase.from("script_runs").select("*").eq("device_id", id).order("created_at", { ascending: false }).limit(20)).data ?? [],
  });
  const [scriptId, setScriptId] = useState("adhoc");
  const [adhoc, setAdhoc] = useState("Get-ComputerInfo | Select-Object OsName, OsVersion, CsTotalPhysicalMemory");
  const run = useMutation({
    mutationFn: async () => {
      const s = scripts?.find((x) => x.id === scriptId);
      const { error } = await supabase.from("script_runs").insert({
        device_id: id, script_id: s?.id ?? null, script_name: s?.name ?? "Ad-hoc command", body: s?.body ?? adhoc,
      });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Queued — runs on next check-in (≤1 min)"); qc.invalidateQueries({ queryKey: ["device-runs", id] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const [openRun, setOpenRun] = useState<string | null>(null);

  if (!d) return <p className="text-muted-foreground">Loading…</p>;
  const up = d.uptime_seconds ? `${Math.floor(d.uptime_seconds / 86400)}d ${Math.floor((d.uptime_seconds % 86400) / 3600)}h` : "—";

  return (
    <div>
      <Link to="/devices" className="text-sm text-muted-foreground hover:text-foreground">← Devices</Link>
      <div className="mt-2 flex items-center gap-3">
        <h1 className="font-mono text-2xl font-semibold">{d.hostname}</h1>
        <StatusBadge value={effectiveStatus(d)} />
      </div>
      <p className="text-sm text-muted-foreground">{d.tenants?.name} · {d.os} · {d.ip_address} · {d.source === "agent" ? `agent ${d.agent_version ?? ""}` : "manual"}</p>
      <div className="mt-6 grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-6">
        {[["CPU", <Meter v={Number(d.cpu_percent)} />], ["Memory", <Meter v={Number(d.memory_percent)} />], ["Disk", <Meter v={Number(d.disk_percent)} />],
          ["Patches", <span className="font-mono">{d.patches_pending}</span>], ["Uptime", <span className="font-mono">{up}</span>],
          ["Last seen", <span className="text-xs">{d.last_seen ? new Date(d.last_seen).toLocaleString() : "never"}</span>]].map(([l, v], i) => (
          <div key={i} className="bg-card p-4"><p className="mb-2 text-xs uppercase text-muted-foreground">{l as string}</p>{v}</div>
        ))}
      </div>

      {r?.isStaff && (
        <div className="mt-8 grid gap-6 lg:grid-cols-2">
          <div className="rounded-lg border border-border bg-card p-5">
            <h2 className="font-display font-semibold">Run script</h2>
            {d.source !== "agent" && <p className="mt-1 text-xs text-warning">This device has no agent installed; scripts won't run.</p>}
            <Select value={scriptId} onValueChange={setScriptId}>
              <SelectTrigger className="mt-3"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="adhoc">Ad-hoc command</SelectItem>
                {(scripts ?? []).map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
            {scriptId === "adhoc" && <Textarea rows={6} className="mt-3 font-mono text-xs" value={adhoc} onChange={(e) => setAdhoc(e.target.value)} />}
            <Button className="mt-3" onClick={() => run.mutate()} disabled={run.isPending}>Queue run</Button>
          </div>
          <div className="rounded-lg border border-border bg-card">
            <h2 className="border-b border-border px-5 py-3 font-display font-semibold">Run history</h2>
            {(runs ?? []).map((x) => (
              <div key={x.id} className="border-b border-border last:border-0">
                <button className="flex w-full items-center gap-3 px-5 py-3 text-left hover:bg-accent/40" onClick={() => setOpenRun(openRun === x.id ? null : x.id)}>
                  <span className="flex-1 text-sm">{x.script_name}</span>
                  <span className="text-xs text-muted-foreground">{new Date(x.created_at).toLocaleTimeString()}</span>
                  <StatusBadge value={x.status} />
                </button>
                {openRun === x.id && <pre className="mx-5 mb-3 max-h-72 overflow-auto rounded bg-muted p-3 font-mono text-xs">{x.output ?? "No output yet."}</pre>}
              </div>
            ))}
            {!runs?.length && <p className="px-5 py-8 text-center text-sm text-muted-foreground">No runs yet.</p>}
          </div>
        </div>
      )}
    </div>
  );
}
