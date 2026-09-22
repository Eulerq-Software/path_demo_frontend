import { useState, useEffect, useCallback, useRef } from "react";
import { Toaster, toast } from "react-hot-toast";
import { RiErrorWarningLine, RiLoader4Line } from "react-icons/ri";
import Topbar from "../components/Topbar";
import AboutModal from "../components/AboutModal";
import SolverMap from "../components/SolverMap";
import Mode from "../components/Mode";
import RouteDetailsPanel from "../components/RouteDetailsPanel";
import { useComparisonStore } from "../state/useComparisonStore";
import { useRoadRoutes, type RoadRoutesState } from "../hooks/useRoadRoutes";
import { generateInstance, generateFleetSizingInstance } from "../utils/generator";
import { solveCVRP, solveCVRPSizing, SolveApiError, SOLVER_LABELS } from "../utils/api";
import { parseSolveRoutes } from "../utils/resultParser";
import { buildRouteAssignments, routeDistanceKm } from "../utils/routeHelpers";
import type {
  VehicleRoute,
  RouteAssignment,
  ExcelParseResult,
  GenerateParams,
  GenerateSizingParams,
  CVRPInstance,
  BackendSolverName,
  SolveResponse,
  FleetSizingSolveResponse,
} from "../types/cvrp";
import "./CompareDashboard.css";

const T = {
  base: {
    background: "#020D24",
    color: "#F8FAFC",
    border: "1px solid #1E293B",
  },
  success: {
    background: "#020D24",
    color: "#F8FAFC",
    border: "1px solid #10E0A1",
    boxShadow: "0 0 20px rgba(16,224,161,0.2)",
  },
  error: {
    background: "#020D24",
    color: "#F8FAFC",
    border: "1px solid #EF4444",
    boxShadow: "0 0 20px rgba(239,68,68,0.15)",
  },
  warn: {
    background: "#020D24",
    color: "#F8FAFC",
    border: "1px solid #F59E0B",
    boxShadow: "0 0 20px rgba(245,158,11,0.12)",
  },
};

// Distinct icon colors per toast type so success/error/warn read clearly
// at a glance even before the message text registers.
const TOAST_ICON_THEME = {
  success: { primary: "#10E0A1", secondary: "#020D24" },
  error: { primary: "#EF4444", secondary: "#020D24" },
};

function notifySuccess(message: string, opts?: { duration?: number }) {
  toast.success(message, {
    style: T.success,
    iconTheme: TOAST_ICON_THEME.success,
    ...opts,
  });
}

function notifyError(message: string, opts?: { duration?: number }) {
  toast.error(message, {
    style: T.error,
    iconTheme: TOAST_ICON_THEME.error,
    ...opts,
  });
}

function notifyWarn(message: string, opts?: { duration?: number }) {
  toast(message, { style: T.warn, icon: "⚠️", ...opts });
}

// Per-solver progress, driving each result card's body (skeleton while
// pending, real stats once done, error state on failure).
export type SolverRunStatus = "pending" | "done" | "error";

// The backend only knows these three solvers — always run together so the
// comparison is apples-to-apples.
const SOLVER_ORDER: BackendSolverName[] = ["greedy", "or_tools", "pyvrp"];

const DOT_CLASS: Record<BackendSolverName, string> = {
  greedy: "result-dot--orange",
  or_tools: "result-dot--blue",
  pyvrp: "result-dot--teal",
};

const ACTIVE_CARD_CLASS: Record<BackendSolverName, string> = {
  greedy: "result-card--active-orange",
  or_tools: "result-card--active-blue",
  pyvrp: "result-card--active-teal",
};

function initialSolverStatus(): Record<BackendSolverName, SolverRunStatus> {
  return SOLVER_ORDER.reduce(
    (acc, name) => {
      acc[name] = "pending";
      return acc;
    },
    {} as Record<BackendSolverName, SolverRunStatus>,
  );
}

function countUsedVehicles(routes: VehicleRoute[]): number {
  return routes.filter((vr) => vr.numStops > 0).length;
}

function countStops(routes: VehicleRoute[]): number {
  return routes.reduce((s, vr) => s + vr.numStops, 0);
}

// Stand-in for a solver with no routes yet — same shape useRoadRoutes
// returns, so callers never have to special-case "no active solver".
const EMPTY_ROAD_ROUTING: RoadRoutesState = {
  byVehicle: {},
  phase: "idle",
  resolved: 0,
  total: 0,
  fallbackCount: 0,
  errorMessage: null,
  retry: () => {},
};

// The comparison is about real driving distance, not the solver's own
// straight-line objective — so "Total Distance" everywhere in the results
// section is the summed on-road figure, only once every vehicle for that
// solver has actually been snapped (a partial sum would understate it and
// read as a real number instead of "still loading").
function roadTotalKm(routing: RoadRoutesState): number | null {
  if (routing.phase !== "ready" && routing.phase !== "degraded") return null;
  const entries = Object.values(routing.byVehicle);
  if (entries.length === 0) return null;
  return entries.reduce((sum, e) => sum + e.distanceKm, 0);
}

export default function CompareDashboard() {
  const {
    nodes,
    instance,
    optimizationMode,
    sizingInstance,
    greedyRoutes,
    greedyAssignments,
    orToolsRoutes,
    orToolsAssignments,
    eulerqRoutes,
    eulerqAssignments,
    setInstance,
    setSizingInstance,
    setNodes,
    setGreedyRoutes,
    setGreedyAssignments,
    setOrToolsRoutes,
    setOrToolsAssignments,
    setEulerqRoutes,
    setEulerqAssignments,
    setMetrics,
    setSolveError,
    resetAll,
  } = useComparisonStore();

  // Raw solve responses (status/objective/timing), kept locally alongside
  // the parsed routes/assignments that live in the shared store.
  const [responses, setResponses] = useState<
    Partial<Record<BackendSolverName, SolveResponse>>
  >({});

  const [showAbout, setShowAbout] = useState(false);
  const [showSmallScreen, setShowSmallScreen] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  // True the instant "Optimize" is clicked — the results view (map +
  // per-solver cards) opens immediately and stays open through the whole
  // run, with each card carrying its own pending/done/error state instead
  // of the run being gated behind a single blocking overlay.
  const [resultsViewActive, setResultsViewActive] = useState(false);
  const [activeMapSolver, setActiveMapSolver] =
    useState<BackendSolverName | null>(null);
  const [activeMapVehicle, setActiveMapVehicle] = useState<number | null>(
    null,
  );
  const [solverStatus, setSolverStatus] = useState<
    Record<BackendSolverName, SolverRunStatus>
  >(initialSolverStatus());
  const [solverErrors, setSolverErrors] = useState<
    Partial<Record<BackendSolverName, string>>
  >({});

  // Snapshot of each solver's routes/assignments taken the moment it
  // finishes — never touched again afterward, even by a drag-and-drop
  // reorder. The Route Details panel reads from these (not the live store
  // fields above) so its own numbers always stay exactly what the solver
  // reported; only the map and the comparison cards below reflect a
  // reorder's live, recalculated distance.
  const [originalRoutes, setOriginalRoutes] = useState<
    Partial<Record<BackendSolverName, VehicleRoute[]>>
  >({});
  const [originalAssignments, setOriginalAssignments] = useState<
    Partial<Record<BackendSolverName, RouteAssignment[]>>
  >({});

  // Whether the map should keep auto-following solver completions this run
  // (first finisher, then the eventual best) — a manual "View Routes on
  // Map" click during the run turns this off so we don't yank the map away
  // from whatever the user chose to look at.
  const autoFollowRef = useRef(true);
  // Whether any solver has finished yet this run — only the *first* one to
  // land should pull the map/panel away from the empty "waiting" state.
  const firstFinishRef = useRef(false);

  const hasGenerated =
    optimizationMode === "riders" ? sizingInstance !== null : instance !== null;

  useEffect(() => {
    const check = () => setShowSmallScreen(window.innerWidth < 1024);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  const routesBySolver: Record<BackendSolverName, VehicleRoute[] | null> = {
    greedy: greedyRoutes,
    or_tools: orToolsRoutes,
    pyvrp: eulerqRoutes,
  };
  const assignmentsBySolver: Record<
    BackendSolverName,
    RouteAssignment[] | null
  > = {
    greedy: greedyAssignments,
    or_tools: orToolsAssignments,
    pyvrp: eulerqAssignments,
  };

  // ─────────────────────────────────────────────────────────────
  // Generate handler
  // ─────────────────────────────────────────────────────────────

  const handleGenerate = useCallback(
    (params: GenerateParams) => {
      const result = generateInstance(params);
      const blockingErrors = result.errors.filter(
        (e) => !e.message.startsWith("Warning"),
      );

      if (blockingErrors.length > 0) {
        blockingErrors.forEach((e) => notifyError(e.message));
        return;
      }

      result.errors
        .filter((e) => e.message.startsWith("Warning"))
        .forEach((e) => notifyWarn(e.message));

      resetAll();
      setResponses({});
      setOriginalRoutes({});
      setOriginalAssignments({});
      setResultsViewActive(false);
      setActiveMapVehicle(null);
      setActiveMapSolver(null);

      setNodes(result.nodes);
      setInstance(result.instance);

      notifySuccess(
        `Generated ${result.instance.customers.length} order(s) across Bengaluru.`,
      );
    },
    [setInstance, setNodes, resetAll],
  );

  const handleGenerateSizing = useCallback(
    (params: GenerateSizingParams) => {
      const result = generateFleetSizingInstance(params);
      const blockingErrors = result.errors.filter(
        (e) => !e.message.startsWith("Warning"),
      );

      if (blockingErrors.length > 0) {
        blockingErrors.forEach((e) => notifyError(e.message));
        return;
      }

      result.errors
        .filter((e) => e.message.startsWith("Warning"))
        .forEach((e) => notifyWarn(e.message));

      resetAll();
      setResponses({});
      setOriginalRoutes({});
      setOriginalAssignments({});
      setResultsViewActive(false);
      setActiveMapVehicle(null);
      setActiveMapSolver(null);

      setNodes(result.nodes);
      setSizingInstance(result.instance);

      notifySuccess(
        `Generated ${result.instance.customers.length} order(s) — solver will size the fleet.`,
      );
    },
    [setSizingInstance, setNodes, resetAll],
  );

  // ─────────────────────────────────────────────────────────────
  // Upload handler
  // ─────────────────────────────────────────────────────────────

  const handleUploadParsed = useCallback(
    (result: ExcelParseResult) => {
      const blockingErrors = result.errors.filter(
        (e) => !e.message.startsWith("Warning"),
      );

      if (blockingErrors.length > 0) {
        blockingErrors.forEach((e) => notifyError(e.message));
        return;
      }

      result.errors
        .filter((e) => e.message.startsWith("Warning"))
        .forEach((e) => notifyWarn(e.message));

      resetAll();
      setResponses({});
      setOriginalRoutes({});
      setOriginalAssignments({});
      setResultsViewActive(false);
      setActiveMapVehicle(null);
      setActiveMapSolver(null);

      setNodes(result.nodes);
      setInstance(result.instance);

      notifySuccess(
        `Loaded ${result.instance.customers.length} pickup location(s) from file.`,
      );
    },
    [setInstance, setNodes, resetAll],
  );

  // ─────────────────────────────────────────────────────────────
  // Run Comparison handler
  // ─────────────────────────────────────────────────────────────

  const handleRunComparison = useCallback(async () => {
    const state = useComparisonStore.getState();
    const mode = state.optimizationMode;
    const currentInstance = state.instance;
    const currentSizingInstance = state.sizingInstance;
    const currentBaseline = state.baselineSolver;

    if (mode === "riders" ? !currentSizingInstance : !currentInstance) {
      notifyError("Generate or upload data first.");
      return;
    }

    // Fresh run: clear out whatever a previous comparison left behind so
    // every card starts this run from a clean "pending" state instead of
    // briefly showing last run's numbers.
    setGreedyRoutes(null);
    setGreedyAssignments(null);
    setOrToolsRoutes(null);
    setOrToolsAssignments(null);
    setEulerqRoutes(null);
    setEulerqAssignments(null);
    setMetrics(null);
    setResponses({});
    setSolverErrors({});
    setSolveError(null);
    setOriginalRoutes({});
    setOriginalAssignments({});
    setSolverStatus(initialSolverStatus());
    setActiveMapVehicle(null);
    setActiveMapSolver(null);
    setResultsViewActive(true);
    setIsRunning(true);

    autoFollowRef.current = true;
    firstFinishRef.current = false;

    function describeError(err: unknown): string {
      if (err instanceof SolveApiError) return err.message;
      return err instanceof Error ? err.message : "Unknown solver error.";
    }

    // In fixed-fleet mode every solver shares the same vehicle list, so
    // assignments can be built against currentInstance directly. In sizing
    // mode each solver picks its own fleet size, so there's no fixed
    // vehicles[] to hand buildRouteAssignments — this reconstructs one
    // per response, using the vehicle ids the solver actually returned and
    // the single homogeneous capacity the request was built with.
    function assignmentInstanceFor(
      solver: BackendSolverName,
      response: SolveResponse,
    ): CVRPInstance {
      if (mode !== "riders") return currentInstance as CVRPInstance;

      const sizing = currentSizingInstance!;
      const vehicleIds = Array.from(
        new Set(response.routes.map((r) => r.vehicle_id)),
      );
      return {
        depot: sizing.depot,
        customers: sizing.customers,
        vehicles: vehicleIds.map((id) => ({
          id,
          capacity: sizing.vehicleCapacity,
        })),
      };
    }

    try {
      // Same instance, sent to all three solvers in parallel — one solve
      // call per solver, fired together via the same array of promises.
      // Promise.allSettled (rather than Promise.all) only changes how we
      // react to the results afterward: a single solver failing no longer
      // discards the other two, which may have already succeeded. Each
      // solver also updates its own store/response/status the moment *it*
      // resolves, rather than waiting for the whole batch — that's what
      // lets the fastest solver's card (usually Greedy) pop in and take
      // over the map while the other two are still spinning.
      const settled = await Promise.allSettled(
        SOLVER_ORDER.map((solver) => {
          const solvePromise: Promise<SolveResponse | FleetSizingSolveResponse> =
            mode === "riders"
              ? solveCVRPSizing(currentSizingInstance!, solver)
              : solveCVRP(currentInstance!, solver);

          return solvePromise
            .then((response) => {
              const routes = parseSolveRoutes(response.routes);
              const assignments = buildRouteAssignments(
                routes,
                assignmentInstanceFor(solver, response),
              );

              if (solver === "greedy") {
                setGreedyRoutes(routes);
                setGreedyAssignments(assignments);
              } else if (solver === "or_tools") {
                setOrToolsRoutes(routes);
                setOrToolsAssignments(assignments);
              } else {
                setEulerqRoutes(routes);
                setEulerqAssignments(assignments);
              }

              // Frozen snapshot, captured once and never touched again —
              // this is what the Route Details panel reads from, so a
              // later drag-and-drop reorder (which mutates the live store
              // fields above) can't change what it displays.
              setOriginalRoutes((prev) => ({ ...prev, [solver]: routes }));
              setOriginalAssignments((prev) => ({
                ...prev,
                [solver]: assignments,
              }));

              setResponses((prev) => ({ ...prev, [solver]: response }));
              setSolverStatus((s) => ({ ...s, [solver]: "done" }));

              // Only the very first solver to land pulls the map/panel away
              // from the empty "waiting" state — later finishers just
              // update their own card. Skipped entirely if the user has
              // already picked a card to look at by hand.
              if (!firstFinishRef.current) {
                firstFinishRef.current = true;
                if (autoFollowRef.current) setActiveMapSolver(solver);
              }

              return response;
            })
            .catch((err) => {
              const message = describeError(err);
              setSolverStatus((s) => ({ ...s, [solver]: "error" }));
              setSolverErrors((prev) => ({ ...prev, [solver]: message }));
              console.error(`[RunComparison] ${solver} failed`, err);
              throw err;
            });
        }),
      );

      // Everything has already landed on its own card as it finished; this
      // final pass is only for the batch-level pieces that need all three
      // solvers in hand at once — metrics, picking the overall best, and
      // the completion toast.
      const nextResponses: Partial<Record<BackendSolverName, SolveResponse>> =
        {};
      const nextErrors: Partial<Record<BackendSolverName, string>> = {};
      let successCount = 0;

      settled.forEach((outcome, i) => {
        const solver = SOLVER_ORDER[i];
        if (outcome.status === "fulfilled") {
          nextResponses[solver] = outcome.value;
          successCount++;
        } else {
          nextErrors[solver] = describeError(outcome.reason);
        }
      });

      // Metrics compare EulerQ (pyvrp) against whichever baseline the user
      // picked — only meaningful once both of those two actually succeeded.
      const baselineResponse = nextResponses[currentBaseline];
      const eulerqResponse = nextResponses.pyvrp;
      if (baselineResponse && eulerqResponse) {
        const baselineObjective = baselineResponse.total_distance;
        const eulerQObjective = eulerqResponse.total_distance;
        const improvementPercent =
          baselineObjective > 0
            ? ((baselineObjective - eulerQObjective) / baselineObjective) * 100
            : 0;
        setMetrics({
          baselineSolverName: currentBaseline,
          baselineObjective,
          baselineTime: baselineResponse.solve_time_seconds ?? 0,
          greedyTime: nextResponses.greedy?.solve_time_seconds ?? 0,
          orToolsTime: nextResponses.or_tools?.solve_time_seconds ?? 0,
          eulerQObjective,
          eulerQTime: eulerqResponse.solve_time_seconds ?? 0,
          improvementPercent,
        });
      }

      // Now that all three have settled, hand the map to whichever solver
      // actually won — replacing whatever the first-finisher auto-switch
      // put there, unless the user has since picked a card themselves.
      const bestEntry = SOLVER_ORDER.reduce<{
        key: BackendSolverName;
        distance: number;
      } | null>((best, solver) => {
        const response = nextResponses[solver];
        if (!response) return best;
        if (!best || response.total_distance < best.distance) {
          return { key: solver, distance: response.total_distance };
        }
        return best;
      }, null);

      if (bestEntry && autoFollowRef.current) {
        setActiveMapSolver(bestEntry.key);
        setActiveMapVehicle(null);
      }

      if (successCount === SOLVER_ORDER.length) {
        notifySuccess("Comparison complete!");
      } else if (successCount > 0) {
        setSolveError(
          `${SOLVER_ORDER.length - successCount} of ${SOLVER_ORDER.length} solvers failed.`,
        );
        notifyWarn(
          `${successCount}/${SOLVER_ORDER.length} solvers completed — see the failed card for details.`,
          { duration: 6000 },
        );
      } else {
        const firstError = Object.values(nextErrors)[0] ?? "Unknown error.";
        setSolveError(firstError);
        notifyError(firstError, { duration: 7000 });
      }
    } catch (err) {
      // Defensive fallback only — individual solver failures are now
      // caught per-promise above via allSettled, so this only fires for
      // something unexpected outside that loop.
      console.error("[RunComparison] unexpected failure", err);
      const msg = describeError(err);
      setSolveError(msg);
      notifyError(msg, { duration: 5000 });
    } finally {
      setIsRunning(false);
    }
  }, [
    setSolveError,
    setGreedyRoutes,
    setGreedyAssignments,
    setOrToolsRoutes,
    setOrToolsAssignments,
    setEulerqRoutes,
    setEulerqAssignments,
    setMetrics,
  ]);

  // ─────────────────────────────────────────────────────────────
  // View Routes on Map handler
  // ─────────────────────────────────────────────────────────────

  const handleViewRoutes = useCallback((solver: BackendSolverName) => {
    // A manual pick sticks for the rest of this run — later auto-switches
    // (next finisher, eventual best) no longer override what the user
    // chose to look at.
    autoFollowRef.current = false;
    setActiveMapSolver(solver);
    setActiveMapVehicle(null);
  }, []);

  // ─────────────────────────────────────────────────────────────
  // Reorder handler — drag-and-drop stop reordering from RouteDetailsPanel.
  //
  // Recomputes the rider's distance from the new stop order (same
  // straight-line metric the solvers themselves report), pushes it into the
  // active solver's routes/assignments, and refreshes that solver's total so
  // the panel header, the map (via useRoadRoutes re-snapping the changed
  // route) and the result cards below all stay in sync.
  // ─────────────────────────────────────────────────────────────

  const handleReorderStops = useCallback(
    (vehicleId: number, newRoute: number[]) => {
      const solver = activeMapSolver;
      // Can't reorder a route the map isn't currently showing — the panel
      // only renders draggable stops for a solver that already has data,
      // so this is just a type-narrowing guard in practice.
      if (!solver) return;
      const nodeMap = new Map(nodes.map((n) => [n.id, n]));
      const newDistance = routeDistanceKm(newRoute, nodeMap);

      const applyRoutes = (routes: VehicleRoute[] | null) =>
        routes
          ? routes.map((r) =>
              r.vehicleId === vehicleId
                ? { ...r, route: newRoute, totalDistance: newDistance }
                : r,
            )
          : routes;

      const applyAssignments = (assignments: RouteAssignment[] | null) =>
        assignments
          ? assignments.map((a) =>
              a.vehicleId === vehicleId
                ? { ...a, route: newRoute, totalDistance: newDistance }
                : a,
            )
          : assignments;

      const routesForSolver =
        solver === "greedy"
          ? greedyRoutes
          : solver === "or_tools"
            ? orToolsRoutes
            : eulerqRoutes;

      if (solver === "greedy") {
        setGreedyRoutes(applyRoutes(greedyRoutes));
        setGreedyAssignments(applyAssignments(greedyAssignments));
      } else if (solver === "or_tools") {
        setOrToolsRoutes(applyRoutes(orToolsRoutes));
        setOrToolsAssignments(applyAssignments(orToolsAssignments));
      } else {
        setEulerqRoutes(applyRoutes(eulerqRoutes));
        setEulerqAssignments(applyAssignments(eulerqAssignments));
      }

      setResponses((prev) => {
        const prevResponse = prev[solver];
        if (!prevResponse) return prev;
        const totalDistance = (routesForSolver ?? []).reduce(
          (sum, r) =>
            sum + (r.vehicleId === vehicleId ? newDistance : r.totalDistance),
          0,
        );
        return {
          ...prev,
          [solver]: { ...prevResponse, total_distance: totalDistance },
        };
      });
    },
    [
      activeMapSolver,
      nodes,
      greedyRoutes,
      greedyAssignments,
      orToolsRoutes,
      orToolsAssignments,
      eulerqRoutes,
      eulerqAssignments,
      setGreedyRoutes,
      setGreedyAssignments,
      setOrToolsRoutes,
      setOrToolsAssignments,
      setEulerqRoutes,
      setEulerqAssignments,
    ],
  );

  // ─────────────────────────────────────────────────────────────
  // Reset handler
  // ─────────────────────────────────────────────────────────────

  const handleReset = useCallback(() => {
    resetAll();
    setResponses({});
    setOriginalRoutes({});
    setOriginalAssignments({});
    setIsRunning(false);
    setResultsViewActive(false);
    setActiveMapVehicle(null);
    setActiveMapSolver(null);
    setSolverStatus(initialSolverStatus());
    setSolverErrors({});
  }, [resetAll]);

  const activeMapRoutes = activeMapSolver
    ? (routesBySolver[activeMapSolver] ?? [])
    : [];

  const activeMapPalette = activeMapSolver === "pyvrp" ? "cool" : "warm";

  // ─────────────────────────────────────────────────────────────
  // On-road geometry — live, so this is what redraws (and recalculates)
  // when a rider's stops get dragged around.
  //
  // One hook per solver, always running once that solver has routes,
  // rather than only for whichever one the map is currently showing: the
  // result cards below show every solver's *road* distance side by side,
  // not just the active one's, so all three need to be snapped regardless
  // of which is on screen. Not gated on `resultsViewActive` either —
  // routing starts the moment a solver's route lands, so the roads are
  // usually already snapped by the time the whole comparison finishes.
  // ─────────────────────────────────────────────────────────────
  const greedyRoadRouting = useRoadRoutes(routesBySolver.greedy ?? [], nodes);
  const orToolsRoadRouting = useRoadRoutes(
    routesBySolver.or_tools ?? [],
    nodes,
  );
  const eulerqRoadRouting = useRoadRoutes(routesBySolver.pyvrp ?? [], nodes);

  const roadRoutingBySolver: Record<BackendSolverName, RoadRoutesState> = {
    greedy: greedyRoadRouting,
    or_tools: orToolsRoadRouting,
    pyvrp: eulerqRoadRouting,
  };

  // The map only ever shows one solver at a time — pull its road geometry
  // out of the per-solver hooks above rather than fetching it separately.
  const roadRouting = activeMapSolver
    ? roadRoutingBySolver[activeMapSolver]
    : EMPTY_ROAD_ROUTING;

  // ─────────────────────────────────────────────────────────────
  // Route Details panel data — built from the *frozen* snapshot
  // (originalRoutes/originalAssignments), routed independently of the
  // map's live geometry above, so a drag-and-drop reorder never changes
  // any number the panel displays. The one exception is the stop sequence
  // itself: merging in the live route order lets the drag interaction
  // still feel responsive (the boxes actually move) while every stat next
  // to them stays pinned to what the solver originally reported.
  // ─────────────────────────────────────────────────────────────
  const originalMapRoutes = activeMapSolver
    ? (originalRoutes[activeMapSolver] ?? [])
    : [];
  const frozenRoadRouting = useRoadRoutes(originalMapRoutes, nodes);

  const liveAssignmentsForActiveSolver = activeMapSolver
    ? (assignmentsBySolver[activeMapSolver] ?? [])
    : [];
  const panelAssignments = activeMapSolver
    ? (originalAssignments[activeMapSolver] ?? []).map((original) => {
        const live = liveAssignmentsForActiveSolver.find(
          (a) => a.vehicleId === original.vehicleId,
        );
        return live ? { ...original, route: live.route } : original;
      })
    : [];

  const totalOrders = instance?.customers.length ?? 0;

  const solverSummaries = SOLVER_ORDER.map((name) => ({
    key: name,
    label: SOLVER_LABELS[name],
    dotClass: DOT_CLASS[name],
    response: responses[name] ?? null,
    routes: routesBySolver[name] ?? [],
    roadKm: roadTotalKm(roadRoutingBySolver[name]),
  }));

  // "Available" now means the solver has both solved *and* had every one of
  // its vehicles snapped to real roads — the figure the comparison actually
  // cares about (on-road distance) doesn't exist before that.
  const availableResults = solverSummaries.filter(
    (s): s is typeof s & { response: SolveResponse; roadKm: number } =>
      s.response !== null && s.roadKm !== null,
  );

  // "Best" is only meaningful — and only shown — once every solver has
  // solved *and* finished road-snapping. Computing it off partial results
  // would flicker the BEST badge from card to card as each one lands,
  // which reads as broken rather than "in progress".
  const allSolversSettled = SOLVER_ORDER.every(
    (n) => solverStatus[n] !== "pending",
  );
  const allRoadReady = SOLVER_ORDER.every(
    (n) => roadTotalKm(roadRoutingBySolver[n]) !== null,
  );

  const bestSolver =
    allSolversSettled && allRoadReady && availableResults.length > 0
      ? availableResults.reduce((best, cur) =>
          cur.roadKm < best.roadKm ? cur : best,
        )
      : null;

  const worstSolver =
    allSolversSettled && allRoadReady && availableResults.length > 0
      ? availableResults.reduce((worst, cur) =>
          cur.roadKm > worst.roadKm ? cur : worst,
        )
      : null;

  const spreadPercent =
    bestSolver && worstSolver
      ? (() => {
          const bestVal = bestSolver.roadKm;
          const worstVal = worstSolver.roadKm;
          return worstVal > 0 ? ((worstVal - bestVal) / worstVal) * 100 : 0;
        })()
      : 0;

  return (
    <>
      <Toaster position="top-right" toastOptions={{ style: T.base }} />

      {showAbout && <AboutModal onClose={() => setShowAbout(false)} />}

      {/* ── Small-screen warning overlay ──────────────────────────── */}
      {showSmallScreen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 9999,
            background: "rgba(2,13,36,0.92)",
            backdropFilter: "blur(8px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "24px",
            animation: "fadeIn 0.3s ease both",
          }}
        >
          <div
            style={{
              background: "var(--surface)",
              border: "1px solid var(--border2)",
              borderRadius: "16px",
              padding: "32px 28px",
              maxWidth: "380px",
              width: "100%",
              textAlign: "center",
              boxShadow: "0 0 60px rgba(16,224,161,0.08)",
              animation: "modalPop 0.35s cubic-bezier(0.34,1.56,0.64,1) both",
            }}
          >
            <div style={{ fontSize: 36, marginBottom: 16 }}>⚠️</div>
            <div
              style={{
                fontSize: 16,
                fontWeight: 800,
                color: "var(--text)",
                marginBottom: 10,
              }}
            >
              Best viewed on a larger screen
            </div>
            <div
              style={{
                fontSize: 12,
                color: "var(--text2)",
                lineHeight: 1.6,
                marginBottom: 24,
                fontFamily: "JetBrains Mono, monospace",
              }}
            >
              This demo compares three solvers side-by-side with live maps. A
              screen width of at least 1024 px is recommended.
            </div>
            <button
              onClick={() => setShowSmallScreen(false)}
              style={{
                background: "var(--accent)",
                color: "#020D24",
                border: "none",
                borderRadius: "8px",
                padding: "10px 24px",
                fontWeight: 700,
                fontSize: 13,
                cursor: "pointer",
                width: "100%",
              }}
            >
              Continue Anyway
            </button>
          </div>
        </div>
      )}

      {/* ── Main layout shell ──────────────────────────────────────── */}
      <div className="demo-shell">
        {/* Topbar */}
        <Topbar
          onAbout={() => setShowAbout(true)}
          onReset={handleReset}
          hasResults={resultsViewActive}
          isSolving={isRunning}
        />
        {/* Sidebar slot — input form before a run starts, Route Details for
            the whole comparison view (including while it's still solving) */}
        {!resultsViewActive ? (
          <Mode
            onGenerate={handleGenerate}
            onGenerateSizing={handleGenerateSizing}
            onRunComparison={handleRunComparison}
            onUploadParsed={handleUploadParsed}
            hasGenerated={hasGenerated}
            isRunning={isRunning}
          />
        ) : (
          <RouteDetailsPanel
            solverKey={activeMapSolver ?? "pyvrp"}
            solverLabel={
              activeMapSolver ? SOLVER_LABELS[activeMapSolver] : "Solving…"
            }
            assignments={panelAssignments}
            palette={activeMapPalette}
            activeVehicleIdx={activeMapVehicle}
            onSelectVehicle={setActiveMapVehicle}
            roadRoutes={frozenRoadRouting.byVehicle}
            routingPhase={frozenRoadRouting.phase}
            onReorderStops={handleReorderStops}
            emptyMessage={
              !activeMapSolver
                ? "Waiting for the first solver to finish…"
                : undefined
            }
          />
        )}

        <div className="dashboard-content">

          <div
            className={`map-section ${
              resultsViewActive ? "map-section--results" : "map-section--initial"
            }`}
          >
            <SolverMap
              nodes={nodes}
              routes={activeMapRoutes}
              palette={activeMapPalette}
              activeVehicleIdx={activeMapVehicle}
              roadRoutes={roadRouting.byVehicle}
              routingPhase={roadRouting.phase}
              routingResolved={roadRouting.resolved}
              routingTotal={roadRouting.total}
              routingError={roadRouting.errorMessage}
              onRetryRouting={roadRouting.retry}
              onSelectVehicle={setActiveMapVehicle}
            />
          </div>

          {resultsViewActive && (
            <div className="results-section">
              <div className="summary-banner">
                <div className="summary-card">
                  <span className="summary-label">Best Solver</span>
                  <span className="summary-val">
                    {bestSolver ? bestSolver.label : "—"}
                  </span>
                </div>
                <div className="summary-card">
                  <span className="summary-label">Best Distance</span>
                  <span className="summary-val">
                    {bestSolver
                      ? `${bestSolver.roadKm.toLocaleString(undefined, {
                          maximumFractionDigits: 0,
                        })} km`
                      : "—"}
                  </span>
                </div>
                <div className="summary-card">
                  <span className="summary-label">Spread (Best vs Worst)</span>
                  <span
                    className="summary-val"
                    style={{
                      color: spreadPercent >= 0 ? "#22c55e" : "#ef4444",
                    }}
                  >
                    {bestSolver && worstSolver
                      ? `${Math.abs(spreadPercent).toFixed(1)}%`
                      : "—"}
                  </span>
                </div>
              </div>

              <div className="result-row">
                {solverSummaries.map((s) => {
                  const routes = s.routes;
                  const ridersUsed = countUsedVehicles(routes);
                  const stops = countStops(routes);
                  const feasible =
                    totalOrders === 0 || stops === totalOrders;
                  const isBest = bestSolver?.key === s.key;
                  const isActive = activeMapSolver === s.key;
                  const errorMessage = solverErrors[s.key];
                  const isPending = solverStatus[s.key] === "pending";
                  const hasError = !isPending && !s.response && !!errorMessage;

                  return (
                    <div
                      key={s.key}
                      className={`result-card ${
                        isBest ? "result-card--best" : ""
                      } ${hasError ? "result-card--errored" : ""} ${
                        isPending ? "result-card--pending" : ""
                      } ${
                        isActive && !hasError ? ACTIVE_CARD_CLASS[s.key] : ""
                      } ${isActive && !hasError ? "result-card--active" : ""}`}
                    >
                      <div className="result-card-header">
                        <span className={`result-dot ${s.dotClass}`} />
                        <span className="result-card-title">{s.label}</span>
                        {isPending && (
                          <span className="result-solving-badge">
                            <RiLoader4Line className="result-solving-spin" />
                            Solving…
                          </span>
                        )}
                        {isBest && (
                          <span className="result-best-badge">BEST</span>
                        )}
                      </div>

                      {isPending ? (
                        <div className="result-card-stats result-card-stats--quad">
                          {[
                            "Total Distance",
                            "Solve Time",
                            "Riders Used",
                            "Feasible",
                          ].map((label) => (
                            <div className="result-stat-cell" key={label}>
                              <span className="result-stat-label">
                                {label}
                              </span>
                              <span
                                className="result-stat-skeleton"
                                aria-hidden="true"
                              />
                            </div>
                          ))}
                        </div>
                      ) : hasError ? (
                        <div className="result-card-error-body">
                          <RiErrorWarningLine className="result-card-error-icon" />
                          <span className="result-card-error-title">
                            Solver Failed
                          </span>
                          <span className="result-card-error-message">
                            {errorMessage}
                          </span>
                        </div>
                      ) : (
                        <div className="result-card-stats result-card-stats--quad">
                          <div className="result-stat-cell">
                            <span className="result-stat-label">
                              Total Distance
                            </span>
                            {s.roadKm !== null ? (
                              <span
                                className={`result-stat-value ${
                                  isBest ? "result-stat-value--best" : ""
                                }`}
                              >
                                {s.roadKm.toLocaleString(undefined, {
                                  maximumFractionDigits: 0,
                                })}
                                <span className="result-stat-unit"> KM</span>
                              </span>
                            ) : (
                              <span
                                className="result-stat-skeleton"
                                title="Snapping routes to roads…"
                                aria-hidden="true"
                              />
                            )}
                          </div>
                          <div className="result-stat-cell">
                            <span className="result-stat-label">
                              Solve Time
                            </span>
                            <span className="result-stat-value">
                              {(s.response?.solve_time_seconds ?? 0).toFixed(2)}
                              <span className="result-stat-unit"> s</span>
                            </span>
                          </div>
                          <div className="result-stat-cell">
                            <span className="result-stat-label">
                              Riders Used
                            </span>
                            <span className="result-stat-value">
                              {ridersUsed}
                            </span>
                          </div>
                          <div className="result-stat-cell">
                            <span className="result-stat-label">Feasible</span>
                            <span
                              className="result-stat-value"
                              style={{
                                fontSize: 16,
                                color: feasible ? "#22c55e" : "#ef4444",
                              }}
                            >
                              {feasible ? "Yes" : "No"}
                            </span>
                          </div>
                        </div>
                      )}

                      <div className="result-card-actions">
                        <button
                          className={`btn-view-routes ${
                            isActive && !hasError ? "btn-view-routes--active" : ""
                          }`}
                          onClick={() => handleViewRoutes(s.key)}
                          disabled={hasError || isPending}
                          aria-disabled={hasError || isPending}
                        >
                          {isPending
                            ? "Solving…"
                            : hasError
                              ? "No Data"
                              : isActive
                                ? "Viewing on Map"
                                : "View Routes on Map"}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}