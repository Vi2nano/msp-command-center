-- Tenant billing + enrollment
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS price_per_seat numeric NOT NULL DEFAULT 0;
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS hourly_rate numeric NOT NULL DEFAULT 0;
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS enrollment_key text NOT NULL DEFAULT replace(gen_random_uuid()::text,'-','');
CREATE UNIQUE INDEX IF NOT EXISTS tenants_enrollment_key_idx ON public.tenants(enrollment_key);

ALTER TABLE public.devices ADD COLUMN IF NOT EXISTS agent_token_hash text;
ALTER TABLE public.devices ADD COLUMN IF NOT EXISTS agent_version text;
ALTER TABLE public.devices ADD COLUMN IF NOT EXISTS uptime_seconds bigint;
CREATE UNIQUE INDEX IF NOT EXISTS devices_agent_token_idx ON public.devices(agent_token_hash);

-- Tickets
CREATE TABLE public.tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number bigserial,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  device_id uuid REFERENCES public.devices(id) ON DELETE SET NULL,
  subject text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'new',
  priority text NOT NULL DEFAULT 'normal',
  assigned_to uuid,
  created_by uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tickets TO authenticated;
GRANT USAGE ON SEQUENCE public.tickets_number_seq TO authenticated;
GRANT ALL ON public.tickets TO service_role;
ALTER TABLE public.tickets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read tickets" ON public.tickets FOR SELECT TO authenticated
  USING (public.is_staff(auth.uid()) OR tenant_id = public.current_tenant(auth.uid()));
CREATE POLICY "create tickets" ON public.tickets FOR INSERT TO authenticated
  WITH CHECK (public.is_staff(auth.uid()) OR (tenant_id = public.current_tenant(auth.uid()) AND created_by = auth.uid()));
CREATE POLICY "staff update tickets" ON public.tickets FOR UPDATE TO authenticated
  USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));
CREATE POLICY "staff delete tickets" ON public.tickets FOR DELETE TO authenticated USING (public.is_staff(auth.uid()));

CREATE TABLE public.ticket_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  author_id uuid NOT NULL DEFAULT auth.uid(),
  author_name text,
  body text NOT NULL,
  internal boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.ticket_comments TO authenticated;
GRANT ALL ON public.ticket_comments TO service_role;
ALTER TABLE public.ticket_comments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read comments" ON public.ticket_comments FOR SELECT TO authenticated
  USING (public.is_staff(auth.uid()) OR (NOT internal AND EXISTS (SELECT 1 FROM public.tickets t WHERE t.id = ticket_id AND t.tenant_id = public.current_tenant(auth.uid()))));
CREATE POLICY "write comments" ON public.ticket_comments FOR INSERT TO authenticated
  WITH CHECK (author_id = auth.uid() AND (public.is_staff(auth.uid()) OR (NOT internal AND EXISTS (SELECT 1 FROM public.tickets t WHERE t.id = ticket_id AND t.tenant_id = public.current_tenant(auth.uid())))));

CREATE TABLE public.time_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  ticket_id uuid REFERENCES public.tickets(id) ON DELETE SET NULL,
  user_id uuid NOT NULL DEFAULT auth.uid(),
  user_name text,
  minutes integer NOT NULL,
  notes text,
  billable boolean NOT NULL DEFAULT true,
  work_date date NOT NULL DEFAULT current_date,
  invoice_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.time_entries TO authenticated;
GRANT ALL ON public.time_entries TO service_role;
ALTER TABLE public.time_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff time" ON public.time_entries FOR ALL TO authenticated
  USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

-- Scripts
CREATE TABLE public.scripts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  body text NOT NULL,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.scripts TO authenticated;
GRANT ALL ON public.scripts TO service_role;
ALTER TABLE public.scripts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff scripts" ON public.scripts FOR ALL TO authenticated
  USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

CREATE TABLE public.script_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id uuid NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
  script_id uuid REFERENCES public.scripts(id) ON DELETE SET NULL,
  script_name text NOT NULL,
  body text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  output text,
  exit_code integer,
  queued_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.script_runs TO authenticated;
GRANT ALL ON public.script_runs TO service_role;
ALTER TABLE public.script_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff runs" ON public.script_runs FOR ALL TO authenticated
  USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));
CREATE INDEX script_runs_device_status_idx ON public.script_runs(device_id, status);

-- Client invoices
CREATE TABLE public.invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number bigserial,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  period_start date NOT NULL,
  period_end date NOT NULL,
  seats integer NOT NULL DEFAULT 0,
  price_per_seat numeric NOT NULL DEFAULT 0,
  hours numeric NOT NULL DEFAULT 0,
  hourly_rate numeric NOT NULL DEFAULT 0,
  total numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'draft',
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.invoices TO authenticated;
GRANT USAGE ON SEQUENCE public.invoices_number_seq TO authenticated;
GRANT ALL ON public.invoices TO service_role;
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read invoices" ON public.invoices FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'msp_admin') OR (status <> 'draft' AND tenant_id = public.current_tenant(auth.uid())));
CREATE POLICY "admin write invoices" ON public.invoices FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'msp_admin')) WITH CHECK (public.has_role(auth.uid(),'msp_admin'));