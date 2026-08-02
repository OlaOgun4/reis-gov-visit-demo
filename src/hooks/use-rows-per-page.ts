import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { FacilityConfig } from "@/lib/govvisit";

/** Rows shown per page in every dashboard table — set on the configuration screen. */
export function useRowsPerPage() {
  const { data } = useQuery({
    queryKey: ["config"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("facility_config")
        .select("*")
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as FacilityConfig | null;
    },
    staleTime: 60_000,
  });
  return data?.rows_per_page && data.rows_per_page > 0 ? data.rows_per_page : 10;
}
