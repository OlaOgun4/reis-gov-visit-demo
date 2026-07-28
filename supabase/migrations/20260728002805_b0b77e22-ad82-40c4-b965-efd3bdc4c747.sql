DROP POLICY IF EXISTS "Managers assign roles" ON public.user_roles;
CREATE POLICY "Managers assign roles" ON public.user_roles
FOR INSERT TO authenticated
WITH CHECK (
  (public.user_rank(auth.uid()) = 1)
  OR (public.user_rank(auth.uid()) = 2 AND public.role_rank(role) >= 2)
  OR (
    public.user_rank(auth.uid()) BETWEEN 3 AND 5
    AND public.role_rank(role) >= public.user_rank(auth.uid())
    AND public.user_department(user_id) = public.user_department(auth.uid())
  )
);

DROP POLICY IF EXISTS "Managers update roles" ON public.user_roles;
CREATE POLICY "Managers update roles" ON public.user_roles
FOR UPDATE TO authenticated
USING (public.can_delete_user(auth.uid(), user_id))
WITH CHECK (
  (public.user_rank(auth.uid()) = 1)
  OR (public.user_rank(auth.uid()) = 2 AND public.role_rank(role) >= 2)
  OR (
    public.user_rank(auth.uid()) BETWEEN 3 AND 5
    AND public.role_rank(role) >= public.user_rank(auth.uid())
  )
);