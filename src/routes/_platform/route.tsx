import { createFileRoute, Link, Outlet, redirect, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Building, LogOut, ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { isSuperAdmin } from "@/lib/platform";

// Platform-owner console. The guard below keeps other roles out of the UI; the data itself is
// protected by RLS / SECURITY DEFINER checks on is_super_admin() in the database.
export const Route = createFileRoute("/_platform")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });
    if (!(await isSuperAdmin(data.user.id))) throw redirect({ to: "/dashboard" });
    return { user: data.user };
  },
  component: PlatformShell,
});

function PlatformShell() {
  const { user } = Route.useRouteContext();
  const qc = useQueryClient();
  const navigate = useNavigate();

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
          <ShieldCheck className="h-5 w-5 text-primary" /> Meridian Platform
        </div>
        <nav className="flex-1 space-y-1 px-3">
          <Link
            to="/platform/workspaces"
            className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-sidebar-foreground hover:bg-sidebar-accent"
            activeProps={{ className: "bg-sidebar-accent text-sidebar-accent-foreground" }}
          >
            <Building className="h-4 w-4" /> MSP workspaces
          </Link>
          <Link
            to="/dashboard"
            className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-sidebar-foreground hover:bg-sidebar-accent"
          >
            <ArrowLeft className="h-4 w-4" /> Back to console
          </Link>
        </nav>
        <div className="border-t border-sidebar-border p-3">
          <p className="truncate px-2 text-xs text-muted-foreground">{user.email}</p>
          <p className="px-2 font-mono text-[10px] uppercase text-primary">super_admin</p>
          <Button variant="ghost" size="sm" className="mt-2 w-full justify-start" onClick={signOut}>
            <LogOut className="mr-2 h-4 w-4" /> Sign out
          </Button>
        </div>
      </aside>
      <main className="flex-1 overflow-auto p-8">
        <Outlet />
      </main>
    </div>
  );
}
