import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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
  BILLING_MODES,
  contractedMonthly,
  createWorkspace,
  emptyWorkspace,
  fetchWorkspaces,
  fetchWorkspaceUsage,
  money,
  USAGE_LABELS,
} from "@/lib/platform";
import { WorkspaceForm } from "@/components/platform/workspace-form";
import { UsageVsContract } from "@/components/platform/usage";

export const Route = createFileRoute("/_platform/platform/workspaces/")({
  head: () => ({
    meta: [
      { title: "MSP workspaces — Meridian Platform" },
      { name: "description", content: "Manage MSP workspaces and contracts." },
    ],
  }),
  component: Workspaces,
});

function Workspaces() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const { data: workspaces } = useQuery({
    queryKey: ["platform-workspaces"],
    queryFn: fetchWorkspaces,
  });
  const { data: usage } = useQuery({ queryKey: ["platform-usage"], queryFn: fetchWorkspaceUsage });
  const create = useMutation({
    mutationFn: createWorkspace,
    onSuccess: (id) => {
      toast.success("Workspace created");
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["platform-workspaces"] });
      qc.invalidateQueries({ queryKey: ["platform-usage"] });
      navigate({ to: "/platform/workspaces/$id", params: { id } });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div>
      <PageHeader
        title="MSP workspaces"
        sub="Each MSP customer of the platform, with its contracted terms and live usage"
      >
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>New workspace</Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>New MSP workspace</DialogTitle>
            </DialogHeader>
            <WorkspaceForm
              initial={emptyWorkspace}
              submitLabel="Create workspace"
              pending={create.isPending}
              onSubmit={(v) => create.mutate(v)}
            />
          </DialogContent>
        </Dialog>
      </PageHeader>
      <div className="rounded-lg border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Billing</TableHead>
              <TableHead className="text-right">Clients</TableHead>
              <TableHead className="text-right" title={USAGE_LABELS.seats}>
                Staff / seats
              </TableHead>
              <TableHead className="text-right" title={USAGE_LABELS.agents}>
                Agents / contracted
              </TableHead>
              <TableHead className="text-right">Contracted / mo</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(workspaces ?? []).map((w) => {
              const u = usage?.get(w.id);
              return (
                <TableRow key={w.id}>
                  <TableCell className="font-medium">
                    <Link
                      to="/platform/workspaces/$id"
                      params={{ id: w.id }}
                      className="hover:underline"
                    >
                      {w.name}
                    </Link>
                    <p className="font-mono text-xs text-muted-foreground">{w.slug}</p>
                  </TableCell>
                  <TableCell className="font-mono text-xs uppercase">
                    {BILLING_MODES.find((m) => m.value === w.billing_mode)?.label ?? w.billing_mode}
                  </TableCell>
                  <TableCell className="text-right font-mono">{u?.client_count ?? "—"}</TableCell>
                  <TableCell className="text-right">
                    <UsageVsContract actual={u?.staff_count} contracted={w.contracted_seats} />
                  </TableCell>
                  <TableCell className="text-right">
                    <UsageVsContract actual={u?.agent_count} contracted={w.contracted_agents} />
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {money(contractedMonthly(w))}
                  </TableCell>
                </TableRow>
              );
            })}
            {!workspaces?.length && (
              <TableRow>
                <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                  No MSP workspaces yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        Staff counts workspace members holding msp_admin or technician. Agents counts devices
        enrolled with the Meridian agent (manual and RMM-synced devices are excluded). Red means
        usage exceeds the contract.
      </p>
    </div>
  );
}
