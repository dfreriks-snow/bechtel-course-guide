export interface TileLayerDef {
  id: string;
  label: string;
  url: string;
  attribution: string;
  maxZoom: number;
  subdomains?: string;
}

export const TILE_LAYERS: TileLayerDef[] = [
  {
    id: "satellite",
    label: "Satellite",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution: "Imagery &copy; Esri, Maxar, Earthstar Geographics",
    maxZoom: 19,
  },
  {
    id: "topo",
    label: "Topo",
    url: "https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}",
    attribution: "USGS The National Map",
    maxZoom: 16,
  },
  {
    id: "streets",
    label: "Streets",
    url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: "&copy; OpenStreetMap contributors",
    maxZoom: 19,
    subdomains: "abc",
  },
  {
    id: "trails",
    label: "Trails",
    url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
    attribution: "&copy; OpenTopoMap (CC-BY-SA), &copy; OpenStreetMap contributors",
    maxZoom: 17,
    subdomains: "abc",
  },
];

export function getLayer(id: string): TileLayerDef {
  return TILE_LAYERS.find((l) => l.id === id) ?? TILE_LAYERS[0];
}

// ── Offline tile prefetch ──────────────────────────────────────────────
// Convert lat/lng to slippy-map tile x/y at a zoom level.
function lng2tileX(lng: number, z: number): number {
  return Math.floor(((lng + 180) / 360) * 2 ** z);
}
function lat2tileY(lat: number, z: number): number {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
}

export interface Bounds {
  north: number;
  south: number;
  east: number;
  west: number;
}

/** Enumerate every tile URL covering `bounds` from minZoom..maxZoom. */
export function tilesForBounds(layer: TileLayerDef, bounds: Bounds, minZoom: number, maxZoom: number): string[] {
  const urls: string[] = [];
  for (let z = minZoom; z <= Math.min(maxZoom, layer.maxZoom); z++) {
    const x0 = lng2tileX(bounds.west, z);
    const x1 = lng2tileX(bounds.east, z);
    const y0 = lat2tileY(bounds.north, z);
    const y1 = lat2tileY(bounds.south, z);
    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) {
      for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) {
        const sub = layer.subdomains ? layer.subdomains[(x + y) % layer.subdomains.length] : "";
        urls.push(
          layer.url
            .replace("{s}", sub)
            .replace("{z}", String(z))
            .replace("{x}", String(x))
            .replace("{y}", String(y))
        );
      }
    }
  }
  return urls;
}

/**
 * Prefetch tiles into the browser/service-worker cache so the area works offline.
 * Reports progress via the callback. Fetches with modest concurrency.
 */
export async function prefetchTiles(
  urls: string[],
  onProgress: (done: number, total: number) => void,
  concurrency = 6
): Promise<void> {
  let done = 0;
  let i = 0;
  async function worker() {
    while (i < urls.length) {
      const url = urls[i++];
      try {
        await fetch(url, { mode: "no-cors", cache: "force-cache" });
      } catch {
        /* ignore individual tile failures */
      }
      done++;
      if (done % 5 === 0 || done === urls.length) onProgress(done, urls.length);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  onProgress(done, urls.length);
}
