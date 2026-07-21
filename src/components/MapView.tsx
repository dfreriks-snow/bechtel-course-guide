import { useEffect, useMemo, useState } from "react";
import L from "leaflet";
import { MapContainer, TileLayer, Marker, Circle, Polyline, useMap, useMapEvents } from "react-leaflet";
import type { Poi } from "../lib/types";
import { CATEGORIES } from "../lib/types";
import { getLayer } from "../lib/tiles";
import type { Fix } from "../hooks/useGeolocation";

interface Props {
  pois: Poi[];
  layerId: string;
  mode: "edit" | "drive";
  fix: Fix | null;
  follow: boolean;
  center: [number, number];
  zoom: number;
  selectedId: string | null;
  activeIds: Set<string>;
  showRadii: boolean;
  roads?: [number, number][][];
  showRoads?: boolean;
  routePath?: [number, number][];
  routeStopIds?: string[];
  onMapClick: (lat: number, lng: number) => void;
  onMarkerClick: (id: string) => void;
  onMarkerDrag: (id: string, lat: number, lng: number) => void;
}

function poiIcon(poi: Poi, active: boolean, selected: boolean, routeNum?: number, compact = false): L.DivIcon {
  const c = CATEGORIES[poi.category];
  const inRoute = routeNum != null;
  const ring = active || inRoute
    ? "box-shadow:0 0 0 3px #f5b301,0 0 12px 3px rgba(245,179,1,.65);"
    : selected ? "box-shadow:0 0 0 3px #fff;" : "box-shadow:0 2px 6px rgba(0,0,0,.5);";
  const size = active ? 40 : 32;

  // Platinum Lounge (VIP): a diamond on a platinum hexagon — distinct shape, smaller on phones.
  if (poi.category === "platinum") {
    const pSize = compact ? (active ? 52 : 44) : (active ? 70 : 60);
    const dia = compact ? (active ? 26 : 22) : (active ? 34 : 29);
    const hex = "polygon(50% 0%,100% 25%,100% 75%,50% 100%,0% 75%,0% 25%)";
    const glow = active || inRoute
      ? "filter:drop-shadow(0 0 3px #f5b301) drop-shadow(0 0 7px rgba(245,179,1,.85));"
      : selected ? "filter:drop-shadow(0 0 3px #fff);" : "filter:drop-shadow(0 2px 4px rgba(0,0,0,.55));";
    const pbadge = inRoute
      ? `<div style="position:absolute;top:-8px;right:-8px;min-width:20px;height:20px;padding:0 3px;border-radius:10px;background:#f5b301;color:#12211a;border:2px solid #fff;font-size:12px;font-weight:800;line-height:18px;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,.5);">${routeNum}</div>`
      : "";
    const html = `<div style="position:relative;width:${pSize}px;height:${pSize}px;${glow}">
      <div style="position:absolute;inset:0;clip-path:${hex};background:#6b7178;"></div>
      <div style="position:absolute;inset:2px;clip-path:${hex};background:linear-gradient(135deg,#f6f7f8 0%,#c4cad0 48%,#8f969e 100%);"></div>
      <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:${dia}px;">💎</div>
      ${pbadge}</div>`;
    return L.divIcon({ className: "", html, iconSize: [pSize, pSize], iconAnchor: [pSize / 2, pSize / 2] });
  }

  // No-drive / park-and-walk render as a bold colored X on a white pin.
  const isX = poi.category === "blocked" || poi.category === "parkwalk";
  const bg = isX ? "#ffffff" : c.color;
  const bd = isX ? c.color : "#fff";
  const glyph = isX ? c.color : "#fff";
  const glyphWeight = isX ? "font-weight:900;" : "";
  const glyphSize = isX ? (active ? 22 : 18) : (active ? 18 : 15);
  const badge = inRoute
    ? `<div style="position:absolute;top:-9px;right:-9px;transform:rotate(45deg);min-width:18px;height:18px;padding:0 3px;border-radius:9px;background:#f5b301;color:#12211a;border:2px solid #fff;font-size:11px;font-weight:800;line-height:1;display:flex;align-items:center;justify-content:center;box-shadow:0 1px 3px rgba(0,0,0,.5);">${routeNum}</div>`
    : "";
  return L.divIcon({
    className: "",
    html: `<div style="position:relative;width:${size}px;height:${size}px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:${bg};border:2px solid ${bd};${ring}display:flex;align-items:center;justify-content:center;">
      <span style="transform:rotate(45deg);color:${glyph};${glyphWeight}font-size:${glyphSize}px;line-height:1;">${c.emoji}</span>${badge}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size],
  });
}

function meIcon(): L.DivIcon {
  return L.divIcon({
    className: "",
    html: `<div class="me-dot" style="width:22px;height:22px;"><div style="position:absolute;inset:0;border-radius:9999px;background:#2982e8;border:3px solid #fff;box-shadow:0 1px 5px rgba(0,0,0,.6);"></div></div>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });
}

function ClickCapture({ onClick, enabled }: { onClick: (lat: number, lng: number) => void; enabled: boolean }) {
  useMapEvents({
    click(e) {
      if (enabled) onClick(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

function Follower({ fix, follow }: { fix: Fix | null; follow: boolean }) {
  const map = useMap();
  useEffect(() => {
    if (follow && fix) map.panTo([fix.lat, fix.lng], { animate: true, duration: 0.5 });
  }, [fix, follow, map]);
  return null;
}

function FlyToSelected({ selectedId, pois }: { selectedId: string | null; pois: Poi[] }) {
  const map = useMap();
  useEffect(() => {
    if (!selectedId) return;
    const p = pois.find((x) => x.id === selectedId);
    if (p) map.panTo([p.lat, p.lng], { animate: true });
  }, [selectedId, pois, map]);
  return null;
}

function PoiMarkers({ pois, activeIds, selectedId, routeIndex, mode, compact, onMarkerClick, onMarkerDrag }: {
  pois: Poi[];
  activeIds: Set<string>;
  selectedId: string | null;
  routeIndex: Map<string, number>;
  mode: "edit" | "drive";
  compact: boolean;
  onMarkerClick: (id: string) => void;
  onMarkerDrag: (id: string, lat: number, lng: number) => void;
}) {
  return (
    <>
      {pois.map((p) => (
        <Marker
          key={p.id}
          position={[p.lat, p.lng]}
          icon={poiIcon(p, activeIds.has(p.id), selectedId === p.id, routeIndex.get(p.id), compact)}
          draggable={mode === "edit"}
          eventHandlers={{
            click: () => onMarkerClick(p.id),
            dragend: (e) => {
              const ll = (e.target as L.Marker).getLatLng();
              onMarkerDrag(p.id, ll.lat, ll.lng);
            },
          }}
        />
      ))}
    </>
  );
}

export default function MapView(props: Props) {
  const { pois, layerId, mode, fix, follow, center, zoom, selectedId, activeIds, showRadii } = props;
  const layer = useMemo(() => getLayer(layerId), [layerId]);
  const routeIndex = useMemo(() => {
    const m = new Map<string, number>();
    (props.routeStopIds ?? []).forEach((id, i) => { if (!m.has(id)) m.set(id, i + 1); });
    return m;
  }, [props.routeStopIds]);
  const [compact, setCompact] = useState(() => typeof window !== "undefined" && window.matchMedia("(max-width: 640px)").matches);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 640px)");
    const on = () => setCompact(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  return (
    <MapContainer center={center} zoom={zoom} minZoom={11} maxZoom={21} zoomControl={false} className="h-full w-full" preferCanvas>
      <TileLayer
        key={layer.id}
        url={layer.url}
        attribution={layer.attribution}
        maxZoom={21}
        maxNativeZoom={layer.maxZoom}
        subdomains={layer.subdomains ?? "abc"}
      />

      <ClickCapture enabled={mode === "edit"} onClick={props.onMapClick} />
      <Follower fix={fix} follow={follow} />
      <FlyToSelected selectedId={selectedId} pois={pois} />

      {/* Road network overlay (reflects current OSM roads) */}
      {props.showRoads && props.roads &&
        props.roads.map((line, i) => (
          <Polyline key={`road-${i}`} positions={line} pathOptions={{ color: "#29d3ff", weight: 2, opacity: 0.65 }} interactive={false} />
        ))}

      {/* Planned course */}
      {props.routePath && props.routePath.length > 1 && (
        <Polyline positions={props.routePath} pathOptions={{ color: "#f5b301", weight: 5, opacity: 0.95 }} interactive={false} />
      )}

      {showRadii &&
        pois.map((p) => (
          <Circle
            key={`r-${p.id}`}
            center={[p.lat, p.lng]}
            radius={p.radius}
            pathOptions={{ color: activeIds.has(p.id) ? "#f5b301" : "#8fb3a0", weight: 1, fillOpacity: 0.06 }}
          />
        ))}

      <PoiMarkers
        pois={pois}
        activeIds={activeIds}
        selectedId={selectedId}
        routeIndex={routeIndex}
        mode={mode}
        compact={compact}
        onMarkerClick={props.onMarkerClick}
        onMarkerDrag={props.onMarkerDrag}
      />

      {fix && (
        <>
          <Circle center={[fix.lat, fix.lng]} radius={fix.accuracy} pathOptions={{ color: "#2982e8", weight: 1, fillOpacity: 0.08 }} />
          <Marker position={[fix.lat, fix.lng]} icon={meIcon()} interactive={false} zIndexOffset={1000} />
        </>
      )}
    </MapContainer>
  );
}
