import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Meter, PageHeader, StatusBadge } from "@/lib/ui-bits";
import { useRoles } from "./route";

export const Route = createFileRoute("/_authenticated/devices")({
  head: () => ({ meta: [{ title: "Devices — Meridian RMM" }, { name: "description", content: "Monitored endpoints." }] }),
  component: Devices,
});

function Devices() {
  const qc = useQueryClient();
  const { data: r } = useRoles();
  const [q, setQ] = useState("");
  const { data } = useQuery({
    queryKey: ["devices"],
    queryFn: async () => (await supabase.from("devices").select("*, tenants(name)").order("hostname")).data ?? [],
  });
  const { data: tenants } = useQuery({
    queryKey: ["tenants-min"],
    queryFn: async () => (await supabase.from("tenants").select("id, name").order("name")).data ?? [],
  });
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ tenant_id: "", hostname: "", os: "Windows 11", device_type: "workstation", ip_address: "" });
  const create = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("devices").insert(f);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Device added"); setOpen(false); qc.invalidateQueries(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const rows = (data ?? []).filter((d) => d.hostname.toLowerCase().includes(q.toLowerCase()));

  return (
    <div>
      <PageHeader title="Devices" sub={`${data?.length ?? 0} monitored endpoints`}>
        <Input placeholder="Search hostname…" className="w-56" value={q} onChange={(e) => setQ(e.target.value)} />
        {r?.isStaff && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button>Add device</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>New device</DialogTitle></DialogHeader>
              <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
                <div><Label>Client</Label>
                  <Select value={f.tenant_id} onValueChange={(v) => setF({ ...f, tenant_id: v })}>
                    <SelectTrigger><SelectValue placeholder="Choose client" /></SelectTrigger>
                    <SelectContent>{(tenants ?? []).map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div><Label>Hostname</Label><Input required value={f.hostname} onChange={(e) => setF({ ...f, hostname: e.target.value })} /></div>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>OS</Label><Input value={f.os} onChange={(e) => setF({ ...f, os: e.target.value })} /></div>
                  <div><Label>IP address</Label><Input value={f.ip_address} onChange={(e) => setF({ ...f, ip_address: e.target.value })} /></div>
                </div>
                <Button type="submit" className="w-full" disabled={!f.tenant_id || create.isPending}>Create</Button>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </PageHeader>
      <div className="rounded-lg border border-border bg-card">
        <Table>
          <TableHeader><TableRow><TableHead>Hostname</TableHead><TableHead>Client</TableHead><TableHead>Status</TableHead><TableHead>CPU</TableHead><TableHead>Memory</TableHead><TableHead>Disk</TableHead><TableHead className="text-right">Patches</TableHead></TableRow></TableHeader>
          <TableBody>
            {rows.map((d) => (
              <TableRow key={d.id}>
                <TableCell><div className="font-mono text-sm">{d.hostname}</div><div className="text-xs text-muted-foreground">{d.os} · {d.ip_address}</div></TableCell>
                <TableCell>{d.tenants?.name}</TableCell>
                <TableCell><StatusBadge value={d.status} /></TableCell>
                <TableCell><Meter v={Number(d.cpu_percent)} /></TableCell>
                <TableCell><Meter v={Number(d.memory_percent)} /></TableCell>
                <TableCell><Meter v={Number(d.disk_percent)} /></TableCell>
                <TableCell className="text-right font-mono">{d.patches_pending}</TableCell>
              </TableRow>
            ))}
            {!rows.length && <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">No devices.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
