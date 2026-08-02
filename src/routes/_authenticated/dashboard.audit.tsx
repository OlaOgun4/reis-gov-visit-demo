import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DataTable,
  DeleteButton,
  EmptyRow,
  PageHeader,
  Panel,
  TablePagination,
  Td,
  useTableView,
} from "@/components/dashboard/kit";
import { useSession } from "@/hooks/use-session";
import { useRowsPerPage } from "@/hooks/use-rows-per-page";
import { canDeleteAudit, downloadCsv, formatDate, formatTime, type AuditLog } from "@/lib/govvisit";

export const Route = createFileRoute("/_authenticated/dashboard/audit")({
  head: () => ({
    meta: [
      { title: "Audit logs — GovVisit" },
      {
        name: "description",
        content:
          "Chronological trail of reception and administration actions: registrations, checkouts, record changes and exports.",
      },
      { property: "og:title", content: "Audit logs — GovVisit" },
      { property: "og:description", content: "System activity trail for compliance review." },
    ],
  }),
  component: AuditPage,
});

function AuditPage() {
  const { data: session } = useSession();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const pageSize = useRowsPerPage();

  const logs = useQuery({
    queryKey: ["audit"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("audit_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(300);
      if (error) throw error;
      return data as AuditLog[];
    },
  });

  const remove = useMutation({
    mutationFn: async (log: AuditLog) => {
      const { error } = await supabase.from("audit_logs").delete().eq("id", log.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Log entry removed");
      queryClient.invalidateQueries({ queryKey: ["audit"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const clearAll = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("audit_logs")
        .delete()
        .neq("id", "00000000-0000-0000-0000-000000000000");
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("All audit log entries cleared");
      queryClient.invalidateQueries({ queryKey: ["audit"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rows = logs.data ?? [];
  const view = useTableView(rows, {
    pageSize,
    search,
    searchText: (l) => `${l.actor_name} ${l.event} ${l.record_ref ?? ""} ${l.status}`,
    sorters: {
      created_at: (l) => l.created_at,
      actor: (l) => l.actor_name,
      event: (l) => l.event,
      record: (l) => l.record_ref ?? "",
      status: (l) => l.status,
    },
    initialSort: "created_at",
    initialDir: "desc",
  });

  return (
    <div>
      <PageHeader
        title="Audit logs"
        description="Every registration, checkout, record change and export is recorded."
        actions={
          <>
          <Button
            variant="outline"
            onClick={() =>
              downloadCsv(
                "audit-logs.csv",
                rows.map((l) => ({
                  timestamp: `${formatDate(l.created_at)} ${formatTime(l.created_at)}`,
                  actor: l.actor_name,
                  event: l.event,
                  record: l.record_ref ?? "",
                  status: l.status,
                })),
              )
            }
          >
            Export CSV
          </Button>
          {canDeleteAudit(session) && (
            <DeleteButton
              variant="button"
              label="Clear all audit logs"
              description="Every audit entry will be permanently deleted. This is intended for testing."
              onConfirm={() => clearAll.mutate()}
            />
          )}
          </>
        }
      />

      <Panel
        title={`${view.total} entr${view.total === 1 ? "y" : "ies"}`}
        actions={
          <Input
            className="w-56"
            placeholder="Search events"
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
            { label: "Timestamp", sortKey: "created_at" },
            { label: "Actor", sortKey: "actor" },
            { label: "Event", sortKey: "event" },
            { label: "Record", sortKey: "record" },
            { label: "Status", sortKey: "status" },
            "",
          ]}
        >
          {view.rows.map((l) => (
            <tr key={l.id}>
              <Td>
                {formatTime(l.created_at)}
                <span className="block text-[11px] text-muted-foreground">
                  {formatDate(l.created_at)}
                </span>
              </Td>
              <Td className="font-semibold">{l.actor_name}</Td>
              <Td>{l.event}</Td>
              <Td className="text-xs text-muted-foreground">{l.record_ref ?? "—"}</Td>
              <Td>
                <Badge variant={l.status === "Success" ? "success" : "warning"}>{l.status}</Badge>
              </Td>
              <Td>
                <div className="flex justify-end">
                  <DeleteButton
                    label="Delete log entry"
                    disabled={!canDeleteAudit(session)}
                    description="Only the Super Administrator may remove audit entries."
                    onConfirm={() => remove.mutate(l)}
                  />
                </div>
              </Td>
            </tr>
          ))}
          {view.rows.length === 0 && <EmptyRow colSpan={6} message="No audit entries yet." />}
        </DataTable>
        <TablePagination view={view} noun="entries" />
      </Panel>
    </div>
  );
}
