import { SERIES } from "../src/series.js";
import { readFileSync, writeFileSync, existsSync } from "fs";
import sharp from "sharp";

const MAPBOX_USERNAME = "ggponti74";
const LIGHT_STYLE_ID = "cmu32mlz4009r01p73i8bbi7t";
const DARK_STYLE_ID = "cmu32mwnm009s01p75fev0fzf";

const MAPBOX_TOKEN = process.env.MAPBOX_TOKEN;
const CACHE_PATH = "public/data/venue-geo-cache.json";
const OUTPUT_DIR = "public/images/maps";

const MAP_WIDTH = 600;
const MAP_HEIGHT = 400;

const MIN_BBOX_SPAN_DEG = 4; // tune once you see Monaco/Vatican render

function slugify(str) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

async function ensureMapImages(race, entry) {
  const { cityCenter, boundaryBbox, iso } = entry;
  const citySlug = slugify(race.city);

  for (const theme of ["light", "dark"]) {
    const outPath = `${OUTPUT_DIR}/${iso}-${citySlug}-${theme}.jpg`;
    if (existsSync(outPath)) continue;

    const jpg = await fetchStaticMap({ bbox: boundaryBbox, cityCenter, theme });
    writeFileSync(outPath, jpg);
  }
}

function project(lon, lat, bbox, pixelWidth, pixelHeight) {
  const [minLon, minLat, maxLon, maxLat] = bbox;

  const lonToX = (lon) => ((lon - minLon) / (maxLon - minLon)) * pixelWidth;

  const latToMercY = (latDeg) => {
    const latRad = (latDeg * Math.PI) / 180;
    return Math.log(Math.tan(Math.PI / 4 + latRad / 2));
  };

  const mercMinLat = latToMercY(minLat);
  const mercMaxLat = latToMercY(maxLat);
  const mercLat = latToMercY(lat);

  const y = ((mercMaxLat - mercLat) / (mercMaxLat - mercMinLat)) * pixelHeight;

  return { x: lonToX(lon), y };
}

async function compositeCityDot(jpgBuffer, { cityCenter, bbox, theme }) {
  const pixelWidth = MAP_WIDTH * 2;
  const pixelHeight = MAP_HEIGHT * 2;

  const { x, y } = project(
    cityCenter[0],
    cityCenter[1],
    bbox,
    pixelWidth,
    pixelHeight,
  );

  const ringColor = theme === "dark" ? "#ffffff" : "#111111";
  const ringRadius = 14;

  const overlaySvg = `
    <svg width="${pixelWidth}" height="${pixelHeight}" xmlns="http://www.w3.org/2000/svg">
      <circle cx="${x}" cy="${y}" r="${ringRadius}" fill="none" stroke="${ringColor}" stroke-width="3"/>
    </svg>
  `;

  return sharp(jpgBuffer)
    .composite([{ input: Buffer.from(overlaySvg), top: 0, left: 0 }])
    .jpeg({ quality: 85 })
    .toBuffer();
}

function centerBboxOnCity(
  countryBbox,
  cityCenter,
  minSpan = MIN_BBOX_SPAN_DEG,
  paddingFactor = 2.4,
) {
  const [minLon, minLat, maxLon, maxLat] = countryBbox;
  const lonSpan = Math.max((maxLon - minLon) * paddingFactor, minSpan);
  const latSpan = Math.max((maxLat - minLat) * paddingFactor, minSpan);

  const [cityLon, cityLat] = cityCenter;

  return [
    cityLon - lonSpan / 2,
    cityLat - latSpan / 2,
    cityLon + lonSpan / 2,
    cityLat + latSpan / 2,
  ];
}

// --- cache helpers ---
function loadCache() {
  if (existsSync(CACHE_PATH)) {
    return JSON.parse(readFileSync(CACHE_PATH, "utf-8"));
  }
  return {};
}

function saveCache(cache) {
  writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2));
}

// --- geocoding ---
async function geocodeCity(cityCountryStr) {
  const url = `https://api.mapbox.com/search/geocode/v6/forward?q=${encodeURIComponent(cityCountryStr)}&types=place&limit=1&access_token=${MAPBOX_TOKEN}`;
  const res = await fetch(url);
  if (!res.ok)
    throw new Error(
      `geocodeCity failed for "${cityCountryStr}": ${res.status}`,
    );
  const data = await res.json();

  const feature = data.features?.[0];
  if (!feature) throw new Error(`No geocode result for "${cityCountryStr}"`);

  const iso =
    feature.properties?.context?.country?.country_code_alpha_3?.toUpperCase();

  return {
    center: feature.geometry.coordinates, // [lon, lat]
    iso,
  };
}

async function geocodeBoundary({ iso, level }) {
  const url = `https://api.mapbox.com/search/geocode/v6/forward?q=${encodeURIComponent(iso)}&types=${level}&limit=1&access_token=${MAPBOX_TOKEN}`;
  const res = await fetch(url);
  if (!res.ok)
    throw new Error(`geocodeBoundary failed for "${iso}": ${res.status}`);
  const data = await res.json();

  const feature = data.features?.[0];
  if (!feature?.properties?.bbox)
    throw new Error(`No bbox in geocode result for "${iso}"`);
  return { bbox: feature.properties.bbox };
}

// --- bbox adjustment ---
function applyMinSizeFloor(bbox, minSpan = MIN_BBOX_SPAN_DEG) {
  const [minLon, minLat, maxLon, maxLat] = bbox;
  const lonSpan = maxLon - minLon;
  const latSpan = maxLat - minLat;

  const lonCenter = (minLon + maxLon) / 2;
  const latCenter = (minLat + maxLat) / 2;

  const finalLonSpan = Math.max(lonSpan, minSpan);
  const finalLatSpan = Math.max(latSpan, minSpan);

  return [
    lonCenter - finalLonSpan / 2,
    latCenter - finalLatSpan / 2,
    lonCenter + finalLonSpan / 2,
    latCenter + finalLatSpan / 2,
  ];
}

function applyPercentPadding(bbox, pct) {
  /* TODO: for IndyCar states */
}

// --- resolving one race entry into a cache record ---
async function resolveVenueGeo(race, cache) {
  const key = `${race.city}, ${race.country}`;
  if (cache[key]) return cache[key]; // already resolved

  const { center, iso } = await geocodeCity(key);
  const { bbox } = await geocodeBoundary({ iso, level: "country" });

  cache[key] = {
    cityCenter: center,
    boundaryType: "country",
    boundaryBbox: centerBboxOnCity(bbox, center),
    iso,
    fetchedAt: new Date().toISOString(),
  };
  return cache[key];
}

// --- image fetch + composite ---
async function fetchStaticMap({
  bbox,
  cityCenter,
  theme,
  width = 600,
  height = 400,
}) {
  const styleId = theme === "dark" ? DARK_STYLE_ID : LIGHT_STYLE_ID;
  const [minLon, minLat, maxLon, maxLat] = bbox;
  const [lon, lat] = cityCenter;

  const markerColor = theme === "dark" ? "ffffff" : "111111";
  const marker = `pin-s+${markerColor}(${lon},${lat})`;

  const url = `https://api.mapbox.com/styles/v1/${MAPBOX_USERNAME}/${styleId}/static/${marker}/[${minLon},${minLat},${maxLon},${maxLat}]/${width}x${height}@2x?access_token=${MAPBOX_TOKEN}`;
console.log( url );
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `fetchStaticMap failed (${theme}): ${res.status} — ${body}`,
    );
  }
console.log(res.status);  
  return Buffer.from(await res.arrayBuffer());
}

async function main() {
  const cache = loadCache();
  for (const series of SERIES) {
    const raw = JSON.parse(
      readFileSync(`public/data/${series.id}-next-race.json`),
    );
    if (!raw) {
      continue;
    }
    const entry = await resolveVenueGeo(raw, cache);
    await ensureMapImages(raw, entry);
  }
  console.log("MAIN END, about to save cache:", cache);
  saveCache(cache);
  console.log("cache saved");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
  
