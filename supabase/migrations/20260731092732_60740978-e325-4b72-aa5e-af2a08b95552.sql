GRANT EXECUTE ON FUNCTION public.can_delete_dept(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_delete_user(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_manage_dept(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_touch_dept(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_touch_visitor(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_global_admin(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_department(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_rank(uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.can_delete_dept(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.can_delete_user(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.can_manage_dept(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.can_touch_dept(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.can_touch_visitor(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_global_admin(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.user_department(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.user_rank(uuid) FROM PUBLIC, anon;