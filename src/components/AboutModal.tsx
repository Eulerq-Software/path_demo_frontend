// src/components/AboutModal.tsx

import { useEffect } from "react";

interface AboutModalProps {
  onClose: () => void;
}

export default function AboutModal({ onClose }: AboutModalProps) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      className="
        fixed inset-0 z-[9999]
        bg-[rgba(2,8,23,0.78)]
        backdrop-blur-sm
        flex items-center justify-center
        p-6
      "
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="
          w-full max-w-[760px]
          max-h-[88vh]
          overflow-hidden
          rounded-2xl
          border border-[#1b2a47]
          bg-[#070f20]
          shadow-[0_24px_80px_rgba(0,0,0,0.6)]
          flex flex-col
        "
      >
        {/* ── HEADER ── */}
        <div
          className="
          px-6 py-4
          border-b border-[#111f38]
          flex items-center justify-between
          shrink-0
        "
        >
          <div className="flex items-center gap-3">
            <div
              className="
              w-10 h-10
              rounded-xl
              border border-[#1e3a5f]
              bg-[#0b1c35]
              flex items-center justify-center
              text-[15px] font-bold text-teal-300
              tracking-tight
            "
            >
              ΣQ
            </div>

            <div>
              <h2 className="text-[15px] font-bold text-white leading-tight">
                About this Demo
              </h2>
              <p className="text-[11px] text-[#4a6080] mt-0.5 tracking-wide">
                CVRP · Capacitated Vehicle Routing
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="
              w-8 h-8
              rounded-lg
              border border-[#1e2f4a]
              bg-[#0b1730]
              hover:bg-[#13213a]
              transition-colors
              text-[#6b8299] hover:text-white
              text-sm
              flex items-center justify-center
            "
          >
            ✕
          </button>
        </div>

        <div className="overflow-y-auto px-6 py-5 space-y-7 flex-1">
          <Section title="What is CVRP?">
            <p className="text-[13.5px] leading-[1.8] text-[#94aac4]">
              <span className="font-semibold text-[#cdd9e8]">
                Capacitated Vehicle Routing Problem (CVRP)
              </span>{" "}
              is a combinatorial optimization problem where a fleet of vehicles
              must serve multiple pickup locations while respecting vehicle
              capacity constraints and minimizing total travel distance.
            </p>
            <p className="text-[13.5px] leading-[1.8] text-[#94aac4] mt-3">
              Every vehicle starts and ends at a central depot, and each pickup
              node has an associated demand/load that contributes toward vehicle
              capacity usage.
            </p>
          </Section>

          <Section title="Solvers Being Compared">
            <div className="space-y-3">
              <SolverCard accent="orange" label="Naive Solver">
                A basic routing method used as a starting comparison to show how
                routes become less efficient when they are not optimized.
              </SolverCard>

              <SolverCard accent="amber" label="Greedy Solver">
                A heuristic-based routing approach that incrementally selects
                locally optimal assignments to improve route efficiency over the
                naive baseline.
              </SolverCard>

              <SolverCard accent="teal" label="EulerQ Quantum-Inspired">
                EulerQ's quantum-inspired optimization engine designed to solve
                large-scale routing problems more efficiently than classical
                baselines — especially on highly constrained instances.
              </SolverCard>
            </div>
          </Section>

          <Section title="Demo Features">
            <ul className="space-y-2">
              {[
                "Dual-map comparison between baseline and EulerQ solver routes",
                "Generate Mode for random Bengaluru routing simulations",
                "Upload Mode supporting Excel-based CVRP datasets",
                "Automatic Haversine distance matrix generation from coordinates",
                "Vehicle capacity validation and infeasibility detection",
                "Exportable Excel result reports with full run reproducibility",
              ].map((item) => (
                <li
                  key={item}
                  className="flex items-start gap-2.5 text-[13.5px] leading-[1.7] text-[#94aac4]"
                >
                  <span className="mt-[6px] w-1.5 h-1.5 rounded-full bg-teal-500/60 shrink-0" />
                  {item}
                </li>
              ))}
            </ul>
          </Section>

          <Section title="Excel Upload Mode">
            <p className="text-[13.5px] leading-[1.8] text-[#94aac4]">
              Users can upload a structured Excel workbook containing up to
              three sheets:
            </p>
            <div className="mt-3 space-y-2">
              {[
                [
                  "Config",
                  "Required. Defines vehicles, pickups, capacity and load.",
                ],
                [
                  "Distance Matrix",
                  "Optional. An N×N square matrix where N = 1 + num_pickups.",
                ],
                [
                  "Coordinates",
                  "Optional alternative. Lat/lng per node; Haversine is computed automatically.",
                ],
              ].map(([label, desc]) => (
                <div
                  key={label}
                  className="flex items-start gap-3 text-[13.5px] leading-[1.7]"
                >
                  <span className="text-teal-400 font-semibold shrink-0">
                    {label}
                  </span>
                  <span className="text-[#94aac4]">{desc}</span>
                </div>
              ))}
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h3
        className="
        mb-3
        text-[10.5px]
        font-semibold
        tracking-[0.2em]
        uppercase
        text-teal-500
      "
      >
        {title}
      </h3>
      <div>{children}</div>
    </section>
  );
}

function SolverCard({
  label,
  accent,
  children,
}: {
  label: string;
  accent: "orange" | "amber" | "teal";
  children: React.ReactNode;
}) {
  const border = {
    orange: "border-l-orange-500/70",
    amber: "border-l-amber-400/70",
    teal: "border-l-teal-400/70",
  }[accent];

  const labelColor = {
    orange: "text-orange-400",
    amber: "text-amber-400",
    teal: "text-teal-400",
  }[accent];

  return (
    <div
      className={`
      border-l-2 ${border}
      border border-[#111f38]
      bg-[#040d1c]
      rounded-r-xl rounded-l-none
      px-4 py-3
    `}
    >
      <div className={`text-[13px] font-semibold mb-1 ${labelColor}`}>
        {label}
      </div>
      <div className="text-[13px] leading-[1.75] text-[#8aa4be]">
        {children}
      </div>
    </div>
  );
}
