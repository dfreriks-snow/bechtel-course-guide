import { supabase } from "./supabase";
import type { Poi } from "./types";
import type { SavedCourse } from "./store";

// DB row shape (snake_case; `order` is a SQL reserved word so the column is `ord`).
interface Row {
  id: string;
  course_id: string;
  name: string;
  description: string;
  notes: string;
  lat: number;
  lng: number;
  category: string;
  radius: number;
  ord: number;
  created_at: number;
}

function toPoi(r: Row): Poi {
  return {
    id: r.id,
    name: r.name ?? "",
    description: r.description ?? "",
    notes: r.notes ?? "",
    lat: r.lat,
    lng: r.lng,
    category: (r.category as Poi["category"]) ?? "other",
    radius: r.radius ?? 90,
    order: r.ord ?? 0,
    createdAt: r.created_at ?? Date.now(),
  };
}

function toRow(p: Poi, courseId: string): Row {
  return {
    id: p.id,
    course_id: courseId,
    name: p.name,
    description: p.description,
    notes: p.notes,
    lat: p.lat,
    lng: p.lng,
    category: p.category,
    radius: p.radius,
    ord: p.order,
    created_at: p.createdAt,
  };
}

export async function fetchPois(courseId: string): Promise<Poi[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.from("pois").select("*").eq("course_id", courseId).order("ord");
  if (error) throw error;
  return (data as Row[]).map(toPoi);
}

export async function upsertPoi(p: Poi, courseId: string): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.from("pois").upsert(toRow(p, courseId));
  if (error) throw error;
}

export async function upsertMany(pois: Poi[], courseId: string): Promise<void> {
  if (!supabase || pois.length === 0) return;
  const { error } = await supabase.from("pois").upsert(pois.map((p) => toRow(p, courseId)));
  if (error) throw error;
}

export async function deletePoiRemote(id: string): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.from("pois").delete().eq("id", id);
  if (error) throw error;
}

export type SyncStatus = "connecting" | "synced" | "offline";

/**
 * Subscribe to realtime changes for a course. Calls `onChange` with the change,
 * and `onStatus` as the channel connects/drops. Returns an unsubscribe fn.
 */
export function subscribePois(
  courseId: string,
  onChange: (change: { type: "upsert"; poi: Poi } | { type: "delete"; id: string }) => void,
  onStatus: (s: SyncStatus) => void
): () => void {
  if (!supabase) return () => {};
  const client = supabase;
  const channel = client
    .channel(`pois:${courseId}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "pois", filter: `course_id=eq.${courseId}` },
      (payload) => {
        if (payload.eventType === "DELETE") {
          const old = payload.old as Partial<Row>;
          if (old.id) onChange({ type: "delete", id: old.id });
        } else {
          onChange({ type: "upsert", poi: toPoi(payload.new as Row) });
        }
      }
    )
    .subscribe((status) => {
      if (status === "SUBSCRIBED") onStatus("synced");
      else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") onStatus("offline");
      else onStatus("connecting");
    });

  return () => {
    client.removeChannel(channel);
  };
}

// ── Shared named courses (saved_courses table) ──────────────────────────────
// The whole SavedCourse (pois/stops/loop/timeBlocks) is packed into a jsonb
// `data` column; `course_id` scopes courses to the shared workspace like pois.
interface CourseRow {
  id: string;
  course_id: string;
  name: string;
  saved_at: number;
  data: { pois: Poi[]; stops?: string[]; loop?: boolean; timeBlocks?: SavedCourse["timeBlocks"] };
}

function toCourse(r: CourseRow): SavedCourse {
  return {
    id: r.id,
    name: r.name ?? "",
    savedAt: r.saved_at ?? Date.now(),
    pois: r.data?.pois ?? [],
    stops: r.data?.stops ?? [],
    loop: r.data?.loop ?? false,
    timeBlocks: r.data?.timeBlocks ?? {},
  };
}

function toCourseRow(c: SavedCourse, courseId: string): CourseRow {
  return {
    id: c.id,
    course_id: courseId,
    name: c.name,
    saved_at: c.savedAt,
    data: { pois: c.pois, stops: c.stops ?? [], loop: c.loop ?? false, timeBlocks: c.timeBlocks ?? {} },
  };
}

export async function fetchCourses(courseId: string): Promise<SavedCourse[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.from("saved_courses").select("*").eq("course_id", courseId).order("saved_at", { ascending: false });
  if (error) throw error;
  return (data as CourseRow[]).map(toCourse);
}

export async function upsertCourse(course: SavedCourse, courseId: string): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.from("saved_courses").upsert(toCourseRow(course, courseId));
  if (error) throw error;
}

export async function deleteCourseRemote(id: string): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.from("saved_courses").delete().eq("id", id);
  if (error) throw error;
}

/** Subscribe to realtime changes for the shared course library. */
export function subscribeCourses(
  courseId: string,
  onChange: () => void,
  onStatus: (s: SyncStatus) => void
): () => void {
  if (!supabase) return () => {};
  const client = supabase;
  const channel = client
    .channel(`saved_courses:${courseId}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "saved_courses", filter: `course_id=eq.${courseId}` },
      () => onChange()
    )
    .subscribe((status) => {
      if (status === "SUBSCRIBED") onStatus("synced");
      else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") onStatus("offline");
      else onStatus("connecting");
    });
  return () => { client.removeChannel(channel); };
}
