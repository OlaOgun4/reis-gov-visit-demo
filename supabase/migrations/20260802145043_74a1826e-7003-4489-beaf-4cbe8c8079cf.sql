ALTER TABLE public.facility_config
  ADD COLUMN IF NOT EXISTS rows_per_page integer NOT NULL DEFAULT 10;

-- Department Receptionists (rank 5) lose all delete rights; ranks 1-4 unchanged.
CREATE OR REPLACE FUNCTION private.can_delete_dept(_user_id uuid, _dept uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT private.user_rank(_user_id) <= 4 AND private.can_manage_dept(_user_id, _dept);
$function$;

DROP POLICY IF EXISTS "Managers delete visitors in scope" ON public.visitors;
CREATE POLICY "Managers delete visitors in scope" ON public.visitors
FOR DELETE TO authenticated
USING (
  NOT private.has_role(auth.uid(), 'receptionist'::public.app_role)
  AND private.user_rank(auth.uid()) <= 4
  AND private.can_touch_visitor(auth.uid(), id)
);