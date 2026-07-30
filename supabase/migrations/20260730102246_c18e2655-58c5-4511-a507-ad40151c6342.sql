-- Helper: is the visitor linked to something in the caller's scope?
CREATE OR REPLACE FUNCTION public.can_touch_visitor(_user_id uuid, _visitor uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id)
    AND (
      public.user_rank(_user_id) <= 2
      OR EXISTS (
        SELECT 1 FROM public.visits v
        WHERE v.visitor_id = _visitor
          AND public.can_touch_dept(_user_id, v.department_id)
      )
      OR EXISTS (
        SELECT 1 FROM public.bookings b
        WHERE b.visitor_id = _visitor
          AND public.can_touch_dept(_user_id, b.department_id)
      )
      OR NOT EXISTS (SELECT 1 FROM public.visits v WHERE v.visitor_id = _visitor)
         AND NOT EXISTS (SELECT 1 FROM public.bookings b WHERE b.visitor_id = _visitor)
         AND EXISTS (SELECT 1 FROM public.visitors vi WHERE vi.id = _visitor AND vi.created_at > now() - interval '12 hours')
    );
$$;

-- bookings / visits SELECT scoping
DROP POLICY IF EXISTS "Staff view bookings" ON public.bookings;
CREATE POLICY "Staff view bookings in their department"
  ON public.bookings FOR SELECT TO authenticated
  USING (public.can_touch_dept(auth.uid(), department_id));

DROP POLICY IF EXISTS "Staff view visits" ON public.visits;
CREATE POLICY "Staff view visits in their department"
  ON public.visits FOR SELECT TO authenticated
  USING (public.can_touch_dept(auth.uid(), department_id));

-- hosts SELECT scoping
DROP POLICY IF EXISTS "Staff view hosts" ON public.hosts;
CREATE POLICY "Staff view hosts in their department"
  ON public.hosts FOR SELECT TO authenticated
  USING (public.can_touch_dept(auth.uid(), department_id));

-- user_roles SELECT scoping
DROP POLICY IF EXISTS "Staff can view roles" ON public.user_roles;
CREATE POLICY "View own roles or managed staff roles"
  ON public.user_roles FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.is_global_admin(auth.uid())
    OR (
      public.user_rank(auth.uid()) BETWEEN 3 AND 5
      AND public.user_department(auth.uid()) IS NOT NULL
      AND public.user_department(user_id) = public.user_department(auth.uid())
    )
  );

-- visitors scoping
DROP POLICY IF EXISTS "Staff view visitors" ON public.visitors;
CREATE POLICY "Staff view visitors in scope"
  ON public.visitors FOR SELECT TO authenticated
  USING (public.can_touch_visitor(auth.uid(), id));

DROP POLICY IF EXISTS "Staff update visitors" ON public.visitors;
CREATE POLICY "Staff update visitors in scope"
  ON public.visitors FOR UPDATE TO authenticated
  USING (public.can_touch_visitor(auth.uid(), id))
  WITH CHECK (public.can_touch_visitor(auth.uid(), id));

DROP POLICY IF EXISTS "Managers delete visitors" ON public.visitors;
CREATE POLICY "Managers delete visitors in scope"
  ON public.visitors FOR DELETE TO authenticated
  USING (public.user_rank(auth.uid()) <= 5 AND public.can_touch_visitor(auth.uid(), id));

-- user_roles: block self privilege assignment (except super admin)
DROP POLICY IF EXISTS "Managers assign roles" ON public.user_roles;
CREATE POLICY "Managers assign roles"
  ON public.user_roles FOR INSERT TO authenticated
  WITH CHECK (
    public.user_rank(auth.uid()) = 1
    OR (
      user_id <> auth.uid()
      AND (
        (public.user_rank(auth.uid()) = 2 AND public.role_rank(role) >= 2)
        OR (
          public.user_rank(auth.uid()) BETWEEN 3 AND 5
          AND public.role_rank(role) >= public.user_rank(auth.uid())
          AND public.user_department(user_id) IS NOT NULL
          AND public.user_department(user_id) = public.user_department(auth.uid())
        )
      )
    )
  );

DROP POLICY IF EXISTS "Managers update roles" ON public.user_roles;
CREATE POLICY "Managers update roles"
  ON public.user_roles FOR UPDATE TO authenticated
  USING (public.can_delete_user(auth.uid(), user_id))
  WITH CHECK (
    public.user_rank(auth.uid()) = 1
    OR (
      user_id <> auth.uid()
      AND (
        (public.user_rank(auth.uid()) = 2 AND public.role_rank(role) >= 2)
        OR (
          public.user_rank(auth.uid()) BETWEEN 3 AND 5
          AND public.role_rank(role) >= public.user_rank(auth.uid())
        )
      )
    )
  );

-- Lock down SECURITY DEFINER helper execution from API roles
REVOKE EXECUTE ON FUNCTION public.can_touch_visitor(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.can_touch_dept(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.can_manage_dept(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.can_delete_dept(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.can_delete_user(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.is_global_admin(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.user_department(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.user_rank(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon, authenticated;
