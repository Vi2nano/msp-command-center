import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/lib/ui-bits";

export const Route = createFileRoute("/_authenticated/time")({
  head: () => ({ meta: [{ title: "Time — Meridian RMM" }, { name: "description", content: "Logged technician time." }] }),
  component: TimePage,
});

function TimePage() {
  const { data } = useQuery({
    queryKey: ["time-all"],
    queryFn: async () => (await supabase.from("time_entries").select("*, tenants(name), tickets(number, subject)").order("work_date", { ascending: false }).limit(300)).data ?? [],
  });
  const rows = data ?? [];
  const bill = rows.filter((r) => r.billable && !r.invoice_id).reduce((s, r) => s + r.minutes, 0);
  return (
    <div>
      <PageHeader title="Time" sub={`${(bill / 60).toFixed(1)} unbilled billable hours`} />
      <div className="rounded-lg border border-border bg-card">
        <Table>
          <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Technician</TableHead><TableHead>Client</TableHead><TableHead>Ticket</TableHead><TableHead>Notes</TableHead><TableHead className="text-right">Time</TableHead><TableHead>Billing</TableHead></TableRow></TableHeader>
          <TableBody>
            {rows.map((e) => (
              <TableRow key={e.id}>
                <TableCell className="font-mono text-xs">{e.work_date}</TableCell>
                <TableCell>{e.user_name}</TableCell>
                <TableCell>{e.tenants?.name}</TableCell>
                <TableCell>{e.ticket_id && e.tickets ? <Link to="/tickets/$id" params={{ id: e.ticket_id }} className="text-primary">#{e.tickets.number}</Link> : "—"}</TableCell>
                <TableCell className="max-w-xs truncate">{e.notes}</TableCell>
                <TableCell className="text-right font-mono">{(e.minutes / 60).toFixed(2)}h</TableCell>
                <TableCell className="font-mono text-[10px] uppercase text-muted-foreground">{!e.billable ? "non-billable" : e.invoice_id ? "invoiced" : "unbilled"}</TableCell>
              </TableRow>
            ))}
            {!rows.length && <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">No time logged yet. Log time from a ticket.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
