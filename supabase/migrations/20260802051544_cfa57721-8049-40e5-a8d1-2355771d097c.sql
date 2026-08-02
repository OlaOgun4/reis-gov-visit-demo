DROP POLICY IF EXISTS "Staff write visitors" ON public.visitors;

CREATE POLICY "Staff write visitors"
ON public.visitors
FOR INSERT
TO authenticated
WITH CHECK (
  created_by = auth.uid()
  AND (
    private.is_global_admin(auth.uid())
    OR private.user_department(auth.uid()) IS NOT NULL
    OR EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid() AND ur.role = 'receptionist'::public.app_role
    )
  )
);