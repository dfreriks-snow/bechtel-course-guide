import type { Poi } from "../lib/types";
import { CATEGORIES } from "../lib/types";
import { formatDistance } from "../lib/geo";

interface Props {
  pois: Poi[];
  distances: Map<string, number>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onEdit: (id: string) => void;
  onMove: (id: string, dir: -1 | 1) => void;
  onClose: () => void;
}

export default function PoiList({ pois, distances, selectedId, onSelect, onEdit, onMove, onClose }: Props) {
  return (
    <div className="flex h-full w-full flex-col bg-panel">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="text-sm font-bold text-white">Points of interest ({pois.length})</h2>
        <button onClick={onClose} className="rounded-md px-2 py-1 text-muted hover:text-white">✕</button>
      </div>
      <div className="flex-1 overflow-auto">
        {pois.length === 0 && (
          <p className="p-4 text-sm text-muted">No points yet. In Edit mode, tap the map or use “Drop at my location.”</p>
        )}
        {pois.map((p, i) => {
          const c = CATEGORIES[p.category];
          const d = distances.get(p.id);
          return (
            <div
              key={p.id}
              className={`flex items-center gap-2 border-b border-border/60 px-3 py-2.5 ${selectedId === p.id ? "bg-card" : ""}`}
            >
              <span
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm"
                style={{ background: c.color }}
              >
                {c.emoji}
              </span>
              <button onClick={() => onSelect(p.id)} className="min-w-0 flex-1 text-left">
                <div className="truncate text-sm font-medium text-white">{p.name || "(unnamed)"}</div>
                <div className="truncate text-xs text-muted">
                  {c.label}
                  {d != null && ` · ${formatDistance(d)} away`}
                </div>
              </button>
              <div className="flex shrink-0 items-center gap-1">
                <button onClick={() => onMove(p.id, -1)} disabled={i === 0} className="rounded px-1.5 py-1 text-muted disabled:opacity-30 hover:text-white">↑</button>
                <button onClick={() => onMove(p.id, 1)} disabled={i === pois.length - 1} className="rounded px-1.5 py-1 text-muted disabled:opacity-30 hover:text-white">↓</button>
                <button onClick={() => onEdit(p.id)} className="rounded px-2 py-1 text-sun hover:text-white">Edit</button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
