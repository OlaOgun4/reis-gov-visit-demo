import { supabase } from "@/integrations/supabase/client";

/**
 * Privileged staff administration always runs on the managed backend
 * (Lovable Cloud edge function `admin-create-user`), never on the frontend host.
 * This keeps the behaviour identical on the Lovable domain, the Cloudflare
 * production domain and localhost. No service-role key ever reaches the browser.
 */
async function invokeAdmin<T>(payload: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("admin-create-user", { body: payload });

  if (error) {
    // Surface the function's safe message rather than the generic transport error.
    const res = (error as { context?: Response }).context;
    if (res && typeof res.json === "function") {
      try {
        const parsed = await res.clone().json();
        if (parsed?.error) throw new Error(parsed.error as string);
      } catch (parseError) {
        if (parseError instanceof Error && parseError.message) throw parseError;
      }
    }
    throw new Error(error.message || "The request could not be completed.");
  }

  if (data && typeof data === "object" && "error" in (data as Record<string, unknown>)) {
    throw new Error(String((data as { error: unknown }).error));
  }
  return data as T;
}

export type StaffRecord = {
  id: string;
  full_name: string;
  job_title: string | null;
  facility: string | null;
  department_id: string | null;
  email: string;
  role: string | null;
  rank: number;
};

export function listStaff() {
  return invokeAdmin<{ actorRank: number; staff: StaffRecord[] }>({ action: "list" });
}

export function createStaffUser(input: {
  email: string;
  password: string;
  full_name: string;
  job_title?: string;
  department_id?: string | null;
  role: string;
}) {
  return invokeAdmin<{ id: string }>({ action: "create", ...input });
}

export function updateStaffUser(input: {
  id: string;
  full_name: string;
  job_title?: string;
  department_id?: string | null;
  role: string;
  email?: string;
  password?: string;
}) {
  return invokeAdmin<{ id: string }>({ action: "update", ...input });
}

export function deleteStaffUser(input: { id: string }) {
  return invokeAdmin<{ id: string }>({ action: "delete", ...input });
}
