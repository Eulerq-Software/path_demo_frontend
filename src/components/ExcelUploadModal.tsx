import React, { useState, useRef, DragEvent, ChangeEvent } from "react";
import { createPortal } from "react-dom";
import {
  IoCloudUploadOutline,
  IoCheckmarkCircle,
  IoAlertCircleOutline,
  IoDocumentOutline,
  IoCloseOutline,
} from "react-icons/io5";
import {
  RiFileExcel2Line,
  RiFileLine,
  RiUploadCloud2Line,
} from "react-icons/ri";
import "../Styling/ExcelUploadModal.css";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const MAX_SIZE_BYTES = 20 * 1024; // 20 KB

const ACCEPTED_EXTENSIONS: Record<"excel" | "csv", string[]> = {
  excel: [".xlsx", ".xls"],
  csv: [".csv"],
};

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type UploadType = "excel" | "csv";

interface ExcelUploadModalProps {
  isOpen: boolean;

  onClose: () => void;

  onUpload: (file: File) => void;

  isParsing?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function validateFile(file: File, type: UploadType): string | null {
  const lower = file.name.toLowerCase();
  const allowed = ACCEPTED_EXTENSIONS[type];
  if (!allowed.some((ext) => lower.endsWith(ext))) {
    return `Invalid file type. Expected ${allowed.join(" or ")} for this option.`;
  }
  if (file.size > MAX_SIZE_BYTES) {
    return `File exceeds the 20 KB limit (${formatBytes(file.size)}).`;
  }
  return null;
}

const ExcelUploadModal: React.FC<ExcelUploadModalProps> = ({
  isOpen,
  onClose,
  onUpload,
  isParsing = false,
}) => {
  const [selectedType, setSelectedType] = useState<UploadType | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState<UploadType | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState(false);

  const excelInputRef = useRef<HTMLInputElement>(null);
  const csvInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  // ── File handling ──────────────────────────────────────────────────────────

  function applyFile(f: File, type: UploadType) {
    const err = validateFile(f, type);
    setValidationError(err);
    if (!err) {
      setFile(f);
      setSelectedType(type);
    } else {
      setFile(null);
    }
  }

  function handleFileChange(
    e: ChangeEvent<HTMLInputElement>,
    type: UploadType,
  ) {
    const selected = e.target.files?.[0];
    if (selected) applyFile(selected, type);
    e.target.value = ""; // reset so same file can be re-selected
  }

  function handleCardClick(type: UploadType) {
    if (isParsing) return;
    if (type === "excel") excelInputRef.current?.click();
    else csvInputRef.current?.click();
  }

  function handleDrop(e: DragEvent<HTMLDivElement>, type: UploadType) {
    e.preventDefault();
    setIsDragging(null);
    if (isParsing) return;
    const dropped = e.dataTransfer.files?.[0];
    if (dropped) applyFile(dropped, type);
  }

  function handleDragOver(e: DragEvent<HTMLDivElement>, type: UploadType) {
    e.preventDefault();
    if (!isParsing) setIsDragging(type);
  }

  function handleDragLeave() {
    setIsDragging(null);
  }

  function clearFile() {
    setFile(null);
    setSelectedType(null);
    setValidationError(null);
    setUploadSuccess(false);
  }

  // ── Submit ─────────────────────────────────────────────────────────────────

  function handleUpload() {
    if (!file) {
      setValidationError("Please select a file before uploading.");
      return;
    }
    setUploadSuccess(true);
    onUpload(file);
  }

  // ── Card class builder ─────────────────────────────────────────────────────

  function cardClass(type: UploadType): string {
    const classes = ["eum-option-card"];
    if (isDragging === type) classes.push("dragging-over");
    if (file && selectedType === type) classes.push("selected");
    return classes.join(" ");
  }

  function handleOverlayClick() {
    if (!isParsing) onClose();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────

  const modal = (
    <div
      className="eum-overlay"
      onClick={handleOverlayClick}
      role="dialog"
      aria-modal="true"
      aria-label="Upload data file"
    >
      <div className="eum-modal" onClick={(e) => e.stopPropagation()}>
        {/* Hidden file inputs */}
        <input
          ref={excelInputRef}
          type="file"
          accept=".xlsx,.xls"
          style={{ display: "none" }}
          onChange={(e) => handleFileChange(e, "excel")}
        />
        <input
          ref={csvInputRef}
          type="file"
          accept=".csv"
          style={{ display: "none" }}
          onChange={(e) => handleFileChange(e, "csv")}
        />

        {/* ── Header ───────────────────────────────────────────────────── */}
        <div className="eum-header">
          <div className="eum-header-icon" aria-hidden="true">
            <IoCloudUploadOutline />
          </div>
          <div className="eum-header-text">
            <h3>Upload Data File</h3>
            <p>Requires latitude · longitude · max 20 KB</p>
          </div>
          <button
            className="eum-close-btn"
            onClick={onClose}
            disabled={isParsing}
            aria-label="Close upload modal"
          >
            <IoCloseOutline size={16} />
          </button>
        </div>

        {/* ── Body ─────────────────────────────────────────────────────── */}
        {uploadSuccess && !isParsing ? (
          <div className="eum-body">
            <div className="eum-success">
              <div className="eum-success-icon">
                <IoCheckmarkCircle />
              </div>
              <p className="eum-success-title">File uploaded successfully!</p>
              <p className="eum-success-sub">{file?.name}</p>
            </div>
          </div>
        ) : (
          <div className="eum-body">
            {/* Section label */}
            <span className="eum-section-label">Choose format</span>

            <div className="eum-options-grid">
              <div
                className={cardClass("excel")}
                role="button"
                tabIndex={isParsing ? -1 : 0}
                aria-label="Upload Excel file (.xlsx or .xls)"
                aria-disabled={isParsing}
                onClick={() => handleCardClick("excel")}
                onDrop={(e) => handleDrop(e, "excel")}
                onDragOver={(e) => handleDragOver(e, "excel")}
                onDragLeave={handleDragLeave}
                onKeyDown={(e) => e.key === "Enter" && handleCardClick("excel")}
                style={
                  isParsing
                    ? { pointerEvents: "none", opacity: 0.5 }
                    : undefined
                }
              >
                <div className="eum-option-icon-wrap">
                  <RiFileExcel2Line />
                </div>
                <div className="eum-option-text">
                  <span className="eum-option-label">Excel</span>
                  <span className="eum-option-ext">.xlsx · .xls</span>
                </div>
                <div className="eum-option-badge">XLS</div>
              </div>

              {/* CSV card */}
              <div
                className={cardClass("csv")}
                role="button"
                tabIndex={isParsing ? -1 : 0}
                aria-label="Upload CSV file (.csv)"
                aria-disabled={isParsing}
                onClick={() => handleCardClick("csv")}
                onDrop={(e) => handleDrop(e, "csv")}
                onDragOver={(e) => handleDragOver(e, "csv")}
                onDragLeave={handleDragLeave}
                onKeyDown={(e) => e.key === "Enter" && handleCardClick("csv")}
                style={
                  isParsing
                    ? { pointerEvents: "none", opacity: 0.5 }
                    : undefined
                }
              >
                <div className="eum-option-icon-wrap">
                  <RiFileLine />
                </div>
                <div className="eum-option-text">
                  <span className="eum-option-label">CSV</span>
                  <span className="eum-option-ext">.csv</span>
                </div>
                <div className="eum-option-badge">CSV</div>
              </div>
            </div>

            {/* File preview — shown once a file is selected */}
            {file && (
              <>
                <div className="eum-divider">SELECTED FILE</div>
                <div className="eum-file-preview">
                  <div className="eum-file-preview-icon">
                    <IoDocumentOutline />
                  </div>
                  <div className="eum-file-preview-meta">
                    <span className="eum-file-preview-name">{file.name}</span>
                    <span className="eum-file-preview-size">
                      {formatBytes(file.size)}
                    </span>
                  </div>
                  <div className="eum-file-preview-actions">
                    {isParsing ? (
                      <span className="eum-spinner" aria-label="Parsing…" />
                    ) : (
                      <IoCheckmarkCircle size={18} className="eum-check-icon" />
                    )}
                    {!isParsing && (
                      <button
                        className="eum-remove-btn"
                        onClick={clearFile}
                        aria-label="Remove selected file"
                      >
                        <IoCloseOutline size={13} />
                      </button>
                    )}
                  </div>
                </div>
              </>
            )}

            {/* Validation error */}
            {validationError && !isParsing && (
              <div className="eum-error" role="alert">
                <IoAlertCircleOutline size={14} />
                <span>{validationError}</span>
              </div>
            )}

            {/* Requirements callout */}
            <div className="eum-callout">
              <span className="eum-callout-title">
                <span className="eum-callout-title-dot" />
                Excel / CSV Format
              </span>
              <div className="excel-table">
                <div className="excel-table-header">
                  <span>Sample Data</span>
                  <span className="excel-table-header-badge">Preview</span>
                </div>
                <div className="excel-table-row excel-table-col-headers">
                  <div className="excel-table-cell">ID</div>
                  <div className="excel-table-cell">LATITUDE</div>
                  <div className="excel-table-cell">LONGITUDE</div>
                </div>
                {[
                  ["DEPOT", "12.9352", "77.6245"],
                  ["P001", "12.9279", "77.6271"],
                  ["P002", "12.9850", "77.6050"],
                  ["P003", "12.9611", "77.6387"],
                ].map(([id, lat, lng]) => (
                  <div className="excel-table-row" key={id}>
                    <div className="excel-table-cell">{id}</div>
                    <div className="excel-table-cell">{lat}</div>
                    <div className="excel-table-cell">{lng}</div>
                  </div>
                ))}
              </div>
              <div className="eum-callout-footer">
                <span className="eum-callout-dot" />
                <span>
                  Points must be within <strong>Bengaluru</strong> region · Max{" "}
                  <strong>20 KB</strong>
                </span>
              </div>
            </div>
          </div>
        )}

        {/* ── Footer ───────────────────────────────────────────────────── */}
        <div className="eum-footer">
          <button
            className="eum-btn eum-btn-cancel"
            onClick={onClose}
            disabled={isParsing}
          >
            Cancel
          </button>
          <button
            className="eum-btn eum-btn-upload"
            onClick={handleUpload}
            disabled={!file || isParsing || uploadSuccess}
            aria-disabled={!file || isParsing}
          >
            <RiUploadCloud2Line size={14} aria-hidden="true" />
            {isParsing ? "Parsing…" : "Load & Use Data"}
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
};

export default ExcelUploadModal;
