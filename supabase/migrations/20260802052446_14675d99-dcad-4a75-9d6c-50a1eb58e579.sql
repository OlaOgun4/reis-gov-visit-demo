CREATE OR REPLACE FUNCTION private.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role
  );
$$;

REVOKE ALL ON FUNCTION private.has_role(uuid, public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.has_role(uuid, public.app_role) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION private.can_touch_dept(_user_id uuid, _dept uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN private.user_rank(_user_id) <= 2 THEN true
    WHEN NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id) THEN false
    WHEN private.has_role(_user_id, 'receptionist'::public.app_role) THEN _dept IS NOT NULL
    WHEN private.user_department(_user_id) IS NULL THEN false
    ELSE _dept IS NULL OR _dept = private.user_department(_user_id)
  END;
$$;

REVOKE ALL ON FUNCTION private.can_touch_dept(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.can_touch_dept(uuid, uuid) TO authenticated, service_role;

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
    OR private.has_role(auth.uid(), 'receptionist'::public.app_role)
  )
);