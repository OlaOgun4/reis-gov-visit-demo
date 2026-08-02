import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ChevronsUpDown, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="font-display text-3xl leading-none">{title}</h1>
        {description && <p className="mt-2 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function StatCard({
  value,
  label,
  detail,
}: {
  value: ReactNode;
  label: string;
  detail?: string;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-card">
      <p className="text-3xl font-bold">{value}</p>
      <p className="mt-1 text-xs font-semibold text-muted-foreground">{label}</p>
      {detail && <p className="mt-3 text-[11px] text-primary">{detail}</p>}
    </div>
  );
}

export function Panel({
  title,
  actions,
  children,
  className,
}: {
  title?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`overflow-hidden rounded-2xl border border-border bg-card shadow-card ${className ?? ""}`}
    >
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
          {title && <h2 className="text-sm font-bold">{title}</h2>}
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export type SortDir = "asc" | "desc";
export type HeadCell = string | { label: string; sortKey?: string };

function headLabel(h: HeadCell) {
  return typeof h === "string" ? h : h.label;
}

export function DataTable({
  head,
  children,
  sortKey,
  sortDir,
  onSort,
  maxHeight = "60vh",
}: {
  head: HeadCell[];
  children: ReactNode;
  sortKey?: string | null;
  sortDir?: SortDir;
  onSort?: (key: string) => void;
  maxHeight?: string;
}) {
  return (
    <div className="overflow-auto" style={{ maxHeight }}>
      <table className="w-full border-collapse text-sm">
        <thead className="sticky top-0 z-10">
          <tr>
            {head.map((h, i) => {
              const key = typeof h === "string" ? undefined : h.sortKey;
              const active = Boolean(key) && key === sortKey;
              return (
                <th
                  key={`${headLabel(h)}-${i}`}
                  className="whitespace-nowrap border-b border-border bg-muted/60 px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wide text-muted-foreground"
                >
                  {key && onSort ? (
                    <button
                      type="button"
                      onClick={() => onSort(key)}
                      className="inline-flex items-center gap-1 uppercase tracking-wide hover:text-foreground"
                      aria-label={`Sort by ${headLabel(h)}`}
                    >
                      {headLabel(h)}
                      {active ? (
                        sortDir === "asc" ? (
                          <ArrowUp className="size-3" />
                        ) : (
                          <ArrowDown className="size-3" />
                        )
                      ) : (
                        <ChevronsUpDown className="size-3 opacity-40" />
                      )}
                    </button>
                  ) : (
                    headLabel(h)
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export interface TableView<T> {
  rows: T[];
  total: number;
  page: number;
  pageCount: number;
  pageSize: number;
  sortKey: string | null;
  sortDir: SortDir;
  toggleSort: (key: string) => void;
  setPage: (p: number) => void;
}

/** Client-side filtering, sorting and pagination shared by every dashboard table. */
export function useTableView<T>(
  rows: T[],
  options: {
    pageSize: number;
    search?: string;
    searchText?: (row: T) => string;
    sorters?: Record<string, (row: T) => string | number | null | undefined>;
    initialSort?: string;
    initialDir?: SortDir;
  },
): TableView<T> {
  const { pageSize, search = "", searchText, sorters, initialSort, initialDir } = options;
  const [sortKey, setSortKey] = useState<string | null>(initialSort ?? null);
  const [sortDir, setSortDir] = useState<SortDir>(initialDir ?? "asc");
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q || !searchText) return rows;
    return rows.filter((r) => searchText(r).toLowerCase().includes(q));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, search]);

  const sorted = useMemo(() => {
    const sorter = sortKey ? sorters?.[sortKey] : undefined;
    if (!sorter) return filtered;
    const dir = sortDir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const av = sorter(a);
      const bv = sorter(b);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      return String(av).localeCompare(String(bv), undefined, { numeric: true }) * dir;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, sortKey, sortDir]);

  const size = Math.max(1, pageSize);
  const pageCount = Math.max(1, Math.ceil(sorted.length / size));
  const current = Math.min(page, pageCount);

  useEffect(() => {
    setPage(1);
  }, [search, pageSize, sortKey, sortDir]);

  return {
    rows: sorted.slice((current - 1) * size, current * size),
    total: sorted.length,
    page: current,
    pageCount,
    pageSize: size,
    sortKey,
    sortDir,
    toggleSort: (key: string) => {
      if (key === sortKey) setSortDir(sortDir === "asc" ? "desc" : "asc");
      else {
        setSortKey(key);
        setSortDir("asc");
      }
    },
    setPage,
  };
}

export function TablePagination<T>({ view, noun = "rows" }: { view: TableView<T>; noun?: string }) {
  const from = view.total === 0 ? 0 : (view.page - 1) * view.pageSize + 1;
  const to = Math.min(view.total, view.page * view.pageSize);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-3 text-xs text-muted-foreground">
      <p>
        Showing {from}–{to} of {view.total} {noun}
      </p>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={view.page <= 1}
          onClick={() => view.setPage(view.page - 1)}
        >
          Previous
        </Button>
        <span className="font-semibold">
          Page {view.page} of {view.pageCount}
        </span>
        <Button
          variant="outline"
          size="sm"
          disabled={view.page >= view.pageCount}
          onClick={() => view.setPage(view.page + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
export function Td({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <td className={`whitespace-nowrap border-b border-border px-4 py-3 ${className ?? ""}`}>
      {children}
    </td>
  );
}

export function EmptyRow({ colSpan, message }: { colSpan: number; message: string }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-10 text-center text-sm text-muted-foreground">
        {message}
      </td>
    </tr>
  );
}

export function FormDialog({
  open,
  onOpenChange,
  title,
  description,
  onSubmit,
  submitLabel = "Save",
  busy,
  children,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  description?: string;
  onSubmit: () => void;
  submitLabel?: string;
  busy?: boolean;
  children: ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit();
          }}
        >
          {children}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? "Saving…" : submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function TextField({
  label,
  value,
  onChange,
  type = "text",
  required,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
  placeholder?: string;
}) {
  return (
    <div>
      <Label>{label}</Label>
      <Input
        className="mt-1.5"
        type={type}
        value={value}
        required={required}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

export function AreaField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <Label>{label}</Label>
      <Textarea className="mt-1.5" rows={3} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

export function SelectField({
  label,
  value,
  onChange,
  options,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
}) {
  return (
    <div>
      <Label>{label}</Label>
      <select
        className="mt-1.5 h-10 w-full rounded-lg border border-input bg-card px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {placeholder && <option value="">{placeholder}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function DeleteButton({
  onConfirm,
  label = "Delete record",
  description = "This action cannot be undone.",
  disabled,
  variant = "icon",
}: {
  onConfirm: () => void;
  label?: string;
  description?: string;
  disabled?: boolean;
  variant?: "icon" | "button";
}) {
  const [open, setOpen] = useState(false);
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        {variant === "button" ? (
          <Button variant="outline" disabled={disabled}>
            <Trash2 className="text-destructive" />
            {label}
          </Button>
        ) : (
          <Button variant="ghost" size="icon" aria-label={label} disabled={disabled}>
            <Trash2 className="text-destructive" />
          </Button>
        )}
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{label}?</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              onConfirm();
              setOpen(false);
            }}
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
