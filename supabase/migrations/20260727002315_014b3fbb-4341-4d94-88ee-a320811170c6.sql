
-- 1. Expand the role enum
ALTER TYPE public.app_role RENAME TO app_role_old;
CREATE TYPE public.app_role AS ENUM ('super_admin','admin','dept_admin','dept_manager','dept_receptionist','receptionist');

DROP FUNCTION IF EXISTS public.has_role(uuid, public.app_role_old) CASCADE;
ALTER TABLE public.user_roles ALTER COLUMN role TYPE public.app_role USING role::text::public.app_role;
DROP TYPE public.app_role_old;

-- 2. Department assignment on profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS department_id uuid REFERENCES public.departments(id) ON DELETE SET NULL;

-- 3. Helper functions
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

-- facility-wide managers
CREATE OR REPLACE FUNCTION public.is_global_admin(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.user_rank(_user_id) <= 2;
$$;

-- can the actor manage (create/update) a record in this department?
CREATE OR REPLACE FUNCTION public.can_manage_dept(_user_id uuid, _dept uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN public.user_rank(_user_id) <= 2 THEN true
    WHEN public.user_rank(_user_id) BETWEEN 3 AND 5
      THEN _dept IS NOT NULL AND _dept = public.user_department(_user_id)
    ELSE false END;
$$;

-- can the actor delete a record in this department? (receptionist always blocked)
CREATE OR REPLACE FUNCTION public.can_delete_dept(_user_id uuid, _dept uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.can_manage_dept(_user_id, _dept);
$$;

-- can the actor delete a staff account / their role rows?
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

-- 4. Signup trigger: first account becomes super admin
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

-- 5. Policies
-- profiles
DROP POLICY IF EXISTS "Staff can update own profile" ON public.profiles;
DROP POLICY IF EXISTS "Admins can delete profiles" ON public.profiles;
CREATE POLICY "Update own profile or managed staff" ON public.profiles FOR UPDATE TO authenticated
  USING (auth.uid() = id OR public.is_global_admin(auth.uid())
         OR (public.user_rank(auth.uid()) BETWEEN 3 AND 5 AND department_id = public.user_department(auth.uid())))
  WITH CHECK (auth.uid() = id OR public.is_global_admin(auth.uid())
         OR (public.user_rank(auth.uid()) BETWEEN 3 AND 5 AND department_id = public.user_department(auth.uid())));
CREATE POLICY "Hierarchical profile deletes" ON public.profiles FOR DELETE TO authenticated
  USING (public.can_delete_user(auth.uid(), id));

-- user_roles
DROP POLICY IF EXISTS "Admins manage roles" ON public.user_roles;
CREATE POLICY "Managers assign roles" ON public.user_roles FOR INSERT TO authenticated
  WITH CHECK (
    public.user_rank(auth.uid()) = 1
    OR (public.user_rank(auth.uid()) = 2 AND public.role_rank(role) >= 2)
    OR (public.user_rank(auth.uid()) BETWEEN 3 AND 5
        AND public.role_rank(role) > public.user_rank(auth.uid())
        AND public.user_department(user_id) = public.user_department(auth.uid()))
  );
CREATE POLICY "Managers update roles" ON public.user_roles FOR UPDATE TO authenticated
  USING (public.can_delete_user(auth.uid(), user_id))
  WITH CHECK (
    public.user_rank(auth.uid()) = 1
    OR (public.user_rank(auth.uid()) = 2 AND public.role_rank(role) >= 2)
    OR (public.user_rank(auth.uid()) BETWEEN 3 AND 5 AND public.role_rank(role) > public.user_rank(auth.uid()))
  );
CREATE POLICY "Hierarchical role deletes" ON public.user_roles FOR DELETE TO authenticated
  USING (public.can_delete_user(auth.uid(), user_id));

-- audit logs: only super admin may delete
DROP POLICY IF EXISTS "Admins delete audit" ON public.audit_logs;
CREATE POLICY "Super admin deletes audit" ON public.audit_logs FOR DELETE TO authenticated
  USING (public.user_rank(auth.uid()) = 1);

-- departments
DROP POLICY IF EXISTS "Admins manage departments" ON public.departments;
CREATE POLICY "Global admins insert departments" ON public.departments FOR INSERT TO authenticated
  WITH CHECK (public.is_global_admin(auth.uid()));
CREATE POLICY "Managers update departments" ON public.departments FOR UPDATE TO authenticated
  USING (public.can_manage_dept(auth.uid(), id)) WITH CHECK (public.can_manage_dept(auth.uid(), id));
CREATE POLICY "Managers delete departments" ON public.departments FOR DELETE TO authenticated
  USING (public.can_delete_dept(auth.uid(), id));

-- hosts
DROP POLICY IF EXISTS "Admins manage hosts" ON public.hosts;
CREATE POLICY "Managers insert hosts" ON public.hosts FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_dept(auth.uid(), department_id));
CREATE POLICY "Managers update hosts" ON public.hosts FOR UPDATE TO authenticated
  USING (public.can_manage_dept(auth.uid(), department_id)) WITH CHECK (public.can_manage_dept(auth.uid(), department_id));
CREATE POLICY "Managers delete hosts" ON public.hosts FOR DELETE TO authenticated
  USING (public.can_delete_dept(auth.uid(), department_id));

-- facility config
DROP POLICY IF EXISTS "Admins manage config" ON public.facility_config;
CREATE POLICY "Global admins manage config" ON public.facility_config FOR ALL TO authenticated
  USING (public.is_global_admin(auth.uid())) WITH CHECK (public.is_global_admin(auth.uid()));

-- bookings
DROP POLICY IF EXISTS "Staff manage bookings" ON public.bookings;
CREATE POLICY "Staff view bookings" ON public.bookings FOR SELECT TO authenticated USING (true);
CREATE POLICY "Staff write bookings" ON public.bookings FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Staff update bookings" ON public.bookings FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Managers delete bookings" ON public.bookings FOR DELETE TO authenticated
  USING (public.can_delete_dept(auth.uid(), department_id));

-- visits
DROP POLICY IF EXISTS "Staff manage visits" ON public.visits;
CREATE POLICY "Staff view visits" ON public.visits FOR SELECT TO authenticated USING (true);
CREATE POLICY "Staff write visits" ON public.visits FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Staff update visits" ON public.visits FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Managers delete visits" ON public.visits FOR DELETE TO authenticated
  USING (public.can_delete_dept(auth.uid(), department_id));

-- visitors (not department scoped: global admins delete, dept roles allowed, receptionist blocked)
DROP POLICY IF EXISTS "Staff manage visitors" ON public.visitors;
CREATE POLICY "Staff view visitors" ON public.visitors FOR SELECT TO authenticated USING (true);
CREATE POLICY "Staff write visitors" ON public.visitors FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Staff update visitors" ON public.visitors FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Managers delete visitors" ON public.visitors FOR DELETE TO authenticated
  USING (public.user_rank(auth.uid()) <= 5);
