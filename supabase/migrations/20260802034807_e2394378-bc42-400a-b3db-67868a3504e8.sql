-- 0. private schema for internal helpers
CREATE SCHEMA IF NOT EXISTS private;
GRANT USAGE ON SCHEMA private TO authenticated, service_role;

-- 1. visitors.created_by
ALTER TABLE public.visitors ADD COLUMN IF NOT EXISTS created_by uuid;
ALTER TABLE public.visitors ALTER COLUMN created_by SET DEFAULT auth.uid();

-- 2. helper functions in private schema
CREATE OR REPLACE FUNCTION private.user_rank(_user_id uuid)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(MIN(public.role_rank(role)), 99) FROM public.user_roles WHERE user_id = _user_id;
$$;

CREATE OR REPLACE FUNCTION private.user_department(_user_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT department_id FROM public.profiles WHERE id = _user_id;
$$;

CREATE OR REPLACE FUNCTION private.is_global_admin(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT private.user_rank(_user_id) <= 2;
$$;

CREATE OR REPLACE FUNCTION private.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;

CREATE OR REPLACE FUNCTION private.can_manage_dept(_user_id uuid, _dept uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN private.user_rank(_user_id) <= 2 THEN true
    WHEN private.user_rank(_user_id) BETWEEN 3 AND 5
      THEN _dept IS NOT NULL AND _dept = private.user_department(_user_id)
    ELSE false END;
$$;

CREATE OR REPLACE FUNCTION private.can_delete_dept(_user_id uuid, _dept uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT private.can_manage_dept(_user_id, _dept);
$$;

CREATE OR REPLACE FUNCTION private.can_delete_user(_actor uuid, _target uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN _actor = _target THEN false
    WHEN private.user_rank(_actor) = 1 THEN true
    WHEN private.user_rank(_actor) = 2 THEN private.user_rank(_target) <> 2
    WHEN private.user_rank(_actor) BETWEEN 3 AND 5 THEN
      private.user_rank(_target) >= private.user_rank(_actor)
      AND private.user_department(_target) IS NOT NULL
      AND private.user_department(_target) = private.user_department(_actor)
    ELSE false END;
$$;

-- FIX: no blanket access for staff without a department
CREATE OR REPLACE FUNCTION private.can_touch_dept(_user_id uuid, _dept uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN private.user_rank(_user_id) <= 2 THEN true
    WHEN NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id) THEN false
    WHEN private.user_department(_user_id) IS NULL THEN false
    ELSE _dept IS NULL OR _dept = private.user_department(_user_id)
  END;
$$;

-- FIX: creator-scoped fallback instead of 12h global window
CREATE OR REPLACE FUNCTION private.can_touch_visitor(_user_id uuid, _visitor uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id)
    AND (
      private.user_rank(_user_id) <= 2
      OR EXISTS (
        SELECT 1 FROM public.visits v
        WHERE v.visitor_id = _visitor AND private.can_touch_dept(_user_id, v.department_id)
      )
      OR EXISTS (
        SELECT 1 FROM public.bookings b
        WHERE b.visitor_id = _visitor AND private.can_touch_dept(_user_id, b.department_id)
      )
      OR EXISTS (
        SELECT 1 FROM public.visitors vi WHERE vi.id = _visitor AND vi.created_by = _user_id
      )
    );
$$;

REVOKE ALL ON FUNCTION private.user_rank(uuid), private.user_department(uuid),
  private.is_global_admin(uuid), private.has_role(uuid, public.app_role),
  private.can_manage_dept(uuid, uuid), private.can_delete_dept(uuid, uuid),
  private.can_delete_user(uuid, uuid), private.can_touch_dept(uuid, uuid),
  private.can_touch_visitor(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.user_rank(uuid), private.user_department(uuid),
  private.is_global_admin(uuid), private.has_role(uuid, public.app_role),
  private.can_manage_dept(uuid, uuid), private.can_delete_dept(uuid, uuid),
  private.can_delete_user(uuid, uuid), private.can_touch_dept(uuid, uuid),
  private.can_touch_visitor(uuid, uuid) TO authenticated, service_role;

-- 3. recreate policies against private helpers
DROP POLICY IF EXISTS "Admins and managers view audit" ON public.audit_logs;
CREATE POLICY "Admins and managers view audit" ON public.audit_logs FOR SELECT TO authenticated
  USING (private.user_rank(auth.uid()) <= 5 OR actor_id = auth.uid());
DROP POLICY IF EXISTS "Super admin deletes audit" ON public.audit_logs;
CREATE POLICY "Super admin deletes audit" ON public.audit_logs FOR DELETE TO authenticated
  USING (private.user_rank(auth.uid()) = 1);

DROP POLICY IF EXISTS "Managers delete bookings" ON public.bookings;
CREATE POLICY "Managers delete bookings" ON public.bookings FOR DELETE TO authenticated
  USING (private.can_delete_dept(auth.uid(), department_id));
DROP POLICY IF EXISTS "Staff update bookings in their department" ON public.bookings;
CREATE POLICY "Staff update bookings in their department" ON public.bookings FOR UPDATE TO authenticated
  USING (private.can_touch_dept(auth.uid(), department_id))
  WITH CHECK (private.can_touch_dept(auth.uid(), department_id));
DROP POLICY IF EXISTS "Staff view bookings in their department" ON public.bookings;
CREATE POLICY "Staff view bookings in their department" ON public.bookings FOR SELECT TO authenticated
  USING (private.can_touch_dept(auth.uid(), department_id));
DROP POLICY IF EXISTS "Staff write bookings in their department" ON public.bookings;
CREATE POLICY "Staff write bookings in their department" ON public.bookings FOR INSERT TO authenticated
  WITH CHECK (private.can_touch_dept(auth.uid(), department_id));

DROP POLICY IF EXISTS "Global admins insert departments" ON public.departments;
CREATE POLICY "Global admins insert departments" ON public.departments FOR INSERT TO authenticated
  WITH CHECK (private.is_global_admin(auth.uid()));
DROP POLICY IF EXISTS "Managers delete departments" ON public.departments;
CREATE POLICY "Managers delete departments" ON public.departments FOR DELETE TO authenticated
  USING (private.can_delete_dept(auth.uid(), id));
DROP POLICY IF EXISTS "Managers update departments" ON public.departments;
CREATE POLICY "Managers update departments" ON public.departments FOR UPDATE TO authenticated
  USING (private.can_manage_dept(auth.uid(), id)) WITH CHECK (private.can_manage_dept(auth.uid(), id));

DROP POLICY IF EXISTS "Global admins manage config" ON public.facility_config;
CREATE POLICY "Global admins manage config" ON public.facility_config FOR ALL TO authenticated
  USING (private.is_global_admin(auth.uid())) WITH CHECK (private.is_global_admin(auth.uid()));

DROP POLICY IF EXISTS "Managers delete hosts" ON public.hosts;
CREATE POLICY "Managers delete hosts" ON public.hosts FOR DELETE TO authenticated
  USING (private.can_delete_dept(auth.uid(), department_id));
DROP POLICY IF EXISTS "Managers insert hosts" ON public.hosts;
CREATE POLICY "Managers insert hosts" ON public.hosts FOR INSERT TO authenticated
  WITH CHECK (private.can_manage_dept(auth.uid(), department_id));
DROP POLICY IF EXISTS "Managers update hosts" ON public.hosts;
CREATE POLICY "Managers update hosts" ON public.hosts FOR UPDATE TO authenticated
  USING (private.can_manage_dept(auth.uid(), department_id)) WITH CHECK (private.can_manage_dept(auth.uid(), department_id));
DROP POLICY IF EXISTS "Staff view hosts in their department" ON public.hosts;
CREATE POLICY "Staff view hosts in their department" ON public.hosts FOR SELECT TO authenticated
  USING (private.can_touch_dept(auth.uid(), department_id));

DROP POLICY IF EXISTS "Hierarchical profile deletes" ON public.profiles;
CREATE POLICY "Hierarchical profile deletes" ON public.profiles FOR DELETE TO authenticated
  USING (private.can_delete_user(auth.uid(), id));
DROP POLICY IF EXISTS "Update own profile or managed staff" ON public.profiles;
CREATE POLICY "Update own profile or managed staff" ON public.profiles FOR UPDATE TO authenticated
  USING (auth.uid() = id OR private.is_global_admin(auth.uid())
    OR (private.user_rank(auth.uid()) BETWEEN 3 AND 5 AND department_id = private.user_department(auth.uid())))
  WITH CHECK (auth.uid() = id OR private.is_global_admin(auth.uid())
    OR (private.user_rank(auth.uid()) BETWEEN 3 AND 5 AND department_id = private.user_department(auth.uid())));
DROP POLICY IF EXISTS "View own, department or all as admin" ON public.profiles;
CREATE POLICY "View own, department or all as admin" ON public.profiles FOR SELECT TO authenticated
  USING (id = auth.uid() OR private.is_global_admin(auth.uid())
    OR (department_id IS NOT NULL AND department_id = private.user_department(auth.uid())));

DROP POLICY IF EXISTS "Hierarchical role deletes" ON public.user_roles;
CREATE POLICY "Hierarchical role deletes" ON public.user_roles FOR DELETE TO authenticated
  USING (private.can_delete_user(auth.uid(), user_id));
DROP POLICY IF EXISTS "Managers assign roles" ON public.user_roles;
CREATE POLICY "Managers assign roles" ON public.user_roles FOR INSERT TO authenticated
  WITH CHECK (private.user_rank(auth.uid()) = 1 OR (user_id <> auth.uid() AND (
      (private.user_rank(auth.uid()) = 2 AND public.role_rank(role) >= 2)
      OR (private.user_rank(auth.uid()) BETWEEN 3 AND 5 AND public.role_rank(role) >= private.user_rank(auth.uid())
          AND private.user_department(user_id) IS NOT NULL
          AND private.user_department(user_id) = private.user_department(auth.uid())))));
DROP POLICY IF EXISTS "Managers update roles" ON public.user_roles;
CREATE POLICY "Managers update roles" ON public.user_roles FOR UPDATE TO authenticated
  USING (private.can_delete_user(auth.uid(), user_id))
  WITH CHECK (private.user_rank(auth.uid()) = 1 OR (user_id <> auth.uid() AND (
      (private.user_rank(auth.uid()) = 2 AND public.role_rank(role) >= 2)
      OR (private.user_rank(auth.uid()) BETWEEN 3 AND 5 AND public.role_rank(role) >= private.user_rank(auth.uid())))));
DROP POLICY IF EXISTS "View own roles or managed staff roles" ON public.user_roles;
CREATE POLICY "View own roles or managed staff roles" ON public.user_roles FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR private.is_global_admin(auth.uid())
    OR (private.user_rank(auth.uid()) BETWEEN 3 AND 5 AND private.user_department(auth.uid()) IS NOT NULL
        AND private.user_department(user_id) = private.user_department(auth.uid())));

DROP POLICY IF EXISTS "Managers delete visitors in scope" ON public.visitors;
CREATE POLICY "Managers delete visitors in scope" ON public.visitors FOR DELETE TO authenticated
  USING (private.user_rank(auth.uid()) <= 5 AND private.can_touch_visitor(auth.uid(), id));
DROP POLICY IF EXISTS "Staff update visitors in scope" ON public.visitors;
CREATE POLICY "Staff update visitors in scope" ON public.visitors FOR UPDATE TO authenticated
  USING (private.can_touch_visitor(auth.uid(), id)) WITH CHECK (private.can_touch_visitor(auth.uid(), id));
DROP POLICY IF EXISTS "Staff view visitors in scope" ON public.visitors;
CREATE POLICY "Staff view visitors in scope" ON public.visitors FOR SELECT TO authenticated
  USING (private.can_touch_visitor(auth.uid(), id));
-- FIX: scope visitor creation
DROP POLICY IF EXISTS "Staff write visitors" ON public.visitors;
CREATE POLICY "Staff write visitors" ON public.visitors FOR INSERT TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND (private.is_global_admin(auth.uid())
         OR (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid())
             AND private.user_department(auth.uid()) IS NOT NULL))
  );

DROP POLICY IF EXISTS "Managers delete visits" ON public.visits;
CREATE POLICY "Managers delete visits" ON public.visits FOR DELETE TO authenticated
  USING (private.can_delete_dept(auth.uid(), department_id));
DROP POLICY IF EXISTS "Staff update visits in their department" ON public.visits;
CREATE POLICY "Staff update visits in their department" ON public.visits FOR UPDATE TO authenticated
  USING (private.can_touch_dept(auth.uid(), department_id)) WITH CHECK (private.can_touch_dept(auth.uid(), department_id));
DROP POLICY IF EXISTS "Staff view visits in their department" ON public.visits;
CREATE POLICY "Staff view visits in their department" ON public.visits FOR SELECT TO authenticated
  USING (private.can_touch_dept(auth.uid(), department_id));
DROP POLICY IF EXISTS "Staff write visits in their department" ON public.visits;
CREATE POLICY "Staff write visits in their department" ON public.visits FOR INSERT TO authenticated
  WITH CHECK (private.can_touch_dept(auth.uid(), department_id));

-- 4. drop the public (API-exposed) SECURITY DEFINER helpers
DROP FUNCTION IF EXISTS public.can_touch_visitor(uuid, uuid);
DROP FUNCTION IF EXISTS public.can_touch_dept(uuid, uuid);
DROP FUNCTION IF EXISTS public.can_delete_dept(uuid, uuid);
DROP FUNCTION IF EXISTS public.can_manage_dept(uuid, uuid);
DROP FUNCTION IF EXISTS public.can_delete_user(uuid, uuid);
DROP FUNCTION IF EXISTS public.is_global_admin(uuid);
DROP FUNCTION IF EXISTS public.has_role(uuid, public.app_role);
DROP FUNCTION IF EXISTS public.user_department(uuid);
DROP FUNCTION IF EXISTS public.user_rank(uuid);