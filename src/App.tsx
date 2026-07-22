import { useEffect, useMemo, useRef, useState } from "react";
import MapView from "./components/MapView";
import PoiEditor from "./components/PoiEditor";
import PoiList from "./components/PoiList";
import DriveCard from "./components/DriveCard";
import RoutePanel from "./components/RoutePanel";
import type { Poi } from "./lib/types";
import { CATEGORIES } from "./lib/types";
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
  loadSavedCourses,
  saveNamedCourse,
  deleteNamedCourse,
  type SavedCourse,
  type Settings,
} from "./lib/store";
import { haversine } from "./lib/geo";
import { TILE_LAYERS, getLayer, prefetchTiles, tilesForBounds, type Bounds } from "./lib/tiles";
import { useGeolocation } from "./hooks/useGeolocation";
import { useWakeLock } from "./hooks/useWakeLock";
import { isCloud, currentCourseId } from "./lib/supabase";
import { deletePoiRemote, fetchPois, subscribePois, upsertMany, upsertPoi, type SyncStatus } from "./lib/cloudStore";
import { computeRoute, roadPolylines, type RouteResult, type SlowZone } from "./lib/routing";

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

const PLAN_PASSWORD = "koolkids";

export default function App() {
  const [pois, setPois] = useState<Poi[]>([]);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [ready, setReady] = useState(false);

  const [mode, setMode] = useState<"edit" | "drive">("drive");
  const [planUnlocked, setPlanUnlocked] = useState<boolean>(() => {
    try { return localStorage.getItem("planUnlocked") === "1"; } catch { return false; }
  });
  const [showPw, setShowPw] = useState(false);
  const [pwInput, setPwInput] = useState("");
  const [pwError, setPwError] = useState(false);
  const tryUnlock = () => {
    if (pwInput === PLAN_PASSWORD) {
      setPlanUnlocked(true);
      try { localStorage.setItem("planUnlocked", "1"); } catch {}
      setShowPw(false); setPwInput(""); setPwError(false); setMode("edit");
    } else {
      setPwError(true);
    }
  };
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState(false);
  const [searchQ, setSearchQ] = useState("");
  const [savedCourses, setSavedCourses] = useState<SavedCourse[]>([]);
  const [saveName, setSaveName] = useState("");
  useEffect(() => { loadSavedCourses().then(setSavedCourses); }, []);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pendingNewId, setPendingNewId] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<"none" | "list" | "menu" | "route">("none");
  const [routeStops, setRouteStops] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem("routeStops") || "[]"); } catch { return []; }
  });
  const [timeBlocks, setTimeBlocks] = useState<Record<string, { minutes: number; label: string }>>(() => {
    try { return JSON.parse(localStorage.getItem("routeTimeBlocks") || "{}"); } catch { return {}; }
  });
  const [routeLoop, setRouteLoop] = useState<boolean>(() => { try { return localStorage.getItem("routeLoop") === "1"; } catch { return false; } });
  const [showRoads, setShowRoads] = useState<boolean>(() => { try { return localStorage.getItem("showRoads") === "1"; } catch { return false; } });
  useEffect(() => { try { localStorage.setItem("routeStops", JSON.stringify(routeStops)); } catch { /* ignore */ } }, [routeStops]);
  useEffect(() => { try { localStorage.setItem("routeTimeBlocks", JSON.stringify(timeBlocks)); } catch { /* ignore */ } }, [timeBlocks]);
  useEffect(() => { try { localStorage.setItem("routeLoop", routeLoop ? "1" : "0"); } catch { /* ignore */ } }, [routeLoop]);
  useEffect(() => { try { localStorage.setItem("showRoads", showRoads ? "1" : "0"); } catch { /* ignore */ } }, [showRoads]);
  const roads = useMemo(() => roadPolylines(), []);
  const addStop = (id: string) => setRouteStops((s) => [...s, id]);
  const removeStop = (i: number) => setRouteStops((s) => {
    const id = s[i];
    if (id && id.startsWith("time_")) setTimeBlocks((m) => { const n = { ...m }; delete n[id]; return n; });
    return s.filter((_, idx) => idx !== i);
  });
  const moveStop = (i: number, dir: -1 | 1) => setRouteStops((s) => { const n = [...s]; const j = i + dir; if (j < 0 || j >= n.length) return s; [n[i], n[j]] = [n[j], n[i]]; return n; });
  const clearRoute = () => { setRouteStops([]); setTimeBlocks({}); };
  const addTimeBlock = (minutes: number, label = "Explore/View") => {
    const mins = Math.max(1, Math.round(minutes || 0));
    if (!mins) return;
    const id = `time_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    setTimeBlocks((m) => ({ ...m, [id]: { minutes: mins, label } }));
    setRouteStops((s) => [...s, id]);
  };
  const editTimeBlock = (id: string) => {
    const cur = timeBlocks[id];
    if (!cur) return;
    const label = (window.prompt("Time block label:", cur.label) || cur.label).trim() || cur.label;
    const minsStr = window.prompt("Minutes:", String(cur.minutes));
    const minutes = Math.max(1, Math.round(Number(minsStr) || cur.minutes));
    setTimeBlocks((m) => ({ ...m, [id]: { minutes, label } }));
  };
  const routeCompute = useMemo(() => {
    const byId = new Map(pois.map((p) => [p.id, p]));
    const base = routeStops.map((id) => byId.get(id)).filter(Boolean) as Poi[];
    const ordered = routeLoop && base.length >= 2 ? [...base, base[0]] : base;
    const zones: SlowZone[] = pois.filter((p) => p.category === "activity").map((p) => ({ lat: p.lat, lng: p.lng, radius: p.radius }));
    const blocked: SlowZone[] = pois.filter((p) => p.category === "blocked").map((p) => ({ lat: p.lat, lng: p.lng, radius: p.radius }));
    const result: RouteResult | null = ordered.length >= 2 ? computeRoute(ordered.map((p) => ({ lat: p.lat, lng: p.lng })), zones, blocked) : null;
    return { result, orderedNames: ordered.map((p) => p.name) };
  }, [pois, routeStops, routeLoop]);
  const [follow, setFollow] = useState(true);
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());
  const [previewId, setPreviewId] = useState<string | null>(null);
  const previewTimer = useRef<number | null>(null);
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

  // Persist (never persist an unsaved, freshly-dropped pin)
  useEffect(() => {
    if (ready) savePois(pendingNewId ? pois.filter((x) => x.id !== pendingNewId) : pois);
  }, [pois, ready, pendingNewId]);
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

  const searchResults = useMemo(() => {
    const q = searchQ.trim().toLowerCase();
    if (!q) return [] as Poi[];
    const hit = pois.filter((p) =>
      p.name.toLowerCase().includes(q) ||
      CATEGORIES[p.category].label.toLowerCase().includes(q) ||
      (p.description ?? "").toLowerCase().includes(q));
    hit.sort((a, b) => {
      const an = a.name.toLowerCase().startsWith(q) ? 0 : 1;
      const bn = b.name.toLowerCase().startsWith(q) ? 0 : 1;
      if (an !== bn) return an - bn;
      return a.name.localeCompare(b.name);
    });
    return hit.slice(0, 12);
  }, [pois, searchQ]);
  const goToPoi = (id: string) => {
    setSelectedId(id);
    setSearch(false);
    setSearchQ("");
  };
  // Drive mode: tapping a point previews its card for 10s (or until dismissed).
  const previewPoi = (id: string) => {
    setPreviewId(id);
    if (previewTimer.current) clearTimeout(previewTimer.current);
    previewTimer.current = window.setTimeout(() => setPreviewId(null), 10000);
  };
  const closePreview = () => {
    if (previewTimer.current) clearTimeout(previewTimer.current);
    previewTimer.current = null;
    setPreviewId(null);
  };

  // Chime when a new point becomes active; clear dismissal when its point leaves range.
  useEffect(() => {
    if (mode !== "drive") return;
    for (const id of activeIds) {
      if (!prevActive.current.has(id) && settings.chime) chime();
    }
    // Forget dismissals for points that have left range (so they re-trigger later).
    setDismissed((d) => {
      let changed = false;
      const next = new Set<string>();
      for (const id of d) { if (activeIds.has(id)) next.add(id); else changed = true; }
      return changed ? next : d;
    });
    prevActive.current = new Set(activeIds);
  }, [activeIds, mode, settings.chime]);

  // Show a card for every active point (not dismissed), nearest first, so
  // overlapping activities stack instead of hiding one another.
  const activeCards = useMemo(() => {
    if (mode !== "drive") return [];
    return pois
      .filter((p) => activeIds.has(p.id) && !dismissed.has(p.id))
      .map((p) => ({ poi: p, dist: distances.get(p.id) ?? Infinity }))
      .sort((a, b) => a.dist - b.dist);
  }, [mode, pois, activeIds, dismissed, distances]);

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
    setPois((prev) => [...prev.filter((x) => x.id !== pendingNewId), p]);
    setSelectedId(p.id);
    setEditingId(p.id);
    setPendingNewId(p.id); // provisional until the user hits Save
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
    setPendingNewId((cur) => (cur === p.id ? null : cur)); // commit the pin
    pushUpsert(p);
    showToast("Saved.");
  };

  const deletePoi = (id: string) => {
    setPois((prev) => prev.filter((x) => x.id !== id));
    setEditingId(null);
    if (selectedId === id) setSelectedId(null);
    if (pendingNewId === id) setPendingNewId(null);
    else pushDelete(id);
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

  // ── Named courses (saved locally on this device) ──
  const saveCurrentCourse = async (name: string) => {
    const clean = (pendingNewId ? pois.filter((x) => x.id !== pendingNewId) : pois);
    if (clean.length === 0) { showToast("Add some points before saving a course."); return; }
    const list = await saveNamedCourse(name || settings.courseName, clean, routeStops, routeLoop, timeBlocks);
    setSavedCourses(list);
    setSaveName("");
    if (name.trim()) setSettings((s) => ({ ...s, courseName: name.trim() }));
    showToast(`Saved course “${(name.trim() || settings.courseName)}”.`);
  };
  const loadNamedCourse = (course: SavedCourse) => {
    const sorted = course.pois.map((p) => ({ ...p })).sort((a, b) => a.order - b.order);
    setPois(sorted);
    savePois(sorted);
    setSettings((s) => ({ ...s, courseName: course.name }));
    pushMany(sorted);
    // Restore the planned route + time blocks too, if the course carried them.
    const tb = course.timeBlocks ?? {};
    setTimeBlocks(tb);
    const ids = new Set(sorted.map((p) => p.id));
    setRouteStops((course.stops ?? []).filter((id) => ids.has(id) || tb[id]));
    setRouteLoop(!!course.loop);
    showToast(`Loaded course “${course.name}” (${sorted.length} points).`);
    setDrawer("none");
  };
  const removeNamedCourse = async (id: string) => {
    setSavedCourses(await deleteNamedCourse(id));
  };
  const saveCoursePrompt = () => {
    const name = window.prompt("Save this course as:", settings.courseName || "Bechtel Course");
    if (name && name.trim()) saveCurrentCourse(name.trim());
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
        roads={roads}
        showRoads={showRoads}
        routePath={routeCompute.result?.path}
        routeStopIds={drawer === "route" ? routeStops.filter((id) => !id.startsWith("time_")) : undefined}
        onMapClick={(lat: number, lng: number) => { if (mode === "edit") addPoiAt(lat, lng); }}
        onMarkerClick={(id) => {
          if (drawer === "route") {
            addStop(id);
            const p = pois.find((x) => x.id === id);
            showToast(p ? `Added “${p.name}” to course` : "Added to course");
            return;
          }
          setSelectedId(id);
          if (mode === "edit") setEditingId(id);
          else if (mode === "drive") previewPoi(id);
        }}
        onMarkerDrag={dragPoi}
      />

      {/* Top bar */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-[1000] flex items-start justify-between gap-2 p-3 safe-top safe-x">
        <div className="pointer-events-auto flex flex-col items-start gap-2">
          <div className="flex overflow-hidden rounded-xl border border-border bg-panel/90 shadow-lg backdrop-blur">
            <button
              onClick={() => { if (planUnlocked) setMode("edit"); else { setPwInput(""); setPwError(false); setShowPw(true); } }}
              className={`px-3 py-2 text-sm font-semibold sm:px-4 sm:py-2.5 ${mode === "edit" ? "bg-sun text-ink" : "text-muted"}`}
            >
              {planUnlocked ? "✎ Plan" : "🔒 Plan"}
            </button>
            <button
              onClick={() => { setMode("drive"); setFollow(true); }}
              className={`px-3 py-2 text-sm font-semibold sm:px-4 sm:py-2.5 ${mode === "drive" ? "bg-sun text-ink" : "text-muted"}`}
            >
              ▶ Drive
            </button>
            {planUnlocked && (
              <button
                onClick={() => { setPlanUnlocked(false); try { localStorage.removeItem("planUnlocked"); } catch {} setMode("drive"); setFollow(true); setToast("Plan mode locked"); }}
                className="px-3 py-2.5 text-sm text-muted"
                title="Lock Plan mode"
              >
                🔓
              </button>
            )}
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

        <div className="pointer-events-auto flex items-center gap-1.5 sm:gap-2">
          <select
            value={settings.layerId}
            onChange={(e) => setSettings((s) => ({ ...s, layerId: e.target.value }))}
            className="hidden rounded-xl border border-border bg-panel/90 px-3 py-2.5 text-sm text-pale shadow-lg backdrop-blur sm:block"
          >
            {TILE_LAYERS.map((l) => (
              <option key={l.id} value={l.id}>{l.label}</option>
            ))}
          </select>
          <button onClick={() => { setSearch((s) => !s); setSearchQ(""); }} className={`rounded-xl border border-border px-2.5 py-2 text-sm shadow-lg backdrop-blur sm:px-3 sm:py-2.5 ${search ? "bg-sun text-ink" : "bg-panel/90 text-pale"}`} title="Search locations">🔍</button>
          <button onClick={() => setDrawer(drawer === "route" ? "none" : "route")} className="rounded-xl border border-border bg-panel/90 px-2.5 py-2 text-sm text-pale shadow-lg backdrop-blur sm:px-3 sm:py-2.5" title="Plan a course">🧭<span className="hidden sm:inline"> Guide</span></button>
          <button onClick={() => setDrawer(drawer === "list" ? "none" : "list")} className="rounded-xl border border-border bg-panel/90 px-2.5 py-2 text-sm text-pale shadow-lg backdrop-blur sm:px-3 sm:py-2.5">☰ {pois.length}</button>
          <button onClick={() => setDrawer(drawer === "menu" ? "none" : "menu")} className="rounded-xl border border-border bg-panel/90 px-2.5 py-2 text-sm text-pale shadow-lg backdrop-blur sm:px-3 sm:py-2.5">⚙</button>
        </div>
      </div>

      {/* Location search */}
      {search && (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-[1200] flex justify-center p-3 safe-top safe-x">
          <div className="pointer-events-auto mt-16 w-full max-w-md rounded-2xl border border-border bg-panel/95 shadow-2xl backdrop-blur">
            <div className="flex items-center gap-2 border-b border-border px-3 py-2">
              <span className="text-muted">🔍</span>
              <input
                autoFocus
                value={searchQ}
                onChange={(e) => setSearchQ(e.target.value)}
                placeholder="Search locations…"
                className="w-full bg-transparent py-1.5 text-sm text-pale placeholder:text-muted focus:outline-none"
              />
              <button onClick={() => { setSearch(false); setSearchQ(""); }} className="rounded-lg px-2 py-1 text-sm text-muted hover:bg-white/5">✕</button>
            </div>
            {searchQ.trim() && (
              <div className="max-h-72 overflow-y-auto py-1">
                {searchResults.length === 0 ? (
                  <p className="px-3 py-3 text-sm text-muted">No matching locations.</p>
                ) : searchResults.map((p) => {
                  const d = distances.get(p.id);
                  return (
                    <button key={p.id} onClick={() => goToPoi(p.id)} className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-white/5">
                      <span className="text-base">{CATEGORIES[p.category].emoji}</span>
                      <span className="flex-1 truncate text-sm text-pale">{p.name}</span>
                      <span className="flex-none text-[11px] text-muted">{CATEGORIES[p.category].label}{d != null ? ` · ${(d / 1609.344).toFixed(1)} mi` : ""}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Edit-mode helpers */}
      {mode === "edit" && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[1000] flex flex-col items-center gap-2 p-3 safe-bottom safe-x">
          <div className="pointer-events-auto rounded-full border border-border bg-panel/90 px-4 py-1.5 text-xs text-muted shadow backdrop-blur">
            Tap the map to add a point · drag a pin to move it
          </div>
          <div className="pointer-events-auto flex flex-wrap items-center justify-center gap-2">
            <button onClick={dropAtMyLocation} className="rounded-xl bg-forest px-5 py-3 text-base font-bold text-white shadow-lg hover:brightness-110">
              📍 Drop point at my location
            </button>
            <button onClick={saveCoursePrompt} className="rounded-xl border border-sun bg-sun/15 px-5 py-3 text-base font-bold text-sun shadow-lg hover:bg-sun/25">
              💾 Save course
            </button>
          </div>
        </div>
      )}

      {/* Drive-mode status */}
      {mode === "drive" && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[1000] flex items-center justify-between p-3 safe-bottom safe-x">
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

      {/* Passenger cards — one per overlapping active point, stacked */}
      {(activeCards.length > 0 || (mode === "drive" && previewId && !activeCards.some((a) => a.poi.id === previewId))) && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[1100] flex max-h-[82vh] flex-col items-stretch gap-2 overflow-y-auto p-3 safe-bottom safe-x sm:inset-x-auto sm:right-4 sm:bottom-4 sm:w-[440px]">
          {activeCards.map((ac, i) => (
            <DriveCard
              key={ac.poi.id}
              poi={ac.poi}
              distance={ac.dist}
              upcoming={i === activeCards.length - 1 ? upcoming : []}
              onDismiss={() => setDismissed((d) => new Set(d).add(ac.poi.id))}
            />
          ))}
          {mode === "drive" && previewId && !activeCards.some((a) => a.poi.id === previewId) && (() => {
            const p = pois.find((x) => x.id === previewId);
            if (!p) return null;
            return (
              <DriveCard
                key={`preview-${p.id}`}
                poi={p}
                distance={distances.get(p.id) ?? null}
                upcoming={[]}
                onDismiss={closePreview}
              />
            );
          })()}
        </div>
      )}

      {/* Route drawer */}
      {drawer === "route" && (
        <div className="absolute inset-y-0 right-0 z-[1150] w-full max-w-sm border-l border-border shadow-2xl">
          <RoutePanel
            pois={pois}
            stops={routeStops}
            orderedNames={routeCompute.orderedNames}
            result={routeCompute.result}
            loop={routeLoop}
            timeBlocks={timeBlocks}
            onAdd={addStop}
            onRemove={removeStop}
            onMove={moveStop}
            onClear={clearRoute}
            onToggleLoop={() => setRouteLoop((v) => !v)}
            onAddTimeBlock={addTimeBlock}
            onEditTimeBlock={editTimeBlock}
            onClose={() => setDrawer("none")}
            canManage={planUnlocked}
            savedCourses={savedCourses}
            courseName={settings.courseName}
            onSaveCourse={saveCoursePrompt}
            onLoadCourse={loadNamedCourse}
            onDeleteCourse={removeNamedCourse}
          />
        </div>
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

            <div className="mb-4 sm:hidden">
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">Map layer</label>
              <select value={settings.layerId} onChange={(e) => setSettings((s) => ({ ...s, layerId: e.target.value }))} className="w-full rounded-lg border border-border bg-ink px-3 py-2 text-white focus:border-sun focus:outline-none">
                {TILE_LAYERS.map((l) => (
                  <option key={l.id} value={l.id}>{l.label}</option>
                ))}
              </select>
            </div>

            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">Default trigger radius: {settings.defaultRadius} m</label>
            <input type="range" min={20} max={400} step={5} value={settings.defaultRadius} onChange={(e) => setSettings((s) => ({ ...s, defaultRadius: Number(e.target.value) }))} className="mb-4 w-full accent-sun" />

            <label className="mb-4 flex items-center gap-2 text-sm text-pale">
              <input type="checkbox" checked={settings.chime} onChange={(e) => setSettings((s) => ({ ...s, chime: e.target.checked }))} className="h-4 w-4 accent-sun" />
              Play a chime when arriving at a point
            </label>

            <label className="mb-4 flex items-center gap-2 text-sm text-pale">
              <input type="checkbox" checked={showRoads} onChange={(e) => setShowRoads(e.target.checked)} className="h-4 w-4 accent-sun" />
              Show road network overlay (OpenStreetMap)
            </label>

            <div className="mb-4 space-y-2 border-t border-border pt-4">
              <button onClick={loadStarterPoints} className="w-full rounded-lg border border-sun/50 bg-sun/10 px-4 py-2.5 text-sm font-semibold text-sun hover:bg-sun/20">★ Load Summit Bechtel starter points</button>
              {planUnlocked ? (
                <>
                  <button onClick={() => exportCourse(settings.courseName, pois)} className="w-full rounded-lg border border-border px-4 py-2.5 text-sm text-pale hover:bg-card">⤓ Export course (.json)</button>
                  <button onClick={() => fileInput.current?.click()} className="w-full rounded-lg border border-border px-4 py-2.5 text-sm text-pale hover:bg-card">⤒ Import course (.json)</button>
                  <input ref={fileInput} type="file" accept="application/json,.json" className="hidden" onChange={(e) => e.target.files?.[0] && onImport(e.target.files[0])} />
                </>
              ) : (
                <p className="rounded-lg border border-border px-4 py-2.5 text-xs text-muted">🔒 Export / import require the admin password. Tap 🔒 Plan to unlock.</p>
              )}
            </div>

            {planUnlocked && (
              <div className="mb-4 space-y-2 border-t border-border pt-4">
                <label className="block text-xs font-semibold uppercase tracking-wide text-muted">Saved courses (this device)</label>
                <div className="flex gap-2">
                  <input
                    value={saveName}
                    onChange={(e) => setSaveName(e.target.value)}
                    placeholder={settings.courseName || "Course name"}
                    className="min-w-0 flex-1 rounded-lg border border-border bg-ink px-3 py-2 text-sm text-white focus:border-sun focus:outline-none"
                  />
                  <button onClick={() => saveCurrentCourse(saveName)} className="flex-none rounded-lg border border-sun/50 bg-sun/10 px-3 py-2 text-sm font-semibold text-sun hover:bg-sun/20">💾 Save</button>
                </div>
                {savedCourses.length === 0 ? (
                  <p className="text-xs text-muted">Save the current points as a named course to reuse or switch between courses later.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {savedCourses.map((c) => (
                      <li key={c.id} className="flex items-center gap-2 rounded-lg border border-border bg-black/10 px-3 py-2">
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm text-pale">{c.name}</div>
                          <div className="text-[11px] text-muted">{c.pois.length} points · {new Date(c.savedAt).toLocaleDateString()}</div>
                        </div>
                        <button onClick={() => loadNamedCourse(c)} className="flex-none rounded-lg border border-border px-2.5 py-1 text-xs text-pale hover:bg-card">Load</button>
                        <button onClick={() => { if (confirm(`Delete saved course “${c.name}”?`)) removeNamedCourse(c.id); }} className="flex-none rounded-lg px-2 py-1 text-xs text-red-400 hover:bg-white/5">✕</button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

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
        return p ? <PoiEditor poi={p} onSave={savePoi} onDelete={deletePoi} onClose={() => {
          // Dropped a new pin but didn't Save → discard it (don't register the point).
          if (pendingNewId && editingId === pendingNewId) {
            const discardId = pendingNewId;
            setPois((prev) => prev.filter((x) => x.id !== discardId));
            if (selectedId === discardId) setSelectedId(null);
            setPendingNewId(null);
          }
          setEditingId(null);
        }} /> : null;
      })()}

      {/* Plan mode password gate */}
      {showPw && (
        <div className="absolute inset-0 z-[1400] flex items-center justify-center bg-black/60 p-6" onClick={() => setShowPw(false)}>
          <div className="w-full max-w-xs rounded-2xl border border-border bg-panel p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="mb-1 text-base font-semibold text-pale">🔒 Enter Plan mode</h2>
            <p className="mb-3 text-xs leading-relaxed text-muted">Planning is password-protected. Drive mode is always open — no password needed.</p>
            <input
              type="password"
              autoFocus
              inputMode="text"
              value={pwInput}
              onChange={(e) => { setPwInput(e.target.value); setPwError(false); }}
              onKeyDown={(e) => { if (e.key === "Enter") tryUnlock(); }}
              placeholder="Password"
              className={`w-full rounded-lg border bg-black/20 px-3 py-2.5 text-sm text-pale outline-none ${pwError ? "border-red-400" : "border-border"}`}
            />
            {pwError && <p className="mt-1 text-xs text-red-400">Incorrect password.</p>}
            <div className="mt-4 flex gap-2">
              <button onClick={() => setShowPw(false)} className="flex-1 rounded-lg border border-border px-4 py-2.5 text-sm text-muted">Cancel</button>
              <button onClick={tryUnlock} className="flex-1 rounded-lg bg-sun px-4 py-2.5 text-sm font-semibold text-ink">Unlock</button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="absolute left-1/2 top-16 z-[1300] -translate-x-1/2 rounded-lg bg-black/80 px-4 py-2 text-sm text-white shadow-lg">{toast}</div>
      )}
    </div>
  );
}
