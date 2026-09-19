// src/utils/resultParser.ts
//
// Converts a SolveResponse's routes (backend shape, customer-only ids)
// into the frontend-internal VehicleRoute[] shape (depot-bookended ids),
// so downstream code — SolverMap, SolverCard, routeHelpers — never has to
// special-case "did this come from the backend or the local solver".

import type { RouteResultOut, VehicleRoute } from "../types/cvrp";

const DEPOT_ID = 0;

export function parseSolveRoutes(routes: RouteResultOut[]): VehicleRoute[] {
  return routes.map(
    (r): VehicleRoute => ({
      vehicleId: r.vehicle_id,
      route: [DEPOT_ID, ...r.route, DEPOT_ID],
      totalDistance: r.distance,
      totalLoad: r.load,
      legDistances: [],
      numStops: r.route.length,
    }),
  );
}