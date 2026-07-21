import { useEffect, useState } from "react";
import type { Poi, PoiCategory } from "../lib/types";
import { CATEGORIES } from "../lib/types";
import { formatCoord } from "../lib/geo";

interface Props {
  poi: Poi;
  onSave: (poi: Poi) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}

export default function PoiEditor({ poi, onSave, onDelete, onClose }: Props) {
  const [draft, setDraft] = useState<Poi>(poi);
  useEffect(() => setDraft(poi), [poi]);

  const set = <K extends keyof Poi>(k: K, v: Poi[K]) => setDraft((d) => ({ ...d, [k]: v }));

  return (
    <div className="absolute inset-0 z-[1200] flex items-end justify-center bg-black/50 sm:items-center" onClick={onClose}>
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-auto rounded-t-2xl border border-border bg-panel p-5 shadow-2xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-white">Edit point</h2>
          <button onClick={onClose} className="rounded-md px-2 py-1 text-muted hover:text-white">✕</button>
        </div>

        <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">Name</label>
        <input
          autoFocus
          value={draft.name}
          onChange={(e) => set("name", e.target.value)}
          placeholder="e.g. Consol Energy Bridge Overlook"
          className="mb-3 w-full rounded-lg border border-border bg-ink px-3 py-2.5 text-base text-white placeholder:text-muted focus:border-sun focus:outline-none"
        />

        <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">Category</label>
        <div className="mb-3 flex flex-wrap gap-2">
          {(Object.keys(CATEGORIES) as PoiCategory[]).map((c) => (
            <button
              key={c}
              onClick={() => set("category", c)}
              className={`rounded-full border px-3 py-1.5 text-sm ${draft.category === c ? "border-white text-white" : "border-border text-muted hover:text-white"}`}
              style={{ background: draft.category === c ? CATEGORIES[c].color : "transparent" }}
            >
              {CATEGORIES[c].emoji} {CATEGORIES[c].label}
            </button>
          ))}
        </div>

        <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">Description (shown big to passengers)</label>
        <textarea
          value={draft.description}
          onChange={(e) => set("description", e.target.value)}
          rows={2}
          placeholder="Short headline passengers see as you approach."
          className="mb-3 w-full rounded-lg border border-border bg-ink px-3 py-2.5 text-base text-white placeholder:text-muted focus:border-sun focus:outline-none"
        />

        <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">Notes / talking points</label>
        <textarea
          value={draft.notes}
          onChange={(e) => set("notes", e.target.value)}
          rows={4}
          placeholder="History, facts, safety reminders, what to point out…"
          className="mb-3 w-full rounded-lg border border-border bg-ink px-3 py-2.5 text-base text-white placeholder:text-muted focus:border-sun focus:outline-none"
        />

        <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">
          Trigger radius: {draft.radius} m ({Math.round(draft.radius * 3.28084)} ft)
        </label>
        <input
          type="range"
          min={20}
          max={400}
          step={5}
          value={draft.radius}
          onChange={(e) => set("radius", Number(e.target.value))}
          className="mb-3 w-full accent-sun"
        />

        <p className="mb-4 text-xs text-muted">Location: {formatCoord(draft.lat, draft.lng)} · drag the pin on the map to move it.</p>

        <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">
          Stop time (minutes to visit / explore)
        </label>
        <input
          type="number"
          min={0}
          max={480}
          step={5}
          value={draft.dwellMin ?? 0}
          onChange={(e) => set("dwellMin", Math.max(0, Number(e.target.value) || 0))}
          className="mb-1 w-full rounded-lg border border-border bg-ink px-3 py-2.5 text-base text-white placeholder:text-muted focus:border-sun focus:outline-none"
        />
        <p className="mb-4 text-xs text-muted">Added to the course total in the Guide planner. Leave 0 for a drive-by.</p>

        <div className="flex items-center justify-between gap-3">
          <button
            onClick={() => onDelete(draft.id)}
            className="rounded-lg border border-red-500/50 px-4 py-2.5 text-sm font-medium text-red-400 hover:bg-red-500/10"
          >
            Delete
          </button>
          <button
            onClick={() => onSave(draft)}
            className="flex-1 rounded-lg bg-sun px-4 py-2.5 text-base font-bold text-ink hover:brightness-110"
          >
            Save point
          </button>
        </div>
      </div>
    </div>
  );
}
