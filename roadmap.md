# Roadmap
- [x] Backend, roles, tenants, devices, alerts schema
- [x] Sign-in, console shell, overview, clients, devices, alerts
- [x] PSA: tickets (staff + client portal), comments/internal notes, time tracking
- [x] Client per-seat invoicing (rates, draft invoices from seats + billable hours)
- [x] Windows PowerShell bootstrap agent (`public/agent/meridian-agent.ps1`): enroll, 1-min monitoring/check-in, metrics, auto alerts (not remote desktop or VNC)
- [x] Remote scripts: library, queue per device, agent runs and reports output
- [x] Multi-MSP accounts: `msp_workspaces` + `msp_workspace_members`; client tenants, scripts and integrations belong to a workspace and all staff RLS is workspace-scoped (migration `0003_msp_workspaces`)
- [x] `super_admin` platform-owner role and platform console at `/platform/workspaces` (list, create, edit, members, usage vs contracted seats/agents)
- [x] Manual per-MSP platform pricing: contracted seats/agents, price per seat/agent, flat monthly fee, billing mode, billing notes (no payment processing yet)
- [ ] Stripe for MSP platform billing against `msp_workspaces` (customer/subscription ids, Checkout, Customer Portal, webhooks, manual invoices) — do not reuse client `invoices`
- [x] Entitlement enforcement: workspace status (active/suspended) + optional contract limits on seats and agents
- [ ] MSP self-serve signup that creates its own workspace (today the platform owner creates workspaces and adds members)
- [ ] Workspace-scoped ticket/invoice numbering (numbers currently come from global sequences)
- [ ] Replace scheduled-task agent with a native Windows service; add an interactive user-session helper, remote-session signaling and audit
- [ ] Outbound live sessions: agent holds a persistent outbound connection to a relay; technicians get a real-time interactive PowerShell session through the console (no inbound firewall ports, text-only — no screen view), with full session audit logging
- [ ] Signed scripts, agent updates, and privileged job policies
- [ ] Linux agent
- [x] Client user invites & team management (/team)

Remote desktop will require the native service and interactive user-session helper, with outbound signaling/relay connections rather than inbound VNC ports. The current PowerShell agent only checks in and executes queued scripts; it does not provide remote control.

## Multi-MSP rollout notes (migration 0003)
- **Backfill:** before 0003 there was exactly one MSP (every admin/technician saw every tenant). The migration creates one
  `Primary MSP workspace` (slug `primary`) and assigns every existing tenant, script, integration and every existing
  `msp_admin`/`technician` user to it, so current access is unchanged. `msp_workspace_id` is `NOT NULL` afterwards and
  defaults to the creating user's workspace.
- **Bootstrap the platform owner (manual, once):** run in the Supabase SQL editor
  `INSERT INTO public.user_roles (user_id, role) SELECT id, 'super_admin' FROM public.profiles WHERE email = 'you@example.com';`
  The role is never granted automatically.
- **Onboarding another MSP:** create the workspace in `/platform/workspaces`, have the MSP owner sign up, then add them
  by email as `msp_admin` on the workspace detail page. Staff without a workspace membership see no MSP data.
- The first-ever signup still becomes `msp_admin` and now also joins the first workspace that has no members.
- If you rename the `primary` workspace or split its clients between MSPs later, update `tenants.msp_workspace_id`
  (and the matching `scripts`/`integrations` rows and memberships) with SQL — there is no UI for moving clients yet.
