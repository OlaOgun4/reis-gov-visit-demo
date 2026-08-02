import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DataTable,
  EmptyRow,
  PageHeader,
  Panel,
  SelectField,
  Td,
  TextField,
} from "@/components/dashboard/kit";
import { useSession } from "@/hooks/use-session";
import {
  APPROVALS,
  logAudit,
  roleLabel,
  roleRank,
  type AppRole,
  type FacilityConfig,
} from "@/lib/govvisit";

export const Route = createFileRoute("/_authenticated/dashboard/settings")({
  head: () => ({
    meta: [
      { title: "Facility configuration — GovVisit" },
      {
        name: "description",
        content:
          "Set facility identity, approval workflow, overdue grace period and data retention, and manage staff roles.",
      },
      { property: "og:title", content: "Facility configuration — GovVisit" },
      { property: "og:description", content: "Administrator settings and staff role management." },
    ],
  }),
  component: SettingsPage,
});

interface StaffProfile {
  id: string;
  full_name: string;
  job_title: string | null;
  facility: string | null;
}

function SettingsPage() {
  const { data: session } = useSession();
  const isAdmin = Boolean(session && session.rank <= 2);
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

  const [form, setForm] = useState({
    facility_name: "",
    organisation_name: "",
    approval_workflow: APPROVALS[0],
    overdue_grace_minutes: "15",
    retention_months: "24",
    rows_per_page: "10",
  });

  useEffect(() => {
    if (config.data) {
      setForm({
        facility_name: config.data.facility_name,
        organisation_name: config.data.organisation_name,
        approval_workflow: config.data.approval_workflow,
        overdue_grace_minutes: String(config.data.overdue_grace_minutes),
        retention_months: String(config.data.retention_months),
        rows_per_page: String(config.data.rows_per_page ?? 10),
      });
    }
  }, [config.data]);

  const staff = useQuery({
    queryKey: ["staff"],
    queryFn: async () => {
      const [{ data: profiles, error }, { data: roles, error: roleError }] = await Promise.all([
        supabase.from("profiles").select("id, full_name, job_title, facility").order("full_name"),
        supabase.from("user_roles").select("user_id, role"),
      ]);
      if (error) throw error;
      if (roleError) throw roleError;
      return (profiles as StaffProfile[]).map((p) => ({
        ...p,
        roles: (roles ?? []).filter((r) => r.user_id === p.id).map((r) => r.role as AppRole),
      }));
    },
  });

  const saveConfig = useMutation({
    mutationFn: async () => {
      const payload = {
        facility_name: form.facility_name,
        organisation_name: form.organisation_name,
        approval_workflow: form.approval_workflow,
        overdue_grace_minutes: Number(form.overdue_grace_minutes),
        retention_months: Number(form.retention_months),
        rows_per_page: Math.max(1, Number(form.rows_per_page) || 10),
      };
      if (config.data) {
        const { error } = await supabase
          .from("facility_config")
          .update(payload)
          .eq("id", config.data.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("facility_config").insert(payload);
        if (error) throw error;
      }
      await logAudit("Facility configuration updated", payload.facility_name);
    },
    onSuccess: () => {
      toast.success("Configuration saved");
      queryClient.invalidateQueries({ queryKey: ["config"] });
      queryClient.invalidateQueries({ queryKey: ["audit"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div>
      <PageHeader
        title="Facility configuration"
        description="Global settings applied across the reception app and dashboard."
      />

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Facility identity & policy">
          <form
            className="space-y-4 p-5"
            onSubmit={(e) => {
              e.preventDefault();
              saveConfig.mutate();
            }}
          >
            <TextField
              label="Facility name"
              required
              value={form.facility_name}
              onChange={(v) => setForm({ ...form, facility_name: v })}
            />
            <TextField
              label="Organisation name"
              required
              value={form.organisation_name}
              onChange={(v) => setForm({ ...form, organisation_name: v })}
            />
            <SelectField
              label="Default approval workflow"
              value={form.approval_workflow}
              onChange={(v) => setForm({ ...form, approval_workflow: v })}
              options={APPROVALS.map((a) => ({ value: a, label: a }))}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                label="Overdue grace (minutes)"
                type="number"
                value={form.overdue_grace_minutes}
                onChange={(v) => setForm({ ...form, overdue_grace_minutes: v })}
              />
              <TextField
                label="Data retention (months)"
                type="number"
                value={form.retention_months}
                onChange={(v) => setForm({ ...form, retention_months: v })}
              />
            </div>
            <SelectField
              label="Table rows per page"
              value={form.rows_per_page}
              onChange={(v) => setForm({ ...form, rows_per_page: v })}
              options={["5", "10", "20", "25", "50", "100"].map((n) => ({ value: n, label: n }))}
            />
            <Button type="submit" disabled={!isAdmin || saveConfig.isPending}>
              {saveConfig.isPending ? "Saving…" : "Save configuration"}
            </Button>
            {!isAdmin && (
              <p className="text-xs text-muted-foreground">
                Only facility administrators can change these settings.
              </p>
            )}
          </form>
        </Panel>

        <Panel
          title="Staff accounts & roles"
          actions={
            <Button asChild size="sm" variant="outline">
              <Link to="/dashboard/users">Open user administration</Link>
            </Button>
          }
        >
          <DataTable head={["Staff member", "Job title", "Role"]}>
            {(staff.data ?? []).map((s) => (
              <tr key={s.id}>
                <Td className="font-semibold">
                  {s.full_name}
                  {s.id === session?.userId && (
                    <span className="ml-2 text-[11px] font-normal text-muted-foreground">
                      (you)
                    </span>
                  )}
                </Td>
                <Td>{s.job_title ?? "—"}</Td>
                <Td>
                  <Badge variant={s.roles[0] && roleRank(s.roles[0]) <= 2 ? "gold" : "secondary"}>
                    {s.roles[0] ? roleLabel(s.roles[0]) : "No role"}
                  </Badge>
                </Td>
              </tr>
            ))}
            {(staff.data ?? []).length === 0 && (
              <EmptyRow colSpan={3} message="No staff accounts yet." />
            )}
          </DataTable>
        </Panel>
      </div>
    </div>
  );
}
