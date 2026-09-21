import { useState } from "react";
import "../Styling/Mode.css";

import {
  RiFlashlightLine,
  RiPlayCircleLine,
  RiUploadCloud2Line,
  RiRefreshLine,
  RiRouteLine,
  RiTeamLine,
  RiMapPin2Line,
  RiArrowDownSLine,
  RiInformationLine,
} from "react-icons/ri";

import ExcelUploadModal from "./ExcelUploadModal";

import {
  parseLocationFile,
  buildInstanceFromLocations,
} from "../utils/excelParser";

import type { GenerateParams, ExcelParseResult } from "../types/cvrp";

type Props = {
  onGenerate: (params: GenerateParams) => void;
  onRunComparison: () => void;
  onUploadParsed: (result: ExcelParseResult) => void;
  hasGenerated: boolean;
  isRunning: boolean;
};

type OptimizationMode = "distance" | "riders";

const DEPOT_LABEL = "Bangalore (Center)";
const DEPOT_LAT = 12.9716;
const DEPOT_LNG = 77.5946;

const ORDERS_MIN = 20;
const ORDERS_MAX = 1000;
const RIDERS_MIN = 5;
const RIDERS_MAX = 50;
const TIME_MIN = 1;
const TIME_MAX = 12;

const CAPACITY_FLOOR = 1;
const CAPACITY_CEIL = 100;
const LOAD_FLOOR = 1;
const LOAD_CEIL = 50;

type FieldErrors = {
  orders?: string;
  riders?: string;
  availableTime?: string;
  capacity?: string;
  load?: string;
};

function randomInRange(min: number, max: number): number {
  if (max <= min) return min;
  return Math.round((min + Math.random() * (max - min)) * 10) / 10;
}

function buildRangeValues(count: number, min: number, max: number): number[] {
  return Array.from({ length: Math.max(count, 0) }, () =>
    randomInRange(min, max),
  );
}

/*
 * ------------------------------------------------------------
 * Dual-thumb range slider
 * ------------------------------------------------------------
 */

type RangeSliderProps = {
  min: number;
  max: number;
  valueMin: number;
  valueMax: number;
  step?: number;
  onChange: (min: number, max: number) => void;
};

function RangeSlider({
  min,
  max,
  valueMin,
  valueMax,
  step = 1,
  onChange,
}: RangeSliderProps) {
  const span = max - min || 1;
  const pctMin = ((valueMin - min) / span) * 100;
  const pctMax = ((valueMax - min) / span) * 100;

  return (
    <div className="range-slider">
      <div className="range-slider-track">
        <div
          className="range-slider-fill"
          style={{
            left: `${pctMin}%`,
            width: `${Math.max(pctMax - pctMin, 0)}%`,
          }}
        />
      </div>
      <input
        type="range"
        className="range-slider-input range-slider-input--min"
        min={min}
        max={max}
        step={step}
        value={valueMin}
        onChange={(e) => {
          const next = Math.min(Number(e.target.value), valueMax - step);
          onChange(next, valueMax);
        }}
      />
      <input
        type="range"
        className="range-slider-input range-slider-input--max"
        min={min}
        max={max}
        step={step}
        value={valueMax}
        onChange={(e) => {
          const next = Math.max(Number(e.target.value), valueMin + step);
          onChange(valueMin, next);
        }}
      />
    </div>
  );
}

/*
 * ------------------------------------------------------------
 * Collapsible section wrapper
 * ------------------------------------------------------------
 */

function CollapsibleSection({
  title,
  open,
  onToggle,
  children,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="mode-collapsible">
      <button
        type="button"
        className="mode-collapsible-header"
        onClick={onToggle}
      >
        <span>{title}</span>
        <RiArrowDownSLine
          className={`mode-collapsible-chevron ${open ? "is-open" : ""}`}
        />
      </button>
      {open && <div className="mode-collapsible-body">{children}</div>}
    </div>
  );
}

export default function Mode({
  onGenerate,
  onRunComparison,
  onUploadParsed,
  hasGenerated,
  isRunning,
}: Props) {
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [isParsing, setIsParsing] = useState(false);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);

  const [optimizationMode, setOptimizationMode] =
    useState<OptimizationMode>("distance");

  const [numOrders, setNumOrders] = useState(20);
  const [numRiders, setNumRiders] = useState(5);
  const [availableTimeHours, setAvailableTimeHours] = useState(4);
  const [trafficConsideration, setTrafficConsideration] = useState(true);
  const [capacityMin, setCapacityMin] = useState(30);
  const [capacityMax, setCapacityMax] = useState(50);
  const [loadMin, setLoadMin] = useState(1);
  const [loadMax, setLoadMax] = useState(10);
  const [distanceType, setDistanceType] = useState<"osrm" | "haversine">(
    "osrm",
  );

  const [riderSettingsOpen, setRiderSettingsOpen] = useState(true);
  const [orderSettingsOpen, setOrderSettingsOpen] = useState(true);
  const [advancedOpen, setAdvancedOpen] = useState(true);

  const [errors, setErrors] = useState<FieldErrors>({});

  const isRidersMode = optimizationMode === "riders";

  const averageCapacity = (capacityMin + capacityMax) / 2;
  const averageLoad = (loadMin + loadMax) / 2;

  /*
   * ------------------------------------------------------------
   * Validation
   * ------------------------------------------------------------
   */

  function validate(): FieldErrors {
    const next: FieldErrors = {};

    if (numOrders < ORDERS_MIN || numOrders > ORDERS_MAX) {
      next.orders = `Enter a value between ${ORDERS_MIN} and ${ORDERS_MAX}.`;
    }

    if (isRidersMode) {
      if (availableTimeHours < TIME_MIN || availableTimeHours > TIME_MAX) {
        next.availableTime = `Enter a value between ${TIME_MIN} and ${TIME_MAX}.`;
      }
    } else {
      if (numRiders < RIDERS_MIN || numRiders > RIDERS_MAX) {
        next.riders = `Enter a value between ${RIDERS_MIN} and ${RIDERS_MAX}.`;
      }
    }

    if (!isRidersMode && (capacityMin <= 0 || capacityMax < capacityMin)) {
      next.capacity = "Capacity range is invalid.";
    }
    if (loadMin <= 0 || loadMax < loadMin) {
      next.load = "Weight range is invalid.";
    }

    return next;
  }

  /*
   * ------------------------------------------------------------
   * Generate
   * ------------------------------------------------------------
   */

  function handleGenerate() {
    if (isRunning) return;

    const fieldErrors = validate();
    setErrors(fieldErrors);
    if (Object.keys(fieldErrors).length > 0) return;

    const effectiveNumRiders = isRidersMode ? RIDERS_MAX : numRiders;

    const params: GenerateParams = {
      numVehicles: effectiveNumRiders,
      numPickups: numOrders,
      vehicleCapacity: buildRangeValues(
        effectiveNumRiders,
        capacityMin,
        capacityMax,
      ),
      pickupLoad: buildRangeValues(numOrders, loadMin, loadMax),
    };

    onGenerate(params);
  }

  /*
   * ------------------------------------------------------------
   * Upload
   * ------------------------------------------------------------
   */

  async function handleFileUpload(file: File) {
    if (isParsing || isRunning) return;

    setIsParsing(true);

    try {
      const { depot, locations, warnings, fatalError } =
        await parseLocationFile(file);

      if (fatalError) {
        console.error("[Mode] Upload error:", fatalError);
        setUploadModalOpen(false);
        return;
      }

      if (!depot || locations.length === 0) {
        console.error("[Mode] No valid locations found.", warnings);
        setUploadModalOpen(false);
        return;
      }

      const { nodes, instance, errors } = buildInstanceFromLocations(
        locations,
        numRiders,
        averageCapacity,
        depot,
      );

      const result: ExcelParseResult = {
        nodes,
        instance,
        errors,
      };

      onUploadParsed(result);

      setUploadedFile(file);
      setUploadModalOpen(false);

      if (warnings.length > 0) {
        console.warn("[Mode] Upload warnings:", warnings);
      }
    } catch (error) {
      console.error("[Mode] Failed to parse uploaded file:", error);
      setUploadModalOpen(false);
    } finally {
      setIsParsing(false);
    }
  }

  /*
   * ------------------------------------------------------------
   * Run Comparison
   * ------------------------------------------------------------
   */

  function handleRunComparison() {
    if (isRunning || !hasGenerated) return;

    onRunComparison();
  }


  return (
    <>
      <ExcelUploadModal
        isOpen={uploadModalOpen}
        onClose={() => {
          if (!isParsing && !isRunning) {
            setUploadModalOpen(false);
          }
        }}
        onUpload={handleFileUpload}
        isParsing={isParsing}
      />

       <aside className="mode-sidebar">
        {/* <div className="mode-header">
         <span className="mode-header-title">Inputs &amp; Configuration</span> 
          <button
            type="button"
            className="mode-header-action"
            onClick={handleGenerate}
            disabled={isRunning}
          >
            <RiRefreshLine className="mode-header-action-icon" />
            <span>Generate New Instance</span>
          </button>
        </div> */}

        <div className="mode-body">
          <div className="mode-field-group">
            <span className="mode-section-label">Optimization Mode</span>
            <div className="mode-optimization-toggle">
              <button
                type="button"
                className={`mode-optimization-card ${
                  optimizationMode === "distance"
                    ? "mode-optimization-card--active"
                    : ""
                }`}
                onClick={() => setOptimizationMode("distance")}
              >
                <span className="mode-optimization-index">1</span>
                <RiRouteLine className="mode-optimization-icon" />
                <span className="mode-optimization-title">
                  Route Optimization
                </span>
                <span className="mode-optimization-subtitle">
                  Minimize Total Distance
                </span>
              </button>

              <button
                type="button"
                className={`mode-optimization-card ${
                  optimizationMode === "riders"
                    ? "mode-optimization-card--active"
                    : ""
                }`}
                onClick={() => setOptimizationMode("riders")}
              >
                <span className="mode-optimization-index">2</span>
                <RiTeamLine className="mode-optimization-icon" />
                <span className="mode-optimization-title">
                  Minimum Riders
                </span>
                <span className="mode-optimization-subtitle">
                  Minimize Number of Riders
                </span>
              </button>
            </div>
          </div>

          <div className="mode-field-group">
            <span className="mode-section-label">Instance Settings</span>

            <div className="field-group">
              <div className="mode-field-row">
                <span className="field-label">Number of Orders</span>
                <span className="mode-field-hint">
                  ({ORDERS_MIN} - {ORDERS_MAX})
                </span>
              </div>
              <input
                type="number"
                className={`field-input ${errors.orders ? "has-error" : ""}`}
                value={numOrders}
                min={ORDERS_MIN}
                max={ORDERS_MAX}
                onChange={(e) => setNumOrders(Number(e.target.value) || 0)}
              />
              {errors.orders && (
                <span className="field-error">{errors.orders}</span>
              )}
            </div>

            {isRidersMode ? (
              <div className="field-group">
                <div className="mode-field-row">
                  <span className="field-label">Available Time</span>
                  <span className="mode-field-hint">
                    ({TIME_MIN} - {TIME_MAX} hours)
                  </span>
                </div>
                <div className="mode-time-row">
                  <input
                    type="number"
                    className={`field-input ${
                      errors.availableTime ? "has-error" : ""
                    }`}
                    value={availableTimeHours}
                    min={TIME_MIN}
                    max={TIME_MAX}
                    onChange={(e) =>
                      setAvailableTimeHours(Number(e.target.value) || 0)
                    }
                  />
                  <select
                    className="field-input mode-select mode-time-unit"
                    value="hours"
                    disabled
                  >
                    <option value="hours">Hours</option>
                  </select>
                </div>
                {errors.availableTime && (
                  <span className="field-error">{errors.availableTime}</span>
                )}
              </div>
            ) : (
              <div className="field-group">
                <div className="mode-field-row">
                  <span className="field-label">Number of Riders</span>
                  <span className="mode-field-hint">
                    ({RIDERS_MIN} - {RIDERS_MAX})
                  </span>
                </div>
                <input
                  type="number"
                  className={`field-input ${errors.riders ? "has-error" : ""}`}
                  value={numRiders}
                  min={RIDERS_MIN}
                  max={RIDERS_MAX}
                  onChange={(e) => setNumRiders(Number(e.target.value) || 0)}
                />
                {errors.riders && (
                  <span className="field-error">{errors.riders}</span>
                )}
              </div>
            )}

            <div className="field-group">
              <span className="field-label">Depot Location</span>
              <div className="mode-select-wrap">
                <RiMapPin2Line className="mode-select-icon" />
                <select className="field-input mode-select" value={0} disabled>
                  <option value={0}>{DEPOT_LABEL}</option>
                </select>
              </div>
              <span className="mode-field-subtext">
                {DEPOT_LAT}, {DEPOT_LNG}
              </span>
            </div>

            {isRidersMode && (
              <div className="mode-info-banner">
                <RiInformationLine className="mode-info-banner-icon" />
                <span>
                  The system will determine the minimum number of riders
                  required to complete all deliveries within the available
                  time.
                </span>
              </div>
            )}
          </div>

          {!isRidersMode && (
            <CollapsibleSection
              title="Rider Settings"
              open={riderSettingsOpen}
              onToggle={() => setRiderSettingsOpen((v) => !v)}
            >
              <span className="field-label">Capacity Range (kg)</span>
              <div className="mode-range-row">
                <input
                  type="number"
                  className="field-input mode-range-input"
                  value={capacityMin}
                  min={CAPACITY_FLOOR}
                  max={capacityMax}
                  onChange={(e) =>
                    setCapacityMin(Number(e.target.value) || CAPACITY_FLOOR)
                  }
                />
                <RangeSlider
                  min={CAPACITY_FLOOR}
                  max={CAPACITY_CEIL}
                  valueMin={capacityMin}
                  valueMax={capacityMax}
                  onChange={(nextMin, nextMax) => {
                    setCapacityMin(nextMin);
                    setCapacityMax(nextMax);
                  }}
                />
                <input
                  type="number"
                  className="field-input mode-range-input"
                  value={capacityMax}
                  min={capacityMin}
                  max={CAPACITY_CEIL}
                  onChange={(e) =>
                    setCapacityMax(Number(e.target.value) || CAPACITY_CEIL)
                  }
                />
              </div>
              {errors.capacity && (
                <span className="field-error">{errors.capacity}</span>
              )}
              <span className="mode-field-subtext">
                Average Capacity: {averageCapacity.toFixed(1)} kg
              </span>
            </CollapsibleSection>
          )}

          <CollapsibleSection
            title="Order Settings"
            open={orderSettingsOpen}
            onToggle={() => setOrderSettingsOpen((v) => !v)}
          >
            <span className="field-label">Order Weight Range (kg)</span>
            <div className="mode-range-row">
              <input
                type="number"
                className="field-input mode-range-input"
                value={loadMin}
                min={LOAD_FLOOR}
                max={loadMax}
                onChange={(e) =>
                  setLoadMin(Number(e.target.value) || LOAD_FLOOR)
                }
              />
              <RangeSlider
                min={LOAD_FLOOR}
                max={LOAD_CEIL}
                valueMin={loadMin}
                valueMax={loadMax}
                onChange={(nextMin, nextMax) => {
                  setLoadMin(nextMin);
                  setLoadMax(nextMax);
                }}
              />
              <input
                type="number"
                className="field-input mode-range-input"
                value={loadMax}
                min={loadMin}
                max={LOAD_CEIL}
                onChange={(e) =>
                  setLoadMax(Number(e.target.value) || LOAD_CEIL)
                }
              />
            </div>
            {errors.load && (
              <span className="field-error">{errors.load}</span>
            )}
            <span className="mode-field-subtext">
              Average Weight: {averageLoad.toFixed(1)} kg
            </span>
          </CollapsibleSection>

          <CollapsibleSection
            title="Advanced Settings"
            open={advancedOpen}
            onToggle={() => setAdvancedOpen((v) => !v)}
          >
            <div className="mode-field-row">
              <span className="field-label">Distance Type</span>
              <RiInformationLine
                className="mode-info-icon"
                title="Road Distance uses real routing via OSRM. Straight-Line uses haversine distance."
              />
            </div>
            <select
              className="field-input mode-select"
              value={distanceType}
              onChange={(e) =>
                setDistanceType(e.target.value as "osrm" | "haversine")
              }
            >
              <option value="osrm">Road Distance (OSRM)</option>
              <option value="haversine">Straight-Line (Haversine)</option>
            </select>

            {isRidersMode && (
              <div className="mode-field-row mode-toggle-row">
                <div className="mode-field-row">
                  <span className="field-label">Traffic Consideration</span>
                  <RiInformationLine
                    className="mode-info-icon"
                    title="Factor live/typical traffic conditions into travel time estimates."
                  />
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={trafficConsideration}
                  className={`mode-toggle-switch ${
                    trafficConsideration ? "mode-toggle-switch--on" : ""
                  }`}
                  onClick={() => setTrafficConsideration((v) => !v)}
                >
                  <span className="mode-toggle-thumb" />
                </button>
              </div>
            )}
          </CollapsibleSection>
        </div>

        <div className="mode-actions">
          {/* Upload */}
          {/* <button
            type="button"
            className={`btn-action btn-upload${
              uploadedFile ? " btn-upload--active" : ""
            }`}
            onClick={() => setUploadModalOpen(true)}
            disabled={isRunning || isParsing}
            title={uploadedFile ? uploadedFile.name : "Upload an Excel or CSV file"}
          > */}
            {/* <RiUploadCloud2Line className="btn-icon" />
            <span>
              {isParsing
                ? "Parsing..."
                : uploadedFile
                  ? "Uploaded"
                  : "Upload Excel / CSV"}
            </span>
          </button> */}

          {/* Generate */}
          <button
            type="button"
            className="btn-action btn-generate-instance"
            onClick={handleGenerate}
            disabled={isRunning}
          >
            <RiFlashlightLine className="btn-icon" />
            <span>Generate Instance</span>
          </button>

          {/* Run Comparison */}
          <button
            type="button"
            className={`btn-run-comparison${
              !hasGenerated || isRunning ? " btn-run--disabled" : ""
            }`}
            onClick={handleRunComparison}
            disabled={!hasGenerated || isRunning}
          >
            <RiPlayCircleLine className="run-icon" />
            <span>
              {isRunning ? "Running Comparison..." : "Optimize (Compare Solvers)"}
            </span>
          </button>
        </div>
      </aside>
    </>
  );
}