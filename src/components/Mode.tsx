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
  RiMotorbikeLine,
  RiTaxiLine,
  RiWeightLine,
} from "react-icons/ri";

import ExcelUploadModal from "./ExcelUploadModal";

import {
  parseLocationFile,
  buildInstanceFromLocations,
} from "../utils/excelParser";

import { useComparisonStore } from "../state/useComparisonStore";

import type {
  GenerateParams,
  GenerateSizingParams,
  ExcelParseResult,
} from "../types/cvrp";

type Props = {
  onGenerate: (params: GenerateParams) => void;
  onGenerateSizing: (params: GenerateSizingParams) => void;
  onRunComparison: () => void;
  onUploadParsed: (result: ExcelParseResult) => void;
  hasGenerated: boolean;
  isRunning: boolean;
};

const DEPOT_LABEL = "Bangalore (Center)";
const DEPOT_LAT = 12.9716;
const DEPOT_LNG = 77.5946;

const ORDERS_MIN = 20;
const ORDERS_MAX = 1000;
const RIDERS_MIN = 5;
const RIDERS_MAX = 50;
const TIME_MIN = 1;
const TIME_MAX = 12;

/*
 * ------------------------------------------------------------
 * Vehicle types
 * Picking a vehicle type fixes the per-rider capacity and bounds
 * the order-weight range to what that vehicle can realistically
 * carry — Rider Settings and Order Settings below key off whichever
 * type is currently selected.
 * ------------------------------------------------------------
 */

type VehicleType = "two_wheeler" | "three_wheeler";

const VEHICLE_TYPE_CONFIG: Record<
  VehicleType,
  {
    label: string;
    subtitle: string;
    capacityKg: number;
    loadMin: number;
    loadMax: number;
  }
> = {
  two_wheeler: {
    label: "Two Wheeler",
    subtitle: "Bikes & scooters for light, fast drops",
    capacityKg: 20,
    loadMin: 1,
    loadMax: 3,
  },
  three_wheeler: {
    label: "Three Wheeler",
    subtitle: "Autos & cargo trikes for bulk loads",
    capacityKg: 500,
    loadMin: 1,
    loadMax: 10,
  },
};

const VEHICLE_TYPES = Object.keys(VEHICLE_TYPE_CONFIG) as VehicleType[];

const VEHICLE_TYPE_ICONS: Record<VehicleType, typeof RiMotorbikeLine> = {
  two_wheeler: RiMotorbikeLine,
  three_wheeler: RiTaxiLine,
};

// Bounds for the opt-in "Custom Capacity" range — generous enough to cover
// either vehicle type once a user overrides the fixed value.
const CAPACITY_FLOOR = 1;
const CAPACITY_CEIL = 1000;

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
      {/* Always mounted — a `grid-template-rows` transition (0fr <-> 1fr)
          animates the height smoothly without measuring pixels, and keeps
          the body's own internal state (e.g. slider drag) alive across
          collapses instead of unmounting it. */}
      <div
        className={`mode-collapsible-panel ${
          open ? "mode-collapsible-panel--open" : ""
        }`}
      >
        <div className="mode-collapsible-panel-inner">
          <div className="mode-collapsible-body">{children}</div>
        </div>
      </div>
    </div>
  );
}

export default function Mode({
  onGenerate,
  onGenerateSizing,
  onRunComparison,
  onUploadParsed,
  hasGenerated,
  isRunning,
}: Props) {
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [isParsing, setIsParsing] = useState(false);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);

  const optimizationMode = useComparisonStore((s) => s.optimizationMode);
  const setOptimizationMode = useComparisonStore((s) => s.setOptimizationMode);

  const [vehicleType, setVehicleType] = useState<VehicleType>("two_wheeler");
  const activeVehicleConfig = VEHICLE_TYPE_CONFIG[vehicleType];

  const [numOrders, setNumOrders] = useState(20);
  const [numRiders, setNumRiders] = useState(5);
  const [availableTimeHours, setAvailableTimeHours] = useState(4);
  const [capacityMin, setCapacityMin] = useState(activeVehicleConfig.capacityKg);
  const [capacityMax, setCapacityMax] = useState(activeVehicleConfig.capacityKg);
  const [loadMin, setLoadMin] = useState(activeVehicleConfig.loadMin);
  const [loadMax, setLoadMax] = useState(activeVehicleConfig.loadMax);
  const [customCapacityEnabled, setCustomCapacityEnabled] = useState(false);

  const [riderSettingsOpen, setRiderSettingsOpen] = useState(true);
  const [orderSettingsOpen, setOrderSettingsOpen] = useState(true);

  const [errors, setErrors] = useState<FieldErrors>({});

  const isRidersMode = optimizationMode === "riders";

  const averageCapacity = (capacityMin + capacityMax) / 2;
  const averageLoad = (loadMin + loadMax) / 2;

  function handleVehicleTypeChange(type: VehicleType) {
    if (type === vehicleType) return;
    const cfg = VEHICLE_TYPE_CONFIG[type];
    setVehicleType(type);
    setCapacityMin(cfg.capacityKg);
    setCapacityMax(cfg.capacityKg);
    setLoadMin(cfg.loadMin);
    setLoadMax(cfg.loadMax);
    // A custom range from the old vehicle type would be meaningless (or
    // outright wrong) for the new one — start fixed again and let the user
    // re-enable the override deliberately if they still want one.
    setCustomCapacityEnabled(false);
    setErrors((prev) => ({ ...prev, capacity: undefined, load: undefined }));
  }

  function handleToggleCustomCapacity() {
    setCustomCapacityEnabled((prev) => {
      const next = !prev;
      if (!next) {
        setCapacityMin(activeVehicleConfig.capacityKg);
        setCapacityMax(activeVehicleConfig.capacityKg);
        setErrors((current) => ({ ...current, capacity: undefined }));
      }
      return next;
    });
  }

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

    if (capacityMin <= 0 || capacityMax < capacityMin) {
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

    if (isRidersMode) {
      // /solve/sizing takes a single homogeneous capacity, not a per-vehicle
      // list — Rider Settings is hidden in this mode, so fall back to the
      // midpoint of the (unedited) capacity range as that one value.
      const sizingParams: GenerateSizingParams = {
        numPickups: numOrders,
        pickupLoad: buildRangeValues(numOrders, loadMin, loadMax),
        vehicleCapacity: averageCapacity,
        maxRouteTimeSeconds: availableTimeHours * 3600,
      };

      onGenerateSizing(sizingParams);
      return;
    }

    const params: GenerateParams = {
      numVehicles: numRiders,
      numPickups: numOrders,
      vehicleCapacity: buildRangeValues(numRiders, capacityMin, capacityMax),
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
            <span className="mode-section-label">Vehicle Type</span>
            <div className="mode-vehicle-toggle">
              {VEHICLE_TYPES.map((type) => {
                const cfg = VEHICLE_TYPE_CONFIG[type];
                const Icon = VEHICLE_TYPE_ICONS[type];
                const isActive = vehicleType === type;
                return (
                  <button
                    key={type}
                    type="button"
                    className={`mode-vehicle-card ${
                      isActive ? "mode-vehicle-card--active" : ""
                    }`}
                    onClick={() => handleVehicleTypeChange(type)}
                  >
                    <span className="mode-vehicle-badge">
                      {cfg.capacityKg} KG
                    </span>
                    <Icon className="mode-vehicle-icon" />
                    <span className="mode-vehicle-title">{cfg.label}</span>
                    <span className="mode-vehicle-subtitle">
                      {cfg.subtitle}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

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

          <CollapsibleSection
            title="Rider Capacity"
            open={riderSettingsOpen}
            onToggle={() => setRiderSettingsOpen((v) => !v)}
          >
            <div className="mode-field-row mode-toggle-row">
              <div className="mode-field-row">
                <span className="field-label">Custom Capacity</span>
                <RiInformationLine
                  className="mode-info-icon"
                  title="Override the vehicle type's fixed capacity with your own range."
                />
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={customCapacityEnabled}
                className={`mode-toggle-switch ${
                  customCapacityEnabled ? "mode-toggle-switch--on" : ""
                }`}
                onClick={handleToggleCustomCapacity}
              >
                <span className="mode-toggle-thumb" />
              </button>
            </div>

            {/* Keyed so React remounts on swap — replays the fade/slide-in
                instead of the new panel just popping into place. */}
            {customCapacityEnabled ? (
              <div key="custom" className="mode-capacity-panel">
                <span className="field-label">Capacity Range (kg)</span>
                <div className="mode-range-row">
                  <input
                    type="number"
                    className="field-input mode-range-input"
                    value={capacityMin}
                    min={CAPACITY_FLOOR}
                    max={capacityMax}
                    onChange={(e) => {
                      const raw = Number(e.target.value) || CAPACITY_FLOOR;
                      setCapacityMin(
                        Math.min(Math.max(raw, CAPACITY_FLOOR), capacityMax),
                      );
                    }}
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
                    onChange={(e) => {
                      const raw = Number(e.target.value) || CAPACITY_CEIL;
                      setCapacityMax(
                        Math.max(Math.min(raw, CAPACITY_CEIL), capacityMin),
                      );
                    }}
                  />
                </div>
                {errors.capacity && (
                  <span className="field-error">{errors.capacity}</span>
                )}
                <span className="mode-field-subtext">
                  Average Capacity: {averageCapacity.toFixed(1)} kg
                </span>
              </div>
            ) : (
              <div key="fixed" className="mode-capacity-panel">
                <span className="field-label">Capacity per Rider</span>
                <div className="mode-fixed-capacity">
                  <div className="mode-fixed-capacity-icon">
                    <RiWeightLine />
                  </div>
                  <div className="mode-fixed-capacity-body">
                    <span className="mode-fixed-capacity-value">
                      {activeVehicleConfig.capacityKg}
                      <span className="mode-fixed-capacity-unit"> kg</span>
                    </span>
                    <span className="mode-fixed-capacity-note">
                      Fixed for {activeVehicleConfig.label}s — turn on
                      Custom Capacity to set your own range.
                    </span>
                  </div>
                </div>
                {errors.capacity && (
                  <span className="field-error">{errors.capacity}</span>
                )}
              </div>
            )}
          </CollapsibleSection>

          <CollapsibleSection
            title="Order Settings"
            open={orderSettingsOpen}
            onToggle={() => setOrderSettingsOpen((v) => !v)}
          >
            <div className="mode-field-row">
              <span className="field-label">Order Weight Range (kg)</span>
              <span className="mode-field-hint">
                ({activeVehicleConfig.loadMin} - {activeVehicleConfig.loadMax}
                , {activeVehicleConfig.label})
              </span>
            </div>
            <div className="mode-range-row">
              <input
                type="number"
                className="field-input mode-range-input"
                value={loadMin}
                min={activeVehicleConfig.loadMin}
                max={loadMax}
                onChange={(e) => {
                  const raw = Number(e.target.value) || activeVehicleConfig.loadMin;
                  setLoadMin(
                    Math.min(
                      Math.max(raw, activeVehicleConfig.loadMin),
                      loadMax,
                    ),
                  );
                }}
              />
              <RangeSlider
                min={activeVehicleConfig.loadMin}
                max={activeVehicleConfig.loadMax}
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
                max={activeVehicleConfig.loadMax}
                onChange={(e) => {
                  const raw = Number(e.target.value) || activeVehicleConfig.loadMax;
                  setLoadMax(
                    Math.max(
                      Math.min(raw, activeVehicleConfig.loadMax),
                      loadMin,
                    ),
                  );
                }}
              />
            </div>
            {errors.load && (
              <span className="field-error">{errors.load}</span>
            )}
            <span className="mode-field-subtext">
              Average Weight: {averageLoad.toFixed(1)} kg
            </span>
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