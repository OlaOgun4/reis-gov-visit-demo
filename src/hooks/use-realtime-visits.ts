import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Subscribes to visitor-related table changes so dashboard screens stay live
 * without a manual refresh (e.g. check-ins made from the mobile app).
 */
export function useRealtimeVisits() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const channel = supabase
      .channel("govvisit-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "visits" }, () => {
        queryClient.invalidateQueries({ queryKey: ["visits"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "visitors" }, () => {
        queryClient.invalidateQueries({ queryKey: ["visits"] });
        queryClient.invalidateQueries({ queryKey: ["visitors"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "bookings" }, () => {
        queryClient.invalidateQueries({ queryKey: ["bookings"] });
      })
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [queryClient]);
}
