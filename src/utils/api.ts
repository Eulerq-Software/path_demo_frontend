import type {
  CVRPInstance,
  SolveRequest,
  SolveResponse,
  FleetSizingInstance,
  FleetSizingRequest,
  FleetSizingSolveResponse,
  BackendSolverName,
  SolverConfigIn,
} from "../types/cvrp";

const BASE_URL = import.meta.env.VITE_API_BASE_URL;

// Backend split the old single POST /solve into two endpoints:
//   /solve/fixed  - explicit vehicle list (Route Optimization mode)
//   /solve/sizing - homogeneous fleet + vehicle_capacity/max_route_time
//                   (Minimum Riders mode — solver decides fleet size)
const SOLVE_FIXED_PATH = "/solve/fixed";
const SOLVE_SIZING_PATH = "/solve/sizing";

const DEFAULT_CONFIG: SolverConfigIn = {
  time_limit_seconds: 20.0,
  seed: 42,
  display: false,
  collect_stats: true,
};

export const SOLVER_LABELS: Record<BackendSolverName, string> = {
  greedy: "Greedy",
  or_tools: "Google OR",
  pyvrp: "EulerQ",
};

const FAILURE_STATUSES = new Set([
  "infeasible",
  "incomplete",
  "error",
  "failed",
  "timeout",
]);

// Plain-English detail per failure status, so "incomplete" (some orders
// couldn't be assigned) reads differently from "infeasible" (no solution
// exists at all) instead of both showing the same raw status string.
const FAILURE_STATUS_DETAIL: Partial<Record<string, string>> = {
  infeasible: "found no feasible solution for this instance.",
  incomplete: "could not assign all orders within the given constraints.",
  error: "hit an internal error while solving.",
  failed: "failed to solve this instance.",
  timeout: "timed out before finishing.",
};

function describeSolverFailure(
  solver: BackendSolverName,
  status: string,
): string {
  const detail = FAILURE_STATUS_DETAIL[status];
  return detail
    ? `${SOLVER_LABELS[solver]} ${detail}`
    : `${SOLVER_LABELS[solver]} returned status "${status}".`;
}

export class SolveApiError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "REQUEST_FAILED"
      | "HTTP_ERROR"
      | "PARSE_ERROR"
      | "SOLVER_ERROR",
    public readonly solver?: BackendSolverName,
  ) {
    super(message);
    this.name = "SolveApiError";
  }
}

function buildHeaders(): HeadersInit {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  return headers;
}

function buildRequestBody(
  instance: CVRPInstance,
  solver: BackendSolverName,
  config?: Partial<SolverConfigIn>,
): SolveRequest {
  return {
    depot: instance.depot,
    customers: instance.customers,
    vehicles: instance.vehicles,
    solver,
    config: { ...DEFAULT_CONFIG, ...config },
  };
}

function buildSizingRequestBody(
  instance: FleetSizingInstance,
  solver: BackendSolverName,
  config?: Partial<SolverConfigIn>,
): FleetSizingRequest {
  return {
    depot: instance.depot,
    customers: instance.customers,
    solver,
    vehicle_capacity: instance.vehicleCapacity,
    max_route_time: instance.maxRouteTimeSeconds,
    config: { ...DEFAULT_CONFIG, ...config },
  };
}

async function extractErrorMessage(
  response: Response,
  fallback: string,
): Promise<string> {
  try {
    const json = await response.json();
    if (Array.isArray(json?.detail)) {
      return json.detail
        .map((d: { loc?: (string | number)[]; msg?: string }) =>
          d?.loc ? `${d.loc.join(".")}: ${d.msg}` : d?.msg,
        )
        .filter(Boolean)
        .join("; ") || fallback;
    }
    if (typeof json?.detail === "string") return json.detail;
    if (typeof json?.message === "string") return json.message;
    return response.statusText || fallback;
  } catch {
    try {
      const text = await response.text();
      return text.trim() || fallback;
    } catch {
      return fallback;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────
// solveCVRP
// ─────────────────────────────────────────────────────────────────────────

export async function solveCVRP(
  instance: CVRPInstance,
  solver: BackendSolverName,
  config?: Partial<SolverConfigIn>,
): Promise<SolveResponse> {
  const body = buildRequestBody(instance, solver, config);

  let response: Response;
  try {
    console.log("Sending request to solver:", solver, "with body:", body);
    response = await fetch(`${BASE_URL}${SOLVE_FIXED_PATH}`, {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify(body),
    });
  } catch {
    throw new SolveApiError(
      `Network error — could not reach the ${SOLVER_LABELS[solver]} solver.`,
      "REQUEST_FAILED",
      solver,
    );
  }

  if (!response.ok) {
    const message = await extractErrorMessage(
      response,
      `${SOLVER_LABELS[solver]} request failed (${response.status}).`,
    );
    throw new SolveApiError(message, "HTTP_ERROR", solver);
  }

  let data: SolveResponse;
  try {
    data = await response.json();
  } catch {
    throw new SolveApiError(
      `Unexpected response from the ${SOLVER_LABELS[solver]} solver.`,
      "PARSE_ERROR",
      solver,
    );
  }

  if (FAILURE_STATUSES.has(data.status)) {
    throw new SolveApiError(
      describeSolverFailure(solver, data.status),
      "SOLVER_ERROR",
      solver,
    );
  }

  return data;
}

// ─────────────────────────────────────────────────────────────────────────
// solveCVRPSizing — POST /solve/sizing, for "Minimum Riders" mode.
// ─────────────────────────────────────────────────────────────────────────

export async function solveCVRPSizing(
  instance: FleetSizingInstance,
  solver: BackendSolverName,
  config?: Partial<SolverConfigIn>,
): Promise<FleetSizingSolveResponse> {
  const body = buildSizingRequestBody(instance, solver, config);

  let response: Response;
  try {
    console.log("Sending request to solver:", solver, "with body:", body);
    response = await fetch(`${BASE_URL}${SOLVE_SIZING_PATH}`, {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify(body),
    });
  } catch {
    throw new SolveApiError(
      `Network error — could not reach the ${SOLVER_LABELS[solver]} solver.`,
      "REQUEST_FAILED",
      solver,
    );
  }

  if (!response.ok) {
    const message = await extractErrorMessage(
      response,
      `${SOLVER_LABELS[solver]} request failed (${response.status}).`,
    );
    throw new SolveApiError(message, "HTTP_ERROR", solver);
  }

  let data: FleetSizingSolveResponse;
  try {
    data = await response.json();
  } catch {
    throw new SolveApiError(
      `Unexpected response from the ${SOLVER_LABELS[solver]} solver.`,
      "PARSE_ERROR",
      solver,
    );
  }

  if (FAILURE_STATUSES.has(data.status)) {
    throw new SolveApiError(
      describeSolverFailure(solver, data.status),
      "SOLVER_ERROR",
      solver,
    );
  }

  return data;
}