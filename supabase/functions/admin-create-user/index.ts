// Privileged staff-account administration for GovVisit.
// Runs on the managed backend (Lovable Cloud), so it works identically from the
// Lovable published domain, the Cloudflare production domain and localhost.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.58.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, apikey, x-client-info, content-type, x-requested-with",
  "Access-Control-Max-Age": "86400",
};

const RANK: Record<string, number> = {
  super_admin: 1,
  admin: 2,
  dept_admin: 3,
  dept_manager: 4,
  dept_receptionist: 5,
  receptionist: 6,
};
const ROLES = Object.keys(RANK);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

function mayAssign(actorRank: number, targetRank: number) {
  if (actorRank === 1) return true;
  if (actorRank === 2) return targetRank >= 2;
  if (actorRank >= 3 && actorRank <= 5) return targetRank >= actorRank;
  return false;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;
  const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) {
    return json({ error: "Authentication required." }, 401);
  }

  // Caller-scoped client: validates the JWT and reads data under RLS.
  const caller = createClient(SUPABASE_URL, ANON, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userErr } = await caller.auth.getUser();
  if (userErr || !userData.user) return json({ error: "Authentication required." }, 401);
  const callerId = userData.user.id;

  // Privileged client, server-side only. Never returned or logged.
  const admin = createClient(SUPABASE_URL, SERVICE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Authoritative role + department come from the database, never the request body.
  const { data: roleRows } = await admin.from("user_roles").select("role").eq("user_id", callerId);
  const actorRank = Math.min(
    ...[...((roleRows ?? []) as { role: string }[]).map((r) => RANK[r.role] ?? 99), 99],
  );
  const { data: actorProfile } = await admin
    .from("profiles")
    .select("full_name, department_id")
    .eq("id", callerId)
    .maybeSingle();
  const actorDept = (actorProfile?.department_id as string | null) ?? null;
  const actorName = (actorProfile?.full_name as string | null) ?? "System";

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) ?? {};
  } catch {
    return json({ error: "Invalid request body." }, 400);
  }
  const action = String(body.action ?? "create");

  const audit = async (event: string, status: string, ref: string | null) => {
    await admin.from("audit_logs").insert({
      actor_name: actorName,
      actor_id: callerId,
      event,
      record_ref: ref,
      status,
    });
  };

  try {
    if (action === "list") {
      if (actorRank > 5) return json({ actorRank, staff: [] });
      const [{ data: profiles }, { data: roles }, { data: authUsers }] = await Promise.all([
        admin.from("profiles").select("id, full_name, job_title, facility, department_id").order("full_name"),
        admin.from("user_roles").select("user_id, role"),
        admin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
      ]);
      const emails = new Map((authUsers?.users ?? []).map((u) => [u.id, u.email ?? ""]));
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
          role: owned[0] ?? null,
          rank: owned.length ? (RANK[owned[0]] ?? 99) : 99,
        };
      });
      const staff =
        actorRank <= 2
          ? rows
          : rows.filter((r) => r.id === callerId || (!!r.department_id && r.department_id === actorDept));
      return json({ actorRank, staff });
    }

    if (action === "create") {
      const email = String(body.email ?? "").trim();
      const password = String(body.password ?? "");
      const fullName = String(body.full_name ?? "").trim();
      const jobTitle = String(body.job_title ?? "").trim();
      const departmentId = (body.department_id as string | null) || null;
      const role = String(body.role ?? "");

      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: "Enter a valid email address." }, 400);
      if (password.length < 8) return json({ error: "Password must be at least 8 characters." }, 400);
      if (!fullName) return json({ error: "Full name is required." }, 400);
      if (!ROLES.includes(role)) return json({ error: "That role is not valid." }, 400);
      if (departmentId && !UUID.test(departmentId)) return json({ error: "That department is not valid." }, 400);

      const sameDept = actorRank <= 2 || (!!departmentId && departmentId === actorDept);
      if (!mayAssign(actorRank, RANK[role]) || !sameDept) {
        return json({ error: "You are not permitted to create this account." }, 403);
      }

      if (departmentId) {
        const { data: dept } = await admin.from("departments").select("id").eq("id", departmentId).maybeSingle();
        if (!dept) return json({ error: "That department does not exist." }, 400);
      }

      const eventLabel = `Create staff account (${role}${departmentId ? `, dept ${departmentId}` : ""})`;
      const { data: created, error } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: fullName, job_title: jobTitle },
      });
      if (error) {
        const duplicate = /already|exists|registered/i.test(error.message);
        const safe = duplicate
          ? "An account with that email address already exists."
          : "Could not create the account.";
        await audit(`${eventLabel} — ${safe}`, "Failed", null);
        return json({ error: safe }, duplicate ? 409 : 400);
      }
      const userId = created.user!.id;

      try {
        const { error: pErr } = await admin.from("profiles").upsert({
          id: userId,
          full_name: fullName,
          job_title: jobTitle || "Reception Officer",
          department_id: departmentId,
        });
        if (pErr) throw new Error(pErr.message);
        await admin.from("user_roles").delete().eq("user_id", userId);
        const { error: rErr } = await admin.from("user_roles").insert({ user_id: userId, role });
        if (rErr) throw new Error(rErr.message);
      } catch {
        await admin.from("user_roles").delete().eq("user_id", userId);
        await admin.from("profiles").delete().eq("id", userId);
        await admin.auth.admin.deleteUser(userId);
        await audit(`${eventLabel} — profile or role assignment failed; account rolled back.`, "Failed", null);
        return json({ error: "Could not complete the account setup. No account was created." }, 500);
      }

      await audit(eventLabel, "Success", userId);
      return json({ id: userId });
    }

    if (action === "update") {
      const id = String(body.id ?? "");
      if (!UUID.test(id)) return json({ error: "Invalid account reference." }, 400);
      const fullName = String(body.full_name ?? "").trim();
      const jobTitle = String(body.job_title ?? "").trim();
      const departmentId = (body.department_id as string | null) || null;
      const role = String(body.role ?? "");
      const email = body.email ? String(body.email).trim() : "";
      const password = body.password ? String(body.password) : "";
      if (!fullName) return json({ error: "Full name is required." }, 400);
      if (!ROLES.includes(role)) return json({ error: "That role is not valid." }, 400);
      if (password && password.length < 8) return json({ error: "Password must be at least 8 characters." }, 400);

      const { data: targetRoles } = await admin.from("user_roles").select("role").eq("user_id", id);
      const { data: targetProfile } = await admin.from("profiles").select("department_id").eq("id", id).maybeSingle();
      const targetRank = Math.min(
        ...[...((targetRoles ?? []) as { role: string }[]).map((r) => RANK[r.role] ?? 99), 99],
      );
      const self = id === callerId;
      const canAdminister =
        actorRank === 1 ||
        self ||
        (actorRank === 2 && targetRank >= 2) ||
        (actorRank >= 3 &&
          actorRank <= 5 &&
          targetRank >= actorRank &&
          !!targetProfile?.department_id &&
          targetProfile.department_id === actorDept);
      if (!canAdminister) return json({ error: "You are not permitted to modify this account." }, 403);

      const newRank = RANK[role];
      if (newRank !== targetRank && !mayAssign(actorRank, newRank)) {
        return json({ error: "You are not permitted to assign that role." }, 403);
      }
      if (actorRank >= 3 && actorRank <= 5 && departmentId !== actorDept) {
        return json({ error: "You may only assign staff to your own department." }, 403);
      }

      const { error: pErr } = await admin
        .from("profiles")
        .update({ full_name: fullName, job_title: jobTitle || "Reception Officer", department_id: departmentId })
        .eq("id", id);
      if (pErr) return json({ error: "Could not update the account." }, 400);

      if (newRank !== targetRank) {
        await admin.from("user_roles").delete().eq("user_id", id);
        const { error: rErr } = await admin.from("user_roles").insert({ user_id: id, role });
        if (rErr) return json({ error: "Could not update the assigned role." }, 400);
      }

      if (email || password) {
        const { error: aErr } = await admin.auth.admin.updateUserById(id, {
          ...(email ? { email, email_confirm: true } : {}),
          ...(password ? { password } : {}),
        });
        if (aErr) {
          const duplicate = /already|exists|registered/i.test(aErr.message);
          return json(
            { error: duplicate ? "An account with that email address already exists." : "Could not update sign-in details." },
            duplicate ? 409 : 400,
          );
        }
      }

      await audit(`Update staff account (${role})`, "Success", id);
      return json({ id });
    }

    if (action === "delete") {
      const id = String(body.id ?? "");
      if (!UUID.test(id)) return json({ error: "Invalid account reference." }, 400);
      if (id === callerId) return json({ error: "You cannot delete your own account." }, 400);

      const { data: targetRoles } = await admin.from("user_roles").select("role").eq("user_id", id);
      const { data: targetProfile } = await admin.from("profiles").select("department_id").eq("id", id).maybeSingle();
      const targetRank = Math.min(
        ...[...((targetRoles ?? []) as { role: string }[]).map((r) => RANK[r.role] ?? 99), 99],
      );
      const allowed =
        actorRank === 1 ||
        (actorRank === 2 && targetRank !== 2) ||
        (actorRank >= 3 &&
          actorRank <= 5 &&
          targetRank >= actorRank &&
          !!targetProfile?.department_id &&
          targetProfile.department_id === actorDept);
      if (!allowed) return json({ error: "You are not permitted to delete this account." }, 403);

      await admin.from("user_roles").delete().eq("user_id", id);
      await admin.from("profiles").delete().eq("id", id);
      const { error } = await admin.auth.admin.deleteUser(id);
      if (error) return json({ error: "Could not delete the account." }, 400);
      await audit("Delete staff account", "Success", id);
      return json({ id });
    }

    return json({ error: "Unknown action." }, 400);
  } catch (_e) {
    return json({ error: "Unexpected error while processing the request." }, 500);
  }
});
