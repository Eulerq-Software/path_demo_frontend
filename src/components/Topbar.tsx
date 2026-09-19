// src/components/Topbar.tsx
import AboutModal from "./AboutModal";

interface TopbarProps {
  isSolving?: boolean;

  hasResults?: boolean;

  onAbout?: () => void;

  onReset?: () => void;
}

export default function Topbar({
  isSolving = false,
  hasResults = false,
  onAbout,
  onReset,
}: TopbarProps) {
  return (
    <header
      className="
        relative
        h-16
        border-b border-[#13213a]
        bg-[#020817]
        px-8
        flex items-center justify-between
      "
    >
      {/* ===================================== */}
      {/* LEFT — LOGO */}
      {/* ===================================== */}

      <div className="flex items-center min-w-[220px]">
        <a href="/">
          <img
            src="/full-light.svg"
            alt="EulerQ"
            className="h-[90px] object-contain block"
          />
        </a>
      </div>

      {/* ===================================== */}
      {/* CENTER — TITLE */}
      {/* ===================================== */}

      <div
        className="
          absolute
          left-1/2
          -translate-x-1/2
          text-center
          pointer-events-none
        "
      >
        <h1
          className="
            text-[18px]
            font-extrabold
            tracking-[-0.01em]
            text-white
          "
        >
          CVRP Comparison DEMO
        </h1>

        <p
          className="
            mt-1
            text-[11px]
            tracking-[0.18em]
            uppercase
            text-[#64748b]
          "
        >
          Greedy vs Google OR-Tools vs EulerQ Quantum-Inspired · Bengaluru Routing
        </p>
      </div>

      {/* ===================================== */}
      {/* RIGHT — ACTIONS */}
      {/* ===================================== */}

      <div className="flex items-center gap-3 min-w-[220px] justify-end">
        {/* LIVE STATUS */}

        {isSolving && (
          <div className="flex items-center gap-2">
            <div
              className="
                w-2.5 h-2.5
                rounded-full
                bg-teal-400
                animate-pulse
              "
            />

            <span className="text-[11px] text-teal-400 font-medium">LIVE</span>
          </div>
        )}

        {/* ABOUT BUTTON */}

        <button
          onClick={onAbout}
          className="
    h-9
    px-4
    rounded-lg

    border border-[#1e293b]

    bg-[#081225]

    hover:bg-[#0d1a33]

    transition-all duration-200

    text-sm
    text-[#dbe4ee]
  "
        >
          About
        </button>

        {/* RESET BUTTON */}

        {hasResults && (
          <button
            onClick={() => window.location.reload()}
            className="
      h-9
      px-4
      rounded-lg
      border border-[#1e293b]
      bg-[#081225]
      hover:bg-[#0d1a33]
      transition-all duration-200
      text-sm
      text-[#dbe4ee]
    "
          >
            Reset
          </button>
        )}
      </div>
    </header>
  );
}