import { OSRM_CONFIG } from "../config";

export type LatLng = [number, number];

export interface RoadLeg {
  distanceKm: number;
  durationMin: number;
}

export interface RoadPath {
  geometry: LatLng[];
  distanceKm: number;
  durationMin: number;
  legs: RoadLeg[];
  source: "road" | "straight";
  /** Farthest an input coordinate had to be snapped to reach a road, in metres. */
  maxSnapDistanceM?: number;
}

export type OsrmErrorCode =
  | "DISABLED"
  | "TOO_FEW_POINTS"
  | "NETWORK"
  | "TIMEOUT"
  | "HTTP"
  | "NO_ROUTE"
  | "PARSE";

export class OsrmError extends Error {
  constructor(
    message: string,
    public readonly code: OsrmErrorCode,
  ) {
    super(message);
    this.name = "OsrmError";
  }
}

interface OsrmRouteResponse {
  code?: string;
  message?: string;
  waypoints?: { distance?: number }[];
  routes?: {
    geometry?: string;
    distance?: number;
    duration?: number;
    legs?: { distance?: number; duration?: number }[];
  }[];
}

// ─────────────────────────────────────────────────────────────
// Pure geometry helpers
// ─────────────────────────────────────────────────────────────

const EARTH_RADIUS_KM = 6371;

export function haversineKm(a: LatLng, b: LatLng): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b[0] - a[0]);
  const dLng = toRad(b[1] - a[1]);
  const lat1 = toRad(a[0]);
  const lat2 = toRad(b[0]);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;

  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function polylineLengthKm(points: LatLng[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += haversineKm(points[i - 1], points[i]);
  }
  return total;
}

export function bearingDeg(a: LatLng, b: LatLng): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const phi1 = toRad(a[0]);
  const phi2 = toRad(b[0]);
  const dLng = toRad(b[1] - a[1]);

  const y = Math.sin(dLng) * Math.cos(phi2);
  const x =
    Math.cos(phi1) * Math.sin(phi2) -
    Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLng);

  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** Decodes an OSRM/Google "polyline6" encoded string into [lat, lng] points. */
export function decodePolyline(encoded: string, precision = 6): LatLng[] {
  if (!encoded) return [];

  const factor = 10 ** precision;
  const points: LatLng[] = [];
  const len = encoded.length;

  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < len) {
    let result = 0;
    let shift = 0;
    let byte = 0;

    do {
      if (index >= len) return points;
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;

    result = 0;
    shift = 0;
    do {
      if (index >= len) return points;
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;

    points.push([lat / factor, lng / factor]);
  }

  return points;
}

/** Splits a long waypoint list into OSRM-sized chunks, each overlapping the previous by one point so they stitch together. */
export function chunkWaypoints(
  waypoints: LatLng[],
  maxPerRequest: number,
): LatLng[][] {
  const size = Math.max(2, Math.floor(maxPerRequest));
  if (waypoints.length <= size) return [waypoints];

  const chunks: LatLng[][] = [];
  let start = 0;

  while (start < waypoints.length - 1) {
    const end = Math.min(start + size, waypoints.length);
    chunks.push(waypoints.slice(start, end));
    start = end - 1;
  }

  return chunks;
}

export function straightLinePath(waypoints: LatLng[]): RoadPath {
  const legs: RoadLeg[] = [];
  for (let i = 1; i < waypoints.length; i++) {
    const distanceKm = haversineKm(waypoints[i - 1], waypoints[i]);
    legs.push({
      distanceKm,
      durationMin: (distanceKm / 25) * 60,
    });
  }

  return {
    geometry: waypoints.slice(),
    distanceKm: legs.reduce((sum, leg) => sum + leg.distanceKm, 0),
    durationMin: legs.reduce((sum, leg) => sum + leg.durationMin, 0),
    legs,
    source: "straight",
  };
}

export function sampleDirectionMarkers(
  points: LatLng[],
  desiredCount: number,
): { position: LatLng; bearing: number }[] {
  if (points.length < 2 || desiredCount < 1) return [];

  const cumulative: number[] = [0];
  for (let i = 1; i < points.length; i++) {
    cumulative.push(cumulative[i - 1] + haversineKm(points[i - 1], points[i]));
  }

  const total = cumulative[cumulative.length - 1];
  if (total <= 0) return [];

  const markers: { position: LatLng; bearing: number }[] = [];
  const step = total / (desiredCount + 1);

  let vertex = 1;
  for (let n = 1; n <= desiredCount; n++) {
    const target = step * n;
    while (vertex < cumulative.length - 1 && cumulative[vertex] < target) {
      vertex++;
    }

    const prev = points[vertex - 1];
    const next = points[vertex];
    const spanStart = cumulative[vertex - 1];
    const spanLength = cumulative[vertex] - spanStart;
    const t = spanLength > 0 ? (target - spanStart) / spanLength : 0;

    markers.push({
      position: [
        prev[0] + (next[0] - prev[0]) * t,
        prev[1] + (next[1] - prev[1]) * t,
      ],
      bearing: bearingDeg(prev, next),
    });
  }

  return markers;
}

// ─────────────────────────────────────────────────────────────
// Request plumbing
// ─────────────────────────────────────────────────────────────

function toOsrmCoordinates(waypoints: LatLng[]): string {
  return waypoints
    .map(([lat, lng]) => `${lng.toFixed(6)},${lat.toFixed(6)}`)
    .join(";");
}

export function buildRouteUrl(waypoints: LatLng[]): string {
  const base = OSRM_CONFIG.BASE_URL.replace(/\/+$/, "");
  const query = new URLSearchParams({
    overview: "full",
    geometries: "polyline6",
    steps: "false",
    annotations: "false",
    continue_straight: "false",
  });

  return `${base}/route/v1/${OSRM_CONFIG.PROFILE}/${toOsrmCoordinates(
    waypoints,
  )}?${query.toString()}`;
}

function cacheKey(waypoints: LatLng[]): string {
  return `${OSRM_CONFIG.BASE_URL}|${OSRM_CONFIG.PROFILE}|${toOsrmCoordinates(
    waypoints,
  )}`;
}

// Caps simultaneous in-flight OSRM requests so a large instance doesn't
// hammer the routing server; excess callers queue FIFO.
let activeRequests = 0;
const waitQueue: (() => void)[] = [];

function acquireSlot(): Promise<void> {
  if (activeRequests < OSRM_CONFIG.MAX_CONCURRENT_REQUESTS) {
    activeRequests++;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    waitQueue.push(() => {
      activeRequests++;
      resolve();
    });
  });
}

function releaseSlot(): void {
  activeRequests--;
  const next = waitQueue.shift();
  if (next) next();
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

function backoffDelay(attempt: number): number {
  const base = OSRM_CONFIG.RETRY_DELAY_MS * 2 ** attempt;
  return base + base * 0.25 * Math.random();
}

// Circuit breaker: once OSRM itself looks down (not "no route for this
// pair", but genuinely unreachable), every other in-flight vehicle fails
// fast onto the straight-line fallback instead of each burning its own
// full timeout+retry budget against a server that isn't answering.
const CIRCUIT_FAILURE_THRESHOLD = 3;
const CIRCUIT_COOLDOWN_MS = 15_000;
const SNAP_WARN_THRESHOLD_M = 500;

let consecutiveFailures = 0;
let circuitOpenUntil = 0;

function circuitIsOpen(): boolean {
  return Date.now() < circuitOpenUntil;
}

function recordFailure(): void {
  consecutiveFailures++;
  if (consecutiveFailures >= CIRCUIT_FAILURE_THRESHOLD) {
    circuitOpenUntil = Date.now() + CIRCUIT_COOLDOWN_MS;
  }
}

function recordSuccess(): void {
  consecutiveFailures = 0;
  circuitOpenUntil = 0;
}

async function requestChunk(
  waypoints: LatLng[],
  signal?: AbortSignal,
): Promise<RoadPath> {
  if (circuitIsOpen()) {
    throw new OsrmError(
      "Routing service looks unavailable — skipping retries.",
      "NETWORK",
    );
  }

  const url = buildRouteUrl(waypoints);
  let lastError: OsrmError = new OsrmError("OSRM request failed.", "NETWORK");

  for (let attempt = 0; attempt <= OSRM_CONFIG.MAX_RETRIES; attempt++) {
    if (signal?.aborted) throw new OsrmError("Request aborted.", "NETWORK");

    await acquireSlot();

    const timeoutController = new AbortController();
    const timer = setTimeout(
      () => timeoutController.abort(),
      OSRM_CONFIG.REQUEST_TIMEOUT_MS,
    );
    const onOuterAbort = () => timeoutController.abort();
    signal?.addEventListener("abort", onOuterAbort);

    try {
      const response = await fetch(url, {
        method: "GET",
        signal: timeoutController.signal,
      });

      if (!response.ok) {
        const retryable = response.status === 429 || response.status >= 500;
        lastError = new OsrmError(
          `OSRM responded with HTTP ${response.status}.`,
          "HTTP",
        );
        if (!retryable) throw lastError;
        recordFailure();
      } else {
        const data = (await response.json()) as OsrmRouteResponse;

        if (data.code && data.code !== "Ok") {
          throw new OsrmError(
            data.message ?? `OSRM could not route this leg (${data.code}).`,
            data.code === "NoRoute" || data.code === "NoSegment"
              ? "NO_ROUTE"
              : "PARSE",
          );
        }

        const route = data.routes?.[0];
        if (!route?.geometry) {
          throw new OsrmError("OSRM returned no route geometry.", "NO_ROUTE");
        }

        const geometry = decodePolyline(route.geometry, 6);
        if (geometry.length < 2) {
          throw new OsrmError("OSRM returned an empty geometry.", "PARSE");
        }

        const snapDistances = (data.waypoints ?? []).map(
          (w) => w.distance ?? 0,
        );
        const maxSnapDistanceM = snapDistances.length
          ? Math.max(...snapDistances)
          : undefined;
        if (maxSnapDistanceM && maxSnapDistanceM > SNAP_WARN_THRESHOLD_M) {
          console.warn(
            `[osrm] a waypoint snapped ${Math.round(maxSnapDistanceM)}m from its input coordinate — that stop's location may be off-road or inaccurate.`,
          );
        }

        recordSuccess();
        return {
          geometry,
          distanceKm: (route.distance ?? 0) / 1000,
          durationMin: (route.duration ?? 0) / 60,
          legs: (route.legs ?? []).map((leg) => ({
            distanceKm: (leg.distance ?? 0) / 1000,
            durationMin: (leg.duration ?? 0) / 60,
          })),
          source: "road",
          maxSnapDistanceM,
        };
      }
    } catch (err) {
      if (err instanceof OsrmError) {
        lastError = err;
        if (err.code === "NO_ROUTE") throw err;
      } else if (signal?.aborted) {
        throw new OsrmError("Request aborted.", "NETWORK");
      } else if (timeoutController.signal.aborted) {
        lastError = new OsrmError(
          `OSRM did not respond within ${OSRM_CONFIG.REQUEST_TIMEOUT_MS} ms.`,
          "TIMEOUT",
        );
        recordFailure();
      } else {
        lastError = new OsrmError(
          "Could not reach the routing service.",
          "NETWORK",
        );
        recordFailure();
      }
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onOuterAbort);
      releaseSlot();
    }

    if (circuitIsOpen()) break;
    if (attempt < OSRM_CONFIG.MAX_RETRIES) {
      await sleep(backoffDelay(attempt));
    }
  }

  throw lastError;
}

export function stitchChunks(chunks: RoadPath[]): RoadPath {
  const geometry: LatLng[] = [];
  const legs: RoadLeg[] = [];
  let distanceKm = 0;
  let durationMin = 0;
  let maxSnapDistanceM: number | undefined;

  chunks.forEach((chunk, index) => {
    const points = index === 0 ? chunk.geometry : chunk.geometry.slice(1);
    geometry.push(...points);
    legs.push(...chunk.legs);
    distanceKm += chunk.distanceKm;
    durationMin += chunk.durationMin;
    if (chunk.maxSnapDistanceM !== undefined) {
      maxSnapDistanceM = Math.max(
        maxSnapDistanceM ?? 0,
        chunk.maxSnapDistanceM,
      );
    }
  });

  return { geometry, distanceKm, durationMin, legs, source: "road", maxSnapDistanceM };
}

interface InFlightEntry {
  promise: Promise<RoadPath>;
  controller: AbortController;
  waiters: number;
}

const completedPaths = new Map<string, RoadPath>();
const inFlightPaths = new Map<string, InFlightEntry>();

export function clearRoadRouteCache(): void {
  completedPaths.clear();
  inFlightPaths.clear();
}

export function getCachedRoadPathCount(): number {
  return completedPaths.size;
}

export async function fetchRoadPath(
  waypoints: LatLng[],
  signal?: AbortSignal,
): Promise<RoadPath> {
  if (!OSRM_CONFIG.ENABLED) {
    throw new OsrmError(
      "Road routing is disabled by configuration.",
      "DISABLED",
    );
  }
  if (waypoints.length < 2) {
    throw new OsrmError(
      "At least two waypoints are needed to build a route.",
      "TOO_FEW_POINTS",
    );
  }

  const key = cacheKey(waypoints);

  const done = completedPaths.get(key);
  if (done) return done;

  let entry = inFlightPaths.get(key);

  if (!entry) {
    const controller = new AbortController();
    const created: InFlightEntry = {
      controller,
      waiters: 0,
      // Each chunk is an independent request, so they're fired together
      // rather than one at a time — a rider with 3x the per-request
      // waypoint cap used to take 3x as long to snap for no reason.
      promise: (async () => {
        const chunks = chunkWaypoints(
          waypoints,
          OSRM_CONFIG.MAX_WAYPOINTS_PER_REQUEST,
        );
        const parts = await Promise.all(
          chunks.map((chunk) => requestChunk(chunk, controller.signal)),
        );
        return stitchChunks(parts);
      })(),
    };

    created.promise.then(
      (path) => {
        completedPaths.set(key, path);
        inFlightPaths.delete(key);
      },
      () => {
        inFlightPaths.delete(key);
      },
    );

    inFlightPaths.set(key, created);
    entry = created;
  }

  const active = entry;
  active.waiters++;

  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    active.waiters--;
    if (active.waiters <= 0) {
      // Pulled first so a caller arriving in the same tick attaches to a
      // fresh request rather than one already being cancelled.
      if (inFlightPaths.get(key) === active) inFlightPaths.delete(key);
      active.controller.abort();
    }
  };

  let onAbort: (() => void) | null = null;

  try {
    if (!signal) return await active.promise;

    if (signal.aborted) throw new OsrmError("Request aborted.", "NETWORK");
    const abortSignalled = new Promise<never>((_, reject) => {
      onAbort = () => {
        release();
        reject(new OsrmError("Request aborted.", "NETWORK"));
      };
      signal.addEventListener("abort", onAbort);
    });

    return await Promise.race([active.promise, abortSignalled]);
  } finally {
    if (onAbort) signal?.removeEventListener("abort", onAbort);
    release();
  }
}

export async function fetchRoadPathOrStraight(
  waypoints: LatLng[],
  signal?: AbortSignal,
): Promise<{ path: RoadPath; error: OsrmError | null }> {
  try {
    return { path: await fetchRoadPath(waypoints, signal), error: null };
  } catch (err) {
    const error =
      err instanceof OsrmError
        ? err
        : new OsrmError("Unexpected routing failure.", "NETWORK");
    return { path: straightLinePath(waypoints), error };
  }
}

/** Human-readable reason shown in the map's routing-status chip. */
export function describeOsrmError(error: OsrmError): string {
  switch (error.code) {
    case "DISABLED":
      return "Road routing is turned off — showing straight lines.";
    case "TIMEOUT":
      return "The routing service timed out — showing straight lines.";
    case "NETWORK":
      return "Could not reach the routing service — showing straight lines.";
    case "HTTP":
      return `${error.message} Showing straight lines.`;
    case "NO_ROUTE":
      return "No drivable road path between some stops — showing straight lines.";
    case "TOO_FEW_POINTS":
      return "Not enough stops to build a road route.";
    default:
      return "Road routing failed — showing straight lines.";
  }
}
