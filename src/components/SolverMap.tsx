// src/components/SolverMap.tsx

import "leaflet/dist/leaflet.css";

import {
  MapContainer,
  Marker,
  Polyline,
  Popup,
  TileLayer,
  LayersControl,
  useMap,
} from "react-leaflet";

import L from "leaflet";

import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";

import { useEffect } from "react";

import type { Node } from "../types/cvrp";

delete (L.Icon.Default.prototype as any)._getIconUrl;

L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});

const depotIcon = new L.Icon({
  iconUrl: "https://maps.gstatic.com/mapfiles/ms2/micons/red-dot.png",
  iconSize: [26, 26],
  iconAnchor: [13, 26],
  popupAnchor: [0, -24],
});

const pickupIcon = new L.Icon({
  iconUrl: "https://maps.gstatic.com/mapfiles/ms2/micons/green-dot.png",
  iconSize: [24, 24],
  iconAnchor: [12, 24],
  popupAnchor: [0, -22],
});

const WARM = ["#f97316", "#f59e0b", "#ef4444", "#fb923c", "#fbbf24"];

const COOL = ["#14b8a6", "#06b6d4", "#3b82f6", "#6366f1", "#8b5cf6"];

const DEFAULT_CENTER: [number, number] = [12.9716, 77.5946];

const { BaseLayer } = LayersControl;

function FitBounds({ nodes }: { nodes: Node[] }) {
  const map = useMap();

  useEffect(() => {
    if (!nodes.length) {
      map.setView(DEFAULT_CENTER, 11);
      return;
    }
    const points = nodes.map((n) => [n.lat, n.lng]) as [number, number][];
    map.fitBounds(points, { padding: [40, 40] });
  }, [nodes, map]);

  return null;
}

function FitControl({ nodes }: { nodes: Node[] }) {
  const map = useMap();

  useEffect(() => {
    const FitAction = L.Control.extend({
      onAdd: () => {
        const container = L.DomUtil.create(
          "div",
          "leaflet-bar solvermap-fit-control"
        );
        const button = L.DomUtil.create("a", "", container);
        button.href = "#";
        button.title = "Fit to data";
        button.innerHTML = "⤢";
        button.setAttribute("role", "button");
        button.setAttribute("aria-label", "Fit map to data");

        L.DomEvent.on(button, "click", (e) => {
          L.DomEvent.stopPropagation(e);
          L.DomEvent.preventDefault(e);
          if (!nodes.length) {
            map.setView(DEFAULT_CENTER, 11);
            return;
          }
          const points = nodes.map((n) => [n.lat, n.lng]) as [
            number,
            number
          ][];
          map.fitBounds(points, { padding: [40, 40] });
        });

        return container;
      },
    });

    const control = new FitAction({ position: "topleft" });
    control.addTo(map);

    return () => {
      control.remove();
    };
  }, [map, nodes]);

  return null;
}

interface SolverMapProps {
  nodes: Node[];
  // Each route is a depot-bookended array of numeric node ids, e.g.
  // [0, 3, 1, 0] — matches VehicleRoute["route"] in types/cvrp.ts.
  routes: number[][];
  palette?: "warm" | "cool";
  activeVehicleIdx?: number | null;
}

function buildNodeMap(nodes: Node[]): Map<number, Node> {
  const map = new Map<number, Node>();
  nodes.forEach((node) => {
    map.set(node.id, node);
  });
  return map;
}

export default function SolverMap({
  nodes,
  routes,
  palette = "cool",
  activeVehicleIdx = null,
}: SolverMapProps) {
  const colors = palette === "warm" ? WARM : COOL;

  const nodeMap = buildNodeMap(nodes);

  return (
    <MapContainer
      center={DEFAULT_CENTER}
      zoom={11}
      style={{ width: "100%", height: "100%" }}
    >
      <style>{`
        .solvermap-fit-control a {
          width: 30px;
          height: 30px;
          line-height: 30px;
          text-align: center;
          font-size: 16px;
          background: #ffffff;
          color: #0b1629;
          display: block;
        }
        .solvermap-fit-control a:hover {
          background: #0d9488;
          color: #ffffff;
        }
        .leaflet-control-layers {
          font-size: 13px;
        }
      `}</style>

      <LayersControl position="topright">
        <BaseLayer checked name="Street">
          <TileLayer
            attribution="© OpenStreetMap contributors"
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
        </BaseLayer>

        <BaseLayer name="Satellite">
          <TileLayer
            attribution="Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics"
            url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
          />
        </BaseLayer>

        <BaseLayer name="Dark">
          <TileLayer
            attribution="© OpenStreetMap contributors © CARTO"
            url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          />
        </BaseLayer>
      </LayersControl>

      <FitBounds nodes={nodes} />
      <FitControl nodes={nodes} />

      {nodes.map((node) => {
        const isDepot = node.id === 0;

        return (
          <Marker
            key={node.id}
            position={[node.lat, node.lng]}
            icon={isDepot ? depotIcon : pickupIcon}
          >
            <Popup>
              {isDepot ? (
                <div>
                  <strong>Depot</strong>
                </div>
              ) : (
                <div style={{ fontSize: 13 }}>
                  <strong>Pickup P{String(node.id).padStart(3, "0")}</strong>
                  <br />
                  load: <strong>{node.demand}</strong>
                </div>
              )}
            </Popup>
          </Marker>
        );
      })}

      {routes.map((route, vehicleIdx) => {
        const color = colors[vehicleIdx % colors.length];

        const isActive =
          activeVehicleIdx === null || activeVehicleIdx === vehicleIdx;

        const opacity = isActive ? 0.9 : 0.15;

        const positions = route
          .map((stopId) => {
            const node = nodeMap.get(stopId);
            return node ? ([node.lat, node.lng] as [number, number]) : null;
          })
          .filter((p): p is [number, number] => p !== null);

        return (
          <Polyline
            key={vehicleIdx}
            positions={positions}
            pathOptions={{
              color,
              weight: 4,
              opacity,
              lineCap: "round",
              lineJoin: "round",
            }}
          />
        );
      })}
    </MapContainer>
  );
}