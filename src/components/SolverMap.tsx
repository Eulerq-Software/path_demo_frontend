// src/components/SolverMap.tsx
//
// The shared map pane. Renders the depot, every order, and the active solver's
// routes.
//
// Routes are drawn as **real road geometry**: the solver only decides the order
// stops are visited in, and src/hooks/useRoadRoutes.ts turns that order into an
// actual drivable path via OSRM. Nothing is drawn for a route until its road
// path exists, and every route is revealed together once the batch finishes,
// so a straight-line placeholder is never painted and then swapped out. A
// straight line only appears as a dashed fallback for a rider OSRM genuinely
// failed to route.
//
// Each route is painted in three passes: an invisible wide hit layer (so thin
// lines stay easy to hover and click), a dark casing for every route, then the
// coloured line for every route on top. Doing casing and line per-route
// instead would let rider 2's casing paint over rider 1's line wherever they
// share a street, which reads as a broken line.

import "leaflet/dist/leaflet.css";
import "../Styling/SolverMap.css";

import {
  MapContainer,
  Marker,
  Polyline,
  Popup,
  Tooltip,
  TileLayer,
  LayersControl,
  useMap,
} from "react-leaflet";

import L from "leaflet";

import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";

import { useEffect, useMemo, useRef, useState } from "react";
import { RiAlertLine, RiCheckLine } from "react-icons/ri";

import type { Node, VehicleRoute } from "../types/cvrp";
import type { RoadRouteEntry, RoadRoutesPhase } from "../hooks/useRoadRoutes";
import {
  polylineLengthKm,
  sampleDirectionMarkers,
  type LatLng,
} from "../utils/osrm";
import { BASEMAPS, MAP_MAX_ZOOM, defaultBasemapIndex } from "../config";

delete (L.Icon.Default.prototype as any)._getIconUrl;

L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});

// ─────────────────────────────────────────────────────────────
// Labels
// ─────────────────────────────────────────────────────────────

/** "R001" style label, matching RouteDetailsPanel/SolverCard's numbering. */
function vehicleLabel(vehicleId: number): string {
  return `R${String(vehicleId).padStart(3, "0")}`;
}

/** "O001" style label for a stop (customer node) id. */
function orderLabel(nodeId: number): string {
  return `O${String(nodeId).padStart(3, "0")}`;
}

function buildNodeMap(nodes: Node[]): Map<number, Node> {
  const map = new Map<number, Node>();
  nodes.forEach((node) => map.set(node.id, node));
  return map;
}

// ─────────────────────────────────────────────────────────────
// Palettes
// ─────────────────────────────────────────────────────────────

const ROUTE_HUES = [
  "#e6194b",
  "#4363d8",
  "#f58231",
  "#3cb44b",
  "#911eb4",
  "#00bcd4",
  "#f2c500",
  "#f032e6",
  "#9a6324",
  "#b8e62e",
];

const rotate = <T,>(items: T[], by: number): T[] => [
  ...items.slice(by),
  ...items.slice(0, by),
];

export const COOL = ROUTE_HUES;

export const WARM = rotate(ROUTE_HUES, 5);

// Only kicks in past the 10th rider, where the palette starts repeating —
// a solid line is what a road route should look like whenever we can afford it.
const DASH_PATTERNS = [undefined, "10 6", "2 6", "10 4 2 4"];

/** Route color for a given vehicle position, matching the map's own indexing. */
export function routeColorFor(
  vehicleIdx: number,
  palette: "warm" | "cool" = "cool",
): string {
  const colors = palette === "warm" ? WARM : COOL;
  return colors[vehicleIdx % colors.length];
}

/** Dash pattern for a given vehicle position — disambiguates palette repeats. */
export function routeDashFor(
  vehicleIdx: number,
  palette: "warm" | "cool" = "cool",
): string | undefined {
  const colors = palette === "warm" ? WARM : COOL;
  const cycle = Math.floor(vehicleIdx / colors.length);
  return DASH_PATTERNS[cycle % DASH_PATTERNS.length];
}

// ─────────────────────────────────────────────────────────────
// Icons
// ─────────────────────────────────────────────────────────────

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const depotIcon = L.divIcon({
  className: "map-pin-wrapper",
  html: `
    <div class="depot-pin">
      <span class="depot-pin-pulse"></span>
      <span class="depot-pin-core">
        <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
          <path d="M3 10.2 12 3.5l9 6.7V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"
                fill="#04121f"/>
        </svg>
      </span>
    </div>`,
  iconSize: [36, 36],
  iconAnchor: [18, 18],
  popupAnchor: [0, -18],
});

function readableTextOn(hex: string): string {
  const channel = (start: number) => {
    const value = parseInt(hex.slice(start, start + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  const luminance =
    0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
  return luminance > 0.19 ? "#04121f" : "#ffffff";
}

const stopPinCache = new Map<string, L.DivIcon>();

/** Numbered badge showing this order's position in its rider's route. */
function stopPinIcon(color: string, sequence: number | null): L.DivIcon {
  const key = `${color}|${sequence ?? "x"}`;
  const cached = stopPinCache.get(key);
  if (cached) return cached;

  const label = sequence === null ? "·" : String(sequence);
  const wide = label.length > 2;
  const size = wide ? 30 : 26;

  const icon = L.divIcon({
    className: "map-pin-wrapper",
    html: `<div class="stop-pin${wide ? " stop-pin--wide" : ""}" style="--stop-color:${color};--stop-text:${readableTextOn(color)}"><span>${label}</span></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -(size / 2 + 2)],
  });

  stopPinCache.set(key, icon);
  return icon;
}

const plainDotCache = new Map<string, L.DivIcon>();

/** Pre-results order dot — no route to number it against yet. */
function plainDotIcon(color: string): L.DivIcon {
  const cached = plainDotCache.get(color);
  if (cached) return cached;

  const icon = L.divIcon({
    className: "map-pin-wrapper",
    html: `<div class="order-dot" style="--dot-color:${color}"></div>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
    popupAnchor: [0, -9],
  });

  plainDotCache.set(color, icon);
  return icon;
}

/**
 * Fixed place label, shown only on the empty map. Drawn by us rather than left
 * to the basemap, which drops its own city label once you zoom past the
 * neighbourhood level.
 *
 * Only on the empty map, because the default depot ("Bangalore (Center)") sits
 * at exactly this coordinate — so once an instance exists, the depot pin lands
 * on top of the label and the two overlap into a smudge.
 */
function cityLabelIcon(label: string): L.DivIcon {
  return L.divIcon({
    className: "map-pin-wrapper",
    html: `<span class="map-city-label">${label}</span>`,
    iconSize: [140, 18],
    iconAnchor: [70, 9],
  });
}

const arrowIconCache = new Map<string, L.DivIcon>();

/** White chevron laid on the route line, rotated into the direction of travel. */
function directionArrowIcon(bearingDegrees: number): L.DivIcon {
  // Quantise to 5° so a long route reuses a handful of icon instances.
  const rounded = Math.round(bearingDegrees / 5) * 5;
  const cached = arrowIconCache.get(String(rounded));
  if (cached) return cached;

  const icon = L.divIcon({
    className: "map-pin-wrapper",
    // The chevron is drawn pointing east (bearing 90°), so rotate by b - 90.
    //
    // Two stacked strokes, same casing trick as the route lines: the chevron
    // is wider than the line it rides on, so its tips overhang onto the
    // basemap. A plain white chevron vanishes against the light Street
    // basemap there; the dark under-stroke keeps it legible on light tiles,
    // on dark tiles and on satellite alike.
    html: `<div class="route-arrow" style="transform: rotate(${rounded - 90}deg)">
        <svg viewBox="0 0 14 14" width="13" height="13" aria-hidden="true">
          <path d="M4.6 2.4 L9.2 7 L4.6 11.6" fill="none" stroke="#02101f"
                stroke-opacity="0.75" stroke-width="4.4" stroke-linecap="round"
                stroke-linejoin="round"/>
          <path d="M4.6 2.4 L9.2 7 L4.6 11.6" fill="none" stroke="#ffffff"
                stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </div>`,
    iconSize: [13, 13],
    iconAnchor: [6.5, 6.5],
  });

  arrowIconCache.set(String(rounded), icon);
  return icon;
}

// ─────────────────────────────────────────────────────────────
// Map helpers
// ─────────────────────────────────────────────────────────────

const DEFAULT_CENTER: [number, number] = [12.9716, 77.5946];
const DEFAULT_ZOOM = 15;

/**
 * Past this many orders the numbered stop badges stop being readable — a few
 * hundred 26px circles at city zoom is a wall, not a sequence — so orders fall
 * back to small dots still coloured by rider. Isolating a rider brings that
 * rider's numbers back, which is when the visiting order actually matters.
 */
const MAX_NUMBERED_BADGES = 150;

const { BaseLayer } = LayersControl;

/** All points currently on the map — depot + orders — used for fit-bounds. */
function allPoints(depot: Node | null, orders: Node[]): LatLng[] {
  const points: LatLng[] = [];
  if (depot) points.push([depot.lat, depot.lng]);
  orders.forEach((o) => points.push([o.lat, o.lng]));
  return points;
}

/**
 * Owns every programmatic camera move, so the two things that should move the
 * map — new data, and selecting a rider — can't fight each other.
 *
 * Deliberately keyed on value signatures rather than array identity: road
 * geometry streams in rider by rider, and re-fitting on each arrival would
 * yank the map out from under the user.
 */
function MapViewController({
  depot,
  orders,
  focusPositions,
  focusKey,
}: {
  depot: Node | null;
  orders: Node[];
  focusPositions: LatLng[];
  focusKey: string | null;
}) {
  const map = useMap();

  const dataKey = useMemo(() => {
    const points = allPoints(depot, orders);
    if (!points.length) return "";
    return `${points.length}|${points[0].join(",")}|${points[
      points.length - 1
    ].join(",")}`;
  }, [depot, orders]);

  const focusRef = useRef(focusPositions);
  focusRef.current = focusPositions;

  const prevDataKey = useRef<string | null>(null);
  const prevFocusKey = useRef<string | null>(null);

  // A single effect handles all three camera moves, so a reset (which changes
  // the data *and* clears the selection in the same render) produces one
  // movement rather than an instant fit racing an animated one.
  useEffect(() => {
    const dataChanged = prevDataKey.current !== dataKey;
    const focusChanged = prevFocusKey.current !== focusKey;
    prevDataKey.current = dataKey;
    prevFocusKey.current = focusKey;
    if (!dataChanged && !focusChanged) return;

    // Selecting a rider always wins: glide to that route.
    if (focusKey && focusChanged) {
      const focus = focusRef.current;
      if (focus.length >= 2) {
        map.flyToBounds(L.latLngBounds(focus), {
          padding: [70, 70],
          duration: 0.7,
        });
        return;
      }
    }

    const points = allPoints(depot, orders);
    if (!points.length) {
      map.setView(DEFAULT_CENTER, DEFAULT_ZOOM);
      return;
    }

    if (dataChanged) {
      // New instance: jump straight there — animating from an unrelated
      // viewport just flies the user across the city for no reason.
      map.fitBounds(L.latLngBounds(points), { padding: [48, 48] });
    } else if (!focusKey) {
      // Selection cleared: ease back out to the whole instance.
      map.flyToBounds(L.latLngBounds(points), {
        padding: [48, 48],
        duration: 0.6,
      });
    }
    // depot/orders are represented by dataKey; depending on the arrays
    // themselves would re-fire this on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataKey, focusKey, map]);

  return null;
}

/**
 * One control holding both map actions — fit to data and full screen.
 *
 * They live in a single Leaflet bar so they always stack in the same order,
 * directly under the zoom buttons, with the same width and the same icon
 * treatment. Two independent controls re-added themselves on their own
 * schedules, which is what let the order swap between screens and left one
 * button's glyph pinned to the corner.
 *
 * The fullscreen target is the outer shell rather than Leaflet's own
 * container, so the layer switcher, the routing chip and the map key come
 * along instead of being left behind in the collapsed page. Leaflet caches the
 * container size, so `invalidateSize` has to run once the browser has
 * finished resizing — otherwise the map keeps painting at its old dimensions
 * and the tiles sit in the top-left corner of a black screen.
 */
function MapActionsControl({
  depot,
  orders,
  targetRef,
}: {
  depot: Node | null;
  orders: Node[];
  targetRef: { current: HTMLDivElement | null };
}) {
  const map = useMap();

  const viewRef = useRef({ depot, orders });
  viewRef.current = { depot, orders };

  useEffect(() => {
    const fitHtml = `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
        <circle cx="8" cy="8" r="3" fill="none" stroke="currentColor" stroke-width="1.6"/>
        <path d="M8 1.5v3M8 11.5v3M1.5 8h3M11.5 8h3" fill="none"
              stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`;
    const enterHtml = `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
        <path d="M2 6V2h4M14 6V2h-4M2 10v4h4M14 10v4h-4" fill="none"
              stroke="currentColor" stroke-width="1.7" stroke-linecap="round"
              stroke-linejoin="round"/></svg>`;
    const exitHtml = `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
        <path d="M6 2v4H2M10 2v4h4M6 14v-4H2M10 14v-4h4" fill="none"
              stroke="currentColor" stroke-width="1.7" stroke-linecap="round"
              stroke-linejoin="round"/></svg>`;

    let fullscreenButton: HTMLAnchorElement | null = null;

    const isFullscreen = () => document.fullscreenElement === targetRef.current;

    const paintFullscreen = () => {
      if (!fullscreenButton) return;
      const active = isFullscreen();
      fullscreenButton.innerHTML = active ? exitHtml : enterHtml;
      fullscreenButton.title = active ? "Exit full screen" : "Full screen";
      fullscreenButton.setAttribute("aria-label", fullscreenButton.title);
    };

    const ActionsControl = L.Control.extend({
      onAdd: () => {
        const container = L.DomUtil.create(
          "div",
          "leaflet-bar solvermap-actions",
        );

        const fitButton = L.DomUtil.create(
          "a",
          "solvermap-action",
          container,
        ) as HTMLAnchorElement;
        fitButton.href = "#";
        fitButton.title = "Fit to data";
        fitButton.innerHTML = fitHtml;
        fitButton.setAttribute("role", "button");
        fitButton.setAttribute("aria-label", "Fit map to data");

        fullscreenButton = L.DomUtil.create(
          "a",
          "solvermap-action",
          container,
        ) as HTMLAnchorElement;
        fullscreenButton.href = "#";
        fullscreenButton.setAttribute("role", "button");
        paintFullscreen();

        L.DomEvent.disableClickPropagation(container);

        L.DomEvent.on(fitButton, "click", (e) => {
          L.DomEvent.stopPropagation(e);
          L.DomEvent.preventDefault(e);
          const points = allPoints(
            viewRef.current.depot,
            viewRef.current.orders,
          );
          if (!points.length) {
            map.setView(DEFAULT_CENTER, DEFAULT_ZOOM);
            return;
          }
          map.fitBounds(L.latLngBounds(points), { padding: [48, 48] });
        });

        L.DomEvent.on(fullscreenButton, "click", (e) => {
          L.DomEvent.stopPropagation(e);
          L.DomEvent.preventDefault(e);

          const target = targetRef.current;
          if (!target) return;

          if (isFullscreen()) {
            void document.exitFullscreen?.();
          } else {
            const request =
              target.requestFullscreen ??
              (target as unknown as {
                webkitRequestFullscreen?: () => Promise<void>;
              }).webkitRequestFullscreen;
            void Promise.resolve(request?.call(target)).catch(() => undefined);
          }
        });

        return container;
      },
    });

    const control = new ActionsControl({ position: "topleft" });
    control.addTo(map);

    const onFullscreenChange = () => {
      paintFullscreen();
      window.setTimeout(() => map.invalidateSize(), 150);
    };

    document.addEventListener("fullscreenchange", onFullscreenChange);
    document.addEventListener("webkitfullscreenchange", onFullscreenChange);

    return () => {
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      document.removeEventListener("webkitfullscreenchange", onFullscreenChange);
      control.remove();
      fullscreenButton = null;
    };
  }, [map, targetRef]);

  return null;
}

// ─────────────────────────────────────────────────────────────
// Derived drawing model
// ─────────────────────────────────────────────────────────────

type RouteSource = "road" | "straight";

interface DrawableRoute {
  vehicleId: number;
  vehicleIdx: number;
  color: string;
  dashArray?: string;
  positions: LatLng[];
  source: RouteSource;
  /** Solver's own (straight-line) distance, kept separate from the road one. */
  solverKm: number;
  roadKm: number | null;
  roadMin: number | null;
  stopCount: number;
  load: number;
  isSelected: boolean;
  isDimmed: boolean;
}

function formatKm(value: number): string {
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}

function formatMinutes(value: number): string {
  const minutes = Math.round(value);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${String(minutes % 60).padStart(2, "0")}m`;
}

// ─────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────

export interface SolverMapProps {
  /** Every node in the instance (depot + orders); depot is whichever node has type "depot". */
  nodes: Node[];
  routes: VehicleRoute[];
  palette?: "warm" | "cool";
  activeVehicleIdx?: number | null;
  /** Road geometry per vehicleId, from useRoadRoutes. */
  roadRoutes?: Record<number, RoadRouteEntry>;
  routingPhase?: RoadRoutesPhase;
  routingResolved?: number;
  routingTotal?: number;
  routingError?: string | null;
  onRetryRouting?: () => void;
  /** Lets a click on a route line select that rider (mirrors the side panel). */
  onSelectVehicle?: (index: number | null) => void;
}

export default function SolverMap({
  nodes,
  routes,
  palette = "cool",
  activeVehicleIdx = null,
  roadRoutes,
  routingPhase = "idle",
  routingResolved = 0,
  routingTotal = 0,
  routingError = null,
  onRetryRouting,
  onSelectVehicle,
}: SolverMapProps) {
  const colors = palette === "warm" ? WARM : COOL;
  const hasResults = routes.length > 0;
  const [legendOpen, setLegendOpen] = useState(true);

  const depot = useMemo(
    () => nodes.find((n) => n.type === "depot") ?? null,
    [nodes],
  );
  const orders = useMemo(
    () => nodes.filter((n) => n.type !== "depot"),
    [nodes],
  );
  const nodeMap = useMemo(() => buildNodeMap(nodes), [nodes]);

  // The fullscreen target: the outer shell, so the Leaflet controls and the
  // overlay stack expand with the map rather than staying behind on the page.
  const shellRef = useRef<HTMLDivElement | null>(null);

  // Resolved once: switching layers afterwards is Leaflet's business, and
  // re-deriving `checked` on every render would fight the user's choice.
  const startingBasemap = useMemo(() => defaultBasemapIndex(), []);

  // ── Per-order lookup: which rider, which position in the sequence ──
  const stopIndex = useMemo(() => {
    const index = new Map<
      number,
      { sequence: number; color: string; vehicleId: number; vehicleIdx: number }
    >();
    routes.forEach((route, vehicleIdx) => {
      const color = colors[vehicleIdx % colors.length];
      const stopIds = route.route.filter((id) => id !== 0);
      stopIds.forEach((nodeId, i) => {
        index.set(nodeId, {
          sequence: i + 1,
          color,
          vehicleId: route.vehicleId,
          vehicleIdx,
        });
      });
    });
    return index;
  }, [routes, colors]);

  // ── Straight-line geometry, memoised on its own ────────────
  // Road paths stream in one rider at a time, so `drawables` below recomputes
  // repeatedly. react-leaflet only calls setLatLngs when the `positions` array
  // *identity* changes, so keeping these arrays stable means a rider's line is
  // only redrawn when that rider's own geometry actually changed — not 20 times
  // over while its neighbours resolve.
  const straightGeometries = useMemo(() => {
    const byVehicle = new Map<number, LatLng[]>();
    if (!depot) return byVehicle;

    routes.forEach((route) => {
      const stopIds = route.route.filter((id) => id !== 0);
      if (stopIds.length === 0) return;

      const positions = route.route
        .map((id) => nodeMap.get(id))
        .filter((n): n is Node => n !== undefined)
        .map((n): LatLng => [n.lat, n.lng]);

      if (positions.length >= 2) byVehicle.set(route.vehicleId, positions);
    });
    return byVehicle;
  }, [depot, routes, nodeMap]);

  // A selection index left over from a solver with more riders would otherwise
  // dim every route and highlight none — leaving the map looking broken.
  const selectedIdx =
    activeVehicleIdx !== null &&
    activeVehicleIdx >= 0 &&
    activeVehicleIdx < routes.length
      ? activeVehicleIdx
      : null;

  // ── Drawing model ──────────────────────────────────────────
  // When road routing is wired in, nothing is drawn until the whole batch has
  // settled: a route is either its real road path or (for a rider OSRM failed
  // on) a flagged straight fallback — never a placeholder that gets replaced.
  const roadAware = roadRoutes !== undefined;
  const routesReady =
    !roadAware || routingPhase === "ready" || routingPhase === "degraded";

  const drawables = useMemo<DrawableRoute[]>(() => {
    if (!depot || !routesReady) return [];

    return routes
      .map((route, vehicleIdx): DrawableRoute | null => {
        const stopCount = route.route.filter((id) => id !== 0).length;
        if (stopCount === 0) return null;

        const road = roadRoutes?.[route.vehicleId];
        if (roadAware && !road) return null;

        const source: RouteSource = road ? road.source : "straight";
        const positions =
          road && road.geometry.length > 1
            ? road.geometry
            : (straightGeometries.get(route.vehicleId) ?? []);
        if (positions.length < 2) return null;

        return {
          vehicleId: route.vehicleId,
          vehicleIdx,
          color: colors[vehicleIdx % colors.length],
          dashArray: routeDashFor(vehicleIdx, palette),
          positions,
          source,
          solverKm: route.totalDistance,
          roadKm: road && road.source === "road" ? road.distanceKm : null,
          roadMin: road && road.source === "road" ? road.durationMin : null,
          stopCount,
          load: route.totalLoad,
          isSelected: selectedIdx === vehicleIdx,
          isDimmed: selectedIdx !== null && selectedIdx !== vehicleIdx,
        };
      })
      .filter((d): d is DrawableRoute => d !== null);
  }, [
    depot,
    routes,
    straightGeometries,
    roadRoutes,
    roadAware,
    routesReady,
    colors,
    palette,
    selectedIdx,
  ]);

  const selected = drawables.find((d) => d.isSelected) ?? null;
  const hasFallback = drawables.some((d) => d.source === "straight");

  // With a rider selected, every other route drops out entirely (no faded
  // casing/line, no hit layer to click) rather than just dimming — switching
  // riders goes through the sidebar list or the "Route Details" panel instead.
  const visibleDrawables = selected
    ? drawables.filter((d) => d.isSelected)
    : drawables;

  // ── Direction arrows ───────────────────────────────────────
  // Heavily thinned when nothing is selected (20 routes' worth of arrows is
  // noise, not information) and generous on the one route being inspected.
  const arrows = useMemo(() => {
    const hasSelection = selectedIdx !== null;
    const placements: {
      key: string;
      position: LatLng;
      bearing: number;
      dimmed: boolean;
    }[] = [];

    const budget = 160;

    for (const drawable of drawables) {
      if (hasSelection && !drawable.isSelected) continue;
      if (placements.length >= budget) break;

      // OSRM already told us how long a snapped route is; only the short
      // straight-line stand-ins (≤ ~32 points) need measuring here, so this
      // stays cheap even while 20 riders stream in one at a time.
      const lengthKm = drawable.roadKm ?? polylineLengthKm(drawable.positions);
      if (lengthKm <= 0) continue;

      const count = drawable.isSelected
        ? clamp(Math.round(lengthKm / 1.1), 4, 18)
        : clamp(Math.round(lengthKm / 3.2), 2, 6);

      sampleDirectionMarkers(drawable.positions, count).forEach(
        (marker, i) => {
          placements.push({
            key: `${drawable.vehicleId}-arrow-${i}`,
            position: marker.position,
            bearing: marker.bearing,
            dimmed: drawable.isDimmed,
          });
        },
      );
    }

    return placements;
  }, [drawables, selectedIdx]);

  // Keyed on the rider alone: when that rider's road path lands a moment
  // later the framing stays put instead of lurching a second time.
  const focusKey = selected ? String(selected.vehicleId) : null;
  const focusPositions = selected?.positions ?? [];

  return (
    <div className="solver-map-shell" ref={shellRef}>
      <MapContainer
        center={DEFAULT_CENTER}
        zoom={DEFAULT_ZOOM}
        maxZoom={MAP_MAX_ZOOM}
        zoomControl
        // Leaflet's default animated zoom keeps the *old* tiles on screen
        // (scaled via CSS transform) for the length of the transition and
        // only swaps in the new ones once they've actually loaded — so the
        // map never has a moment with nothing painted. Turning this off
        // trades that for an instant snap, which looks fine while tiles are
        // cached but flashes the container's own background (near-black)
        // for as long as the new zoom level's tiles take to arrive — worse
        // than the marker lag it was meant to fix. `markerZoomAnimation`
        // (on by default alongside `zoomAnimation`) applies that same
        // transform to every marker too, so divIcons stay pinned to their
        // real coordinates through the animation.
        style={{ width: "100%", height: "100%" }}
      >
        {/* Basemaps come from config.ts — MapTiler for Street/Dark (vector-
            rendered, so real tiles all the way to z22) and Esri for Satellite.
            `bottomright` matches the Comparison project's map, and keeps the
            switcher clear of the fit/fullscreen controls at top-left. */}
        <LayersControl position="bottomright">
          {BASEMAPS.map((layer, index) => (
            <BaseLayer
              key={layer.id}
              name={layer.name}
              checked={index === startingBasemap}
            >
              <TileLayer
                url={layer.url}
                attribution={layer.attribution}
                maxZoom={layer.maxZoom}
                maxNativeZoom={layer.maxNativeZoom}
              />
            </BaseLayer>
          ))}
        </LayersControl>

        <MapViewController
          depot={depot}
          orders={orders}
          focusPositions={focusPositions}
          focusKey={focusKey}
        />
        <MapActionsControl depot={depot} orders={orders} targetRef={shellRef} />

        {!depot && (
          <Marker
            position={DEFAULT_CENTER}
            icon={cityLabelIcon("Bengaluru")}
            interactive={false}
            zIndexOffset={-1000}
          />
        )}

        {/* Pass 1 — invisible, wide hit layer for every visible route.
            The visible strokes are thin, so hovering or clicking right on the
            line would be fiddly. This layer carries the tooltip and the click
            handler instead. Only ever covers `visibleDrawables` — once a
            rider is selected, every other route is gone from the map, so
            there's nothing here to click back onto. (It also has to be
            constant: react-leaflet only reads `interactive` when the layer
            is constructed, never on update.) */}
        {visibleDrawables.map((drawable) => (
          <Polyline
            key={`hit-${drawable.vehicleId}`}
            positions={drawable.positions}
            interactive
            bubblingMouseEvents={false}
            eventHandlers={
              onSelectVehicle
                ? {
                    click: () =>
                      onSelectVehicle(
                        drawable.isSelected ? null : drawable.vehicleIdx,
                      ),
                  }
                : undefined
            }
            pathOptions={{
              color: "#000000",
              weight: 16,
              opacity: 0,
              lineCap: "round",
              lineJoin: "round",
              className: "route-hit",
            }}
          >
            <Tooltip sticky className="solvermap-tooltip route-tooltip">
              <span className="route-tooltip-title">
                <span
                  className="route-tooltip-swatch"
                  style={{ background: drawable.color }}
                />
                {vehicleLabel(drawable.vehicleId)}
              </span>
              <span className="route-tooltip-line">
                {drawable.stopCount} stops · {drawable.load} kg
              </span>
              {drawable.roadKm !== null ? (
                <span className="route-tooltip-line">
                  {formatKm(drawable.roadKm)} km on road
                  {drawable.roadMin !== null
                    ? ` · ~${formatMinutes(drawable.roadMin)}`
                    : ""}
                </span>
              ) : (
                <span className="route-tooltip-line route-tooltip-line--muted">
                  straight-line estimate
                </span>
              )}
              <span className="route-tooltip-line route-tooltip-line--muted">
                solver: {formatKm(drawable.solverKm)} km
              </span>
            </Tooltip>
          </Polyline>
        ))}

        {/* Pass 2 — dark casing for every visible route, under its line. */}
        {visibleDrawables.map((drawable) => (
          <Polyline
            key={`casing-${drawable.vehicleId}`}
            positions={drawable.positions}
            interactive={false}
            pathOptions={{
              color: "#02101f",
              weight: drawable.isSelected ? 8.5 : 6,
              opacity: 0.45,
              lineCap: "round",
              lineJoin: "round",
              className: "route-casing",
            }}
          />
        ))}

        {/* Pass 3 — the coloured line itself, on top of every casing. */}
        {visibleDrawables.map((drawable) => (
          <Polyline
            key={`line-${drawable.vehicleId}-${drawable.source}`}
            positions={drawable.positions}
            interactive={false}
            pathOptions={{
              color: drawable.color,
              weight: drawable.isSelected ? 5 : 3.2,
              opacity: 0.95,
              dashArray:
                drawable.source === "road" ? drawable.dashArray : "8 6",
              lineCap: "round",
              lineJoin: "round",
              className: "route-line",
            }}
          />
        ))}

        {/* Pass 4 — animated flow along the selected route. */}
        {selected && selected.positions.length > 1 && (
          <Polyline
            key={`flow-${selected.vehicleId}`}
            positions={selected.positions}
            interactive={false}
            pathOptions={{
              color: "#ffffff",
              weight: 2,
              opacity: 0.8,
              dashArray: "1 16",
              lineCap: "round",
              className: "route-flow",
            }}
          />
        )}

        {/* Direction arrows */}
        {arrows.map((arrow) => (
          <Marker
            key={arrow.key}
            position={arrow.position}
            icon={directionArrowIcon(arrow.bearing)}
            interactive={false}
            opacity={arrow.dimmed ? 0.1 : 0.95}
            zIndexOffset={200}
          />
        ))}

        {/* Orders — plain dots before a solve, numbered stop badges after.
            Once a rider is selected, every other rider's stops drop out of
            the map entirely (same treatment as their routes) instead of
            just fading. */}
        {orders.map((order) => {
          const hit = stopIndex.get(order.id);
          const belongsToOther =
            hasResults && selectedIdx !== null && hit?.vehicleIdx !== selectedIdx;
          if (belongsToOther) return null;

          // Numbers when the map can carry them: few enough orders overall,
          // or this stop belongs to the rider currently isolated.
          const numbered =
            orders.length <= MAX_NUMBERED_BADGES ||
            (selectedIdx !== null && hit?.vehicleIdx === selectedIdx);

          const icon = !hasResults
            ? plainDotIcon("#10e0a1")
            : hit
              ? numbered
                ? stopPinIcon(hit.color, hit.sequence)
                : plainDotIcon(hit.color)
              : plainDotIcon("#64748b");

          return (
            <Marker
              key={order.id}
              position={[order.lat, order.lng]}
              icon={icon}
              opacity={1}
              zIndexOffset={1000}
            >
              <Tooltip
                direction="top"
                offset={[0, -16]}
                className="solvermap-tooltip"
              >
                <span className="route-tooltip-title">{orderLabel(order.id)}</span>
                <span className="route-tooltip-line">{order.demand} kg</span>
                {hasResults &&
                  (hit ? (
                    <span className="route-tooltip-line">
                      stop #{hit.sequence} · {vehicleLabel(hit.vehicleId)}
                    </span>
                  ) : (
                    <span className="route-tooltip-line route-tooltip-line--warn">
                      unassigned
                    </span>
                  ))}
              </Tooltip>
              <Popup>
                <div className="map-popup">
                  <strong>{orderLabel(order.id)}</strong>
                  <span>
                    demand: <strong>{order.demand} kg</strong>
                  </span>
                  {hasResults && hit && (
                    <span>
                      stop <strong>#{hit.sequence}</strong> on{" "}
                      <strong>{vehicleLabel(hit.vehicleId)}</strong>
                    </span>
                  )}
                </div>
              </Popup>
            </Marker>
          );
        })}

        {/* Depot last so it always sits on top of the stop badges */}
        {depot && (
          <Marker
            key="depot"
            position={[depot.lat, depot.lng]}
            icon={depotIcon}
            zIndexOffset={2000}
          >
            <Tooltip
              direction="top"
              offset={[0, -20]}
              className="solvermap-tooltip"
            >
              <span className="route-tooltip-title">Depot</span>
              <span className="route-tooltip-line">
                every route starts and ends here
              </span>
            </Tooltip>
            <Popup>
              <div className="map-popup">
                <strong>Depot</strong>
                <span>
                  {depot.lat.toFixed(5)}, {depot.lng.toFixed(5)}
                </span>
              </div>
            </Popup>
          </Marker>
        )}
      </MapContainer>

      {/* ── Overlay stack: routing status + map key ─────────────── */}
      {hasResults && (
        <div className="map-overlay-stack">
          <RoutingStatusChip
            phase={routingPhase}
            resolved={routingResolved}
            total={routingTotal}
            errorMessage={routingError}
            onRetry={onRetryRouting}
          />

          <div className={`map-legend ${legendOpen ? "" : "map-legend--closed"}`}>
            <button
              type="button"
              className="map-legend-toggle"
              onClick={() => setLegendOpen((open) => !open)}
              aria-expanded={legendOpen}
            >
              <span>Map key</span>
              <span className="map-legend-chevron" aria-hidden="true">
                {legendOpen ? "▾" : "▸"}
              </span>
            </button>

            {legendOpen && (
              <div className="map-legend-body">
                <span className="map-legend-item">
                  <span className="map-legend-depot" />
                  Depot
                </span>
                <span className="map-legend-item">
                  <span className="map-legend-stop">1</span>
                  Visit order
                </span>
                <span className="map-legend-item">
                  <span className="map-legend-arrow">›</span>
                  Direction of travel
                </span>
                <span className="map-legend-item">
                  <span className="map-legend-swatch map-legend-swatch--road" />
                  On-road path
                </span>
                {hasFallback && (
                  <span className="map-legend-item">
                    <span className="map-legend-swatch map-legend-swatch--dashed" />
                    Straight-line estimate
                  </span>
                )}
                <span className="map-legend-hint">
                  Click a route or a rider to isolate it.
                </span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Routing status chip
// ─────────────────────────────────────────────────────────────

function RoutingStatusChip({
  phase,
  resolved,
  total,
  errorMessage,
  onRetry,
}: {
  phase: RoadRoutesPhase;
  resolved: number;
  total: number;
  errorMessage: string | null;
  onRetry?: () => void;
}) {
  if (phase === "idle") return null;

  if (phase === "loading") {
    const pct = total > 0 ? Math.round((resolved / total) * 100) : 0;
    return (
      <div className="routing-chip routing-chip--loading">
        <span className="routing-chip-spinner" aria-hidden="true" />
        <span className="routing-chip-text">
          Snapping routes to roads
          <span className="routing-chip-count">
            {resolved}/{total}
          </span>
        </span>
        <span className="routing-chip-bar" aria-hidden="true">
          <span className="routing-chip-bar-fill" style={{ width: `${pct}%` }} />
        </span>
      </div>
    );
  }

  if (phase === "degraded") {
    return (
      <div className="routing-chip routing-chip--warn" role="status">
        <RiAlertLine className="routing-chip-icon" aria-hidden="true" />
        <span className="routing-chip-text">
          {errorMessage ?? "Some routes could not be snapped to roads."}
        </span>
        {onRetry && (
          <button type="button" className="routing-chip-retry" onClick={onRetry}>
            Retry
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="routing-chip routing-chip--ok" role="status">
      <RiCheckLine className="routing-chip-icon" aria-hidden="true" />
      <span className="routing-chip-text">
        On-road routes
        <span className="routing-chip-sub">via OSRM</span>
      </span>
    </div>
  );
}