import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const roleEnum = z.enum([
  "super_admin",
  "admin",
  "dept_admin",
  "dept_manager",
  "dept_receptionist",
  "receptionist",
]);

const createSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  full_name: z.string().min(1),
  job_title: z.string().optional().default(""),
  department_id: z.string().uuid().nullable().optional(),
  role: roleEnum,
});

const updateSchema = z.object({
  id: z.string().uuid(),
  full_name: z.string().min(1),
  job_title: z.string().optional().default(""),
  department_id: z.string().uuid().nullable().optional(),
  role: roleEnum,
  email: z.string().email().optional(),
  password: z.string().min(8).optional().or(z.literal("")),
});

const RANK: Record<string, number> = {
  super_admin: 1,
  admin: 2,
  dept_admin: 3,
  dept_manager: 4,
  dept_receptionist: 5,
  receptionist: 6,
};

type SupabaseCtx = { supabase: SupabaseClient; userId: string };

async function actorContext(context: SupabaseCtx) {
  const { data: roleRows } = await context.supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", context.userId);
  const rank = Math.min(
    ...[...((roleRows ?? []) as { role: string }[]).map((r) => RANK[r.role] ?? 99), 99],
  );
  const { data: profile } = await context.supabase
    .from("profiles")
    .select("department_id")
    .eq("id", context.userId)
    .maybeSingle();
  return { rank, departmentId: (profile?.department_id as string | null) ?? null };
}

/** Roles an actor may grant — own level and below for department roles. */
function mayAssign(actorRank: number, targetRank: number) {
  if (actorRank === 1) return true;
  if (actorRank === 2) return targetRank >= 2;
  if (actorRank >= 3 && actorRank <= 5) return targetRank >= actorRank;
  return false;
}

export const createStaffUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => createSchema.parse(data))
  .handler(async ({ data, context }) => {
    const actor = await actorContext(context as unknown as SupabaseCtx);
    const targetRank = RANK[data.role];
    const sameDept =
      actor.rank <= 2 || (!!data.department_id && data.department_id === actor.departmentId);
    if (!mayAssign(actor.rank, targetRank) || !sameDept) {
      throw new Error("You are not permitted to create this account.");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true,
      user_metadata: { full_name: data.full_name, job_title: data.job_title },
    });
    if (error) throw new Error(error.message);
    const userId = created.user!.id;

    const { error: pErr } = await supabaseAdmin.from("profiles").upsert({
      id: userId,
      full_name: data.full_name,
      job_title: data.job_title || "Reception Officer",
      department_id: data.department_id || null,
    });
    if (pErr) throw new Error(pErr.message);

    await supabaseAdmin.from("user_roles").delete().eq("user_id", userId);
    const { error: rErr } = await supabaseAdmin
      .from("user_roles")
      .insert({ user_id: userId, role: data.role });
    if (rErr) throw new Error(rErr.message);

    return { id: userId };
  });

/** Staff list including sign-in email addresses, filtered to what the caller may see. */
export const listStaff = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const ctx = context as unknown as SupabaseCtx;
    const actor = await actorContext(ctx);
    if (actor.rank > 5) return { actorRank: actor.rank, staff: [] };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [{ data: profiles }, { data: roles }, { data: authUsers }] = await Promise.all([
      supabaseAdmin
        .from("profiles")
        .select("id, full_name, job_title, facility, department_id")
        .order("full_name"),
      supabaseAdmin.from("user_roles").select("user_id, role"),
      supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
    ]);

    const emails = new Map<string, string>(
      (authUsers?.users ?? []).map((u) => [u.id, u.email ?? ""]),
    );

    const rows = (profiles ?? []).map((p) => {
      const owned = (roles ?? [])
        .filter((r) => r.user_id === p.id)
        .map((r) => r.role as string)
        .sort((a, b) => (RANK[a] ?? 99) - (RANK[b] ?? 99));
      return {
        id: p.id as string,
        full_name: p.full_name as string,
        job_title: (p.job_title as string | null) ?? null,
        facility: (p.facility as string | null) ?? null,
        department_id: (p.department_id as string | null) ?? null,
        email: emails.get(p.id as string) ?? "",
        role: (owned[0] as string | undefined) ?? null,
        rank: owned.length ? (RANK[owned[0]] ?? 99) : 99,
      };
    });

    // Visibility: facility-wide roles see everyone; department roles see their own
    // department (plus themselves). Nobody sees accounts they cannot administer.
    const visible =
      actor.rank <= 2
        ? rows
        : rows.filter(
            (r) =>
              r.id === ctx.userId || (!!r.department_id && r.department_id === actor.departmentId),
          );

    return { actorRank: actor.rank, staff: visible };
  });

export const updateStaffUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => updateSchema.parse(data))
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as SupabaseCtx;
    const actor = await actorContext(ctx);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: targetRoles } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", data.id);
    const { data: targetProfile } = await supabaseAdmin
      .from("profiles")
      .select("department_id")
      .eq("id", data.id)
      .maybeSingle();
    const targetRank = Math.min(
      ...[...(targetRoles ?? []).map((r) => RANK[r.role as string] ?? 99), 99],
    );

    const self = data.id === ctx.userId;
    const canAdminister =
      actor.rank === 1 ||
      self ||
      (actor.rank === 2 && targetRank >= 2) ||
      (actor.rank >= 3 &&
        actor.rank <= 5 &&
        targetRank >= actor.rank &&
        !!targetProfile?.department_id &&
        targetProfile.department_id === actor.departmentId);
    if (!canAdminister) throw new Error("You are not permitted to modify this account.");

    const newRank = RANK[data.role];
    if (newRank !== targetRank && !mayAssign(actor.rank, newRank)) {
      throw new Error("You are not permitted to assign that role.");
    }
    if (actor.rank >= 3 && actor.rank <= 5 && data.department_id !== actor.departmentId) {
      throw new Error("You may only assign staff to your own department.");
    }

    const { error: pErr } = await supabaseAdmin
      .from("profiles")
      .update({
        full_name: data.full_name,
        job_title: data.job_title || "Reception Officer",
        department_id: data.department_id || null,
      })
      .eq("id", data.id);
    if (pErr) throw new Error(pErr.message);

    if (newRank !== targetRank) {
      await supabaseAdmin.from("user_roles").delete().eq("user_id", data.id);
      const { error: rErr } = await supabaseAdmin
        .from("user_roles")
        .insert({ user_id: data.id, role: data.role });
      if (rErr) throw new Error(rErr.message);
    }

    if (data.email || data.password) {
      const { error: aErr } = await supabaseAdmin.auth.admin.updateUserById(data.id, {
        ...(data.email ? { email: data.email, email_confirm: true } : {}),
        ...(data.password ? { password: data.password } : {}),
      });
      if (aErr) throw new Error(aErr.message);
    }

    return { id: data.id };
  });

export const deleteStaffUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as SupabaseCtx;
    const actor = await actorContext(ctx);
    if (data.id === ctx.userId) throw new Error("You cannot delete your own account.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: targetRoles } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", data.id);
    const { data: targetProfile } = await supabaseAdmin
      .from("profiles")
      .select("department_id")
      .eq("id", data.id)
      .maybeSingle();
    const targetRank = Math.min(
      ...[...(targetRoles ?? []).map((r) => RANK[r.role as string] ?? 99), 99],
    );

    const allowed =
      actor.rank === 1 ||
      (actor.rank === 2 && targetRank !== 2) ||
      (actor.rank >= 3 &&
        actor.rank <= 5 &&
        targetRank >= actor.rank &&
        !!targetProfile?.department_id &&
        targetProfile.department_id === actor.departmentId);
    if (!allowed) throw new Error("You are not permitted to delete this account.");

    await supabaseAdmin.from("user_roles").delete().eq("user_id", data.id);
    await supabaseAdmin.from("profiles").delete().eq("id", data.id);
    const { error } = await supabaseAdmin.auth.admin.deleteUser(data.id);
    if (error) throw new Error(error.message);
    return { id: data.id };
  });
