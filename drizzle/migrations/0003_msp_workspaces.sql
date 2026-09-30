-- Multi-MSP workspaces + platform super_admin
--
-- Layering:
--   platform owner (super_admin)
--     └─ msp_workspaces            ← one per MSP customer of the platform (platform billing config lives here)
--          └─ tenants              ← the MSP's client organizations (unchanged meaning)
--               └─ devices / alerts / tickets / time_entries / invoices ...
--
-- Staff (msp_admin / technician) only see data belonging to the MSP workspace they are a member of.
-- Client users keep their existing tenant-scoped access via profiles.tenant_id.
--
-- NOTE: 'super_admin' is added to the enum in this migration, so every comparison below uses
-- role::text to stay valid when all pending migrations run inside a single transaction.

ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'super_admin';

-- Workspaces ------------------------------------------------------------------------------------
CREATE TABLE public.msp_workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  -- Platform → MSP pricing, set manually by the platform owner. Not related to client invoices.
  contracted_seats integer NOT NULL DEFAULT 0 CHECK (contracted_seats >= 0),
  contracted_agents integer NOT NULL DEFAULT 0 CHECK (contracted_agents >= 0),
  price_per_seat numeric NOT NULL DEFAULT 0 CHECK (price_per_seat >= 0),
  price_per_agent numeric NOT NULL DEFAULT 0 CHECK (price_per_agent >= 0),
  flat_monthly_fee numeric NOT NULL DEFAULT 0 CHECK (flat_monthly_fee >= 0),
  billing_mode text NOT NULL DEFAULT 'manual_invoice' CHECK (billing_mode IN ('manual_invoice', 'subscription')),
  billing_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.msp_workspaces TO authenticated;
GRANT ALL ON public.msp_workspaces TO service_role;
ALTER TABLE public.msp_workspaces ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
CREATE TRIGGER msp_workspaces_touch_updated_at BEFORE UPDATE ON public.msp_workspaces
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- A staff user belongs to at most one MSP workspace.
CREATE TABLE public.msp_workspace_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.msp_workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id)
);
CREATE INDEX msp_workspace_members_workspace_idx ON public.msp_workspace_members(workspace_id);
GRANT SELECT ON public.msp_workspace_members TO authenticated;
GRANT ALL ON public.msp_workspace_members TO service_role;
ALTER TABLE public.msp_workspace_members ENABLE ROW LEVEL SECURITY;

-- Workspace ownership of existing MSP-level records (nullable only until the backfill below).
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS msp_workspace_id uuid REFERENCES public.msp_workspaces(id) ON DELETE RESTRICT;
ALTER TABLE public.scripts ADD COLUMN IF NOT EXISTS msp_workspace_id uuid REFERENCES public.msp_workspaces(id) ON DELETE RESTRICT;
ALTER TABLE public.integrations ADD COLUMN IF NOT EXISTS msp_workspace_id uuid REFERENCES public.msp_workspaces(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS tenants_msp_workspace_idx ON public.tenants(msp_workspace_id);
CREATE INDEX IF NOT EXISTS scripts_msp_workspace_idx ON public.scripts(msp_workspace_id);
CREATE INDEX IF NOT EXISTS integrations_msp_workspace_idx ON public.integrations(msp_workspace_id);

-- Helper functions --------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_super_admin(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role::text = 'super_admin');
$$;

CREATE OR REPLACE FUNCTION public.current_workspace(_user_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT workspace_id FROM public.msp_workspace_members WHERE user_id = _user_id;
$$;

-- Staff (msp_admin/technician) may touch a client tenant only if it belongs to their own workspace.
CREATE OR REPLACE FUNCTION public.staff_can_access_tenant(_user_id uuid, _tenant_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_staff(_user_id) AND EXISTS (
    SELECT 1 FROM public.tenants t
    JOIN public.msp_workspace_members m ON m.workspace_id = t.msp_workspace_id
    WHERE t.id = _tenant_id AND m.user_id = _user_id
  );
$$;

CREATE OR REPLACE FUNCTION public.admin_can_access_tenant(_user_id uuid, _tenant_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_role(_user_id, 'msp_admin') AND public.staff_can_access_tenant(_user_id, _tenant_id);
$$;

-- Backfill ----------------------------------------------------------------------------------------
-- Before this migration there was exactly one MSP: every msp_admin/technician could see every tenant,
-- script and integration. Putting all existing staff and records into a single "Primary MSP workspace"
-- therefore preserves today's access exactly — nothing becomes visible to anyone who couldn't see it.
-- Additional MSPs are created afterwards from the platform console (/platform/workspaces).
DO $$
DECLARE ws uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM public.tenants)
     OR EXISTS (SELECT 1 FROM public.scripts)
     OR EXISTS (SELECT 1 FROM public.integrations)
     OR EXISTS (SELECT 1 FROM public.user_roles WHERE role::text IN ('msp_admin', 'technician')) THEN
    INSERT INTO public.msp_workspaces (name, slug) VALUES ('Primary MSP workspace', 'primary') RETURNING id INTO ws;
    INSERT INTO public.msp_workspace_members (workspace_id, user_id)
      SELECT DISTINCT ws, r.user_id FROM public.user_roles r JOIN public.profiles p ON p.id = r.user_id
      WHERE r.role::text IN ('msp_admin', 'technician')
      ON CONFLICT (user_id) DO NOTHING;
    UPDATE public.tenants SET msp_workspace_id = ws WHERE msp_workspace_id IS NULL;
    UPDATE public.scripts SET msp_workspace_id = ws WHERE msp_workspace_id IS NULL;
    UPDATE public.integrations SET msp_workspace_id = ws WHERE msp_workspace_id IS NULL;
  END IF;
END;
$$;

-- New rows default to the creator's workspace; rows can never be left unassigned.
ALTER TABLE public.tenants ALTER COLUMN msp_workspace_id SET DEFAULT public.current_workspace(auth.uid());
ALTER TABLE public.tenants ALTER COLUMN msp_workspace_id SET NOT NULL;
ALTER TABLE public.scripts ALTER COLUMN msp_workspace_id SET DEFAULT public.current_workspace(auth.uid());
ALTER TABLE public.scripts ALTER COLUMN msp_workspace_id SET NOT NULL;
ALTER TABLE public.integrations ALTER COLUMN msp_workspace_id SET DEFAULT public.current_workspace(auth.uid());
ALTER TABLE public.integrations ALTER COLUMN msp_workspace_id SET NOT NULL;

-- First signup still bootstraps the MSP owner, now also as a member of a workspace.
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE ws uuid;
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email))
  ON CONFLICT (id) DO NOTHING;
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'msp_admin') THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'msp_admin') ON CONFLICT DO NOTHING;
    SELECT w.id INTO ws FROM public.msp_workspaces w
      WHERE NOT EXISTS (SELECT 1 FROM public.msp_workspace_members m WHERE m.workspace_id = w.id)
      ORDER BY w.created_at LIMIT 1;
    IF ws IS NULL THEN
      INSERT INTO public.msp_workspaces (name, slug)
      VALUES ('Primary MSP workspace', 'primary-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))
      RETURNING id INTO ws;
    END IF;
    INSERT INTO public.msp_workspace_members (workspace_id, user_id) VALUES (ws, NEW.id) ON CONFLICT (user_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

-- Workspace policies ------------------------------------------------------------------------------
CREATE POLICY "super admins read workspaces" ON public.msp_workspaces FOR SELECT TO authenticated
  USING (public.is_super_admin(auth.uid()));
CREATE POLICY "super admins create workspaces" ON public.msp_workspaces FOR INSERT TO authenticated
  WITH CHECK (public.is_super_admin(auth.uid()));
CREATE POLICY "super admins update workspaces" ON public.msp_workspaces FOR UPDATE TO authenticated
  USING (public.is_super_admin(auth.uid())) WITH CHECK (public.is_super_admin(auth.uid()));

CREATE POLICY "read workspace members" ON public.msp_workspace_members FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_super_admin(auth.uid())
    OR (public.is_staff(auth.uid()) AND workspace_id = public.current_workspace(auth.uid())));

-- Re-scope existing policies to the workspace boundary --------------------------------------------
DROP POLICY IF EXISTS "staff read tenants" ON public.tenants;
DROP POLICY IF EXISTS "admins write tenants" ON public.tenants;
CREATE POLICY "staff read tenants" ON public.tenants FOR SELECT TO authenticated
  USING ((public.is_staff(auth.uid()) AND msp_workspace_id = public.current_workspace(auth.uid()))
    OR id = public.current_tenant(auth.uid()));
CREATE POLICY "admins write tenants" ON public.tenants FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'msp_admin') AND msp_workspace_id = public.current_workspace(auth.uid()))
  WITH CHECK (public.has_role(auth.uid(), 'msp_admin') AND msp_workspace_id = public.current_workspace(auth.uid()));

-- Also closes self-service tenant_id changes: a user can no longer attach themselves to another tenant.
DROP POLICY IF EXISTS "read own profile" ON public.profiles;
DROP POLICY IF EXISTS "insert own profile" ON public.profiles;
DROP POLICY IF EXISTS "update own profile" ON public.profiles;
CREATE POLICY "read own profile" ON public.profiles FOR SELECT TO authenticated
  USING (id = auth.uid()
    OR (public.is_staff(auth.uid()) AND public.current_workspace(id) = public.current_workspace(auth.uid()))
    OR public.staff_can_access_tenant(auth.uid(), tenant_id));
CREATE POLICY "insert own profile" ON public.profiles FOR INSERT TO authenticated
  WITH CHECK (id = auth.uid() AND tenant_id IS NULL);
CREATE POLICY "update own profile" ON public.profiles FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid() AND tenant_id IS NOT DISTINCT FROM public.current_tenant(auth.uid()));

DROP POLICY IF EXISTS "read own roles" ON public.user_roles;
CREATE POLICY "read own roles" ON public.user_roles FOR SELECT TO authenticated
  USING (user_id = auth.uid()
    OR (public.is_staff(auth.uid()) AND public.current_workspace(user_id) = public.current_workspace(auth.uid()))
    OR public.staff_can_access_tenant(auth.uid(), public.current_tenant(user_id)));

DROP POLICY IF EXISTS "read devices" ON public.devices;
DROP POLICY IF EXISTS "staff write devices" ON public.devices;
CREATE POLICY "read devices" ON public.devices FOR SELECT TO authenticated
  USING (public.staff_can_access_tenant(auth.uid(), tenant_id) OR tenant_id = public.current_tenant(auth.uid()));
CREATE POLICY "staff write devices" ON public.devices FOR ALL TO authenticated
  USING (public.staff_can_access_tenant(auth.uid(), tenant_id))
  WITH CHECK (public.staff_can_access_tenant(auth.uid(), tenant_id));

DROP POLICY IF EXISTS "read alerts" ON public.alerts;
DROP POLICY IF EXISTS "staff write alerts" ON public.alerts;
CREATE POLICY "read alerts" ON public.alerts FOR SELECT TO authenticated
  USING (public.staff_can_access_tenant(auth.uid(), tenant_id) OR tenant_id = public.current_tenant(auth.uid()));
CREATE POLICY "staff write alerts" ON public.alerts FOR ALL TO authenticated
  USING (public.staff_can_access_tenant(auth.uid(), tenant_id))
  WITH CHECK (public.staff_can_access_tenant(auth.uid(), tenant_id));

DROP POLICY IF EXISTS "staff read integrations" ON public.integrations;
DROP POLICY IF EXISTS "admin write integrations" ON public.integrations;
CREATE POLICY "staff read integrations" ON public.integrations FOR SELECT TO authenticated
  USING (public.is_staff(auth.uid()) AND msp_workspace_id = public.current_workspace(auth.uid()));
CREATE POLICY "admin write integrations" ON public.integrations FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'msp_admin') AND msp_workspace_id = public.current_workspace(auth.uid()))
  WITH CHECK (public.has_role(auth.uid(), 'msp_admin') AND msp_workspace_id = public.current_workspace(auth.uid()));

DROP POLICY IF EXISTS "read tickets" ON public.tickets;
DROP POLICY IF EXISTS "create tickets" ON public.tickets;
DROP POLICY IF EXISTS "staff update tickets" ON public.tickets;
DROP POLICY IF EXISTS "staff delete tickets" ON public.tickets;
CREATE POLICY "read tickets" ON public.tickets FOR SELECT TO authenticated
  USING (public.staff_can_access_tenant(auth.uid(), tenant_id) OR tenant_id = public.current_tenant(auth.uid()));
CREATE POLICY "create tickets" ON public.tickets FOR INSERT TO authenticated
  WITH CHECK (public.staff_can_access_tenant(auth.uid(), tenant_id)
    OR (tenant_id = public.current_tenant(auth.uid()) AND created_by = auth.uid()));
CREATE POLICY "staff update tickets" ON public.tickets FOR UPDATE TO authenticated
  USING (public.staff_can_access_tenant(auth.uid(), tenant_id))
  WITH CHECK (public.staff_can_access_tenant(auth.uid(), tenant_id));
CREATE POLICY "staff delete tickets" ON public.tickets FOR DELETE TO authenticated
  USING (public.staff_can_access_tenant(auth.uid(), tenant_id));

DROP POLICY IF EXISTS "read comments" ON public.ticket_comments;
DROP POLICY IF EXISTS "write comments" ON public.ticket_comments;
CREATE POLICY "read comments" ON public.ticket_comments FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.tickets t WHERE t.id = ticket_id
    AND (public.staff_can_access_tenant(auth.uid(), t.tenant_id)
      OR (NOT internal AND t.tenant_id = public.current_tenant(auth.uid())))));
CREATE POLICY "write comments" ON public.ticket_comments FOR INSERT TO authenticated
  WITH CHECK (author_id = auth.uid() AND EXISTS (SELECT 1 FROM public.tickets t WHERE t.id = ticket_id
    AND (public.staff_can_access_tenant(auth.uid(), t.tenant_id)
      OR (NOT internal AND t.tenant_id = public.current_tenant(auth.uid())))));

DROP POLICY IF EXISTS "staff time" ON public.time_entries;
CREATE POLICY "staff time" ON public.time_entries FOR ALL TO authenticated
  USING (public.staff_can_access_tenant(auth.uid(), tenant_id))
  WITH CHECK (public.staff_can_access_tenant(auth.uid(), tenant_id));

DROP POLICY IF EXISTS "staff scripts" ON public.scripts;
CREATE POLICY "staff scripts" ON public.scripts FOR ALL TO authenticated
  USING (public.is_staff(auth.uid()) AND msp_workspace_id = public.current_workspace(auth.uid()))
  WITH CHECK (public.is_staff(auth.uid()) AND msp_workspace_id = public.current_workspace(auth.uid()));

DROP POLICY IF EXISTS "staff runs" ON public.script_runs;
CREATE POLICY "staff runs" ON public.script_runs FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.devices d WHERE d.id = device_id
    AND public.staff_can_access_tenant(auth.uid(), d.tenant_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.devices d WHERE d.id = device_id
    AND public.staff_can_access_tenant(auth.uid(), d.tenant_id)));

DROP POLICY IF EXISTS "read invoices" ON public.invoices;
DROP POLICY IF EXISTS "admin write invoices" ON public.invoices;
CREATE POLICY "read invoices" ON public.invoices FOR SELECT TO authenticated
  USING (public.admin_can_access_tenant(auth.uid(), tenant_id)
    OR (status <> 'draft' AND tenant_id = public.current_tenant(auth.uid())));
CREATE POLICY "admin write invoices" ON public.invoices FOR ALL TO authenticated
  USING (public.admin_can_access_tenant(auth.uid(), tenant_id))
  WITH CHECK (public.admin_can_access_tenant(auth.uid(), tenant_id));

-- Platform console RPCs (super_admin only) --------------------------------------------------------
-- Usage is computed server-side so the platform owner gets counts without row-level read access to
-- any MSP's client data.
--   staff_count  = workspace members holding msp_admin or technician (the "seat" measure)
--   agent_count  = devices enrolled through the Meridian agent (source = 'agent')
--   device_count = all devices, including manual / RMM-synced records
CREATE OR REPLACE FUNCTION public.platform_workspace_usage()
RETURNS TABLE (workspace_id uuid, client_count bigint, staff_count bigint, device_count bigint, agent_count bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT w.id,
    (SELECT count(*) FROM public.tenants t WHERE t.msp_workspace_id = w.id),
    (SELECT count(*) FROM public.msp_workspace_members m WHERE m.workspace_id = w.id
       AND EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = m.user_id AND r.role::text IN ('msp_admin', 'technician'))),
    (SELECT count(*) FROM public.devices d JOIN public.tenants t ON t.id = d.tenant_id WHERE t.msp_workspace_id = w.id),
    (SELECT count(*) FROM public.devices d JOIN public.tenants t ON t.id = d.tenant_id WHERE t.msp_workspace_id = w.id AND d.source = 'agent')
  FROM public.msp_workspaces w
  WHERE public.is_super_admin(auth.uid());
$$;

CREATE OR REPLACE FUNCTION public.platform_workspace_members(_workspace_id uuid)
RETURNS TABLE (user_id uuid, email text, full_name text, roles text[], joined_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT m.user_id, p.email, p.full_name,
    COALESCE((SELECT array_agg(r.role::text ORDER BY r.role::text) FROM public.user_roles r WHERE r.user_id = m.user_id), '{}'),
    m.created_at
  FROM public.msp_workspace_members m JOIN public.profiles p ON p.id = m.user_id
  WHERE m.workspace_id = _workspace_id AND public.is_super_admin(auth.uid())
  ORDER BY m.created_at;
$$;

-- Adds an existing (already signed-up) user to a workspace as msp_admin or technician.
CREATE OR REPLACE FUNCTION public.platform_assign_workspace_member(_workspace_id uuid, _email text, _role public.app_role)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  target public.profiles%ROWTYPE;
  existing uuid;
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF _role::text NOT IN ('msp_admin', 'technician') THEN
    RAISE EXCEPTION 'role must be msp_admin or technician';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.msp_workspaces w WHERE w.id = _workspace_id) THEN
    RAISE EXCEPTION 'workspace not found';
  END IF;
  SELECT * INTO target FROM public.profiles p WHERE lower(p.email) = lower(trim(_email)) LIMIT 1;
  IF target.id IS NULL THEN
    RAISE EXCEPTION 'no user with that email has signed up yet';
  END IF;
  IF target.tenant_id IS NOT NULL
     OR EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = target.id AND r.role::text = 'client_user') THEN
    RAISE EXCEPTION 'client portal users cannot be added as MSP staff';
  END IF;
  SELECT m.workspace_id INTO existing FROM public.msp_workspace_members m WHERE m.user_id = target.id;
  IF existing IS NOT NULL AND existing <> _workspace_id THEN
    RAISE EXCEPTION 'user already belongs to another MSP workspace';
  END IF;
  INSERT INTO public.msp_workspace_members (workspace_id, user_id) VALUES (_workspace_id, target.id)
    ON CONFLICT (user_id) DO NOTHING;
  INSERT INTO public.user_roles (user_id, role) VALUES (target.id, _role) ON CONFLICT DO NOTHING;
  RETURN target.id;
END;
$$;

-- Removes workspace membership. Roles are kept but a staff role without a workspace sees nothing.
CREATE OR REPLACE FUNCTION public.platform_remove_workspace_member(_workspace_id uuid, _user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.msp_workspace_members m WHERE m.workspace_id = _workspace_id AND m.user_id = _user_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.platform_workspace_usage() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.platform_workspace_members(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.platform_assign_workspace_member(uuid, text, public.app_role) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.platform_remove_workspace_member(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_workspace_usage() TO authenticated;
GRANT EXECUTE ON FUNCTION public.platform_workspace_members(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.platform_assign_workspace_member(uuid, text, public.app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.platform_remove_workspace_member(uuid, uuid) TO authenticated;
