import { useMemo } from "react";
import type { Poi } from "../lib/types";
import { CATEGORIES } from "../lib/types";
import type { RouteResult } from "../lib/routing";
import { formatDuration } from "../lib/routing";
import type { SavedCourse } from "../lib/store";

interface Props {
  pois: Poi[];
  stops: string[];               // ordered POI ids
  orderedNames: string[];        // traversal-order names (incl. returned start if looping)
  result: RouteResult | null;
  loop: boolean;
  onAdd: (id: string) => void;
  onRemove: (index: number) => void;
  onMove: (index: number, dir: -1 | 1) => void;
  onClear: () => void;
  onToggleLoop: () => void;
  onClose: () => void;
  canManage: boolean;
  savedCourses: SavedCourse[];
  onSaveCourse: () => void;
  onLoadCourse: (course: SavedCourse) => void;
}

export default function RoutePanel(props: Props) {
  const { pois, stops, orderedNames, result, loop } = props;
  const byId = useMemo(() => new Map(pois.map((p) => [p.id, p])), [pois]);
  const available = useMemo(
    () => pois.slice().sort((a, b) => a.name.localeCompare(b.name)),
    [pois]
  );

  return (
    <div className="flex h-full flex-col bg-panel text-pale">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="text-base font-semibold">🧭 Plan a Course</h2>
        <button onClick={props.onClose} className="rounded-lg px-2 py-1 text-sm text-muted hover:bg-white/5">✕</button>
      </div>

      {/* Totals */}
      <div className="border-b border-border bg-black/20 px-4 py-3">
        {result && stops.length >= 2 ? (
          <div className="flex items-end justify-between">
            <div>
              <div className="text-2xl font-bold text-sun">{formatDuration(result.totalSeconds)}</div>
              <div className="text-xs text-muted">estimated drive time</div>
            </div>
            <div className="text-right">
              <div className="text-lg font-semibold">{result.totalMiles.toFixed(2)} mi</div>
              <div className="text-xs text-muted">{stops.length} stops{loop ? " · loop" : ""}</div>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted">Add two or more stops to calculate distance and drive time.</p>
        )}
        <p className="mt-2 text-[11px] leading-snug text-muted">
          20 mph on roads · 5 mph through activity zones (youth present). Times are estimates from the road map.
        </p>
      </div>

      {/* Ordered stops */}
      <div className="flex-1 overflow-y-auto px-3 py-3">
        {stops.length === 0 && <p className="px-1 text-sm text-muted">No stops yet. Tap points on the map, or use the dropdown below.</p>}
        <ol className="space-y-1.5">
          {stops.map((id, i) => {
            const p = byId.get(id);
            const leg = result?.legs[i]; // travel from this stop to the next
            return (
              <li key={`${id}-${i}`} className="rounded-lg border border-border bg-black/10 p-2">
                <div className="flex items-center gap-2">
                  <span className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-sun text-xs font-bold text-ink">{i + 1}</span>
                  <span className="flex-1 truncate text-sm">
                    {p ? `${CATEGORIES[p.category].emoji} ${p.name}` : "(deleted point)"}
                  </span>
                  <button onClick={() => props.onMove(i, -1)} disabled={i === 0} className="px-1.5 text-muted disabled:opacity-30">▲</button>
                  <button onClick={() => props.onMove(i, 1)} disabled={i === stops.length - 1} className="px-1.5 text-muted disabled:opacity-30">▼</button>
                  <button onClick={() => props.onRemove(i)} className="px-1.5 text-red-400">✕</button>
                </div>
                {leg && (
                  <div className="mt-1 pl-8 text-[11px] text-muted">
                    ↓ {leg.miles.toFixed(2)} mi · {formatDuration(leg.seconds)}
                    {leg.slow && <span className="ml-1 rounded bg-red-500/20 px-1 text-red-300">5 mph zone</span>}
                    {leg.offRoad && <span className="ml-1 rounded bg-white/10 px-1">off-road est.</span>}
                  </div>
                )}
              </li>
            );
          })}
          {loop && stops.length >= 2 && orderedNames.length > stops.length && (
            <li className="pl-8 text-[11px] text-muted">↩ return to start ({orderedNames[0]})</li>
          )}
        </ol>
      </div>

      {/* Controls */}
      <div className="border-t border-border px-3 py-3 space-y-2">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={loop} onChange={props.onToggleLoop} />
          Loop back to the starting point
        </label>
        <p className="text-[11px] leading-snug text-muted">
          Tap points on the map to add them, or use the dropdown. Use ▲▼ to reorder.
        </p>
        <select
          value=""
          onChange={(e) => { if (e.target.value) props.onAdd(e.target.value); }}
          className="w-full rounded-lg border border-border bg-black/20 px-3 py-2.5 text-sm text-pale"
        >
          <option value="">➕ Add a stop…</option>
          {available.map((p) => (
            <option key={p.id} value={p.id}>{CATEGORIES[p.category].emoji} {p.name}</option>
          ))}
        </select>
        {stops.length > 0 && (
          <button onClick={props.onClear} className="w-full rounded-lg border border-border px-4 py-2 text-sm text-muted hover:bg-white/5">
            Clear course
          </button>
        )}
        {props.canManage && (
          <div className="space-y-2 border-t border-border pt-2">
            <button onClick={props.onSaveCourse} className="w-full rounded-lg border border-sun/50 bg-sun/10 px-4 py-2.5 text-sm font-semibold text-sun hover:bg-sun/20">💾 Save course (points + route)</button>
            {props.savedCourses.length > 0 && (
              <select
                value=""
                onChange={(e) => { const c = props.savedCourses.find((x) => x.id === e.target.value); if (c) props.onLoadCourse(c); }}
                className="w-full rounded-lg border border-border bg-black/20 px-3 py-2.5 text-sm text-pale"
              >
                <option value="">📂 Load saved course…</option>
                {props.savedCourses.map((c) => (
                  <option key={c.id} value={c.id}>{c.name} ({c.pois.length} pts{c.stops && c.stops.length ? `, ${c.stops.length} stops` : ""})</option>
                ))}
              </select>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
