import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { roleRank, type Actor, type AppRole } from "@/lib/govvisit";

export interface SessionInfo extends Actor {
  userId: string | null;
  email: string | null;
  fullName: string;
  jobTitle: string;
  facility: string;
  departmentId: string | null;
  departmentName: string | null;
  roles: AppRole[];
  role: AppRole | null;
  rank: number;
  isAdmin: boolean;
  isGlobalAdmin: boolean;
  canDeleteAnything: boolean;
}

export function useSession() {
  return useQuery<SessionInfo>({
    queryKey: ["session"],
    queryFn: async () => {
      const { data } = await supabase.auth.getUser();
      const user = data.user;
      if (!user) {
        return {
          userId: null,
          email: null,
          fullName: "Guest",
          jobTitle: "",
          facility: "",
          departmentId: null,
          departmentName: null,
          roles: [],
          role: null,
          rank: 99,
          isAdmin: false,
          isGlobalAdmin: false,
          canDeleteAnything: false,
        };
      }
      const [{ data: profile }, { data: roleRows }] = await Promise.all([
        supabase
          .from("profiles")
          .select("*, departments(name)")
          .eq("id", user.id)
          .maybeSingle(),
        supabase.from("user_roles").select("role").eq("user_id", user.id),
      ]);
      const roles = (roleRows ?? []).map((r) => r.role as AppRole);
      const rank = roles.length ? Math.min(...roles.map((r) => roleRank(r))) : 99;
      const role = roles.slice().sort((a, b) => roleRank(a) - roleRank(b))[0] ?? null;
      const dept = (profile as { departments?: { name: string } | null } | null)?.departments;
      return {
        userId: user.id,
        email: user.email ?? null,
        fullName: profile?.full_name ?? user.email ?? "Staff member",
        jobTitle: profile?.job_title ?? "Reception Officer",
        facility: profile?.facility ?? "Abuja Headquarters",
        departmentId: profile?.department_id ?? null,
        departmentName: dept?.name ?? null,
        roles,
        role,
        rank,
        isAdmin: rank <= 2,
        isGlobalAdmin: rank <= 2,
        canDeleteAnything: rank <= 5,
      };
    },
    staleTime: 60_000,
  });
}
