import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Copy, Trash2, UserPlus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/lib/ui-bits";
import { useRoles } from "./route";

export const Route = createFileRoute("/_authenticated/team")({
  head: () => ({ meta: [{ title: "Team — Meridian RMM" }, { name: "description", content: "Invite technicians and client portal users." }] }),
  component: TeamPage,
});

type Role = "msp_admin" | "technician" | "client_user";
const ROLE_LABEL: Record<string, string> = { msp_admin: "MSP admin", technician: "Technician", client_user: "Client user" };

function TeamPage() {
  const qc = useQueryClient();
  const { data: r } = useRoles();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("technician");
  const [tenant, setTenant] = useState("");

  const team = useQuery({ queryKey: ["team"], queryFn: async () => {
    const { data, error } = await supabase.rpc("workspace_team"); if (error) throw error; return data ?? [];
  } });
  const invites = useQuery({ queryKey: ["invites"], queryFn: async () =>
    (await supabase.from("invites").select("*, tenants(name)").is("accepted_at", null).order("created_at", { ascending: false })).data ?? [] });
  const tenants = useQuery({ queryKey: ["tenants-min"], queryFn: async () =>
    (await supabase.from("tenants").select("id, name").order("name")).data ?? [] });

  const refresh = () => { qc.invalidateQueries({ queryKey: ["team"] }); qc.invalidateQueries({ queryKey: ["invites"] }); qc.invalidateQueries({ queryKey: ["workspace-status"] }); };

  const invite = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("invite_user", { _email: email, _role: role, _tenant_id: role === "client_user" ? tenant : undefined });
      if (error) throw error; return data;
    },
    onSuccess: (res) => {
      toast.success(res === "added" ? "User already had an account — access granted." : "Invite created. Share the sign-up link with them.");
      setEmail(""); refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const signupLink = typeof window === "undefined" ? "" : `${window.location.origin}/auth`;

  if (r && !r.isAdmin) return <div><PageHeader title="Team" sub="Only MSP admins can manage the team." /></div>;

  return (
    <div className="space-y-6">
      <PageHeader title="Team" sub="Invite technicians, admins and client portal users" />

      <form className="grid gap-3 rounded-lg border border-border bg-card p-4 md:grid-cols-[2fr_1fr_1.5fr_auto] md:items-end"
        onSubmit={(e) => { e.preventDefault(); invite.mutate(); }}>
        <div><Label>Email</Label><Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></div>
        <div><Label>Role</Label>
          <Select value={role} onValueChange={(v) => setRole(v as Role)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="technician">Technician</SelectItem>
              <SelectItem value="msp_admin">MSP admin</SelectItem>
              <SelectItem value="client_user">Client user</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div><Label>Client</Label>
          <Select value={tenant} onValueChange={setTenant} disabled={role !== "client_user"}>
            <SelectTrigger><SelectValue placeholder={role === "client_user" ? "Choose client" : "—"} /></SelectTrigger>
            <SelectContent>{(tenants.data ?? []).map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <Button type="submit" disabled={invite.isPending || (role === "client_user" && !tenant)}><UserPlus className="mr-2 h-4 w-4" />Invite</Button>
        <p className="text-xs text-muted-foreground md:col-span-4">
          Invitees get access automatically when they sign up with this email at{" "}
          <button type="button" className="font-mono text-primary" onClick={() => { navigator.clipboard.writeText(signupLink); toast.success("Link copied"); }}>
            {signupLink} <Copy className="inline h-3 w-3" />
          </button>
        </p>
      </form>

      {!!invites.data?.length && (
        <section>
          <h2 className="mb-2 font-display text-sm font-semibold uppercase text-muted-foreground">Pending invites</h2>
          <div className="rounded-lg border border-border bg-card">
            <Table>
              <TableBody>
                {invites.data.map((i) => (
                  <TableRow key={i.id}>
                    <TableCell>{i.email}</TableCell>
                    <TableCell>{ROLE_LABEL[i.role]}</TableCell>
                    <TableCell>{i.tenants?.name ?? "—"}</TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="ghost" onClick={async () => {
                        const { error } = await supabase.from("invites").delete().eq("id", i.id);
                        if (error) toast.error(error.message); else refresh();
                      }}>Revoke</Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-2 font-display text-sm font-semibold uppercase text-muted-foreground">Members</h2>
        <div className="rounded-lg border border-border bg-card">
          <Table>
            <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Email</TableHead><TableHead>Role</TableHead><TableHead>Client</TableHead><TableHead /></TableRow></TableHeader>
            <TableBody>
              {(team.data ?? []).map((m) => (
                <TableRow key={m.user_id}>
                  <TableCell>{m.full_name}</TableCell>
                  <TableCell className="font-mono text-xs">{m.email}</TableCell>
                  <TableCell>{m.roles.filter((x) => x !== "super_admin").map((x) => ROLE_LABEL[x] ?? x).join(", ") || "—"}</TableCell>
                  <TableCell>{m.tenant_name ?? "—"}</TableCell>
                  <TableCell className="text-right">
                    <Button size="icon" variant="ghost" aria-label="Remove" onClick={async () => {
                      if (!confirm(`Remove ${m.email}?`)) return;
                      const { error } = await supabase.rpc("remove_team_member", { _user_id: m.user_id });
                      if (error) toast.error(error.message); else { toast.success("Removed"); refresh(); }
                    }}><Trash2 className="h-4 w-4" /></Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>
    </div>
  );
}
