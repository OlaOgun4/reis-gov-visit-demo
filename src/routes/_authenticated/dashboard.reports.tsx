import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DataTable,
  EmptyRow,
  PageHeader,
  Panel,
  SelectField,
  StatCard,
  Td,
  TextField,
} from "@/components/dashboard/kit";
import {
  VISIT_SELECT,
  downloadCsv,
  formatDate,
  formatDuration,
  formatTime,
  fullName,
  logAudit,
  visitTypeLabel,
  type Department,
  type Visit,
} from "@/lib/govvisit";

export const Route = createFileRoute("/_authenticated/dashboard/reports")({
  head: () => ({
    meta: [
      { title: "Visitor reports — GovVisit" },
      {
        name: "description",
        content:
          "Filter the visitor register by date range, department and visit type, then export the results as CSV.",
      },
      { property: "og:title", content: "Visitor reports — GovVisit" },
      { property: "og:description", content: "Exportable visitor register reporting." },
    ],
  }),
  component: ReportsPage,
});

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

function ReportsPage() {
  const start = new Date();
  start.setDate(start.getDate() - 7);
  const [from, setFrom] = useState(isoDate(start));
  const [to, setTo] = useState(isoDate(new Date()));
  const [dept, setDept] = useState("");
  const [type, setType] = useState("");

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

  const departments = useQuery({
    queryKey: ["departments"],
    queryFn: async () => {
      const { data, error } = await supabase.from("departments").select("*").order("name");
      if (error) throw error;
      return data as Department[];
    },
  });

  const rows = useMemo(() => {
    const fromTs = new Date(`${from}T00:00:00`).getTime();
    const toTs = new Date(`${to}T23:59:59`).getTime();
    return (visits.data ?? []).filter((v) => {
      const ts = new Date(v.checked_in_at).getTime();
      if (ts < fromTs || ts > toTs) return false;
      if (dept && v.department_id !== dept) return false;
      if (type && v.visit_type !== type) return false;
      return true;
    });
  }, [visits.data, from, to, dept, type]);

  const durations = rows
    .filter((v) => v.checked_out_at)
    .map((v) =>
      Math.round(
        (new Date(v.checked_out_at!).getTime() - new Date(v.checked_in_at).getTime()) / 60000,
      ),
    );
  const avg = durations.length
    ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
    : 0;

  return (
    <div>
      <PageHeader
        title="Visitor reports"
        description="Filtered extracts of the visitor register for audit and management reporting."
        actions={
          <Button
            onClick={() => {
              downloadCsv(
                `visitor-report-${from}-to-${to}.csv`,
                rows.map((v) => ({
                  pass: v.pass_code,
                  visitor: fullName(v.visitors),
                  organisation: v.visitors?.organisation ?? "",
                  type: visitTypeLabel(v.visit_type),
                  department: v.departments?.name ?? "",
                  host: v.hosts?.full_name ?? "",
                  purpose: v.purpose,
                  date: formatDate(v.checked_in_at),
                  check_in: formatTime(v.checked_in_at),
                  check_out: v.checked_out_at ? formatTime(v.checked_out_at) : "",
                  status: v.status,
                })),
              );
              void logAudit("Visitor report exported", `${from} → ${to}`);
            }}
          >
            Export CSV
          </Button>
        }
      />

      <Panel title="Filters" className="mb-4">
        <div className="grid gap-4 p-5 sm:grid-cols-2 xl:grid-cols-4">
          <TextField label="From" type="date" value={from} onChange={setFrom} />
          <TextField label="To" type="date" value={to} onChange={setTo} />
          <SelectField
            label="Department"
            value={dept}
            onChange={setDept}
            placeholder="All departments"
            options={(departments.data ?? []).map((d) => ({ value: d.id, label: d.name }))}
          />
          <SelectField
            label="Visit type"
            value={type}
            onChange={setType}
            placeholder="All types"
            options={[
              { value: "pre_booked", label: "Pre-booked" },
              { value: "walk_in", label: "Walk-in" },
            ]}
          />
        </div>
      </Panel>

      <div className="mb-4 grid gap-4 sm:grid-cols-3">
        <StatCard value={rows.length} label="Visits in range" />
        <StatCard
          value={rows.filter((v) => v.visit_type === "walk_in").length}
          label="Walk-ins in range"
        />
        <StatCard value={avg ? formatDuration(avg) : "—"} label="Average visit duration" />
      </div>

      <Panel title="Register extract">
        <DataTable
          head={["Pass", "Visitor", "Type", "Department", "Host", "Date", "In", "Out", "Status"]}
        >
          {rows.map((v) => (
            <tr key={v.id}>
              <Td className="text-xs text-muted-foreground">{v.pass_code}</Td>
              <Td className="font-semibold">{fullName(v.visitors)}</Td>
              <Td>{visitTypeLabel(v.visit_type)}</Td>
              <Td>{v.departments?.code ?? "—"}</Td>
              <Td>{v.hosts?.full_name ?? "—"}</Td>
              <Td>{formatDate(v.checked_in_at)}</Td>
              <Td>{formatTime(v.checked_in_at)}</Td>
              <Td>{v.checked_out_at ? formatTime(v.checked_out_at) : "—"}</Td>
              <Td>
                <Badge variant={v.status === "inside" ? "success" : "secondary"}>
                  {v.status === "inside" ? "Inside" : "Checked out"}
                </Badge>
              </Td>
            </tr>
          ))}
          {rows.length === 0 && <EmptyRow colSpan={9} message="No visits match these filters." />}
        </DataTable>
      </Panel>
    </div>
  );
}
