import type { QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Cross-tab auth synchronisation. When one tab signs out it posts SIGNED_OUT
 * on this channel so every other open tab drops its cached data and returns
 * to the sign-in screen immediately.
 */
export const AUTH_CHANNEL = "govvisit-auth";

export function broadcastSignedOut() {
  try {
    const channel = new BroadcastChannel(AUTH_CHANNEL);
    channel.postMessage("SIGNED_OUT");
    channel.close();
  } catch {
    // BroadcastChannel unavailable — Supabase's own localStorage
    // storage-event sync still propagates the sign-out to other tabs.
  }
}

/**
 * Full sign-out: clears the query cache, notifies other tabs, and revokes
 * the refresh token (and all server-side sessions) so access cannot be
 * regained after the browser session ends.
 */
export async function signOutEverywhere(queryClient: QueryClient) {
  await queryClient.cancelQueries();
  queryClient.clear();
  broadcastSignedOut();
  await supabase.auth.signOut({ scope: "global" });
}