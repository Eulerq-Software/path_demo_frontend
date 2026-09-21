import type {
  CVRPInstance,
  SolveRequest,
  SolveResponse,
  BackendSolverName,
  SolverConfigIn,
} from "../types/cvrp";

const BASE_URL = import.meta.env.VITE_API_BASE_URL;

const SOLVE_PATH = "/solve";

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

const FAILURE_STATUSES = new Set(["infeasible", "error", "failed", "timeout"]);

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
    response = await fetch(`${BASE_URL}${SOLVE_PATH}`, {
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
      `${SOLVER_LABELS[solver]} returned status "${data.status}".`,
      "SOLVER_ERROR",
      solver,
    );
  }

  return data;
}