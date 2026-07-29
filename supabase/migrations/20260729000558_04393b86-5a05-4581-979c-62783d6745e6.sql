-- ENUMS
CREATE TYPE public.app_role AS ENUM ('super_admin','admin','dept_admin','dept_manager','dept_receptionist','receptionist');
CREATE TYPE public.visit_type AS ENUM ('walk_in', 'pre_booked');
CREATE TYPE public.visit_status AS ENUM ('inside', 'checked_out');
CREATE TYPE public.booking_status AS ENUM ('expected', 'arrived', 'cancelled');
CREATE TYPE public.risk_rating AS ENUM ('clear', 'review', 'blocked');

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

-- DEPARTMENTS
CREATE TABLE public.departments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  code text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.departments TO authenticated;
GRANT ALL ON public.departments TO service_role;
ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER departments_updated BEFORE UPDATE ON public.departments FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- PROFILES
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text NOT NULL DEFAULT 'Staff member',
  job_title text NOT NULL DEFAULT 'Reception Officer',
  facility text NOT NULL DEFAULT 'Abuja Headquarters',
  department_id uuid REFERENCES public.departments(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- USER ROLES
CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- HELPER FUNCTIONS
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;

CREATE OR REPLACE FUNCTION public.role_rank(_role public.app_role)
RETURNS integer LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE _role
    WHEN 'super_admin' THEN 1
    WHEN 'admin' THEN 2
    WHEN 'dept_admin' THEN 3
    WHEN 'dept_manager' THEN 4
    WHEN 'dept_receptionist' THEN 5
    ELSE 6 END;
$$;

CREATE OR REPLACE FUNCTION public.user_rank(_user_id uuid)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(MIN(public.role_rank(role)), 99) FROM public.user_roles WHERE user_id = _user_id;
$$;

CREATE OR REPLACE FUNCTION public.user_department(_user_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT department_id FROM public.profiles WHERE id = _user_id;
$$;

CREATE OR REPLACE FUNCTION public.is_global_admin(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.user_rank(_user_id) <= 2;
$$;

CREATE OR REPLACE FUNCTION public.can_manage_dept(_user_id uuid, _dept uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN public.user_rank(_user_id) <= 2 THEN true
    WHEN public.user_rank(_user_id) BETWEEN 3 AND 5
      THEN _dept IS NOT NULL AND _dept = public.user_department(_user_id)
    ELSE false END;
$$;

CREATE OR REPLACE FUNCTION public.can_delete_dept(_user_id uuid, _dept uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.can_manage_dept(_user_id, _dept);
$$;

CREATE OR REPLACE FUNCTION public.can_delete_user(_actor uuid, _target uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN _actor = _target THEN false
    WHEN public.user_rank(_actor) = 1 THEN true
    WHEN public.user_rank(_actor) = 2 THEN public.user_rank(_target) <> 2
    WHEN public.user_rank(_actor) BETWEEN 3 AND 5 THEN
      public.user_rank(_target) >= public.user_rank(_actor)
      AND public.user_department(_target) IS NOT NULL
      AND public.user_department(_target) = public.user_department(_actor)
    ELSE false END;
$$;

REVOKE EXECUTE ON FUNCTION public.role_rank(public.app_role) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.user_rank(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.user_department(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_global_admin(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.can_manage_dept(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.can_delete_dept(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.can_delete_user(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, service_role;

-- PROFILE / ROLE POLICIES
CREATE POLICY "Staff can view profiles" ON public.profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "Staff can insert own profile" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);
CREATE POLICY "Update own profile or managed staff" ON public.profiles FOR UPDATE TO authenticated
  USING (auth.uid() = id OR public.is_global_admin(auth.uid())
         OR (public.user_rank(auth.uid()) BETWEEN 3 AND 5 AND department_id = public.user_department(auth.uid())))
  WITH CHECK (auth.uid() = id OR public.is_global_admin(auth.uid())
         OR (public.user_rank(auth.uid()) BETWEEN 3 AND 5 AND department_id = public.user_department(auth.uid())));
CREATE POLICY "Hierarchical profile deletes" ON public.profiles FOR DELETE TO authenticated
  USING (public.can_delete_user(auth.uid(), id));

CREATE POLICY "Staff can view roles" ON public.user_roles FOR SELECT TO authenticated USING (true);
CREATE POLICY "Managers assign roles" ON public.user_roles FOR INSERT TO authenticated
  WITH CHECK (
    (public.user_rank(auth.uid()) = 1)
    OR (public.user_rank(auth.uid()) = 2 AND public.role_rank(role) >= 2)
    OR (
      public.user_rank(auth.uid()) BETWEEN 3 AND 5
      AND public.role_rank(role) >= public.user_rank(auth.uid())
      AND public.user_department(user_id) = public.user_department(auth.uid())
    )
  );
CREATE POLICY "Managers update roles" ON public.user_roles FOR UPDATE TO authenticated
  USING (public.can_delete_user(auth.uid(), user_id))
  WITH CHECK (
    (public.user_rank(auth.uid()) = 1)
    OR (public.user_rank(auth.uid()) = 2 AND public.role_rank(role) >= 2)
    OR (
      public.user_rank(auth.uid()) BETWEEN 3 AND 5
      AND public.role_rank(role) >= public.user_rank(auth.uid())
    )
  );
CREATE POLICY "Hierarchical role deletes" ON public.user_roles FOR DELETE TO authenticated
  USING (public.can_delete_user(auth.uid(), user_id));

CREATE POLICY "Staff view departments" ON public.departments FOR SELECT TO authenticated USING (true);
CREATE POLICY "Global admins insert departments" ON public.departments FOR INSERT TO authenticated
  WITH CHECK (public.is_global_admin(auth.uid()));
CREATE POLICY "Managers update departments" ON public.departments FOR UPDATE TO authenticated
  USING (public.can_manage_dept(auth.uid(), id)) WITH CHECK (public.can_manage_dept(auth.uid(), id));
CREATE POLICY "Managers delete departments" ON public.departments FOR DELETE TO authenticated
  USING (public.can_delete_dept(auth.uid(), id));

-- SIGNUP TRIGGER
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE existing int;
BEGIN
  INSERT INTO public.profiles (id, full_name, job_title)
  VALUES (
    NEW.id,
    COALESCE(NULLIF(NEW.raw_user_meta_data ->> 'full_name', ''), split_part(NEW.email, '@', 1)),
    COALESCE(NULLIF(NEW.raw_user_meta_data ->> 'job_title', ''), 'Reception Officer')
  )
  ON CONFLICT (id) DO NOTHING;

  SELECT count(*) INTO existing FROM public.user_roles;
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, CASE WHEN existing = 0 THEN 'super_admin'::public.app_role ELSE 'receptionist'::public.app_role END)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_updated_at() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- HOSTS
CREATE TABLE public.hosts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id uuid NOT NULL REFERENCES public.departments(id) ON DELETE CASCADE,
  full_name text NOT NULL,
  job_title text NOT NULL DEFAULT 'Officer',
  email text,
  phone text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.hosts TO authenticated;
GRANT ALL ON public.hosts TO service_role;
ALTER TABLE public.hosts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff view hosts" ON public.hosts FOR SELECT TO authenticated USING (true);
CREATE POLICY "Managers insert hosts" ON public.hosts FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_dept(auth.uid(), department_id));
CREATE POLICY "Managers update hosts" ON public.hosts FOR UPDATE TO authenticated
  USING (public.can_manage_dept(auth.uid(), department_id)) WITH CHECK (public.can_manage_dept(auth.uid(), department_id));
CREATE POLICY "Managers delete hosts" ON public.hosts FOR DELETE TO authenticated
  USING (public.can_delete_dept(auth.uid(), department_id));
CREATE TRIGGER hosts_updated BEFORE UPDATE ON public.hosts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- VISITORS
CREATE SEQUENCE public.visitor_ref_seq START 484;
CREATE TABLE public.visitors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference text NOT NULL UNIQUE DEFAULT ('VIS-' || lpad(nextval('public.visitor_ref_seq')::text, 5, '0')),
  first_name text NOT NULL,
  last_name text NOT NULL,
  phone text,
  email text,
  organisation text,
  document_type text NOT NULL DEFAULT 'Nigerian Passport',
  document_number text NOT NULL,
  risk public.risk_rating NOT NULL DEFAULT 'clear',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.visitors TO authenticated;
GRANT ALL ON public.visitors TO service_role;
ALTER TABLE public.visitors ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff view visitors" ON public.visitors FOR SELECT TO authenticated USING (true);
CREATE POLICY "Staff write visitors" ON public.visitors FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Staff update visitors" ON public.visitors FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Managers delete visitors" ON public.visitors FOR DELETE TO authenticated
  USING (public.user_rank(auth.uid()) <= 5);
CREATE TRIGGER visitors_updated BEFORE UPDATE ON public.visitors FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- BOOKINGS
CREATE SEQUENCE public.booking_ref_seq START 1042;
CREATE TABLE public.bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference text NOT NULL UNIQUE DEFAULT ('GV-EXP-' || nextval('public.booking_ref_seq')::text),
  visitor_name text NOT NULL,
  visitor_id uuid REFERENCES public.visitors(id) ON DELETE SET NULL,
  organisation text,
  phone text,
  department_id uuid REFERENCES public.departments(id) ON DELETE SET NULL,
  host_id uuid REFERENCES public.hosts(id) ON DELETE SET NULL,
  purpose text NOT NULL DEFAULT 'Official meeting',
  expected_at timestamptz NOT NULL DEFAULT now(),
  status public.booking_status NOT NULL DEFAULT 'expected',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bookings TO authenticated;
GRANT ALL ON public.bookings TO service_role;
ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff view bookings" ON public.bookings FOR SELECT TO authenticated USING (true);
CREATE POLICY "Staff write bookings" ON public.bookings FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Staff update bookings" ON public.bookings FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Managers delete bookings" ON public.bookings FOR DELETE TO authenticated
  USING (public.can_delete_dept(auth.uid(), department_id));
CREATE TRIGGER bookings_updated BEFORE UPDATE ON public.bookings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- VISITS
CREATE SEQUENCE public.pass_seq START 43;
CREATE TABLE public.visits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pass_code text NOT NULL UNIQUE DEFAULT ('GV-ABJ-2026-' || lpad(nextval('public.pass_seq')::text, 4, '0')),
  visitor_id uuid NOT NULL REFERENCES public.visitors(id) ON DELETE CASCADE,
  booking_id uuid REFERENCES public.bookings(id) ON DELETE SET NULL,
  visit_type public.visit_type NOT NULL DEFAULT 'walk_in',
  department_id uuid REFERENCES public.departments(id) ON DELETE SET NULL,
  host_id uuid REFERENCES public.hosts(id) ON DELETE SET NULL,
  purpose text NOT NULL DEFAULT 'Official meeting',
  approval text NOT NULL DEFAULT 'Reception confirmation',
  expected_minutes integer NOT NULL DEFAULT 60,
  access_zone text NOT NULL DEFAULT 'Green Zone',
  notes text,
  status public.visit_status NOT NULL DEFAULT 'inside',
  badge_returned boolean NOT NULL DEFAULT false,
  checked_in_at timestamptz NOT NULL DEFAULT now(),
  checked_out_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.visits TO authenticated;
GRANT ALL ON public.visits TO service_role;
ALTER TABLE public.visits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff view visits" ON public.visits FOR SELECT TO authenticated USING (true);
CREATE POLICY "Staff write visits" ON public.visits FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Staff update visits" ON public.visits FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Managers delete visits" ON public.visits FOR DELETE TO authenticated
  USING (public.can_delete_dept(auth.uid(), department_id));
CREATE TRIGGER visits_updated BEFORE UPDATE ON public.visits FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- FACILITY CONFIG
CREATE TABLE public.facility_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_name text NOT NULL DEFAULT 'Abuja Headquarters',
  organisation_name text NOT NULL DEFAULT 'Federal Public Services Administration',
  approval_workflow text NOT NULL DEFAULT 'Host approval required',
  retention_months integer NOT NULL DEFAULT 24,
  overdue_grace_minutes integer NOT NULL DEFAULT 15,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.facility_config TO authenticated;
GRANT ALL ON public.facility_config TO service_role;
ALTER TABLE public.facility_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff view config" ON public.facility_config FOR SELECT TO authenticated USING (true);
CREATE POLICY "Global admins manage config" ON public.facility_config FOR ALL TO authenticated
  USING (public.is_global_admin(auth.uid())) WITH CHECK (public.is_global_admin(auth.uid()));
CREATE TRIGGER config_updated BEFORE UPDATE ON public.facility_config FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- AUDIT LOGS
CREATE TABLE public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_name text NOT NULL DEFAULT 'System',
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  event text NOT NULL,
  record_ref text,
  status text NOT NULL DEFAULT 'Success',
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.audit_logs TO authenticated;
GRANT ALL ON public.audit_logs TO service_role;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff view audit" ON public.audit_logs FOR SELECT TO authenticated USING (true);
CREATE POLICY "Staff write audit" ON public.audit_logs FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Super admin deletes audit" ON public.audit_logs FOR DELETE TO authenticated
  USING (public.user_rank(auth.uid()) = 1);

-- SEED
INSERT INTO public.facility_config (facility_name) VALUES ('Abuja Headquarters');

INSERT INTO public.departments (id, name, code) VALUES
 ('11111111-1111-1111-1111-111111111101', 'Information & Communication Technology', 'ICT'),
 ('11111111-1111-1111-1111-111111111102', 'Administration', 'ADM'),
 ('11111111-1111-1111-1111-111111111103', 'Finance & Accounts', 'FIN'),
 ('11111111-1111-1111-1111-111111111104', 'Legal Services', 'LEG');

INSERT INTO public.hosts (id, department_id, full_name, job_title) VALUES
 ('22222222-2222-2222-2222-222222222201', '11111111-1111-1111-1111-111111111101', 'Chinedu Okafor', 'Head, ICT'),
 ('22222222-2222-2222-2222-222222222202', '11111111-1111-1111-1111-111111111101', 'Nneka Obi', 'Systems Manager'),
 ('22222222-2222-2222-2222-222222222203', '11111111-1111-1111-1111-111111111102', 'Amina Bello', 'Director, Administration'),
 ('22222222-2222-2222-2222-222222222204', '11111111-1111-1111-1111-111111111102', 'Bola Sani', 'Admin Officer'),
 ('22222222-2222-2222-2222-222222222205', '11111111-1111-1111-1111-111111111103', 'Ibrahim Sule', 'Finance Manager'),
 ('22222222-2222-2222-2222-222222222206', '11111111-1111-1111-1111-111111111104', 'Grace Ekanem', 'Legal Adviser');

INSERT INTO public.visitors (id, first_name, last_name, phone, organisation, document_type, document_number, risk) VALUES
 ('33333333-3333-3333-3333-333333333301', 'Chinedu', 'Okoro', '+234 803 555 0142', 'Meridian Consulting Ltd', 'Nigerian Passport', 'A12345678', 'clear'),
 ('33333333-3333-3333-3333-333333333302', 'Adaeze', 'Nwosu', '+234 806 221 8890', 'LexBridge Partners', 'Driving Licence', 'DL9002211', 'clear'),
 ('33333333-3333-3333-3333-333333333303', 'Musa', 'Abdullahi', '+234 705 118 3390', 'Northstar Services', 'NIN Card', 'NIN7741390', 'review'),
 ('33333333-3333-3333-3333-333333333304', 'Yetunde', 'Bakare', '+234 802 447 1180', 'Bakare & Co', 'Nigerian Passport', 'B99120043', 'clear');

INSERT INTO public.bookings (id, reference, visitor_name, organisation, department_id, host_id, expected_at, status) VALUES
 ('44444444-4444-4444-4444-444444444401', 'GV-EXP-1039', 'Ngozi Umeh', 'Umeh Ventures', '11111111-1111-1111-1111-111111111103', '22222222-2222-2222-2222-222222222205', now() + interval '1 hour', 'expected'),
 ('44444444-4444-4444-4444-444444444402', 'GV-EXP-1040', 'Bola Yusuf', 'Yusuf Digital', '11111111-1111-1111-1111-111111111101', '22222222-2222-2222-2222-222222222201', now() + interval '2 hours', 'expected'),
 ('44444444-4444-4444-4444-444444444403', 'GV-EXP-1041', 'Ibrahim Lawal', 'Lawal Logistics', '11111111-1111-1111-1111-111111111102', '22222222-2222-2222-2222-222222222203', now() + interval '3 hours', 'expected');

INSERT INTO public.visits (pass_code, visitor_id, visit_type, department_id, host_id, purpose, approval, expected_minutes, status, checked_in_at) VALUES
 ('GV-ABJ-2026-0040', '33333333-3333-3333-3333-333333333301', 'walk_in', '11111111-1111-1111-1111-111111111101', '22222222-2222-2222-2222-222222222201', 'Official meeting', 'Host approval required', 60, 'inside', now() - interval '74 minutes'),
 ('GV-ABJ-2026-0041', '33333333-3333-3333-3333-333333333302', 'pre_booked', '11111111-1111-1111-1111-111111111104', '22222222-2222-2222-2222-222222222206', 'Consultation', 'Host approval required', 120, 'inside', now() - interval '46 minutes'),
 ('GV-ABJ-2026-0042', '33333333-3333-3333-3333-333333333303', 'walk_in', '11111111-1111-1111-1111-111111111102', '22222222-2222-2222-2222-222222222203', 'Document submission', 'Reception confirmation', 60, 'inside', now() - interval '141 minutes');

INSERT INTO public.visits (pass_code, visitor_id, visit_type, department_id, host_id, purpose, expected_minutes, status, checked_in_at, checked_out_at, badge_returned) VALUES
 ('GV-ABJ-2026-0038', '33333333-3333-3333-3333-333333333304', 'pre_booked', '11111111-1111-1111-1111-111111111103', '22222222-2222-2222-2222-222222222205', 'Official meeting', 60, 'checked_out', now() - interval '5 hours', now() - interval '4 hours', true),
 ('GV-ABJ-2026-0039', '33333333-3333-3333-3333-333333333301', 'walk_in', '11111111-1111-1111-1111-111111111101', '22222222-2222-2222-2222-222222222202', 'Vendor visit', 30, 'checked_out', now() - interval '8 hours', now() - interval '7 hours', true);

INSERT INTO public.audit_logs (actor_name, event, record_ref, status) VALUES
 ('System', 'Watchlist check', 'VIS-00484', 'No match'),
 ('System', 'Demo data seeded', 'FAC-ABJ', 'Success');