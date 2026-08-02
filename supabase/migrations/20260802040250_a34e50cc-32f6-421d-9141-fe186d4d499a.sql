DROP POLICY IF EXISTS "Staff view hosts in their department" ON public.hosts;
CREATE POLICY "Staff view hosts in scope"
ON public.hosts FOR SELECT TO authenticated
USING (
  private.can_touch_dept(auth.uid(), department_id)
  OR private.user_rank(auth.uid()) = 6
);