import { useState } from "react";
import {
  RiAlertLine,
  RiArrowDownSLine,
  RiDraggable,
  RiMapPin2Line,
} from "react-icons/ri";
import type { RouteAssignment, BackendSolverName } from "../types/cvrp";
import type { RoadRouteEntry, RoadRoutesPhase } from "../hooks/useRoadRoutes";
import { routeColorFor } from "./SolverMap";
import "../Styling/RouteDetailsPanel.css";

interface RouteDetailsPanelProps {
  solverLabel: string;
  solverKey: BackendSolverName;
  assignments: RouteAssignment[];
  palette: "warm" | "cool";
  activeVehicleIdx: number | null;
  onSelectVehicle: (index: number | null) => void;
  roadRoutes?: Record<number, RoadRouteEntry>;
  routingPhase?: RoadRoutesPhase;
  onReorderStops?: (vehicleId: number, newRoute: number[]) => void;
  emptyMessage?: string;
}

function vehicleLabel(vehicleId: number): string {
  return `R${String(vehicleId).padStart(3, "0")}`;
}

function stopLabel(nodeId: number): string {
  return `O${String(nodeId).padStart(3, "0")}`;
}

function formatKm(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 1 });
}

function formatLoad(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 1 });
}

function formatMinutes(value: number): string {
  const minutes = Math.round(value);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${String(minutes % 60).padStart(2, "0")}m`;
}

/**
 * How much longer the real drive is than the straight-line figure the solver
 * optimised against. Worth surfacing: it is the whole reason road routing is
 * here, and it tells an operator how much slack a plan actually has.
 */
function detourPercent(roadKm: number, straightKm: number): number | null {
  if (straightKm <= 0) return null;
  return ((roadKm - straightKm) / straightKm) * 100;
}

// ─────────────────────────────────────────────────────────────────────────
// RiderStopsGrid — the draggable "depot → O046 → O032 → … → depot" grid.
//
// Only the intermediate stop boxes are draggable; the depot boxes bookend
// the route and never move. Reordering is native HTML5 drag-and-drop (no
// extra dependency) — on drop, the new customer-id order is handed to the
// parent, which recomputes distance and pushes it back down through props,
// so this component never owns the route order itself.
// ─────────────────────────────────────────────────────────────────────────

interface RiderStopsGridProps {
  route: number[];
  vehicleId: number;
  onReorder?: (vehicleId: number, newRoute: number[]) => void;
}

function RiderStopsGrid({ route, vehicleId, onReorder }: RiderStopsGridProps) {
  const stopIds = route.filter((id) => id !== 0);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  const canDrag = Boolean(onReorder) && stopIds.length > 1;

  const commitDrop = (targetIdx: number) => {
    if (dragIndex === null || dragIndex === targetIdx) {
      setDragIndex(null);
      setOverIndex(null);
      return;
    }
    const next = [...stopIds];
    const [moved] = next.splice(dragIndex, 1);
    next.splice(targetIdx, 0, moved);
    setDragIndex(null);
    setOverIndex(null);
    onReorder?.(vehicleId, [0, ...next, 0]);
  };

  return (
    <div className="rdp-stops-grid">
      <div className="rdp-stop-box rdp-stop-box--depot">
        <span className="rdp-stop-box-label">Depot</span>
      </div>

      {stopIds.map((id, idx) => (
        <div
          key={`${vehicleId}-${id}`}
          className={`rdp-stop-box rdp-stop-box--stop ${
            canDrag ? "rdp-stop-box--draggable" : ""
          } ${dragIndex === idx ? "rdp-stop-box--dragging" : ""} ${
            overIndex === idx && dragIndex !== idx ? "rdp-stop-box--drag-over" : ""
          }`}
          draggable={canDrag}
          onDragStart={() => canDrag && setDragIndex(idx)}
          onDragOver={(e) => {
            if (!canDrag) return;
            e.preventDefault();
            setOverIndex(idx);
          }}
          onDragLeave={() =>
            setOverIndex((cur) => (cur === idx ? null : cur))
          }
          onDrop={(e) => {
            e.preventDefault();
            if (canDrag) commitDrop(idx);
          }}
          onDragEnd={() => {
            setDragIndex(null);
            setOverIndex(null);
          }}
        >
          {canDrag && (
            <span className="rdp-stop-drag-handle" aria-hidden="true">
              ⠿
            </span>
          )}
          <span className="rdp-stop-box-label">{stopLabel(id)}</span>
        </div>
      ))}

      <div className="rdp-stop-box rdp-stop-box--depot">
        <span className="rdp-stop-box-label">Depot</span>
      </div>
    </div>
  );
}

export default function RouteDetailsPanel({
  solverLabel,
  assignments,
  palette,
  activeVehicleIdx,
  onSelectVehicle,
  roadRoutes,
  routingPhase = "idle",
  onReorderStops,
  emptyMessage,
}: RouteDetailsPanelProps) {
  // Off by default — dragging is an explicit, opt-in "what-if" mode rather
  // than something that can happen by accident while just browsing routes.
  const [dragEnabled, setDragEnabled] = useState(false);
  const canReorder = Boolean(onReorderStops);

  // Only vehicles whose road path actually came back from OSRM count towards
  // the road totals — mixing in straight-line fallbacks would quietly
  // understate the drive and make the number a lie.
  const snapped = assignments
    .map((a) => roadRoutes?.[a.vehicleId])
    .filter((entry): entry is RoadRouteEntry => entry?.source === "road");

  const totalRoadKm = snapped.reduce((s, e) => s + e.distanceKm, 0);
  const totalRoadMin = snapped.reduce((s, e) => s + e.durationMin, 0);
  const allSnapped =
    assignments.length > 0 && snapped.length === assignments.length;
  const isRoutingBusy = routingPhase === "loading";

  return (
    <aside className="route-details-panel">
      <div className="rdp-header">
        <span className="rdp-header-title">Route Details</span>
        <span className="rdp-header-solver">{solverLabel}</span>
      </div>

      <div className="rdp-summary">
        <div className="rdp-summary-cell">
          <span className="rdp-summary-label">Riders</span>
          <span className="rdp-summary-value">{assignments.length}</span>
        </div>

        <div className="rdp-summary-cell">
          <span className="rdp-summary-label">Distance</span>
          <span className="rdp-summary-value rdp-summary-value--road">
            {snapped.length > 0 ? (
              <>
                {formatKm(totalRoadKm)}
                <span className="rdp-summary-unit"> km</span>
                {!allSnapped && (
                  <span className="rdp-summary-partial" title="Some riders are still being routed">
                    {" "}
                    ({snapped.length}/{assignments.length})
                  </span>
                )}
              </>
            ) : (
              <span className="rdp-summary-pending">
                {isRoutingBusy ? "routing…" : "—"}
              </span>
            )}
          </span>
        </div>

        <div className="rdp-summary-cell">
          <span className="rdp-summary-label">Drive Time</span>
          <span className="rdp-summary-value rdp-summary-value--road">
            {snapped.length > 0 ? (
              formatMinutes(totalRoadMin)
            ) : (
              <span className="rdp-summary-pending">
                {isRoutingBusy ? "routing…" : "—"}
              </span>
            )}
          </span>
        </div>
      </div>

      {canReorder && assignments.length > 0 && (
        <div className="rdp-drag-toggle-row">
          <span className="rdp-drag-toggle-label">
            <RiDraggable className="rdp-drag-toggle-icon" aria-hidden="true" />
            <span>
              Reorder Stops
              <span className="rdp-drag-toggle-sub">
                {dragEnabled
                  ? "Drag any stop below to test a different order"
                  : "Turn on to drag stops and test a different order"}
              </span>
            </span>
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={dragEnabled}
            aria-label="Toggle drag-to-reorder"
            className={`rdp-toggle ${dragEnabled ? "rdp-toggle--on" : ""}`}
            onClick={() => setDragEnabled((v) => !v)}
          >
            <span className="rdp-toggle-thumb" />
          </button>
        </div>
      )}

      <div className="rdp-list">
        {assignments.length === 0 ? (
          <div className="rdp-empty">
            <RiMapPin2Line className="rdp-empty-icon" />
            <span>{emptyMessage ?? "No routes to show for this solver."}</span>
          </div>
        ) : (
          assignments.map((assignment, idx) => {
            const isSelected = activeVehicleIdx === idx;
            const color = routeColorFor(idx, palette);
            const road = roadRoutes?.[assignment.vehicleId];
            const detour =
              road?.source === "road"
                ? detourPercent(road.distanceKm, assignment.totalDistance)
                : null;
            const stopCount = assignment.route.filter((id) => id !== 0).length;

            return (
              <div
                key={assignment.vehicleId}
                className={`rdp-row ${isSelected ? "rdp-row--selected" : ""} ${
                  assignment.isOverCapacity ? "rdp-row--over-capacity" : ""
                }`}
              >
                <button
                  type="button"
                  className="rdp-rider-pill"
                  onClick={() => onSelectVehicle(isSelected ? null : idx)}
                  aria-pressed={isSelected}
                  aria-expanded={isSelected}
                >
                  <span
                    className="rdp-rider-pill-badge"
                    style={{ background: color }}
                  >
                    {String(idx + 1).padStart(2, "0")}
                  </span>
                  <span className="rdp-rider-pill-label">
                    {vehicleLabel(assignment.vehicleId)}
                  </span>
                  {!isSelected && (
                    <span className="rdp-rider-pill-meta">
                      {stopCount} stop{stopCount === 1 ? "" : "s"}
                    </span>
                  )}
                  {assignment.isOverCapacity && (
                    <RiAlertLine
                      className="rdp-rider-pill-alert"
                      title="Over capacity"
                    />
                  )}
                  <RiArrowDownSLine className="rdp-rider-pill-chevron" />
                </button>

                {isSelected && (
                  <div className="rdp-expanded-body">
                    <div className="rdp-rider-stats">
                      <div className="rdp-rider-stat">
                        <span className="rdp-rider-stat-label">Distance</span>
                        <span className="rdp-rider-stat-value">
                          {road?.source === "road"
                            ? formatKm(road.distanceKm)
                            : formatKm(assignment.totalDistance)}{" "}
                          km
                        </span>
                      </div>
                      <div className="rdp-rider-stat">
                        <span className="rdp-rider-stat-label">Time</span>
                        <span className="rdp-rider-stat-value">
                          {road?.source === "road"
                            ? formatMinutes(road.durationMin)
                            : "—"}
                        </span>
                      </div>
                      <div className="rdp-rider-stat">
                        <span className="rdp-rider-stat-label">Stops</span>
                        <span className="rdp-rider-stat-value">
                          {stopCount}
                        </span>
                      </div>
                      <div className="rdp-rider-stat">
                        <span className="rdp-rider-stat-label">Load</span>
                        <span
                          className={`rdp-rider-stat-value ${
                            assignment.isOverCapacity
                              ? "rdp-rider-stat-value--danger"
                              : ""
                          }`}
                        >
                          {formatLoad(assignment.totalLoad)}/
                          {formatLoad(assignment.capacity)} kg
                        </span>
                      </div>
                    </div>

                    <RiderStopsGrid
                      route={assignment.route}
                      vehicleId={assignment.vehicleId}
                      onReorder={dragEnabled ? onReorderStops : undefined}
                    />

                    {stopCount > 1 && canReorder && (
                      <span className="rdp-drag-hint">
                        {dragEnabled ? (
                          <>
                            Drag a stop to reorder — see the effect on the map
                            and in the solver comparison below. These figures
                            stay as the solver reported them.
                          </>
                        ) : (
                          <>
                            Reordering is off — turn on "Reorder Stops" above
                            to drag stops here.
                          </>
                        )}
                      </span>
                    )}

                    {/* On-road figures, kept visually distinct from the solver's
                        own straight-line numbers below so the two are never
                        confused for each other. */}
                    <div className="rdp-row-road">
                      {road?.source === "road" ? (
                        <>
                          <span className="rdp-road-tag">ROAD</span>
                          <strong>{formatKm(road.distanceKm)} km</strong>
                          <span className="rdp-row-sep">·</span>
                          <span>~{formatMinutes(road.durationMin)}</span>
                          {detour !== null && detour > 0.5 && (
                            <span
                              className="rdp-detour"
                              title="How much longer the real drive is than the solver's straight-line distance"
                            >
                              +{detour.toFixed(0)}% vs direct
                            </span>
                          )}
                        </>
                      ) : road?.source === "straight" ? (
                        <span className="rdp-road-unavailable">
                          road route unavailable — straight-line estimate
                        </span>
                      ) : (
                        <span className="rdp-road-pending">
                          <span className="rdp-road-pending-dot" />
                          snapping to roads…
                        </span>
                      )}
                    </div>

                    <div className="rdp-row-stats">
                      <span>
                        Direct:{" "}
                        <strong>{formatKm(assignment.totalDistance)} km</strong>
                      </span>
                      <span className="rdp-row-sep">·</span>
                      <span
                        className={assignment.isOverCapacity ? "rdp-load--over" : ""}
                      >
                        Load:{" "}
                        <strong>
                          {formatLoad(assignment.totalLoad)} /{" "}
                          {formatLoad(assignment.capacity)} kg
                        </strong>
                      </span>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
}
