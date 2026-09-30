-- Roles
CREATE TYPE public.app_role AS ENUM ('msp_admin', 'technician', 'client_user');
CREATE TYPE public.device_status AS ENUM ('online', 'warning', 'offline');
CREATE TYPE public.alert_severity AS ENUM ('critical', 'warning', 'info');
CREATE TYPE public.alert_state AS ENUM ('open', 'acknowledged', 'resolved');

-- Tenants (client organizations of the MSP)
CREATE TABLE public.tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  industry text,
  primary_contact text,
  seats int NOT NULL DEFAULT 0,
  plan text NOT NULL DEFAULT 'standard',
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenants TO authenticated;
GRANT ALL ON public.tenants TO service_role;
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY,
  email text,
  full_name text,
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  role public.app_role NOT NULL,
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;

CREATE OR REPLACE FUNCTION public.is_staff(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role IN ('msp_admin','technician'));
$$;

CREATE OR REPLACE FUNCTION public.current_tenant(_user_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT tenant_id FROM public.profiles WHERE id = _user_id;
$$;

-- Devices
CREATE TABLE public.devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  hostname text NOT NULL,
  os text,
  device_type text NOT NULL DEFAULT 'workstation',
  status public.device_status NOT NULL DEFAULT 'offline',
  cpu_percent numeric NOT NULL DEFAULT 0,
  memory_percent numeric NOT NULL DEFAULT 0,
  disk_percent numeric NOT NULL DEFAULT 0,
  patches_pending int NOT NULL DEFAULT 0,
  ip_address text,
  last_seen timestamptz,
  source text NOT NULL DEFAULT 'manual',
  external_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.devices (tenant_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.devices TO authenticated;
GRANT ALL ON public.devices TO service_role;
ALTER TABLE public.devices ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  device_id uuid REFERENCES public.devices(id) ON DELETE CASCADE,
  severity public.alert_severity NOT NULL DEFAULT 'info',
  state public.alert_state NOT NULL DEFAULT 'open',
  title text NOT NULL,
  detail text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.alerts (tenant_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.alerts TO authenticated;
GRANT ALL ON public.alerts TO service_role;
ALTER TABLE public.alerts ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  label text NOT NULL,
  status text NOT NULL DEFAULT 'disconnected',
  last_sync_at timestamptz,
  devices_synced int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.integrations TO authenticated;
GRANT ALL ON public.integrations TO service_role;
ALTER TABLE public.integrations ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "staff read tenants" ON public.tenants FOR SELECT TO authenticated
  USING (public.is_staff(auth.uid()) OR id = public.current_tenant(auth.uid()));
CREATE POLICY "admins write tenants" ON public.tenants FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'msp_admin')) WITH CHECK (public.has_role(auth.uid(), 'msp_admin'));

CREATE POLICY "read own profile" ON public.profiles FOR SELECT TO authenticated
  USING (id = auth.uid() OR public.is_staff(auth.uid()));
CREATE POLICY "insert own profile" ON public.profiles FOR INSERT TO authenticated WITH CHECK (id = auth.uid());
CREATE POLICY "update own profile" ON public.profiles FOR UPDATE TO authenticated USING (id = auth.uid());

CREATE POLICY "read own roles" ON public.user_roles FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_staff(auth.uid()));

CREATE POLICY "read devices" ON public.devices FOR SELECT TO authenticated
  USING (public.is_staff(auth.uid()) OR tenant_id = public.current_tenant(auth.uid()));
CREATE POLICY "staff write devices" ON public.devices FOR ALL TO authenticated
  USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

CREATE POLICY "read alerts" ON public.alerts FOR SELECT TO authenticated
  USING (public.is_staff(auth.uid()) OR tenant_id = public.current_tenant(auth.uid()));
CREATE POLICY "staff write alerts" ON public.alerts FOR ALL TO authenticated
  USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

CREATE POLICY "staff read integrations" ON public.integrations FOR SELECT TO authenticated
  USING (public.is_staff(auth.uid()));
CREATE POLICY "admin write integrations" ON public.integrations FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'msp_admin')) WITH CHECK (public.has_role(auth.uid(), 'msp_admin'));

-- Profile auto-create
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email))
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Demo data
INSERT INTO public.tenants (id, name, slug, industry, primary_contact, seats, plan) VALUES
  ('11111111-1111-1111-1111-111111111111','Northwind Legal','northwind-legal','Legal','ops@northwind.example',42,'growth'),
  ('22222222-2222-2222-2222-222222222222','Cedar Medical Group','cedar-medical','Healthcare','it@cedarmed.example',118,'enterprise'),
  ('33333333-3333-3333-3333-333333333333','Harbor Logistics','harbor-logistics','Transport','admin@harborlog.example',27,'standard');

INSERT INTO public.devices (tenant_id, hostname, os, device_type, status, cpu_percent, memory_percent, disk_percent, patches_pending, ip_address, last_seen, source) VALUES
  ('11111111-1111-1111-1111-111111111111','NW-DC-01','Windows Server 2022','server','online',18,54,61,2,'10.14.2.10', now() - interval '2 minutes','ninjaone'),
  ('11111111-1111-1111-1111-111111111111','NW-WS-114','Windows 11 Pro','workstation','warning',77,88,92,11,'10.14.5.114', now() - interval '6 minutes','ninjaone'),
  ('11111111-1111-1111-1111-111111111111','NW-WS-207','Windows 11 Pro','workstation','online',12,41,44,0,'10.14.5.207', now() - interval '1 minute','ninjaone'),
  ('22222222-2222-2222-2222-222222222222','CMG-APP-03','Ubuntu 22.04','server','online',33,62,58,4,'10.22.1.3', now() - interval '3 minutes','ninjaone'),
  ('22222222-2222-2222-2222-222222222222','CMG-NAS-01','TrueNAS','storage','warning',9,37,94,0,'10.22.1.40', now() - interval '8 minutes','ninjaone'),
  ('22222222-2222-2222-2222-222222222222','CMG-WS-441','macOS 15','workstation','offline',0,0,70,19,'10.22.7.41', now() - interval '3 days','ninjaone'),
  ('33333333-3333-3333-3333-333333333333','HL-FW-01','pfSense','firewall','online',6,28,22,0,'10.31.0.1', now() - interval '1 minute','ninjaone'),
  ('33333333-3333-3333-3333-333333333333','HL-WS-018','Windows 10 Pro','workstation','offline',0,0,81,34,'10.31.4.18', now() - interval '9 days','ninjaone');

INSERT INTO public.alerts (tenant_id, device_id, severity, state, title, detail) VALUES
  ('11111111-1111-1111-1111-111111111111',(SELECT id FROM public.devices WHERE hostname='NW-WS-114'),'critical','open','Disk usage above 90%','C: volume at 92% capacity.'),
  ('22222222-2222-2222-2222-222222222222',(SELECT id FROM public.devices WHERE hostname='CMG-NAS-01'),'critical','open','Storage pool nearly full','Pool tank0 at 94% capacity.'),
  ('22222222-2222-2222-2222-222222222222',(SELECT id FROM public.devices WHERE hostname='CMG-WS-441'),'warning','acknowledged','Agent offline 72h','No check-in since Monday.'),
  ('33333333-3333-3333-3333-333333333333',(SELECT id FROM public.devices WHERE hostname='HL-WS-018'),'warning','open','34 patches pending','Device has missed two patch windows.'),
  ('11111111-1111-1111-1111-111111111111',(SELECT id FROM public.devices WHERE hostname='NW-DC-01'),'info','resolved','Reboot completed','Scheduled maintenance reboot finished.');

INSERT INTO public.integrations (provider, label, status) VALUES
  ('ninjaone','NinjaOne RMM','disconnected'),
  ('datto','Datto RMM','disconnected'),
  ('connectwise','ConnectWise Automate','disconnected');
