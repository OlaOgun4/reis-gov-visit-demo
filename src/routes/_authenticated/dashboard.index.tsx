import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useRealtimeVisits } from "@/hooks/use-realtime-visits";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable, EmptyRow, PageHeader, Panel, StatCard, Td } from "@/components/dashboard/kit";
import {
  VISIT_SELECT,
  formatDuration,
  formatTime,
  fullName,
  isOverdue,
  minutesSince,
  type Booking,
  type Visit,
} from "@/lib/govvisit";

export const Route = createFileRoute("/_authenticated/dashboard/")({
  head: () => ({
    meta: [
      { title: "Executive dashboard — GovVisit" },
      {
        name: "description",
        content:
          "Visitor volume, current occupancy, overdue visitors and recent reception activity for the facility.",
      },
      { property: "og:title", content: "Executive dashboard — GovVisit" },
      {
        property: "og:description",
        content: "Facility-wide visitor metrics and recent activity.",
      },
    ],
  }),
  component: Overview,
});

function Overview() {
  useRealtimeVisits();
  const visits = useQuery({
    queryKey: ["visits", "all"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("visits")
        .select(VISIT_SELECT)
        .order("checked_in_at", { ascending: false });
      if (error) throw error;
      return data as Visit[];
    },
  });

  const bookings = useQuery({
    queryKey: ["bookings", "all"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bookings")
        .select("*, departments(name, code), hosts(full_name)")
        .order("expected_at");
      if (error) throw error;
      return data as Booking[];
    },
  });

  const all = visits.data ?? [];
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const today = all.filter((v) => new Date(v.checked_in_at) >= startOfDay);
  const inside = all.filter((v) => v.status === "inside");
  const overdue = inside.filter((v) => isOverdue(v));
  const checkedOutToday = today.filter((v) => v.status === "checked_out");
  const avgDuration = checkedOutToday.length
    ? Math.round(
        checkedOutToday.reduce(
          (sum, v) =>
            sum +
            (new Date(v.checked_out_at!).getTime() - new Date(v.checked_in_at).getTime()) / 60000,
          0,
        ) / checkedOutToday.length,
      )
    : 0;
  const expected = (bookings.data ?? []).filter((b) => b.status === "expected");
  const arrived = (bookings.data ?? []).filter((b) => b.status === "arrived");

  const hours = Array.from({ length: 10 }, (_, i) => i + 8);
  const byHour = hours.map((h) => ({
    hour: h,
    count: today.filter((v) => new Date(v.checked_in_at).getHours() === h).length,
  }));
  const peak = Math.max(1, ...byHour.map((b) => b.count));

  const byDepartment = Object.entries(
    all.reduce<Record<string, number>>((acc, v) => {
      const key = v.departments?.code ?? "Unassigned";
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {}),
  ).sort((a, b) => b[1] - a[1]);

  return (
    <div>
      <PageHeader
        title="Executive dashboard"
        description="Live visitor position across the facility."
        actions={
          <Button asChild variant="outline">
            <Link to="/dashboard/live">View live visitors</Link>
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          value={today.length}
          label="Total visitors today"
          detail={`${today.filter((v) => v.visit_type === "pre_booked").length} pre-booked · ${today.filter((v) => v.visit_type === "walk_in").length} walk-in`}
        />
        <StatCard
          value={inside.length}
          label="Currently inside"
          detail={overdue.length ? `${overdue.length} overdue` : "All within duration"}
        />
        <StatCard
          value={checkedOutToday.length}
          label="Checked out today"
          detail={avgDuration ? `Average ${formatDuration(avgDuration)}` : "No checkouts yet"}
        />
        <StatCard
          value={expected.length}
          label="Expected visitors"
          detail={`${arrived.length} arrived · ${expected.length} pending`}
        />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1.4fr_1fr]">
        <Panel title="Visitor volume by hour">
          <div className="flex h-64 items-end gap-3 px-5 pb-9 pt-6">
            {byHour.map((b) => (
              <div key={b.hour} className="relative flex-1">
                <div
                  className="w-full rounded-t-lg bg-hero-gradient"
                  style={{ height: `${Math.max(6, (b.count / peak) * 170)}px` }}
                  title={`${b.count} visitors`}
                />
                <span className="absolute -bottom-6 left-0 w-full text-center text-[10px] text-muted-foreground">
                  {String(b.hour).padStart(2, "0")}
                </span>
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Visitors by department">
          <div className="p-5">
            <div className="space-y-3">
              {byDepartment.length === 0 && (
                <p className="text-sm text-muted-foreground">No visits recorded yet.</p>
              )}
              {byDepartment.map(([code, count]) => (
                <div key={code}>
                  <div className="flex items-center justify-between text-xs font-semibold">
                    <span>{code}</span>
                    <span className="text-muted-foreground">
                      {count} · {Math.round((count / Math.max(1, all.length)) * 100)}%
                    </span>
                  </div>
                  <div className="mt-1.5 h-2 rounded-full bg-muted">
                    <div
                      className="h-2 rounded-full bg-primary"
                      style={{ width: `${(count / Math.max(1, all.length)) * 100}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Panel>
      </div>

      <Panel title="Recent activity" className="mt-4">
        <DataTable head={["Visitor", "Department", "Host", "Check-in", "Duration", "Status"]}>
          {all.slice(0, 8).map((v) => (
            <tr key={v.id}>
              <Td className="font-semibold">{fullName(v.visitors)}</Td>
              <Td>{v.departments?.code ?? "—"}</Td>
              <Td>{v.hosts?.full_name ?? "—"}</Td>
              <Td>{formatTime(v.checked_in_at)}</Td>
              <Td>
                {v.status === "inside"
                  ? formatDuration(minutesSince(v.checked_in_at))
                  : v.checked_out_at
                    ? formatDuration(
                        Math.round(
                          (new Date(v.checked_out_at).getTime() -
                            new Date(v.checked_in_at).getTime()) /
                            60000,
                        ),
                      )
                    : "—"}
              </Td>
              <Td>
                <Badge
                  variant={
                    v.status === "checked_out" ? "secondary" : isOverdue(v) ? "warning" : "success"
                  }
                >
                  {v.status === "checked_out" ? "Checked out" : isOverdue(v) ? "Overdue" : "Inside"}
                </Badge>
              </Td>
            </tr>
          ))}
          {all.length === 0 && <EmptyRow colSpan={6} message="No visits recorded yet." />}
        </DataTable>
      </Panel>
    </div>
  );
}
