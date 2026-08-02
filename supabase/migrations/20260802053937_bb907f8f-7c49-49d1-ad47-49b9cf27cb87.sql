DROP POLICY IF EXISTS "Staff write visitors" ON public.visitors;
DROP POLICY IF EXISTS "Staff view visitors in scope" ON public.visitors;
DROP POLICY IF EXISTS "Staff update visitors in scope" ON public.visitors;

CREATE POLICY "Staff write visitors"
ON public.visitors
FOR INSERT
TO authenticated
WITH CHECK (
  created_by = auth.uid()
  AND (
    private.is_global_admin(auth.uid())
    OR private.user_department(auth.uid()) IS NOT NULL
    OR private.has_role(auth.uid(), 'receptionist'::public.app_role)
  )
);

CREATE POLICY "Staff view visitors in scope"
ON public.visitors
FOR SELECT
TO authenticated
USING (
  private.has_role(auth.uid(), 'receptionist'::public.app_role)
  OR private.can_touch_visitor(auth.uid(), id)
);

CREATE POLICY "Staff update visitors in scope"
ON public.visitors
FOR UPDATE
TO authenticated
USING (
  private.has_role(auth.uid(), 'receptionist'::public.app_role)
  OR private.can_touch_visitor(auth.uid(), id)
)
WITH CHECK (
  private.has_role(auth.uid(), 'receptionist'::public.app_role)
  OR private.can_touch_visitor(auth.uid(), id)
);

-- Explicitly preserve the global Receptionist deletion block at the database boundary.
DROP POLICY IF EXISTS "Managers delete visitors in scope" ON public.visitors;
CREATE POLICY "Managers delete visitors in scope"
ON public.visitors
FOR DELETE
TO authenticated
USING (
  NOT private.has_role(auth.uid(), 'receptionist'::public.app_role)
  AND private.user_rank(auth.uid()) <= 5
  AND private.can_touch_visitor(auth.uid(), id)
);