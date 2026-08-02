import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Pencil } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/use-session";
import { useRealtimeVisits } from "@/hooks/use-realtime-visits";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AreaField,
  DataTable,
  DeleteButton,
  EmptyRow,
  FormDialog,
  PageHeader,
  Panel,
  SelectField,
  Td,
  TablePagination,
  useTableView,
} from "@/components/dashboard/kit";
import { useRowsPerPage } from "@/hooks/use-rows-per-page";
import {
  canDeleteDept,
  ACCESS_ZONES,
  DURATIONS,
  VISIT_SELECT,
  downloadCsv,
  formatDuration,
  formatTime,
  fullName,
  isOverdue,
  logAudit,
  minutesSince,
  visitTypeLabel,
  type Host,
  type Visit,
} from "@/lib/govvisit";

export const Route = createFileRoute("/_authenticated/dashboard/live")({
  head: () => ({
    meta: [
      { title: "Live visitors — GovVisit" },
      {
        name: "description",
        content:
          "Everyone currently inside the facility, their host, duration onsite and overdue status, with checkout and evacuation export.",
      },
      { property: "og:title", content: "Live visitors — GovVisit" },
      { property: "og:description", content: "Real-time facility occupancy list." },
    ],
  }),
  component: LiveVisitors,
});

function LiveVisitors() {
  useRealtimeVisits();
  const { data: session } = useSession();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Visit | null>(null);
  const [form, setForm] = useState({ hostId: "", minutes: "60", zone: ACCESS_ZONES[0], notes: "" });

  const visits = useQuery({
    queryKey: ["visits", "inside"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("visits")
        .select(VISIT_SELECT)
        .eq("status", "inside")
        .order("checked_in_at", { ascending: false });
      if (error) throw error;
      return data as Visit[];
    },
  });

  const hosts = useQuery({
    queryKey: ["hosts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("hosts")
        .select("*, departments(name, code)")
        .order("full_name");
      if (error) throw error;
      return data as Host[];
    },
  });

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["visits"] });
    queryClient.invalidateQueries({ queryKey: ["audit"] });
  }

  const save = useMutation({
    mutationFn: async () => {
      if (!editing) return;
      const { error } = await supabase
        .from("visits")
        .update({
          host_id: form.hostId || null,
          expected_minutes: Number(form.minutes),
          access_zone: form.zone,
          notes: form.notes || null,
        })
        .eq("id", editing.id);
      if (error) throw error;
      await logAudit("Visit record updated", editing.pass_code);
    },
    onSuccess: () => {
      toast.success("Visit updated");
      setEditing(null);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const checkout = useMutation({
    mutationFn: async (visit: Visit) => {
      const { error } = await supabase
        .from("visits")
        .update({
          status: "checked_out",
          checked_out_at: new Date().toISOString(),
          badge_returned: true,
        })
        .eq("id", visit.id);
      if (error) throw error;
      await logAudit("Visitor checkout", visit.pass_code);
    },
    onSuccess: () => {
      toast.success("Visitor checked out");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (visit: Visit) => {
      const { error } = await supabase.from("visits").delete().eq("id", visit.id);
      if (error) throw error;
      await logAudit("Visit record deleted", visit.pass_code);
    },
    onSuccess: () => {
      toast.success("Visit deleted");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rows = visits.data ?? [];
  const view = useTableView(rows, {
    pageSize,
    search,
    searchText: (v) =>
      `${fullName(v.visitors)} ${v.hosts?.full_name ?? ""} ${v.departments?.name ?? ""} ${v.pass_code} ${v.visitors?.organisation ?? ""}`,
    sorters: {
      visitor: (v) => fullName(v.visitors),
      type: (v) => v.visit_type,
      organisation: (v) => v.visitors?.organisation ?? "",
      department: (v) => v.departments?.code ?? "",
      host: (v) => v.hosts?.full_name ?? "",
      checkin: (v) => v.checked_in_at,
      duration: (v) => new Date(v.checked_in_at).getTime(),
      status: (v) => v.status,
    },
    initialSort: "checkin",
    initialDir: "desc",
  });

  return (
    <div>
      <PageHeader
        title="Live visitors"
        description={`${view.total} visitor${view.total === 1 ? "" : "s"} currently inside the facility.`}
        actions={
          <Button
            onClick={() => {
              downloadCsv(
                "evacuation-list.csv",
                rows.map((v) => ({
                  visitor: fullName(v.visitors),
                  pass: v.pass_code,
                  organisation: v.visitors?.organisation ?? "",
                  department: v.departments?.name ?? "",
                  host: v.hosts?.full_name ?? "",
                  checked_in: formatTime(v.checked_in_at),
                  zone: v.access_zone,
                })),
              );
              void logAudit("Evacuation list exported", "EVAC");
              queryClient.invalidateQueries({ queryKey: ["audit"] });
            }}
          >
            Export evacuation list
          </Button>
        }
      />

      <Panel
        title="Visitors currently inside"
        actions={
          <Input
            className="w-56"
            placeholder="Search visitors"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        }
      >
        <DataTable
          sortKey={view.sortKey}
          sortDir={view.sortDir}
          onSort={view.toggleSort}
          head={[
            { label: "Visitor", sortKey: "visitor" },
            { label: "Type", sortKey: "type" },
            { label: "Organisation", sortKey: "organisation" },
            { label: "Department", sortKey: "department" },
            { label: "Host", sortKey: "host" },
            { label: "Check-in", sortKey: "checkin" },
            { label: "Duration", sortKey: "duration" },
            { label: "Status", sortKey: "status" },
            "",
          ]}
        >
          {view.rows.map((v) => (
            <tr key={v.id}>
              <Td className="font-semibold">
                {fullName(v.visitors)}
                <span className="block text-[11px] font-normal text-muted-foreground">
                  {v.pass_code}
                </span>
              </Td>
              <Td>
                <Badge variant="secondary">{visitTypeLabel(v.visit_type)}</Badge>
              </Td>
              <Td>{v.visitors?.organisation ?? "—"}</Td>
              <Td>{v.departments?.code ?? "—"}</Td>
              <Td>{v.hosts?.full_name ?? "—"}</Td>
              <Td>{formatTime(v.checked_in_at)}</Td>
              <Td>{formatDuration(minutesSince(v.checked_in_at))}</Td>
              <Td>
                <Badge variant={isOverdue(v) ? "warning" : "success"}>
                  {isOverdue(v) ? "Overdue" : "Inside"}
                </Badge>
              </Td>
              <Td>
                <div className="flex items-center justify-end gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Edit visit"
                    onClick={() => {
                      setEditing(v);
                      setForm({
                        hostId: v.host_id ?? "",
                        minutes: String(v.expected_minutes),
                        zone: v.access_zone,
                        notes: v.notes ?? "",
                      });
                    }}
                  >
                    <Pencil />
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => checkout.mutate(v)}>
                    Check out
                  </Button>
                  <DeleteButton
                    label="Delete visit"
                    disabled={!canDeleteDept(session, v.department_id)}
                    description="The visit record will be permanently removed from the register."
                    onConfirm={() => remove.mutate(v)}
                  />
                </div>
              </Td>
            </tr>
          ))}
          {view.rows.length === 0 && <EmptyRow colSpan={9} message="Nobody is currently inside." />}
        </DataTable>
        <TablePagination view={view} noun="visitors" />
      </Panel>

      <FormDialog
        open={Boolean(editing)}
        onOpenChange={(v) => !v && setEditing(null)}
        title="Edit active visit"
        description={editing ? `${fullName(editing.visitors)} · ${editing.pass_code}` : undefined}
        busy={save.isPending}
        onSubmit={() => save.mutate()}
      >
        <SelectField
          label="Host"
          value={form.hostId}
          onChange={(v) => setForm({ ...form, hostId: v })}
          placeholder="Unassigned"
          options={(hosts.data ?? []).map((h) => ({
            value: h.id,
            label: `${h.full_name} — ${h.departments?.code ?? ""}`,
          }))}
        />
        <SelectField
          label="Expected duration"
          value={form.minutes}
          onChange={(v) => setForm({ ...form, minutes: v })}
          options={DURATIONS.map((d) => ({ value: String(d.value), label: d.label }))}
        />
        <SelectField
          label="Access zone"
          value={form.zone}
          onChange={(v) => setForm({ ...form, zone: v })}
          options={ACCESS_ZONES.map((z) => ({ value: z, label: z }))}
        />
        <AreaField
          label="Notes"
          value={form.notes}
          onChange={(v) => setForm({ ...form, notes: v })}
        />
      </FormDialog>
    </div>
  );
}
