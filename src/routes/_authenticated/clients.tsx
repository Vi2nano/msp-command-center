import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/lib/ui-bits";
import { useRoles } from "./route";

export const Route = createFileRoute("/_authenticated/clients")({
  head: () => ({ meta: [{ title: "Clients — Meridian RMM" }, { name: "description", content: "Manage client organizations." }] }),
  component: Clients,
});

function Clients() {
  const qc = useQueryClient();
  const { data: r } = useRoles();
  const { data } = useQuery({
    queryKey: ["tenants"],
    queryFn: async () => (await supabase.from("tenants").select("*, devices(count)").order("name")).data ?? [],
  });
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: "", industry: "", primary_contact: "", seats: 10, plan: "standard" });
  const create = useMutation({
    mutationFn: async () => {
      const slug = f.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      const { error } = await supabase.from("tenants").insert({ ...f, slug });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Client added"); setOpen(false); qc.invalidateQueries(); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div>
      <PageHeader title="Clients" sub="Tenant organizations you manage">
        {r?.isAdmin && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button>Add client</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>New client</DialogTitle></DialogHeader>
              <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
                <div><Label>Name</Label><Input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
                <div><Label>Industry</Label><Input value={f.industry} onChange={(e) => setF({ ...f, industry: e.target.value })} /></div>
                <div><Label>Primary contact</Label><Input value={f.primary_contact} onChange={(e) => setF({ ...f, primary_contact: e.target.value })} /></div>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>Seats</Label><Input type="number" min={0} value={f.seats} onChange={(e) => setF({ ...f, seats: +e.target.value })} /></div>
                  <div><Label>Plan</Label><Input value={f.plan} onChange={(e) => setF({ ...f, plan: e.target.value })} /></div>
                </div>
                <Button type="submit" className="w-full" disabled={create.isPending}>Create</Button>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </PageHeader>
      <div className="rounded-lg border border-border bg-card">
        <Table>
          <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Industry</TableHead><TableHead>Contact</TableHead><TableHead>Plan</TableHead><TableHead className="text-right">Seats</TableHead><TableHead className="text-right">Devices</TableHead></TableRow></TableHeader>
          <TableBody>
            {(data ?? []).map((t) => (
              <TableRow key={t.id}>
                <TableCell className="font-medium">{t.name}</TableCell>
                <TableCell>{t.industry}</TableCell>
                <TableCell>{t.primary_contact}</TableCell>
                <TableCell className="font-mono text-xs uppercase">{t.plan}</TableCell>
                <TableCell className="text-right font-mono">{t.seats}</TableCell>
                <TableCell className="text-right font-mono">{(t.devices as unknown as { count: number }[])?.[0]?.count ?? 0}</TableCell>
              </TableRow>
            ))}
            {!data?.length && <TableRow><TableCell colSpan={6} className="py-8 text-center text-muted-foreground">No clients yet.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
