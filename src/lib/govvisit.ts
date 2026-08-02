import { supabase } from "@/integrations/supabase/client";

export type VisitType = "walk_in" | "pre_booked";
export type VisitStatus = "inside" | "checked_out";
export type BookingStatus = "expected" | "arrived" | "cancelled";
export type RiskRating = "clear" | "review" | "blocked";
export type AppRole =
  | "super_admin"
  | "admin"
  | "dept_admin"
  | "dept_manager"
  | "dept_receptionist"
  | "receptionist";

export interface RoleMeta {
  role: AppRole;
  label: string;
  rank: number;
  scope: "Facility-wide" | "Department" | "Global (view & visitor flow)";
  summary: string;
}

export const ROLES: RoleMeta[] = [
  {
    role: "super_admin",
    label: "Super Administrator",
    rank: 1,
    scope: "Facility-wide",
    summary: "Full control. May delete records and accounts belonging to any role, including logs.",
  },
  {
    role: "admin",
    label: "Administrator",
    rank: 2,
    scope: "Facility-wide",
    summary: "Full control. Cannot delete Administrator accounts or audit logs.",
  },
  {
    role: "dept_admin",
    label: "Department Admin",
    rank: 3,
    scope: "Department",
    summary:
      "Full control of the assigned department. Cannot delete Super Administrator or Administrator accounts, or logs.",
  },
  {
    role: "dept_manager",
    label: "Department Manager",
    rank: 4,
    scope: "Department",
    summary:
      "Full control of the assigned department. Cannot delete Department Admin or higher accounts, or logs.",
  },
  {
    role: "dept_receptionist",
    label: "Department Receptionist",
    rank: 5,
    scope: "Department",
    summary:
      "Views departmental visitors and creates or updates pre-booked visits for the assigned department. Cannot delete any record and has no access to the mobile reception app.",
  },
  {
    role: "receptionist",
    label: "Receptionist",
    rank: 6,
    scope: "Global (view & visitor flow)",
    summary:
      "Check visitors in and out across all departments. Absolute deletion block — cannot delete any data.",
  },
];

export function roleMeta(role?: AppRole | null): RoleMeta | undefined {
  return ROLES.find((r) => r.role === role);
}

export function roleLabel(role?: AppRole | null) {
  return roleMeta(role)?.label ?? "No role";
}

export function roleRank(role?: AppRole | null) {
  return roleMeta(role)?.rank ?? 99;
}

export interface Actor {
  userId: string | null;
  rank: number;
  departmentId: string | null;
}

/** Facility-wide managers (Super Administrator, Administrator). */
export function isGlobalAdmin(actor?: Actor | null) {
  return (actor?.rank ?? 99) <= 2;
}

/** Can create/update records that belong to the given department. */
export function canManageDept(actor?: Actor | null, departmentId?: string | null) {
  const rank = actor?.rank ?? 99;
  if (rank <= 2) return true;
  if (rank >= 3 && rank <= 5) return Boolean(departmentId) && departmentId === actor?.departmentId;
  return false;
}

/** Can delete records in the given department. Both receptionist roles are blocked. */
export function canDeleteDept(actor?: Actor | null, departmentId?: string | null) {
  return (actor?.rank ?? 99) <= 4 && canManageDept(actor, departmentId);
}

/** Visitor identity records: only ranks 1-4 may delete. */
export function canDeleteVisitorRecord(actor?: Actor | null) {
  return (actor?.rank ?? 99) <= 4;
}

/** Department Receptionists work in the web dashboard only — never the mobile reception app. */
export function canUseMobileApp(actor?: Actor | null) {
  return (actor?.rank ?? 99) !== 5;
}

/** Only the Super Administrator may delete audit log entries. */
export function canDeleteAudit(actor?: Actor | null) {
  return (actor?.rank ?? 99) === 1;
}

/** Deletion hierarchy for staff accounts. */
export function canDeleteUser(
  actor: Actor | null | undefined,
  target: { userId: string; rank: number; departmentId: string | null },
) {
  const rank = actor?.rank ?? 99;
  if (!actor?.userId || actor.userId === target.userId) return false;
  if (rank === 1) return true;
  if (rank === 2) return target.rank !== 2;
  if (rank >= 3 && rank <= 5)
    return (
      target.rank >= rank &&
      Boolean(target.departmentId) &&
      target.departmentId === actor.departmentId
    );
  return false;
}

/** Roles the actor is allowed to assign to someone else (own level and below). */
export function assignableRoles(actor?: Actor | null): RoleMeta[] {
  const rank = actor?.rank ?? 99;
  if (rank === 1) return ROLES;
  if (rank === 2) return ROLES.filter((r) => r.rank >= 2);
  if (rank >= 3 && rank <= 5) return ROLES.filter((r) => r.rank >= rank);
  return [];
}

/** Screen a signed-in staff member lands on: only the global Receptionist starts at reception. */
export function landingPath(rank: number): "/dashboard" | "/reception" {
  return rank >= 6 ? "/reception" : "/dashboard";
}

/** Whether the actor may see a staff account at all in user administration. */
export function canViewUser(
  actor: Actor | null | undefined,
  target: { userId: string; departmentId: string | null },
) {
  const rank = actor?.rank ?? 99;
  if (rank > 5) return false;
  if (rank <= 2) return true;
  if (actor?.userId && actor.userId === target.userId) return true;
  return Boolean(target.departmentId) && target.departmentId === actor?.departmentId;
}

export interface Department {
  id: string;
  name: string;
  code: string;
  active: boolean;
}

export interface Host {
  id: string;
  department_id: string;
  full_name: string;
  job_title: string;
  email: string | null;
  phone: string | null;
  active: boolean;
  departments?: { name: string; code: string } | null;
}

export interface Visitor {
  id: string;
  reference: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  email: string | null;
  organisation: string | null;
  document_type: string;
  document_number: string;
  risk: RiskRating;
  notes: string | null;
  created_at: string;
}

export interface Booking {
  id: string;
  reference: string;
  visitor_name: string;
  organisation: string | null;
  phone: string | null;
  department_id: string | null;
  host_id: string | null;
  purpose: string;
  expected_at: string;
  status: BookingStatus;
  notes: string | null;
  departments?: { name: string; code: string } | null;
  hosts?: { full_name: string } | null;
}

export interface Visit {
  id: string;
  pass_code: string;
  visitor_id: string;
  booking_id: string | null;
  visit_type: VisitType;
  department_id: string | null;
  host_id: string | null;
  purpose: string;
  approval: string;
  expected_minutes: number;
  access_zone: string;
  notes: string | null;
  status: VisitStatus;
  badge_returned: boolean;
  checked_in_at: string;
  checked_out_at: string | null;
  visitors?: Visitor | null;
  departments?: { name: string; code: string } | null;
  hosts?: { full_name: string } | null;
}

export interface FacilityConfig {
  id: string;
  facility_name: string;
  organisation_name: string;
  approval_workflow: string;
  retention_months: number;
  overdue_grace_minutes: number;
  rows_per_page: number;
}

export interface AuditLog {
  id: string;
  actor_name: string;
  event: string;
  record_ref: string | null;
  status: string;
  created_at: string;
}

export const PURPOSES = [
  "Official meeting",
  "Document submission",
  "Consultation",
  "Vendor visit",
  "Interview",
  "Maintenance",
];

export const APPROVALS = [
  "Host approval required",
  "Security approval required",
  "Reception confirmation",
];

export const DOCUMENT_TYPES = [
  "Nigerian Passport",
  "Driving Licence",
  "NIN Card",
  "Staff ID",
  "Voter's Card",
];

export const DURATIONS = [
  { label: "30 minutes", value: 30 },
  { label: "1 hour", value: 60 },
  { label: "2 hours", value: 120 },
  { label: "Half day", value: 240 },
];

export const ACCESS_ZONES = ["Green Zone", "Amber Zone", "Restricted Zone"];

export const VISIT_SELECT = "*, visitors(*), departments(name, code), hosts(full_name)";

export function fullName(v?: Pick<Visitor, "first_name" | "last_name"> | null) {
  if (!v) return "Unknown visitor";
  return `${v.first_name} ${v.last_name}`.trim();
}

export function initials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

export function minutesSince(iso: string) {
  return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
}

export function formatDuration(mins: number) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString([], { day: "2-digit", month: "short", year: "numeric" });
}

export function maskDocument(value: string) {
  if (value.length <= 4) return value;
  return `${value.slice(0, 3)}${"•".repeat(Math.max(2, value.length - 5))}${value.slice(-2)}`;
}

export function isOverdue(
  visit: Pick<Visit, "checked_in_at" | "expected_minutes" | "status">,
  grace = 15,
) {
  if (visit.status !== "inside") return false;
  return minutesSince(visit.checked_in_at) > visit.expected_minutes + grace;
}

export function visitTypeLabel(t: VisitType) {
  return t === "walk_in" ? "Walk-in" : "Pre-booked";
}

export async function logAudit(event: string, recordRef?: string | null, status = "Success") {
  const { data } = await supabase.auth.getUser();
  const user = data.user;
  let actorName = user?.email ?? "System";
  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("full_name")
      .eq("id", user.id)
      .maybeSingle();
    if (profile?.full_name) actorName = profile.full_name;
  }
  await supabase.from("audit_logs").insert({
    actor_name: actorName,
    actor_id: user?.id ?? null,
    event,
    record_ref: recordRef ?? null,
    status,
  });
}

export function toCsv(rows: Record<string, unknown>[]) {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const escape = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  return [headers.join(","), ...rows.map((r) => headers.map((h) => escape(r[h])).join(","))].join(
    "\n",
  );
}

export function downloadCsv(filename: string, rows: Record<string, unknown>[]) {
  const blob = new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
