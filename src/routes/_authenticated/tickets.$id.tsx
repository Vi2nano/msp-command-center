import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusBadge } from "@/lib/ui-bits";
import { useRoles } from "./route";
import { PRIORITIES, STATUSES } from "./tickets";

export const Route = createFileRoute("/_authenticated/tickets/$id")({
  head: () => ({ meta: [{ title: "Ticket — Meridian RMM" }, { name: "description", content: "Ticket detail." }] }),
  component: TicketDetail,
});

async function myName() {
  const { data: u } = await supabase.auth.getUser();
  const { data: p } = await supabase.from("profiles").select("full_name, email").eq("id", u.user!.id).single();
  return p?.full_name || p?.email || "Unknown";
}

function TicketDetail() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const { data: r } = useRoles();
  const staff = !!r?.isStaff;
  const { data: t } = useQuery({
    queryKey: ["ticket", id],
    queryFn: async () => (await supabase.from("tickets").select("*, tenants(name)").eq("id", id).single()).data,
  });
  const { data: comments } = useQuery({
    queryKey: ["ticket-comments", id],
    queryFn: async () => (await supabase.from("ticket_comments").select("*").eq("ticket_id", id).order("created_at")).data ?? [],
  });
  const { data: time } = useQuery({
    queryKey: ["ticket-time", id],
    enabled: staff,
    queryFn: async () => (await supabase.from("time_entries").select("*").eq("ticket_id", id).order("created_at")).data ?? [],
  });
  const refresh = () => qc.invalidateQueries();

  const update = useMutation({
    mutationFn: async (patch: { status?: string; priority?: string }) => {
      const { error } = await supabase.from("tickets").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: refresh, onError: (e: Error) => toast.error(e.message),
  });

  const [body, setBody] = useState("");
  const [internal, setInternal] = useState(false);
  const comment = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("ticket_comments").insert({ ticket_id: id, body, internal: staff && internal, author_name: await myName() });
      if (error) throw error;
    },
    onSuccess: () => { setBody(""); refresh(); }, onError: (e: Error) => toast.error(e.message),
  });

  const [mins, setMins] = useState(15);
  const [notes, setNotes] = useState("");
  const [billable, setBillable] = useState(true);
  const logTime = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("time_entries").insert({ ticket_id: id, tenant_id: t!.tenant_id, minutes: mins, notes, billable, user_name: await myName() });
      if (error) throw error;
    },
    onSuccess: () => { setNotes(""); toast.success("Time logged"); refresh(); }, onError: (e: Error) => toast.error(e.message),
  });

  if (!t) return <p className="text-muted-foreground">Loading…</p>;
  const totalMin = (time ?? []).reduce((s, e) => s + e.minutes, 0);

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <div>
        <Link to="/tickets" className="text-sm text-muted-foreground hover:text-foreground">← Tickets</Link>
        <h1 className="mt-2 font-display text-2xl font-semibold"><span className="font-mono text-muted-foreground">#{t.number}</span> {t.subject}</h1>
        <p className="text-sm text-muted-foreground">{t.tenants?.name} · opened {new Date(t.created_at).toLocaleString()}</p>
        {t.description && <div className="mt-4 whitespace-pre-wrap rounded-lg border border-border bg-card p-4 text-sm">{t.description}</div>}

        <h2 className="mt-8 font-display font-semibold">Conversation</h2>
        <div className="mt-3 space-y-3">
          {(comments ?? []).map((c) => (
            <div key={c.id} className={`rounded-lg border p-4 ${c.internal ? "border-warning/50 bg-warning/10" : "border-border bg-card"}`}>
              <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{c.author_name}</span>
                <span>{new Date(c.created_at).toLocaleString()}</span>
                {c.internal && <span className="font-mono uppercase text-warning">internal note</span>}
              </div>
              <p className="whitespace-pre-wrap text-sm">{c.body}</p>
            </div>
          ))}
        </div>
        <form className="mt-4 space-y-2" onSubmit={(e) => { e.preventDefault(); if (body.trim()) comment.mutate(); }}>
          <Textarea rows={4} placeholder="Write a reply…" value={body} onChange={(e) => setBody(e.target.value)} />
          <div className="flex items-center justify-between">
            {staff ? <label className="flex items-center gap-2 text-sm"><Switch checked={internal} onCheckedChange={setInternal} /> Internal note</label> : <span />}
            <Button type="submit" disabled={comment.isPending}>Send</Button>
          </div>
        </form>
      </div>

      <aside className="space-y-4">
        <div className="space-y-3 rounded-lg border border-border bg-card p-4">
          <div className="flex justify-between"><span className="text-sm text-muted-foreground">Status</span><StatusBadge value={t.status} /></div>
          {staff && (
            <>
              <div><Label>Status</Label>
                <Select value={t.status} onValueChange={(v) => update.mutate({ status: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{STATUSES.map((s) => <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>Priority</Label>
                <Select value={t.priority} onValueChange={(v) => update.mutate({ priority: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{PRIORITIES.map((p) => <SelectItem key={p} value={p} className="capitalize">{p}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </>
          )}
        </div>
        {staff && (
          <div className="rounded-lg border border-border bg-card p-4">
            <div className="flex items-baseline justify-between">
              <h3 className="font-display font-semibold">Time</h3>
              <span className="font-mono text-sm">{(totalMin / 60).toFixed(2)} h</span>
            </div>
            <form className="mt-3 space-y-2" onSubmit={(e) => { e.preventDefault(); logTime.mutate(); }}>
              <div className="flex gap-2">
                <Input type="number" min={1} value={mins} onChange={(e) => setMins(+e.target.value)} className="w-24" />
                <span className="self-center text-sm text-muted-foreground">minutes</span>
              </div>
              <Input placeholder="Work notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
              <label className="flex items-center gap-2 text-sm"><Switch checked={billable} onCheckedChange={setBillable} /> Billable</label>
              <Button type="submit" size="sm" className="w-full" disabled={logTime.isPending}>Log time</Button>
            </form>
            <div className="mt-3 space-y-1">
              {(time ?? []).map((e) => (
                <div key={e.id} className="flex justify-between text-xs">
                  <span className="truncate text-muted-foreground">{e.user_name}: {e.notes || "—"}</span>
                  <span className="font-mono">{e.minutes}m{e.billable ? "" : " (nb)"}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}
