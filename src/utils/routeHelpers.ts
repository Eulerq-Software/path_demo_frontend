// src/utils/routeHelpers.ts
//
// Shared helpers for converting VehicleRoute[] (from either the local
// greedy solver or resultParser.ts) into the RouteAssignment[] shape
// consumed by SolverCard.

import type { VehicleRoute, RouteAssignment, CVRPInstance, Node } from "../types/cvrp";
import { haversineKm } from "./osrm";

// ─────────────────────────────────────────────────────────────────────────
// resolveCapacity
//
// Capacity now lives per-vehicle on instance.vehicles (each vehicle has
// its own explicit `capacity`), so this is a lookup by id rather than the
// old uniform/per-index array logic.
// ─────────────────────────────────────────────────────────────────────────

export function resolveCapacity(
  instance: CVRPInstance,
  vehicleId: number,
): number {
  return instance.vehicles.find((v) => v.id === vehicleId)?.capacity ?? 0;
}

// ─────────────────────────────────────────────────────────────────────────
// buildRouteAssignments
//
// Adds:
//   • capacity       — resolved from instance.vehicles by vehicleId
//   • isOverCapacity — true if totalLoad > capacity (UI shows a warning badge)
// ─────────────────────────────────────────────────────────────────────────

export function buildRouteAssignments(
  routes: VehicleRoute[],
  instance: CVRPInstance,
): RouteAssignment[] {
  return routes.map((vr): RouteAssignment => {
    const capacity = resolveCapacity(instance, vr.vehicleId);
    return {
      vehicleId: vr.vehicleId,
      route: vr.route,
      totalDistance: vr.totalDistance,
      totalLoad: vr.totalLoad,
      numStops: vr.numStops,
      capacity,
      isOverCapacity: vr.totalLoad > capacity,
    };
  });
}

export function computeFleetTotal(routes: VehicleRoute[]): number {
  return routes.reduce((sum, vr) => sum + vr.totalDistance, 0);
}

// ─────────────────────────────────────────────────────────────────────────
// routeDistanceKm
//
// Straight-line (haversine) distance for a depot-bookended route, used to
// recompute a rider's distance after a manual drag-and-drop reorder — the
// same metric the solvers themselves report as "distance", so a reordered
// route's number stays comparable to the ones the backend returned.
// ─────────────────────────────────────────────────────────────────────────

export function routeDistanceKm(
  route: number[],
  nodeMap: Map<number, Node>,
): number {
  let total = 0;
  for (let i = 1; i < route.length; i++) {
    const a = nodeMap.get(route[i - 1]);
    const b = nodeMap.get(route[i]);
    if (!a || !b) continue;
    total += haversineKm([a.lat, a.lng], [b.lat, b.lng]);
  }
  return total;
}