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
  Td,
} from "@/components/dashboard/kit";
import { useSession } from "@/hooks/use-session";
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

  const rows = (logs.data ?? []).filter((l) =>
    `${l.actor_name} ${l.event} ${l.record_ref ?? ""}`.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div>
      <PageHeader
        title="Audit logs"
        description="Every registration, checkout, record change and export is recorded."
        actions={
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
        }
      />

      <Panel
        title={`${rows.length} entr${rows.length === 1 ? "y" : "ies"}`}
        actions={
          <Input
            className="w-56"
            placeholder="Search events"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        }
      >
        <DataTable head={["Timestamp", "Actor", "Event", "Record", "Status", ""]}>
          {rows.map((l) => (
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
          {rows.length === 0 && <EmptyRow colSpan={6} message="No audit entries yet." />}
        </DataTable>
      </Panel>
    </div>
  );
}
