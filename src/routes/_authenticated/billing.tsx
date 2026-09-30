import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader, StatusBadge } from "@/lib/ui-bits";
import { useRoles } from "./route";

export const Route = createFileRoute("/_authenticated/billing")({
  head: () => ({ meta: [{ title: "Billing — Meridian RMM" }, { name: "description", content: "Per-seat client invoicing." }] }),
  component: Billing,
});

const money = (n: number) => n.toLocaleString(undefined, { style: "currency", currency: "USD" });

function Billing() {
  const qc = useQueryClient();
  const { data: r } = useRoles();
  const admin = !!r?.isAdmin;
  const { data: tenants } = useQuery({
    queryKey: ["tenants-billing"], enabled: admin,
    queryFn: async () => (await supabase.from("tenants").select("id, name, seats, price_per_seat, hourly_rate").order("name")).data ?? [],
  });
  const { data: invoices } = useQuery({
    queryKey: ["invoices"],
    queryFn: async () => (await supabase.from("invoices").select("*, tenants(name)").order("created_at", { ascending: false })).data ?? [],
  });

  const saveRate = useMutation({
    mutationFn: async (p: { id: string; price_per_seat?: number; hourly_rate?: number; seats?: number }) => {
      const { id, ...rest } = p;
      const { error } = await supabase.from("tenants").update(rest).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tenants-billing"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const now = new Date();
  const [period, setPeriod] = useState({
    start: new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10),
    end: new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10),
  });
  const generate = useMutation({
    mutationFn: async () => {
      let n = 0;
      for (const t of tenants ?? []) {
        const { data: entries } = await supabase.from("time_entries").select("id, minutes")
          .eq("tenant_id", t.id).eq("billable", true).is("invoice_id", null)
          .gte("work_date", period.start).lte("work_date", period.end);
        const hours = +(((entries ?? []).reduce((s, e) => s + e.minutes, 0)) / 60).toFixed(2);
        const total = +(t.seats * Number(t.price_per_seat) + hours * Number(t.hourly_rate)).toFixed(2);
        if (total <= 0) continue;
        const { data: inv, error } = await supabase.from("invoices").insert({
          tenant_id: t.id, period_start: period.start, period_end: period.end, seats: t.seats,
          price_per_seat: t.price_per_seat, hours, hourly_rate: t.hourly_rate, total,
        }).select("id").single();
        if (error) throw error;
        if (entries?.length) await supabase.from("time_entries").update({ invoice_id: inv.id }).in("id", entries.map((e) => e.id));
        n++;
      }
      return n;
    },
    onSuccess: (n) => { toast.success(`${n} draft invoice(s) created`); qc.invalidateQueries(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const setStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await supabase.from("invoices").update({ status }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["invoices"] }),
  });

  return (
    <div className="space-y-8">
      <PageHeader title="Billing" sub={admin ? "Per-seat pricing and client invoices" : "Your invoices"} />
      {admin && (
        <div className="rounded-lg border border-border bg-card">
          <h2 className="border-b border-border px-5 py-3 font-display font-semibold">Client rates</h2>
          <Table>
            <TableHeader><TableRow><TableHead>Client</TableHead><TableHead>Seats</TableHead><TableHead>Price / seat / mo</TableHead><TableHead>Hourly rate</TableHead><TableHead className="text-right">Monthly recurring</TableHead></TableRow></TableHeader>
            <TableBody>
              {(tenants ?? []).map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="font-medium">{t.name}</TableCell>
                  <TableCell><Input type="number" className="w-24" defaultValue={t.seats} onBlur={(e) => saveRate.mutate({ id: t.id, seats: +e.target.value })} /></TableCell>
                  <TableCell><Input type="number" step="0.01" className="w-28" defaultValue={Number(t.price_per_seat)} onBlur={(e) => saveRate.mutate({ id: t.id, price_per_seat: +e.target.value })} /></TableCell>
                  <TableCell><Input type="number" step="0.01" className="w-28" defaultValue={Number(t.hourly_rate)} onBlur={(e) => saveRate.mutate({ id: t.id, hourly_rate: +e.target.value })} /></TableCell>
                  <TableCell className="text-right font-mono">{money(t.seats * Number(t.price_per_seat))}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="flex flex-wrap items-end gap-3 border-t border-border px-5 py-4">
            <div><Label>Period start</Label><Input type="date" value={period.start} onChange={(e) => setPeriod({ ...period, start: e.target.value })} /></div>
            <div><Label>Period end</Label><Input type="date" value={period.end} onChange={(e) => setPeriod({ ...period, end: e.target.value })} /></div>
            <Button onClick={() => generate.mutate()} disabled={generate.isPending}>Generate draft invoices</Button>
            <p className="text-xs text-muted-foreground">Seats × price, plus unbilled billable hours in the period.</p>
          </div>
        </div>
      )}
      <div className="rounded-lg border border-border bg-card">
        <h2 className="border-b border-border px-5 py-3 font-display font-semibold">Invoices</h2>
        <Table>
          <TableHeader><TableRow><TableHead>#</TableHead><TableHead>Client</TableHead><TableHead>Period</TableHead><TableHead>Seats</TableHead><TableHead>Hours</TableHead><TableHead className="text-right">Total</TableHead><TableHead>Status</TableHead>{admin && <TableHead />}</TableRow></TableHeader>
          <TableBody>
            {(invoices ?? []).map((i) => (
              <TableRow key={i.id}>
                <TableCell className="font-mono text-xs">INV-{i.number}</TableCell>
                <TableCell>{i.tenants?.name}</TableCell>
                <TableCell className="font-mono text-xs">{i.period_start} → {i.period_end}</TableCell>
                <TableCell className="font-mono">{i.seats} × {money(Number(i.price_per_seat))}</TableCell>
                <TableCell className="font-mono">{Number(i.hours)} × {money(Number(i.hourly_rate))}</TableCell>
                <TableCell className="text-right font-mono">{money(Number(i.total))}</TableCell>
                <TableCell><StatusBadge value={i.status} /></TableCell>
                {admin && (
                  <TableCell>
                    <Select value={i.status} onValueChange={(v) => setStatus.mutate({ id: i.id, status: v })}>
                      <SelectTrigger className="h-8 w-24"><SelectValue /></SelectTrigger>
                      <SelectContent>{["draft", "sent", "paid", "void"].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                    </Select>
                  </TableCell>
                )}
              </TableRow>
            ))}
            {!invoices?.length && <TableRow><TableCell colSpan={8} className="py-8 text-center text-muted-foreground">No invoices yet.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
