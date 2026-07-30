import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Pencil, Plus, ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  createStaffUser,
  deleteStaffUser,
  listStaff,
  updateStaffUser,
} from "@/lib/users.api";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
} from "@/components/dashboard/kit";
import { useSession } from "@/hooks/use-session";
import {
  ROLES,
  assignableRoles,
  canDeleteUser,
  logAudit,
  roleLabel,
  type AppRole,
  type Department,
} from "@/lib/govvisit";

export const Route = createFileRoute("/_authenticated/dashboard/users")({
  head: () => ({
    meta: [
      { title: "User administration — GovVisit" },
      {
        name: "description",
        content:
          "Administer staff accounts: assign roles across the six-level access hierarchy, set department assignments and remove accounts you outrank.",
      },
      { property: "og:title", content: "User administration — GovVisit" },
      {
        property: "og:description",
        content: "Role-based access control for GovVisit staff accounts.",
      },
    ],
  }),
  component: UsersPage,
});

interface StaffRow {
  id: string;
  full_name: string;
  job_title: string | null;
  facility: string | null;
  department_id: string | null;
  email: string;
  role: AppRole | null;
  rank: number;
}

function UsersPage() {
  const { data: session } = useSession();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<StaffRow | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [addForm, setAddForm] = useState({
    email: "",
    password: "",
    full_name: "",
    job_title: "",
    department_id: "",
    role: "receptionist" as AppRole,
  });
  const [form, setForm] = useState({
    full_name: "",
    job_title: "",
    email: "",
    password: "",
    department_id: "",
    role: "receptionist" as AppRole,
  });
  const [search, setSearch] = useState("");

  const createStaff = createStaffUser;
  const fetchStaff = listStaff;
  const saveStaff = updateStaffUser;
  const removeStaff = deleteStaffUser;
  const options = assignableRoles(session);

  const departments = useQuery({
    queryKey: ["departments"],
    queryFn: async () => {
      const { data, error } = await supabase.from("departments").select("*").order("name");
      if (error) throw error;
      return data as Department[];
    },
  });

  const staff = useQuery({
    queryKey: ["staff", "admin"],
    queryFn: async () => {
      const result = await fetchStaff();
      return (result.staff ?? []) as StaffRow[];
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      await createStaff({
        email: addForm.email.trim(),
        password: addForm.password,
        full_name: addForm.full_name.trim(),
        job_title: addForm.job_title.trim(),
        department_id: addForm.department_id || null,
        role: addForm.role,
      });
      await logAudit(`Staff account created · ${roleLabel(addForm.role)}`, addForm.full_name);
    },
    onSuccess: () => {
      toast.success("Staff account created");
      setAddOpen(false);
      setAddForm({
        email: "",
        password: "",
        full_name: "",
        job_title: "",
        department_id: "",
        role: "receptionist" as AppRole,
      });
      queryClient.invalidateQueries({ queryKey: ["staff"] });
      queryClient.invalidateQueries({ queryKey: ["audit"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const save = useMutation({
    mutationFn: async () => {
      if (!editing) return;
      await saveStaff({
        id: editing.id,
        full_name: form.full_name.trim(),
        job_title: form.job_title.trim(),
        department_id: form.department_id || null,
        role: form.role,
        ...(form.email.trim() && form.email.trim() !== editing.email
          ? { email: form.email.trim() }
          : {}),
        ...(form.password ? { password: form.password } : {}),
      });
      await logAudit(`Staff account updated · ${roleLabel(form.role)}`, form.full_name);
    },
    onSuccess: () => {
      toast.success("Staff account updated");
      setOpen(false);
      setEditing(null);
      queryClient.invalidateQueries({ queryKey: ["staff"] });
      queryClient.invalidateQueries({ queryKey: ["session"] });
      queryClient.invalidateQueries({ queryKey: ["audit"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (row: StaffRow) => {
      await removeStaff({ id: row.id });
      await logAudit("Staff account deleted", row.full_name);
    },
    onSuccess: () => {
      toast.success("Staff account removed");
      queryClient.invalidateQueries({ queryKey: ["staff"] });
      queryClient.invalidateQueries({ queryKey: ["audit"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function edit(row: StaffRow) {
    setEditing(row);
    setForm({
      full_name: row.full_name,
      job_title: row.job_title ?? "",
      email: row.email,
      password: "",
      department_id: row.department_id ?? "",
      role: row.role ?? "receptionist",
    });
    setOpen(true);
  }

  const deptName = (id: string | null) => departments.data?.find((d) => d.id === id)?.name ?? "—";

  const rows = (staff.data ?? []).filter((s) =>
    `${s.full_name} ${s.email} ${s.job_title ?? ""} ${roleLabel(s.role)}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );

  const canEdit = (row: StaffRow) => {
    const rank = session?.rank ?? 99;
    if (rank === 1) return true;
    if (row.id === session?.userId) return true;
    if (rank === 2) return row.rank >= 2;
    if (rank >= 3 && rank <= 5)
      return row.rank >= rank && row.department_id === session?.departmentId;
    return false;
  };

  // The global Receptionist has no administration rights at all.
  if (session && session.rank > 5) {
    return (
      <div>
        <PageHeader
          title="User administration"
          description="Staff accounts are managed by facility and department administrators."
        />
        <Panel>
          <p className="p-6 text-sm text-muted-foreground">
            Your role ({roleLabel(session.role)}) does not have access to staff accounts. You can
            check visitors in and out from the reception desk app.
          </p>
        </Panel>
      </div>
    );
  }

  /** Editable role choices: the account's current role stays selectable. */
  const roleOptions = (current: AppRole | null) => {
    const list = options.map((r) => ({ value: r.role, label: r.label }));
    if (current && !list.some((o) => o.value === current)) {
      list.unshift({ value: current, label: `${roleLabel(current)} (current)` });
    }
    return list;
  };

  return (
    <div>
      <PageHeader
        title="User administration"
        description="Assign roles and departments. You see and administer only the accounts your role covers — deletion rights follow the access hierarchy."
      />

      <div className="grid gap-4">
        <Panel
          title={`${rows.length} staff account${rows.length === 1 ? "" : "s"}`}
          actions={
            <div className="flex items-center gap-2">
              <TextFieldInline value={search} onChange={setSearch} />
              <Button
                size="sm"
                disabled={options.length === 0}
                onClick={() => {
                  setAddForm((f) => ({
                    ...f,
                    department_id: session?.departmentId ?? "",
                    role: options[0]?.role ?? ("receptionist" as AppRole),
                  }));
                  setAddOpen(true);
                }}
              >
                <Plus /> Add user
              </Button>
            </div>
          }
        >
          <DataTable
            head={["Staff member", "Email address", "Job title", "Department", "Role", ""]}
          >
            {rows.map((s) => {
              const deletable = canDeleteUser(session, {
                userId: s.id,
                rank: s.rank,
                departmentId: s.department_id,
              });
              return (
                <tr key={s.id}>
                  <Td className="font-semibold">
                    {s.full_name}
                    {s.id === session?.userId && (
                      <span className="ml-2 text-[11px] font-normal text-muted-foreground">
                        (you)
                      </span>
                    )}
                  </Td>
                  <Td className="text-muted-foreground">{s.email || "—"}</Td>
                  <Td>{s.job_title ?? "—"}</Td>
                  <Td>{deptName(s.department_id)}</Td>
                  <Td>
                    <Badge
                      variant={
                        s.rank === 1
                          ? "gold"
                          : s.rank <= 2
                            ? "success"
                            : s.rank <= 5
                              ? "secondary"
                              : "outline"
                      }
                    >
                      {roleLabel(s.role)}
                    </Badge>
                  </Td>
                  <Td>
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Edit staff account"
                        disabled={!canEdit(s)}
                        onClick={() => edit(s)}
                      >
                        <Pencil />
                      </Button>
                      <DeleteButton
                        label="Delete staff account"
                        disabled={!deletable}
                        description="The profile, assigned roles and sign-in credentials are permanently removed."
                        onConfirm={() => remove.mutate(s)}
                      />
                    </div>
                  </Td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <EmptyRow
                colSpan={6}
                message={
                  staff.isLoading
                    ? "Loading staff accounts…"
                    : "No staff accounts visible to your role."
                }
              />
            )}
          </DataTable>
        </Panel>

        <Panel title="Access hierarchy">
          <ul className="grid divide-y divide-border md:grid-cols-2 md:divide-y-0 xl:grid-cols-3">
            {ROLES.map((r) => (
              <li key={r.role} className="p-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="flex items-center gap-2 text-sm font-bold">
                    <ShieldCheck className="size-4 text-primary" />
                    {r.label}
                  </p>
                  <Badge variant="secondary">{r.scope}</Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{r.summary}</p>
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      <FormDialog
        open={open}
        onOpenChange={(v) => {
          setOpen(v);
          if (!v) setEditing(null);
        }}
        title="Edit staff account"
        description="Change the person's details, email address, department assignment and role."
        submitLabel="Save account"
        busy={save.isPending}
        onSubmit={() => save.mutate()}
      >
        <TextField
          label="Full name"
          required
          value={form.full_name}
          onChange={(v) => setForm({ ...form, full_name: v })}
        />
        <TextField
          label="Email address (sign-in)"
          type="email"
          required
          value={form.email}
          onChange={(v) => setForm({ ...form, email: v })}
        />
        <TextField
          label="Job title"
          value={form.job_title}
          onChange={(v) => setForm({ ...form, job_title: v })}
        />
        <SelectField
          label="Assigned department"
          value={form.department_id}
          onChange={(v) => setForm({ ...form, department_id: v })}
          placeholder="No department (facility-wide)"
          options={(departments.data ?? []).map((d) => ({ value: d.id, label: d.name }))}
        />
        <SelectField
          label="Role"
          value={form.role}
          onChange={(v) => setForm({ ...form, role: v as AppRole })}
          options={roleOptions(editing?.role ?? null)}
        />
        <TextField
          label="Reset password (optional)"
          type="password"
          placeholder="Leave blank to keep the current password"
          value={form.password}
          onChange={(v) => setForm({ ...form, password: v })}
        />
      </FormDialog>

      <FormDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        title="Add staff account"
        description="Creates a sign-in account with the details and role below. Share the temporary password with the staff member."
        submitLabel="Create account"
        busy={create.isPending}
        onSubmit={() => create.mutate()}
      >
        <TextField
          label="Full name"
          required
          value={addForm.full_name}
          onChange={(v) => setAddForm({ ...addForm, full_name: v })}
        />
        <TextField
          label="Work email"
          type="email"
          required
          value={addForm.email}
          onChange={(v) => setAddForm({ ...addForm, email: v })}
        />
        <TextField
          label="Temporary password"
          type="password"
          required
          placeholder="At least 8 characters"
          value={addForm.password}
          onChange={(v) => setAddForm({ ...addForm, password: v })}
        />
        <TextField
          label="Job title"
          value={addForm.job_title}
          onChange={(v) => setAddForm({ ...addForm, job_title: v })}
        />
        <SelectField
          label="Assigned department"
          value={addForm.department_id}
          onChange={(v) => setAddForm({ ...addForm, department_id: v })}
          placeholder="No department (facility-wide)"
          options={(departments.data ?? []).map((d) => ({ value: d.id, label: d.name }))}
        />
        <SelectField
          label="Role"
          value={addForm.role}
          onChange={(v) => setAddForm({ ...addForm, role: v as AppRole })}
          options={options.map((r) => ({ value: r.role, label: r.label }))}
        />
      </FormDialog>
    </div>
  );
}

function TextFieldInline({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input
      className="h-9 w-56 rounded-lg border border-input bg-background px-3 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
      placeholder="Search staff or email"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
