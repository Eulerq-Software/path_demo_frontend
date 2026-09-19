import { useState, useEffect, useCallback } from "react";
import { Toaster, toast } from "react-hot-toast";
import { RiFlashlightLine } from "react-icons/ri";
import Topbar from "../components/Topbar";
import AboutModal from "../components/AboutModal";
import SolverMap from "../components/SolverMap";
import Mode from "../components/Mode";
import { useComparisonStore } from "../state/useComparisonStore";
import { generateInstance } from "../utils/generator";
import { solveCVRP, SolveApiError } from "../utils/api";
import { parseSolveRoutes } from "../utils/resultParser";
import { buildRouteAssignments, computeFleetTotal } from "../utils/routeHelpers";
import type {
  VehicleRoute,
  RouteAssignment,
  ExcelParseResult,
  SolveMetrics,
  GenerateParams,
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
  },
  warn: {
    background: "#020D24",
    color: "#F8FAFC",
    border: "1px solid #F59E0B",
  },
};

type MapSolver = "greedy" | "or_tools" | "eulerq";

function sumDistance(routes: VehicleRoute[] | null): number {
  return (routes ?? []).reduce((s, vr) => s + vr.totalDistance, 0);
}

function countUsedVehicles(routes: VehicleRoute[] | null): number {
  return (routes ?? []).filter((vr) => vr.numStops > 0).length;
}

function countStops(routes: VehicleRoute[] | null): number {
  return (routes ?? []).reduce((s, vr) => s + vr.numStops, 0);
}

export default function CompareDashboard() {
  const {
    baselineSolver,
    hasResults,
    metrics,
    nodes,
    greedyRoutes,
    orToolsRoutes,
    eulerqRoutes,
    setNodes,
    setInstance,
    setResults,
    setSolveError,
    resetAll,
  } = useComparisonStore();
  const [showAbout, setShowAbout] = useState(false);
  const [showSmallScreen, setShowSmallScreen] = useState(false);
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const [isRunning, setIsRunning] = useState(false);
  const [hasGenerated, setHasGenerated] = useState(false);
  const [showSolvingOverlay, setShowSolvingOverlay] = useState(false);
  const [assignmentsVisible, setAssignmentsVisible] = useState(false);
  const [activeMapSolver, setActiveMapSolver] = useState<MapSolver>("eulerq");
  const [activeMapVehicle, setActiveMapVehicle] = useState<number | null>(
    null,
  );

  useEffect(() => {
    const check = () => setShowSmallScreen(window.innerWidth < 1024);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  useEffect(() => {
    if (!hasResults) {
      setAssignmentsVisible(false);
      setActiveMapVehicle(null);
      setActiveMapSolver("eulerq");
      setSidebarVisible(true);
    } else {
      setSidebarVisible(false);
    }
  }, [hasResults]);

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
        blockingErrors.forEach((e) =>
          toast.error(e.message, { style: T.error }),
        );
        return;
      }

      result.errors
        .filter((e) => e.message.startsWith("Warning"))
        .forEach((e) => toast(e.message, { style: T.warn, icon: "⚠️" }));

      resetAll();
      setAssignmentsVisible(false);
      setActiveMapVehicle(null);
      setActiveMapSolver("eulerq");

      setNodes(result.nodes);
      setInstance(result.instance);
      setHasGenerated(true);

      toast.success(
        `Generated ${result.instance.customers.length} pickup node(s) across Bengaluru.`,
        { style: T.success },
      );
    },
    [setNodes, setInstance, resetAll],
  );

  // ─────────────────────────────────────────────────────────────
  // Upload handler
  // ─────────────────────────────────────────────────────────────

  const handleUploadParsed = useCallback(
    (result: ExcelParseResult) => {
      resetAll();
      setAssignmentsVisible(false);
      setActiveMapVehicle(null);
      setActiveMapSolver("eulerq");

      setNodes(result.nodes);
      setInstance(result.instance);
      setHasGenerated(true);

      toast.success(
        `Loaded ${result.instance.customers.length} pickup location(s) from file.`,
        { style: T.success },
      );
    },
    [setNodes, setInstance, resetAll],
  );

  // ─────────────────────────────────────────────────────────────
  // Run Comparison handler
  //
  // All three solvers now hit the backend `/solve` endpoint — awaited
  // sequentially (not Promise.all) so no two solves compete for the same
  // server resources at once: greedy → or_tools → pyvrp.
  // ─────────────────────────────────────────────────────────────

  const handleRunComparison = useCallback(async () => {
    const instance = useComparisonStore.getState().instance;

    if (!instance) {
      toast.error("Generate or upload data first.", { style: T.error });
      return;
    }

    setAssignmentsVisible(false);
    setActiveMapVehicle(null);
    setIsRunning(true);
    setShowSolvingOverlay(true);
    setSolveError(null);

    const minDelay = new Promise<void>((res) => setTimeout(res, 3000));

    try {
      // All three now hit the backend, sequentially, so no two solves run
      // on the server at once: greedy → or_tools → pyvrp.

      // 1. Greedy — backend.
      const greedyRaw = await solveCVRP(instance, "greedy");
      const greedyRoutesResult: VehicleRoute[] = parseSolveRoutes(
        greedyRaw.routes,
      );
      const greedyTimeMs = (greedyRaw.solve_time_seconds ?? 0) * 1000;

      // 2. Google OR-Tools — backend.
      const orToolsRaw = await solveCVRP(instance, "or_tools");
      const orToolsRoutesResult = parseSolveRoutes(orToolsRaw.routes);
      const orToolsTimeMs = (orToolsRaw.solve_time_seconds ?? 0) * 1000;

      // 3. EulerQ (pyvrp) — backend.
      const eulerqRaw = await solveCVRP(instance, "pyvrp");
      const eulerqRoutesResult = parseSolveRoutes(eulerqRaw.routes);
      const eulerqTimeMs = (eulerqRaw.solve_time_seconds ?? 0) * 1000;

      const greedyAssignments: RouteAssignment[] = buildRouteAssignments(
        greedyRoutesResult,
        instance,
      );
      const orToolsAssignments: RouteAssignment[] = buildRouteAssignments(
        orToolsRoutesResult,
        instance,
      );
      const eulerqAssignments: RouteAssignment[] = buildRouteAssignments(
        eulerqRoutesResult,
        instance,
      );

      const greedyTotal = computeFleetTotal(greedyRoutesResult);
      const orToolsTotal =
        orToolsRaw.total_distance ?? computeFleetTotal(orToolsRoutesResult);
      const eulerqTotal =
        eulerqRaw.total_distance ?? computeFleetTotal(eulerqRoutesResult);

      const activeBaselineTotal =
        baselineSolver === "greedy" ? greedyTotal : orToolsTotal;
      const activeBaselineTime =
        baselineSolver === "greedy" ? greedyTimeMs : orToolsTimeMs;

      const improvementPercent =
        activeBaselineTotal > 0
          ? ((activeBaselineTotal - eulerqTotal) / activeBaselineTotal) * 100
          : 0;

      const solvedMetrics: SolveMetrics = {
        baselineSolverName: baselineSolver,
        baselineObjective: activeBaselineTotal,
        baselineTime: activeBaselineTime,
        greedyTime: greedyTimeMs,
        orToolsTime: orToolsTimeMs,
        eulerQObjective: eulerqTotal,
        eulerQTime: eulerqTimeMs,
        improvementPercent,
      };

      setResults({
        greedyRoutes: greedyRoutesResult,
        greedyAssignments,
        orToolsRoutes: orToolsRoutesResult,
        orToolsAssignments,
        eulerqRoutes: eulerqRoutesResult,
        eulerqAssignments,
        metrics: solvedMetrics,
      });

      setActiveMapSolver("eulerq");
      setActiveMapVehicle(null);

      toast.success("Comparison complete!", { style: T.success });
    } catch (err) {
      console.error("[RunComparison]", err);

      if (err instanceof SolveApiError) {
        setSolveError(err.message);
        toast.error(err.message, { style: T.error, duration: 7000 });
      } else {
        const msg =
          err instanceof Error ? err.message : "Unknown solver error.";

        setSolveError(msg);

        toast.error(msg, {
          style: T.error,
          duration: 5000,
        });
      }
    } finally {
      await minDelay;
      setIsRunning(false);
      setShowSolvingOverlay(false);
      setAssignmentsVisible(true);
    }
  }, [baselineSolver, setSolveError, setResults]);

  // ─────────────────────────────────────────────────────────────
  // View Routes on Map handler
  // ─────────────────────────────────────────────────────────────

  const handleViewRoutes = useCallback((solver: MapSolver) => {
    setActiveMapSolver(solver);
    setActiveMapVehicle(null);
  }, []);

  // ─────────────────────────────────────────────────────────────
  // Reset handler
  // ─────────────────────────────────────────────────────────────

  const handleReset = useCallback(() => {
    resetAll();
    setHasGenerated(false);
    setIsRunning(false);
    setShowSolvingOverlay(false);
    setAssignmentsVisible(false);
    setActiveMapVehicle(null);
    setActiveMapSolver("eulerq");
  }, [resetAll]);

  const showResults = hasResults && assignmentsVisible && !showSolvingOverlay;

  const activeMapRoutes =
    activeMapSolver === "greedy"
      ? greedyRoutes
      : activeMapSolver === "or_tools"
        ? orToolsRoutes
        : eulerqRoutes;

  const activeMapPalette = activeMapSolver === "eulerq" ? "cool" : "warm";

  const totalPickups = Math.max(nodes.length - 1, 0);

  const solverSummaries = [
    {
      key: "greedy" as MapSolver,
      label: "Greedy Solver",
      dotClass: "result-dot--orange",
      routes: greedyRoutes,
      distance: sumDistance(greedyRoutes),
      solveTimeMs: metrics?.greedyTime ?? 0,
    },
    {
      key: "or_tools" as MapSolver,
      label: "Google OR-Tools",
      dotClass: "result-dot--blue",
      routes: orToolsRoutes,
      distance: sumDistance(orToolsRoutes),
      solveTimeMs: metrics?.orToolsTime ?? 0,
    },
    {
      key: "eulerq" as MapSolver,
      label: "EulerQ Solver",
      dotClass: "result-dot--teal",
      routes: eulerqRoutes,
      distance: sumDistance(eulerqRoutes),
      solveTimeMs: metrics?.eulerQTime ?? 0,
    },
  ];

  const bestSolver = solverSummaries.reduce((best, s) =>
    s.distance < best.distance ? s : best,
  );

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
          hasResults={hasResults}
        />
        {/* Input Panel */}
        {sidebarVisible ? (
          <Mode
            onGenerate={handleGenerate}
            onRunComparison={handleRunComparison}
            onUploadParsed={handleUploadParsed}
            hasGenerated={hasGenerated}
            isRunning={isRunning}
          />
        ) : (
          <button
            type="button"
            className="btn-show-sidebar"
            onClick={() => setSidebarVisible(true)}
          >
            <RiFlashlightLine className="btn-icon" />
            <span>Generate New Instance</span>
          </button>
        )}

        <div
          className={`dashboard-content ${
            sidebarVisible ? "" : "dashboard-content--full"
          }`}
        >
          <div
            className={`map-section ${
              showResults ? "map-section--results" : "map-section--initial"
            }`}
          >
            <SolverMap
              nodes={nodes}
              routes={(activeMapRoutes ?? []).map((vr) => vr.route)}
              palette={activeMapPalette}
              activeVehicleIdx={activeMapVehicle}
            />
          </div>

          {showResults && metrics && (
            <div className="results-section">
              <div className="summary-banner">
                <div className="summary-card">
                  <span className="summary-label">Best Solver</span>
                  <span className="summary-val">{bestSolver.label}</span>
                </div>
                <div className="summary-card">
                  <span className="summary-label">Best Distance</span>
                  <span className="summary-val">
                    {bestSolver.distance.toLocaleString(undefined, {
                      maximumFractionDigits: 0,
                    })}{" "}
                    km
                  </span>
                </div>
                <div className="summary-card">
                  <span className="summary-label">
                    EulerQ vs{" "}
                    {metrics.baselineSolverName === "greedy"
                      ? "Greedy"
                      : "Google OR"}
                  </span>
                  <span
                    className="summary-val"
                    style={{
                      color:
                        metrics.improvementPercent >= 0
                          ? "#22c55e"
                          : "#ef4444",
                    }}
                  >
                    {metrics.improvementPercent >= 0 ? "-" : "+"}
                    {Math.abs(metrics.improvementPercent).toFixed(1)}%
                  </span>
                </div>
              </div>

              <div className="result-row">
                {solverSummaries.map((s) => {
                  const ridersUsed = countUsedVehicles(s.routes);
                  const stops = countStops(s.routes);
                  const feasible =
                    totalPickups === 0 || stops === totalPickups;
                  const isBest = s.distance <= bestSolver.distance + 1e-6;
                  const isActive = activeMapSolver === s.key;

                  return (
                    <div
                      key={s.key}
                      className={`result-card ${
                        isBest ? "result-card--best" : ""
                      }`}
                    >
                      <div className="result-card-header">
                        <span className={`result-dot ${s.dotClass}`} />
                        <span className="result-card-title">{s.label}</span>
                        {isBest && (
                          <span className="result-best-badge">BEST</span>
                        )}
                      </div>

                      <div className="result-card-stats result-card-stats--quad">
                        <div className="result-stat-cell">
                          <span className="result-stat-label">
                            Total Distance
                          </span>
                          <span
                            className={`result-stat-value ${
                              isBest ? "result-stat-value--best" : ""
                            }`}
                          >
                            {s.distance.toLocaleString(undefined, {
                              maximumFractionDigits: 0,
                            })}
                            <span className="result-stat-unit"> KM</span>
                          </span>
                        </div>
                        <div className="result-stat-cell">
                          <span className="result-stat-label">
                            Solve Time
                          </span>
                          <span className="result-stat-value">
                            {s.solveTimeMs.toFixed(3)}
                            <span className="result-stat-unit"> ms</span>
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

                      <div className="result-card-actions">
                        <button
                          className={`btn-view-routes ${
                            isActive ? "btn-view-routes--active" : ""
                          }`}
                          onClick={() => handleViewRoutes(s.key)}
                        >
                          {isActive ? "Viewing on Map" : "View Routes on Map"}
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