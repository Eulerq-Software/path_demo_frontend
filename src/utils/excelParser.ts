// src/utils/excelParser.ts

import * as XLSX from "xlsx";
import type { Node, Rider, Pickup, CVRPInstance } from "../types/cvrp";

export interface ExcelParseResult {
  nodes: Node[];
  instance: CVRPInstance;
}

export interface LocationParseResult {
  depot: { id: string; lat: number; lon: number } | null;
  locations: Array<{ id: string; lat: number; lon: number }>;
  warnings: string[];
  fatalError?: string;
}

const DEPOT_ID = "DEPOT";
const FALLBACK_DEPOT_LAT = 12.9716;
const FALLBACK_DEPOT_LNG = 77.5946;
const BBOX = { latMin: 12.7, latMax: 13.2, lonMin: 77.4, lonMax: 77.8 };

function riderId(index: number): string {
  return `R${String(index + 1).padStart(3, "0")}`;
}

function pickupId(index: number): string {
  if (index === 0) return DEPOT_ID;
  return `P${String(index).padStart(3, "0")}`;
}

function getSheet(
  workbook: XLSX.WorkBook,
  keywords: string[],
  fallbackIndex: number,
): XLSX.WorkSheet | null {
  const normalise = (s: string) => s.toLowerCase().replace(/[\s\-–—_]+/g, "");

  for (const name of workbook.SheetNames) {
    const n = normalise(name);
    if (keywords.some((kw) => n.includes(normalise(kw)))) {
      return workbook.Sheets[name];
    }
  }

  const fallback = workbook.SheetNames[fallbackIndex];
  return fallback ? workbook.Sheets[fallback] : null;
}

function inBangaloreBounds(lat: number, lon: number): boolean {
  return (
    lat >= BBOX.latMin &&
    lat <= BBOX.latMax &&
    lon >= BBOX.lonMin &&
    lon <= BBOX.lonMax
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Parameters sheet parser  (used by parseExcelFile — multi-sheet format)
// ─────────────────────────────────────────────────────────────────────────────

interface Config {
  num_vehicles: number;
  num_pickups: number;
  vehicle_capacity: number;
  pickup_load: number[];
}

function parseParametersSheet(sheet: XLSX.WorkSheet): Config {
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: null,
  });

  const map = new Map<string, string>();

  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 2) continue;
    const rawKey = String(row[0] ?? "").trim();
    const rawVal = String(row[1] ?? "").trim();
    if (!rawKey || !rawVal || rawVal === "null") continue;
    const key = rawKey.toLowerCase().replace(/[\s\-–—]+/g, "_");
    map.set(key, rawVal);
  }

  const require = (key: string): string => {
    const v = map.get(key);
    if (!v)
      throw new Error(
        `Parameters sheet: required key "${key}" is missing or empty.`,
      );
    return v;
  };

  const num_vehicles = parseInt(require("num_vehicles"), 10);
  const num_pickups = parseInt(require("num_pickups"), 10);
  const vehicle_capacity = parseInt(require("vehicle_capacity"), 10);

  const pickup_load = require("pickup_load")
    .split(",")
    .map((s) => parseInt(s.trim(), 10));

  if (isNaN(num_vehicles) || num_vehicles < 1)
    throw new Error("Parameters: num_vehicles must be a positive integer.");

  if (isNaN(num_pickups) || num_pickups < 1)
    throw new Error("Parameters: num_pickups must be a positive integer.");

  if (isNaN(vehicle_capacity) || vehicle_capacity < 1)
    throw new Error("Parameters: vehicle_capacity must be a positive integer.");

  if (pickup_load.some(isNaN))
    throw new Error(
      "Parameters: pickup_load contains a non-numeric value. " +
        "Use comma-separated integers, e.g. 1, 1, 1, 1.",
    );

  if (pickup_load.length !== num_pickups)
    throw new Error(
      `Parameters: pickup_load has ${pickup_load.length} value(s) but ` +
        `num_pickups = ${num_pickups}. The count must match.`,
    );

  const totalLoad = pickup_load.reduce((s, v) => s + v, 0);
  const fleetCapacity = num_vehicles * vehicle_capacity;
  if (totalLoad > fleetCapacity)
    throw new Error(
      `Parameters: total demand (${totalLoad}) exceeds fleet capacity ` +
        `(${num_vehicles} × ${vehicle_capacity} = ${fleetCapacity}). ` +
        `Increase num_vehicles or vehicle_capacity.`,
    );

  return { num_vehicles, num_pickups, vehicle_capacity, pickup_load };
}

// ─────────────────────────────────────────────────────────────────────────────
// Coordinates sheet parser  (used by parseExcelFile — multi-sheet format)
// ─────────────────────────────────────────────────────────────────────────────

function parseCoordinatesSheet(sheet: XLSX.WorkSheet, config: Config): Node[] {
  const raw = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: null,
  });

  // Drop header row if first cell is a text label
  const firstRow = (raw[0] ?? []) as unknown[];
  const hasHeader =
    typeof firstRow[0] === "string" && isNaN(Number(firstRow[0]));
  const dataRows = hasHeader ? raw.slice(1) : raw;

  const expectedRows = config.num_pickups + 1; // 1 depot + pickups
  if (dataRows.length !== expectedRows)
    throw new Error(
      `Coordinates sheet: expected ${expectedRows} rows ` +
        `(1 depot + ${config.num_pickups} pickups), found ${dataRows.length}.`,
    );

  return dataRows.map((row, idx) => {
    const r = row as unknown[];
    const lat = Number(r[0]);
    const lng = Number(r[1]);

    if (isNaN(lat) || isNaN(lng))
      throw new Error(
        `Coordinates row ${idx + 1}: could not read lat/lng — ` +
          `got (${r[0]}, ${r[1]}). ` +
          "Column A must be latitude, Column B must be longitude.",
      );

    if (lat < -90 || lat > 90)
      throw new Error(
        `Coordinates row ${idx + 1}: latitude ${lat} is out of range [-90, 90].`,
      );

    if (lng < -180 || lng > 180)
      throw new Error(
        `Coordinates row ${idx + 1}: longitude ${lng} is out of range [-180, 180].`,
      );

    return {
      id: idx,
      type: (idx === 0 ? "depot" : "pickup") as "depot" | "pickup",
      lat,
      lng,
      demand: idx === 0 ? 0 : config.pickup_load[idx - 1],
    } satisfies Node;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Build V1.1 CVRPInstance from config + nodes
// ─────────────────────────────────────────────────────────────────────────────

function buildInstanceFromConfig(config: Config, nodes: Node[]): CVRPInstance {
  const riders: Rider[] = Array.from(
    { length: config.num_vehicles },
    (_, i) => ({
      id: riderId(i),
      capacity: config.vehicle_capacity,
    }),
  );

  const pickups: Pickup[] = nodes.map((n, idx) => ({
    id: pickupId(idx),
    lat: n.lat,
    lon: n.lng, // Node uses "lng"; Pickup V1.1 uses "lon"
    load: n.demand,
    is_depot: n.type === "depot",
  }));

  return { riders, pickups };
}

// ─────────────────────────────────────────────────────────────────────────────
// parseExcelFile — existing multi-sheet format (Parameters + Coordinates)
// Kept for any existing usage; now produces V1.1 output.
// ─────────────────────────────────────────────────────────────────────────────

export async function parseExcelFile(file: File): Promise<ExcelParseResult> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array" });

  if (workbook.SheetNames.length < 2)
    throw new Error(
      "Excel file must have at least 2 sheets: " +
        "Sheet 1 (Parameters) and Sheet 2 (Coordinates).",
    );

  // Sheet 1: Parameters
  const paramSheet = getSheet(workbook, ["parameter", "config", "setting"], 0);
  if (!paramSheet)
    throw new Error("Could not find the Parameters sheet (Sheet 1).");

  const config = parseParametersSheet(paramSheet);

  // Sheet 2: Coordinates
  const coordSheet = getSheet(
    workbook,
    ["coordinate", "coord", "location", "gps"],
    1,
  );
  if (!coordSheet)
    throw new Error(
      "Could not find the Coordinates sheet (Sheet 2). " +
        "It must contain lat/lng columns.",
    );

  const nodes = parseCoordinatesSheet(coordSheet, config);
  const instance = buildInstanceFromConfig(config, nodes);

  return { nodes, instance };
}

// ─────────────────────────────────────────────────────────────────────────────
// parseLocationFile — simple single-sheet format for the Upload button.
//
// Accepts a CSV or Excel file with columns:
//   - "id"  (also accepts: "ID", "Id") — optional; auto-generated if absent
//   - "lat" (also accepts: "latitude")
//   - "lon" (also accepts: "lng", "longitude")
//
// ROW 1 = DEPOT  → returned as `depot`
// ROW 2+ = PICKUPS → returned as `locations`
//
// Rows outside Bengaluru bounds are skipped with a warning.
// ─────────────────────────────────────────────────────────────────────────────

const ID_ALIASES = ["id"];
const LAT_ALIASES = ["lat", "latitude"];
const LON_ALIASES = ["lon", "lng", "longitude"];

function findColKey(headers: string[], aliases: string[]): string | undefined {
  return headers.find((h) => aliases.includes(h.toLowerCase().trim()));
}

export async function parseLocationFile(
  file: File,
): Promise<LocationParseResult> {
  return new Promise((resolve) => {
    const reader = new FileReader();

    const fatal = (msg: string): void =>
      resolve({ depot: null, locations: [], warnings: [], fatalError: msg });

    reader.onerror = () => fatal("Could not read the file.");

    reader.onload = (e) => {
      try {
        const data = e.target?.result;
        let workbook: XLSX.WorkBook;

        if (file.name.toLowerCase().endsWith(".csv")) {
          workbook = XLSX.read(data as string, { type: "string" });
        } else {
          workbook = XLSX.read(data as ArrayBuffer, { type: "array" });
        }

        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
          defval: "",
        });

        if (rows.length === 0) {
          fatal("The file is empty.");
          return;
        }

        const headers = Object.keys(rows[0]);
        const idKey = findColKey(headers, ID_ALIASES); // optional
        const latKey = findColKey(headers, LAT_ALIASES);
        const lonKey = findColKey(headers, LON_ALIASES);

        if (!latKey) {
          fatal(
            `No latitude column found. Expected one of: ${LAT_ALIASES.join(", ")}. ` +
              `Found: ${headers.join(", ")}`,
          );
          return;
        }

        if (!lonKey) {
          fatal(
            `No longitude column found. Expected one of: ${LON_ALIASES.join(", ")}. ` +
              `Found: ${headers.join(", ")}`,
          );
          return;
        }

        if (rows.length < 2) {
          fatal(
            "File must have at least 2 data rows: row 1 is the depot, row 2+ are pickups.",
          );
          return;
        }

        // Validate and collect all valid rows
        const validRows: Array<{ id: string; lat: number; lon: number }> = [];
        const warnings: string[] = [];

        rows.forEach((row, i) => {
          const rowNum = i + 2; // +1 for header, +1 for 1-indexing
          const rawLat = row[latKey];
          const rawLon = row[lonKey];

          if (rawLat === "" || rawLat == null) {
            warnings.push(`Row ${rowNum}: latitude is empty — skipped.`);
            return;
          }
          if (rawLon === "" || rawLon == null) {
            warnings.push(`Row ${rowNum}: longitude is empty — skipped.`);
            return;
          }

          const lat = Number(rawLat);
          const lon = Number(rawLon);

          if (isNaN(lat)) {
            warnings.push(
              `Row ${rowNum}: "${rawLat}" is not a valid latitude — skipped.`,
            );
            return;
          }
          if (isNaN(lon)) {
            warnings.push(
              `Row ${rowNum}: "${rawLon}" is not a valid longitude — skipped.`,
            );
            return;
          }
          if (!inBangaloreBounds(lat, lon)) {
            warnings.push(
              `Row ${rowNum}: (${lat}, ${lon}) is outside the Bengaluru region — skipped.`,
            );
            return;
          }

          // Use id from file if present and non-empty, otherwise auto-generate
          const rawId = idKey ? String(row[idKey] ?? "").trim() : "";
          const id = rawId !== "" ? rawId : pickupId(validRows.length);

          validRows.push({ id, lat, lon });
        });

        if (validRows.length === 0) {
          fatal("No valid rows found in the file after validation.");
          return;
        }

        if (validRows.length < 2) {
          fatal(
            "After skipping invalid rows, only 1 valid row remains. " +
              "Need at least 2: row 1 as depot and at least 1 pickup.",
          );
          return;
        }

        // Row 1 → depot, remaining → pickups
        const depot = validRows[0];
        const locations = validRows.slice(1);

        resolve({ depot, locations, warnings });
      } catch {
        fatal(
          "Failed to parse file. Make sure it is a valid CSV or Excel (.xlsx) file.",
        );
      }
    };

    if (file.name.toLowerCase().endsWith(".csv")) {
      reader.readAsText(file);
    } else {
      reader.readAsArrayBuffer(file);
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// buildInstanceFromLocations — converts parsed locations into a full
// CVRPInstance ready to pass to the solvers.
//
// depotOverride: pass the `depot` field from parseLocationFile() so the
// first row of the uploaded file is used as the depot.
// If omitted (e.g. when using the Generate button), the fallback depot
// coordinates are used instead.
// ─────────────────────────────────────────────────────────────────────────────

export function buildInstanceFromLocations(
  locations: Array<{ id: string; lat: number; lon: number }>,
  numVehicles: number,
  vehicleCapacity: number,
  depotOverride?: { id: string; lat: number; lon: number },
): { nodes: Node[]; instance: CVRPInstance } {
  const depotCoords = depotOverride ?? {
    id: DEPOT_ID,
    lat: FALLBACK_DEPOT_LAT,
    lon: FALLBACK_DEPOT_LNG,
  };

  const depotPickup: Pickup = {
    id: depotCoords.id || DEPOT_ID,
    lat: depotCoords.lat,
    lon: depotCoords.lon,
    load: 0,
    is_depot: true,
  };

  const stopPickups: Pickup[] = locations.map((loc, i) => ({
    id: loc.id || pickupId(i + 1), // use file id, fallback to auto-generated
    lat: loc.lat,
    lon: loc.lon,
    load: 1, // default load per pickup = 1
    is_depot: false,
  }));

  const pickups: Pickup[] = [depotPickup, ...stopPickups];

  const riders: Rider[] = Array.from({ length: numVehicles }, (_, i) => ({
    id: riderId(i),
    capacity: vehicleCapacity,
  }));

  // Build Node[] for the map renderer (uses "lng" not "lon")
  const nodes: Node[] = pickups.map((p, idx) => ({
    id: idx,
    type: p.is_depot ? ("depot" as const) : ("pickup" as const),
    lat: p.lat,
    lng: p.lon,
    demand: p.load,
  }));

  return { nodes, instance: { riders, pickups } };
}

// ─────────────────────────────────────────────────────────────────────────────
// downloadLocationTemplate — triggers a browser download of a sample CSV.
// Row 1 = depot, rows 2+ = pickups.
// ─────────────────────────────────────────────────────────────────────────────

export function downloadLocationTemplate(): void {
  const csv = [
    "id,lat,lon",
    "DEPOT,12.9716,77.5946", // Row 1: depot
    "P001,12.9352,77.6245", // Row 2: pickup 1
    "P002,12.9279,77.6271", // Row 3: pickup 2
    "P003,12.9850,77.6050", // Row 4: pickup 3
    "P004,12.9611,77.6387", // Row 5: pickup 4
    "P005,12.9500,77.5800", // Row 6: pickup 5
  ].join("\n");

  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "bangalore_pickups_template.csv";
  a.click();
  URL.revokeObjectURL(url);
}
