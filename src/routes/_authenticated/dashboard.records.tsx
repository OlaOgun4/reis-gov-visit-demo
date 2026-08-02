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
  Td,
  TextField,
  TablePagination,
  useTableView,
} from "@/components/dashboard/kit";
import { useRowsPerPage } from "@/hooks/use-rows-per-page";
import {
  canDeleteVisitorRecord,
  DOCUMENT_TYPES,
  downloadCsv,
  formatDate,
  logAudit,
  maskDocument,
  type RiskRating,
  type Visitor,
} from "@/lib/govvisit";

export const Route = createFileRoute("/_authenticated/dashboard/records")({
  head: () => ({
    meta: [
      { title: "Visitor records — GovVisit" },
      {
        name: "description",
        content:
          "Search, create, update and remove visitor identity records, including document details and risk screening outcomes.",
      },
      { property: "og:title", content: "Visitor records — GovVisit" },
      { property: "og:description", content: "Manage the facility visitor identity database." },
    ],
  }),
  component: RecordsPage,
});

const empty = {
  first_name: "",
  last_name: "",
  phone: "",
  email: "",
  organisation: "",
  document_type: DOCUMENT_TYPES[0],
  document_number: "",
  risk: "clear" as RiskRating,
  notes: "",
};

function RecordsPage() {
  const { data: session } = useSession();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(empty);
  const pageSize = useRowsPerPage();

  const visitors = useQuery({
    queryKey: ["visitors"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("visitors")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as Visitor[];
    },
  });

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["visitors"] });
    queryClient.invalidateQueries({ queryKey: ["audit"] });
  }

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        first_name: form.first_name,
        last_name: form.last_name,
        phone: form.phone || null,
        email: form.email || null,
        organisation: form.organisation || null,
        document_type: form.document_type,
        document_number: form.document_number,
        risk: form.risk,
        notes: form.notes || null,
      };
      if (editingId) {
        const { error } = await supabase.from("visitors").update(payload).eq("id", editingId);
        if (error) throw error;
        await logAudit("Visitor record updated", `${form.first_name} ${form.last_name}`);
      } else {
        const { error } = await supabase.from("visitors").insert({
          ...payload,
          reference: `VIS-${Math.floor(100000 + Math.random() * 899999)}`,
        });
        if (error) throw error;
        await logAudit("Visitor record created", `${form.first_name} ${form.last_name}`);
      }
    },
    onSuccess: () => {
      toast.success(editingId ? "Visitor updated" : "Visitor created");
      setOpen(false);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (v: Visitor) => {
      const { error } = await supabase.from("visitors").delete().eq("id", v.id);
      if (error) throw error;
      await logAudit("Visitor record deleted", v.reference);
    },
    onSuccess: () => {
      toast.success("Visitor deleted");
      invalidate();
    },
    onError: (e: Error) =>
      toast.error(
        e.message.includes("foreign key")
          ? "This visitor has visit history and cannot be deleted."
          : e.message,
      ),
  });

  const rows = visitors.data ?? [];
  const view = useTableView(rows, {
    pageSize,
    search,
    searchText: (v) =>
      `${v.first_name} ${v.last_name} ${v.organisation ?? ""} ${v.reference} ${v.document_number} ${v.risk}`,
    sorters: {
      reference: (v) => v.reference,
      visitor: (v) => `${v.first_name} ${v.last_name}`,
      organisation: (v) => v.organisation ?? "",
      contact: (v) => v.phone ?? "",
      document: (v) => `${v.document_type} ${v.document_number}`,
      risk: (v) => v.risk,
      added: (v) => v.created_at,
    },
    initialSort: "added",
    initialDir: "desc",
  });

  return (
    <div>
      <PageHeader
        title="Visitor records"
        description="Identity database used by reception for repeat-visitor lookup."
        actions={
          <>
            <Button
              variant="outline"
              onClick={() =>
                downloadCsv(
                  "visitor-records.csv",
                  rows.map((v) => ({
                    reference: v.reference,
                    name: `${v.first_name} ${v.last_name}`,
                    organisation: v.organisation ?? "",
                    phone: v.phone ?? "",
                    email: v.email ?? "",
                    document: `${v.document_type} ${v.document_number}`,
                    risk: v.risk,
                  })),
                )
              }
            >
              Export CSV
            </Button>
            <Button
              onClick={() => {
                setEditingId(null);
                setForm(empty);
                setOpen(true);
              }}
            >
              New visitor
            </Button>
          </>
        }
      />

      <Panel
        title={`${view.total} record${view.total === 1 ? "" : "s"}`}
        actions={
          <Input
            className="w-56"
            placeholder="Search name, org, document"
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
            { label: "Organisation", sortKey: "organisation" },
            { label: "Contact", sortKey: "contact" },
            { label: "Document", sortKey: "document" },
            { label: "Risk", sortKey: "risk" },
            { label: "Added", sortKey: "added" },
            "",
          ]}
        >
          {view.rows.map((v) => (
            <tr key={v.id}>
              <Td className="text-xs text-muted-foreground">{v.reference}</Td>
              <Td className="font-semibold">
                {v.first_name} {v.last_name}
              </Td>
              <Td>{v.organisation ?? "—"}</Td>
              <Td>
                {v.phone ?? "—"}
                <span className="block text-[11px] text-muted-foreground">{v.email ?? ""}</span>
              </Td>
              <Td>
                {v.document_type}
                <span className="block text-[11px] text-muted-foreground">
                  {maskDocument(v.document_number)}
                </span>
              </Td>
              <Td>
                <Badge
                  variant={
                    v.risk === "clear" ? "success" : v.risk === "review" ? "warning" : "destructive"
                  }
                >
                  {v.risk}
                </Badge>
              </Td>
              <Td>{formatDate(v.created_at)}</Td>
              <Td>
                <div className="flex items-center justify-end gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Edit visitor"
                    onClick={() => {
                      setEditingId(v.id);
                      setForm({
                        first_name: v.first_name,
                        last_name: v.last_name,
                        phone: v.phone ?? "",
                        email: v.email ?? "",
                        organisation: v.organisation ?? "",
                        document_type: v.document_type,
                        document_number: v.document_number,
                        risk: v.risk,
                        notes: v.notes ?? "",
                      });
                      setOpen(true);
                    }}
                  >
                    <Pencil />
                  </Button>
                  <DeleteButton
                    label="Delete visitor"
                    disabled={!canDeleteVisitorRecord(session)}
                    description="The visitor identity record will be permanently removed."
                    onConfirm={() => remove.mutate(v)}
                  />
                </div>
              </Td>
            </tr>
          ))}
          {view.rows.length === 0 && <EmptyRow colSpan={8} message="No visitor records found." />}
        </DataTable>
        <TablePagination view={view} noun="records" />
      </Panel>

      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title={editingId ? "Edit visitor" : "New visitor"}
        busy={save.isPending}
        onSubmit={() => save.mutate()}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="First name"
            required
            value={form.first_name}
            onChange={(v) => setForm({ ...form, first_name: v })}
          />
          <TextField
            label="Last name"
            required
            value={form.last_name}
            onChange={(v) => setForm({ ...form, last_name: v })}
          />
          <TextField
            label="Phone"
            value={form.phone}
            onChange={(v) => setForm({ ...form, phone: v })}
          />
          <TextField
            label="Email"
            type="email"
            value={form.email}
            onChange={(v) => setForm({ ...form, email: v })}
          />
        </div>
        <TextField
          label="Organisation"
          value={form.organisation}
          onChange={(v) => setForm({ ...form, organisation: v })}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            label="Document type"
            value={form.document_type}
            onChange={(v) => setForm({ ...form, document_type: v })}
            options={DOCUMENT_TYPES.map((d) => ({ value: d, label: d }))}
          />
          <TextField
            label="Document number"
            required
            value={form.document_number}
            onChange={(v) => setForm({ ...form, document_number: v })}
          />
        </div>
        <SelectField
          label="Risk screening"
          value={form.risk}
          onChange={(v) => setForm({ ...form, risk: v as RiskRating })}
          options={[
            { value: "clear", label: "Clear" },
            { value: "review", label: "Manual review" },
            { value: "blocked", label: "Blocked" },
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
