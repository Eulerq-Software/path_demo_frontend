import React from "react";
import {
  IoAlertCircleOutline,
  IoWarningOutline,
  IoCloseOutline,
} from "react-icons/io5";
import type { ValidationError } from "../types/cvrp";

// ─────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────

interface ValidationErrorsProps {
  errors: ValidationError[];
  onDismiss?: (index: number) => void;
  className?: string;
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function isWarning(message: string): boolean {
  return message.startsWith("Warning:");
}

// ─────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────

const ValidationErrors: React.FC<ValidationErrorsProps> = ({
  errors,
  onDismiss,
  className = "",
}) => {
  if (!errors || errors.length === 0) return null;

  const hardErrors = errors.filter((e) => !isWarning(e.message));
  const warnings = errors.filter((e) => isWarning(e.message));

  return (
    <div className={`ve-root ${className}`}>
      {/* ── Hard errors ──────────────────────────────── */}
      {hardErrors.length > 0 && (
        <div className="ve-section ve-section--error">
          <div className="ve-section-header">
            <IoAlertCircleOutline
              size={14}
              className="ve-section-icon ve-section-icon--error"
            />
            <span className="ve-section-title">
              {hardErrors.length === 1
                ? "1 error found"
                : `${hardErrors.length} errors found`}
            </span>
          </div>
          <ul className="ve-list">
            {hardErrors.map((err, i) => {
              const globalIndex = errors.indexOf(err);
              return (
                <li key={i} className="ve-item ve-item--error">
                  <span
                    className="ve-item-dot ve-item-dot--error"
                    aria-hidden
                  />
                  <div className="ve-item-body">
                    {err.field && err.field !== "file" && (
                      <span className="ve-item-field">{err.field}</span>
                    )}
                    <span className="ve-item-msg">{err.message}</span>
                  </div>
                  {onDismiss && (
                    <button
                      className="ve-dismiss-btn"
                      onClick={() => onDismiss(globalIndex)}
                      aria-label={`Dismiss error: ${err.message}`}
                    >
                      <IoCloseOutline size={12} />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* ── Warnings ─────────────────────────────────── */}
      {warnings.length > 0 && (
        <div className="ve-section ve-section--warning">
          <div className="ve-section-header">
            <IoWarningOutline
              size={14}
              className="ve-section-icon ve-section-icon--warning"
            />
            <span className="ve-section-title">
              {warnings.length === 1
                ? "1 warning"
                : `${warnings.length} warnings`}
            </span>
          </div>
          <ul className="ve-list">
            {warnings.map((warn, i) => {
              const globalIndex = errors.indexOf(warn);
              return (
                <li key={i} className="ve-item ve-item--warning">
                  <span
                    className="ve-item-dot ve-item-dot--warning"
                    aria-hidden
                  />
                  <div className="ve-item-body">
                    {warn.field && warn.field !== "file" && (
                      <span className="ve-item-field">{warn.field}</span>
                    )}
                    <span className="ve-item-msg">{warn.message}</span>
                  </div>
                  {onDismiss && (
                    <button
                      className="ve-dismiss-btn"
                      onClick={() => onDismiss(globalIndex)}
                      aria-label={`Dismiss warning: ${warn.message}`}
                    >
                      <IoCloseOutline size={12} />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* ── Styles ───────────────────────────────────── */}
      <style>{`
        .ve-root {
          display: flex;
          flex-direction: column;
          gap: 8px;
          width: 100%;
        }

        /* ── Section wrapper ────────────────────────────── */
        .ve-section {
          border-radius: 10px;
          overflow: hidden;
        }
        .ve-section--error {
          border: 1px solid rgba(239, 68, 68, 0.25);
          background: rgba(239, 68, 68, 0.05);
        }
        .ve-section--warning {
          border: 1px solid rgba(251, 191, 36, 0.25);
          background: rgba(251, 191, 36, 0.04);
        }

        /* ── Section header ─────────────────────────────── */
        .ve-section-header {
          display: flex;
          align-items: center;
          gap: 7px;
          padding: 8px 12px 7px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.04);
        }
        .ve-section--error  .ve-section-header { border-bottom-color: rgba(239, 68, 68, 0.15); }
        .ve-section--warning .ve-section-header { border-bottom-color: rgba(251, 191, 36, 0.15); }

        .ve-section-icon--error   { color: #f87171; flex-shrink: 0; }
        .ve-section-icon--warning { color: #fbbf24; flex-shrink: 0; }

        .ve-section-title {
          font-size: 11.5px;
          font-weight: 700;
          letter-spacing: 0.04em;
          text-transform: uppercase;
        }
        .ve-section--error   .ve-section-title { color: #f87171; }
        .ve-section--warning .ve-section-title { color: #fbbf24; }

        /* ── List ───────────────────────────────────────── */
        .ve-list {
          list-style: none;
          margin: 0;
          padding: 6px 0 4px;
        }

        /* ── Item ───────────────────────────────────────── */
        .ve-item {
          display: flex;
          align-items: flex-start;
          gap: 9px;
          padding: 5px 12px;
          transition: background 0.12s ease;
        }
        .ve-item:hover { background: rgba(255, 255, 255, 0.025); }

        .ve-item-dot {
          width: 5px;
          height: 5px;
          border-radius: 50%;
          flex-shrink: 0;
          margin-top: 5px;
        }
        .ve-item-dot--error   { background: #f87171; }
        .ve-item-dot--warning { background: #fbbf24; }

        .ve-item-body {
          flex: 1;
          min-width: 0;
          display: flex;
          flex-wrap: wrap;
          align-items: baseline;
          gap: 5px;
          line-height: 1.55;
        }

        .ve-item-field {
          font-size: 10.5px;
          font-family: 'JetBrains Mono', 'Fira Code', monospace;
          font-weight: 600;
          padding: 1px 6px;
          border-radius: 4px;
          white-space: nowrap;
          flex-shrink: 0;
        }
        .ve-item--error   .ve-item-field {
          color: #fca5a5;
          background: rgba(239, 68, 68, 0.12);
          border: 1px solid rgba(239, 68, 68, 0.2);
        }
        .ve-item--warning .ve-item-field {
          color: #fde68a;
          background: rgba(251, 191, 36, 0.1);
          border: 1px solid rgba(251, 191, 36, 0.2);
        }

        .ve-item-msg {
          font-size: 12px;
          color: var(--text2, #8aa4c0);
          flex: 1;
          min-width: 0;
        }
        .ve-item--error   .ve-item-msg { color: #fca5a5; }
        .ve-item--warning .ve-item-msg { color: #fde68a; }

        /* ── Dismiss button ─────────────────────────────── */
        .ve-dismiss-btn {
          width: 22px;
          height: 22px;
          border-radius: 5px;
          border: 1px solid transparent;
          background: transparent;
          color: var(--text3, #4a6a8a);
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.15s ease;
          flex-shrink: 0;
          margin-top: 1px;
          font-family: inherit;
        }
        .ve-dismiss-btn:hover {
          background: rgba(255, 255, 255, 0.06);
          border-color: rgba(255, 255, 255, 0.1);
          color: var(--text, #e2e8f0);
        }
      `}</style>
    </div>
  );
};

export default ValidationErrors;
