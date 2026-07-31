import { createClient } from "https://esm.sh/@supabase/supabase-js@2.110.9";
import { extractIdentityDocument } from "../../../src/lib/ocr/ocr.server.ts";
import type { OcrInput } from "../../../src/lib/ocr/ocr.server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);

  const authorization = request.headers.get("Authorization") ?? "";
  if (!authorization.toLowerCase().startsWith("bearer ")) {
    return json({ error: "Authentication required." }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const publishableKey =
    Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? "";
  const providerApiKey = Deno.env.get("LOVABLE_API_KEY") ?? "";
  if (!supabaseUrl || !publishableKey) return json({ error: "Backend is not configured." }, 503);

  const caller = createClient(supabaseUrl, publishableKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await caller.auth.getUser();
  if (error || !data.user) return json({ error: "Authentication required." }, 401);

  let input: OcrInput;
  try {
    input = (await request.json()) as OcrInput;
  } catch {
    return json({ error: "Invalid request body." }, 400);
  }

  // Processing is in memory. Neither the image nor extracted identity values are logged or stored here.
  return json(await extractIdentityDocument(input, providerApiKey));
});
