import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { Node, VehicleRoute } from "../types/cvrp";
import {
  describeOsrmError,
  fetchRoadPathOrStraight,
  type LatLng,
  type RoadLeg,
  type RoadPath,
} from "../utils/osrm";
import { OSRM_CONFIG } from "../config";

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export interface RoadRouteEntry {
  vehicleId: number;
  /** Road-following geometry (or the raw waypoints when `source` is "straight"). */
  geometry: LatLng[];
  /** Driving distance along roads, km. */
  distanceKm: number;
  /** Driving time along roads, minutes. */
  durationMin: number;
  /** Per-hop breakdown: depot→stop 1, stop 1→stop 2, …, last stop→depot. */
  legs: RoadLeg[];
  source: "road" | "straight";
}

/**
 * idle     — nothing to route yet (no results on the map).
 * loading  — at least one vehicle still resolving.
 * ready    — every vehicle snapped to the road network.
 * degraded — finished, but one or more vehicles fell back to straight lines.
 */
export type RoadRoutesPhase = "idle" | "loading" | "ready" | "degraded";

export interface RoadRoutesState {
  /** Keyed by vehicleId. Missing key = not resolved yet. */
  byVehicle: Record<number, RoadRouteEntry>;
  phase: RoadRoutesPhase;
  /** Vehicles resolved so far (road or fallback). */
  resolved: number;
  /** Vehicles in this batch. */
  total: number;
  /** Vehicles that fell back to straight lines. */
  fallbackCount: number;
  /** First failure reason, ready to show in the map's status chip. */
  errorMessage: string | null;
  /** Discards any fallback results and re-requests them from OSRM. */
  retry: () => void;
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function buildNodeMap(nodes: Node[]): Map<number, Node> {
  const map = new Map<number, Node>();
  nodes.forEach((node) => map.set(node.id, node));
  return map;
}

/**
 * depot → every stop in visiting order → back to the depot.
 *
 * `route.route` is already depot-bookended ([0, ...customerIds, 0]), so
 * this is just a straight lookup of each id's coordinates via the node map.
 * Ids with no matching node (shouldn't normally happen) are dropped.
 */
export function buildWaypoints(
  route: VehicleRoute,
  nodeMap: Map<number, Node>,
): LatLng[] {
  return route.route
    .map((id) => nodeMap.get(id))
    .filter((n): n is Node => n !== undefined)
    .map((n): LatLng => [n.lat, n.lng]);
}

/**
 * Identity of a batch of work. Two renders that produce the same signature
 * describe the same road routes, so the effect must not refire — this is what
 * stops React's render cycle from re-issuing OSRM requests on every keystroke
 * elsewhere in the dashboard.
 */
function batchSignature(
  routes: VehicleRoute[],
  nodeMap: Map<number, Node>,
): string {
  if (routes.length === 0) return "";
  const routeKeys = routes.map((route) => {
    const waypoints = buildWaypoints(route, nodeMap);
    return `${route.vehicleId}:${waypoints
      .map(([lat, lng]) => `${lat.toFixed(6)},${lng.toFixed(6)}`)
      .join("|")}`;
  });
  return routeKeys.join("#");
}

function toEntry(vehicleId: number, path: RoadPath): RoadRouteEntry {
  return {
    vehicleId,
    geometry: path.geometry,
    distanceKm: path.distanceKm,
    durationMin: path.durationMin,
    legs: path.legs,
    source: path.source,
  };
}

const EMPTY_BY_VEHICLE: Record<number, RoadRouteEntry> = {};

interface Batch {
  signature: string;
  byVehicle: Record<number, RoadRouteEntry>;
  done: boolean;
  errorMessage: string | null;
}

const EMPTY_BATCH: Batch = {
  signature: "",
  byVehicle: EMPTY_BY_VEHICLE,
  done: false,
  errorMessage: null,
};

// ─────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────

export function useRoadRoutes(
  routes: VehicleRoute[],
  nodes: Node[],
): RoadRoutesState {
  const [batch, setBatch] = useState<Batch>(EMPTY_BATCH);
  const [retryNonce, setRetryNonce] = useState(0);

  const nodeMap = useMemo(() => buildNodeMap(nodes), [nodes]);

  // Only routes that actually visit somewhere are worth snapping — an unused
  // vehicle has nothing to draw.
  const routable = useMemo(
    () => routes.filter((route) => route.numStops > 0),
    [routes],
  );

  const signature = useMemo(
    () => batchSignature(routable, nodeMap),
    [routable, nodeMap],
  );

  // Keep the latest routable list (and node map) in refs so the effect can
  // read them without taking the array/map itself as a dependency — a new
  // identity on every render would restart the batch endlessly.
  const routableRef = useRef(routable);
  routableRef.current = routable;

  const nodeMapRef = useRef(nodeMap);
  nodeMapRef.current = nodeMap;

  useEffect(() => {
    const currentRoutes = routableRef.current;
    const currentNodeMap = nodeMapRef.current;

    if (!signature || currentRoutes.length === 0) {
      setBatch(EMPTY_BATCH);
      return;
    }

    const controller = new AbortController();
    let cancelled = false;

    setBatch({
      signature,
      byVehicle: EMPTY_BY_VEHICLE,
      done: false,
      errorMessage: null,
    });

    let firstError: string | null = null;

    const jobs = currentRoutes.map(async (route) => {
      const waypoints = buildWaypoints(route, currentNodeMap);
      const { path, error } = await fetchRoadPathOrStraight(
        waypoints,
        controller.signal,
      );

      if (cancelled) return;

      if (error && !firstError) {
        firstError = describeOsrmError(error);
      }

      setBatch((prev) =>
        prev.signature !== signature
          ? prev
          : {
              ...prev,
              byVehicle: {
                ...prev.byVehicle,
                [route.vehicleId]: toEntry(route.vehicleId, path),
              },
            },
      );
    });

    void Promise.all(jobs).then(() => {
      if (cancelled) return;
      setBatch((prev) =>
        prev.signature !== signature
          ? prev
          : { ...prev, done: true, errorMessage: firstError },
      );
    });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [signature, retryNonce]);

  // A batch only counts for the routes it was computed for. Vehicle ids
  // repeat across solvers (1, 2, …), so without this the previous solver's
  // geometry would be handed to the new solver's routes for the one render
  // before the effect above clears it.
  const current = signature && batch.signature === signature ? batch : null;
  const byVehicle = current?.byVehicle ?? EMPTY_BY_VEHICLE;
  const total = signature ? routable.length : 0;

  const resolved = useMemo(
    () => Object.keys(byVehicle).length,
    [byVehicle],
  );

  const fallbackCount = useMemo(
    () =>
      Object.values(byVehicle).filter((entry) => entry.source === "straight")
        .length,
    [byVehicle],
  );

  // "ready" only means the batch finished; if anything fell back, the real
  // state is "degraded" so the map can say so instead of quietly lying about
  // showing on-road geometry.
  const effectivePhase: RoadRoutesPhase = !signature
    ? "idle"
    : current?.done
      ? fallbackCount > 0
        ? "degraded"
        : "ready"
      : OSRM_CONFIG.ENABLED
        ? "loading"
        : "degraded";

  const retry = useCallback(() => {
    setRetryNonce((n) => n + 1);
  }, []);

  return {
    byVehicle,
    phase: effectivePhase,
    resolved,
    total,
    fallbackCount,
    errorMessage: current?.errorMessage ?? null,
    retry,
  };
}