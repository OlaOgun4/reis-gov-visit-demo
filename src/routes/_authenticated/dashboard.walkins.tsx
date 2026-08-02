import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/use-session";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DataTable,
  DeleteButton,
  EmptyRow,
  FormDialog,
  PageHeader,
  Panel,
  SelectField,
  StatCard,
  Td,
  TablePagination,
  useTableView,
} from "@/components/dashboard/kit";
import { useRowsPerPage } from "@/hooks/use-rows-per-page";
import {
  canDeleteDept,
  APPROVALS,
  VISIT_SELECT,
  formatDate,
  formatTime,
  fullName,
  isOverdue,
  logAudit,
  type Visit,
} from "@/lib/govvisit";

export const Route = createFileRoute("/_authenticated/dashboard/walkins")({
  head: () => ({
    meta: [
      { title: "Walk-in visits — GovVisit" },
      {
        name: "description",
        content:
          "Review unscheduled walk-in arrivals, update approval routes, check visitors out and remove erroneous entries.",
      },
      { property: "og:title", content: "Walk-in visits — GovVisit" },
      { property: "og:description", content: "Approval queue for unscheduled arrivals." },
    ],
  }),
  component: WalkinsPage,
});

function WalkinsPage() {
  const { data: session } = useSession();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<Visit | null>(null);
  const [approval, setApproval] = useState(APPROVALS[0]);
  const pageSize = useRowsPerPage();
  const [search, setSearch] = useState("");

  const visits = useQuery({
    queryKey: ["visits", "walkins"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("visits")
        .select(VISIT_SELECT)
        .eq("visit_type", "walk_in")
        .order("checked_in_at", { ascending: false });
      if (error) throw error;
      return data as Visit[];
    },
  });

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["visits"] });
    queryClient.invalidateQueries({ queryKey: ["audit"] });
  }

  const save = useMutation({
    mutationFn: async () => {
      if (!editing) return;
      const { error } = await supabase.from("visits").update({ approval }).eq("id", editing.id);
      if (error) throw error;
      await logAudit("Walk-in approval route updated", editing.pass_code);
    },
    onSuccess: () => {
      toast.success("Approval updated");
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
      await logAudit("Walk-in visit deleted", visit.pass_code);
    },
    onSuccess: () => {
      toast.success("Walk-in deleted");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rows = visits.data ?? [];
  const inside = rows.filter((v) => v.status === "inside");
  const view = useTableView(rows, {
    pageSize,
    search,
    searchText: (v) =>
      `${fullName(v.visitors)} ${v.pass_code} ${v.departments?.name ?? ""} ${v.hosts?.full_name ?? ""} ${v.approval} ${v.status}`,
    sorters: {
      pass: (v) => v.pass_code,
      visitor: (v) => fullName(v.visitors),
      department: (v) => v.departments?.code ?? "",
      host: (v) => v.hosts?.full_name ?? "",
      approval: (v) => v.approval,
      arrived: (v) => v.checked_in_at,
      status: (v) => v.status,
    },
    initialSort: "arrived",
    initialDir: "desc",
  });

  return (
    <div>
      <PageHeader
        title="Walk-in visits"
        description="Unscheduled arrivals registered at the reception desk."
      />

      <div className="mb-4 grid gap-4 sm:grid-cols-3">
        <StatCard value={rows.length} label="Total walk-ins" />
        <StatCard value={inside.length} label="Walk-ins inside" />
        <StatCard value={inside.filter((v) => isOverdue(v)).length} label="Overdue walk-ins" />
      </div>

      <Panel
        title="Walk-in register"
        actions={
          <Input
            className="w-56"
            placeholder="Search walk-ins"
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
            { label: "Pass", sortKey: "pass" },
            { label: "Visitor", sortKey: "visitor" },
            { label: "Department", sortKey: "department" },
            { label: "Host", sortKey: "host" },
            { label: "Approval", sortKey: "approval" },
            { label: "Arrived", sortKey: "arrived" },
            { label: "Status", sortKey: "status" },
            "",
          ]}
        >
          {view.rows.map((v) => (
            <tr key={v.id}>
              <Td className="text-xs text-muted-foreground">{v.pass_code}</Td>
              <Td className="font-semibold">
                {fullName(v.visitors)}
                <span className="block text-[11px] font-normal text-muted-foreground">
                  {v.visitors?.organisation ?? ""}
                </span>
              </Td>
              <Td>{v.departments?.code ?? "—"}</Td>
              <Td>{v.hosts?.full_name ?? "—"}</Td>
              <Td>{v.approval}</Td>
              <Td>
                {formatDate(v.checked_in_at)}
                <span className="block text-[11px] text-muted-foreground">
                  {formatTime(v.checked_in_at)}
                </span>
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
              <Td>
                <div className="flex items-center justify-end gap-1">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setEditing(v);
                      setApproval(v.approval);
                    }}
                  >
                    Approval
                  </Button>
                  {v.status === "inside" && (
                    <Button size="sm" variant="secondary" onClick={() => checkout.mutate(v)}>
                      Check out
                    </Button>
                  )}
                  <DeleteButton
                    label="Delete walk-in"
                    disabled={!canDeleteDept(session, v.department_id)}
                    description="The walk-in visit record will be permanently removed."
                    onConfirm={() => remove.mutate(v)}
                  />
                </div>
              </Td>
            </tr>
          ))}
          {view.rows.length === 0 && <EmptyRow colSpan={8} message="No walk-in visits recorded." />}
        </DataTable>
        <TablePagination view={view} noun="walk-ins" />
      </Panel>

      <FormDialog
        open={Boolean(editing)}
        onOpenChange={(v) => !v && setEditing(null)}
        title="Update approval route"
        description={editing ? `${fullName(editing.visitors)} · ${editing.pass_code}` : undefined}
        busy={save.isPending}
        onSubmit={() => save.mutate()}
      >
        <SelectField
          label="Approval route"
          value={approval}
          onChange={setApproval}
          options={APPROVALS.map((a) => ({ value: a, label: a }))}
        />
      </FormDialog>
    </div>
  );
}
