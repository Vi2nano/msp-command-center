import { createFileRoute, Link, Outlet, useMatchRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader, StatusBadge } from "@/lib/ui-bits";
import { useRoles } from "./route";

export const Route = createFileRoute("/_authenticated/tickets")({
  head: () => ({ meta: [{ title: "Tickets — Meridian RMM" }, { name: "description", content: "Service desk tickets." }] }),
  component: Tickets,
});

export const STATUSES = ["new", "open", "pending", "resolved", "closed"];
export const PRIORITIES = ["low", "normal", "high", "urgent"];

function Tickets() {
  const match = useMatchRoute();
  if (match({ to: "/tickets/$id" })) return <Outlet />;
  return <TicketList />;
}

function TicketList() {
  const qc = useQueryClient();
  const { data: r } = useRoles();
  const [filter, setFilter] = useState("active");
  const { data } = useQuery({
    queryKey: ["tickets"],
    queryFn: async () => (await supabase.from("tickets").select("*, tenants(name)").order("created_at", { ascending: false })).data ?? [],
  });
  const { data: tenants } = useQuery({
    queryKey: ["tenants-min"],
    queryFn: async () => (await supabase.from("tenants").select("id, name").order("name")).data ?? [],
  });
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ tenant_id: "", subject: "", description: "", priority: "normal" });
  const create = useMutation({
    mutationFn: async () => {
      let tenant_id = f.tenant_id;
      if (!r?.isStaff) {
        const { data: u } = await supabase.auth.getUser();
        const { data: p } = await supabase.from("profiles").select("tenant_id").eq("id", u.user!.id).single();
        if (!p?.tenant_id) throw new Error("Your account isn't linked to a client yet.");
        tenant_id = p.tenant_id;
      }
      const { error } = await supabase.from("tickets").insert({ ...f, tenant_id });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Ticket created"); setOpen(false); setF({ ...f, subject: "", description: "" }); qc.invalidateQueries({ queryKey: ["tickets"] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const rows = (data ?? []).filter((t) => filter === "all" || (filter === "active" ? !["resolved", "closed"].includes(t.status) : t.status === filter));

  return (
    <div>
      <PageHeader title="Tickets" sub="Service desk">
        <Select value={filter} onValueChange={setFilter}>
          <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="all">All</SelectItem>
            {STATUSES.map((s) => <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>)}
          </SelectContent>
        </Select>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button>New ticket</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>New ticket</DialogTitle></DialogHeader>
            <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
              {r?.isStaff && (
                <div><Label>Client</Label>
                  <Select value={f.tenant_id} onValueChange={(v) => setF({ ...f, tenant_id: v })}>
                    <SelectTrigger><SelectValue placeholder="Choose client" /></SelectTrigger>
                    <SelectContent>{(tenants ?? []).map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              )}
              <div><Label>Subject</Label><Input required value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} /></div>
              <div><Label>Description</Label><Textarea rows={5} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></div>
              <div><Label>Priority</Label>
                <Select value={f.priority} onValueChange={(v) => setF({ ...f, priority: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{PRIORITIES.map((p) => <SelectItem key={p} value={p} className="capitalize">{p}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <Button type="submit" className="w-full" disabled={(r?.isStaff && !f.tenant_id) || create.isPending}>Create</Button>
            </form>
          </DialogContent>
        </Dialog>
      </PageHeader>
      <div className="rounded-lg border border-border bg-card">
        {rows.map((t) => (
          <Link key={t.id} to="/tickets/$id" params={{ id: t.id }} className="flex items-center gap-4 border-b border-border px-5 py-3 last:border-0 hover:bg-accent/40">
            <span className="w-14 font-mono text-xs text-muted-foreground">#{t.number}</span>
            <span className="flex-1 text-sm font-medium">{t.subject}</span>
            <span className="text-xs text-muted-foreground">{t.tenants?.name}</span>
            <span className="w-16 font-mono text-[10px] uppercase text-muted-foreground">{t.priority}</span>
            <StatusBadge value={t.status} />
          </Link>
        ))}
        {!rows.length && <p className="px-5 py-10 text-center text-sm text-muted-foreground">No tickets.</p>}
      </div>
    </div>
  );
}
