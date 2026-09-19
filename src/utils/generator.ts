import type {
  Node,
  LocationIn,
  CustomerIn,
  VehicleIn,
  CVRPInstance,
  GenerateParams,
  ValidationError,
} from "../types/cvrp";

const BBOX = {
  latMin: 12.384,
  latMax: 13.589,
  lngMin: 76.999,
  lngMax: 78.241,
} as const;

const DEPOT_LAT = 12.9716;
const DEPOT_LNG = 77.5946;
const DEPOT_ID = 0;

export function haversineMetres(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6_371_000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

export function buildDistanceMatrix(nodes: Node[]): number[][] {
  const N = nodes.length;
  return Array.from({ length: N }, (_, i) =>
    Array.from({ length: N }, (_, j) => {
      if (i === j) return 0;
      return haversineMetres(
        nodes[i].lat,
        nodes[i].lng,
        nodes[j].lat,
        nodes[j].lng,
      );
    }),
  );
}

function randBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function riderName(index: number): string {
  return `Rider ${String(index + 1).padStart(3, "0")}`;
}

function customerName(index: number): string {
  return `Pickup P${String(index + 1).padStart(3, "0")}`;
}

// ─────────────────────────────────────────────────────────────────────────
// parseCapacity / parsePickupLoad
//
// Kept the same signatures as before (used by Mode.tsx and, if you have
// one, excelParser.ts) — only the eventual instance shape changed.
// ─────────────────────────────────────────────────────────────────────────

export function parseCapacity(
  raw: string,
  numVehicles: number,
): { value: number | number[]; error: string | null } {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { value: 1, error: "Vehicle capacity is required." };
  }

  const parts = trimmed.split(",").map((s) => s.trim());

  if (parts.length === 1) {
    const v = parseInt(parts[0], 10);
    if (isNaN(v) || v <= 0) {
      return {
        value: 1,
        error: "Vehicle capacity must be a positive integer.",
      };
    }
    return { value: v, error: null };
  }

  if (parts.length !== numVehicles) {
    return {
      value: [],
      error: "vehicle_capacity list length must equal num_vehicles.",
    };
  }

  const parsed = parts.map((p) => parseInt(p, 10));
  if (parsed.some((v) => isNaN(v) || v <= 0)) {
    return {
      value: [],
      error: "All capacity values must be positive integers.",
    };
  }

  return { value: parsed, error: null };
}

export function parsePickupLoad(
  raw: string,
  numPickups: number,
): { value: number[]; error: string | null } {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { value: [], error: "Pickup load is required." };
  }

  const parts = trimmed.split(",").map((s) => s.trim());

  if (parts.length !== numPickups) {
    return {
      value: [],
      error:
        "pickup_load must have exactly num_pickups values (depot 0 is added automatically).",
    };
  }

  const parsed = parts.map((p) => parseInt(p, 10));
  if (parsed.some((v) => isNaN(v) || v < 0)) {
    return {
      value: [],
      error: "All pickup load values must be non-negative integers.",
    };
  }

  return { value: parsed, error: null };
}

// ─────────────────────────────────────────────────────────────────────────
// validateInstance
//
// Same checks as before (fleet present, customers present, capacity vs
// demand feasibility) rewritten against vehicles[]/customers[].
// ─────────────────────────────────────────────────────────────────────────

export function validateInstance(
  vehicles: VehicleIn[],
  customers: CustomerIn[],
): ValidationError[] {
  const errors: ValidationError[] = [];

  if (vehicles.length === 0) {
    errors.push({
      field: "vehicles",
      message: "At least one vehicle is required.",
    });
  }

  if (customers.length === 0) {
    errors.push({ field: "customers", message: "Customers cannot be empty." });
  }

  const totalLoad = customers.reduce((sum, c) => sum + c.demand, 0);
  const totalCap = vehicles.reduce((sum, v) => sum + v.capacity, 0);

  if (vehicles.length > 0 && totalLoad > totalCap) {
    errors.push({
      field: "capacity",
      message:
        "Warning: total load exceeds total fleet capacity — problem is infeasible.",
    });
  }

  const maxDemand = customers.reduce((m, c) => Math.max(m, c.demand), 0);
  const maxCapacity = vehicles.reduce((m, v) => Math.max(m, v.capacity), 0);
  if (customers.length > 0 && vehicles.length > 0 && maxDemand > maxCapacity) {
    errors.push({
      field: "capacity",
      message:
        "Warning: at least one order's weight exceeds every vehicle's capacity — that order can never be assigned.",
    });
  }

  return errors;
}

export interface GenerateResult {
  nodes: Node[];
  instance: CVRPInstance;
  errors: ValidationError[];
}

export function generateInstance(params: GenerateParams): GenerateResult {
  const { numVehicles, numPickups, vehicleCapacity, pickupLoad } = params;

  const vehicles: VehicleIn[] = Array.from({ length: numVehicles }, (_, i) => ({
    id: i + 1,
    capacity: Array.isArray(vehicleCapacity)
      ? (vehicleCapacity[i] ?? 1)
      : vehicleCapacity,
    name: riderName(i),
  }));

  const depot: LocationIn = {
    id: DEPOT_ID,
    lat: DEPOT_LAT,
    lon: DEPOT_LNG,
    name: "Depot",
  };

  const customers: CustomerIn[] = Array.from(
    { length: numPickups },
    (_, i) => ({
      id: i + 1,
      lat: randBetween(BBOX.latMin, BBOX.latMax),
      lon: randBetween(BBOX.lngMin, BBOX.lngMax),
      demand: pickupLoad[i] ?? 0,
      name: customerName(i),
    }),
  );

  const nodes: Node[] = [
    { id: DEPOT_ID, type: "depot", lat: depot.lat, lng: depot.lon, demand: 0 },
    ...customers.map(
      (c): Node => ({
        id: c.id,
        type: "pickup",
        lat: c.lat,
        lng: c.lon,
        demand: c.demand,
      }),
    ),
  ];

  const errors = validateInstance(vehicles, customers);
  const instance: CVRPInstance = { depot, customers, vehicles };

  return { nodes, instance, errors };
}

// ─────────────────────────────────────────────────────────────────────────
// nodesFromCoordinates
//
// Used by the Excel/CSV upload path (excelParser.ts) to turn a table of
// {node_id, lat, lng} rows into a depot + customers[]. Row 0 is always
// treated as the depot, matching the existing upload convention.
//
// NOTE: excelParser.ts wasn't in the files I reviewed — if it calls the
// old `nodesFromCoordinates` (which returned `{ nodes, pickups }`), you'll
// need to update its call site to use `{ nodes, depot, customers }`
// instead. See the integration notes for details.
// ─────────────────────────────────────────────────────────────────────────

export interface CoordinateConversionResult {
  nodes: Node[];
  depot: LocationIn;
  customers: CustomerIn[];
}

export function nodesFromCoordinates(
  rows: { node_id: string; lat: number; lng: number }[],
  pickupLoads: number[],
): CoordinateConversionResult {
  const nodes: Node[] = rows.map((row, i) => ({
    id: i,
    type: i === 0 ? ("depot" as const) : ("pickup" as const),
    lat: row.lat,
    lng: row.lng,
    demand: i === 0 ? 0 : (pickupLoads[i - 1] ?? 0),
  }));

  const depot: LocationIn = {
    id: DEPOT_ID,
    lat: rows[0]?.lat ?? DEPOT_LAT,
    lon: rows[0]?.lng ?? DEPOT_LNG,
    name: "Depot",
  };

  const customers: CustomerIn[] = rows.slice(1).map((row, i) => ({
    id: i + 1,
    lat: row.lat,
    lon: row.lng,
    demand: pickupLoads[i] ?? 0,
    name: customerName(i),
  }));

  return { nodes, depot, customers };
}