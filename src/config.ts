export const APP_CONFIG = {
  APP_NAME: "CVRP Demo",

  DEFAULT_CENTER: {
    lat: 12.9716,
    lng: 77.5946,
  },

  DEFAULT_ZOOM: 11,

  MIN_VEHICLES: 1,

  MAX_VEHICLES: 20,

  MIN_PICKUPS: 1,

  MAX_PICKUPS: 30,

  API_TIMEOUT: 30000,

  COLORS: {
    background: "#020817",

    panel: "#081225",

    border: "#13213a",

    teal: "#2dd4bf",

    orange: "#fb923c",
  },
};

export const BENGALURU_BOUNDS = {
  minLat: 12.834,

  maxLat: 13.1437,

  minLng: 77.46,

  maxLng: 77.784,
};


function readEnv(key: string): string {
  const value = import.meta.env[key];
  if (!value) {
    console.warn(`[config] Missing env var "${key}".`);
    return "";
  }
  return value;
}

export interface ApiConfig {
  ENV: string;
  IS_STAGING: boolean;
  BASE_URL: string;
  OPTIMIZE_ENDPOINT: string;
  FLEET_SIZE_ENDPOINT: string;
  STAGING_TOKEN: string;
}

export const API_CONFIG: ApiConfig = {
  ENV: import.meta.env.VITE_ENV ?? "staging",
  IS_STAGING: (import.meta.env.VITE_ENV ?? "staging") === "staging",
  BASE_URL: readEnv("VITE_API_BASE_URL"),
  OPTIMIZE_ENDPOINT: readEnv("VITE_OPTIMIZE_ENDPOINT"),
  FLEET_SIZE_ENDPOINT: readEnv("VITE_FLEET_SIZE_ENDPOINT"),
  STAGING_TOKEN: import.meta.env.VITE_STAGING_TOKEN ?? "",
};

// ─────────────────────────────────────────────────────────────
// OSRM road-routing configuration
// ─────────────────────────────────────────────────────────────

function readNumberEnv(key: string, fallback: number): number {
  const raw = import.meta.env[key];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    console.warn(`[config] Invalid number for "${key}" — using ${fallback}.`);
    return fallback;
  }
  return parsed;
}

export interface OsrmConfig {
  ENABLED: boolean;
  
  BASE_URL: string;
  
  PROFILE: string;
  
  MAX_WAYPOINTS_PER_REQUEST: number;
  
  MAX_CONCURRENT_REQUESTS: number;
  
  REQUEST_TIMEOUT_MS: number;
  
  MAX_RETRIES: number;
  
  RETRY_DELAY_MS: number;
}

export const OSRM_CONFIG: OsrmConfig = {
  ENABLED: (import.meta.env.VITE_OSRM_ENABLED ?? "true") !== "false",
  BASE_URL: (
    import.meta.env.VITE_OSRM_BASE_URL ?? "https://router.project-osrm.org"
  ).replace(/\/+$/, ""),
  PROFILE: import.meta.env.VITE_OSRM_PROFILE ?? "driving",
  MAX_WAYPOINTS_PER_REQUEST: readNumberEnv(
    "VITE_OSRM_MAX_WAYPOINTS_PER_REQUEST",
    24,
  ),
  MAX_CONCURRENT_REQUESTS: readNumberEnv("VITE_OSRM_MAX_CONCURRENT", 4),
  REQUEST_TIMEOUT_MS: readNumberEnv("VITE_OSRM_TIMEOUT_MS", 15000),
  MAX_RETRIES: 1,
  RETRY_DELAY_MS: 600,
};

// ─────────────────────────────────────────────────────────────
// Basemap tiles
// ─────────────────────────────────────────────────────────────

export interface BasemapLayer {
  id: string;
  name: string;
  url: string;
  attribution: string;
  maxZoom: number;
  maxNativeZoom?: number;
}

export const MAPTILER_KEY: string = import.meta.env.VITE_MAPTILER_KEY ?? "";

export const MAP_MAX_ZOOM = 22;

const MAPTILER_ATTRIBUTION =
  '<a href="https://www.maptiler.com/copyright/" target="_blank" rel="noreferrer">&copy; MapTiler</a> ' +
  '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">&copy; OpenStreetMap contributors</a>';

const OSM_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors';

const ESRI_ATTRIBUTION =
  "Tiles &copy; Esri — Source: Esri, Maxar, Earthstar Geographics";

const SATELLITE_URL =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";

function maptilerRasterUrl(style: string): string {
  return `https://api.maptiler.com/maps/${style}/{z}/{x}/{y}{r}.png?key=${MAPTILER_KEY}`;
}

const STREET_STYLE = import.meta.env.VITE_MAPTILER_STREET_STYLE ?? "dataviz";
const DARK_STYLE = import.meta.env.VITE_MAPTILER_DARK_STYLE ?? "dataviz-dark";

export const HAS_MAPTILER_KEY = MAPTILER_KEY.trim().length > 0;

const OSM_FALLBACK: BasemapLayer = {
  id: "street",
  name: "Street",
  url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
  attribution: OSM_ATTRIBUTION,
  maxZoom: MAP_MAX_ZOOM,
  maxNativeZoom: 19,
};

if (!HAS_MAPTILER_KEY) {
  console.warn(
    "[config] VITE_MAPTILER_KEY is not set — falling back to OpenStreetMap " +
      "raster tiles. Set the key in .env to restore the MapTiler basemaps.",
  );
}

export const DEFAULT_BASEMAP_ID: string =
  import.meta.env.VITE_MAP_DEFAULT_BASEMAP ?? "street";

export const BASEMAPS: BasemapLayer[] = HAS_MAPTILER_KEY
  ? [
      {
        id: "street",
        name: "Street",
        url: maptilerRasterUrl(STREET_STYLE),
        attribution: MAPTILER_ATTRIBUTION,
        maxZoom: MAP_MAX_ZOOM,
      },
      {
        id: "satellite",
        name: "Satellite",
        url: SATELLITE_URL,
        attribution: ESRI_ATTRIBUTION,
        maxZoom: MAP_MAX_ZOOM,
        maxNativeZoom: 19,
      },
      {
        id: "dark",
        name: "Dark",
        url: maptilerRasterUrl(DARK_STYLE),
        attribution: MAPTILER_ATTRIBUTION,
        maxZoom: MAP_MAX_ZOOM,
      },
    ]
  : [
      OSM_FALLBACK,
      {
        id: "satellite",
        name: "Satellite",
        url: SATELLITE_URL,
        attribution: ESRI_ATTRIBUTION,
        maxZoom: MAP_MAX_ZOOM,
        maxNativeZoom: 19,
      },
    ];

export function defaultBasemapIndex(): number {
  const index = BASEMAPS.findIndex((layer) => layer.id === DEFAULT_BASEMAP_ID);
  return index >= 0 ? index : 0;
}