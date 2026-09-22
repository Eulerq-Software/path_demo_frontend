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
  route: number[]; 
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


export interface FleetSizingRequest {
  depot: LocationIn;
  customers: CustomerIn[];
  solver: BackendSolverName;
  vehicle_capacity: number;
  max_route_time: number;
  config?: SolverConfigIn;
}

export interface FleetSizingSolveResponse extends SolveResponse {
  num_vehicles: number | null;
  max_route_time: number;
}

export type OptimizationMode = "distance" | "riders";

// ─────────────────────────────────────────────────────────────────────────
// Frontend-internal instance representation
// ─────────────────────────────────────────────────────────────────────────

export interface CVRPInstance {
  depot: LocationIn;
  customers: CustomerIn[];
  vehicles: VehicleIn[];
}

export type CVRPPayloadV1 = CVRPInstance;

export interface FleetSizingInstance {
  depot: LocationIn;
  customers: CustomerIn[];
  vehicleCapacity: number;
  maxRouteTimeSeconds: number;
}

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

export interface GenerateSizingParams {
  numPickups: number;
  pickupLoad: number[];
  vehicleCapacity: number;
  maxRouteTimeSeconds: number;
}