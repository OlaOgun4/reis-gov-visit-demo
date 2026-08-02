import { createFileRoute, Link, Outlet, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Building2,
  ClipboardList,
  FileBarChart,
  Home,
  IdCard,
  LogOut,
  ScanLine,
  Settings,
  ShieldCheck,
  Smartphone,
  Users,
  UserCog,
  Zap,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { useSession } from "@/hooks/use-session";
import { canUseMobileApp, initials, roleLabel, type FacilityConfig } from "@/lib/govvisit";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: DashboardLayout,
});

const nav = [
  { to: "/dashboard", label: "Dashboard", icon: Home, exact: true },
  { to: "/dashboard/live", label: "Live visitors", icon: Users },
  { to: "/dashboard/records", label: "Visitor records", icon: IdCard },
  { to: "/dashboard/bookings", label: "Pre-booked visits", icon: ClipboardList },
  { to: "/dashboard/walkins", label: "Walk-in visits", icon: Zap },
  { to: "/dashboard/directory", label: "Departments & hosts", icon: Building2 },
  { to: "/dashboard/reports", label: "Reports", icon: FileBarChart },
  { to: "/dashboard/audit", label: "Audit logs", icon: ShieldCheck },
  { to: "/dashboard/users", label: "User administration", icon: UserCog },
  { to: "/dashboard/settings", label: "Configuration", icon: Settings },
] as const;

function DashboardLayout() {
  const { data: session } = useSession();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const config = useQuery({
    queryKey: ["config"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("facility_config")
        .select("*")
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as FacilityConfig | null;
    },
  });

  async function signOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <div className="min-h-screen bg-background lg:grid lg:grid-cols-[260px_1fr]">
      <aside className="bg-sidebar px-3 py-5 text-sidebar-foreground lg:sticky lg:top-0 lg:h-screen lg:overflow-y-auto">
        <div className="flex items-center gap-3 px-2 pb-5">
          <div className="grid size-10 place-items-center rounded-xl bg-sidebar-foreground font-display text-base text-sidebar">
            FG
          </div>
          <div>
            <p className="font-display text-lg leading-none">GovVisit Admin</p>
            <p className="text-[10px] opacity-70">
              {config.data?.organisation_name ?? "Federal Public Services Administration"}
            </p>
          </div>
        </div>
        <nav className="flex gap-1 overflow-x-auto lg:flex-col lg:overflow-visible">
          {nav.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              activeOptions={{ exact: "exact" in item ? item.exact : false }}
              activeProps={{ className: "bg-sidebar-accent text-sidebar-accent-foreground" }}
              className="flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2.5 text-xs font-semibold opacity-90 transition-colors hover:bg-sidebar-accent hover:opacity-100"
            >
              <item.icon className="size-4" />
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="mt-5 border-t border-sidebar-border pt-4">
          {canUseMobileApp(session) && (
            <>
          <Link
            to="/reception"
            className="flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-xs font-semibold opacity-90 hover:bg-sidebar-accent"
          >
            <Smartphone className="size-4" />
            Reception desk app
          </Link>
          <Link
            to="/kiosk"
            className="flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-xs font-semibold opacity-90 hover:bg-sidebar-accent"
          >
            <ScanLine className="size-4" />
            Self-service kiosk
          </Link>
            </>
          )}
        </div>
      </aside>

      <div className="min-w-0">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-border bg-card px-6 py-4">
          <p className="text-xs font-semibold text-muted-foreground">
            {config.data?.facility_name ?? "Abuja Headquarters"} ·{" "}
            {new Date().toLocaleDateString([], {
              weekday: "long",
              day: "numeric",
              month: "long",
              year: "numeric",
            })}
          </p>
          <div className="flex items-center gap-3">
            <div className="text-right">
              <p className="text-sm font-bold leading-none">{session?.fullName}</p>
              <p className="text-[11px] text-muted-foreground">
                {roleLabel(session?.role)}
                {session?.departmentName ? ` · ${session.departmentName}` : ""}
              </p>
            </div>
            <div className="grid size-9 place-items-center rounded-full bg-accent text-xs font-bold text-accent-foreground">
              {initials(session?.fullName ?? "GV")}
            </div>
            <Button variant="ghost" size="icon" aria-label="Sign out" onClick={signOut}>
              <LogOut />
            </Button>
          </div>
        </header>
        <main className="px-5 py-7 lg:px-8">
          {session && session.rank > 2 && (
            <p className="mb-5 rounded-xl border border-border bg-warning/15 px-4 py-3 text-xs font-semibold text-warning-foreground">
              Signed in as {roleLabel(session.role)}
              {session.departmentName ? ` for ${session.departmentName}` : ""}.
              {session.rank === 6
                ? " You may view and manage visitor check-in and check-out only; deletion is blocked for your role."
                : " Your control and deletion rights are limited to your assigned department and to roles below yours."}
            </p>
          )}
          <Outlet />
        </main>
      </div>
    </div>
  );
}
