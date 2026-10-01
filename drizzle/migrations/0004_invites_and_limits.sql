ALTER TABLE public.msp_workspaces
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  ADD COLUMN IF NOT EXISTS enforce_limits boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS suspended_reason text;

CREATE OR REPLACE FUNCTION public.workspace_staff_count(_ws uuid)
RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT count(*) FROM public.msp_workspace_members m WHERE m.workspace_id = _ws
    AND EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = m.user_id AND r.role::text IN ('msp_admin','technician'));
$$;

CREATE OR REPLACE FUNCTION public.workspace_agent_count(_ws uuid)
RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT count(*) FROM public.devices d JOIN public.tenants t ON t.id = d.tenant_id
  WHERE t.msp_workspace_id = _ws AND d.source = 'agent';
$$;
REVOKE EXECUTE ON FUNCTION public.workspace_staff_count(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.workspace_agent_count(uuid) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.my_workspace_status()
RETURNS TABLE (workspace_id uuid, name text, status text, suspended_reason text, enforce_limits boolean,
  contracted_seats int, contracted_agents int, staff_count bigint, agent_count bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT w.id, w.name, w.status, w.suspended_reason, w.enforce_limits, w.contracted_seats, w.contracted_agents,
    public.workspace_staff_count(w.id), public.workspace_agent_count(w.id)
  FROM public.msp_workspaces w WHERE w.id = public.current_workspace(auth.uid());
$$;
REVOKE EXECUTE ON FUNCTION public.my_workspace_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_workspace_status() TO authenticated;

CREATE OR REPLACE FUNCTION public.enforce_agent_limit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE w public.msp_workspaces%ROWTYPE;
BEGIN
  IF NEW.source IS DISTINCT FROM 'agent' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.source = 'agent' THEN RETURN NEW; END IF;
  SELECT w2.* INTO w FROM public.msp_workspaces w2 JOIN public.tenants t ON t.msp_workspace_id = w2.id WHERE t.id = NEW.tenant_id;
  IF w.status = 'suspended' THEN RAISE EXCEPTION 'workspace suspended'; END IF;
  IF w.enforce_limits AND public.workspace_agent_count(w.id) >= w.contracted_agents THEN
    RAISE EXCEPTION 'agent limit reached';
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS devices_enforce_agent_limit ON public.devices;
CREATE TRIGGER devices_enforce_agent_limit BEFORE INSERT OR UPDATE OF source ON public.devices
  FOR EACH ROW EXECUTE FUNCTION public.enforce_agent_limit();

CREATE TABLE public.invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.msp_workspaces(id) ON DELETE CASCADE,
  email text NOT NULL,
  role public.app_role NOT NULL,
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  invited_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz,
  CHECK (role::text IN ('msp_admin','technician','client_user')),
  CHECK ((role::text = 'client_user') = (tenant_id IS NOT NULL))
);
CREATE UNIQUE INDEX invites_pending_email_idx ON public.invites (lower(email)) WHERE accepted_at IS NULL;
GRANT SELECT, DELETE ON public.invites TO authenticated;
GRANT ALL ON public.invites TO service_role;
ALTER TABLE public.invites ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read workspace invites" ON public.invites FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'msp_admin') AND workspace_id = public.current_workspace(auth.uid()));
CREATE POLICY "admins revoke workspace invites" ON public.invites FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(),'msp_admin') AND workspace_id = public.current_workspace(auth.uid()) AND accepted_at IS NULL);

CREATE OR REPLACE FUNCTION public.apply_invite(_invite_id uuid, _user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE i public.invites%ROWTYPE;
BEGIN
  SELECT * INTO i FROM public.invites WHERE id = _invite_id AND accepted_at IS NULL;
  IF i.id IS NULL THEN RETURN; END IF;
  IF i.role::text = 'client_user' THEN
    UPDATE public.profiles SET tenant_id = i.tenant_id WHERE id = _user_id;
  ELSE
    INSERT INTO public.msp_workspace_members (workspace_id, user_id) VALUES (i.workspace_id, _user_id)
      ON CONFLICT (user_id) DO NOTHING;
  END IF;
  INSERT INTO public.user_roles (user_id, role) VALUES (_user_id, i.role) ON CONFLICT DO NOTHING;
  UPDATE public.invites SET accepted_at = now() WHERE id = i.id;
END; $$;
REVOKE EXECUTE ON FUNCTION public.apply_invite(uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.invite_user(_email text, _role public.app_role, _tenant_id uuid DEFAULT NULL)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  ws uuid := public.current_workspace(auth.uid());
  w public.msp_workspaces%ROWTYPE;
  target public.profiles%ROWTYPE;
  inv uuid;
  em text := lower(trim(_email));
BEGIN
  IF ws IS NULL OR NOT public.has_role(auth.uid(),'msp_admin') THEN RAISE EXCEPTION 'only MSP admins can invite' USING ERRCODE='42501'; END IF;
  IF em !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN RAISE EXCEPTION 'invalid email'; END IF;
  SELECT * INTO w FROM public.msp_workspaces WHERE id = ws;
  IF w.status = 'suspended' THEN RAISE EXCEPTION 'workspace suspended'; END IF;
  IF _role::text = 'client_user' THEN
    IF _tenant_id IS NULL OR NOT public.admin_can_access_tenant(auth.uid(), _tenant_id) THEN RAISE EXCEPTION 'choose one of your clients'; END IF;
  ELSIF _role::text IN ('msp_admin','technician') THEN
    _tenant_id := NULL;
    IF w.enforce_limits AND public.workspace_staff_count(ws)
       + (SELECT count(*) FROM public.invites WHERE workspace_id = ws AND accepted_at IS NULL AND role::text <> 'client_user')
       >= w.contracted_seats THEN
      RAISE EXCEPTION 'seat limit reached — ask the platform owner for more seats';
    END IF;
  ELSE RAISE EXCEPTION 'invalid role'; END IF;

  SELECT * INTO target FROM public.profiles WHERE lower(email) = em LIMIT 1;
  IF target.id IS NOT NULL AND (target.tenant_id IS NOT NULL OR EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = target.id)) THEN
    RAISE EXCEPTION 'that user already has access to Meridian';
  END IF;
  IF EXISTS (SELECT 1 FROM public.invites WHERE lower(email) = em AND accepted_at IS NULL AND workspace_id <> ws) THEN
    RAISE EXCEPTION 'that email has a pending invite from another MSP';
  END IF;
  DELETE FROM public.invites WHERE lower(email) = em AND accepted_at IS NULL AND workspace_id = ws;
  INSERT INTO public.invites (workspace_id, email, role, tenant_id) VALUES (ws, em, _role, _tenant_id) RETURNING id INTO inv;
  IF target.id IS NOT NULL THEN
    PERFORM public.apply_invite(inv, target.id);
    RETURN 'added';
  END IF;
  RETURN 'invited';
END; $$;
REVOKE EXECUTE ON FUNCTION public.invite_user(text, public.app_role, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.invite_user(text, public.app_role, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.workspace_team()
RETURNS TABLE (user_id uuid, email text, full_name text, roles text[], tenant_id uuid, tenant_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.id, p.email, p.full_name,
    COALESCE((SELECT array_agg(r.role::text) FROM public.user_roles r WHERE r.user_id = p.id), '{}'),
    p.tenant_id, t.name
  FROM public.profiles p LEFT JOIN public.tenants t ON t.id = p.tenant_id
  WHERE public.has_role(auth.uid(),'msp_admin')
    AND ( p.id IN (SELECT m.user_id FROM public.msp_workspace_members m WHERE m.workspace_id = public.current_workspace(auth.uid()))
       OR t.msp_workspace_id = public.current_workspace(auth.uid()) )
  ORDER BY t.name NULLS FIRST, p.email;
$$;
REVOKE EXECUTE ON FUNCTION public.workspace_team() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.workspace_team() TO authenticated;

CREATE OR REPLACE FUNCTION public.remove_team_member(_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE ws uuid := public.current_workspace(auth.uid()); tid uuid;
BEGIN
  IF ws IS NULL OR NOT public.has_role(auth.uid(),'msp_admin') THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF _user_id = auth.uid() THEN RAISE EXCEPTION 'you cannot remove yourself'; END IF;
  IF EXISTS (SELECT 1 FROM public.msp_workspace_members WHERE user_id = _user_id AND workspace_id = ws) THEN
    DELETE FROM public.msp_workspace_members WHERE user_id = _user_id;
    DELETE FROM public.user_roles WHERE user_id = _user_id AND role::text IN ('msp_admin','technician');
    RETURN;
  END IF;
  SELECT p.tenant_id INTO tid FROM public.profiles p JOIN public.tenants t ON t.id = p.tenant_id
    WHERE p.id = _user_id AND t.msp_workspace_id = ws;
  IF tid IS NULL THEN RAISE EXCEPTION 'user not in your workspace'; END IF;
  UPDATE public.profiles SET tenant_id = NULL WHERE id = _user_id;
  DELETE FROM public.user_roles WHERE user_id = _user_id AND role::text = 'client_user';
END; $$;
REVOKE EXECUTE ON FUNCTION public.remove_team_member(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remove_team_member(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE ws uuid; inv uuid;
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email))
  ON CONFLICT (id) DO NOTHING;
  SELECT id INTO inv FROM public.invites WHERE lower(email) = lower(NEW.email) AND accepted_at IS NULL LIMIT 1;
  IF inv IS NOT NULL THEN
    PERFORM public.apply_invite(inv, NEW.id);
    RETURN NEW;
  END IF;
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