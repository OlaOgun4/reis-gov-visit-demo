
-- Helper: may this user act on records belonging to a department?
CREATE OR REPLACE FUNCTION public.can_touch_dept(_user_id uuid, _dept uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id)
    AND (
      public.user_rank(_user_id) <= 2
      OR public.user_department(_user_id) IS NULL
      OR _dept IS NULL
      OR _dept = public.user_department(_user_id)
    );
$$;

REVOKE EXECUTE ON FUNCTION public.can_touch_dept(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_touch_dept(uuid, uuid) TO authenticated, service_role;

-- visits
DROP POLICY IF EXISTS "Staff update visits" ON public.visits;
CREATE POLICY "Staff update visits in their department"
ON public.visits FOR UPDATE TO authenticated
USING (public.can_touch_dept(auth.uid(), department_id))
WITH CHECK (public.can_touch_dept(auth.uid(), department_id));

DROP POLICY IF EXISTS "Staff write visits" ON public.visits;
CREATE POLICY "Staff write visits in their department"
ON public.visits FOR INSERT TO authenticated
WITH CHECK (public.can_touch_dept(auth.uid(), department_id));

-- bookings
DROP POLICY IF EXISTS "Staff update bookings" ON public.bookings;
CREATE POLICY "Staff update bookings in their department"
ON public.bookings FOR UPDATE TO authenticated
USING (public.can_touch_dept(auth.uid(), department_id))
WITH CHECK (public.can_touch_dept(auth.uid(), department_id));

DROP POLICY IF EXISTS "Staff write bookings" ON public.bookings;
CREATE POLICY "Staff write bookings in their department"
ON public.bookings FOR INSERT TO authenticated
WITH CHECK (public.can_touch_dept(auth.uid(), department_id));

-- visitors (no department column; require an actual staff role)
DROP POLICY IF EXISTS "Staff update visitors" ON public.visitors;
CREATE POLICY "Staff update visitors"
ON public.visitors FOR UPDATE TO authenticated
USING (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid()))
WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid()));

DROP POLICY IF EXISTS "Staff write visitors" ON public.visitors;
CREATE POLICY "Staff write visitors"
ON public.visitors FOR INSERT TO authenticated
WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid()));

-- audit logs
DROP POLICY IF EXISTS "Staff write audit" ON public.audit_logs;
CREATE POLICY "Staff write own audit entries"
ON public.audit_logs FOR INSERT TO authenticated
WITH CHECK (actor_id = auth.uid());

DROP POLICY IF EXISTS "Staff view audit" ON public.audit_logs;
CREATE POLICY "Admins and managers view audit"
ON public.audit_logs FOR SELECT TO authenticated
USING (public.user_rank(auth.uid()) <= 5 OR actor_id = auth.uid());

-- profiles
DROP POLICY IF EXISTS "Staff can view profiles" ON public.profiles;
CREATE POLICY "View own, department or all as admin"
ON public.profiles FOR SELECT TO authenticated
USING (
  id = auth.uid()
  OR public.is_global_admin(auth.uid())
  OR (department_id IS NOT NULL AND department_id = public.user_department(auth.uid()))
);

-- Definer routines that signed-in users must not call directly
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.can_delete_user(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.can_delete_dept(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.can_manage_dept(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_global_admin(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.user_rank(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.user_department(uuid) FROM PUBLIC, anon;
