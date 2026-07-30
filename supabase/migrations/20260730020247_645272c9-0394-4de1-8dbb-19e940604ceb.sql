DELETE FROM public.audit_logs;
UPDATE public.bookings SET host_id = host_id;
DELETE FROM public.user_roles;
DELETE FROM public.profiles;
DELETE FROM auth.users;