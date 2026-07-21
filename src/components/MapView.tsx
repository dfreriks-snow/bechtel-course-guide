import { useEffect, useMemo } from "react";
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

function poiIcon(poi: Poi, active: boolean, selected: boolean, routeNum?: number): L.DivIcon {
  const c = CATEGORIES[poi.category];
  const inRoute = routeNum != null;
  const ring = active || inRoute
    ? "box-shadow:0 0 0 3px #f5b301,0 0 12px 3px rgba(245,179,1,.65);"
    : selected ? "box-shadow:0 0 0 3px #fff;" : "box-shadow:0 2px 6px rgba(0,0,0,.5);";
  const size = active ? 40 : 32;
  const badge = inRoute
    ? `<div style="position:absolute;top:-9px;right:-9px;transform:rotate(45deg);min-width:18px;height:18px;padding:0 3px;border-radius:9px;background:#f5b301;color:#12211a;border:2px solid #fff;font-size:11px;font-weight:800;line-height:1;display:flex;align-items:center;justify-content:center;box-shadow:0 1px 3px rgba(0,0,0,.5);">${routeNum}</div>`
    : "";
  return L.divIcon({
    className: "",
    html: `<div style="position:relative;width:${size}px;height:${size}px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:${c.color};border:2px solid #fff;${ring}display:flex;align-items:center;justify-content:center;">
      <span style="transform:rotate(45deg);font-size:${active ? 18 : 15}px;line-height:1;">${c.emoji}</span>${badge}</div>`,
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

export default function MapView(props: Props) {
  const { pois, layerId, mode, fix, follow, center, zoom, selectedId, activeIds, showRadii } = props;
  const layer = useMemo(() => getLayer(layerId), [layerId]);
  const routeIndex = useMemo(() => {
    const m = new Map<string, number>();
    (props.routeStopIds ?? []).forEach((id, i) => { if (!m.has(id)) m.set(id, i + 1); });
    return m;
  }, [props.routeStopIds]);

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

      {pois.map((p) => (
        <Marker
          key={p.id}
          position={[p.lat, p.lng]}
          icon={poiIcon(p, activeIds.has(p.id), selectedId === p.id, routeIndex.get(p.id))}
          draggable={mode === "edit"}
          eventHandlers={{
            click: () => props.onMarkerClick(p.id),
            dragend: (e) => {
              const ll = (e.target as L.Marker).getLatLng();
              props.onMarkerDrag(p.id, ll.lat, ll.lng);
            },
          }}
        />
      ))}

      {fix && (
        <>
          <Circle center={[fix.lat, fix.lng]} radius={fix.accuracy} pathOptions={{ color: "#2982e8", weight: 1, fillOpacity: 0.08 }} />
          <Marker position={[fix.lat, fix.lng]} icon={meIcon()} interactive={false} zIndexOffset={1000} />
        </>
      )}
    </MapContainer>
  );
}
