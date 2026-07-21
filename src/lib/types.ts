export type PoiCategory =
  | "landmark"
  | "activity"
  | "camp"
  | "safety"
  | "history"
  | "nature"
  | "food"
  | "water"
  | "statue"
  | "blocked"
  | "parkwalk"
  | "other";

export interface Poi {
  id: string;
  name: string;
  description: string;
  notes: string;
  lat: number;
  lng: number;
  category: PoiCategory;
  radius: number; // trigger radius in meters
  order: number;
  createdAt: number;
}

export interface CourseFile {
  version: 1;
  name: string;
  exportedAt: string;
  pois: Poi[];
}

export const CATEGORIES: Record<PoiCategory, { label: string; color: string; emoji: string }> = {
  landmark: { label: "Landmark", color: "#f5b301", emoji: "📍" },
  activity: { label: "Activity", color: "#e6522c", emoji: "🎯" },
  camp: { label: "Camp / Base", color: "#2982e8", emoji: "⛺" },
  safety: { label: "Safety", color: "#e11d48", emoji: "⚠️" },
  history: { label: "History", color: "#a855f7", emoji: "🏛️" },
  nature: { label: "Nature", color: "#1b5e3f", emoji: "🌲" },
  food: { label: "Food", color: "#0891b2", emoji: "🍽️" },
  water: { label: "Water", color: "#38bdf8", emoji: "🌊" },
  statue: { label: "Statue", color: "#a16207", emoji: "🗿" },
  blocked: { label: "No-drive / blocked", color: "#dc2626", emoji: "✕" },
  parkwalk: { label: "Park & walk", color: "#16a34a", emoji: "✕" },
  other: { label: "Other", color: "#64748b", emoji: "•" },
};
