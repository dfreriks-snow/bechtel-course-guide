import type { Poi } from "../lib/types";
import { CATEGORIES } from "../lib/types";
import { formatDistance } from "../lib/geo";

interface Props {
  poi: Poi;
  distance: number | null;
  upcoming: { poi: Poi; dist: number }[];
  onDismiss: () => void;
}

/** Large, passenger-facing card that appears when you reach a point. */
export default function DriveCard({ poi, distance, upcoming, onDismiss }: Props) {
  const c = CATEGORIES[poi.category];
  return (
    <div className="pointer-events-auto absolute inset-x-0 bottom-0 z-[1100] p-3 sm:inset-x-auto sm:right-4 sm:bottom-4 sm:w-[440px]">
      <div className="overflow-hidden rounded-2xl border-2 border-sun bg-panel/95 shadow-2xl backdrop-blur">
        <div className="flex items-center gap-3 px-5 py-3" style={{ background: c.color }}>
          <span className="text-2xl">{c.emoji}</span>
          <div className="flex-1">
            <div className="text-xs font-bold uppercase tracking-wide text-black/70">{c.label} · now arriving</div>
            <h2 className="text-2xl font-extrabold leading-tight text-black">{poi.name || "Point of interest"}</h2>
          </div>
          <button onClick={onDismiss} className="rounded-lg bg-black/20 px-3 py-1.5 text-sm font-bold text-black hover:bg-black/30">✕</button>
        </div>
        <div className="px-5 py-4">
          {poi.description && <p className="mb-3 text-xl font-semibold leading-snug text-white">{poi.description}</p>}
          {poi.notes && <p className="whitespace-pre-wrap text-lg leading-relaxed text-pale">{poi.notes}</p>}
          {distance != null && (
            <p className="mt-3 text-sm text-muted">{formatDistance(distance)} from the vehicle</p>
          )}
          {upcoming.length > 0 && (
            <div className="mt-4 border-t border-border pt-3">
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Coming up</div>
              <div className="space-y-1">
                {upcoming.map(({ poi: u, dist }) => (
                  <div key={u.id} className="flex items-center justify-between text-sm">
                    <span className="truncate text-pale">
                      {CATEGORIES[u.category].emoji} {u.name || "(unnamed)"}
                    </span>
                    <span className="ml-2 shrink-0 tabular-nums text-muted">{formatDistance(dist)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
