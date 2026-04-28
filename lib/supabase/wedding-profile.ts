import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, WeddingProfile } from "@/lib/supabase/types";

export const weddingProfileSelect =
  "role, partner1_name, partner2_name, wedding_date, city, budget, guest_count, wedding_type";

export async function getWeddingProfileForUser(
  supabase: SupabaseClient<Database>,
  userId: string,
) {
  const { data, error } = await supabase
    .from("wedding_profiles")
    .select(weddingProfileSelect)
    .eq("user_id", userId)
    .maybeSingle()
    .overrideTypes<WeddingProfile | null, { merge: false }>();

  if (error) {
    throw error;
  }

  return data;
}
