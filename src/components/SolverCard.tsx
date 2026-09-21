// src/components/SolverCard.tsx
import type { ReactNode } from "react";
import "../Styling/SolverCard.css";
import type { Node, VehicleRoute } from "../types/cvrp";

// ─────────────────────────────────────────────────────────────
// Palette constants
// ─────────────────────────────────────────────────────────────
const WARM_PALETTE = [
  "#f97316",
  "#ef4444",
  "#eab308",
  "#f59e0b",
  "#fb923c",
  "#dc2626",
  "#ca8a04",
  "#d97706",
];
const COOL_PALETTE = [
  "#10E0A1",
  "#14b8a6",
  "#06b6d4",
  "#0ea5e9",
  "#22d3ee",
  "#38bdf8",
  "#6ee7b7",
  "#5eead4",
];

// ─────────────────────────────────────────────────────────────
// Internal: Spinner
// ─────────────────────────────────────────────────────────────
function Spinner({
  size = 48,
  color = "#10E0A1",
}: {
  size?: number;
  color?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      style={{
        animation:
          "sc-spin 0.9s linear infinite, sc-loader-glow 1.4s ease-in-out infinite",
      }}
    >
      <circle
        cx="20"
        cy="20"
        r="16"
        fill="none"
        stroke={color}
        strokeWidth="3"
        strokeDasharray="60 40"
        strokeLinecap="round"
      />
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────
// Internal: Solver Running Overlay
// ─────────────────────────────────────────────────────────────
function SolverRunningOverlay({ accent }: { accent: "orange" | "teal" }) {
  const color = accent === "orange" ? "#f97316" : "#f97316";
  return (
    <div className="sc-overlay">
      <Spinner size={48} color={color} />
      <span className="sc-overlay-label">SOLVER RUNNING</span>
    </div>
  );
}

function buildNodeMap(nodes: Node[]): Map<number, Node> {
  const map = new Map<number, Node>();
  nodes.forEach((node) => {
    map.set(node.id, node);
  });
  return map;
}

interface AssignmentsRowsProps {
  routes: VehicleRoute[];
  nodes: Node[];
  palette: "warm" | "cool";
  activeVehicleIdx: number | null;
  onVehicleClick: (idx: number | null) => void;
}

function AssignmentsRows({
  routes,
  nodes,
  palette,
  activeVehicleIdx,
  onVehicleClick,
}: AssignmentsRowsProps) {
  const colors = palette === "warm" ? WARM_PALETTE : COOL_PALETTE;

  if (!routes || routes.length === 0) {
    return <div className="sc-assignments-empty">No assignments yet.</div>;
  }

  const nodeMap = buildNodeMap(nodes);

  return (
    <>
      {routes.map((vr, idx) => {
        const color = colors[idx % colors.length];
        const isActive = activeVehicleIdx === idx;
        const activeClass = isActive
          ? palette === "warm"
            ? "sc-row-active-warm"
            : "sc-row-active-cool"
          : "";

        const stopIds = (vr.route ?? []).filter((id) => id !== 0);

        const stopLabels = stopIds.map((id) => {
          const node = nodeMap.get(id);
          return `O${String(node?.id ?? id).padStart(3, "0")}`;
        });

        const riderLabel = `R${String(vr.vehicleId).padStart(3, "0")}`;
        const count = stopLabels.length;

        return (
          <div
            key={idx}
            className={`sc-assignment-row ${activeClass}`}
            onClick={() => onVehicleClick(isActive ? null : idx)}
          >
            <span className={`sc-assign-rider-id sc-rider-${palette}`}>
              {riderLabel}
            </span>
            <span className="sc-assign-orders">
              {stopLabels.length > 0 ? stopLabels.join("   ") : "—"}
            </span>
            <span className="sc-assign-count">{count}</span>
          </div>
        );
      })}
    </>
  );
}

export interface SolverCardProps {
  title: string;
  accent: "orange" | "teal";
  rightAction?: ReactNode;
  isSolving: boolean;
  showResults: boolean;
  objective?: number;
  solveTimeMs?: number;
  map: ReactNode;
  routes: VehicleRoute[];
  nodes: Node[];
  activeVehicleIdx: number | null;
  onVehicleClick: (idx: number | null) => void;
  fleetDistance: number;
}

export default function SolverCard({
  title,
  accent,
  rightAction,
  isSolving,
  showResults,
  objective,
  solveTimeMs,
  map,
  routes,
  nodes,
  activeVehicleIdx,
  onVehicleClick,
  fleetDistance,
}: SolverCardProps) {
  const palette = accent === "orange" ? "warm" : "cool";
  const chipSpinnerColor =
    accent === "orange" ? "var(--text2)" : "var(--accent)";

  const dotClass = showResults
    ? accent === "orange"
      ? "sc-dot-active-orange"
      : "sc-dot-active-teal"
    : isSolving
      ? accent === "orange"
        ? "sc-dot-pulse-orange"
        : "sc-dot-pulse-teal"
      : "sc-dot-inactive";

  return (
    <div className={`sc-card sc-card-${accent}`}>
      {/* ── Header ── */}
      <div className="sc-header">
        <div className="sc-title-wrap">
          <div className={`sc-dot ${dotClass}`} />
          <span className="sc-title">{title}</span>
        </div>

        <div className="sc-header-right">
          {isSolving && (
            <div className="sc-status-chip">
              <svg
                className="sc-chip-spinner"
                width="14"
                height="14"
                viewBox="0 0 40 40"
              >
                <circle
                  cx="20"
                  cy="20"
                  r="16"
                  fill="none"
                  stroke={chipSpinnerColor}
                  strokeWidth="4"
                  strokeDasharray="60 40"
                  strokeLinecap="round"
                />
              </svg>
              SOLVING
            </div>
          )}
          {rightAction && <div>{rightAction}</div>}
        </div>
      </div>

      <div className="sc-map-wrap">
        <div className={isSolving ? "sc-map-blur-layer" : "sc-map-normal"}>
          {map}
        </div>
        {isSolving && <SolverRunningOverlay accent={accent} />}
      </div>

      {showResults && (
        <div className="sc-assignments-wrap">
          <div className="sc-assignments-header">
            <span className="sc-assignments-label">ASSIGNMENTS</span>
          </div>

          <div className="sc-assignments-scroll">
            <AssignmentsRows
              routes={routes}
              nodes={nodes}
              palette={palette}
              activeVehicleIdx={activeVehicleIdx}
              onVehicleClick={onVehicleClick}
            />
          </div>
        </div>
      )}
    </div>
  );
}