import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** True when Supabase credentials are configured → shared/collaborative mode. */
export const isCloud = Boolean(url && anon);

export const supabase: SupabaseClient | null = isCloud
  ? createClient(url as string, anon as string, {
      realtime: { params: { eventsPerSecond: 5 } },
      auth: { persistSession: false },
    })
  : null;

/** Shared course id — from ?course=… in the URL, else "jamboree". */
export function currentCourseId(): string {
  const p = new URLSearchParams(window.location.search).get("course");
  return (p && p.trim()) || "jamboree";
}
