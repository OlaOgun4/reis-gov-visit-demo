import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Pencil } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/use-session";
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
  TablePagination,
  Td,
  TextField,
  useTableView,
} from "@/components/dashboard/kit";
import { useRowsPerPage } from "@/hooks/use-rows-per-page";
import {
  canDeleteDept,
  PURPOSES,
  formatDate,
  formatTime,
  logAudit,
  type Booking,
  type BookingStatus,
  type Department,
  type Host,
} from "@/lib/govvisit";

export const Route = createFileRoute("/_authenticated/dashboard/bookings")({
  head: () => ({
    meta: [
      { title: "Pre-booked visits — GovVisit" },
      {
        name: "description",
        content:
          "Create and manage expected visitor appointments, assign hosts and departments, and track arrival status.",
      },
      { property: "og:title", content: "Pre-booked visits — GovVisit" },
      { property: "og:description", content: "Appointment register for expected visitors." },
    ],
  }),
  component: BookingsPage,
});

function toLocalInput(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const empty = {
  visitor_name: "",
  organisation: "",
  phone: "",
  department_id: "",
  host_id: "",
  purpose: PURPOSES[0],
  expected_at: toLocalInput(new Date().toISOString()),
  status: "expected" as BookingStatus,
  notes: "",
};

function BookingsPage() {
  const { data: session } = useSession();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(empty);
  const pageSize = useRowsPerPage();

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
    queryClient.invalidateQueries({ queryKey: ["bookings"] });
    queryClient.invalidateQueries({ queryKey: ["audit"] });
  }

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        visitor_name: form.visitor_name,
        organisation: form.organisation || null,
        phone: form.phone || null,
        department_id: form.department_id || null,
        host_id: form.host_id || null,
        purpose: form.purpose,
        expected_at: new Date(form.expected_at).toISOString(),
        status: form.status,
        notes: form.notes || null,
      };
      if (editingId) {
        const { error } = await supabase.from("bookings").update(payload).eq("id", editingId);
        if (error) throw error;
        await logAudit("Booking updated", form.visitor_name);
      } else {
        const { error } = await supabase.from("bookings").insert({
          ...payload,
          reference: `BK-${Math.floor(1000 + Math.random() * 8999)}`,
        });
        if (error) throw error;
        await logAudit("Booking created", form.visitor_name);
      }
    },
    onSuccess: () => {
      toast.success(editingId ? "Booking updated" : "Booking created");
      setOpen(false);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const setStatus = useMutation({
    mutationFn: async ({ booking, status }: { booking: Booking; status: BookingStatus }) => {
      const { error } = await supabase.from("bookings").update({ status }).eq("id", booking.id);
      if (error) throw error;
      await logAudit(`Booking marked ${status}`, booking.reference);
    },
    onSuccess: () => {
      toast.success("Booking status updated");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (booking: Booking) => {
      const { error } = await supabase.from("bookings").delete().eq("id", booking.id);
      if (error) throw error;
      await logAudit("Booking deleted", booking.reference);
    },
    onSuccess: () => {
      toast.success("Booking deleted");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const view = useTableView(bookings.data ?? [], {
    pageSize,
    search,
    searchText: (b) =>
      `${b.visitor_name} ${b.organisation ?? ""} ${b.reference} ${b.hosts?.full_name ?? ""} ${b.departments?.name ?? ""} ${b.status}`,
    sorters: {
      reference: (b) => b.reference,
      visitor: (b) => b.visitor_name,
      department: (b) => b.departments?.code ?? "",
      host: (b) => b.hosts?.full_name ?? "",
      purpose: (b) => b.purpose,
      expected: (b) => b.expected_at,
      status: (b) => b.status,
    },
    initialSort: "expected",
  });

  const hostOptions = form.department_id
    ? (hosts.data ?? [])
        .filter((h) => h.department_id === form.department_id)
        .map((h) => ({ value: h.id, label: `${h.full_name} — ${h.job_title}` }))
    : [];

  return (
    <div>
      <PageHeader
        title="Pre-booked visits"
        description="Appointments reception can look up by name, phone or reference."
        actions={
          <Button
            onClick={() => {
              setEditingId(null);
              setForm({ ...empty, expected_at: toLocalInput(new Date().toISOString()) });
              setOpen(true);
            }}
          >
            New booking
          </Button>
        }
      />

      <Panel
        title={`${view.total} booking${view.total === 1 ? "" : "s"}`}
        actions={
          <Input
            className="w-56"
            placeholder="Search bookings"
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
            { label: "Reference", sortKey: "reference" },
            { label: "Visitor", sortKey: "visitor" },
            { label: "Department", sortKey: "department" },
            { label: "Host", sortKey: "host" },
            { label: "Purpose", sortKey: "purpose" },
            { label: "Expected", sortKey: "expected" },
            { label: "Status", sortKey: "status" },
            "",
          ]}
        >
          {view.rows.map((b) => (
            <tr key={b.id}>
              <Td className="text-xs text-muted-foreground">{b.reference}</Td>
              <Td className="font-semibold">
                {b.visitor_name}
                <span className="block text-[11px] font-normal text-muted-foreground">
                  {b.organisation ?? ""}
                </span>
              </Td>
              <Td>{b.departments?.code ?? "—"}</Td>
              <Td>{b.hosts?.full_name ?? "—"}</Td>
              <Td>{b.purpose}</Td>
              <Td>
                {formatDate(b.expected_at)}
                <span className="block text-[11px] text-muted-foreground">
                  {formatTime(b.expected_at)}
                </span>
              </Td>
              <Td>
                <Badge
                  variant={
                    b.status === "arrived"
                      ? "success"
                      : b.status === "cancelled"
                        ? "destructive"
                        : "gold"
                  }
                >
                  {b.status}
                </Badge>
              </Td>
              <Td>
                <div className="flex items-center justify-end gap-1">
                  {b.status === "expected" && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => setStatus.mutate({ booking: b, status: "cancelled" })}
                    >
                      Cancel
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Edit booking"
                    onClick={() => {
                      setEditingId(b.id);
                      setForm({
                        visitor_name: b.visitor_name,
                        organisation: b.organisation ?? "",
                        phone: b.phone ?? "",
                        department_id: b.department_id ?? "",
                        host_id: b.host_id ?? "",
                        purpose: b.purpose,
                        expected_at: toLocalInput(b.expected_at),
                        status: b.status,
                        notes: b.notes ?? "",
                      });
                      setOpen(true);
                    }}
                  >
                    <Pencil />
                  </Button>
                  <DeleteButton
                    label="Delete booking"
                    disabled={!canDeleteDept(session, b.department_id)}
                    description="The appointment will be permanently removed."
                    onConfirm={() => remove.mutate(b)}
                  />
                </div>
              </Td>
            </tr>
          ))}
          {view.rows.length === 0 && <EmptyRow colSpan={8} message="No bookings found." />}
        </DataTable>
        <TablePagination view={view} noun="bookings" />
      </Panel>

      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title={editingId ? "Edit booking" : "New booking"}
        busy={save.isPending}
        onSubmit={() => save.mutate()}
      >
        <TextField
          label="Visitor name"
          required
          value={form.visitor_name}
          onChange={(v) => setForm({ ...form, visitor_name: v })}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Organisation"
            value={form.organisation}
            onChange={(v) => setForm({ ...form, organisation: v })}
          />
          <TextField
            label="Phone"
            value={form.phone}
            onChange={(v) => setForm({ ...form, phone: v })}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            label="Department"
            value={form.department_id}
            placeholder="Select department"
            onChange={(v) => setForm({ ...form, department_id: v, host_id: "" })}
            options={(departments.data ?? []).map((d) => ({
              value: d.id,
              label: `${d.name} (${d.code})`,
            }))}
          />
          <SelectField
            label="Host"
            value={form.host_id}
            placeholder={form.department_id ? "Select host" : "Select a department first"}
            onChange={(v) => setForm({ ...form, host_id: v })}
            options={hostOptions}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            label="Purpose"
            value={form.purpose}
            onChange={(v) => setForm({ ...form, purpose: v })}
            options={PURPOSES.map((p) => ({ value: p, label: p }))}
          />
          <TextField
            label="Expected arrival"
            type="datetime-local"
            required
            value={form.expected_at}
            onChange={(v) => setForm({ ...form, expected_at: v })}
          />
        </div>
        <SelectField
          label="Status"
          value={form.status}
          onChange={(v) => setForm({ ...form, status: v as BookingStatus })}
          options={[
            { value: "expected", label: "Expected" },
            { value: "arrived", label: "Arrived" },
            { value: "cancelled", label: "Cancelled" },
          ]}
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
