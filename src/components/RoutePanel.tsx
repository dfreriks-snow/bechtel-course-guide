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
  timeBlocks: Record<string, { minutes: number; label: string }>;
  onAddTimeBlock: () => void;
  onEditTimeBlock: (id: string) => void;
  canManage: boolean;
  savedCourses: SavedCourse[];
  courseName: string;
  onSaveCourse: () => void;
  onLoadCourse: (course: SavedCourse) => void;
  onDeleteCourse: (id: string) => void;
}

export default function RoutePanel(props: Props) {
  const { pois, stops, orderedNames, result, loop } = props;
  const byId = useMemo(() => new Map(pois.map((p) => [p.id, p])), [pois]);
  const available = useMemo(
    () => pois.slice().sort((a, b) => a.name.localeCompare(b.name)),
    [pois]
  );
  const isSaved = useMemo(
    () => props.savedCourses.some((c) => c.name.toLowerCase() === props.courseName.trim().toLowerCase()),
    [props.savedCourses, props.courseName]
  );
  const stopSeconds = useMemo(
    () => stops.reduce((sum, id) => {
      const p = byId.get(id);
      if (p) return sum + (p.dwellMin ?? 0) * 60;
      const tb = props.timeBlocks[id];
      return tb ? sum + tb.minutes * 60 : sum;
    }, 0),
    [stops, byId, props.timeBlocks]
  );
  // Build render rows, numbering only the POI stops (matches the map badges).
  let poiSeq = 0;
  const rows = stops.map((id, i) => {
    const p = byId.get(id);
    if (p) { const legIndex = poiSeq; poiSeq += 1; return { id, i, poi: p, badge: poiSeq, legIndex }; }
    return { id, i, time: props.timeBlocks[id] };
  });

  return (
    <div className="flex h-full flex-col bg-panel text-pale">
      {/* Header */}
      <div className="flex items-start justify-between border-b border-border px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold">🧭 Plan a Course</h2>
          {props.courseName.trim() && (
            <p className="mt-0.5 truncate text-xs">
              <span className="text-muted">Course: </span>
              <span className="font-semibold text-pale">{props.courseName}</span>
              {isSaved
                ? <span className="ml-1 rounded bg-sun/20 px-1 text-[10px] font-semibold text-sun">SAVED</span>
                : <span className="ml-1 rounded bg-white/10 px-1 text-[10px] text-muted">unsaved</span>}
            </p>
          )}
        </div>
        <button onClick={props.onClose} className="flex-none rounded-lg px-2 py-1 text-sm text-muted hover:bg-white/5">✕</button>
      </div>

      {/* Totals */}
      <div className="border-b border-border bg-black/20 px-4 py-3">
        {result && stops.length >= 2 ? (
          <>
            <div className="flex items-end justify-between">
              <div>
                <div className="text-2xl font-bold text-sun">{formatDuration(result.totalSeconds + stopSeconds)}</div>
                <div className="text-xs text-muted">estimated total tour time</div>
              </div>
              <div className="text-right">
                <div className="text-lg font-semibold">{result.totalMiles.toFixed(2)} mi</div>
                <div className="text-xs text-muted">{stops.length} stops{loop ? " · loop" : ""}</div>
              </div>
            </div>
            <div className="mt-1 text-[11px] text-muted">
              🚗 {formatDuration(result.totalSeconds)} driving{stopSeconds > 0 ? ` · ⏱ ${formatDuration(stopSeconds)} at stops` : ""}
            </div>
          </>
        ) : (
          <p className="text-sm text-muted">Add two or more stops to calculate distance and time.</p>
        )}
        <p className="mt-2 text-[11px] leading-snug text-muted">
          15 mph in the reserve · 20 mph on the approach · 5 mph through activity zones, plus your stop times. Estimates only.
        </p>
      </div>

      {/* Ordered stops */}
      <div className="flex-1 overflow-y-auto px-3 py-3">
        {stops.length === 0 && <p className="px-1 text-sm text-muted">No stops yet. Tap points on the map, or use the dropdown below.</p>}
        <ol className="space-y-1.5">
          {rows.map((r) => {
            if ("time" in r) {
              const tb = r.time;
              return (
                <li key={`${r.id}-${r.i}`} className="rounded-lg border border-sky-500/40 bg-sky-500/10 p-2">
                  <div className="flex items-center gap-2">
                    <span className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-sky-400 text-xs font-bold text-ink">⏱</span>
                    <button onClick={() => props.onEditTimeBlock(r.id)} className="min-w-0 flex-1 truncate text-left text-sm">
                      {tb ? <>{tb.label} — <span className="text-sky-300">{tb.minutes} min</span></> : "(time block)"}
                    </button>
                    <button onClick={() => props.onMove(r.i, -1)} disabled={r.i === 0} className="px-1.5 text-muted disabled:opacity-30">▲</button>
                    <button onClick={() => props.onMove(r.i, 1)} disabled={r.i === stops.length - 1} className="px-1.5 text-muted disabled:opacity-30">▼</button>
                    <button onClick={() => props.onRemove(r.i)} className="px-1.5 text-red-400">✕</button>
                  </div>
                </li>
              );
            }
            const p = r.poi;
            const leg = result?.legs[r.legIndex]; // drive from this stop to the next stop
            return (
              <li key={`${r.id}-${r.i}`} className="rounded-lg border border-border bg-black/10 p-2">
                <div className="flex items-center gap-2">
                  <span className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-sun text-xs font-bold text-ink">{r.badge}</span>
                  <span className="flex-1 truncate text-sm">{CATEGORIES[p.category].emoji} {p.name}</span>
                  <button onClick={() => props.onMove(r.i, -1)} disabled={r.i === 0} className="px-1.5 text-muted disabled:opacity-30">▲</button>
                  <button onClick={() => props.onMove(r.i, 1)} disabled={r.i === stops.length - 1} className="px-1.5 text-muted disabled:opacity-30">▼</button>
                  <button onClick={() => props.onRemove(r.i)} className="px-1.5 text-red-400">✕</button>
                </div>
                {p.dwellMin ? (
                  <div className="mt-1 pl-8 text-[11px] text-sun">⏱ {p.dwellMin} min stop</div>
                ) : null}
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
          {loop && poiSeq >= 2 && orderedNames.length > poiSeq && (
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
        <button onClick={props.onAddTimeBlock} className="w-full rounded-lg border border-sky-500/40 bg-sky-500/10 px-3 py-2.5 text-sm font-semibold text-sky-300 hover:bg-sky-500/20">
          ⏱ Add time block…
        </button>
        {stops.length > 0 && (
          <button onClick={props.onClear} className="w-full rounded-lg border border-border px-4 py-2 text-sm text-muted hover:bg-white/5">
            Clear course
          </button>
        )}
        {props.canManage && (
          <div className="space-y-2 border-t border-border pt-2">
            <button onClick={props.onSaveCourse} className="w-full rounded-lg border border-sun/50 bg-sun/10 px-4 py-2.5 text-sm font-semibold text-sun hover:bg-sun/20">💾 Save course (points + route)</button>
            {props.savedCourses.length > 0 && (
              <div className="space-y-1">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">Saved courses</p>
                <ul className="space-y-1">
                  {props.savedCourses.map((c) => (
                    <li key={c.id} className="flex items-center gap-2 rounded-lg border border-border bg-black/10 px-2 py-1.5">
                      <button onClick={() => props.onLoadCourse(c)} className="min-w-0 flex-1 text-left" title="Load this course">
                        <span className="block truncate text-sm text-pale">{c.name}</span>
                        <span className="block text-[11px] text-muted">{c.pois.length} pts{c.stops && c.stops.length ? ` · ${c.stops.length} stops` : ""}</span>
                      </button>
                      <button onClick={() => props.onLoadCourse(c)} className="flex-none rounded-lg border border-border px-2 py-1 text-xs text-pale hover:bg-card">Load</button>
                      <button onClick={() => { if (confirm(`Delete saved course “${c.name}”?`)) props.onDeleteCourse(c.id); }} className="flex-none rounded-lg px-2 py-1 text-xs text-red-400 hover:bg-white/5" title="Delete">✕</button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
