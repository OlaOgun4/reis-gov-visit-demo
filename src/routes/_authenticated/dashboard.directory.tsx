import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Pencil } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
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
  Td,
  TextField,
  TablePagination,
  useTableView,
} from "@/components/dashboard/kit";
import { useRowsPerPage } from "@/hooks/use-rows-per-page";
import { useSession } from "@/hooks/use-session";
import { canDeleteDept, canManageDept, logAudit, type Department, type Host } from "@/lib/govvisit";

export const Route = createFileRoute("/_authenticated/dashboard/directory")({
  head: () => ({
    meta: [
      { title: "Departments & hosts — GovVisit" },
      {
        name: "description",
        content:
          "Maintain the department directory and the host list reception uses when registering visitors.",
      },
      { property: "og:title", content: "Departments & hosts — GovVisit" },
      { property: "og:description", content: "Facility directory administration." },
    ],
  }),
  component: DirectoryPage,
});

const emptyDept = { name: "", code: "", active: "true" };
const emptyHost = {
  full_name: "",
  job_title: "",
  email: "",
  phone: "",
  department_id: "",
  active: "true",
};

function DirectoryPage() {
  const { data: session } = useSession();
  const isAdmin = Boolean(session && session.rank <= 2);
  const queryClient = useQueryClient();
  const [deptOpen, setDeptOpen] = useState(false);
  const [deptId, setDeptId] = useState<string | null>(null);
  const [deptForm, setDeptForm] = useState(emptyDept);
  const [hostOpen, setHostOpen] = useState(false);
  const [hostId, setHostId] = useState<string | null>(null);
  const pageSize = useRowsPerPage();
  const [deptSearch, setDeptSearch] = useState("");
  const [hostSearch, setHostSearch] = useState("");
  const [hostForm, setHostForm] = useState(emptyHost);

  const departments = useQuery({
    queryKey: ["departments"],
    queryFn: async () => {
      const { data, error } = await supabase.from("departments").select("*").order("name");
      if (error) throw error;
      return data as Department[];
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
    queryClient.invalidateQueries({ queryKey: ["departments"] });
    queryClient.invalidateQueries({ queryKey: ["hosts"] });
    queryClient.invalidateQueries({ queryKey: ["audit"] });
  }

  const saveDept = useMutation({
    mutationFn: async () => {
      const payload = {
        name: deptForm.name,
        code: deptForm.code.toUpperCase(),
        active: deptForm.active === "true",
      };
      if (deptId) {
        const { error } = await supabase.from("departments").update(payload).eq("id", deptId);
        if (error) throw error;
        await logAudit("Department updated", payload.code);
      } else {
        const { error } = await supabase.from("departments").insert(payload);
        if (error) throw error;
        await logAudit("Department created", payload.code);
      }
    },
    onSuccess: () => {
      toast.success("Department saved");
      setDeptOpen(false);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const removeDept = useMutation({
    mutationFn: async (d: Department) => {
      const { error } = await supabase.from("departments").delete().eq("id", d.id);
      if (error) throw error;
      await logAudit("Department deleted", d.code);
    },
    onSuccess: () => {
      toast.success("Department deleted");
      invalidate();
    },
    onError: (e: Error) =>
      toast.error(
        e.message.includes("foreign key")
          ? "Remove or reassign hosts and visits in this department first."
          : e.message,
      ),
  });

  const saveHost = useMutation({
    mutationFn: async () => {
      const payload = {
        full_name: hostForm.full_name,
        job_title: hostForm.job_title,
        email: hostForm.email || null,
        phone: hostForm.phone || null,
        department_id: hostForm.department_id,
        active: hostForm.active === "true",
      };
      if (hostId) {
        const { error } = await supabase.from("hosts").update(payload).eq("id", hostId);
        if (error) throw error;
        await logAudit("Host updated", payload.full_name);
      } else {
        const { error } = await supabase.from("hosts").insert(payload);
        if (error) throw error;
        await logAudit("Host created", payload.full_name);
      }
    },
    onSuccess: () => {
      toast.success("Host saved");
      setHostOpen(false);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const removeHost = useMutation({
    mutationFn: async (h: Host) => {
      const { error } = await supabase.from("hosts").delete().eq("id", h.id);
      if (error) throw error;
      await logAudit("Host deleted", h.full_name);
    },
    onSuccess: () => {
      toast.success("Host deleted");
      invalidate();
    },
    onError: (e: Error) =>
      toast.error(
        e.message.includes("foreign key")
          ? "This host is linked to visits or bookings and cannot be deleted."
          : e.message,
      ),
  });

  const deptQuery = deptSearch.trim().toLowerCase();
  const hostQuery = hostSearch.trim().toLowerCase();

  /** Searching hosts narrows the department list to the departments those hosts belong to. */
  const visibleDepartments = (departments.data ?? []).filter((d) => {
    if (!hostQuery) return true;
    return (hosts.data ?? []).some(
      (h) =>
        h.department_id === d.id &&
        `${h.full_name} ${h.job_title} ${h.email ?? ""} ${h.phone ?? ""}`
          .toLowerCase()
          .includes(hostQuery),
    );
  });

  /** Searching departments narrows the host list to hosts inside the matching departments. */
  const visibleHosts = (hosts.data ?? []).filter((h) => {
    if (!deptQuery) return true;
    return (departments.data ?? []).some(
      (d) =>
        d.id === h.department_id && `${d.name} ${d.code}`.toLowerCase().includes(deptQuery),
    );
  });

  const deptView = useTableView(visibleDepartments, {
    pageSize,
    search: deptSearch,
    searchText: (d) => `${d.name} ${d.code}`,
    sorters: {
      name: (d) => d.name,
      code: (d) => d.code,
      status: (d) => String(d.active),
    },
    initialSort: "name",
  });

  const hostView = useTableView(visibleHosts, {
    pageSize,
    search: hostSearch,
    searchText: (h) =>
      `${h.full_name} ${h.job_title} ${h.email ?? ""} ${h.phone ?? ""} ${h.departments?.code ?? ""}`,
    sorters: {
      host: (h) => h.full_name,
      department: (h) => h.departments?.code ?? "",
      contact: (h) => h.email ?? "",
      status: (h) => String(h.active),
    },
    initialSort: "host",
  });

  return (
    <div>
      <PageHeader
        title="Departments & hosts"
        description="Directory reception uses to route visitors to the right officer."
      />

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel
          title="Departments"
          actions={
            <>
            <Input
              className="w-40"
              placeholder="Search"
              value={deptSearch}
              onChange={(e) => setDeptSearch(e.target.value)}
            />
            <Button
              size="sm"
              disabled={!isAdmin}
              onClick={() => {
                setDeptId(null);
                setDeptForm(emptyDept);
                setDeptOpen(true);
              }}
            >
              Add department
            </Button>
            </>
          }
        >
          <DataTable
            sortKey={deptView.sortKey}
            sortDir={deptView.sortDir}
            onSort={deptView.toggleSort}
            head={[
              { label: "Department", sortKey: "name" },
              { label: "Code", sortKey: "code" },
              { label: "Status", sortKey: "status" },
              "",
            ]}
          >
            {deptView.rows.map((d) => (
              <tr key={d.id}>
                <Td className="font-semibold">{d.name}</Td>
                <Td>{d.code}</Td>
                <Td>
                  <Badge variant={d.active ? "success" : "secondary"}>
                    {d.active ? "Active" : "Inactive"}
                  </Badge>
                </Td>
                <Td>
                  <div className="flex items-center justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Edit department"
                      disabled={!isAdmin}
                      onClick={() => {
                        setDeptId(d.id);
                        setDeptForm({ name: d.name, code: d.code, active: String(d.active) });
                        setDeptOpen(true);
                      }}
                    >
                      <Pencil />
                    </Button>
                    <DeleteButton
                      label="Delete department"
                      disabled={!isAdmin}
                      onConfirm={() => removeDept.mutate(d)}
                    />
                  </div>
                </Td>
              </tr>
            ))}
            {deptView.rows.length === 0 && (
              <EmptyRow colSpan={4} message="No departments yet." />
            )}
          </DataTable>
          <TablePagination view={deptView} noun="departments" />
        </Panel>

        <Panel
          title="Hosts"
          actions={
            <>
            <Input
              className="w-40"
              placeholder="Search"
              value={hostSearch}
              onChange={(e) => setHostSearch(e.target.value)}
            />
            <Button
              size="sm"
              disabled={!isAdmin || (departments.data ?? []).length === 0}
              onClick={() => {
                setHostId(null);
                setHostForm({
                  ...emptyHost,
                  department_id: departments.data?.[0]?.id ?? "",
                });
                setHostOpen(true);
              }}
            >
              Add host
            </Button>
            </>
          }
        >
          <DataTable
            sortKey={hostView.sortKey}
            sortDir={hostView.sortDir}
            onSort={hostView.toggleSort}
            head={[
              { label: "Host", sortKey: "host" },
              { label: "Department", sortKey: "department" },
              { label: "Contact", sortKey: "contact" },
              { label: "Status", sortKey: "status" },
              "",
            ]}
          >
            {hostView.rows.map((h) => (
              <tr key={h.id}>
                <Td className="font-semibold">
                  {h.full_name}
                  <span className="block text-[11px] font-normal text-muted-foreground">
                    {h.job_title}
                  </span>
                </Td>
                <Td>{h.departments?.code ?? "—"}</Td>
                <Td>
                  {h.email ?? "—"}
                  <span className="block text-[11px] text-muted-foreground">{h.phone ?? ""}</span>
                </Td>
                <Td>
                  <Badge variant={h.active ? "success" : "secondary"}>
                    {h.active ? "Active" : "Inactive"}
                  </Badge>
                </Td>
                <Td>
                  <div className="flex items-center justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Edit host"
                      disabled={!isAdmin}
                      onClick={() => {
                        setHostId(h.id);
                        setHostForm({
                          full_name: h.full_name,
                          job_title: h.job_title,
                          email: h.email ?? "",
                          phone: h.phone ?? "",
                          department_id: h.department_id,
                          active: String(h.active),
                        });
                        setHostOpen(true);
                      }}
                    >
                      <Pencil />
                    </Button>
                    <DeleteButton
                      label="Delete host"
                      disabled={!isAdmin}
                      onConfirm={() => removeHost.mutate(h)}
                    />
                  </div>
                </Td>
              </tr>
            ))}
            {hostView.rows.length === 0 && <EmptyRow colSpan={5} message="No hosts yet." />}
          </DataTable>
          <TablePagination view={hostView} noun="hosts" />
        </Panel>
      </div>

      <FormDialog
        open={deptOpen}
        onOpenChange={setDeptOpen}
        title={deptId ? "Edit department" : "Add department"}
        busy={saveDept.isPending}
        onSubmit={() => saveDept.mutate()}
      >
        <TextField
          label="Department name"
          required
          value={deptForm.name}
          onChange={(v) => setDeptForm({ ...deptForm, name: v })}
        />
        <TextField
          label="Short code"
          required
          placeholder="ICT"
          value={deptForm.code}
          onChange={(v) => setDeptForm({ ...deptForm, code: v })}
        />
        <SelectField
          label="Status"
          value={deptForm.active}
          onChange={(v) => setDeptForm({ ...deptForm, active: v })}
          options={[
            { value: "true", label: "Active" },
            { value: "false", label: "Inactive" },
          ]}
        />
      </FormDialog>

      <FormDialog
        open={hostOpen}
        onOpenChange={setHostOpen}
        title={hostId ? "Edit host" : "Add host"}
        busy={saveHost.isPending}
        onSubmit={() => saveHost.mutate()}
      >
        <TextField
          label="Full name"
          required
          value={hostForm.full_name}
          onChange={(v) => setHostForm({ ...hostForm, full_name: v })}
        />
        <TextField
          label="Job title"
          required
          value={hostForm.job_title}
          onChange={(v) => setHostForm({ ...hostForm, job_title: v })}
        />
        <SelectField
          label="Department"
          value={hostForm.department_id}
          onChange={(v) => setHostForm({ ...hostForm, department_id: v })}
          options={(departments.data ?? []).map((d) => ({
            value: d.id,
            label: `${d.name} (${d.code})`,
          }))}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Email"
            type="email"
            value={hostForm.email}
            onChange={(v) => setHostForm({ ...hostForm, email: v })}
          />
          <TextField
            label="Phone"
            value={hostForm.phone}
            onChange={(v) => setHostForm({ ...hostForm, phone: v })}
          />
        </div>
        <SelectField
          label="Status"
          value={hostForm.active}
          onChange={(v) => setHostForm({ ...hostForm, active: v })}
          options={[
            { value: "true", label: "Active" },
            { value: "false", label: "Inactive" },
          ]}
        />
      </FormDialog>
    </div>
  );
}
