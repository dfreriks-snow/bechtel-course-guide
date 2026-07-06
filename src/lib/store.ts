import localforage from "localforage";
import type { CourseFile, Poi } from "./types";
import { BECHTEL_STARTER } from "../data/bechtelStarter";

const store = localforage.createInstance({ name: "bechtel-course-guide", storeName: "data" });

const POIS_KEY = "pois";
const SETTINGS_KEY = "settings";

export interface Settings {
  courseName: string;
  layerId: string;
  defaultRadius: number;
  chime: boolean;
  seededStarter: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  courseName: "Bechtel Course",
  layerId: "topo",
  defaultRadius: 75,
  chime: true,
  seededStarter: false,
};

export async function loadPois(): Promise<Poi[]> {
  const pois = (await store.getItem<Poi[]>(POIS_KEY)) ?? [];
  return pois.sort((a, b) => a.order - b.order);
}

export async function savePois(pois: Poi[]): Promise<void> {
  await store.setItem(POIS_KEY, pois);
}

export async function loadSettings(): Promise<Settings> {
  const s = (await store.getItem<Partial<Settings>>(SETTINGS_KEY)) ?? {};
  return { ...DEFAULT_SETTINGS, ...s };
}

export async function saveSettings(s: Settings): Promise<void> {
  await store.setItem(SETTINGS_KEY, s);
}

export function newId(): string {
  return `poi_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

/** Build full Poi records from the bundled Summit Bechtel starter set.
 * IDs are deterministic (derived from the name) so seeding the same course
 * from multiple devices upserts identical rows instead of creating duplicates. */
export function starterPois(startOrder = 0): Poi[] {
  const slug = (s: string) => "seed_" + s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  return BECHTEL_STARTER.map((s, i) => ({
    id: slug(s.name),
    name: s.name,
    description: s.description,
    notes: s.notes,
    lat: s.lat,
    lng: s.lng,
    category: s.category,
    radius: s.radius ?? 90,
    order: startOrder + i,
    createdAt: Date.now(),
  }));
}

export function exportCourse(name: string, pois: Poi[]): void {
  const data: CourseFile = {
    version: 1,
    name,
    exportedAt: new Date().toISOString(),
    pois,
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name.replace(/[^a-z0-9]+/gi, "_")}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export async function importCourse(file: File): Promise<CourseFile> {
  const text = await file.text();
  const data = JSON.parse(text) as CourseFile;
  if (!data || !Array.isArray(data.pois)) throw new Error("Not a valid course file.");
  // Basic sanitize
  data.pois = data.pois.map((p, i) => ({
    ...p,
    order: typeof p.order === "number" ? p.order : i,
    radius: typeof p.radius === "number" ? p.radius : 75,
  }));
  return data;
}
