// Road-network routing + ETA for the Summit Bechtel Reserve.
// Builds a graph from the bundled OSM road segments and runs Dijkstra between
// snapped stops. Speed model: 20 mph on roads, 5 mph within an activity zone.
// Zero external dependencies; fully offline.
import { SBR_ROADS } from "../data/sbrRoads";

export type LatLng = [number, number];

const MPH_ROAD = 20;
const MPH_SLOW = 5;
const MPS = (mph: number) => mph * 0.44704; // miles/hr -> meters/sec
const METERS_PER_MILE = 1609.344;

export interface SlowZone { lat: number; lng: number; radius: number } // meters

export interface RouteLeg {
  fromIndex: number;
  toIndex: number;
  miles: number;
  seconds: number;
  slow: boolean;      // any part of the leg passed through a slow zone
  offRoad: boolean;   // no road path found; straight-line fallback used
}
export interface RouteResult {
  path: LatLng[];        // merged polyline following the roads
  legs: RouteLeg[];
  totalMiles: number;
  totalSeconds: number;
}

// ── Haversine (meters) ────────────────────────────────────────────────────
export function haversine(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const la1 = (aLat * Math.PI) / 180;
  const la2 = (bLat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

// ── Graph (built once, lazily) ──────────────────────────────────────────────
type NodeKey = string;
interface Edge { to: NodeKey; dist: number }
interface Graph {
  adj: Map<NodeKey, Edge[]>;
  coord: Map<NodeKey, LatLng>;
  nodes: LatLng[];       // for nearest-node search
  nodeKeys: NodeKey[];
}
let GRAPH: Graph | null = null;

const keyOf = (lat: number, lng: number): NodeKey => `${lat.toFixed(5)},${lng.toFixed(5)}`;

function buildGraph(): Graph {
  const adj = new Map<NodeKey, Edge[]>();
  const coord = new Map<NodeKey, LatLng>();
  const addNode = (lat: number, lng: number): NodeKey => {
    const k = keyOf(lat, lng);
    if (!coord.has(k)) { coord.set(k, [lat, lng]); adj.set(k, []); }
    return k;
  };
  const link = (a: NodeKey, b: NodeKey, d: number) => {
    if (a === b) return;
    adj.get(a)!.push({ to: b, dist: d });
    adj.get(b)!.push({ to: a, dist: d });
  };
  for (const seg of SBR_ROADS) {
    for (let i = 0; i < seg.pts.length - 1; i++) {
      const [aLat, aLng] = seg.pts[i];
      const [bLat, bLng] = seg.pts[i + 1];
      const ka = addNode(aLat, aLng);
      const kb = addNode(bLat, bLng);
      link(ka, kb, haversine(aLat, aLng, bLat, bLng));
    }
  }
  const nodeKeys = [...coord.keys()];
  const nodes = nodeKeys.map((k) => coord.get(k)!);
  return { adj, coord, nodes, nodeKeys };
}
function graph(): Graph {
  if (!GRAPH) GRAPH = buildGraph();
  return GRAPH;
}

// Nearest graph node to an arbitrary point.
function nearestNode(g: Graph, lat: number, lng: number): { key: NodeKey; dist: number } {
  let best = -1, bestD = Infinity;
  for (let i = 0; i < g.nodes.length; i++) {
    const [nlat, nlng] = g.nodes[i];
    // cheap squared planar estimate first
    const dx = (nlng - lng) * Math.cos((lat * Math.PI) / 180);
    const dy = nlat - lat;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestD) { bestD = d2; best = i; }
  }
  const key = g.nodeKeys[best];
  const [blat, blng] = g.coord.get(key)!;
  return { key, dist: haversine(lat, lng, blat, blng) };
}

// ── Dijkstra (binary min-heap) ───────────────────────────────────────────────
class MinHeap {
  private a: { k: NodeKey; d: number }[] = [];
  get size() { return this.a.length; }
  push(k: NodeKey, d: number) {
    const a = this.a; a.push({ k, d }); let i = a.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (a[p].d <= a[i].d) break;[a[p], a[i]] = [a[i], a[p]]; i = p; }
  }
  pop() {
    const a = this.a; const top = a[0]; const last = a.pop()!;
    if (a.length) { a[0] = last; let i = 0; const n = a.length;
      for (;;) { let s = i; const l = 2 * i + 1, r = 2 * i + 2;
        if (l < n && a[l].d < a[s].d) s = l; if (r < n && a[r].d < a[s].d) s = r;
        if (s === i) break;[a[s], a[i]] = [a[i], a[s]]; i = s; } }
    return top;
  }
}

// Shortest path (list of node coords) between two graph nodes. null if unreachable.
function dijkstra(g: Graph, start: NodeKey, goal: NodeKey): LatLng[] | null {
  const dist = new Map<NodeKey, number>();
  const prev = new Map<NodeKey, NodeKey>();
  const heap = new MinHeap();
  dist.set(start, 0); heap.push(start, 0);
  while (heap.size) {
    const { k, d } = heap.pop();
    if (k === goal) break;
    if (d > (dist.get(k) ?? Infinity)) continue;
    for (const e of g.adj.get(k) ?? []) {
      const nd = d + e.dist;
      if (nd < (dist.get(e.to) ?? Infinity)) { dist.set(e.to, nd); prev.set(e.to, k); heap.push(e.to, nd); }
    }
  }
  if (!dist.has(goal)) return null;
  const path: LatLng[] = [];
  let cur: NodeKey | undefined = goal;
  while (cur) { path.push(g.coord.get(cur)!); cur = prev.get(cur); }
  path.reverse();
  return path;
}

function inSlowZone(lat: number, lng: number, zones: SlowZone[]): boolean {
  for (const z of zones) if (haversine(lat, lng, z.lat, z.lng) <= z.radius) return true;
  return false;
}

export interface Stop { lat: number; lng: number }

/** Compute a road route through the ordered stops with the 20/5 mph model. */
export function computeRoute(stops: Stop[], zones: SlowZone[]): RouteResult {
  const g = graph();
  const path: LatLng[] = [];
  const legs: RouteLeg[] = [];
  let totalMiles = 0, totalSeconds = 0;

  for (let s = 0; s < stops.length - 1; s++) {
    const a = stops[s], b = stops[s + 1];
    const na = nearestNode(g, a.lat, a.lng);
    const nb = nearestNode(g, b.lat, b.lng);
    let legPts = dijkstra(g, na.key, nb.key);

    let legMeters = 0, legSecs = 0, slow = false, offRoad = false;
    // Include the connectors from the actual stop to its snapped road node.
    const full: LatLng[] = [];
    if (legPts && legPts.length >= 2) {
      full.push([a.lat, a.lng], ...legPts, [b.lat, b.lng]);
    } else {
      // Fallback: straight line between the two stops.
      offRoad = true;
      full.push([a.lat, a.lng], [b.lat, b.lng]);
    }
    for (let i = 0; i < full.length - 1; i++) {
      const [p1lat, p1lng] = full[i];
      const [p2lat, p2lng] = full[i + 1];
      const d = haversine(p1lat, p1lng, p2lat, p2lng);
      const midLat = (p1lat + p2lat) / 2, midLng = (p1lng + p2lng) / 2;
      const seg_slow = inSlowZone(midLat, midLng, zones);
      if (seg_slow) slow = true;
      legMeters += d;
      legSecs += d / MPS(seg_slow ? MPH_SLOW : MPH_ROAD);
    }
    const legMiles = legMeters / METERS_PER_MILE;
    legs.push({ fromIndex: s, toIndex: s + 1, miles: legMiles, seconds: legSecs, slow, offRoad });
    totalMiles += legMiles; totalSeconds += legSecs;
    // merge into overall path (avoid duplicate join point)
    if (path.length === 0) path.push(...full);
    else path.push(...full.slice(1));
  }
  return { path, legs, totalMiles, totalSeconds };
}

/** Road segments as polylines for the map overlay. */
export function roadPolylines(): LatLng[][] {
  return SBR_ROADS.map((s) => s.pts);
}

export function formatDuration(seconds: number): string {
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m} min${sec >= 30 ? " 30s" : ""}`;
  return `${sec}s`;
}
