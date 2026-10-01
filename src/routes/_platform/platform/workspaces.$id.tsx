import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PageHeader } from "@/lib/ui-bits";
import {
  assignWorkspaceMember,
  contractedMonthly,
  fetchWorkspace,
  fetchWorkspaceMembers,
  fetchWorkspaceUsage,
  money,
  removeWorkspaceMember,
  updateWorkspace,
  type MspWorkspaceInput,
  USAGE_LABELS,
} from "@/lib/platform";
import { WorkspaceForm } from "@/components/platform/workspace-form";
import { UsageVsContract } from "@/components/platform/usage";

export const Route = createFileRoute("/_platform/platform/workspaces/$id")({
  head: () => ({
    meta: [
      { title: "MSP workspace — Meridian Platform" },
      { name: "description", content: "MSP workspace contract and usage." },
    ],
  }),
  component: WorkspaceDetail,
});

function WorkspaceDetail() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const { data: w, isLoading } = useQuery({
    queryKey: ["platform-workspace", id],
    queryFn: () => fetchWorkspace(id),
  });
  const { data: usage } = useQuery({ queryKey: ["platform-usage"], queryFn: fetchWorkspaceUsage });
  const { data: members } = useQuery({
    queryKey: ["platform-members", id],
    queryFn: () => fetchWorkspaceMembers(id),
  });
  const u = usage?.get(id);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["platform-workspace", id] });
    qc.invalidateQueries({ queryKey: ["platform-workspaces"] });
    qc.invalidateQueries({ queryKey: ["platform-usage"] });
    qc.invalidateQueries({ queryKey: ["platform-members", id] });
  };
  const save = useMutation({
    mutationFn: (v: MspWorkspaceInput) => updateWorkspace(id, v),
    onSuccess: () => {
      toast.success("Workspace saved");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const [member, setMember] = useState<{ email: string; role: "msp_admin" | "technician" }>({
    email: "",
    role: "msp_admin",
  });
  const assign = useMutation({
    mutationFn: () => assignWorkspaceMember(id, member.email, member.role),
    onSuccess: () => {
      toast.success("Member added");
      setMember({ ...member, email: "" });
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: (userId: string) => removeWorkspaceMember(id, userId),
    onSuccess: () => {
      toast.success("Member removed");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) return <p className="text-muted-foreground">Loading…</p>;
  if (!w)
    return (
      <p className="text-muted-foreground">
        Workspace not found.{" "}
        <Link to="/platform/workspaces" className="underline">
          Back to workspaces
        </Link>
      </p>
    );

  const stats = [
    {
      l: "Clients",
      v: <span className="font-mono">{u?.client_count ?? "—"}</span>,
      t: "Client tenants in this workspace",
    },
    {
      l: "Staff / seats",
      v: <UsageVsContract actual={u?.staff_count} contracted={w.contracted_seats} />,
      t: USAGE_LABELS.seats,
    },
    {
      l: "Agents / contracted",
      v: <UsageVsContract actual={u?.agent_count} contracted={w.contracted_agents} />,
      t: USAGE_LABELS.agents,
    },
    {
      l: "All devices",
      v: <span className="font-mono">{u?.device_count ?? "—"}</span>,
      t: USAGE_LABELS.devices,
    },
    {
      l: "Contracted / mo",
      v: <span className="font-mono">{money(contractedMonthly(w))}</span>,
      t: "Flat fee + seats × seat price + agents × agent price",
    },
  ];

  return (
    <div className="space-y-8">
      <PageHeader
        title={w.name}
        sub={`Workspace ${w.slug} · created ${new Date(w.created_at).toLocaleDateString()}`}
      >
        <Button variant="outline" asChild>
          <Link to="/platform/workspaces">All workspaces</Link>
        </Button>
      </PageHeader>

      <div className="grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-5">
        {stats.map((s) => (
          <div key={s.l} className="bg-card p-5" title={s.t}>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">{s.l}</p>
            <p className="mt-2 font-display text-2xl font-semibold">{s.v}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">{s.t}</p>
          </div>
        ))}
      </div>

      <section className="rounded-lg border border-border bg-card p-5">
        <h2 className="mb-4 font-display text-lg font-semibold">Contract &amp; billing</h2>
        <WorkspaceForm
          key={w.updated_at}
          initial={{
            name: w.name,
            slug: w.slug,
            contracted_seats: w.contracted_seats,
            contracted_agents: w.contracted_agents,
            price_per_seat: Number(w.price_per_seat),
            price_per_agent: Number(w.price_per_agent),
            flat_monthly_fee: Number(w.flat_monthly_fee),
            billing_mode: w.billing_mode,
            billing_notes: w.billing_notes ?? "",
            status: w.status,
            enforce_limits: w.enforce_limits,
            suspended_reason: w.suspended_reason ?? "",
          }}
          submitLabel="Save changes"
          pending={save.isPending}
          onSubmit={(v) => save.mutate(v)}
        />
      </section>

      <section className="rounded-lg border border-border bg-card p-5">
        <h2 className="mb-1 font-display text-lg font-semibold">Staff members</h2>
        <p className="mb-4 text-sm text-muted-foreground">
          Users must sign up first. Adding a member grants the chosen role and scopes them to this
          workspace only.
        </p>
        <form
          className="mb-4 flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            assign.mutate();
          }}
        >
          <div className="min-w-64 flex-1">
            <Label>Email</Label>
            <Input
              type="email"
              required
              value={member.email}
              onChange={(e) => setMember({ ...member, email: e.target.value })}
            />
          </div>
          <div className="w-44">
            <Label>Role</Label>
            <Select
              value={member.role}
              onValueChange={(v) => setMember({ ...member, role: v as "msp_admin" | "technician" })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="msp_admin">MSP admin</SelectItem>
                <SelectItem value="technician">Technician</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button type="submit" disabled={assign.isPending}>
            Add member
          </Button>
        </form>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Roles</TableHead>
              <TableHead>Joined</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {(members ?? []).map((m) => (
              <TableRow key={m.user_id}>
                <TableCell className="font-medium">{m.full_name}</TableCell>
                <TableCell>{m.email}</TableCell>
                <TableCell className="font-mono text-xs uppercase">
                  {m.roles.join(", ") || "none"}
                </TableCell>
                <TableCell>{new Date(m.joined_at).toLocaleDateString()}</TableCell>
                <TableCell className="text-right">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={remove.isPending}
                    onClick={() => {
                      if (confirm(`Remove ${m.email} from ${w.name}?`)) remove.mutate(m.user_id);
                    }}
                  >
                    Remove
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {!members?.length && (
              <TableRow>
                <TableCell colSpan={5} className="py-6 text-center text-muted-foreground">
                  No members yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </section>
    </div>
  );
}
