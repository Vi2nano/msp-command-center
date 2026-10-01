import { createFileRoute, Link, Outlet, redirect, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, AlertTriangle, Bell, Building2, Clock, LayoutDashboard, LogOut, Monitor, Receipt, ShieldCheck, Terminal, Ticket, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });
    return { user: data.user };
  },
  component: Shell,
});

export function useRoles() {
  return useQuery({
    queryKey: ["my-roles"],
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      const { data } = await supabase.from("user_roles").select("role").eq("user_id", u.user!.id);
      const roles = (data ?? []).map((r) => r.role);
      return { roles, isStaff: roles.includes("msp_admin") || roles.includes("technician"), isAdmin: roles.includes("msp_admin"), isSuperAdmin: roles.includes("super_admin") };
    },
  });
}

const nav = [
  { to: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { to: "/clients", label: "Clients", icon: Building2, staff: true },
  { to: "/devices", label: "Devices", icon: Monitor },
  { to: "/alerts", label: "Alerts", icon: Bell },
  { to: "/tickets", label: "Tickets", icon: Ticket },
  { to: "/time", label: "Time", icon: Clock, staff: true },
  { to: "/scripts", label: "Scripts", icon: Terminal, staff: true },
  { to: "/billing", label: "Billing", icon: Receipt },
  { to: "/team", label: "Team", icon: Users, admin: true },
] as { to: string; label: string; icon: typeof Bell; staff?: boolean; admin?: boolean }[];

function WorkspaceBanner() {
  const { data } = useQuery({
    queryKey: ["workspace-status"],
    queryFn: async () => (await supabase.rpc("my_workspace_status")).data?.[0] ?? null,
  });
  if (!data) return null;
  const msgs: string[] = [];
  if (data.status === "suspended") msgs.push(`Your account is suspended${data.suspended_reason ? `: ${data.suspended_reason}` : ""}. Agent enrollment, scripts and invites are paused.`);
  else if (data.enforce_limits) {
    if (data.staff_count >= data.contracted_seats) msgs.push(`All ${data.contracted_seats} staff seats are in use.`);
    if (data.agent_count >= data.contracted_agents) msgs.push(`All ${data.contracted_agents} agent licenses are in use — new devices can't enroll.`);
  }
  if (!msgs.length) return null;
  return (
    <div className="mb-6 flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
      <div>{msgs.map((m) => <p key={m}>{m}</p>)}<p className="text-xs text-muted-foreground">Contact your Meridian account owner to change your plan.</p></div>
    </div>
  );
}

function Shell() {
  const { user } = Route.useRouteContext();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data: r } = useRoles();

  async function signOut() {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <aside className="flex w-56 flex-col border-r border-border bg-sidebar">
        <div className="flex items-center gap-2 px-5 py-5 font-display font-semibold">
          <Activity className="h-5 w-5 text-primary" /> Meridian
        </div>
        <nav className="flex-1 space-y-1 px-3">
          {nav.filter((n) => (!n.staff || r?.isStaff) && (!n.admin || r?.isAdmin)).map((n) => (
            <Link key={n.to} to={n.to as "/dashboard"}
              className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-sidebar-foreground hover:bg-sidebar-accent"
              activeProps={{ className: "bg-sidebar-accent text-sidebar-accent-foreground" }}>
              <n.icon className="h-4 w-4" /> {n.label}
            </Link>
          ))}
          {r?.isSuperAdmin && (
            <Link to="/platform/workspaces"
              className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-sidebar-foreground hover:bg-sidebar-accent">
              <ShieldCheck className="h-4 w-4" /> Platform admin
            </Link>
          )}
        </nav>
        <div className="border-t border-sidebar-border p-3">
          <p className="truncate px-2 text-xs text-muted-foreground">{user.email}</p>
          <p className="px-2 font-mono text-[10px] uppercase text-primary">{r?.roles.join(", ") || "no role"}</p>
          <Button variant="ghost" size="sm" className="mt-2 w-full justify-start" onClick={signOut}>
            <LogOut className="mr-2 h-4 w-4" /> Sign out
          </Button>
        </div>
      </aside>
      <main className="flex-1 overflow-auto p-8">{r?.isStaff && <WorkspaceBanner />}<Outlet /></main>
    </div>
  );
}
