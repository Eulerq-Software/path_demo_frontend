// src/utils/api.ts
//
// Talks to the Fixed Fleet CVRP solver API described by api/schemas.py.
// Unlike the old EulerQ client, this backend is synchronous — one POST
// returns the finished SolveResponse directly (solve_time_seconds is
// already populated in the response body), so there's no job/poll loop.

import type {
  CVRPInstance,
  SolveRequest,
  SolveResponse,
  BackendSolverName,
  SolverConfigIn,
} from "../types/cvrp";

// Set VITE_API_BASE_URL in .env / .env.local to point this at wherever
// your backend actually runs. Falls back to local uvicorn's default port
// so `npm run dev` + `uvicorn api.main:app --reload` work out of the box.
const BASE_URL = import.meta.env.VITE_API_BASE_URL;
// TODO: confirm the real route — this assumes the router is mounted at
// the root (`POST /solve`). Adjust if main.py prefixes it, e.g. "/api/solve".
const SOLVE_PATH = "/solve";

// Applied unless the caller overrides individual fields.
const DEFAULT_CONFIG: SolverConfigIn = {
  time_limit_seconds: 20.0,
  seed: 42,
  display: false,
  collect_stats: true,
};

// Display names for the UI — the backend only knows "greedy" / "or_tools" / "pyvrp".
//
// NOTE: api/schemas.py's SolverName enum defines the Google OR-Tools value
// as "or_tools" (underscore). If your deployed API actually expects
// "or-tools" (hyphen), change BackendSolverName in types/cvrp.ts and the
// key below to match — everything else in this file is driven off that type.
export const SOLVER_LABELS: Record<BackendSolverName, string> = {
  greedy: "Greedy",
  or_tools: "Google OR",
  pyvrp: "EulerQ",
};

// SolverResult.status can be several different success strings depending
// on the solver ("feasible", "optimal", "complete", ...) — rather than
// allow-listing every success value (and breaking again the next time a
// solver returns one we didn't anticipate), only reject the statuses that
// actually mean the solve failed.
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

// FastAPI validation errors (422) come back as { detail: [...] } with one
// entry per failing field; anything else as { detail: "message" } or a
// plain { message }. Try each shape before falling back.
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
//
// Runs a single solver against the given instance. Call this once per
// solver — CompareDashboard awaits Google OR and EulerQ sequentially so
// the two backend calls don't race each other on the server.
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