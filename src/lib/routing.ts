// Road-network routing + ETA for the Summit Bechtel Reserve.
// Builds a graph from the bundled OSM road segments and runs Dijkstra between
// snapped stops. Speed model: 15 mph on reserve roads, 20 mph on the approach
// up to the North Entrance, 5 mph within an activity zone.
// Zero external dependencies; fully offline.
import { SBR_ROADS, type RoadSeg } from "../data/sbrRoads";
import { SBR_TRAILS } from "../data/sbrTrails";
import { SBR_WALK_ROADS } from "../data/sbrWalkRoads";

export type LatLng = [number, number];

const MPH_ROAD = 15;      // inside the reserve (past the North Entrance)
const MPH_APPROACH = 20;  // public approach road up to the North Entrance
const MPH_SLOW = 5;
const MPH_WALK = 2;       // walking pace on trails
const MPS = (mph: number) => mph * 0.44704; // miles/hr -> meters/sec
const METERS_PER_MILE = 1609.344;

// 20 mph approach corridor: the road from the J.W. & Hazel Ruby WV Welcome
// Center up to the SBR North Entrance. Everything else on-reserve is 15 mph.
const APPROACH_ZONES: { lat: number; lng: number; radius: number }[] = [
  { lat: 37.89718, lng: -81.16337, radius: 1700 },
];

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
let TRAIL_GRAPH: Graph | null = null;

const keyOf = (lat: number, lng: number): NodeKey => `${lat.toFixed(5)},${lng.toFixed(5)}`;

function buildGraph(segs: RoadSeg[], stitchMeters = 0, excludeBothIn?: Set<NodeKey>): Graph {
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
  for (const seg of segs) {
    for (let i = 0; i < seg.pts.length - 1; i++) {
      const [aLat, aLng] = seg.pts[i];
      const [bLat, bLng] = seg.pts[i + 1];
      const ka = addNode(aLat, aLng);
      const kb = addNode(bLat, bLng);
      // Skip closed-to-vehicle stretches (both ends inside the pedestrian corridor).
      if (excludeBothIn && excludeBothIn.has(ka) && excludeBothIn.has(kb)) continue;
      link(ka, kb, haversine(aLat, aLng, bLat, bLng));
    }
  }
  const nodeKeys = [...coord.keys()];
  const nodes = nodeKeys.map((k) => coord.get(k)!);
  // Bridge disconnected fragments (OSM trails are fragmented) with the fewest,
  // shortest cross-component links ≤ stitchMeters, so routing follows trails
  // instead of cutting straight lines across small gaps.
  if (stitchMeters > 0) stitchComponents(adj, nodeKeys, nodes, link, stitchMeters);
  return { adj, coord, nodes, nodeKeys };
}

function stitchComponents(adj: Map<NodeKey, Edge[]>, keys: NodeKey[], nodes: LatLng[], link: (a: NodeKey, b: NodeKey, d: number) => void, maxM: number) {
  const parent = new Map<NodeKey, NodeKey>();
  const find = (x: NodeKey): NodeKey => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x)!)!); x = parent.get(x)!; } return x; };
  const union = (a: NodeKey, b: NodeKey) => { parent.set(find(a), find(b)); };
  for (const k of keys) parent.set(k, k);
  for (const [k, edges] of adj) for (const e of edges) union(k, e.to);
  const cand: { d: number; a: NodeKey; b: NodeKey }[] = [];
  const n = keys.length;
  const maxSq = maxM * maxM;
  for (let i = 0; i < n; i++) {
    const [ai, aj] = nodes[i];
    const cos = Math.cos((ai * Math.PI) / 180) * 111320;
    for (let j = i + 1; j < n; j++) {
      const [bi, bj] = nodes[j];
      const dx = (bj - aj) * cos, dy = (bi - ai) * 111320;
      if (dx * dx + dy * dy > maxSq) continue;
      if (find(keys[i]) === find(keys[j])) continue;
      cand.push({ d: haversine(ai, aj, bi, bj), a: keys[i], b: keys[j] });
    }
  }
  cand.sort((x, y) => x.d - y.d);
  for (const { d, a, b } of cand) {
    if (d <= maxM && find(a) !== find(b)) { union(a, b); link(a, b, d); }
  }
}
function graph(): Graph {
  // Driving uses the full road network. (The pedestrian-only Jack Furst
  // corridor is only added to the walk graph, not removed from driving —
  // removing it disconnected Summit East Parking, which cars must reach.
  // To keep a driving course off a closed lane, drop a No-drive red X on it.)
  if (!GRAPH) GRAPH = buildGraph(SBR_ROADS);
  return GRAPH;
}
function trailGraph(): Graph {
  // Walking uses trails + the vehicle-closed corridor + all roads in the Summit
  // Center core (car-free / walkable), stitched across small gaps.
  if (!TRAIL_GRAPH) TRAIL_GRAPH = buildGraph(walkSegments(), 80);
  return TRAIL_GRAPH;
}

// Summit Center core: roads here are car-free and walkable.
const SUMMIT_WALK_ZONE = { lat: 37.916, lng: -81.1225, radius: 500 };
function walkSegments(): RoadSeg[] {
  const inZone = (p: LatLng) =>
    haversine(p[0], p[1], SUMMIT_WALK_ZONE.lat, SUMMIT_WALK_ZONE.lng) <= SUMMIT_WALK_ZONE.radius;
  const coreRoads = SBR_ROADS.filter((seg) => seg.pts.some(inZone));
  return [...SBR_TRAILS, ...SBR_WALK_ROADS, ...coreRoads];
}

// Nearest graph node to an arbitrary point (optionally skipping blocked nodes).
function nearestNode(g: Graph, lat: number, lng: number, blocked?: Set<NodeKey>): { key: NodeKey; dist: number } {
  let best = -1, bestD = Infinity;
  for (let i = 0; i < g.nodes.length; i++) {
    if (blocked && blocked.has(g.nodeKeys[i])) continue;
    const [nlat, nlng] = g.nodes[i];
    // cheap squared planar estimate first
    const dx = (nlng - lng) * Math.cos((lat * Math.PI) / 180);
    const dy = nlat - lat;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestD) { bestD = d2; best = i; }
  }
  if (best < 0) return nearestNode(g, lat, lng); // all candidates blocked — fall back
  const key = g.nodeKeys[best];
  const [blat, blng] = g.coord.get(key)!;
  return { key, dist: haversine(lat, lng, blat, blng) };
}

// Snap an arbitrary point onto the nearest graph *edge* (not just the nearest
// vertex): project the point onto every edge, and if the closest point lands
// mid-edge, insert a temporary node there linked to both endpoints. A route can
// then join the road/trail at the closest point on it — so an off-network pin
// connects to the network by the shortest hop instead of a long straight line to
// a distant vertex. Call `unsnap` afterwards to restore the graph.
interface Snap { key: NodeKey; temp: NodeKey[]; neighbors: NodeKey[] }
function snapToGraph(g: Graph, lat: number, lng: number, blocked?: Set<NodeKey>): Snap {
  const cosL = Math.cos((lat * Math.PI) / 180) * 111320;
  const toXY = (la: number, ln: number): [number, number] => [(ln - lng) * cosL, (la - lat) * 111320];
  let bestD2 = Infinity, bu: NodeKey | null = null, bv: NodeKey | null = null, bt = 0;
  for (const [u, edges] of g.adj) {
    if (blocked?.has(u)) continue;
    const uc = g.coord.get(u)!;
    const [ux, uy] = toXY(uc[0], uc[1]);
    for (const e of edges) {
      const v = e.to;
      if (u > v) continue;              // consider each undirected edge once
      if (blocked?.has(v)) continue;
      const vc = g.coord.get(v)!;
      const [vx, vy] = toXY(vc[0], vc[1]);
      const dx = vx - ux, dy = vy - uy;
      const len2 = dx * dx + dy * dy;
      const t = len2 > 0 ? Math.max(0, Math.min(1, -(ux * dx + uy * dy) / len2)) : 0;
      const qx = ux + t * dx, qy = uy + t * dy; // closest point on edge to origin
      const d2 = qx * qx + qy * qy;
      if (d2 < bestD2) { bestD2 = d2; bu = u; bv = v; bt = t; }
    }
  }
  if (bu == null || bv == null) return { key: nearestNode(g, lat, lng, blocked).key, temp: [], neighbors: [] };
  const uc = g.coord.get(bu)!, vc = g.coord.get(bv)!;
  const eps = 1e-4;
  if (bt <= eps) return { key: bu, temp: [], neighbors: [] };
  if (bt >= 1 - eps) return { key: bv, temp: [], neighbors: [] };
  const qLat = uc[0] + bt * (vc[0] - uc[0]);
  const qLng = uc[1] + bt * (vc[1] - uc[1]);
  const tk: NodeKey = `tmp:${qLat.toFixed(6)},${qLng.toFixed(6)}`;
  const dU = haversine(qLat, qLng, uc[0], uc[1]);
  const dV = haversine(qLat, qLng, vc[0], vc[1]);
  g.coord.set(tk, [qLat, qLng]);
  g.adj.set(tk, [{ to: bu, dist: dU }, { to: bv, dist: dV }]);
  g.adj.get(bu)!.push({ to: tk, dist: dU });
  g.adj.get(bv)!.push({ to: tk, dist: dV });
  return { key: tk, temp: [tk], neighbors: [bu, bv] };
}
function unsnap(g: Graph, s: Snap) {
  for (const tk of s.temp) { g.adj.delete(tk); g.coord.delete(tk); }
  for (const n of s.neighbors) {
    const edges = g.adj.get(n);
    if (edges) g.adj.set(n, edges.filter((e) => !e.to.startsWith("tmp:")));
  }
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
function dijkstra(g: Graph, start: NodeKey, goal: NodeKey, blocked?: Set<NodeKey>): LatLng[] | null {
  const dist = new Map<NodeKey, number>();
  const prev = new Map<NodeKey, NodeKey>();
  const heap = new MinHeap();
  dist.set(start, 0); heap.push(start, 0);
  while (heap.size) {
    const { k, d } = heap.pop();
    if (k === goal) break;
    if (d > (dist.get(k) ?? Infinity)) continue;
    for (const e of g.adj.get(k) ?? []) {
      if (blocked && blocked.has(e.to)) continue; // no-drive area
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

/** Compute a road route through the ordered stops with the 20/5 mph model.
 * `blocked` zones are no-drive areas the route will steer around. */
export function computeRoute(stops: Stop[], zones: SlowZone[], blocked: SlowZone[] = []): RouteResult {
  const g = graph();
  const blockedNodes = new Set<NodeKey>();
  if (blocked.length) {
    for (let i = 0; i < g.nodes.length; i++) {
      const [nlat, nlng] = g.nodes[i];
      if (inSlowZone(nlat, nlng, blocked)) blockedNodes.add(g.nodeKeys[i]);
    }
  }
  const path: LatLng[] = [];
  const legs: RouteLeg[] = [];
  let totalMiles = 0, totalSeconds = 0;

  for (let s = 0; s < stops.length - 1; s++) {
    const a = stops[s], b = stops[s + 1];
    const sa = snapToGraph(g, a.lat, a.lng, blockedNodes);
    const sb = snapToGraph(g, b.lat, b.lng, blockedNodes);
    const legPts = dijkstra(g, sa.key, sb.key, blockedNodes);
    unsnap(g, sb); unsnap(g, sa);

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
      const mph = seg_slow ? MPH_SLOW : (inSlowZone(midLat, midLng, APPROACH_ZONES) ? MPH_APPROACH : MPH_ROAD);
      legMeters += d;
      legSecs += d / MPS(mph);
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

/** Trail segments as polylines for the map overlay. */
export function trailPolylines(): LatLng[][] {
  return SBR_TRAILS.map((s) => s.pts);
}

/** Compute a walking route through the ordered stops along trails at 2 mph.
 * Walkers use trails only (no roads) but may pass through no-drive areas, so
 * `blocked` is intentionally ignored here. Gaps between disconnected trails
 * fall back to a straight-line estimate (flagged offRoad). */
export function computeWalkRoute(stops: Stop[]): RouteResult {
  const g = trailGraph();
  const path: LatLng[] = [];
  const legs: RouteLeg[] = [];
  let totalMiles = 0, totalSeconds = 0;

  for (let s = 0; s < stops.length - 1; s++) {
    const a = stops[s], b = stops[s + 1];
    const sa = snapToGraph(g, a.lat, a.lng);
    const sb = snapToGraph(g, b.lat, b.lng);
    const legPts = g.nodes.length ? dijkstra(g, sa.key, sb.key) : null;
    unsnap(g, sb); unsnap(g, sa);

    let legMeters = 0, offRoad = false;
    const full: LatLng[] = [];
    if (legPts && legPts.length >= 2) {
      full.push([a.lat, a.lng], ...legPts, [b.lat, b.lng]);
    } else {
      offRoad = true;
      full.push([a.lat, a.lng], [b.lat, b.lng]);
    }
    for (let i = 0; i < full.length - 1; i++) {
      legMeters += haversine(full[i][0], full[i][1], full[i + 1][0], full[i + 1][1]);
    }
    const legMiles = legMeters / METERS_PER_MILE;
    const legSecs = legMeters / MPS(MPH_WALK);
    legs.push({ fromIndex: s, toIndex: s + 1, miles: legMiles, seconds: legSecs, slow: false, offRoad });
    totalMiles += legMiles; totalSeconds += legSecs;
    if (path.length === 0) path.push(...full);
    else path.push(...full.slice(1));
  }
  return { path, legs, totalMiles, totalSeconds };
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
