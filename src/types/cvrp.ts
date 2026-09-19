// src/types/cvrp.ts
//
// Types mirror api/schemas.py on the backend 1:1 for the request/response
// shapes (LocationIn, CustomerIn, VehicleIn, SolverConfigIn, SolveRequest,
// RouteResultOut, SolveResponse) so there is no silent drift between the
// two. `CVRPInstance` / `VehicleRoute` / `RouteAssignment` are the
// frontend-internal, solver-agnostic shapes everything else in the app
// works with.

// ─────────────────────────────────────────────────────────────────────────
// Map / display node — unchanged shape, consumed by SolverMap etc.
// id 0 is always the depot; customers are numbered 1..N.
// ─────────────────────────────────────────────────────────────────────────

export interface Node {
  id: number;
  type: "depot" | "pickup";
  lat: number;
  lng: number;
  demand: number;
}
export type CVRPNode = Node;

// ─────────────────────────────────────────────────────────────────────────
// Backend request shapes (api/schemas.py)
// ─────────────────────────────────────────────────────────────────────────

export interface LocationIn {
  id: number;
  lat: number;
  lon: number;
  name?: string;
}

export interface CustomerIn extends LocationIn {
  demand: number;
}

export interface VehicleIn {
  id: number;
  capacity: number;
  name?: string;
}

export interface SolverConfigIn {
  time_limit_seconds?: number;
  seed?: number;
  display?: boolean;
  collect_stats?: boolean;
}

// Matches api.schemas.SolverName. UI-facing labels are mapped separately
// (see SOLVER_LABELS in utils/api.ts) — "Greedy", "Google OR", "EulerQ".
export type BackendSolverName = "greedy" | "or_tools" | "pyvrp";

export interface SolveRequest {
  depot: LocationIn;
  customers: CustomerIn[];
  vehicles: VehicleIn[];
  solver: BackendSolverName;
  config?: SolverConfigIn;
}

// ─────────────────────────────────────────────────────────────────────────
// Backend response shapes
// ─────────────────────────────────────────────────────────────────────────

export interface RouteResultOut {
  vehicle_id: number;
  route: number[]; // customer ids only — depot is NOT included
  distance: number;
  duration: number;
  load: number;
}

export interface SolveResponse {
  status: string;
  routes: RouteResultOut[];
  objective_value: number | null;
  total_distance: number;
  total_duration: number;
  solve_time_seconds: number | null;
  metadata: Record<string, unknown>;
  solver: string;
  instance_summary: Record<string, unknown>;
}

// ─────────────────────────────────────────────────────────────────────────
// Frontend-internal instance representation
// ─────────────────────────────────────────────────────────────────────────

export interface CVRPInstance {
  depot: LocationIn;
  customers: CustomerIn[];
  vehicles: VehicleIn[];
}

// Kept as an alias so any lingering `CVRPPayloadV1` imports don't hard-fail
// while you migrate — safe to delete once nothing references it.
export type CVRPPayloadV1 = CVRPInstance;

// ─────────────────────────────────────────────────────────────────────────
// Frontend-internal, solver-agnostic route representation.
// `route` is always depot-bookended: [0, ...customerIds, 0], regardless of
// whether it came from the local greedy solver or the backend (which
// returns customer-only ids and gets bookended in resultParser.ts).
// ─────────────────────────────────────────────────────────────────────────

export interface VehicleRoute {
  vehicleId: number;
  route: number[];
  totalDistance: number;
  totalLoad: number;
  legDistances: number[];
  numStops: number;
}

export interface RouteAssignment {
  vehicleId: number;
  route: number[];
  totalDistance: number;
  totalLoad: number;
  numStops: number;
  capacity: number;
  isOverCapacity: boolean;
}

export interface ExcelParseResult {
  nodes: Node[];
  instance: CVRPInstance;
  errors: ValidationError[];
}

export type SolverKey = "greedy" | "or_tools" | "eulerq";
export type InputMode = "generate" | "upload";
export type BaselineName = "greedy" | "or_tools";

export interface SolveMetrics {
  baselineSolverName: BaselineName;
  baselineObjective: number;
  baselineTime: number;
  greedyTime: number;
  orToolsTime: number;
  eulerQObjective: number;
  eulerQTime: number;
  improvementPercent: number;
}

export interface ValidationError {
  field: string;
  message: string;
}

export interface GenerateParams {
  numVehicles: number;
  numPickups: number;
  vehicleCapacity: number | number[];
  pickupLoad: number[];
}