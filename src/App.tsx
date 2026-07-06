import { useEffect, useMemo, useRef, useState } from "react";
import MapView from "./components/MapView";
import PoiEditor from "./components/PoiEditor";
import PoiList from "./components/PoiList";
import DriveCard from "./components/DriveCard";
import type { Poi } from "./lib/types";
import {
  DEFAULT_SETTINGS,
  exportCourse,
  importCourse,
  loadPois,
  loadSettings,
  newId,
  savePois,
  saveSettings,
  starterPois,
  type Settings,
} from "./lib/store";
import { haversine } from "./lib/geo";
import { TILE_LAYERS, getLayer, prefetchTiles, tilesForBounds, type Bounds } from "./lib/tiles";
import { useGeolocation } from "./hooks/useGeolocation";
import { useWakeLock } from "./hooks/useWakeLock";
import { isCloud, currentCourseId } from "./lib/supabase";
import { deletePoiRemote, fetchPois, subscribePois, upsertMany, upsertPoi, type SyncStatus } from "./lib/cloudStore";

const BECHTEL_CENTER: [number, number] = [37.9169, -81.1153];

function chime() {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g);
    g.connect(ctx.destination);
    o.type = "sine";
    o.frequency.setValueAtTime(880, ctx.currentTime);
    o.frequency.setValueAtTime(1175, ctx.currentTime + 0.12);
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.4);
    o.start();
    o.stop(ctx.currentTime + 0.42);
  } catch {
    /* ignore */
  }
}

export default function App() {
  const [pois, setPois] = useState<Poi[]>([]);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [ready, setReady] = useState(false);

  const [mode, setMode] = useState<"edit" | "drive">("edit");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<"none" | "list" | "menu">("none");
  const [follow, setFollow] = useState(true);
  const [dismissedId, setDismissedId] = useState<string | null>(null);
  const [dl, setDl] = useState<{ active: boolean; done: number; total: number } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const prevActive = useRef<Set<string>>(new Set());
  const courseId = currentCourseId();
  const [syncStatus, setSyncStatus] = useState<SyncStatus | "local">(isCloud ? "connecting" : "local");

  // Load persisted data. In cloud mode, load the shared course from Supabase,
  // seed it if empty, subscribe to realtime changes, and cache locally for offline.
  useEffect(() => {
    let unsub = () => {};
    (async () => {
      const [localPois, s] = await Promise.all([loadPois(), loadSettings()]);
      if (isCloud) {
        try {
          let remote = await fetchPois(courseId);
          if (remote.length === 0) {
            remote = starterPois();
            await upsertMany(remote, courseId);
          }
          setPois(remote);
          savePois(remote); // offline cache
        } catch {
          // Offline / fetch failed → show the last cached course.
          setPois(localPois.length ? localPois : starterPois());
          setSyncStatus("offline");
        }
        unsub = subscribePois(
          courseId,
          (change) => {
            setPois((prev) => {
              if (change.type === "delete") return prev.filter((p) => p.id !== change.id);
              const others = prev.filter((p) => p.id !== change.poi.id);
              return [...others, change.poi].sort((a, b) => a.order - b.order);
            });
          },
          (st) => setSyncStatus(st)
        );
        setSettings(s);
      } else {
        if (localPois.length === 0 && !s.seededStarter) {
          setPois(starterPois());
          setSettings({ ...s, seededStarter: true });
        } else {
          setPois(localPois);
          setSettings(s);
        }
      }
      setReady(true);
    })();
    return () => unsub();
  }, [courseId]);

  // Cloud write-through helpers (no-op in local mode).
  const pushUpsert = (p: Poi) => {
    if (isCloud) upsertPoi(p, courseId).catch(() => setSyncStatus("offline"));
  };
  const pushMany = (ps: Poi[]) => {
    if (isCloud) upsertMany(ps, courseId).catch(() => setSyncStatus("offline"));
  };
  const pushDelete = (id: string) => {
    if (isCloud) deletePoiRemote(id).catch(() => setSyncStatus("offline"));
  };

  // Persist
  useEffect(() => {
    if (ready) savePois(pois);
  }, [pois, ready]);
  useEffect(() => {
    if (ready) saveSettings(settings);
  }, [settings, ready]);

  const geo = useGeolocation(mode === "drive");
  useWakeLock(mode === "drive");

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2600);
  };

  // ── Distances from current fix ──
  const distances = useMemo(() => {
    const m = new Map<string, number>();
    if (geo.fix) for (const p of pois) m.set(p.id, haversine(geo.fix.lat, geo.fix.lng, p.lat, p.lng));
    return m;
  }, [geo.fix, pois]);

  const activeIds = useMemo(() => {
    const s = new Set<string>();
    if (mode === "drive" && geo.fix) for (const p of pois) if ((distances.get(p.id) ?? Infinity) <= p.radius) s.add(p.id);
    return s;
  }, [mode, geo.fix, pois, distances]);

  // Chime when a new point becomes active; clear dismissal when its point leaves range.
  useEffect(() => {
    if (mode !== "drive") return;
    for (const id of activeIds) {
      if (!prevActive.current.has(id) && settings.chime) chime();
    }
    if (dismissedId && !activeIds.has(dismissedId)) setDismissedId(null);
    prevActive.current = new Set(activeIds);
  }, [activeIds, mode, settings.chime, dismissedId]);

  // The card to show = closest active point that hasn't been dismissed.
  const activeCard = useMemo(() => {
    if (mode !== "drive") return null;
    const cands = pois
      .filter((p) => activeIds.has(p.id) && p.id !== dismissedId)
      .map((p) => ({ poi: p, dist: distances.get(p.id) ?? Infinity }))
      .sort((a, b) => a.dist - b.dist);
    return cands[0] ?? null;
  }, [mode, pois, activeIds, dismissedId, distances]);

  const upcoming = useMemo(() => {
    if (mode !== "drive" || !geo.fix) return [];
    return pois
      .map((p) => ({ poi: p, dist: distances.get(p.id) ?? Infinity }))
      .filter((x) => !activeIds.has(x.poi.id))
      .sort((a, b) => a.dist - b.dist)
      .slice(0, 3);
  }, [mode, geo.fix, pois, distances, activeIds]);

  // ── POI CRUD ──
  const addPoiAt = (lat: number, lng: number) => {
    const p: Poi = {
      id: newId(),
      name: "",
      description: "",
      notes: "",
      lat,
      lng,
      category: "landmark",
      radius: settings.defaultRadius,
      order: pois.length,
      createdAt: Date.now(),
    };
    setPois((prev) => [...prev, p]);
    setSelectedId(p.id);
    setEditingId(p.id);
    pushUpsert(p);
  };

  const dropAtMyLocation = () => {
    if (!navigator.geolocation) return showToast("Location not available on this device.");
    showToast("Getting your location…");
    navigator.geolocation.getCurrentPosition(
      (pos) => addPoiAt(pos.coords.latitude, pos.coords.longitude),
      (err) => showToast(`Location error: ${err.message}`),
      { enableHighAccuracy: true, timeout: 15000 }
    );
  };

  const savePoi = (p: Poi) => {
    setPois((prev) => prev.map((x) => (x.id === p.id ? p : x)));
    setEditingId(null);
    pushUpsert(p);
    showToast("Saved.");
  };

  const deletePoi = (id: string) => {
    setPois((prev) => prev.filter((x) => x.id !== id));
    setEditingId(null);
    if (selectedId === id) setSelectedId(null);
    pushDelete(id);
  };

  const dragPoi = (id: string, lat: number, lng: number) => {
    setPois((prev) => {
      const next = prev.map((x) => (x.id === id ? { ...x, lat, lng } : x));
      const moved = next.find((x) => x.id === id);
      if (moved) pushUpsert(moved);
      return next;
    });
  };

  const movePoi = (id: string, dir: -1 | 1) => {
    setPois((prev) => {
      const arr = [...prev].sort((a, b) => a.order - b.order);
      const i = arr.findIndex((x) => x.id === id);
      const j = i + dir;
      if (j < 0 || j >= arr.length) return prev;
      [arr[i], arr[j]] = [arr[j], arr[i]];
      const reindexed = arr.map((x, k) => ({ ...x, order: k }));
      pushMany([reindexed[i], reindexed[j]]);
      return reindexed;
    });
  };

  // ── Starter points ──
  const loadStarterPoints = () => {
    setPois((prev) => {
      const names = new Set(prev.map((x) => x.name.toLowerCase()));
      const additions = starterPois(prev.length).filter((x) => !names.has(x.name.toLowerCase()));
      if (additions.length === 0) {
        showToast("All Summit Bechtel starter points are already loaded.");
        return prev;
      }
      pushMany(additions);
      showToast(`Added ${additions.length} Summit Bechtel points.`);
      return [...prev, ...additions];
    });
    setSettings((s) => ({ ...s, seededStarter: true }));
    setDrawer("none");
  };

  // ── Import / export ──
  const onImport = async (file: File) => {
    try {
      const course = await importCourse(file);
      const sorted = course.pois.sort((a, b) => a.order - b.order);
      setPois(sorted);
      setSettings((s) => ({ ...s, courseName: course.name || s.courseName }));
      pushMany(sorted);
      showToast(`Loaded ${course.pois.length} points.`);
    } catch (e) {
      showToast(`Import failed: ${(e as Error).message}`);
    }
    setDrawer("none");
  };

  // ── Offline download ──
  const boundsForDownload = (): Bounds => {
    if (pois.length >= 1) {
      const lats = pois.map((p) => p.lat);
      const lngs = pois.map((p) => p.lng);
      const pad = 0.03; // ~3 km margin
      return {
        north: Math.max(...lats) + pad,
        south: Math.min(...lats) - pad,
        east: Math.max(...lngs) + pad,
        west: Math.min(...lngs) - pad,
      };
    }
    return { north: BECHTEL_CENTER[0] + 0.05, south: BECHTEL_CENTER[0] - 0.05, east: BECHTEL_CENTER[1] + 0.05, west: BECHTEL_CENTER[1] - 0.05 };
  };

  const downloadArea = async () => {
    const layer = getLayer(settings.layerId);
    const urls = tilesForBounds(layer, boundsForDownload(), 12, 17);
    if (urls.length > 12000) {
      showToast("Area too large — add points closer together or fewer.");
      return;
    }
    setDl({ active: true, done: 0, total: urls.length });
    await prefetchTiles(urls, (done, total) => setDl({ active: true, done, total }));
    setDl({ active: false, done: urls.length, total: urls.length });
    showToast(`Cached ${urls.length} map tiles for offline use.`);
    setTimeout(() => setDl(null), 2500);
  };

  if (!ready) return <div className="flex h-full items-center justify-center text-muted">Loading…</div>;

  return (
    <div className="relative h-full w-full overflow-hidden">
      <MapView
        pois={pois}
        layerId={settings.layerId}
        mode={mode}
        fix={geo.fix}
        follow={mode === "drive" && follow}
        center={BECHTEL_CENTER}
        zoom={14}
        selectedId={selectedId}
        activeIds={activeIds}
        showRadii={mode === "edit"}
        onMapClick={addPoiAt}
        onMarkerClick={(id) => {
          setSelectedId(id);
          if (mode === "edit") setEditingId(id);
        }}
        onMarkerDrag={dragPoi}
      />

      {/* Top bar */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-[1000] flex items-start justify-between gap-2 p-3">
        <div className="pointer-events-auto flex flex-col items-start gap-2">
          <div className="flex overflow-hidden rounded-xl border border-border bg-panel/90 shadow-lg backdrop-blur">
            <button
              onClick={() => setMode("edit")}
              className={`px-4 py-2.5 text-sm font-semibold ${mode === "edit" ? "bg-sun text-ink" : "text-muted"}`}
            >
              ✎ Plan
            </button>
            <button
              onClick={() => { setMode("drive"); setFollow(true); }}
              className={`px-4 py-2.5 text-sm font-semibold ${mode === "drive" ? "bg-sun text-ink" : "text-muted"}`}
            >
              ▶ Drive
            </button>
          </div>
          <div className="flex items-center gap-1.5 rounded-full border border-border bg-panel/90 px-3 py-1 text-[11px] shadow backdrop-blur">
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ background: syncStatus === "synced" ? "#3fb68b" : syncStatus === "connecting" ? "#f5b301" : syncStatus === "offline" ? "#e5687a" : "#8fb3a0" }}
            />
            <span className="text-muted">
              {syncStatus === "local"
                ? "Local only"
                : syncStatus === "synced"
                ? `Shared · ${courseId}`
                : syncStatus === "connecting"
                ? "Connecting…"
                : "Offline (cached)"}
            </span>
          </div>
        </div>

        <div className="pointer-events-auto flex items-center gap-2">
          <select
            value={settings.layerId}
            onChange={(e) => setSettings((s) => ({ ...s, layerId: e.target.value }))}
            className="rounded-xl border border-border bg-panel/90 px-3 py-2.5 text-sm text-pale shadow-lg backdrop-blur"
          >
            {TILE_LAYERS.map((l) => (
              <option key={l.id} value={l.id}>{l.label}</option>
            ))}
          </select>
          <button onClick={() => setDrawer(drawer === "list" ? "none" : "list")} className="rounded-xl border border-border bg-panel/90 px-3 py-2.5 text-sm text-pale shadow-lg backdrop-blur">☰ {pois.length}</button>
          <button onClick={() => setDrawer(drawer === "menu" ? "none" : "menu")} className="rounded-xl border border-border bg-panel/90 px-3 py-2.5 text-sm text-pale shadow-lg backdrop-blur">⚙</button>
        </div>
      </div>

      {/* Edit-mode helpers */}
      {mode === "edit" && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[1000] flex flex-col items-center gap-2 p-3">
          <div className="pointer-events-auto rounded-full border border-border bg-panel/90 px-4 py-1.5 text-xs text-muted shadow backdrop-blur">
            Tap the map to add a point · drag a pin to move it
          </div>
          <button onClick={dropAtMyLocation} className="pointer-events-auto rounded-xl bg-forest px-5 py-3 text-base font-bold text-white shadow-lg hover:brightness-110">
            📍 Drop point at my location
          </button>
        </div>
      )}

      {/* Drive-mode status */}
      {mode === "drive" && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[1000] flex items-center justify-between p-3">
          <div className="pointer-events-auto rounded-xl border border-border bg-panel/90 px-3 py-2 text-xs shadow backdrop-blur">
            {geo.error ? (
              <span className="text-red-400">GPS: {geo.error}</span>
            ) : geo.fix ? (
              <span className="text-muted">GPS locked · ±{Math.round(geo.fix.accuracy)}m{geo.fix.speed ? ` · ${Math.round(geo.fix.speed * 2.237)} mph` : ""}</span>
            ) : (
              <span className="text-muted">Acquiring GPS…</span>
            )}
          </div>
          <button
            onClick={() => setFollow((f) => !f)}
            className={`pointer-events-auto rounded-xl border border-border px-4 py-2.5 text-sm font-semibold shadow backdrop-blur ${follow ? "bg-sun text-ink" : "bg-panel/90 text-pale"}`}
          >
            {follow ? "Following" : "Recenter"}
          </button>
        </div>
      )}

      {/* Passenger card */}
      {activeCard && (
        <DriveCard poi={activeCard.poi} distance={activeCard.dist} upcoming={upcoming} onDismiss={() => setDismissedId(activeCard.poi.id)} />
      )}

      {/* List drawer */}
      {drawer === "list" && (
        <div className="absolute inset-y-0 right-0 z-[1150] w-full max-w-sm border-l border-border shadow-2xl">
          <PoiList
            pois={pois}
            distances={distances}
            selectedId={selectedId}
            onSelect={(id) => { setSelectedId(id); setDrawer("none"); }}
            onEdit={(id) => { setSelectedId(id); setEditingId(id); setDrawer("none"); }}
            onMove={movePoi}
            onClose={() => setDrawer("none")}
          />
        </div>
      )}

      {/* Menu / settings sheet */}
      {drawer === "menu" && (
        <div className="absolute inset-0 z-[1150] flex justify-end bg-black/40" onClick={() => setDrawer("none")}>
          <div className="h-full w-full max-w-sm overflow-auto border-l border-border bg-panel p-5" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-bold text-white">Course & settings</h2>
              <button onClick={() => setDrawer("none")} className="text-muted hover:text-white">✕</button>
            </div>

            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">Course name</label>
            <input value={settings.courseName} onChange={(e) => setSettings((s) => ({ ...s, courseName: e.target.value }))} className="mb-4 w-full rounded-lg border border-border bg-ink px-3 py-2 text-white focus:border-sun focus:outline-none" />

            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">Default trigger radius: {settings.defaultRadius} m</label>
            <input type="range" min={20} max={400} step={5} value={settings.defaultRadius} onChange={(e) => setSettings((s) => ({ ...s, defaultRadius: Number(e.target.value) }))} className="mb-4 w-full accent-sun" />

            <label className="mb-4 flex items-center gap-2 text-sm text-pale">
              <input type="checkbox" checked={settings.chime} onChange={(e) => setSettings((s) => ({ ...s, chime: e.target.checked }))} className="h-4 w-4 accent-sun" />
              Play a chime when arriving at a point
            </label>

            <div className="mb-4 space-y-2 border-t border-border pt-4">
              <button onClick={loadStarterPoints} className="w-full rounded-lg border border-sun/50 bg-sun/10 px-4 py-2.5 text-sm font-semibold text-sun hover:bg-sun/20">★ Load Summit Bechtel starter points</button>
              <button onClick={() => exportCourse(settings.courseName, pois)} className="w-full rounded-lg border border-border px-4 py-2.5 text-sm text-pale hover:bg-card">⤓ Export course (.json)</button>
              <button onClick={() => fileInput.current?.click()} className="w-full rounded-lg border border-border px-4 py-2.5 text-sm text-pale hover:bg-card">⤒ Import course (.json)</button>
              <input ref={fileInput} type="file" accept="application/json,.json" className="hidden" onChange={(e) => e.target.files?.[0] && onImport(e.target.files[0])} />
            </div>

            <div className="mb-4 space-y-2 border-t border-border pt-4">
              <button onClick={downloadArea} disabled={dl?.active} className="w-full rounded-lg bg-forest px-4 py-2.5 text-sm font-semibold text-white hover:brightness-110 disabled:opacity-50">
                {dl?.active ? `Downloading… ${dl.done}/${dl.total}` : "⬇ Download this area for offline"}
              </button>
              <p className="text-xs text-muted">Caches “{getLayer(settings.layerId).label}” tiles around your points (zoom 12–17) so the map works with no signal. Do this while you still have service.</p>
            </div>

            <div className="border-t border-border pt-4">
              <p className="text-xs leading-relaxed text-muted">
                <strong className="text-pale">Install on iPad:</strong> open this page in Safari, tap the Share icon, then “Add to Home Screen.” Launch it from the icon for a fullscreen, installed app.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Editor */}
      {editingId && (() => {
        const p = pois.find((x) => x.id === editingId);
        return p ? <PoiEditor poi={p} onSave={savePoi} onDelete={deletePoi} onClose={() => setEditingId(null)} /> : null;
      })()}

      {/* Toast */}
      {toast && (
        <div className="absolute left-1/2 top-16 z-[1300] -translate-x-1/2 rounded-lg bg-black/80 px-4 py-2 text-sm text-white shadow-lg">{toast}</div>
      )}
    </div>
  );
}
