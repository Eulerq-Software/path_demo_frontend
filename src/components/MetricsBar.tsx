// src/components/MetricsBar.tsx

import { Clock3, Route, TrendingDown, Zap } from "lucide-react";

interface MetricsBarProps {
  baselineObjective?: number;
  baselineTime?: number;
  eulerQObjective?: number;
  eulerQTime?: number;
  improvementPercent?: number;
  visible?: boolean;
}

interface MetricCardProps {
  title: string;
  value: string;
  icon: React.ReactNode;
  accent: string;
}

function MetricCard({ title, value, icon, accent }: MetricCardProps) {
  return (
    <div
      className="
        flex-1
        min-w-[180px]
        h-full
        rounded-xl
        border border-[#13213a]
        bg-[#081225]
        px-4
        flex items-center gap-4
      "
    >
      <div
        className={`
          w-11 h-11
          rounded-lg
          flex items-center justify-center
          ${accent}
        `}
      >
        {icon}
      </div>

      <div className="flex flex-col">
        <span className="text-[11px] uppercase tracking-wider text-[#64748b]">
          {title}
        </span>

        <span className="text-[20px] font-semibold text-white mt-1">
          {value}
        </span>
      </div>
    </div>
  );
}

export default function MetricsBar({
  baselineObjective = 0,
  baselineTime = 0,
  eulerQObjective = 0,
  eulerQTime = 0,
  improvementPercent = 0,
  visible = false,
}: MetricsBarProps) {
  if (!visible) {
    return (
      <div className="h-16 px-6 py-2">
        <div
          className="
            w-full h-full
            rounded-xl
            border border-dashed border-[#1e293b]
            bg-[#050d1c]
            flex items-center justify-center
            text-sm text-[#475569]
          "
        >
          Run comparison to view solver metrics
        </div>
      </div>
    );
  }

  return (
    <section className="h-20 px-6 py-2">
      <div className="w-full h-full flex gap-4">
        <MetricCard
          title="Baseline Distance"
          value={`${(baselineObjective / 1000).toFixed(2)} km`}
          accent="bg-orange-500/10 text-white border border-orange-500/20"
          icon={<Route className="w-5 h-5" />}
        />

        <MetricCard
          title="Baseline Time"
          value={`${baselineTime} ms`}
          accent="bg-amber-500/10 text-amber-400 border border-amber-500/20"
          icon={<Clock3 className="w-5 h-5" />}
        />

        <MetricCard
          title="EulerQ Distance"
          value={`${(eulerQObjective / 1000).toFixed(2)} km`}
          accent="bg-cyan-500/10 text-cyan-400 border border-cyan-500/20"
          icon={<Zap className="w-5 h-5" />}
        />

        <MetricCard
          title="EulerQ Time"
          value={`${eulerQTime} ms`}
          accent="bg-teal-500/10 text-teal-400 border border-teal-500/20"
          icon={<Clock3 className="w-5 h-5" />}
        />

        <MetricCard
          title="Improvement"
          value={`${improvementPercent.toFixed(1)}%`}
          accent="bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
          icon={<TrendingDown className="w-5 h-5" />}
        />
      </div>
    </section>
  );
}
