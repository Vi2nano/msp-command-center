import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { PageHeader, StatusBadge } from "@/lib/ui-bits";

export const Route = createFileRoute("/_authenticated/scripts")({
  head: () => ({ meta: [{ title: "Scripts — Meridian RMM" }, { name: "description", content: "PowerShell script library and run history." }] }),
  component: Scripts,
});

function Scripts() {
  const qc = useQueryClient();
  const { data: scripts } = useQuery({
    queryKey: ["scripts"],
    queryFn: async () => (await supabase.from("scripts").select("*").order("name")).data ?? [],
  });
  const { data: runs } = useQuery({
    queryKey: ["script-runs"],
    refetchInterval: 10000,
    queryFn: async () => (await supabase.from("script_runs").select("*, devices(hostname)").order("created_at", { ascending: false }).limit(50)).data ?? [],
  });
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: "", description: "", body: "Get-Service | Where-Object Status -eq 'Stopped' | Select-Object -First 20" });
  const create = useMutation({
    mutationFn: async () => { const { error } = await supabase.from("scripts").insert(f); if (error) throw error; },
    onSuccess: () => { toast.success("Script saved"); setOpen(false); qc.invalidateQueries({ queryKey: ["scripts"] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const [viewing, setViewing] = useState<null | { script_name: string; output: string | null }>(null);

  return (
    <div>
      <PageHeader title="Scripts" sub="PowerShell library — run from a device page">
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button>New script</Button></DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader><DialogTitle>New script</DialogTitle></DialogHeader>
            <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
              <div><Label>Name</Label><Input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
              <div><Label>Description</Label><Input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></div>
              <div><Label>PowerShell</Label><Textarea rows={12} className="font-mono text-xs" value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} /></div>
              <Button type="submit" className="w-full" disabled={create.isPending}>Save</Button>
            </form>
          </DialogContent>
        </Dialog>
      </PageHeader>
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-lg border border-border bg-card">
          <h2 className="border-b border-border px-5 py-3 font-display font-semibold">Library</h2>
          {(scripts ?? []).map((s) => (
            <div key={s.id} className="border-b border-border px-5 py-3 last:border-0">
              <p className="text-sm font-medium">{s.name}</p>
              <p className="text-xs text-muted-foreground">{s.description}</p>
            </div>
          ))}
          {!scripts?.length && <p className="px-5 py-8 text-center text-sm text-muted-foreground">No scripts yet.</p>}
        </div>
        <div className="rounded-lg border border-border bg-card">
          <h2 className="border-b border-border px-5 py-3 font-display font-semibold">Recent runs</h2>
          {(runs ?? []).map((r) => (
            <button key={r.id} onClick={() => setViewing(r)} className="flex w-full items-center gap-3 border-b border-border px-5 py-3 text-left last:border-0 hover:bg-accent/40">
              <span className="flex-1 text-sm">{r.script_name}</span>
              <span className="font-mono text-xs text-muted-foreground">{r.devices?.hostname}</span>
              <StatusBadge value={r.status} />
            </button>
          ))}
          {!runs?.length && <p className="px-5 py-8 text-center text-sm text-muted-foreground">No runs yet.</p>}
        </div>
      </div>
      <Dialog open={!!viewing} onOpenChange={(o) => !o && setViewing(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader><DialogTitle>{viewing?.script_name}</DialogTitle></DialogHeader>
          <pre className="max-h-[60vh] overflow-auto rounded bg-muted p-3 font-mono text-xs">{viewing?.output ?? "No output yet."}</pre>
        </DialogContent>
      </Dialog>
    </div>
  );
}
