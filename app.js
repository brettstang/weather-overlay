"use strict";
/* Weather Overlay — every Open-Meteo model on one chart, for many parameters. */

const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const LS = {
  get(k, d) { try { const v = localStorage.getItem("wo:" + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("wo:" + k, JSON.stringify(v)); } catch {} }
};
const fmt = v => v == null || !isFinite(v) ? "–" : (Math.round(v * 10) / 10).toFixed(1).replace(/\.0$/, "");
const mean = a => a.length ? a.reduce((s, b) => s + b, 0) / a.length : null;
const pad = n => String(n).padStart(2, "0");

const MODEL_BY_ID = Object.fromEntries(MODELS.map(m => [m.id, m]));
const META = id => MODEL_BY_ID[id];
const colorOf = id => MODEL_BY_ID[id]?.color || "#aaa";
const patOf = id => MODEL_BY_ID[id]?.pat || 0;
const dashOfModel = id => MODEL_DASH[patOf(id)] || "";
// small line sample (colour + pattern) used in readouts, tables and keys
const swatch = (id, col = colorOf(id), w = 18, dash = dashOfModel(id)) => `<svg class="sw8" viewBox="0 0 ${w} 6" width="${w}" height="6" aria-hidden="true"><line x1="1" y1="3" x2="${w - 1}" y2="3" stroke="${col}" stroke-width="2.4" stroke-dasharray="${dash}" stroke-linecap="${dash.startsWith("1.5") || dash.startsWith("2 ") ? "round" : "butt"}"/></svg>`;

const API = "https://api.open-meteo.com/v1/forecast";
const GEO = "https://geocoding-api.open-meteo.com/v1/search";
const PAST_DAYS = 3, FORECAST_DAYS = 16;
const BASE_VARS = ["temperature_2m", "apparent_temperature", "dew_point_2m", "cloud_cover", "precipitation", "rain", "showers", "snowfall",
                   "wind_speed_10m", "wind_gusts_10m", "wind_direction_10m", "cape", "relative_humidity_2m", "pressure_msl"];
// Models that publish winds on pressure levels (needed for the helicity estimate)
const SRH_MODELS = ["ecmwf_ifs025", "ecmwf_ifs", "gfs_seamless", "gfs_global", "gfs_hrrr", "ncep_nam_conus", "gem_seamless", "gem_global", "gem_regional",
                    "gem_hrdps_continental", "icon_seamless", "icon_global", "icon_eu", "ukmo_seamless", "meteofrance_seamless", "meteofrance_arpege_world",
                    "jma_seamless", "kma_seamless", "cma_grapes_global", "bom_access_global"];
const SRH_LEVELS = [1000, 975, 950, 925, 900, 850, 800, 700, 600, 500];

// ---------- Parameters (tabs) ----------
const PARAMS = {
  temp:   { label: "Temperature", short: "Temp", kind: "temp", v: "temperature_2m", agg: "hilo" },
  feels:  { label: "Feels like", short: "Feels like", kind: "temp", v: "apparent_temperature", agg: "hilo" },
  dew:    { label: "Dew point", short: "Dew point", kind: "temp", v: "dew_point_2m", agg: "hilo" },
  cloud:  { label: "Cloud cover", short: "Cloud", kind: "pct", v: "cloud_cover", agg: "mean", fixed: [0, 100] },
  precip: { label: "Precipitation", short: "Precip", kind: "precip", v: "precipitation", agg: "sum",
            modes: [["acc", "Total"], ["hr", "Hourly"], ["snow", "Snow"]] },
  wind:   { label: "Wind", short: "Wind", kind: "wind", v: "wind_speed_10m", agg: "max", modes: [["both", "Wind + gusts"], ["speed", "Sustained"], ["gust", "Gusts"]] },
  cape:   { label: "CAPE", short: "CAPE", kind: "cape", v: "cape", agg: "max", guides: [[1000, "Moderate"], [2500, "Strong"], [4000, "Extreme"]] },
  srh:    { label: "Helicity", short: "Helicity", kind: "srh", v: "srh", agg: "max", guides: [[150, "Supercell"], [300, "Strong"]], lazy: true },
};
const TABS = ["overview", "temp", "feels", "dew", "cloud", "precip", "wind", "cape", "srh", "custom"];
const TAB_LABEL = { overview: "Overview", temp: "Temp", feels: "Feels like", dew: "Dew point", cloud: "Cloud", precip: "Precip", wind: "Wind", cape: "CAPE", srh: "Helicity", custom: "Custom" };

const S = {
  loc: null, data: null, tab: "overview",
  unit: LS.get("unit", "C"), windU: LS.get("windU", null), precipU: LS.get("precipU", null),
  rsel: LS.get("range", 1), range: 1, start: PAST_DAYS,
  shown: new Set(LS.get("shown", CORE_MODELS)), preset: LS.get("preset", "core"),
  spread: LS.get("spread", true), lines: LS.get("lines", { low: null, high: null, unit: "C" }),
  mode: LS.get("mode2", { precip: LS.get("mode", {}).precip || "acc", wind: "both" }),
  outlook: LS.get("outlook", 10), lead: LS.get("lead", 1),
  cparams: LS.get("cparams", ["temp", "dew", "wind", "gust"]), cmodels: LS.get("cmodels", ["ecmwf_ifs025", "gfs_seamless", "gem_seamless"]), cavg: LS.get("cavg", false), cobs: LS.get("cobs", true), ovModel: LS.get("ovModel", "avg"), ovModels: LS.get("ovModels", ["ecmwf_ifs025", "gfs_seamless", "gem_seamless", "icon_seamless"]), ovRange: LS.get("ovRange", 3), ovObs: LS.get("ovObs", true), ovMin: null,
  sel: "", min: null
};
S.shown.delete("blend");

// Forecast convention: "3 days" = the 3 days after today, so multi-day views show today + N days.
function applyRange() {
  const sel = S.rsel, n = S.data ? S.data.dates.length : 99, room = S.data ? n - Math.min(S.start, todayIdx()) : 99;
  S.range = sel === 1 ? 1 : Math.max(2, Math.min(sel + 1, n, sel >= 10 ? room : n));
}
const QUICK = [
  { name: "New York", admin1: "New York", country: "United States", lat: 40.7128, lon: -74.006 },
  { name: "Chicago", admin1: "Illinois", country: "United States", lat: 41.8781, lon: -87.6298 },
  { name: "Oklahoma City", admin1: "Oklahoma", country: "United States", lat: 35.4676, lon: -97.5164 },
  { name: "Dallas", admin1: "Texas", country: "United States", lat: 32.7767, lon: -96.797 },
  { name: "Toronto", admin1: "Ontario", country: "Canada", lat: 43.6532, lon: -79.3832 },
  { name: "Regina", admin1: "Saskatchewan", country: "Canada", lat: 50.4452, lon: -104.6189 },
  { name: "London", admin1: "England", country: "United Kingdom", lat: 51.5072, lon: -0.1276 },
  { name: "Paris", admin1: "Île-de-France", country: "France", lat: 48.8566, lon: 2.3522 },
  { name: "Tokyo", admin1: "Tokyo", country: "Japan", lat: 35.6762, lon: 139.6503 },
  { name: "Sydney", admin1: "New South Wales", country: "Australia", lat: -33.8688, lon: 151.2093 },
];

// ---------- Units ----------
const windU = () => S.windU || (S.unit === "F" ? "mph" : "kmh");
const precipU = () => S.precipU || (S.unit === "F" ? "in" : "mm");
const WIND_F = { kmh: 1, mph: 0.621371, kn: 0.539957, ms: 1 / 3.6 };
const WIND_L = { kmh: "km/h", mph: "mph", kn: "kt", ms: "m/s" };
const cvT = c => c == null ? null : S.unit === "F" ? c * 9 / 5 + 32 : c;
const tDelta = d => S.unit === "F" ? d * 1.8 : d;
const cvW = k => k == null ? null : k * WIND_F[windU()];
const cvP = mm => mm == null ? null : precipU() === "in" ? mm / 25.4 : mm;
const cvS = cm => cm == null ? null : precipU() === "in" ? cm / 2.54 : cm;
const lineIn = v => v == null || v === "" ? null : S.lines.unit === S.unit ? +v : S.unit === "F" ? v * 9 / 5 + 32 : (v - 32) * 5 / 9;
function unitOf(pk, mode = S.mode[pk]) {
  const k = PARAMS[pk].kind;
  return k === "temp" ? `°${S.unit}` : k === "pct" ? "%" : k === "wind" ? WIND_L[windU()] : k === "cape" ? "J/kg" : k === "srh" ? "m²/s²"
    : mode === "snow" ? (precipU() === "in" ? "in" : "cm") : precipU();
}
function conv(pk, mode = S.mode[pk]) {
  const k = PARAMS[pk].kind;
  return k === "temp" ? cvT : k === "wind" ? cvW : k === "precip" ? (mode === "snow" ? cvS : cvP) : (v => v);
}
function fv(pk, v, mode = S.mode[pk]) {           // format a display value
  if (v == null || !isFinite(v)) return "–";
  const k = PARAMS[pk].kind;
  if (k === "temp") return fmt(v) + "°";
  if (k === "pct") return Math.round(v) + "%";
  if (k === "precip") return (precipU() === "in" ? (Math.round(v * 100) / 100).toFixed(2) : fmt(v));
  return String(Math.round(v));
}
const varOf = (pk, mode = S.mode[pk]) => pk === "precip" && mode === "snow" ? "snowfall" : pk === "wind" && mode === "gust" ? "wind_gusts_10m" : PARAMS[pk].v;
const wgMode = pk => pk === "wind" && S.mode.wind === "both";
const cumulative = (pk, mode = S.mode[pk]) => pk === "precip" && mode !== "hr";

// ---------- Dates ----------
const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WDL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MO = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dObj = d => new Date(d + "T12:00:00Z");
const dayShort = d => { const t = dObj(d); return `${WD[t.getUTCDay()]} ${t.getUTCDate()}`; };
const dayLong = d => { const t = dObj(d); return `${WD[t.getUTCDay()]}, ${MO[t.getUTCMonth()]} ${t.getUTCDate()}`; };

// ---------- Fetching ----------
async function getJSON(url) {
  const r = await fetch(url);
  let j; try { j = await r.json(); } catch { throw new Error(`Server returned ${r.status}`); }
  if (!r.ok || j.error) { const e = new Error(j.reason || `Server returned ${r.status}`); e.reason = j.reason || ""; throw e; }
  return j;
}
const PREV_API = "https://previous-runs-api.open-meteo.com/v1/forecast";
const fcURL = (lat, lon, vars, ids, fdays = FORECAST_DAYS, host = API) =>
  `${host}?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}&hourly=${vars.join(",")}&models=${ids.join(",")}&timezone=auto&past_days=${PAST_DAYS}&forecast_days=${fdays}`;

// One request for many models × variables. Unknown model or variable names are dropped and the request retried.
async function fetchMulti(lat, lon, vars, ids, fdays, host) {
  vars = [...vars]; ids = [...ids];
  for (let i = 0; i < 14; i++) {
    try { return { j: await getJSON(fcURL(lat, lon, vars, ids, fdays, host)), vars, ids }; }
    catch (e) {
      if (e.reason == null) throw e;
      const bad = e.reason.match(/value\s+["']?([A-Za-z0-9_]+)/);
      if (bad && ids.includes(bad[1]) && ids.length > 1) { ids = ids.filter(x => x !== bad[1]); continue; }
      if (bad && vars.includes(bad[1]) && vars.length > 1) { vars = vars.filter(x => x !== bad[1]); continue; }
      break;
    }
  }
  // Fallback: one model at a time
  const res = await Promise.allSettled(ids.map(id => getJSON(fcURL(lat, lon, vars, [id], fdays, host)).then(j => ({ j, id }))));
  const ok = res.filter(r => r.status === "fulfilled").map(r => r.value);
  if (!ok.length) throw new Error("No forecast data came back for this location.");
  const merged = { ...ok[0].j, hourly: { time: ok[0].j.hourly.time } };
  for (const { j, id } of ok) for (const v of vars) if (j.hourly?.[v]) merged.hourly[`${v}_${id}`] = j.hourly[v];
  return { j: merged, vars, ids: ok.map(o => o.id), multi: true };
}
function pick(h, v, id, single) { return h[`${v}_${id}`] ?? (single ? h[v] : null); }

async function fetchForecast(lat, lon) {
  const ids = MODELS.map(m => m.id);
  const { j, vars, ids: got, multi } = await fetchMulti(lat, lon, BASE_VARS, ids);
  const h = j.hourly, times = h.time, single = got.length === 1 && !multi;
  const t2u = t => Date.UTC(+t.slice(0, 4), +t.slice(5, 7) - 1, +t.slice(8, 10), +(t.slice(11, 13) || 0), +(t.slice(14, 16) || 0));
  const base = t2u(times[0].slice(0, 10));
  const D = {
    tz: j.timezone, tzAbbr: j.timezone_abbreviation, offset: j.utc_offset_seconds || 0, elev: j.elevation ?? 0,
    lat: j.latitude, lon: j.longitude, base, times,
    mins: times.map(t => (t2u(t) - base) / 60000),
    tIndex: new Map(times.map((t, i) => [t, i])),
    dates: [...new Set(times.map(t => t.slice(0, 10)))],
    raw: {}, fetched: Date.now(), srhState: null, memo: new Map()
  };
  for (const v of vars) {
    D.raw[v] = {};
    for (const id of got) { const a = pick(h, v, id, single); if (a && a.some(x => x != null)) D.raw[v][id] = a; }
  }
  if (!Object.keys(D.raw.temperature_2m || {}).length) throw new Error("No model has data for this location.");
  return D;
}

// ---------- Verification: airport observations + earlier forecasts for past days ----------
const OBS_VARS = { temperature_2m: 1, dew_point_2m: 2 };          // column in the obs rows [time, temp, dew]
const OBS_TABS = { temp: "temperature_2m", dew: "dew_point_2m" };
async function loadVerification(D) {
  const leadVars = []; for (const v of Object.keys(OBS_VARS)) for (const n of [1, 2, 3]) leadVars.push(`${v}_previous_day${n}`);
  const obsP = fetch(`/api/obs?lat=${D.lat.toFixed(4)}&lon=${D.lon.toFixed(4)}&hours=100`).then(r => r.ok ? r.json() : null).catch(() => null);
  const leadP = fetchMulti(D.lat, D.lon, leadVars, MODELS.map(m => m.id), 1, PREV_API).catch(() => null);
  const [o, L] = await Promise.all([obsP, leadP]);
  if (S.data !== D) return;
  if (o && o.station && o.obs?.length) {
    const pts = o.obs.map(([t, c, d, w, g, cl, pr]) => ({ m: (t + D.offset * 1000 - D.base) / 60000, c, d, w: w ?? null, g: g ?? null, cl: cl ?? null, pr: pr ?? null, f: apparentT(c, d, w) })).filter(p => p.m >= 0);
    D.obs = { station: o.station, pts };
  } else D.obs = { station: o?.station || null, pts: [] };
  if (L) {
    const h = L.j.hourly, single = L.ids.length === 1 && !L.multi;
    for (const lv of L.vars) {
      const [, v, n] = lv.match(/^(.*)_previous_day(\d)$/), key = `${v}@${n}`;
      D.raw[key] = {};
      for (const id of L.ids) {
        const a = pick(h, lv, id, single); if (!a || !a.some(x => x != null)) continue;
        const out = new Array(D.times.length).fill(null);
        h.time.forEach((t, k) => { const bi = D.tIndex.get(t); if (bi != null) out[bi] = a[k]; });
        D.raw[key][id] = out;
      }
    }
  }
  D.verified = true; D.memo.clear();
  renderAll();
}
// Apparent ("feels like") temperature from temp, dew point and wind — Steadman's formula, as used for model feels-like
function apparentT(c, d, w) {
  if (c == null || d == null || w == null) return null;
  const e = 6.105 * Math.exp(17.27 * d / (237.7 + d));
  return Math.round((c + 0.33 * e - 0.70 * (w / 3.6) - 4.0) * 10) / 10;
}
// Observed daily high/low (raw °C) for a past day; needs most of the day's hours
function obsDay(v, i) {
  const D = S.data, col = OBS_VARS[v]; if (!D?.obs?.pts.length || !col) return null;
  const key = `obs|${v}|${i}`; if (D.memo.has(key)) return D.memo.get(key);
  let hi = null, lo = null; const hrs = new Set();
  for (const p of D.obs.pts) {
    if (p.m < i * 1440 || p.m >= (i + 1) * 1440) continue;
    const x = col === 1 ? p.c : p.d; if (x == null) continue;
    hrs.add(Math.floor(p.m / 60));
    if (!hi || x > hi.v) hi = { v: x, m: p.m }; if (!lo || x < lo.v) lo = { v: x, m: p.m };
  }
  const out = hrs.size >= 18 ? { hi: hi.v, hiM: hi.m, lo: lo.v, loM: lo.m, n: hrs.size } : null;
  D.memo.set(key, out); return out;
}
// Variable key holding the forecast shown for past days (the run from `lead` days earlier, if available)
function pastKey(v, id) { const k = `${v}@${S.lead}`; return S.lead > 0 && S.data.raw[k]?.[id] ? k : v; }
function dayAggV(v, agg, id, i) { return i < todayIdx() && OBS_VARS[v] ? dayAgg(pastKey(v, id), agg, id, i) : dayAgg(v, agg, id, i); }
// Bias = forecast minus observed, raw °C
function biasOf(v, id, i) {
  if (i >= todayIdx()) return null;
  const o = obsDay(v, i), f = dayAggV(v, "hilo", id, i);
  return o && f ? { h: f.hi - o.hi, l: f.lo - o.lo } : null;
}
function avgBias(v, id) {
  const b = []; for (let i = 0; i < todayIdx(); i++) { const x = biasOf(v, id, i); if (x) b.push(x); }
  return b.length ? { h: mean(b.map(x => x.h)), l: mean(b.map(x => x.l)), n: b.length, mae: mean(b.flatMap(x => [Math.abs(x.h), Math.abs(x.l)])) } : null;
}
const bcls = d => { const a = Math.abs(d); return a <= 1 ? "bg" : a <= 2 ? "bm" : "bb"; };
const bfmt = d => { const x = tDelta(d); return `${x > 0.05 ? "+" : x < -0.05 ? "−" : "±"}${fmt(Math.abs(x))}`; };
const bspan = d => d == null ? "" : `<span class="bias ${bcls(d)}">(${bfmt(d)})</span>`;
const leadLabel = () => S.lead > 0 ? `forecast made ${S.lead} day${S.lead > 1 ? "s" : ""} before` : "latest run";

// ---------- Helicity (estimated 0–3 km storm-relative helicity) ----------
async function loadSRH() {
  const D = S.data;
  if (!D || D.srhState) return;
  D.srhState = "loading"; renderAll();
  const vars = ["wind_speed_10m", "wind_direction_10m"];
  for (const L of SRH_LEVELS) vars.push(`wind_speed_${L}hPa`, `wind_direction_${L}hPa`, `geopotential_height_${L}hPa`);
  try {
    const { j, vars: gv, ids, multi } = await fetchMulti(D.lat, D.lon, vars, SRH_MODELS, 8);
    if (S.data !== D) return;
    const h = j.hourly, single = ids.length === 1 && !multi;
    const levels = SRH_LEVELS.filter(L => gv.includes(`wind_speed_${L}hPa`) && gv.includes(`geopotential_height_${L}hPa`));
    D.raw.srh = {};
    for (const id of ids) {
      const s10 = pick(h, "wind_speed_10m", id, single), d10 = pick(h, "wind_direction_10m", id, single);
      const lv = levels.map(L => ({ s: pick(h, `wind_speed_${L}hPa`, id, single), d: pick(h, `wind_direction_${L}hPa`, id, single), z: pick(h, `geopotential_height_${L}hPa`, id, single) }))
                       .filter(l => l.s && l.d && l.z);
      if (!s10 || lv.length < 3) continue;
      const out = new Array(D.times.length).fill(null);
      let any = false;
      h.time.forEach((t, k) => {
        const bi = D.tIndex.get(t); if (bi == null) return;
        const prof = [];
        if (s10[k] != null && d10[k] != null) prof.push(uvAt(10, s10[k], d10[k]));
        for (const l of lv) { const z = l.z[k] - D.elev; if (l.s[k] != null && l.d[k] != null && l.z[k] != null && z > 30) prof.push(uvAt(z, l.s[k], l.d[k])); }
        const v = srh03(prof);
        if (v != null) { out[bi] = v; any = true; }
      });
      if (any) D.raw.srh[id] = out;
    }
    D.srhState = Object.keys(D.raw.srh).length ? "ok" : "none";
  } catch (e) { D.srhState = "error"; D.srhErr = e.message; }
  if (S.data === D) { D.memo.clear(); renderAll(); }
}
function uvAt(z, kmh, dir) { const s = kmh / 3.6, r = dir * Math.PI / 180; return { z, u: -s * Math.sin(r), v: -s * Math.cos(r) }; }
function srh03(prof) {
  prof.sort((a, b) => a.z - b.z);
  if (prof.length < 3 || prof[prof.length - 1].z < 3000) return null;
  const at = z => { for (let i = 1; i < prof.length; i++) if (prof[i].z >= z) { const a = prof[i - 1], b = prof[i], f = (z - a.z) / (b.z - a.z || 1); return { u: a.u + (b.u - a.u) * f, v: a.v + (b.v - a.v) * f }; } return null; };
  const top = Math.min(6000, prof[prof.length - 1].z);
  // Bunkers right-mover storm motion from the 0–6 km layer (or as deep as the data goes)
  const mw = { u: 0, v: 0 }; let n = 0;
  for (let z = 10; z <= top; z += 250) { const w = at(z); if (w) { mw.u += w.u; mw.v += w.v; n++; } }
  if (!n) return null; mw.u /= n; mw.v /= n;
  const lowA = at(10), lowB = at(500), hiA = at(top - 500), hiB = at(top);
  if (!lowA || !lowB || !hiA || !hiB) return null;
  const sh = { u: (hiA.u + hiB.u) / 2 - (lowA.u + lowB.u) / 2, v: (hiA.v + hiB.v) / 2 - (lowA.v + lowB.v) / 2 };
  const mag = Math.hypot(sh.u, sh.v) || 1;
  const c = { u: mw.u + 7.5 * sh.v / mag, v: mw.v - 7.5 * sh.u / mag };
  let s = 0, prev = at(10);
  for (let z = 260; z <= 3000; z += 250) {
    const w = at(Math.min(z, 3000)); if (!w) return null;
    s += (w.u - c.u) * (prev.v - c.v) - (prev.u - c.u) * (w.v - c.v);
    prev = w;
  }
  return Math.round(s);
}

// ---------- Series helpers ----------
const nowMin = () => S.data ? (Date.now() + S.data.offset * 1000 - S.data.base) / 60000 : null;
const todayIdx = () => Math.max(0, Math.min(S.data.dates.length - 1, Math.floor(nowMin() / 1440)));
const nowIdx = () => { const D = S.data, m = nowMin(); let best = 0; D.mins.forEach((x, i) => { if (Math.abs(x - m) < Math.abs(D.mins[best] - m)) best = i; }); return best; };
const avail = v => S.data ? MODELS.map(m => m.id).filter(id => S.data.raw[v]?.[id]) : [];
const visibleFor = v => avail(v).filter(id => S.shown.has(id));
const paramKey = () => PARAMS[S.tab] ? S.tab : "temp";

// Daily aggregate for one model and one day, in raw units
function dayAgg(v, agg, id, i) {
  const D = S.data, key = `${v}|${agg}|${id}|${i}`;
  if (D.memo.has(key)) return D.memo.get(key);
  const a = D.raw[v]?.[id]; let out = null;
  if (a) {
    let hi = null, lo = null, sum = 0, n = 0;
    for (let k = 0; k < a.length; k++) {
      const m = D.mins[k]; if (m < i * 1440 || m >= (i + 1) * 1440 || a[k] == null) continue;
      const x = a[k]; n++; sum += x;
      if (!hi || x > hi.v) hi = { v: x, m }; if (!lo || x < lo.v) lo = { v: x, m };
    }
    if (n >= 18) out = agg === "hilo" ? { hi: hi.v, hiM: hi.m, lo: lo.v, loM: lo.m } : agg === "mean" ? { v: sum / n } : agg === "sum" ? { v: sum } : { v: hi.v, m: hi.m };
  }
  D.memo.set(key, out);
  return out;
}
function aggOf(pk) { return pk === "precip" ? "sum" : PARAMS[pk].agg; }

// Precipitation type for one model at one hour
function ptype(id, k) {
  const R = S.data.raw, p = R.precipitation?.[id]?.[k], sn = R.snowfall?.[id]?.[k] || 0;
  const liq = (R.rain?.[id]?.[k] || 0) + (R.showers?.[id]?.[k] || 0);
  if (sn >= 0.02 && liq < 0.05) return "snow";
  if (sn >= 0.02) return "mix";
  if ((p ?? liq) >= 0.1) return "rain";
  return null;
}
const PT_COLOR = { rain: "#4cc9f0", snow: "#e9f1ff", mix: "#c084fc" };
const PT_LABEL = { rain: "Rain", snow: "Snow", mix: "Mix" };

// The chart's series for the current tab and window
function windowSeries() {
  const D = S.data, pk = paramKey(), v = varOf(pk), c = conv(pk), ws = S.start * 1440, we = ws + S.range * 1440, cum = cumulative(pk);
  return visibleFor(v).map(id => {
    const a = D.raw[v][id], pts = []; let acc = 0, started = false;
    const ga = wgMode(pk) ? D.raw.wind_gusts_10m?.[id] : null;
    const pa = OBS_VARS[v] && S.lead > 0 ? D.raw[`${v}@${S.lead}`]?.[id] : null, t0 = todayIdx() * 1440;
    for (let k = 0; k < a.length; k++) {
      const m = D.mins[k]; if (m < ws || m > we) continue;
      if (cum) {
        if (!started) { pts.push({ m: m - ws, v: 0, k }); started = true; continue; }
        if (a[k] != null) acc += a[k];
        pts.push({ m: m - ws, v: c(acc), k });
      } else {
        const x = pa && m < t0 && pa[k] != null ? pa[k] : a[k];
        if (x != null) pts.push(ga ? { m: m - ws, v: c(x), k, g: ga[k] != null ? c(ga[k]) : null } : { m: m - ws, v: c(x), k });
      }
    }
    return { id, pts };
  }).filter(s => s.pts.length);
}
function hhmm(m, multi) {
  const D = S.data, di = Math.min(D.dates.length - 1, S.start + Math.floor(m / 1440));
  return `${multi ? dayShort(D.dates[di]) + " " : ""}${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`;
}
function niceStep(r, n) { const raw = r / n, p = Math.pow(10, Math.floor(Math.log10(raw || 1))), f = raw / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p; }

// ---------- Chart ----------
function chartSVG(W, H) {
  if (S.tab === "custom") return customSVG(W, H);
  const D = S.data, pk = paramKey(), P = PARAMS[pk], series = windowSeries(), span = S.range * 1440, multi = S.range > 1;
  const isPrecip = pk === "precip", L = 42, R = 12, T = 18, B = isPrecip ? 40 : 26;
  let G_obs = null;
  const all = series.flatMap(s => s.pts.flatMap(p => p.g != null ? [p.v, p.g] : [p.v]));
  if (!all.length) return { svg: "", G: null };
  if (OBS_TABS[pk] && D.obs?.pts.length) { const col = OBS_VARS[OBS_TABS[pk]]; for (const p of D.obs.pts) if (p.m >= S.start * 1440 && p.m <= (S.start + S.range) * 1440) { const o = col === 1 ? p.c : p.d; if (o != null) all.push(cvT(o)); } }
  let lo = Math.min(...all), hi = Math.max(...all), step;
  if (P.kind === "temp") {
    const lLow = lineIn(S.lines.low), lHigh = lineIn(S.lines.high);
    for (const e of [lLow, lHigh]) if (e != null && e >= lo - 8 && e <= hi + 8) { lo = Math.min(lo, e); hi = Math.max(hi, e); }
    lo = Math.floor(lo - 1); hi = Math.ceil(hi + 1);
    const rng = hi - lo; step = rng > 45 ? 10 : rng > 22 ? 5 : rng > 9 ? 2 : 1;
  } else if (P.fixed) { [lo, hi] = P.fixed; step = H < 300 ? 25 : 20; }
  else {
    const minTop = { precip: precipU() === "in" ? 0.2 : 4, wind: 20, cape: 500, srh: 100 }[P.kind] || 1;
    lo = Math.min(0, lo); hi = Math.max(hi * 1.08, minTop);
    step = niceStep(hi - lo, H < 300 ? 4 : 5);
    hi = Math.ceil(hi / step) * step; lo = Math.floor(lo / step) * step;
  }
  const pb = H - B, x = m => L + (m / span) * (W - L - R), y = v => T + (1 - (v - lo) / (hi - lo)) * (pb - T);
  const path = pts => { let d = "", prev = null; for (const p of pts) { d += `${!prev || p.m - prev.m > 90 ? "M" : "L"}${x(p.m).toFixed(1)},${y(p.v).toFixed(1)}`; prev = p; } return d; };
  const dec = step < 0.1 ? 2 : step < 1 ? 1 : 0;
  let grid = "";
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) {
    const strong = P.kind === "temp" ? (v === 0 && S.unit === "C" || v === 32 && S.unit === "F") : v === 0;
    grid += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="rgba(255,255,255,${strong ? ".22" : ".07"})"/><text x="${L - 7}" y="${y(v) + 4}" text-anchor="end" font-size="11" fill="rgba(226,231,255,.5)">${v.toFixed(dec)}${P.kind === "temp" ? "°" : P.kind === "pct" ? "%" : ""}</text>`;
  }
  const uLbl = P.kind === "temp" || P.kind === "pct" ? "" : `<text x="${L - 7}" y="${T - 6}" text-anchor="end" font-size="10" font-weight="600" fill="rgba(226,231,255,.45)">${esc(unitOf(pk))}</text>`;
  let xl = "";
  const lab = (m, t, bold) => `<text x="${x(m)}" y="${H - 8}" text-anchor="middle" font-size="11" font-weight="${bold ? 700 : 500}" fill="${bold ? "#fff" : "rgba(226,231,255,.5)"}">${t}</text>`;
  const vline = (m, a) => `<line x1="${x(m)}" x2="${x(m)}" y1="${T}" y2="${pb}" stroke="rgba(255,255,255,${a})"/>`;
  if (!multi) {
    const every = W < 520 ? 6 : 3;
    for (let h = 0; h <= 24; h += every) xl += vline(h * 60, ".04") + lab(h * 60, h % 24 === 0 ? "12a" : h === 12 ? "12p" : h < 12 ? `${h}a` : `${h - 12}p`);
  } else {
    const ti = todayIdx() - S.start, perDay = (W - L - R) / S.range;
    for (let i = 0; i < S.range; i++) {
      if (i) xl += vline(i * 1440, ".14");
      if (perDay > 70 && S.range <= 7) xl += vline(i * 1440 + 720, ".04");
      const d = D.dates[S.start + i]; if (!d) continue;
      xl += lab(i * 1440 + 720, perDay > 52 ? dayShort(d) : perDay > 22 ? String(dObj(d).getUTCDate()) : (i % 2 ? "" : String(dObj(d).getUTCDate())), i === ti);
    }
  }
  const nm = nowMin() - S.start * 1440;
  const nowSvg = nm > 0 && nm < span ? `<rect x="${L}" y="${T}" width="${Math.max(0, x(nm) - L)}" height="${pb - T}" fill="rgba(255,255,255,.035)"/>
    <line x1="${x(nm)}" x2="${x(nm)}" y1="${T}" y2="${pb}" stroke="rgba(255,255,255,.45)" stroke-dasharray="2 3"/>
    <text x="${x(nm) + 4}" y="${T + 10}" font-size="10.5" fill="rgba(255,255,255,.8)">now</text>` : "";
  let band = "";
  if (S.spread && series.length >= 2) {
    const byM = new Map();
    for (const s of series) for (const p of s.pts) { const a = byM.get(p.m); a ? a.push(p.v) : byM.set(p.m, [p.v]); }
    let run = [];
    const flush = () => { if (run.length > 1) band += `<path d="M${run.map(r => `${x(r.m).toFixed(1)},${y(r.hi).toFixed(1)}`).join("L")}L${run.slice().reverse().map(r => `${x(r.m).toFixed(1)},${y(r.lo).toFixed(1)}`).join("L")}Z" fill="rgba(150,165,255,.13)"/>`; run = []; };
    for (const m of [...byM.keys()].sort((a, b) => a - b)) {
      const a = byM.get(m);
      if (a.length < 2 || (run.length && m - run[run.length - 1].m > 90)) { flush(); if (a.length < 2) continue; }
      run.push({ m, hi: Math.max(...a), lo: Math.min(...a) });
    }
    flush();
  }
  const hline = (v, col, lbl, dash = "6 4", op = ".95") => v == null || v < lo || v > hi ? "" :
    `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="${col}" stroke-width="1.3" stroke-dasharray="${dash}" opacity="${op}"/>
     <text x="${W - R - 3}" y="${y(v) - 5}" text-anchor="end" font-size="10.5" font-weight="700" fill="${col}" opacity="${op}">${lbl}</text>`;
  let refs = "";
  if (P.kind === "temp") { const a = lineIn(S.lines.low), b = lineIn(S.lines.high); refs = hline(a, "#5ec8ff", `≤${fmt(a)}°`) + hline(b, "#ff9f43", `≥${fmt(b)}°`); }
  if (P.guides) refs = P.guides.map(([v, t]) => hline(v, "rgba(255,200,120,.75)", `${v} ${t}`, "3 4", ".8")).join("");
  let obsSvg = "";
  const ov = OBS_TABS[pk], ows = S.start * 1440;
  if (ov && D.obs?.pts.length) {
    const col = OBS_VARS[ov], op = D.obs.pts.filter(p => p.m >= ows && p.m <= ows + span && (col === 1 ? p.c : p.d) != null).map(p => ({ m: p.m - ows, v: cvT(col === 1 ? p.c : p.d) }));
    if (op.length) {
      G_obs = op;
      obsSvg = `<path data-line="obs" d="${path(op)}" fill="none" stroke="#fff" stroke-width="2.4" stroke-linejoin="round"/>` + (op.length < 160 ? op.map(p => `<circle cx="${x(p.m).toFixed(1)}" cy="${y(p.v).toFixed(1)}" r="2.2" fill="#fff"/>`).join("") : "");
    }
  }
  let gustDots = "";
  if (wgMode(pk)) {
    const r = S.range <= 1 ? 2.6 : S.range <= 3 ? 2 : S.range <= 7 ? 1.5 : 1.1;
    gustDots = series.map(s => `<g data-line="${s.id}" fill="${colorOf(s.id)}" stroke="${colorOf(s.id)}" stroke-width="0" opacity=".9">${s.pts.filter(p => p.g != null).map(p => dotShape(patOf(s.id), x(p.m), y(p.g), r + (patOf(s.id) ? .3 : 0))).join("")}</g>`).join("");
  }
  const lines = series.map(s => `<path data-line="${s.id}" d="${path(s.pts)}" fill="none" stroke="${colorOf(s.id)}" stroke-dasharray="${dashOfModel(s.id)}" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round" opacity=".92"/>`).join("");
  let ext = "";
  if (!multi && P.kind === "temp") {
    const e = dayExt(pk, S.start);
    if (e) ext = `<circle cx="${x(e.hiM - S.start * 1440)}" cy="${y(cvT(e.hi))}" r="5.5" fill="none" stroke="#ff9f43" stroke-width="2"/>
                  <circle cx="${x(e.loM - S.start * 1440)}" cy="${y(cvT(e.lo))}" r="5.5" fill="none" stroke="#5ec8ff" stroke-width="2"/>`;
  }
  // Precipitation type strip: colour = most common type, opacity = share of models with precipitation that hour
  let strip = "";
  if (isPrecip) {
    const ids = series.map(s => s.id), sy = pb + 6, ws = S.start * 1440, step60 = (W - L - R) / (S.range * 24);
    strip = `<text x="${L - 7}" y="${sy + 7}" text-anchor="end" font-size="9.5" fill="rgba(226,231,255,.45)">type</text>`;
    for (let k = 0; k < D.mins.length; k++) {
      const m = D.mins[k] - ws; if (m <= 0 || m > S.range * 1440) continue;
      const c = { rain: 0, snow: 0, mix: 0 }; let n = 0;
      for (const id of ids) { const t = ptype(id, k); if (D.raw.precipitation[id]?.[k] != null) n++; if (t) c[t]++; }
      const wet = c.rain + c.snow + c.mix; if (!wet || !n) continue;
      const t = Object.entries(c).sort((a, b) => b[1] - a[1])[0][0];
      strip += `<rect x="${(x(m) - step60).toFixed(1)}" y="${sy}" width="${Math.max(1, step60 - 0.6).toFixed(1)}" height="8" rx="1.5" fill="${PT_COLOR[t]}" opacity="${(0.25 + 0.75 * wet / n).toFixed(2)}"/>`;
    }
  }
  const G = { W, H, L, R, T, B, pb, lo, hi, x, y, span, series, multi, pk, obs: G_obs };
  const svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(P.label)} by model" style="touch-action:none">
    ${grid}${uLbl}${xl}${nowSvg}${band}${refs}${gustDots}${lines}${obsSvg}${ext}${strip}
    <g class="xh"></g>
    <rect class="hit" x="${L}" y="${T}" width="${W - L - R}" height="${pb - T}" fill="transparent"/>
  </svg>`;
  return { svg, G };
}
// Mean of the shown models, hour by hour, then the day's high/low of that mean (raw units)
function dayExt(pk, i, ids) {
  const D = S.data, v = PARAMS[pk].v; ids = ids || visibleFor(v);
  const byM = new Map();
  for (const id of ids) { const a = (i < todayIdx() && OBS_VARS[v] ? D.raw[pastKey(v, id)][id] : null) || D.raw[v][id]; for (let k = 0; k < a.length; k++) { const m = D.mins[k]; if (m >= i * 1440 && m < (i + 1) * 1440 && a[k] != null) { const b = byM.get(m); b ? b.push(a[k]) : byM.set(m, [a[k]]); } } }
  if (byM.size < 18) return null;
  let hi = null, lo = null;
  for (const [m, a] of byM) { const x = mean(a); if (!hi || x > hi.v) hi = { m, v: x }; if (!lo || x < lo.v) lo = { m, v: x }; }
  return { hi: hi.v, hiM: hi.m, lo: lo.v, loM: lo.m };
}
// Per-day consensus value for the day strip / table (display units)
function dayConsensus(pk, i) {
  const v = varOf(pk), agg = aggOf(pk), c = conv(pk), ids = visibleFor(v);
  const vals = ids.map(id => dayAgg(v, agg, id, i)).filter(Boolean);
  if (!vals.length) return null;
  if (agg === "hilo") return { hi: c(mean(vals.map(e => e.hi))), lo: c(mean(vals.map(e => e.lo))), n: vals.length };
  return { v: c(mean(vals.map(e => e.v))), n: vals.length, wet: vals.filter(e => e.v >= 0.5).length };
}

function chartTitle() {
  const D = S.data, t = todayIdx();
  if (S.range === 1) {
    const i = S.start, tag = i === t ? `<span class="tag">Today</span>` : i === t + 1 ? `<span class="tag">Tomorrow</span>` : i < t ? `<span class="tag past">Past</span>` : "";
    return `${dayLong(D.dates[i])}${tag}`;
  }
  return `${dayShort(D.dates[S.start])} – ${dayShort(D.dates[S.start + S.range - 1])}${S.start <= t && t < S.start + S.range ? `<span class="tag">incl. today</span>` : ""}`;
}
function summaryHTML() {
  if (S.tab === "custom") return customSummary();
  const D = S.data, pk = paramKey(), P = PARAMS[pk], U = unitOf(pk), v = varOf(pk), ids = visibleFor(v);
  if (!ids.length) return "";
  const i = S.start, days = Array.from({ length: S.range }, (_, k) => i + k);
  const nm = id => esc(META(id).short);
  if (P.kind === "temp") {
    if (S.range === 1) {
      const e = dayExt(pk, i), dd = ids.map(id => dayAgg(v, "hilo", id, i)).filter(Boolean);
      const dis = dd.length > 1 ? ` · models differ by <b>${fmt(tDelta(Math.max(...dd.map(d => d.hi)) - Math.min(...dd.map(d => d.hi))))}°</b> on the high` : "";
      return e ? `Avg high <b class="hi">${fmt(cvT(e.hi))}${U}</b> ${hhmm(e.hiM - i * 1440)} · low <b class="lo">${fmt(cvT(e.lo))}${U}</b> ${hhmm(e.loM - i * 1440)}${dis}` : "Not enough model data for this day.";
    }
    const all = windowSeries().flatMap(s => s.pts.map(p => p.v));
    return `Models range <b class="lo">${fmt(Math.min(...all))}°</b> to <b class="hi">${fmt(Math.max(...all))}${U}</b>`;
  }
  // Window totals / peaks per model
  const per = ids.map(id => {
    const a = D.raw[v][id], ws = i * 1440, we = (i + S.range) * 1440; let sum = 0, mx = null, n = 0, mm = 0;
    for (let k = 0; k < a.length; k++) { const m = D.mins[k]; if (m <= ws || m > we || a[k] == null) continue; n++; sum += a[k]; if (mx == null || a[k] > mx) { mx = a[k]; mm = m; } }
    return n ? { id, sum, mx, mm, avg: sum / n } : null;
  }).filter(Boolean);
  if (!per.length) return "";
  const c = conv(pk), top = per.slice().sort((a, b) => b.mx - a.mx)[0];
  if (pk === "cloud") { const av = per.map(p => p.avg); return `Avg cloud <b>${Math.round(mean(av))}%</b> · models range ${Math.round(Math.min(...av))}–${Math.round(Math.max(...av))}%`; }
  if (pk === "precip") {
    const tot = per.map(p => c(p.sum)), wet = per.filter(p => (S.mode.precip === "snow" ? p.sum >= 0.2 : p.sum >= 0.5)).length;
    return `Avg total <b>${fv(pk, mean(tot))} ${U}</b> · <b>${wet} of ${per.length}</b> models ${S.mode.precip === "snow" ? "snow" : "wet"} · range ${fv(pk, Math.min(...tot))}–${fv(pk, Math.max(...tot))} ${U}`;
  }
  if (pk === "wind" && wgMode(pk)) {
    const gp = ids.map(id => { const a = D.raw.wind_gusts_10m?.[id]; if (!a) return null; let mx = null, mm = 0; for (let k = 0; k < a.length; k++) { const m = D.mins[k]; if (m <= i * 1440 || m > (i + S.range) * 1440 || a[k] == null) continue; if (mx == null || a[k] > mx) { mx = a[k]; mm = m; } } return mx == null ? null : { id, mx, mm }; }).filter(Boolean);
    const tg = gp.slice().sort((a, b) => b.mx - a.mx)[0];
    return `Avg peak wind <b>${fv(pk, c(mean(per.map(p => p.mx))))} ${U}</b>${tg ? ` · avg peak gust <b>${fv(pk, c(mean(gp.map(p => p.mx))))}</b> · strongest gust <b>${fv(pk, c(tg.mx))} ${U}</b> (${nm(tg.id)}, ${hhmm(tg.mm - i * 1440, S.range > 1)})` : ""}`;
  }
  if (pk === "wind") return `Avg peak ${S.mode.wind === "gust" ? "gust" : "wind"} <b>${fv(pk, c(mean(per.map(p => p.mx))))} ${U}</b> · strongest <b>${fv(pk, c(top.mx))} ${U}</b> (${nm(top.id)}, ${hhmm(top.mm - i * 1440, S.range > 1)})`;
  if (pk === "cape") return `Peak <b>${Math.round(top.mx)} J/kg</b> (${nm(top.id)}, ${hhmm(top.mm - i * 1440, S.range > 1)}) · avg peak ${Math.round(mean(per.map(p => p.mx)))} J/kg`;
  if (pk === "srh") return `Estimated 0–3 km SRH · peak <b>${Math.round(top.mx)} m²/s²</b> (${nm(top.id)}, ${hhmm(top.mm - i * 1440, S.range > 1)})`;
  return "";
}

// ---------- Readout (doubles as the legend) ----------
function valueAt(G, id, minute) { const s = G.series.find(s => s.id === id); return s ? s.pts.find(p => p.m === minute) || null : null; }
function extraFor(pk, id, k) {
  const R = S.data.raw;
  if (pk === "precip" && S.mode.precip !== "snow") { const t = ptype(id, k); return t ? `<i class="pt" style="background:${PT_COLOR[t]}" title="${PT_LABEL[t]}"></i>` : ""; }
  if (pk === "wind") { const d = R.wind_direction_10m?.[id]?.[k]; return d != null ? `<i class="wd" style="transform:rotate(${d + 180}deg)" title="from ${Math.round(d)}°">↑</i>` : ""; }
  return "";
}
function readoutHTML(G, minute) {
  if (!G) return `<div class="rempty">${S.tab === "srh" ? srhNote() : "No models with this data are switched on."}<br><button class="btn" data-open-models style="margin:10px auto 0">Choose models</button></div>`;
  const pk = G.pk, U = unitOf(pk), D = S.data;
  const rows = G.series.map(s => ({ id: s.id, p: s.pts.find(p => p.m === minute) }));
  rows.sort((a, b) => (b.p ? b.p.v : -1e9) - (a.p ? a.p.v : -1e9));
  const mv = rows.filter(r => r.p).map(r => r.p.v);
  let sel = "";
  if (S.sel && rows.some(r => r.id === S.sel)) {
    const m = META(S.sel), p = valueAt(G, S.sel, minute), di = Math.min(S.start + Math.floor(minute / 1440), D.dates.length - 1);
    const v = varOf(pk), c = conv(pk);
    let e = dayAgg(v, aggOf(pk), S.sel, di);
    if (wgMode(pk) && e) { const gq = dayAgg("wind_gusts_10m", "max", S.sel, di); e = { hi: e.v, hiM: e.m, lo: gq ? gq.v : null, loM: gq ? gq.m : 0, wg: true }; }
    const dayTxt = !e ? "" : e.hi != null
      ? e.wg ? `<span>Peak wind <b>${fv(pk, c(e.hi))} ${U}</b> at ${pad(Math.floor(e.hiM / 60) % 24)}:00</span>${e.lo != null ? `<span>Peak gust <b style="color:#ffb38a">${fv(pk, c(e.lo))} ${U}</b> at ${pad(Math.floor(e.loM / 60) % 24)}:00</span>` : ""}`
        : `<span>Day high <b style="color:#ffb38a">${fv(pk, c(e.hi))}</b> at ${pad(Math.floor(e.hiM / 60) % 24)}:00</span><span>Low <b style="color:#8fd3ff">${fv(pk, c(e.lo))}</b> at ${pad(Math.floor(e.loM / 60) % 24)}:00</span>`
      : `<span>${dayShort(D.dates[di])} ${aggOf(pk) === "sum" ? "total" : aggOf(pk) === "mean" ? "average" : "peak"} <b>${fv(pk, c(e.v))} ${U}</b></span>`;
    sel = `<div class="rsel"><span class="rdot" style="background:${colorOf(S.sel)}"></span><b>${esc(m.name)}</b>
      <div class="rbig">${p ? fv(pk, p.v) + (PARAMS[pk].kind === "temp" ? U.slice(1) : " " + U) : "—"}${p && p.g != null ? `<small class="gst big">gust ${fv(pk, p.g)}</small>` : ""}</div>
      <small>${esc(m.provider)} · ${esc(m.res)} grid${p ? "" : " · no data at this hour"}</small>
      ${dayTxt ? `<div class="rhl">${dayTxt}</div>` : ""}</div>`;
  }
  const lbl = cumulative(pk) ? "total so far" : "";
  // Observed value at this hour (nearest report within 35 min) and each model's bias for that past day
  const ov = OBS_TABS[pk], di = Math.min(S.start + Math.floor(minute / 1440), D.dates.length - 1);
  let obsRow = "", bias = {};
  if (ov && D.obs?.station) {
    const col = OBS_VARS[ov], am = minute + S.start * 1440;
    let best = null; for (const p of D.obs.pts) { const x = col === 1 ? p.c : p.d; if (x != null && Math.abs(p.m - am) <= 35 && (!best || Math.abs(p.m - am) < Math.abs(best.m - am))) best = { m: p.m, v: x }; }
    const od = di < todayIdx() ? obsDay(ov, di) : null;
    if (best || od) obsRow = `<div class="robs"><i class="rdot" style="background:#fff"></i><span>Observed <small>${esc(D.obs.station.id)}</small></span>
      ${od ? `<small class="ohl">day <span class="h">${fmt(cvT(od.hi))}°</span> / <span class="l">${fmt(cvT(od.lo))}°</span></small>` : ""}<b>${best ? fmt(cvT(best.v)) + "°" : "–"}</b></div>`;
    if (od) for (const r of rows) bias[r.id] = biasOf(ov, r.id, di);
  }
  const bLine = id => { const b = bias[id]; return b ? `<small class="rb">H ${bspan(b.h)} L ${bspan(b.l)}</small>` : ""; };
  const hasBias = Object.values(bias).some(Boolean);
  return `<div class="rhead"><b>${hhmm(minute, G.multi)}${lbl ? ` <small style="font-weight:500">${lbl}</small>` : ""}</b><small>${mv.length > 1 ? `avg <b>${fv(pk, mean(mv))}</b> · spread <b>${fv(pk, Math.max(...mv) - Math.min(...mv))}</b>${PARAMS[pk].kind === "temp" ? "" : " " + esc(U)}` : esc(U)}</small></div>
    ${sel}${obsRow}<div class="rlist${hasBias ? " wb" : ""}">${rows.map(r => `<button class="rrow${S.sel === r.id ? " sel" : S.sel ? " dim" : ""}" data-id="${r.id}" title="${esc(META(r.id).name)}">
      ${swatch(r.id)}<span>${esc(META(r.id).short)}</span>${r.p ? extraFor(pk, r.id, r.p.k) : ""}<b>${r.p ? fv(pk, r.p.v) : "–"}${r.p && r.p.g != null ? `<small class="gst">G${fv(pk, r.p.g)}</small>` : ""}</b>${bLine(r.id)}</button>`).join("")}</div>
    ${hasBias ? `<div class="srhnote">Bias = ${leadLabel()} minus observed at ${esc(D.obs.station.id)} (${esc(D.obs.station.name || "")}${D.obs.station.distKm != null ? `, ${Math.round(D.obs.station.distKm)} km away` : ""}).</div>` : ""}
    ${pk === "precip" && S.mode.precip !== "snow" ? `<div class="ptkey"><span><i class="pt" style="background:${PT_COLOR.rain}"></i>Rain</span><span><i class="pt" style="background:${PT_COLOR.snow}"></i>Snow</span><span><i class="pt" style="background:${PT_COLOR.mix}"></i>Mix</span></div>` : ""}
    ${pk === "srh" ? `<div class="srhnote">${srhNote()}</div>` : ""}`;
}
function srhNote() {
  const st = S.data?.srhState;
  if (st === "loading" || st == null) return "Loading upper-air winds for the helicity estimate…";
  if (st === "none") return "No model offers enough upper-air wind data here to estimate helicity.";
  if (st === "error") return `Couldn't load upper-air winds: ${esc(S.data.srhErr || "")}`;
  return "Estimated 0–3 km storm-relative helicity (right-moving supercell motion), computed from each model's pressure-level winds. Open-Meteo doesn't publish the models' own helicity, so treat this as a guide. Next 8 days only.";
}
function drawCrosshair(scope, minute) {
  const G = scope._G, ro = scope.querySelector(".readout");
  if (G?.custom) { S.min = minute; return customCrosshair(scope, G, minute); }
  if (!G) { if (ro) ro.innerHTML = readoutHTML(null); return; }
  S.min = minute;
  const { x, y, T, pb } = G;
  const ids = S.sel && G.series.some(s => s.id === S.sel) ? [S.sel] : G.series.map(s => s.id);
  let dots = "";
  for (const id of ids) { const p = valueAt(G, id, minute); if (p) { dots += `<circle cx="${x(p.m)}" cy="${y(p.v)}" r="${ids.length === 1 ? 5 : 3.2}" fill="${colorOf(id)}" stroke="#0a0e22" stroke-width="1.5"/>`; if (p.g != null) dots += `<circle cx="${x(p.m)}" cy="${y(p.g)}" r="${ids.length === 1 ? 5 : 3.6}" fill="none" stroke="${colorOf(id)}" stroke-width="1.6"/>`; } }
  const xh = scope.querySelector(".xh");
  if (xh) xh.innerHTML = `<line x1="${x(minute)}" x2="${x(minute)}" y1="${T}" y2="${pb}" stroke="rgba(255,255,255,.6)"/>${dots}`;
  if (ro) ro.innerHTML = readoutHTML(G, minute);
}
function defaultMinute() {
  const span = S.range * 1440, nm = nowMin() - S.start * 1440;
  if (nm >= 0 && nm < span) return Math.round(nm / 60) * 60;
  if (S.range === 1 && PARAMS[paramKey()].kind === "temp") { const e = dayExt(paramKey(), S.start); if (e) return e.hiM - S.start * 1440; }
  return S.range === 1 ? 900 : 720;
}
function applyHighlight(scope) {
  scope.querySelectorAll("[data-line]").forEach(el => {
    const raw = el.getAttribute("data-line"), k = raw.includes("|") ? raw.split("|")[1] : raw;
    el.style.opacity = !S.sel || k === S.sel || k === "obs" ? "" : ".12";
    if (el.tagName.toLowerCase() === "path" && k !== "obs") el.setAttribute("stroke-width", S.sel && k === S.sel ? "3.4" : "1.7");
  });
}
function scopes() { return [$("view"), document.querySelector(".fsbox")].filter(Boolean); }
function selectModel(id) { S.sel = S.sel === id ? "" : id; for (const sc of scopes()) { applyHighlight(sc); drawCrosshair(sc, S.min); } }

// ---------- Models sheet ----------
function presetIds(p) {
  return { core: CORE_MODELS,
           global: MODELS.filter(m => m.kind === "global" || m.kind === "ai").map(m => m.id),
           regional: MODELS.filter(m => m.kind === "regional").map(m => m.id),
           all: MODELS.map(m => m.id) }[p] || [];
}
function applyPreset(p) { S.shown = new Set(presetIds(p)); S.preset = p; saveShown(); }
function saveShown() { LS.set("shown", [...S.shown]); LS.set("preset", S.preset); }
function renderModelsSheet() {
  const D = S.data; if (!D) return;
  const pk = paramKey(), v = S.tab === "overview" ? "temperature_2m" : varOf(pk), ids = avail(v), on = ids.filter(id => S.shown.has(id)).length;
  $("scount").textContent = `${on} of ${ids.length} on${S.tab !== "overview" ? ` · ${PARAMS[pk].label.toLowerCase()}` : ""}`;
  document.querySelectorAll("#mpresets button").forEach(b => b.classList.toggle("on", b.dataset.p === S.preset));
  const agg = S.tab === "overview" ? "hilo" : aggOf(pk), c = S.tab === "overview" ? cvT : conv(pk), vp = S.tab === "overview" ? "temp" : pk;
  let html = "", prov = "";
  for (const id of ids) {
    const m = MODEL_BY_ID[id];
    if (m.provider !== prov) {
      prov = m.provider;
      const grp = ids.filter(x => MODEL_BY_ID[x].provider === prov), allOn = grp.every(x => S.shown.has(x));
      html += `<div class="mgrp"><span>${esc(prov)}</span>${grp.length > 1 ? `<button data-grp="${esc(prov)}" data-on="${allOn ? 0 : 1}">${allOn ? "Hide all" : "Show all"}</button>` : ""}</div>`;
    }
    const e = dayAgg(v, agg, id, S.start);
    const val = !e ? "" : e.hi != null ? `<span class="h">${fv(vp, c(e.hi))}</span><span class="l">${fv(vp, c(e.lo))}</span>` : `<span class="h">${fv(vp, c(e.v))}</span>`;
    html += `<label class="mrow">${swatch(id, m.color, 20)}<span class="mn"><b>${esc(m.short)}</b><small>${esc(m.name)} · ${esc(m.res)}</small></span>
      ${val ? `<span class="mhl">${val}</span>` : ""}
      <input type="checkbox" class="sw" data-id="${id}"${S.shown.has(id) ? " checked" : ""} aria-label="Show ${esc(m.short)}"></label>`;
  }
  if (!ids.length) html = `<div class="rempty">${S.tab === "srh" ? srhNote() : "No model has this data here."}</div>`;
  const keep = $("mlist").scrollTop;
  $("mlist").innerHTML = html;
  $("mlist").scrollTop = keep;
}
function openModal(id) { $(id).hidden = false; document.body.classList.add("fs-open"); }
function closeModal(id) { $(id).hidden = true; if (!document.querySelector(".modal:not([hidden])") && !document.querySelector(".fs")) document.body.classList.remove("fs-open"); }

// ---------- Tabs, toolbar, day strip, table ----------
function renderTabs() {
  $("tabs").innerHTML = TABS.map(t => `<a href="#${t}" class="tab${S.tab === t ? " on" : ""}" role="tab" aria-selected="${S.tab === t}">${TAB_LABEL[t]}</a>`).join("");
  const on = $("tabs").querySelector(".on");
  if (on) { const bar = $("tabs"); const l = on.offsetLeft - bar.offsetLeft, r = l + on.offsetWidth; if (l < bar.scrollLeft || r > bar.scrollLeft + bar.clientWidth) bar.scrollTo({ left: Math.max(0, l - 40), behavior: "smooth" }); }
}
function renderToolbar() {
  const pk = paramKey(), ids = S.tab === "overview" ? visibleFor("temperature_2m") : visibleFor(varOf(pk));
  $("mcount").textContent = ids.length;
  $("mdots").innerHTML = ids.slice(0, 4).map(id => `<i style="background:${colorOf(id)}"></i>`).join("");
  $("optsBtn").classList.toggle("active", S.lines.low != null || S.lines.high != null);
  document.querySelectorAll("#range button").forEach(b => b.classList.toggle("on", +b.dataset.r === S.rsel));
  document.querySelectorAll(".unit button").forEach(b => b.classList.toggle("on", b.dataset.unit === S.unit));
  $("prevBtn").disabled = S.start <= 0;
  $("nextBtn").disabled = S.start + S.range >= S.data.dates.length;
  const P = PARAMS[pk];
  $("modes").innerHTML = P.modes ? P.modes.map(([k, l]) => `<button data-mode="${k}" class="${S.mode[pk] === k ? "on" : ""}">${l}</button>`).join("") : "";
  $("modes").hidden = !P.modes;
}
function dayCell(pk, i, compact) {
  const ov = OBS_TABS[pk], o = ov && i < todayIdx() ? obsDay(ov, i) : null;
  if (o) return `<span class="h">${Math.round(cvT(o.hi))}°</span> <span class="l">${Math.round(cvT(o.lo))}°</span><small class="obs">obs</small>`;
  const c = dayConsensus(pk, i); if (!c) return "&nbsp;";
  if (wgMode(pk)) { const g = visibleFor("wind_gusts_10m").map(id => dayAgg("wind_gusts_10m", "max", id, i)).filter(Boolean); return `<span class="p">${Math.round(c.v)}</span>${g.length ? `<span class="gst">G${Math.round(cvW(mean(g.map(e => e.v))))}</span>` : ""}`; }
  const P = PARAMS[pk];
  if (c.hi != null) return `<span class="h">${Math.round(c.hi)}°</span> <span class="l">${Math.round(c.lo)}°</span>`;
  if (pk === "precip") return `<span class="p">${fv(pk, c.v)}</span><small>${unitOf(pk)}</small>`;
  if (P.kind === "pct") return `<span class="p">${Math.round(c.v)}%</span>`;
  return `<span class="p">${Math.round(c.v)}</span>${compact ? "" : `<small>${esc(unitOf(pk))}</small>`}`;
}
function renderDays() {
  const D = S.data, t = todayIdx(), pk = paramKey();
  $("days").innerHTML = D.dates.map((d, i) => {
    const inR = i >= S.start && i < S.start + S.range;
    return `<button class="day${i < t ? " past" : ""}${inR ? " in" : ""}" data-i="${i}" role="tab" aria-selected="${inR}">
      <div class="dn"><span>${i === t ? "Today" : WD[dObj(d).getUTCDay()]}</span></div><div class="dt">${MO[dObj(d).getUTCMonth()]} ${dObj(d).getUTCDate()}</div>
      <div class="hl">${dayCell(pk, i, true)}</div></button>`;
  }).join("");
}
function renderTable() {
  const D = S.data, t = todayIdx(), pk = paramKey(), v = varOf(pk), agg = aggOf(pk), c = conv(pk), ids = visibleFor(v), U = unitOf(pk);
  const ov = OBS_TABS[pk], hasObs = !!(ov && D.obs?.station && D.obs.pts.length);
  const titles = { hilo: "Daily high / low", mean: "Daily average", sum: "Daily total", max: "Daily peak" };
  $("tableTitle").textContent = `${titles[agg]} · ${PARAMS[pk].label}${pk === "wind" && S.mode.wind === "gust" ? " gusts" : wgMode(pk) ? " and gusts" : pk === "precip" && S.mode.precip === "snow" ? " (snow)" : ""}`;
  $("tableSub").textContent = hasObs ? `Past days: ${leadLabel()} · (bias) vs observed at ${D.obs.station.id}` : "Tap a day to chart it";
  const cls = i => `${i < t ? "past" : ""}${i >= S.start && i < S.start + S.range ? " in" : ""}`;
  const wg = wgMode(pk);
  const get = (id, i) => {
    if (wg) { const w = dayAgg(v, "max", id, i), g = dayAgg("wind_gusts_10m", "max", id, i); return w ? { hi: w.v, lo: g ? g.v : null } : null; }
    return ov ? dayAggV(v, agg, id, i) : dayAgg(v, agg, id, i);
  };
  const cell = (e, b) => !e ? `<span class="s">–</span>` : e.hi != null
    ? wg ? `${fv(pk, c(e.hi))}<br><span class="gst">${e.lo != null ? "G" + fv(pk, c(e.lo)) : ""}</span>`
      : `<span class="h">${fv(pk, c(e.hi))}</span>${b ? bspan(b.h) : ""}<br><span class="l">${fv(pk, c(e.lo))}</span>${b ? bspan(b.l) : ""}` : fv(pk, c(e.v));
  const biasCol = hasObs && ids.some(id => avgBias(ov, id));
  let h = `<table class="dt"><thead><tr><th class="mcol">${esc(U)}${wg ? " · peak wind<br>peak gust" : agg === "hilo" ? " · high<br>low" : ""}</th>${biasCol ? `<th class="bcol" title="Average bias over the past days">Avg bias<b>${t}d</b></th>` : ""}${D.dates.map((d, i) =>
    `<th class="${cls(i)}" data-i="${i}">${i === t ? "Today" : WD[dObj(d).getUTCDay()]}<b>${dObj(d).getUTCDate()}</b></th>`).join("")}</tr></thead><tbody>`;
  if (hasObs) {
    h += `<tr class="obsrow"><th><i style="background:#fff"></i>Observed <small>${esc(D.obs.station.id)}</small></th>${biasCol ? "<td class=\"bcol\"></td>" : ""}${D.dates.map((_, i) => {
      const o = i < t ? obsDay(ov, i) : null;
      return `<td class="${cls(i)}">${o ? `<span class="h">${fmt(cvT(o.hi))}</span><br><span class="l">${fmt(cvT(o.lo))}</span>` : `<span class="s">${i < t ? "–" : ""}</span>`}</td>`; }).join("")}</tr>`;
  }
  for (const id of ids) {
    const ab = biasCol ? avgBias(ov, id) : null;
    h += `<tr><th>${swatch(id)}${esc(META(id).short)}</th>${biasCol ? `<td class="bcol">${ab ? `H ${bspan(ab.h)}<br>L ${bspan(ab.l)}` : "–"}</td>` : ""}${D.dates.map((_, i) => `<td class="${cls(i)}">${cell(get(id, i), hasObs ? biasOf(ov, id, i) : null)}</td>`).join("")}</tr>`;
  }
  if (ids.length > 1) {
    const stat = (label, f) => `<tr class="stat"><th>${label}</th>${biasCol ? "<td class=\"bcol\"></td>" : ""}${D.dates.map((_, i) => {
      const es = ids.map(id => get(id, i)).filter(Boolean);
      return `<td class="${cls(i)}">${es.length > 1 ? f(es) : "–"}</td>`; }).join("")}</tr>`;
    const sp = a => Math.max(...a) - Math.min(...a);
    if (wg) {
      h += stat("Average", es => `${fv(pk, c(mean(es.map(e => e.hi))))}<br><span class="gst">G${fv(pk, c(mean(es.filter(e => e.lo != null).map(e => e.lo))))}</span>`);
      h += stat("Spread", es => `${fv(pk, c(sp(es.map(e => e.hi))))}<br>${fv(pk, c(sp(es.filter(e => e.lo != null).map(e => e.lo))))}`);
    } else if (agg === "hilo") {
      h += stat("Average", es => `<span class="h">${fv(pk, c(mean(es.map(e => e.hi))))}</span><br><span class="l">${fv(pk, c(mean(es.map(e => e.lo))))}</span>`);
      h += stat("Spread", es => `${fmt(tDelta(sp(es.map(e => e.hi))))}<br>${fmt(tDelta(sp(es.map(e => e.lo))))}`);
    } else {
      h += stat("Average", es => fv(pk, c(mean(es.map(e => e.v)))));
      h += stat("Spread", es => fv(pk, c(Math.max(...es.map(e => e.v))) - c(Math.min(...es.map(e => e.v)))));
      if (agg === "sum") h += stat("Models wet", es => `${es.filter(e => e.v >= (S.mode.precip === "snow" ? 0.2 : 0.5)).length}/${es.length}`);
    }
  }
  $("table").innerHTML = h + "</tbody></table>";
}

// ---------- Overview ----------
const ICON = {
  sun: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4.5" fill="#ffd166"/><g stroke="#ffd166" stroke-width="2" stroke-linecap="round"><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8"/></g></svg>`,
  part: `<svg viewBox="0 0 24 24"><circle cx="9" cy="9" r="4" fill="#ffd166"/><path d="M8 19h9a4 4 0 0 0 .4-8 5.5 5.5 0 0 0-10.6 1.6A3.2 3.2 0 0 0 8 19z" fill="#c9d3f5"/></svg>`,
  cloud: `<svg viewBox="0 0 24 24"><path d="M7 19h10.5a4.5 4.5 0 0 0 .4-9 6 6 0 0 0-11.6 1.8A3.6 3.6 0 0 0 7 19z" fill="#aeb8dd"/></svg>`,
  rain: `<svg viewBox="0 0 24 24"><path d="M7 15h10.5a4.5 4.5 0 0 0 .4-9 6 6 0 0 0-11.6 1.8A3.6 3.6 0 0 0 7 15z" fill="#aeb8dd"/><g stroke="#4cc9f0" stroke-width="2" stroke-linecap="round"><path d="M8 18l-1 3M12 18l-1 3M16 18l-1 3"/></g></svg>`,
  snow: `<svg viewBox="0 0 24 24"><path d="M7 15h10.5a4.5 4.5 0 0 0 .4-9 6 6 0 0 0-11.6 1.8A3.6 3.6 0 0 0 7 15z" fill="#aeb8dd"/><g fill="#fff"><circle cx="8" cy="19" r="1.4"/><circle cx="12" cy="21" r="1.4"/><circle cx="16" cy="19" r="1.4"/></g></svg>`,
  mix: `<svg viewBox="0 0 24 24"><path d="M7 15h10.5a4.5 4.5 0 0 0 .4-9 6 6 0 0 0-11.6 1.8A3.6 3.6 0 0 0 7 15z" fill="#aeb8dd"/><path d="M8 18l-1 3" stroke="#4cc9f0" stroke-width="2" stroke-linecap="round"/><circle cx="12.5" cy="20" r="1.4" fill="#fff"/><path d="M17 18l-1 3" stroke="#4cc9f0" stroke-width="2" stroke-linecap="round"/></svg>`,
};
function dayStats(i, ids) {
  const D = S.data;
  const T = ids.map(id => dayAgg("temperature_2m", "hilo", id, i)).filter(Boolean);
  if (!T.length) return null;
  const pr = ids.map(id => dayAgg("precipitation", "sum", id, i)).filter(Boolean);
  const sn = ids.map(id => dayAgg("snowfall", "sum", id, i)).filter(Boolean);
  const cl = ids.map(id => dayAgg("cloud_cover", "mean", id, i)).filter(Boolean);
  const gu = ids.map(id => dayAgg("wind_gusts_10m", "max", id, i)).filter(Boolean);
  const ca = ids.map(id => dayAgg("cape", "max", id, i)).filter(Boolean);
  const p = pr.length ? mean(pr.map(e => e.v)) : 0, s = sn.length ? mean(sn.map(e => e.v)) : 0, cc = cl.length ? mean(cl.map(e => e.v)) : null;
  const wet = pr.filter(e => e.v >= 0.5).length;
  const icon = p >= 1 && wet * 2 >= pr.length ? (s >= 0.5 ? (s * 7 >= p * 0.6 ? "snow" : "mix") : "rain") : cc == null ? "part" : cc < 25 ? "sun" : cc < 70 ? "part" : "cloud";
  const his = T.map(e => e.hi), los = T.map(e => e.lo);
  return { n: T.length, hi: mean(his), lo: mean(los), hiMin: Math.min(...his), hiMax: Math.max(...his), loMin: Math.min(...los), loMax: Math.max(...los),
           p, s, wet, np: pr.length, cloud: cc, gust: gu.length ? mean(gu.map(e => e.v)) : null, cape: ca.length ? Math.max(...ca.map(e => e.v)) : null, icon };
}
function agreeOf(spreadC) { return spreadC <= 2 ? ["High", "good"] : spreadC <= 4 ? ["Medium", "mid"] : ["Low", "bad"]; }
// ---------- Overview: stacked meteogram ----------
const OV_RANGES = [2, 3, 5, 7, 10];
function ovSource() {
  if (S.ovModel === "multi") { const n = ovPick().length; return { single: null, multi: true, label: `Comparing ${n} model${n === 1 ? "" : "s"}` }; }
  if (S.ovModel && S.ovModel !== "avg" && avail("temperature_2m").includes(S.ovModel)) return { single: S.ovModel, label: META(S.ovModel).name };
  return { single: null, label: `Average of ${visibleFor("temperature_2m").length} models` };
}
function ovIds(v) { const s = ovSource(); if (s.multi) return ovPick().filter(id => S.data.raw[v]?.[id]); return s.single ? (S.data.raw[v]?.[s.single] ? [s.single] : []) : visibleFor(v); }
function ovWin() {
  const D = S.data, ws = todayIdx() * 1440, last = D.mins[D.mins.length - 1];
  return { ws, span: Math.min((S.ovRange + 1) * 1440, last - ws) };
}
// Zoom: the visible part of the window, in minutes from the window start
function ovView() {
  const { span } = ovWin(), z = S.ovZ;
  if (!z) return { a: 0, b: span };
  const a = Math.max(0, Math.min(z.a, span - 180)), b = Math.min(span, Math.max(z.b, a + 180));
  return { a, b };
}
const ovVis = arr => { const { a, b } = ovView(); return arr.filter(p => p.m >= a && p.m <= b); };
// Hour-by-hour value (average across the source models) inside the window, raw units
function ovSeries(v, full) {
  const D = S.data, ids = ovIds(v), { ws, span } = ovWin(), { a, b } = full ? { a: 0, b: span } : ovView(), out = [];
  if (!ids.length) return out;
  for (let k = 0; k < D.mins.length; k++) {
    const m = D.mins[k] - ws; if (m < a || m > b) continue;
    const vals = []; for (const id of ids) { const x = D.raw[v][id]?.[k]; if (x != null) vals.push(x); }
    if (vals.length) out.push({ m, k, v: mean(vals), lo: Math.min(...vals), hi: Math.max(...vals), n: vals.length });
  }
  return out;
}
function ovObs(field) {
  const D = S.data; if (!D.obs?.pts.length) return [];
  const { ws } = ovWin(), { a, b } = ovView();
  return D.obs.pts.filter(p => p.m >= ws + a && p.m <= ws + b && p[field] != null).map(p => ({ m: p.m - ws, v: p[field] }));
}
// Shared chart frame for one panel: day headers, time grid, now shading, axes
function ovFrame(W, rows) {
  const narrow = W < 560, L = narrow ? 36 : 46, R = narrow ? 38 : 50, top0 = 20, xlab = 20, gap = 10;
  const { ws, span: full } = ovWin(), { a, b } = ovView(), span = b - a, D = S.data;
  let y = top0; const subs = rows.map(r => { const s = { ...r, top: y, bot: y + r.h }; y += r.h + gap; return s; });
  const H = y - gap + xlab;
  const x = m => L + ((m - a) / span) * (W - L - R);
  const days = span / 1440, pxH = (W - L - R) / (span / 60);
  const every = [1, 2, 3, 6, 12, 24].find(h => h * pxH >= (narrow ? 34 : 30)) || 24;
  let g = "";
  // vertical hour grid + labels
  const last = subs[subs.length - 1];
  for (let h = Math.ceil(a / 60 / every) * every; h * 60 <= b; h += every) {
    const m = h * 60, hh = h % 24;
    if (hh) for (const s of subs) g += `<line x1="${x(m)}" x2="${x(m)}" y1="${s.top}" y2="${s.bot}" stroke="rgba(255,255,255,.05)"/>`;
    const t = every >= 24 ? "" : hh === 0 ? "12a" : hh === 12 ? "12p" : hh < 12 ? `${hh}a` : `${hh - 12}p`;
    if (t) g += `<text x="${x(m)}" y="${last.bot + 15}" text-anchor="middle" font-size="10.5" fill="rgba(226,231,255,.5)">${t}</text>`;
  }
  // Day lines + labels sized to the room each (visible part of a) day gets
  const d0 = Math.floor(a / 1440), d1 = Math.floor((b - 1) / 1440);
  const firstDate = D.dates[todayIdx() + d0];
  if (firstDate) g += `<text x="${L - 5}" y="${top0 - 6}" text-anchor="end" font-size="11" font-weight="700" fill="rgba(226,231,255,.75)">${MO[dObj(firstDate).getUTCMonth()]}</text>`;
  for (let d = d0; d <= d1; d++) {
    const m0 = d * 1440, di = todayIdx() + d, sa = Math.max(a, m0), sb = Math.min(b, m0 + 1440);
    if (m0 > a) for (const s of subs) g += `<line x1="${x(m0)}" x2="${x(m0)}" y1="${s.top}" y2="${s.bot}" stroke="rgba(255,255,255,.2)"/>`;
    const date = D.dates[di]; if (!date) continue;
    const dd = dObj(date), wd = dd.getUTCDay(), dn = dd.getUTCDate(), room = x(sb) - x(sa);
    let t;
    if (room >= 150) t = `${d === 0 ? "Today" : WDL[wd]} <tspan font-weight="500" fill="rgba(226,231,255,.45)">${MO[dd.getUTCMonth()]} ${dn}</tspan>`;
    else if (room >= 64) t = d === 0 ? "Today" : dn === 1 ? `${WD[wd]} ${MO[dd.getUTCMonth()]} 1` : `${WD[wd]} ${dn}`;
    else if (room >= 40) t = dn === 1 && d ? `${MO[dd.getUTCMonth()]} 1` : `${WD[wd].slice(0, 2)} ${dn}`;
    else if (room >= 20) t = dn === 1 && d ? `${MO[dd.getUTCMonth()]}` : String(dn);
    else t = room < 12 ? "" : dn === 1 && d ? MO[dd.getUTCMonth()] : d % 2 ? "" : String(dn);
    if (!t) continue;
    const cx = room >= 150 ? x(sa) + 4 : x(sa) + room / 2;
    g += `<text x="${cx}" y="${top0 - 6}" ${room >= 150 ? "" : 'text-anchor="middle"'} font-size="${room >= 40 ? 11 : 10}" font-weight="700" fill="${d === 0 ? "#fff" : "rgba(226,231,255,.75)"}">${t}</text>`;
  }
  // past shading + now line
  const nm = nowMin() - ws, pe = Math.min(nm, b);
  if (pe > a) for (const s of subs) g += `<rect x="${L}" y="${s.top}" width="${x(pe) - L}" height="${s.h}" fill="rgba(255,255,255,.035)"/>`;
  if (nm > a && nm < b) for (const s of subs) g += `<line x1="${x(nm)}" x2="${x(nm)}" y1="${s.top}" y2="${s.bot}" stroke="rgba(255,255,255,.4)" stroke-dasharray="2 3"/>`;
  for (const s of subs) g += `<rect x="${L}" y="${s.top}" width="${W - L - R}" height="${s.h}" fill="none" stroke="rgba(255,255,255,.08)"/>`;
  return { W, H, L, R, x, span, a, b, full, subs, g, narrow };
}
function ovScale(s, lo, hi) { return v => s.top + (1 - (v - lo) / (hi - lo || 1)) * (s.bot - s.top); }
function ovAxis(F, s, lo, hi, step, side, fmtv, color = "rgba(226,231,255,.55)", grid = side === "l") {
  const y = ovScale(s, lo, hi); let g = "";
  for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + 1e-9; v += step) {
    if (grid) g += `<line x1="${F.L}" x2="${F.W - F.R}" y1="${y(v)}" y2="${y(v)}" stroke="rgba(255,255,255,.06)"/>`;
    g += side === "l" ? `<text x="${F.L - 5}" y="${y(v) + 3.5}" text-anchor="end" font-size="10" fill="${color}">${fmtv(v)}</text>`
                      : `<text x="${F.W - F.R + 5}" y="${y(v) + 3.5}" font-size="10" fill="${color}">${fmtv(v)}</text>`;
  }
  return g;
}
const ovPath = (F, pts, y, f = p => p.v) => { let d = "", prev = null; for (const p of pts) { d += `${!prev || p.m - prev.m > 90 ? "M" : "L"}${F.x(p.m).toFixed(1)},${y(f(p)).toFixed(1)}`; prev = p; } return d; };
const ovArea = (F, pts, y, base) => pts.length ? `M${F.x(pts[0].m).toFixed(1)},${base}` + pts.map(p => `L${F.x(p.m).toFixed(1)},${y(p.v).toFixed(1)}`).join("") + `L${F.x(pts[pts.length - 1].m).toFixed(1)},${base}Z` : "";
const nearest = (pts, m, tol = 35) => { let b = null; for (const p of pts) if (Math.abs(p.m - m) <= tol && (!b || Math.abs(p.m - m) < Math.abs(b.m - m))) b = p; return b; };
const leg = (kind, color, label) => `<span class="lg-i">${kind === "line" ? `<i class="ll" style="background:${color}"></i>` : kind === "dash" ? `<i class="ll dash" style="color:${color}"></i>` : kind === "area" ? `<i class="la" style="background:${color}"></i>` : kind === "bar" ? `<i class="lb" style="background:${color}"></i>` : kind === "ring" ? `<i class="lr" style="border-color:${color}"></i>` : `<i class="ld" style="background:${color}"></i>`}${esc(label)}</span>`;

function ovTempPanel(W) {
  const T = ovSeries("temperature_2m"), Dp = ovSeries("dew_point_2m"), Fl = ovSeries("apparent_temperature"), RH = ovSeries("relative_humidity_2m");
  const oT = S.ovObs ? ovObs("c") : [], oD = S.ovObs ? ovObs("d") : [];
  if (!T.length) return null;
  const F = ovFrame(W, [{ h: W < 560 ? 150 : 180 }, ...(RH.length ? [{ h: 56 }] : [])]);
  const s1 = F.subs[0], all = [...T, ...Dp, ...Fl].flatMap(p => [cvT(p.v), ...(ovSource().single ? [] : [cvT(p.lo), cvT(p.hi)])]).concat([...oT, ...oD].map(p => cvT(p.v)));
  let lo = Math.floor(Math.min(...all) - 1), hi = Math.ceil(Math.max(...all) + 1); const r = hi - lo, step = r > 40 ? 10 : r > 20 ? 5 : r > 8 ? 2 : 1;
  lo = Math.floor(lo / step) * step; hi = Math.ceil(hi / step) * step;
  const y = ovScale(s1, lo, hi), cv = p => cvT(p.v);
  let g = F.g + ovAxis(F, s1, lo, hi, step, "l", v => v + "°") + ovAxis(F, s1, lo, hi, step, "r", v => v + "°", undefined, false);
  const frz = S.unit === "F" ? 32 : 0; if (frz > lo && frz < hi) g += `<line x1="${F.L}" x2="${F.W - F.R}" y1="${y(frz)}" y2="${y(frz)}" stroke="#5ec8ff" stroke-width="1" stroke-dasharray="4 4" opacity=".6"/>`;
  if (!ovSource().single && T.length) g += `<path d="M${T.map(p => `${F.x(p.m).toFixed(1)},${y(cvT(p.hi)).toFixed(1)}`).join("L")}L${T.slice().reverse().map(p => `${F.x(p.m).toFixed(1)},${y(cvT(p.lo)).toFixed(1)}`).join("L")}Z" fill="#ff6b6b" opacity=".12"/>`;
  g += `<path d="${ovPath(F, Fl, y, cv)}" fill="none" stroke="#ff9f43" stroke-width="1.8" stroke-dasharray="5 3"/>`;
  g += `<path d="${ovPath(F, Dp, y, cv)}" fill="none" stroke="#3ee6a0" stroke-width="2"/>`;
  g += `<path d="${ovPath(F, T, y, cv)}" fill="none" stroke="#ff6b6b" stroke-width="2.4"/>`;
  for (const [o, col] of [[oD, "#3ee6a0"], [oT, "#ff6b6b"]]) g += o.map(p => `<circle cx="${F.x(p.m).toFixed(1)}" cy="${y(cvT(p.v)).toFixed(1)}" r="2.6" fill="#fff" stroke="${col}" stroke-width="1.2"/>`).join("");
  if (RH.length) {
    const s2 = F.subs[1], y2 = ovScale(s2, 0, 100);
    g += ovAxis(F, s2, 0, 100, 50, "l", v => v + "%") + `<path d="${ovArea(F, RH, y2, s2.bot)}" fill="#4c8dff" opacity=".22"/><path d="${ovPath(F, RH, y2)}" fill="none" stroke="#6ea8ff" stroke-width="1.6"/>`;
    g += `<text x="${F.L + 4}" y="${s2.top + 11}" font-size="9.5" font-weight="700" fill="rgba(110,168,255,.8)">RH</text>`;
  }
  const st = S.data.obs?.station;
  return { key: "temp", title: "Temperature & humidity", F, svg: g,
    legend: leg("line", "#ff6b6b", "Temperature") + leg("line", "#3ee6a0", "Dew point") + leg("dash", "#ff9f43", "Feels like") + (RH.length ? leg("area", "#6ea8ff", "Rel. humidity") : "") + (oT.length ? leg("dot", "#fff", `Observed ${st.id}`) : "") + (!ovSource().single ? leg("area", "rgba(255,107,107,.5)", "Model range") : ""),
    tip: m => { const t = nearest(T, m), d = nearest(Dp, m), f = nearest(Fl, m), h = nearest(RH, m), o = nearest(oT, m), od = nearest(oD, m), U = `°${S.unit}`;
      return [t && ["Temp", `${fmt(cvT(t.v))}${U}`, "#ff6b6b", !ovSource().single && t.n > 1 ? `models ${fmt(cvT(t.lo))} to ${fmt(cvT(t.hi))}` : ""], d && ["Dew point", `${fmt(cvT(d.v))}${U}`, "#3ee6a0"], f && ["Feels like", `${fmt(cvT(f.v))}${U}`, "#ff9f43"],
              h && ["RH", `${Math.round(h.v)}%`, "#6ea8ff"], o && [`Obs ${st.id} temp`, `${fmt(cvT(o.v))}${U}`, "#fff"], od && [`Obs ${st.id} dew`, `${fmt(cvT(od.v))}${U}`, "#fff"]]; },
    read: m => { const t = nearest(T, m), d = nearest(Dp, m), f = nearest(Fl, m), h = nearest(RH, m), o = nearest(oT, m);
      return `${t ? `<b class="c-t">${fmt(cvT(t.v))}°</b>` : ""}${d ? ` dew <b class="c-d">${fmt(cvT(d.v))}°</b>` : ""}${f ? ` feels <b class="c-f">${fmt(cvT(f.v))}°</b>` : ""}${h ? ` RH <b>${Math.round(h.v)}%</b>` : ""}${o ? ` · obs <b>${fmt(cvT(o.v))}°</b>` : ""}`; },
    dots: m => { const t = nearest(T, m); return t ? [[t.m, y(cvT(t.v)), "#ff6b6b"]] : []; } };
}
function ovPrecipPanel(W) {
  const Pf = ovSeries("precipitation", true), Sn = ovSeries("snowfall", true), C = ovSeries("cloud_cover"), P = ovVis(Pf);
  if (!P.length) return null;
  const F = ovFrame(W, [{ h: W < 560 ? 110 : 130 }, ...(C.length ? [{ h: 56 }] : [])]);
  const s1 = F.subs[0], ids = ovIds("precipitation"), inch = precipU() === "in";
  // accumulation (liquid) and snow total
  let acc = 0, sacc = 0; const A = ovVis(Pf.map(p => ({ m: p.m, v: (acc += p.v) })));
  const SA = ovVis(Sn.map(p => ({ m: p.m, v: (sacc += p.v) }))); acc = A.length ? A[A.length - 1].v : 0; sacc = SA.length ? SA[SA.length - 1].v : 0;
  const maxBar = Math.max(...P.map(p => cvP(p.v)), inch ? 0.04 : 1), maxAcc = Math.max(cvP(acc), cvS(sacc), inch ? 0.2 : 5);
  const st1 = niceStep(maxBar, 3), hi1 = Math.ceil(maxBar / st1) * st1, st2 = niceStep(maxAcc, 3), hi2 = Math.ceil(maxAcc * 1.05 / st2) * st2;
  const y1 = ovScale(s1, 0, hi1), y2 = ovScale(s1, 0, hi2), dec = st => st < 0.1 ? 2 : st < 1 ? 1 : 0;
  let g = F.g + ovAxis(F, s1, 0, hi1, st1, "l", v => v.toFixed(dec(st1))) + ovAxis(F, s1, 0, hi2, st2, "r", v => v.toFixed(dec(st2)), "rgba(120,180,255,.75)", false);
  const bw = Math.max(1.2, (F.W - F.L - F.R) / (F.span / 60) - 1);
  for (const p of P) {
    if (p.v < 0.05) continue;
    const c = { rain: 0, snow: 0, mix: 0 }; for (const id of ids) { const t = ptype(id, p.k); if (t) c[t]++; }
    const ty = Object.entries(c).sort((a, b) => b[1] - a[1])[0]; const col = ty[1] ? PT_COLOR[ty[0]] : PT_COLOR.rain;
    g += `<rect x="${(F.x(p.m) - bw).toFixed(1)}" y="${y1(cvP(p.v)).toFixed(1)}" width="${bw.toFixed(1)}" height="${(s1.bot - y1(cvP(p.v))).toFixed(1)}" fill="${col}" opacity=".9"/>`;
  }
  g += `<path d="${ovPath(F, A, y2, p => cvP(p.v))}" fill="none" stroke="#4c8dff" stroke-width="2.2"/>`;
  if (sacc > 0.05) g += `<path d="${ovPath(F, SA, y2, p => cvS(p.v))}" fill="none" stroke="#e9f1ff" stroke-width="1.8" stroke-dasharray="5 3"/>`;
  g += `<text x="${F.L + 4}" y="${s1.top + 11}" font-size="9.5" font-weight="700" fill="rgba(226,231,255,.55)">${inch ? "in" : "mm"}/h</text><text x="${F.W - F.R - 4}" y="${s1.top + 11}" text-anchor="end" font-size="9.5" font-weight="700" fill="rgba(120,180,255,.8)">total ${inch ? "in" : "mm / cm"}</text>`;
  if (C.length) {
    const s2 = F.subs[1], yc = ovScale(s2, 0, 100);
    g += ovAxis(F, s2, 0, 100, 50, "l", v => v + "%") + `<path d="${ovArea(F, C, yc, s2.bot)}" fill="#9aa8d6" opacity=".35"/><path d="${ovPath(F, C, yc)}" fill="none" stroke="#b8c3e8" stroke-width="1.4"/>`;
    g += `<text x="${F.L + 4}" y="${s2.top + 11}" font-size="9.5" font-weight="700" fill="rgba(200,210,240,.8)">Cloud</text>`;
  }
  return { key: "precip", title: "Precipitation & cloud", F, svg: g,
    legend: leg("bar", PT_COLOR.rain, "Rain /h") + leg("bar", PT_COLOR.snow, "Snow /h") + leg("bar", PT_COLOR.mix, "Mix /h") + leg("line", "#4c8dff", `Total precip`) + (sacc > 0.05 ? leg("dash", "#e9f1ff", `Total snow (${inch ? "in" : "cm"})`) : "") + (C.length ? leg("area", "#9aa8d6", "Cloud cover") : ""),
    tip: m => { const p = nearest(P, m), a = nearest(A, m), c = nearest(C, m), sa = nearest(SA, m), pu = precipU(), su = inch ? "in" : "cm";
      let ty = ""; if (p && p.v >= 0.05) { const cnt = { rain: 0, snow: 0, mix: 0 }; for (const id of ids) { const t = ptype(id, p.k); if (t) cnt[t]++; } const top = Object.entries(cnt).sort((x, y) => y[1] - x[1])[0]; if (top[1]) ty = ` ${PT_LABEL[top[0]].toLowerCase()}`; }
      return [p && ["1 hr precip", `${fv("precip", cvP(p.v), "hr")} ${pu}${ty}`, ty.includes("snow") ? PT_COLOR.snow : ty.includes("mix") ? PT_COLOR.mix : PT_COLOR.rain], a && ["Total precip", `${fv("precip", cvP(a.v), "hr")} ${pu}`, "#4c8dff"],
              sa && sa.v > 0.05 && ["Total snow", `${fv("precip", cvS(sa.v), "snow")} ${su}`, "#e9f1ff"], c && ["Cloud cover", `${Math.round(c.v)}%`, "#9aa8d6"]]; },
    read: m => { const p = nearest(P, m), a = nearest(A, m), c = nearest(C, m), sa = nearest(SA, m);
      return `${p ? `<b class="c-p">${fv("precip", cvP(p.v), "hr")}</b> ${precipU()}/h` : ""}${a ? ` · total <b>${fv("precip", cvP(a.v), "hr")}</b>` : ""}${sa && sa.v > 0.05 ? ` · snow <b>${fv("precip", cvS(sa.v), "snow")}</b> ${inch ? "in" : "cm"}` : ""}${c ? ` · cloud <b>${Math.round(c.v)}%</b>` : ""}`; },
    dots: m => { const a = nearest(A, m); return a ? [[a.m, y2(cvP(a.v)), "#4c8dff"]] : []; } };
}
function ovWindPanel(W) {
  const Wd = ovSeries("wind_speed_10m"), Gu = ovSeries("wind_gusts_10m"), Pr = ovSeries("pressure_msl"), oW = S.ovObs ? ovObs("w") : [], oG = S.ovObs ? ovObs("g") : [];
  if (!Wd.length) return null;
  const D = S.data, F = ovFrame(W, [{ h: W < 560 ? 140 : 165 }]), s1 = F.subs[0];
  const mx = Math.max(...Wd.map(p => cvW(p.v)), ...Gu.map(p => cvW(p.v)), ...oW.map(p => cvW(p.v)), ...oG.map(p => cvW(p.v)), 20);
  const st = niceStep(mx, 4), hi = Math.ceil(mx * 1.05 / st) * st, y = ovScale(s1, 0, hi);
  let g = F.g + ovAxis(F, s1, 0, hi, st, "l", v => Math.round(v));
  if (Pr.length) {
    const pv = Pr.map(p => p.v), plo = Math.floor(Math.min(...pv) - 1), phi = Math.ceil(Math.max(...pv) + 1), pst = niceStep(phi - plo, 4), pl = Math.floor(plo / pst) * pst, ph = Math.ceil(phi / pst) * pst, yp = ovScale(s1, pl, ph);
    g += ovAxis(F, s1, pl, ph, pst, "r", v => Math.round(v), "rgba(200,200,215,.7)", false) + `<path d="${ovPath(F, Pr, yp)}" fill="none" stroke="#aab0c6" stroke-width="1.6" opacity=".85"/>`;
    g += `<text x="${F.W - F.R - 4}" y="${s1.top + 11}" text-anchor="end" font-size="9.5" font-weight="700" fill="rgba(200,200,215,.7)">hPa</text>`;
  }
  g += `<path d="${ovArea(F, Wd, y, s1.bot)}" fill="#3ee6a0" opacity=".14"/><path d="${ovPath(F, Wd, y, p => cvW(p.v))}" fill="none" stroke="#3ee6a0" stroke-width="2.2"/>`;
  const r = F.span <= 3.5 * 1440 ? 2.6 : 1.8;
  g += Gu.map(p => `<circle cx="${F.x(p.m).toFixed(1)}" cy="${y(cvW(p.v)).toFixed(1)}" r="${r}" fill="none" stroke="#9ef7c9" stroke-width="1.3"/>`).join("");
  g += oW.map(p => `<circle cx="${F.x(p.m).toFixed(1)}" cy="${y(cvW(p.v)).toFixed(1)}" r="2.4" fill="#fff"/>`).join("") + oG.map(p => `<circle cx="${F.x(p.m).toFixed(1)}" cy="${y(cvW(p.v)).toFixed(1)}" r="3" fill="none" stroke="#fff" stroke-width="1.4"/>`).join("");
  // Direction arrows (vector average) along the bottom
  const ids = ovIds("wind_direction_10m"), stepH = F.span <= 2.5 * 1440 ? 3 : F.span <= 5.5 * 1440 ? 6 : 12;
  for (const p of Wd) {
    if (Math.round(p.m / 60) % stepH) continue;
    let u = 0, v = 0, n = 0; for (const id of ids) { const d = D.raw.wind_direction_10m[id]?.[p.k], s = D.raw.wind_speed_10m[id]?.[p.k]; if (d != null && s != null) { u += s * Math.sin(d * Math.PI / 180); v += s * Math.cos(d * Math.PI / 180); n++; } }
    if (!n) continue; const dir = (Math.atan2(u, v) * 180 / Math.PI + 360) % 360;
    g += `<g transform="translate(${F.x(p.m).toFixed(1)},${s1.bot - 9}) rotate(${(dir + 180).toFixed(0)})"><path d="M0,-6L3.2,2L0,0.2L-3.2,2Z" fill="rgba(226,231,255,.7)"/></g>`;
  }
  g += `<text x="${F.L + 4}" y="${s1.top + 11}" font-size="9.5" font-weight="700" fill="rgba(62,230,160,.8)">${esc(WIND_L[windU()])}</text>`;
  const st2 = D.obs?.station;
  return { key: "wind", title: "Wind & pressure", F, svg: g,
    legend: leg("line", "#3ee6a0", "Wind") + leg("ring", "#9ef7c9", "Gusts") + leg("dot", "rgba(226,231,255,.7)", "Direction (arrows)") + (Pr.length ? leg("line", "#aab0c6", "Sea-level pressure") : "") + (oW.length ? leg("dot", "#fff", `Observed ${st2.id}`) : ""),
    tip: m => { const w = nearest(Wd, m), gu = nearest(Gu, m), p = nearest(Pr, m), o = nearest(oW, m), og = nearest(oG, m), wu = WIND_L[windU()];
      let dir = ""; if (w) { let u = 0, v = 0, n = 0; for (const id of ids) { const d = D.raw.wind_direction_10m[id]?.[w.k], s = D.raw.wind_speed_10m[id]?.[w.k]; if (d != null && s != null) { u += s * Math.sin(d * Math.PI / 180); v += s * Math.cos(d * Math.PI / 180); n++; } } if (n) { const deg = Math.round((Math.atan2(u, v) * 180 / Math.PI + 360) % 360); dir = `${compass(deg)} (${deg}°) at `; } }
      return [w && ["Wind", `${dir}${Math.round(cvW(w.v))} ${wu}`, "#3ee6a0"], gu && ["Gusts", `${Math.round(cvW(gu.v))} ${wu}`, "#9ef7c9"], p && ["Pressure", `${p.v.toFixed(1)} hPa`, "#aab0c6"],
              o && [`Obs ${st2.id} wind`, `${Math.round(cvW(o.v))} ${wu}`, "#fff"], og && [`Obs ${st2.id} gust`, `${Math.round(cvW(og.v))} ${wu}`, "#fff"]]; },
    read: m => { const w = nearest(Wd, m), gu = nearest(Gu, m), p = nearest(Pr, m), o = nearest(oW, m);
      return `${w ? `<b class="c-w">${Math.round(cvW(w.v))}</b>` : ""}${gu ? ` gust <b class="c-g">${Math.round(cvW(gu.v))}</b>` : ""} ${esc(WIND_L[windU()])}${p ? ` · <b>${p.v.toFixed(1)}</b> hPa` : ""}${o ? ` · obs <b>${Math.round(cvW(o.v))}</b>` : ""}`; },
    dots: m => { const w = nearest(Wd, m); return w ? [[w.m, y(cvW(w.v)), "#3ee6a0"]] : []; } };
}
function ovStormPanel(W) {
  const C = ovSeries("cape"), H = S.data.raw.srh ? ovSeries("srh") : [];
  if (!C.length && !H.length) return null;
  const F = ovFrame(W, [{ h: W < 560 ? 110 : 130 }]), s1 = F.subs[0];
  const cm = Math.max(500, ...C.map(p => p.v)), cst = niceStep(cm, 3), chi = Math.ceil(cm * 1.05 / cst) * cst, y = ovScale(s1, 0, chi);
  let g = F.g + ovAxis(F, s1, 0, chi, cst, "l", v => v >= 1000 ? (v / 1000) + "k" : v);
  for (const [v, c] of [[1000, "rgba(255,209,102,.5)"], [2500, "rgba(255,122,126,.55)"]]) if (v < chi) g += `<line x1="${F.L}" x2="${F.W - F.R}" y1="${y(v)}" y2="${y(v)}" stroke="${c}" stroke-dasharray="3 4"/>`;
  g += `<path d="${ovArea(F, C, y, s1.bot)}" fill="#ffd166" opacity=".25"/><path d="${ovPath(F, C, y)}" fill="none" stroke="#ffd166" stroke-width="2"/>`;
  let yh = null;
  if (H.length) {
    const hv = H.map(p => p.v), hlo = Math.min(0, ...hv), hm = Math.max(150, ...hv), hst = niceStep(hm - hlo, 3), hhi = Math.ceil(hm * 1.05 / hst) * hst, hl = Math.floor(hlo / hst) * hst;
    yh = ovScale(s1, hl, hhi);
    g += ovAxis(F, s1, hl, hhi, hst, "r", v => Math.round(v), "rgba(110,168,255,.8)", false) + `<path d="${ovPath(F, H, yh)}" fill="none" stroke="#6ea8ff" stroke-width="2"/>`;
  }
  g += `<text x="${F.L + 4}" y="${s1.top + 11}" font-size="9.5" font-weight="700" fill="rgba(255,209,102,.85)">J/kg</text>${H.length ? `<text x="${F.W - F.R - 4}" y="${s1.top + 11}" text-anchor="end" font-size="9.5" font-weight="700" fill="rgba(110,168,255,.85)">m²/s²</text>` : ""}`;
  const srhMsg = S.data.srhState === "loading" ? " · loading helicity…" : S.data.srhState === "ok" && !H.length ? " · helicity not available from this model" : "";
  return { key: "storm", title: "CAPE & helicity", F, svg: g, note: srhMsg,
    legend: leg("area", "#ffd166", "CAPE") + leg("line", "#6ea8ff", "Helicity 0–3 km (est.)") + `<span class="lg-i lg-n">dashed = 1000 / 2500 J/kg</span>`,
    tip: m => { const c = nearest(C, m), h = nearest(H, m); return [c && ["CAPE", `${Math.round(c.v)} J/kg`, "#ffd166"], h && ["Helicity 0–3 km", `${Math.round(h.v)} m²/s²`, "#6ea8ff"]]; },
    read: m => { const c = nearest(C, m), h = nearest(H, m); return `${c ? `CAPE <b class="c-c">${Math.round(c.v)}</b> J/kg` : ""}${h ? ` · SRH <b class="c-h">${Math.round(h.v)}</b> m²/s²` : ""}`; },
    dots: m => { const c = nearest(C, m), out = c ? [[c.m, y(c.v), "#ffd166"]] : []; const h = nearest(H, m); if (h && yh) out.push([h.m, yh(h.v), "#6ea8ff"]); return out; } };
}

// ---------- Overview: compare several models (colour = model, line style = parameter) ----------
const OV_MAX = 8;
const CMP_PALETTE = ["#4cc9f0", "#f72585", "#ffd166", "#b388ff", "#ff9f43", "#2ec4b6", "#ff6b6b", "#a3e635", "#ffffff", "#818cf8"];
const hex2rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const cdist = (a, b) => { const [r1, g1, b1] = hex2rgb(a), [r2, g2, b2] = hex2rgb(b); return Math.hypot(r1 - r2, (g1 - g2) * 1.2, b1 - b2); };
function ovColorMap(ids) {
  const used = [], map = {};
  for (const id of ids) {
    let c = colorOf(id);
    const gap = col => used.length ? Math.min(...used.map(u => cdist(u, col))) : 999;
    if (gap(c) < 85) c = [...CMP_PALETTE, c].sort((p, q) => gap(q) - gap(p))[0];
    used.push(c); map[id] = c;
  }
  return id => map[id] || colorOf(id);
}
const ovMulti = () => S.ovModel === "multi";
function ovPick() { const ok = new Set(avail("temperature_2m")); return S.ovModels.filter(id => ok.has(id)).slice(0, OV_MAX); }
function ovSer1(v, id, full) {     // one model's hourly series in the window (or the zoomed part), raw units
  const D = S.data, arr = D.raw[v]?.[id], { ws, span } = ovWin(), { a, b } = full ? { a: 0, b: span } : ovView(), out = [];
  if (!arr) return out;
  for (let k = 0; k < D.mins.length; k++) { const m = D.mins[k] - ws; if (m >= a && m <= b && arr[k] != null) out.push({ m, k, v: arr[k] }); }
  return out;
}
const modelKey = (ids, col = colorOf) => ids.map(id => `<span class="lg-i"><i class="ld" style="background:${col(id)}"></i>${esc(META(id).short)}</span>`).join("");
// Weather colours in Compare mode: each model gets its own shade of the parameter's colour
const SHADES = {
  rain:  ["#4cc9f0", "#3b6cff", "#b5e4ff", "#7b7dff", "#1fb6d9", "#9fb4ff", "#5aa2e8", "#d4f0ff"],
  snow:  ["#ffffff", "#8fd3ff", "#c6b3ff", "#7fe6d6", "#ffc2e2", "#aab6cc", "#f2e48c", "#9fb0ff"],
  cloud: ["#ffffff", "#8fb0e0", "#d8c39e", "#6f7a94", "#c4aee6", "#9fcfc4", "#e3a99f", "#b9bcc6"],
  wind:  ["#3ee6a0", "#9be15d", "#1fb36a", "#c9f7a8", "#2fd4b4", "#6fbf73", "#e2ffd6", "#4be36b"],
  press: ["#d4d7e3", "#9ca3b8", "#bfb4a3", "#7e8aa8", "#c4bdd6", "#a7b8b0", "#e6e8ef", "#8a8f9c"],
};
const CLOUD_DASH = ["", "7 3", "2 3", "9 3 2 3", "1 4", "14 4", "4 2", "3 6"];
const SNOW_DASH = ["7 3", "2 3", "10 3 2 3", "1.5 4", "14 4", "4 2", "3 6", "6 2 1 2"];
const snowDash = ids => id => SNOW_DASH[Math.max(0, ids.indexOf(id)) % 8];
const cloudDash = ids => id => CLOUD_DASH[Math.max(0, ids.indexOf(id)) % 8];
const PAT_DASH = ["", "9 4", "2 3", "10 3 2 3", "5 3", "1.5 5", "12 3 2 3 2 3", "3 6"];
const patIdx = ids => id => Math.max(0, ids.indexOf(id)) % 8;
// marker shapes placed along a line every few hours (helps tell same-colour-family lines apart)
function markers(F, pts, y, f, shape, col, every) {
  let out = "";
  for (const p of pts) if (Math.round(p.m / 60) % every === (shape % 3)) out += dotShape(shape, F.x(p.m), y(f(p)), 2.6);
  return `<g fill="${col}" stroke="${col}" stroke-width="0">${out}</g>`;
}
const shadeOf = (kind, ids) => id => SHADES[kind][Math.max(0, ids.indexOf(id)) % 8];
const styleKey = items => items.map(([kind, label]) => `<span class="lg-i">${kind === "dot" ? `<i class="ld" style="background:#cfd6f5"></i>` : kind === "ring" ? `<i class="lr" style="border-color:#cfd6f5"></i>` : `<svg width="18" height="6"><line x1="0" y1="3" x2="18" y2="3" stroke="#cfd6f5" stroke-width="2" stroke-dasharray="${kind}"/></svg>`}${esc(label)}</span>`).join("");
const span2 = (a, f) => a.length ? `${f(Math.min(...a))}–${f(Math.max(...a))}` : "–";

function ovTempMulti(W) {
  const ids = ovPick(), U = `°${S.unit}`, st = S.data.obs?.station, mc = ovColorMap(ids);
  const T = {}, Dp = {}, Fl = {}, RH = {};
  for (const id of ids) { T[id] = ovSer1("temperature_2m", id); Dp[id] = ovSer1("dew_point_2m", id); Fl[id] = ovSer1("apparent_temperature", id); RH[id] = ovSer1("relative_humidity_2m", id); }
  const oT = S.ovObs ? ovObs("c") : [], oD = S.ovObs ? ovObs("d") : [];
  const vals = ids.flatMap(id => [...T[id], ...Dp[id], ...Fl[id]].map(p => cvT(p.v))).concat([...oT, ...oD].map(p => cvT(p.v)));
  if (!vals.length) return null;
  const hasRH = ids.some(id => RH[id].length);
  const F = ovFrame(W, [{ h: W < 560 ? 160 : 200 }, ...(hasRH ? [{ h: 56 }] : [])]), s1 = F.subs[0];
  let lo = Math.floor(Math.min(...vals) - 1), hi = Math.ceil(Math.max(...vals) + 1); const r = hi - lo, step = r > 40 ? 10 : r > 20 ? 5 : r > 8 ? 2 : 1;
  lo = Math.floor(lo / step) * step; hi = Math.ceil(hi / step) * step;
  const y = ovScale(s1, lo, hi), cv = p => cvT(p.v);
  let g = F.g + ovAxis(F, s1, lo, hi, step, "l", v => v + "°") + ovAxis(F, s1, lo, hi, step, "r", v => v + "°", undefined, false);
  const frz = S.unit === "F" ? 32 : 0; if (frz > lo && frz < hi) g += `<line x1="${F.L}" x2="${F.W - F.R}" y1="${y(frz)}" y2="${y(frz)}" stroke="#5ec8ff" stroke-width="1" stroke-dasharray="4 4" opacity=".6"/>`;
  for (const id of ids) g += `<path d="${ovPath(F, Fl[id], y, cv)}" fill="none" stroke="${mc(id)}" stroke-width="1.3" stroke-dasharray="1.5 3" stroke-linecap="round" opacity=".85"/>`;
  for (const id of ids) g += `<path d="${ovPath(F, Dp[id], y, cv)}" fill="none" stroke="${mc(id)}" stroke-width="1.5" stroke-dasharray="6 4" opacity=".9"/>`;
  for (const id of ids) g += `<path d="${ovPath(F, T[id], y, cv)}" fill="none" stroke="${mc(id)}" stroke-width="2.2"/>`;
  for (const o of [oD, oT]) g += o.map(p => `<circle cx="${F.x(p.m).toFixed(1)}" cy="${y(cvT(p.v)).toFixed(1)}" r="2.6" fill="#fff" stroke="#0a0e22" stroke-width="1"/>`).join("");
  if (hasRH) {
    const s2 = F.subs[1], y2 = ovScale(s2, 0, 100);
    g += ovAxis(F, s2, 0, 100, 50, "l", v => v + "%") + ids.map(id => `<path d="${ovPath(F, RH[id], y2)}" fill="none" stroke="${mc(id)}" stroke-width="1.3" opacity=".85"/>`).join("");
    g += `<text x="${F.L + 4}" y="${s2.top + 11}" font-size="9.5" font-weight="700" fill="rgba(226,231,255,.6)">RH</text>`;
  }
  const at = (o, m) => nearest(o, m);
  return { key: "temp", title: "Temperature & humidity", F, svg: g,
    legend: modelKey(ids, mc) + `<span class="lg-sep"></span>` + styleKey([["", "Temperature"], ["6 4", "Dew point"], ["1.5 3", "Feels like"]]) + (hasRH ? `<span class="lg-i lg-n">lower strip = RH</span>` : "") + (oT.length ? leg("dot", "#fff", `Observed ${st.id}`) : ""),
    col: mc,
    tip: m => [...ids.map(id => { const t = at(T[id], m), d = at(Dp[id], m), f = at(Fl[id], m), h = at(RH[id], m);
        return t && [META(id).short, `${fmt(cvT(t.v))}°${d ? ` · dew ${fmt(cvT(d.v))}°` : ""}${f ? ` · feels ${fmt(cvT(f.v))}°` : ""}${h ? ` · ${Math.round(h.v)}%` : ""}`, mc(id)]; }),
        at(oT, m) && [`Observed ${st.id}`, `${fmt(cvT(at(oT, m).v))}°${at(oD, m) ? ` · dew ${fmt(cvT(at(oD, m).v))}°` : ""}`, "#fff"]],
    table: m => ({ head: ["Temp", "Dew pt", "Feels", "RH"], rows: [...ids.map(id => { const t = at(T[id], m), d = at(Dp[id], m), f = at(Fl[id], m), h = at(RH[id], m);
        return [id, t && fmt(cvT(t.v)) + "°", d && fmt(cvT(d.v)) + "°", f && fmt(cvT(f.v)) + "°", h && Math.round(h.v) + "%"]; }),
        ...(oT.length ? [["obs", at(oT, m) && fmt(cvT(at(oT, m).v)) + "°", at(oD, m) && fmt(cvT(at(oD, m).v)) + "°", null, null]] : [])], hi: 1 }),
    read: m => { const t = ids.map(id => at(T[id], m)).filter(Boolean).map(p => cvT(p.v)), o = at(oT, m); return `temp <b class="c-t">${span2(t, fmt)}${U}</b> across ${t.length} models${o ? ` · obs <b>${fmt(cvT(o.v))}°</b>` : ""}`; },
    dots: m => ids.map(id => { const t = at(T[id], m); return t && [t.m, y(cvT(t.v)), mc(id)]; }).filter(Boolean) };
}
function ovPrecipMulti(W) {
  const ids = ovPick().filter(id => S.data.raw.precipitation?.[id]); if (!ids.length) return null;
  const inch = precipU() === "in", P = {}, A = {}, SA = {}, C = {};
  let maxAcc = inch ? 0.2 : 5, anySnow = false;
  for (const id of ids) {
    const pf = ovSer1("precipitation", id, true); P[id] = ovVis(pf); C[id] = ovSer1("cloud_cover", id);
    let a = 0; A[id] = ovVis(pf.map(p => ({ m: p.m, k: p.k, v: (a += p.v) }))); a = A[id].length ? A[id][A[id].length - 1].v : 0;
    let s = 0; SA[id] = ovVis(ovSer1("snowfall", id, true).map(p => ({ m: p.m, v: (s += p.v) }))); s = SA[id].length ? SA[id][SA[id].length - 1].v : 0;
    maxAcc = Math.max(maxAcc, cvP(a), cvS(s)); if (s > 0.05) anySnow = true;
  }
  const hasC = ids.some(id => C[id].length);
  const F = ovFrame(W, [{ h: W < 560 ? 120 : 140 }, ...(hasC ? [{ h: W < 560 ? 80 : 90 }] : [])]), s1 = F.subs[0];
  // hourly bars = average of the compared models, coloured by type
  const avg = []; for (const p of P[ids[0]] || []) { const vs = ids.map(id => S.data.raw.precipitation[id]?.[p.k]).filter(x => x != null); avg.push({ m: p.m, k: p.k, v: mean(vs) }); }
  const maxBar = Math.max(...avg.map(p => cvP(p.v)), inch ? 0.04 : 1);
  const st1 = niceStep(maxBar, 3), hi1 = Math.ceil(maxBar / st1) * st1, st2 = niceStep(maxAcc, 3), hi2 = Math.ceil(maxAcc * 1.05 / st2) * st2;
  const y1 = ovScale(s1, 0, hi1), y2 = ovScale(s1, 0, hi2), dec = st => st < 0.1 ? 2 : st < 1 ? 1 : 0;
  let g = F.g + ovAxis(F, s1, 0, hi1, st1, "l", v => v.toFixed(dec(st1))) + ovAxis(F, s1, 0, hi2, st2, "r", v => v.toFixed(dec(st2)), "rgba(226,231,255,.7)", false);
  const bw = Math.max(1.2, (F.W - F.L - F.R) / (F.span / 60) - 1);
  for (const p of avg) {
    if (p.v < 0.05) continue;
    const c = { rain: 0, snow: 0, mix: 0 }; for (const id of ids) { const t = ptype(id, p.k); if (t) c[t]++; }
    const ty = Object.entries(c).sort((a, b) => b[1] - a[1])[0];
    g += `<rect x="${(F.x(p.m) - bw).toFixed(1)}" y="${y1(cvP(p.v)).toFixed(1)}" width="${bw.toFixed(1)}" height="${(s1.bot - y1(cvP(p.v))).toFixed(1)}" fill="${ty[1] ? PT_COLOR[ty[0]] : PT_COLOR.rain}" opacity=".4"/>`;
  }
  const rc = shadeOf("rain", ids), sc = shadeOf("snow", ids), cc = shadeOf("cloud", ids);
  for (const id of ids) {
    g += `<path d="${ovPath(F, A[id], y2, p => cvP(p.v))}" fill="none" stroke="${rc(id)}" stroke-width="2"/>` + markers(F, A[id], y2, p => cvP(p.v), patIdx(ids)(id), rc(id), F.span <= 3.5 * 1440 ? 6 : 12);
    if (anySnow && SA[id].length) g += `<path d="${ovPath(F, SA[id], y2, p => cvS(p.v))}" fill="none" stroke="${sc(id)}" stroke-width="2" stroke-dasharray="${snowDash(ids)(id)}" stroke-linecap="round"/>`;
  }
  g += `<text x="${F.L + 4}" y="${s1.top + 11}" font-size="9.5" font-weight="700" fill="rgba(226,231,255,.55)">${inch ? "in" : "mm"}/h (avg)</text><text x="${F.W - F.R - 4}" y="${s1.top + 11}" text-anchor="end" font-size="9.5" font-weight="700" fill="rgba(226,231,255,.7)">total ${inch ? "in" : "mm / cm"}</text>`;
  if (hasC) {
    const s2 = F.subs[1], yc = ovScale(s2, 0, 100);
    const cd = cloudDash(ids);
    g += ovAxis(F, s2, 0, 100, 50, "l", v => v + "%") + ids.map(id => `<path d="${ovPath(F, C[id], yc)}" fill="none" stroke="${cc(id)}" stroke-width="1.6" stroke-dasharray="${cd(id)}" stroke-linecap="round" opacity=".95"/>`).join("");
    g += `<text x="${F.L + 4}" y="${s2.top + 11}" font-size="9.5" font-weight="700" fill="rgba(226,231,255,.6)">Cloud</text>`;
  }
  const pu = precipU(), su = inch ? "in" : "cm";
  return { key: "precip", title: "Precipitation & cloud", F, svg: g,
    legend: `<span class="lg-i lg-n">Total precip</span>` + ids.map(id => `<span class="lg-i"><svg width="20" height="8"><line x1="0" y1="4" x2="20" y2="4" stroke="${rc(id)}" stroke-width="2"/><g fill="${rc(id)}" stroke="${rc(id)}" stroke-width="0">${dotShape(patIdx(ids)(id), 10, 4, 2.8)}</g></svg>${esc(META(id).short)}</span>`).join("") + (anySnow ? `<span class="lg-sep"></span><span class="lg-i lg-n">Total snow</span>` + ids.map(id => `<span class="lg-i"><svg width="20" height="6"><line x1="0" y1="3" x2="20" y2="3" stroke="${sc(id)}" stroke-width="2" stroke-dasharray="${snowDash(ids)(id)}" stroke-linecap="round"/></svg>${esc(META(id).short)}</span>`).join("") : "") + (hasC ? `<span class="lg-sep"></span><span class="lg-i lg-n">Cloud</span>` + ids.map(id => `<span class="lg-i"><svg width="20" height="6"><line x1="0" y1="3" x2="20" y2="3" stroke="${cc(id)}" stroke-width="2" stroke-dasharray="${cloudDash(ids)(id)}" stroke-linecap="round"/></svg>${esc(META(id).short)}</span>`).join("") : "") + `<span class="lg-sep"></span>` + leg("bar", PT_COLOR.rain, "Avg rain /h") + leg("bar", PT_COLOR.snow, "snow") + leg("bar", PT_COLOR.mix, "mix"),
    col: rc,
    tip: m => ids.map(id => { const a = nearest(A[id], m); if (!a) return null; const p = nearest(P[id], m), c = nearest(C[id], m), sa = nearest(SA[id], m), ty = p ? ptype(id, p.k) : null;
        return [META(id).short, `${fv("precip", cvP(a.v), "hr")} ${pu}${p && p.v >= 0.05 ? ` · ${fv("precip", cvP(p.v), "hr")}/h${ty ? " " + PT_LABEL[ty].toLowerCase() : ""}` : ""}${sa && sa.v > 0.05 ? ` · snow ${fv("precip", cvS(sa.v), "snow")} ${su}` : ""}${c ? ` · ${Math.round(c.v)}%` : ""}`, rc(id)]; }),
    table: m => ({ head: [`1 hr`, `Total ${pu}`, ...(anySnow ? [`Snow ${su}`] : []), "Cloud"], rows: ids.map(id => { const p = nearest(P[id], m), a = nearest(A[id], m), sa = nearest(SA[id], m), c = nearest(C[id], m), ty = p ? ptype(id, p.k) : null;
        return [id, p && `${fv("precip", cvP(p.v), "hr")}${ty ? `<i class="pt" style="background:${PT_COLOR[ty]}" title="${PT_LABEL[ty]}"></i>` : ""}`, a && fv("precip", cvP(a.v), "hr"), ...(anySnow ? [sa ? fv("precip", cvS(sa.v), "snow") : "0"] : []), c && Math.round(c.v) + "%"]; }), hi: 2 }),
    read: m => { const t = ids.map(id => nearest(A[id], m)).filter(Boolean).map(p => cvP(p.v)); return `total so far <b class="c-p">${span2(t, v => fv("precip", v, "hr"))}</b> ${pu} across ${t.length} models`; },
    dots: m => ids.map(id => { const a = nearest(A[id], m); return a && [a.m, y2(cvP(a.v)), rc(id)]; }).filter(Boolean) };
}
function ovWindMulti(W) {
  const D = S.data, ids = ovPick().filter(id => D.raw.wind_speed_10m?.[id]); if (!ids.length) return null;
  const Wd = {}, Gu = {}, Pr = {};
  for (const id of ids) { Wd[id] = ovSer1("wind_speed_10m", id); Gu[id] = ovSer1("wind_gusts_10m", id); Pr[id] = ovSer1("pressure_msl", id); }
  const oW = S.ovObs ? ovObs("w") : [], oG = S.ovObs ? ovObs("g") : [], st2 = D.obs?.station;
  const F = ovFrame(W, [{ h: W < 560 ? 150 : 180 }]), s1 = F.subs[0];
  const mx = Math.max(20, ...ids.flatMap(id => [...Wd[id], ...Gu[id]].map(p => cvW(p.v))), ...[...oW, ...oG].map(p => cvW(p.v)));
  const st = niceStep(mx, 4), hi = Math.ceil(mx * 1.05 / st) * st, y = ovScale(s1, 0, hi);
  let g = F.g + ovAxis(F, s1, 0, hi, st, "l", v => Math.round(v));
  const wc = shadeOf("wind", ids), pc = shadeOf("press", ids);
  const pv = ids.flatMap(id => Pr[id].map(p => p.v));
  if (pv.length) {
    const plo = Math.floor(Math.min(...pv) - 1), phi = Math.ceil(Math.max(...pv) + 1), pst = niceStep(phi - plo, 4), pl = Math.floor(plo / pst) * pst, ph = Math.ceil(phi / pst) * pst, yp = ovScale(s1, pl, ph);
    g += ovAxis(F, s1, pl, ph, pst, "r", v => Math.round(v), "rgba(200,200,215,.7)", false) + ids.map((id, n) => `<path d="${ovPath(F, Pr[id], yp)}" fill="none" stroke="${pc(id)}" stroke-width="1.3" stroke-dasharray="${["1.5 3", "6 3", "1 5", "8 2 1 2", "3 3", "12 4", "2 6", "5 1.5"][n % 8]}" stroke-linecap="round" opacity=".8"/>`).join("");
    g += `<text x="${F.W - F.R - 4}" y="${s1.top + 11}" text-anchor="end" font-size="9.5" font-weight="700" fill="rgba(200,200,215,.7)">hPa</text>`;
  }
  const r = F.span <= 3.5 * 1440 ? 2.3 : 1.6;
  const wp = patIdx(ids);
  for (const id of ids) g += `<g fill="${wc(id)}" stroke="${wc(id)}" stroke-width="0" opacity=".9">${Gu[id].map(p => dotShape(wp(id), F.x(p.m), y(cvW(p.v)), r + (wp(id) ? .3 : 0))).join("")}</g>`;
  for (const id of ids) g += `<path d="${ovPath(F, Wd[id], y, p => cvW(p.v))}" fill="none" stroke="${wc(id)}" stroke-width="2" stroke-dasharray="${PAT_DASH[wp(id)]}" stroke-linecap="round"/>`;
  g += oW.map(p => `<circle cx="${F.x(p.m).toFixed(1)}" cy="${y(cvW(p.v)).toFixed(1)}" r="2.6" fill="#fff" stroke="#0a0e22" stroke-width="1"/>`).join("") + oG.map(p => `<circle cx="${F.x(p.m).toFixed(1)}" cy="${y(cvW(p.v)).toFixed(1)}" r="3.2" fill="none" stroke="#fff" stroke-width="1.4"/>`).join("");
  g += `<text x="${F.L + 4}" y="${s1.top + 11}" font-size="9.5" font-weight="700" fill="rgba(226,231,255,.6)">${esc(WIND_L[windU()])}</text>`;
  const wu = WIND_L[windU()], dirOf = (id, k) => { const d = D.raw.wind_direction_10m?.[id]?.[k]; return d == null ? "" : `${compass(d)} `; };
  return { key: "wind", title: "Wind & pressure", F, svg: g,
    legend: ids.map(id => `<span class="lg-i"><svg width="26" height="8"><line x1="0" y1="4" x2="18" y2="4" stroke="${wc(id)}" stroke-width="2" stroke-dasharray="${PAT_DASH[wp(id)]}"/><g fill="${wc(id)}" stroke="${wc(id)}" stroke-width="0">${dotShape(wp(id), 23, 4, 2.6)}</g></svg>${esc(META(id).short)}</span>`).join("") + `<span class="lg-sep"></span>` + styleKey([["", "Wind (line)"], ["dot", "Gusts (marker)"], ["1.5 3", "Pressure (greys)"]]) + (oW.length ? leg("dot", "#fff", `Observed ${st2.id}`) : ""),
    col: wc,
    tip: m => [...ids.map(id => { const w = nearest(Wd[id], m); if (!w) return null; const gu = nearest(Gu[id], m), p = nearest(Pr[id], m);
        return [META(id).short, `${dirOf(id, w.k)}${Math.round(cvW(w.v))}${gu ? ` G${Math.round(cvW(gu.v))}` : ""} ${wu}${p ? ` · ${p.v.toFixed(1)} hPa` : ""}`, wc(id)]; }),
        nearest(oW, m) && [`Observed ${st2.id}`, `${Math.round(cvW(nearest(oW, m).v))}${nearest(oG, m) ? ` G${Math.round(cvW(nearest(oG, m).v))}` : ""} ${wu}`, "#fff"]],
    table: m => ({ head: ["Dir", `Wind ${wu}`, "Gust", "hPa"], rows: [...ids.map(id => { const w = nearest(Wd[id], m), gu = nearest(Gu[id], m), p = nearest(Pr[id], m), d = w ? D.raw.wind_direction_10m?.[id]?.[w.k] : null;
        return [id, d != null ? `${compass(d)}<small> ${Math.round(d)}°</small>` : null, w && Math.round(cvW(w.v)), gu && Math.round(cvW(gu.v)), p && p.v.toFixed(1)]; }),
        ...(oW.length ? [["obs", null, nearest(oW, m) && Math.round(cvW(nearest(oW, m).v)), nearest(oG, m) && Math.round(cvW(nearest(oG, m).v)), null]] : [])], hi: 2 }),
    read: m => { const w = ids.map(id => nearest(Wd[id], m)).filter(Boolean).map(p => cvW(p.v)), gs = ids.map(id => nearest(Gu[id], m)).filter(Boolean).map(p => cvW(p.v));
      return `wind <b class="c-w">${span2(w, Math.round)}</b>${gs.length ? ` · gusts <b class="c-g">${span2(gs, Math.round)}</b>` : ""} ${esc(wu)}`; },
    dots: m => ids.map(id => { const w = nearest(Wd[id], m); return w && [w.m, y(cvW(w.v)), wc(id)]; }).filter(Boolean) };
}
function ovStormMulti(W) {
  const D = S.data, ids = ovPick(), C = {}, H = {}, mc = ovColorMap(ids);
  for (const id of ids) { C[id] = ovSer1("cape", id); H[id] = D.raw.srh ? ovSer1("srh", id) : []; }
  const cIds = ids.filter(id => C[id].length), hIds = ids.filter(id => H[id].length);
  if (!cIds.length && !hIds.length) return null;
  const F = ovFrame(W, [{ h: W < 560 ? 120 : 140 }]), s1 = F.subs[0];
  const cm = Math.max(500, ...cIds.flatMap(id => C[id].map(p => p.v))), cst = niceStep(cm, 3), chi = Math.ceil(cm * 1.05 / cst) * cst, y = ovScale(s1, 0, chi);
  let g = F.g + ovAxis(F, s1, 0, chi, cst, "l", v => v >= 1000 ? (v / 1000) + "k" : v);
  for (const [v, c] of [[1000, "rgba(255,209,102,.5)"], [2500, "rgba(255,122,126,.55)"]]) if (v < chi) g += `<line x1="${F.L}" x2="${F.W - F.R}" y1="${y(v)}" y2="${y(v)}" stroke="${c}" stroke-dasharray="3 4"/>`;
  for (const id of cIds) g += `<path d="${ovPath(F, C[id], y)}" fill="none" stroke="${mc(id)}" stroke-width="2"/>`;
  let yh = null;
  if (hIds.length) {
    const hv = hIds.flatMap(id => H[id].map(p => p.v)), hlo = Math.min(0, ...hv), hm = Math.max(150, ...hv), hst = niceStep(hm - hlo, 3), hhi = Math.ceil(hm * 1.05 / hst) * hst, hl = Math.floor(hlo / hst) * hst;
    yh = ovScale(s1, hl, hhi);
    g += ovAxis(F, s1, hl, hhi, hst, "r", v => Math.round(v), "rgba(226,231,255,.7)", false) + hIds.map(id => `<path d="${ovPath(F, H[id], yh)}" fill="none" stroke="${mc(id)}" stroke-width="1.6" stroke-dasharray="6 4"/>`).join("");
  }
  g += `<text x="${F.L + 4}" y="${s1.top + 11}" font-size="9.5" font-weight="700" fill="rgba(255,209,102,.85)">CAPE J/kg</text>${hIds.length ? `<text x="${F.W - F.R - 4}" y="${s1.top + 11}" text-anchor="end" font-size="9.5" font-weight="700" fill="rgba(226,231,255,.7)">SRH m²/s²</text>` : ""}`;
  const srhMsg = S.data.srhState === "loading" ? " · loading helicity…" : "";
  return { key: "storm", title: "CAPE & helicity", F, svg: g, note: srhMsg,
    legend: modelKey(ids, mc) + `<span class="lg-sep"></span>` + styleKey([["", "CAPE"], ["6 4", "Helicity 0–3 km (est.)"]]),
    col: mc,
    tip: m => ids.map(id => { const c = nearest(C[id], m), h = nearest(H[id], m); return (c || h) && [META(id).short, `${c ? `CAPE ${Math.round(c.v)}` : ""}${h ? `${c ? " · " : ""}SRH ${Math.round(h.v)}` : ""}`, mc(id)]; }),
    table: m => ({ head: ["CAPE J/kg", ...(hIds.length ? ["SRH m²/s²"] : [])], rows: ids.map(id => { const c = nearest(C[id], m), h = nearest(H[id], m); return [id, c && Math.round(c.v), ...(hIds.length ? [h && Math.round(h.v)] : [])]; }), hi: 1 }),
    read: m => { const c = cIds.map(id => nearest(C[id], m)).filter(Boolean).map(p => p.v); return `CAPE <b class="c-c">${span2(c, Math.round)}</b> J/kg across ${c.length} models`; },
    dots: m => [...cIds.map(id => { const c = nearest(C[id], m); return c && [c.m, y(c.v), mc(id)]; }), ...(yh ? hIds.map(id => { const h = nearest(H[id], m); return h && [h.m, yh(h.v), mc(id)]; }) : [])].filter(Boolean) };
}

let OVP = [];
function renderOverview() {
  const D = S.data, host = $("overview");
  const ids = visibleFor("temperature_2m"), src = ovSource();
  const W = Math.max(300, Math.round((host.clientWidth || $("view").clientWidth || 360) - 2));
  const opts = `<option value="avg"${src.single || src.multi ? "" : " selected"}>Average of ${ids.length} models</option><option value="multi"${src.multi ? " selected" : ""}>Compare models (${ovPick().length})</option><optgroup label="Single model">` + avail("temperature_2m").map(id => `<option value="${id}"${src.single === id ? " selected" : ""}>${esc(META(id).name)}</option>`).join("") + `</optgroup>`;
  const st = D.obs?.station;
  const head = `<div class="ovbar">
      <label class="ovsel"><span>Source</span><select id="ovSrc">${opts}</select></label>
      <div class="seg" id="ovRange">${OV_RANGES.map(r => `<button data-ovr="${r}" class="${S.ovRange === r ? "on" : ""}">${r}D</button>`).join("")}</div>
      <div class="seg ovzoom" role="group" aria-label="Zoom"><button data-ovz="out" aria-label="Zoom out"><svg viewBox="0 0 24 24"><path d="M6 12h12"/></svg></button><button data-ovz="in" aria-label="Zoom in"><svg viewBox="0 0 24 24"><path d="M6 12h12M12 6v12"/></svg></button>${S.ovZ ? `<button data-ovz="reset">Reset</button>` : ""}</div>
      ${st ? `<button class="chip${S.ovObs ? " on" : ""}" data-ovobs aria-pressed="${!!S.ovObs}"><i class="ld" style="background:#fff"></i>Observed ${esc(st.id)}</button>` : ""}
      ${src.single || src.multi ? "" : `<button class="linkbtn" data-open-models>Change models</button>`}
    </div>${S.ovZ ? ovNavBar() : ""}${src.multi ? ovPicker() : ""}`;
  const W2 = W - 2;
  OVP = (src.multi ? [ovTempMulti(W2), ovPrecipMulti(W2), ovWindMulti(W2), ovStormMulti(W2)] : [ovTempPanel(W2), ovPrecipPanel(W2), ovWindPanel(W2), ovStormPanel(W2)]).filter(Boolean);
  host.innerHTML = head + OVP.map((p, i) => `<section class="card ovpanel" data-ovi="${i}">
      <div class="ovph"><h3>${esc(p.title)}</h3><div class="ovv" data-ovv="${i}"></div></div>
      <div class="ovc"><svg viewBox="0 0 ${p.F.W} ${p.F.H}" width="100%" style="touch-action:pan-y" data-ovs="${i}">${p.svg}<g class="ovxh"></g><rect x="${p.F.L}" y="0" width="${p.F.W - p.F.L - p.F.R}" height="${p.F.H}" fill="transparent"/></svg></div>
      <div class="ovleg">${p.legend}${p.note ? `<span class="lg-n">${esc(p.note)}</span>` : ""}</div></section>`).join("") +
    `<div class="ovfoot">${esc(src.label)} · ${src.multi ? "colour = model, line style = parameter" : src.single ? "single model" : "shaded = range across models"} · ${matchMedia("(pointer: fine)").matches ? "hover" : "drag across"} any chart to read values</div>`;
  ovCursor(S.ovMin ?? Math.max(0, Math.round((nowMin() - ovWin().ws) / 60) * 60));
  const hint = host.querySelector(".ovfoot"); if (hint && !S.ovZ) hint.insertAdjacentHTML("beforeend", ` · ${matchMedia("(pointer: fine)").matches ? "drag across a chart to zoom" : "pinch a chart to zoom"}`);
  // Load helicity when the storm panel scrolls into view
  if (!D.srhState && "IntersectionObserver" in window) {
    const el = host.querySelector('[data-ovi="3"]') || host.lastElementChild;
    const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { io.disconnect(); loadSRH(); } }, { rootMargin: "200px" });
    if (el) io.observe(el);
  }
}
const compass = d => ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"][Math.round(d / 22.5) % 16];
function ovWhen(m) { const D = S.data, abs = ovWin().ws + m, di = Math.min(D.dates.length - 1, Math.floor(abs / 1440)); return `${pad(Math.floor(abs / 60) % 24)}:00 · ${dayLong(D.dates[di])}`; }
// Floating tooltip beside the mouse (computer), like SpotWx
function ovTip(i, m, ev) {
  const p = OVP[i], box = document.querySelector(`[data-ovi="${i}"] .ovc`); if (!p || !box) return;
  let tip = box.querySelector(".ovtip"); if (!tip) { tip = document.createElement("div"); tip.className = "ovtip"; box.appendChild(tip); }
  const rows = (p.tip ? p.tip(m) : []).filter(Boolean);
  if (!rows.length) { tip.hidden = true; return; }
  tip.innerHTML = `<div class="tth">${ovWhen(m)}</div>` + rows.map(([l, v, c, sub]) => `<div class="ttr"><i style="background:${c}"></i><span>${esc(l)}</span><b>${esc(v)}</b></div>${sub ? `<div class="tts">${esc(sub)}</div>` : ""}`).join("");
  tip.hidden = false;
  const r = box.getBoundingClientRect(), tw = tip.offsetWidth, th = tip.offsetHeight;
  let x = ev.clientX - r.left + 16, y = ev.clientY - r.top - th / 2;
  if (x + tw > r.width - 4) x = ev.clientX - r.left - tw - 16;
  y = Math.max(2, Math.min(r.height - th - 2, y));
  tip.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
}
function ovHideTips() { document.querySelectorAll(".ovtip").forEach(t => t.hidden = true); }
function ovNavBar() {
  const { span, ws } = ovWin(), { a, b } = ovView(), D = S.data;
  const lab = m => { const abs = ws + m, di = Math.min(D.dates.length - 1, Math.floor(abs / 1440)); return `${dayShort(D.dates[di])} ${pad(Math.floor(abs / 60) % 24)}:00`; };
  let ticks = ""; for (let d = 1; d * 1440 < span; d++) ticks += `<i style="left:${(d * 1440 / span * 100).toFixed(2)}%"></i>`;
  return `<div class="ovnavw"><div class="ovnav" title="Drag to move the zoomed period">${ticks}<div class="ovthumb" style="left:${(a / span * 100).toFixed(2)}%;width:${((b - a) / span * 100).toFixed(2)}%"></div></div>
    <div class="ovnavl"><span>Zoomed: <b>${lab(a)}</b> – <b>${lab(b)}</b></span><span class="ovnavh">${matchMedia("(pointer: fine)").matches ? "drag a chart to zoom · double-click to reset" : "pinch a chart to zoom · drag the bar to move"}</span></div></div>`;
}
function ovPicker() {
  const all = avail("temperature_2m"), sel = ovPick(), open = S.ovOpen || all.length <= 10, mc = ovColorMap(sel);
  return `<div class="card ovpick"><div class="bh"><b>Models to compare</b><small>${sel.length}/${OV_MAX} · colour = model</small></div><div class="bchips">${
    all.filter(id => open || sel.includes(id)).map(id => { const on = sel.includes(id); return `<button class="mchip${on ? " on" : ""}" data-ovm="${id}" aria-pressed="${on}" style="${on ? `border-color:${mc(id)}` : ""}"><i style="background:${on ? mc(id) : colorOf(id)};opacity:${on ? 1 : .5}"></i>${esc(META(id).short)}</button>`; }).join("")
  }${all.length > 10 ? `<button class="mchip more" data-ovopen>${S.ovOpen ? "Done" : `+ Add models <small>${all.length - sel.length} more</small>`}</button>` : ""}</div></div>`;
}
function ovCursor(m) {
  const { a, b } = ovView(); m = Math.max(a, Math.min(b, m)); S.ovMin = m;
  const D = S.data, ws = ovWin().ws, abs = ws + m, di = Math.min(D.dates.length - 1, Math.floor(abs / 1440));
  const when = `${dayShort(D.dates[di])} ${pad(Math.floor(abs / 60) % 24)}:00`;
  OVP.forEach((p, i) => {
    const svg = document.querySelector(`[data-ovs="${i}"]`); if (!svg) return;
    const F = p.F, x = F.x(m), top = F.subs[0].top, bot = F.subs[F.subs.length - 1].bot;
    svg.querySelector(".ovxh").innerHTML = `<line x1="${x}" x2="${x}" y1="${top}" y2="${bot}" stroke="rgba(255,255,255,.55)"/>` + p.dots(m).map(([mm, yy, c]) => `<circle cx="${F.x(mm)}" cy="${yy}" r="3.6" fill="${c}" stroke="#0a0e22" stroke-width="1.5"/>`).join("");
    const v = document.querySelector(`[data-ovv="${i}"]`); if (!v) return;
    if (p.table) {
      const t = p.table(m), st = S.data.obs?.station;
      // highlight the highest and lowest model in the key column
      const nums = t.rows.filter(r => r[0] !== "obs").map(r => parseFloat(String(r[t.hi] ?? "").replace(/[^0-9.\-]/g, ""))).filter(isFinite);
      let mx = nums.length > 1 ? Math.max(...nums) : null, mn = nums.length > 1 ? Math.min(...nums) : null; if (mx === mn) mx = mn = null;
      v.innerHTML = `<div class="ovtw"><span class="ovw">${when}</span></div><table class="ovt"><thead><tr><th></th>${t.head.map((h, j) => `<th class="${j + 1 === t.hi ? "k" : ""}">${esc(h)}</th>`).join("")}</tr></thead><tbody>${t.rows.map(r => {
        const obs = r[0] === "obs", kv = parseFloat(String(r[t.hi] ?? "").replace(/[^0-9.\-]/g, ""));
        return `<tr class="${obs ? "obs" : ""}"><th><i style="background:${obs ? "#fff" : (p.col || colorOf)(r[0])}"></i>${obs ? `Obs ${esc(st?.id || "")}` : esc(META(r[0]).short)}</th>${r.slice(1).map((c, j) => `<td class="${j + 1 === t.hi ? "k" : ""}${!obs && j + 1 === t.hi && mx != null && kv === mx ? " mx" : ""}${!obs && j + 1 === t.hi && mn != null && kv === mn ? " mn" : ""}">${c == null || c === false ? "–" : c}</td>`).join("")}</tr>`; }).join("")}</tbody></table>`;
    } else v.innerHTML = `<span class="ovw">${when}</span> ${p.read(m)}`;
  });
}
// Computer: just moving the mouse moves the cursor on every chart and shows the tooltip
function ovAtRaw(svg, p, x) { const r = svg.getBoundingClientRect(), sx = (x - r.left) / r.width * p.F.W; return p.F.a + ((sx - p.F.L) / (p.F.W - p.F.L - p.F.R)) * p.F.span; }
function ovAt(svg, p, ev) { return Math.max(p.F.a, Math.min(p.F.b, Math.round(ovAtRaw(svg, p, ev.clientX) / 60) * 60)); }
// ---------- Overview zoom ----------
let ovRaf = 0;
function ovZoomTo(a, b, now) {
  if (!isFinite(a) || !isFinite(b)) return;
  const { span } = ovWin();
  let w = Math.max(180, b - a); if (w >= span * 0.985) { S.ovZ = null; } else {
    a = Math.max(0, Math.min(a, span - w)); S.ovZ = { a: Math.round(a / 60) * 60, b: Math.round((a + w) / 60) * 60 };
  }
  if (now) renderOverview(); else { cancelAnimationFrame(ovRaf); ovRaf = requestAnimationFrame(renderOverview); }
}
function ovZoomBy(f, center) {
  const { a, b } = ovView(), c = center ?? S.ovMin ?? (a + b) / 2, k = (c - a) / (b - a || 1), w = (b - a) * f;
  ovZoomTo(c - k * w, c - k * w + w, true);
}
function ovPan(dm) { const { a, b } = ovView(); ovZoomTo(a + dm, b + dm); }

// Computer: hover reads values; drag across a chart to zoom into that period; double-click resets
let ovDrag = null;
document.addEventListener("pointermove", e => {
  if (e.pointerType !== "mouse") return;
  if (ovDrag) {
    const { svg, p, m0 } = ovDrag, m1 = ovAtRaw(svg, p, e.clientX), F = p.F;
    ovDrag.m1 = m1;
    if (Math.abs(e.clientX - ovDrag.x0) > 6) {
      ovDrag.moved = true; ovHideTips();
      const lo = Math.max(F.a, Math.min(m0, m1)), hi = Math.min(F.b, Math.max(m0, m1));
      OVP.forEach((q, n) => { const sv = document.querySelector(`[data-ovs="${n}"]`); if (!sv) return; const G = q.F, t = G.subs[0].top, bt = G.subs[G.subs.length - 1].bot;
        sv.querySelector(".ovxh").innerHTML = `<rect x="${G.x(lo)}" y="${t}" width="${Math.max(1, G.x(hi) - G.x(lo))}" height="${bt - t}" fill="rgba(124,147,255,.18)" stroke="rgba(124,147,255,.7)"/>`; });
    }
    return;
  }
  const svg = e.target.closest?.("[data-ovs]");
  if (!svg) { if (document.querySelector(".ovtip:not([hidden])")) ovHideTips(); return; }
  const i = +svg.dataset.ovs, p = OVP[i]; if (!p) return;
  const m = ovAt(svg, p, e);
  if (m !== S.ovMin) ovCursor(m);
  document.querySelectorAll(".ovtip").forEach(t => { if (!t.closest(`[data-ovi="${i}"]`)) t.hidden = true; });
  ovTip(i, m, e);
});
document.addEventListener("pointerdown", e => {
  if (e.pointerType !== "mouse" || e.button !== 0) return;
  const svg = e.target.closest?.("[data-ovs]"); if (!svg) return;
  const p = OVP[+svg.dataset.ovs]; if (!p) return;
  e.preventDefault();
  ovDrag = { svg, p, x0: e.clientX, m0: ovAtRaw(svg, p, e.clientX), moved: false };
});
addEventListener("pointerup", e => {
  if (e.pointerType !== "mouse" || !ovDrag) return;
  const d = ovDrag; ovDrag = null;
  if (d.moved && d.m1 != null) { const lo = Math.min(d.m0, d.m1), hi = Math.max(d.m0, d.m1); if (hi - lo >= 60) return ovZoomTo(lo, hi, true); }
  ovCursor(S.ovMin);
});
document.addEventListener("dblclick", e => { if (e.target.closest?.("[data-ovs]")) { S.ovZ = null; renderOverview(); } });
// Trackpad pinch / Ctrl+scroll zooms around the pointer; sideways scroll pans
document.addEventListener("wheel", e => {
  const svg = e.target.closest?.("[data-ovs]"); if (!svg) return;
  const p = OVP[+svg.dataset.ovs]; if (!p) return;
  if (e.ctrlKey || e.metaKey) { e.preventDefault(); ovZoomBy(Math.exp(e.deltaY * 0.01), ovAtRaw(svg, p, e.clientX)); }
  else if (S.ovZ && Math.abs(e.deltaX) > Math.abs(e.deltaY)) { e.preventDefault(); ovPan(e.deltaX / svg.getBoundingClientRect().width * p.F.span); }
}, { passive: false });

// Touch: one finger reads values; two fingers pinch to zoom (and pan while pinching)
const ovTouches = new Map(); let ovPinch = null;
document.addEventListener("pointerdown", e => {
  if (e.pointerType === "mouse") return;
  const svg = e.target.closest?.("[data-ovs]"); if (!svg) return;
  const p = OVP[+svg.dataset.ovs]; if (!p) return;
  ovTouches.set(e.pointerId, { x: e.clientX, idx: +svg.dataset.ovs });
  if (ovTouches.size === 2) {
    const [t1, t2] = [...ovTouches.values()], { a, b } = ovView();
    ovPinch = { d0: Math.abs(t1.x - t2.x) || 1, a, b, mid: ovAtRaw(svg, p, (t1.x + t2.x) / 2), frac: 0 };
    const r = svg.getBoundingClientRect(), sx = ((t1.x + t2.x) / 2 - r.left) / r.width * p.F.W;
    ovPinch.frac = (sx - p.F.L) / (p.F.W - p.F.L - p.F.R);
    return;
  }
  if (ovTouches.size === 1) ovCursor(ovAt(svg, p, e));
});
document.addEventListener("pointermove", e => {
  if (e.pointerType === "mouse" || !ovTouches.has(e.pointerId)) return;
  const t = ovTouches.get(e.pointerId); t.x = e.clientX;
  // the charts are redrawn while zooming, so always measure the current one
  const svg = document.querySelector(`[data-ovs="${t.idx}"]`), p = OVP[t.idx]; if (!svg || !p) return;
  const r = svg.getBoundingClientRect(); if (!r.width) return;
  if (ovPinch && ovTouches.size >= 2) {
    const [t1, t2] = [...ovTouches.values()], d = Math.abs(t1.x - t2.x) || 1, w = (ovPinch.b - ovPinch.a) * ovPinch.d0 / d;
    const sx = ((t1.x + t2.x) / 2 - r.left) / r.width * p.F.W, frac = (sx - p.F.L) / (p.F.W - p.F.L - p.F.R);
    if (isFinite(w) && isFinite(frac)) ovZoomTo(ovPinch.mid - frac * w, ovPinch.mid - frac * w + w);
  } else if (!ovPinch) ovCursor(ovAt(svg, p, e));
});
const ovTouchEnd = e => { if (!ovTouches.delete(e.pointerId)) return; if (ovTouches.size < 2) ovPinch = null; };
addEventListener("pointerup", ovTouchEnd); addEventListener("pointercancel", ovTouchEnd);

// Zoom bar under the controls: drag the highlighted part to pan
document.addEventListener("pointerdown", e => {
  const nav = e.target.closest?.(".ovnav"); if (!nav) return;
  e.preventDefault();
  const r = nav.getBoundingClientRect(), { span } = ovWin(), { a, b } = ovView(), w = b - a;
  const toM = x => (x - r.left) / r.width * span;
  const onThumb = e.target.closest(".ovthumb"), off = onThumb ? toM(e.clientX) - a : w / 2;
  if (!onThumb) ovZoomTo(toM(e.clientX) - off, toM(e.clientX) - off + w, true);
  const mv = ev => ovZoomTo(toM(ev.clientX) - off, toM(ev.clientX) - off + w);
  const up = () => { removeEventListener("pointermove", mv); removeEventListener("pointerup", up); removeEventListener("pointercancel", up); };
  addEventListener("pointermove", mv); addEventListener("pointerup", up); addEventListener("pointercancel", up);
});

// ---------- Custom overlay tab ----------
// Colour = parameter, line pattern = model.
const CP = {
  temp:   { label: "Temperature", v: "temperature_2m", g: "temp", color: "#ff6b6b" },
  feels:  { label: "Feels like", v: "apparent_temperature", g: "temp", color: "#ff9f43" },
  dew:    { label: "Dew point", v: "dew_point_2m", g: "temp", color: "#2ec4d6" },
  cloud:  { label: "Cloud cover", v: "cloud_cover", g: "pct", color: "#b4b9c6" },
  precip: { label: "Precip (hourly)", v: "precipitation", g: "precip", color: "#4cc9f0" },
  wind:   { label: "Wind", v: "wind_speed_10m", g: "wind", color: "#3ee6a0" },
  gust:   { label: "Gusts", v: "wind_gusts_10m", g: "wind", color: "#b8f59a", dots: true },
  cape:   { label: "CAPE", v: "cape", g: "cape", color: "#ffd166" },
  srh:    { label: "Helicity (est.)", v: "srh", g: "srh", color: "#f72585" },
};
const CGROUP = { temp: "temp", pct: "cloud", precip: "precip", wind: "wind", cape: "cape", srh: "srh" };   // group → PARAMS key for units/format
const DASHES = ["", "7 4", "2 3.5", "11 3 2 3", "1 5", "16 5"];
const DASH_NAME = ["solid", "dashed", "dotted", "dash-dot", "sparse dots", "long dash"];
const MAX_CP = 5, MAX_CM = 6;
const OBS_FIELD = { temp: "c", dew: "d", feels: "f", wind: "w", gust: "g", cloud: "cl", precip: "pr" };
const obsOn = () => S.cobs && S.data?.obs?.pts.length;
function obsSeriesFor(p) {
  const f = OBS_FIELD[p], D = S.data; if (!f || !obsOn()) return [];
  const ws = S.start * 1440, c = cConv(CP[p].g);
  return D.obs.pts.filter(q => q.m >= ws && q.m <= ws + S.range * 1440 && q[f] != null).map(q => ({ m: q.m - ws, v: c(q[f]) }));
}
const cpk = g => CGROUP[g];
const cConv = g => conv(cpk(g), g === "precip" ? "hr" : undefined);
const cFmt = (g, v) => fv(cpk(g), v, g === "precip" ? "hr" : undefined);
const cUnit = g => unitOf(cpk(g), g === "precip" ? "hr" : undefined);
function cModels() { const ok = new Set(avail("temperature_2m")); return S.cmodels.filter(id => ok.has(id)).slice(0, MAX_CM); }
const dashOf = id => DASHES[Math.max(0, cModels().indexOf(id)) % DASHES.length];
const dashSample = (dash, color = "#fff", w = 26) => `<svg class="dsm" viewBox="0 0 ${w} 8" width="${w}" height="8"><line x1="1" y1="4" x2="${w - 1}" y2="4" stroke="${color}" stroke-width="2.2" stroke-dasharray="${dash}" stroke-linecap="${dash.startsWith("1 ") || dash.startsWith("2 ") ? "round" : "butt"}"/></svg>`;

function customSeries() {
  const D = S.data, ws = S.start * 1440, we = ws + S.range * 1440, ids = cModels(), out = [];
  for (const p of S.cparams) {
    const P = CP[p]; if (!P) continue;
    const c = cConv(P.g), per = [];
    for (const id of ids) {
      const a = D.raw[P.v]?.[id]; if (!a) continue;
      const pa = OBS_VARS[P.v] && S.lead > 0 ? D.raw[`${P.v}@${S.lead}`]?.[id] : null, t0 = todayIdx() * 1440;
      const pts = [];
      for (let k = 0; k < a.length; k++) { const m = D.mins[k]; const x = pa && m < t0 && pa[k] != null ? pa[k] : a[k]; if (m >= ws && m <= we && x != null) pts.push({ m: m - ws, v: c(x), k }); }
      if (pts.length) per.push({ key: `${p}|${id}`, p, id, pts });
    }
    if (!per.length) continue;
    if (S.cavg) {
      const byM = new Map();
      for (const s of per) for (const q of s.pts) { const a = byM.get(q.m); a ? a.push(q.v) : byM.set(q.m, [q.v]); }
      const pts = [...byM.keys()].sort((a, b) => a - b).map(m => { const a = byM.get(m); return { m, v: mean(a), lo: Math.min(...a), hi: Math.max(...a), n: a.length }; });
      out.push({ key: `${p}|avg`, p, id: "avg", pts, n: per.length });
    } else out.push(...per);
  }
  return out;
}
function niceRange(g, vals, H) {
  let lo = Math.min(...vals), hi = Math.max(...vals), step;
  if (g === "temp") { lo = Math.floor(lo - 1); hi = Math.ceil(hi + 1); const r = hi - lo; step = r > 45 ? 10 : r > 22 ? 5 : r > 9 ? 2 : r > 4 ? 1 : 0.5; }
  else if (g === "pct") { lo = 0; hi = 100; step = H < 160 ? 50 : 25; }
  else {
    const minTop = { precip: precipU() === "in" ? 0.1 : 2, wind: 20, cape: 500, srh: 100 }[g] || 1;
    lo = Math.min(0, lo); hi = Math.max(hi * 1.08, minTop);
    step = niceStep(hi - lo, H < 160 ? 3 : 4); hi = Math.ceil(hi / step) * step; lo = Math.floor(lo / step) * step;
  }
  return { lo, hi, step };
}
function customSVG(W, H) {
  const D = S.data, series = customSeries(), span = S.range * 1440, multi = S.range > 1;
  if (!series.length) return { svg: "", G: null };
  const obsS = {}; for (const p of S.cparams) { const o = obsSeriesFor(p); if (o.length && series.some(s => s.p === p)) obsS[p] = o; }
  const groups = [...new Set(series.map(s => CP[s.p].g))];
  const panels = []; for (let i = 0; i < groups.length; i += 2) panels.push(groups.slice(i, i + 2));
  const hasRight = panels.some(p => p.length > 1);
  const L = 44, R = hasRight ? 46 : 12, T = 18, B = 26, gap = 22;
  const ph = (H - T - B - gap * (panels.length - 1)) / panels.length;
  const x = m => L + (m / span) * (W - L - R);
  const scale = {};                                    // group → {y, lo, hi, step, top, bot}
  panels.forEach((pg, pi) => {
    const top = T + pi * (ph + gap), bot = top + ph;
    for (const g of pg) {
      const vals = series.filter(s => CP[s.p].g === g).flatMap(s => s.pts.flatMap(q => q.hi != null ? [q.lo, q.hi] : [q.v]));
      for (const [p, o] of Object.entries(obsS)) if (CP[p].g === g) for (const q of o) vals.push(q.v);
      const r = niceRange(g, vals, ph);
      scale[g] = { ...r, top, bot, y: v => top + (1 - (v - r.lo) / (r.hi - r.lo)) * (bot - top) };
    }
  });
  const dec = st => st < 0.1 ? 2 : st < 1 ? 1 : 0;
  const suffix = g => g === "temp" ? "°" : g === "pct" ? "%" : "";
  let grid = "", frame = "";
  panels.forEach((pg, pi) => {
    const [gl, gr] = pg, sl = scale[gl];
    for (let v = Math.ceil(sl.lo / sl.step) * sl.step; v <= sl.hi + 1e-9; v += sl.step)
      grid += `<line x1="${L}" x2="${W - R}" y1="${sl.y(v)}" y2="${sl.y(v)}" stroke="rgba(255,255,255,.07)"/><text x="${L - 7}" y="${sl.y(v) + 4}" text-anchor="end" font-size="10.5" fill="rgba(226,231,255,.55)">${v.toFixed(dec(sl.step))}${suffix(gl)}</text>`;
    grid += `<text x="${L - 7}" y="${sl.top - 6}" text-anchor="end" font-size="10" font-weight="700" fill="rgba(226,231,255,.55)">${esc(cUnit(gl))}</text>`;
    if (gr) {
      const sr = scale[gr];
      for (let v = Math.ceil(sr.lo / sr.step) * sr.step; v <= sr.hi + 1e-9; v += sr.step)
        grid += `<text x="${W - R + 7}" y="${sr.y(v) + 4}" font-size="10.5" fill="rgba(226,231,255,.55)">${v.toFixed(dec(sr.step))}${suffix(gr)}</text>`;
      grid += `<text x="${W - R + 7}" y="${sr.top - 6}" font-size="10" font-weight="700" fill="rgba(226,231,255,.55)">${esc(cUnit(gr))}</text>`;
    }
    frame += `<rect x="${L}" y="${sl.top}" width="${W - L - R}" height="${sl.bot - sl.top}" fill="none" stroke="rgba(255,255,255,.06)"/>`;
  });
  const pTop = T, pBot = H - B;
  let xl = "";
  const lab = (m, t, bold) => `<text x="${x(m)}" y="${H - 8}" text-anchor="middle" font-size="11" font-weight="${bold ? 700 : 500}" fill="${bold ? "#fff" : "rgba(226,231,255,.5)"}">${t}</text>`;
  const vl = (m, a) => panels.map((_, pi) => { const t = T + pi * (ph + gap); return `<line x1="${x(m)}" x2="${x(m)}" y1="${t}" y2="${t + ph}" stroke="rgba(255,255,255,${a})"/>`; }).join("");
  if (!multi) { const every = W < 520 ? 6 : 3; for (let h = 0; h <= 24; h += every) xl += vl(h * 60, ".04") + lab(h * 60, h % 24 === 0 ? "12a" : h === 12 ? "12p" : h < 12 ? `${h}a` : `${h - 12}p`); }
  else {
    const ti = todayIdx() - S.start, perDay = (W - L - R) / S.range;
    for (let i = 0; i < S.range; i++) { if (i) xl += vl(i * 1440, ".14"); const d = D.dates[S.start + i]; if (d) xl += lab(i * 1440 + 720, perDay > 52 ? dayShort(d) : perDay > 22 ? String(dObj(d).getUTCDate()) : (i % 2 ? "" : String(dObj(d).getUTCDate())), i === ti); }
  }
  const nm = nowMin() - S.start * 1440;
  const nowSvg = nm > 0 && nm < span ? panels.map((_, pi) => { const t = T + pi * (ph + gap); return `<rect x="${L}" y="${t}" width="${Math.max(0, x(nm) - L)}" height="${ph}" fill="rgba(255,255,255,.035)"/><line x1="${x(nm)}" x2="${x(nm)}" y1="${t}" y2="${t + ph}" stroke="rgba(255,255,255,.45)" stroke-dasharray="2 3"/>`; }).join("") + `<text x="${x(nm) + 4}" y="${T + 10}" font-size="10.5" fill="rgba(255,255,255,.8)">now</text>` : "";
  const path = (pts, y, f = q => q.v) => { let d = "", prev = null; for (const q of pts) { d += `${!prev || q.m - prev.m > 90 ? "M" : "L"}${x(q.m).toFixed(1)},${y(f(q)).toFixed(1)}`; prev = q; } return d; };
  let bands = "", lines = "";
  const dotR = S.range <= 1 ? 2.6 : S.range <= 3 ? 2 : S.range <= 7 ? 1.5 : 1.1;
  for (const s of series) {
    const P = CP[s.p], sc = scale[P.g], col = P.color;
    if (s.id === "avg" && s.n > 1) bands += `<path d="M${s.pts.map(q => `${x(q.m).toFixed(1)},${sc.y(q.hi).toFixed(1)}`).join("L")}L${s.pts.slice().reverse().map(q => `${x(q.m).toFixed(1)},${sc.y(q.lo).toFixed(1)}`).join("L")}Z" fill="${col}" opacity=".13"/>`;
    if (P.dots) {
      const shape = s.id === "avg" ? 0 : cModels().indexOf(s.id);
      lines += `<g data-line="${s.key}" fill="${col}" stroke="${col}" stroke-width="0" opacity=".95">${s.pts.map(q => dotShape(shape, x(q.m), sc.y(q.v), dotR + (shape > 0 ? .4 : 0))).join("")}</g>`;
    } else lines += `<path data-line="${s.key}" d="${path(s.pts, sc.y)}" fill="none" stroke="${col}" stroke-width="1.9" stroke-dasharray="${s.id === "avg" ? "" : dashOf(s.id)}" stroke-linejoin="round" opacity=".95"/>`;
  }
  // Observed: thick line in the parameter's colour with white report markers (gusts: white-ringed dots)
  let obsSvg = "";
  for (const [p, o] of Object.entries(obsS)) {
    const P = CP[p], sc = scale[P.g], few = o.length < 170;
    if (P.dots) obsSvg += `<g data-line="${p}|obs">${o.map(q => `<circle cx="${x(q.m).toFixed(1)}" cy="${sc.y(q.v).toFixed(1)}" r="${dotR + 1.6}" fill="${P.color}" stroke="#fff" stroke-width="1.4"/>`).join("")}</g>`;
    else obsSvg += `<g data-line="${p}|obs"><path d="${path(o, sc.y)}" fill="none" stroke="#0a0e22" stroke-width="5.6" stroke-linejoin="round" opacity=".7"/><path d="${path(o, sc.y)}" fill="none" stroke="${P.color}" stroke-width="3.4" stroke-linejoin="round"/>${few ? o.map(q => `<circle cx="${x(q.m).toFixed(1)}" cy="${sc.y(q.v).toFixed(1)}" r="2.1" fill="#fff"/>`).join("") : ""}</g>`;
  }
  const G = { W, H, L, R, T: pTop, pb: pBot, x, span, multi, custom: true, series, scale, obsS };
  const svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Custom overlay" style="touch-action:none">
    ${grid}${frame}${xl}${nowSvg}${bands}${lines}${obsSvg}<g class="xh"></g>
    <rect class="hit" x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}" fill="transparent"/></svg>`;
  return { svg, G };
}
// Gust dots: a different marker per model (circle, square, triangle, diamond, ring, cross)
function dotShape(i, cx, cy, r) {
  cx = +cx.toFixed(1); cy = +cy.toFixed(1);
  switch (i % 6) {
    case 1: return `<rect x="${cx - r}" y="${cy - r}" width="${2 * r}" height="${2 * r}"/>`;
    case 2: return `<path d="M${cx},${cy - r * 1.25}L${cx + r * 1.15},${cy + r * .9}L${cx - r * 1.15},${cy + r * .9}Z"/>`;
    case 3: return `<path d="M${cx},${cy - r * 1.3}L${cx + r * 1.3},${cy}L${cx},${cy + r * 1.3}L${cx - r * 1.3},${cy}Z"/>`;
    case 4: return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke-width="1.3"/>`;
    case 5: return `<path d="M${cx - r},${cy - r}L${cx + r},${cy + r}M${cx + r},${cy - r}L${cx - r},${cy + r}" fill="none" stroke-width="1.5"/>`;
    default: return `<circle cx="${cx}" cy="${cy}" r="${r}"/>`;
  }
}
function obsSample(P, color = P.color) {
  return P.dots ? `<svg class="dsm" viewBox="0 0 26 10" width="26" height="10"><circle cx="13" cy="5" r="3.6" fill="${color}" stroke="#fff" stroke-width="1.4"/></svg>`
    : `<svg class="dsm" viewBox="0 0 26 10" width="26" height="10"><line x1="1" y1="5" x2="25" y2="5" stroke="${color}" stroke-width="3.4"/><circle cx="7" cy="5" r="2" fill="#fff"/><circle cx="19" cy="5" r="2" fill="#fff"/></svg>`;
}
const DOT_NAME = ["circle", "square", "triangle", "diamond", "ring", "cross"];
function dotSample(i, color) { return `<svg class="dsm" viewBox="0 0 14 10" width="14" height="10"><g fill="${color}" stroke="${color}" stroke-width="0">${dotShape(i, 7, 5, 3)}</g></svg>`; }

function customReadout(G, minute) {
  const D = S.data, ids = cModels();
  const at = s => s.pts.find(q => q.m === minute);
  let html = `<div class="rhead"><b>${hhmm(minute, G.multi)}</b><small>${S.cavg ? `average of ${ids.length} models` : `${ids.length} model${ids.length > 1 ? "s" : ""}`}</small></div>`;
  for (const p of S.cparams) {
    const P = CP[p], ss = G.series.filter(s => s.p === p); if (!ss.length) continue;
    html += `<div class="cgrp"><div class="cgh"><i style="background:${P.color}"></i><b>${esc(P.label)}</b><small>${esc(cUnit(P.g))}</small></div>`;
    const ob = G.obsS?.[p];
    if (ob) {
      let best = null; for (const q of ob) if (Math.abs(q.m - minute) <= 35 && (!best || Math.abs(q.m - minute) < Math.abs(best.m - minute))) best = q;
      html += `<div class="crow cobs">${obsSample(P)}<span>Observed <small>${esc(D.obs.station.id)}</small></span><b>${best ? cFmt(P.g, best.v) : "–"}</b></div>`;
    }
    if (S.cavg) {
      const q = at(ss[0]);
      html += `<div class="crow"><span>Average${q && q.n > 1 ? ` <small>range ${cFmt(P.g, q.lo)}–${cFmt(P.g, q.hi)}</small>` : ""}</span><b>${q ? cFmt(P.g, q.v) : "–"}</b></div>`;
    } else for (const s of ss) {
      const q = at(s), mi = ids.indexOf(s.id);
      html += `<button class="crow rrow${S.sel === s.id ? " sel" : S.sel ? " dim" : ""}" data-id="${s.id}">${P.dots ? dotSample(mi, P.color) : dashSample(dashOf(s.id), P.color)}<span>${esc(META(s.id).short)}</span><b>${q ? cFmt(P.g, q.v) : "–"}</b></button>`;
    }
    html += `</div>`;
  }
  if (S.cparams.includes("srh")) html += `<div class="srhnote">${srhNote()}</div>`;
  return html;
}
function customCrosshair(scope, G, minute) {
  let dots = "";
  for (const s of G.series) {
    if (S.sel && s.id !== S.sel && s.id !== "avg") continue;
    const q = s.pts.find(q => q.m === minute); if (!q) continue;
    dots += `<circle cx="${G.x(q.m)}" cy="${G.scale[CP[s.p].g].y(q.v)}" r="3.4" fill="${CP[s.p].color}" stroke="#0a0e22" stroke-width="1.5"/>`;
  }
  for (const [p, o] of Object.entries(G.obsS || {})) {
    let best = null; for (const q of o) if (Math.abs(q.m - minute) <= 35 && (!best || Math.abs(q.m - minute) < Math.abs(best.m - minute))) best = q;
    if (best) dots += `<circle cx="${G.x(best.m)}" cy="${G.scale[CP[p].g].y(best.v)}" r="4.4" fill="#fff" stroke="${CP[p].color}" stroke-width="2"/>`;
  }
  const xh = scope.querySelector(".xh");
  if (xh) xh.innerHTML = `<line x1="${G.x(minute)}" x2="${G.x(minute)}" y1="${G.T}" y2="${G.pb}" stroke="rgba(255,255,255,.55)"/>${dots}`;
  const ro = scope.querySelector(".readout"); if (ro) ro.innerHTML = customReadout(G, minute);
}
function customSummary() {
  const series = customSeries(); if (!series.length) return "";
  const parts = [];
  for (const p of S.cparams) {
    const P = CP[p], ss = series.filter(s => s.p === p); if (!ss.length) continue;
    // average across models, hour by hour
    const byM = new Map(); for (const s of ss) for (const q of s.pts) { const a = byM.get(q.m); a ? a.push(q.v) : byM.set(q.m, [q.v]); }
    const av = [...byM.values()].map(mean);
    const txt = P.g === "temp" ? `${fmt(Math.min(...av))}–${fmt(Math.max(...av))}°` : P.g === "pct" ? `avg ${Math.round(mean(av))}%` : P.g === "precip" ? `${cFmt("precip", av.reduce((a, b) => a + b, 0))} ${cUnit("precip")}` : `peak ${cFmt(P.g, Math.max(...av))}`;
    parts.push(`<span class="csum"><i style="background:${P.color}"></i>${esc(P.label)} <b>${txt}</b></span>`);
  }
  return parts.join(" ");
}
function renderBuilder() {
  const ids = avail("temperature_2m"), sel = cModels();
  const pChips = Object.entries(CP).map(([k, P]) => {
    const on = S.cparams.includes(k);
    return `<button class="cchip${on ? " on" : ""}" data-cp="${k}" style="--c:${P.color}" aria-pressed="${on}">${P.dots ? `<span class="cdots"></span>` : `<span class="cline"></span>`}${esc(P.label)}</button>`;
  }).join("");
  const showAll = S.cmOpen || ids.length <= 10;
  const mChips = ids.filter(id => showAll || sel.includes(id)).map(id => {
    const i = sel.indexOf(id), on = i >= 0;
    return `<button class="mchip${on ? " on" : ""}" data-cm="${id}" aria-pressed="${on}">${on ? dashSample(DASHES[i], "#fff", 22) : `<i style="background:${colorOf(id)}"></i>`}${esc(META(id).short)}</button>`;
  }).join("");
  const st = S.data.obs?.station, hasObs = !!(st && S.data.obs.pts.length);
  const noObsFor = S.cparams.filter(p => !OBS_FIELD[p]).map(p => CP[p].label);
  const obsChip = hasObs ? `<button class="mchip obschip${S.cobs ? " on" : ""}" data-cobs aria-pressed="${!!S.cobs}">${obsSample({ dots: false }, "#9fb0ff")}Observed <small>${esc(st.id)}</small></button>`
    : S.data.verified ? `<span class="mchip off">No airport observations nearby</span>` : `<span class="mchip off">Loading observations…</span>`;
  const obsKey = hasObs && S.cobs ? `<span class="ki">${obsSample({ dots: false }, "#fff")}${obsSample({ dots: true }, "#888")}<b>Observed ${esc(st.id)}</b>${noObsFor.length ? `<small>(not measured: ${esc(noObsFor.join(", "))})</small>` : ""}</span>` : "";
  const key = S.cavg ? `<span class="kn">Solid line = average of the selected models · shaded = their range</span>`
    : sel.map((id, i) => `<span class="ki">${dashSample(DASHES[i], "#fff", 28)}${dotSample(i, "#fff")}<b>${esc(META(id).short)}</b></span>`).join("");
  $("builder").innerHTML = `
    <div class="bsec"><div class="bh"><b>Parameters</b><small>${S.cparams.length}/${MAX_CP} · colour = parameter</small></div><div class="bchips">${pChips}</div></div>
    <div class="bsec"><div class="bh"><b>Models</b><small>${sel.length}/${MAX_CM} · line pattern = model</small>
      <div class="seg sm2"><button data-cavg="0" class="${S.cavg ? "" : "on"}">Each model</button><button data-cavg="1" class="${S.cavg ? "on" : ""}">Average</button></div></div>
      <div class="bchips">${mChips}${ids.length > 10 ? `<button class="mchip more" data-cmopen>${S.cmOpen ? "Done" : `+ Add models <small>${ids.length - sel.length} more</small>`}</button>` : ""}</div></div>
    <div class="bsec"><div class="bh"><b>Actual data</b><small>airport reports (METAR), past ~4 days</small></div><div class="bchips">${obsChip}</div></div>
    <div class="bkey">${key}${obsKey}</div>`;
}
function flash(msg) {
  let el = document.querySelector(".toast"); if (!el) { el = document.createElement("div"); el.className = "toast"; document.body.appendChild(el); }
  el.textContent = msg; el.classList.add("on"); clearTimeout(flash.t); flash.t = setTimeout(() => el.classList.remove("on"), 2200);
}

// ---------- Render ----------
function chartDims(el) {
  const W = Math.max(300, Math.round(el.clientWidth || 340));
  if (S.tab === "custom") {
    const np = Math.max(1, Math.ceil(new Set(S.cparams.map(p => CP[p]?.g)).size / 2));
    const base = W < 600 ? Math.max(250, W * 0.72) : Math.min(500, Math.max(300, W * 0.48));
    return { W, H: Math.round(np === 1 ? base : base * (0.62 + 0.38 * np)) };
  }
  const H = W < 600 ? Math.round(Math.max(250, W * 0.72)) : Math.round(Math.min(500, Math.max(300, W * 0.48)));
  return { W, H };
}
function renderMain() {
  if (S.tab === "overview") return;
  const scope = $("view"), host = $("chart");
  const { W, H } = chartDims(host);
  const { svg, G } = chartSVG(W, H);
  host.innerHTML = svg || `<div class="status">${S.tab === "srh" ? srhNote() : "None of the switched-on models have this data here."}</div>`;
  scope._G = G;
  $("ctitle").innerHTML = chartTitle();
  $("gsum").innerHTML = summaryHTML();
  if (S.min == null || S.min > S.range * 1440) S.min = defaultMinute();
  drawCrosshair(scope, S.min);
  applyHighlight(scope);
  const fs = document.querySelector(".fsbox"); if (fs) renderFS(fs);
}
function renderAll() {
  if (!S.data) return;
  const ov = S.tab === "overview";
  document.body.dataset.tab = S.tab;
  $("overview").hidden = !ov; $("paramView").hidden = ov;
  renderHeader(); renderTabs(); renderToolbar();
  if (ov) renderOverview();
  else {
    if ((S.tab === "srh" || S.tab === "custom" && S.cparams.includes("srh")) && !S.data.srhState) loadSRH();
    if (S.tab === "custom") renderBuilder();
    renderDays(); renderMain(); if (S.tab !== "custom") renderTable();
  }
  if (!$("modelsModal").hidden) renderModelsSheet();
}
function renderHeader() {
  const D = S.data, L = S.loc;
  $("locName").textContent = L.name;
  const ns = D.lat >= 0 ? "N" : "S", ew = D.lon >= 0 ? "E" : "W";
  const where = [L.admin1, L.country].filter(Boolean).join(", ") || "Custom coordinates";
  $("locMeta").textContent = `${where} · ${Math.abs(D.lat).toFixed(2)}°${ns}, ${Math.abs(D.lon).toFixed(2)}°${ew} · ${Math.round(D.elev ?? 0)} m`;
  tickClock();
}
function tickClock() {
  if (!S.data) return;
  const t = new Date(Date.now() + S.data.offset * 1000);
  $("clock").innerHTML = `<b>${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}</b>${esc(S.data.tzAbbr || S.data.tz || "")} local`;
}
function setTab(t) {
  if (!TABS.includes(t)) t = "overview";
  if (S.tab === t && S.data) return renderAll();
  S.tab = t; S.min = null;
  if (S.data && PARAMS[t]?.lazy && S.start > todayIdx() + 6) S.start = todayIdx();
  if (S.data && t !== "overview") S.start = Math.max(0, Math.min(S.data.dates.length - S.range, S.start));
  renderAll();
  if (t !== "overview") window.scrollTo({ top: Math.min(window.scrollY, $("tabs").offsetTop - 70), behavior: "smooth" });
}
addEventListener("hashchange", () => { const h = location.hash.slice(1); if (TABS.includes(h)) setTab(h); });

// ---------- Full-screen chart (drawn sideways on a portrait phone) ----------
function fsSize() {
  const vw = innerWidth, vh = innerHeight, rot = vh > vw && vw < 760;
  const long = rot ? vh : vw, short = rot ? vw : vh;
  const panel = Math.min(280, Math.round(long * 0.32));
  return { rot, long, short, W: Math.max(320, long - panel - 60), H: Math.max(200, short - 80) };
}
function renderFS(box) {
  const fs = box.closest(".fs"), z = fsSize();
  fs.classList.toggle("rot", z.rot);
  box.style.width = z.long + "px"; box.style.height = z.short + "px";
  const { svg, G } = chartSVG(z.W, z.H);
  box._G = G;
  box.innerHTML = `<button class="fsx" aria-label="Close">✕</button>
    <div class="fsl"><div class="fsc"><div class="gsum"><b>${esc(S.loc.name)} · ${esc(PARAMS[paramKey()].label)}</b> · ${chartTitle().replace(/<span class="tag[^>]*>.*?<\/span>/g, "")} · ${summaryHTML()}</div><div class="chart">${svg}</div></div>
    <div class="fsp"><div class="readout"></div></div></div>`;
  drawCrosshair(box, S.min ?? defaultMinute());
  applyHighlight(box);
}
function openFS() {
  const fs = document.createElement("div");
  fs.className = "fs"; fs.innerHTML = `<div class="fsbox"></div>`;
  document.body.appendChild(fs); document.body.classList.add("fs-open");
  renderFS(fs.firstChild);
}
function closeFS() { document.querySelector(".fs")?.remove(); if (!document.querySelector(".modal:not([hidden])")) document.body.classList.remove("fs-open"); }

// ---------- Interaction ----------
function scopeOf(el) { return el.closest(".fsbox") || $("view"); }
function pointerToMinute(svg, G, cx, cy) {
  const rect = svg.getBoundingClientRect(), rotated = !!svg.closest(".fs.rot");
  const sx = rotated ? (cy - rect.top) / rect.height * G.W : (cx - rect.left) / rect.width * G.W;
  const frac = Math.min(1, Math.max(0, (sx - G.L) / (G.W - G.L - G.R)));
  const hrs = G.span / 60;
  return Math.min(hrs, Math.round(frac * hrs)) * 60;
}
document.addEventListener("pointermove", e => {
  if (e.pointerType !== "mouse" || e.buttons) return;
  const svg = e.target.closest?.(".chart svg"); if (!svg) return;
  const scope = scopeOf(svg), G = scope._G; if (!G) return;
  const m = pointerToMinute(svg, G, e.clientX, e.clientY);
  if (m !== S.min) for (const sc of scopes()) drawCrosshair(sc, m);
});
document.addEventListener("pointerdown", e => {
  const svg = e.target.closest?.(".chart svg"); if (!svg) return;
  const scope = scopeOf(svg), G = scope._G; if (!G) return;
  const move = ev => { const m = pointerToMinute(svg, G, ev.clientX, ev.clientY); if (m !== S.min || ev === e) for (const sc of scopes()) drawCrosshair(sc, m); };
  move(e);
  try { svg.setPointerCapture(e.pointerId); } catch {}
  const up = () => { svg.removeEventListener("pointermove", move); svg.removeEventListener("pointerup", up); svg.removeEventListener("pointercancel", up); };
  svg.addEventListener("pointermove", move); svg.addEventListener("pointerup", up); svg.addEventListener("pointercancel", up);
});
document.addEventListener("click", e => {
  const t = e.target;
  if (t.closest(".gexp")) return openFS();
  if (t.closest(".fsx")) return closeFS();
  const rr = t.closest(".rrow"); if (rr) return selectModel(rr.dataset.id);
  if (t.closest("[data-open-models]")) { renderModelsSheet(); return openModal("modelsModal"); }
  const go = t.closest("[data-goto]");
  if (go) { S.rsel = 1; S.range = 1; LS.set("range", 1); S.start = +go.dataset.goto; location.hash = "temp"; return setTab("temp"); }
  const day = t.closest(".day, .dt thead th[data-i]"); if (day) return setStart(+day.dataset.i);
  const ol = t.closest("[data-ol]"); if (ol) { S.outlook = +ol.dataset.ol; LS.set("outlook", S.outlook); return renderOverview(); }
  const ovm = t.closest("[data-ovm]");
  if (ovm) { const id = ovm.dataset.ovm, cur = ovPick(); if (cur.includes(id)) { if (cur.length > 1) S.ovModels = cur.filter(x => x !== id); } else if (cur.length < OV_MAX) S.ovModels = [...cur, id]; else return flash(`Up to ${OV_MAX} models at once`); LS.set("ovModels", S.ovModels); return renderOverview(); }
  if (t.closest("[data-ovopen]")) { S.ovOpen = !S.ovOpen; return renderOverview(); }
  const ovz = t.closest("[data-ovz]");
  if (ovz) { const k = ovz.dataset.ovz; if (k === "reset") { S.ovZ = null; return renderOverview(); } return ovZoomBy(k === "in" ? 0.5 : 2); }
  const ovr = t.closest("[data-ovr]"); if (ovr) { S.ovZ = null; S.ovRange = +ovr.dataset.ovr; LS.set("ovRange", S.ovRange); S.ovMin = null; return renderOverview(); }
  if (t.closest("[data-ovobs]")) { S.ovObs = !S.ovObs; LS.set("ovObs", S.ovObs); return renderOverview(); }
  const cpb = t.closest("[data-cp]");
  if (cpb) { const k = cpb.dataset.cp, a = S.cparams; if (a.includes(k)) { if (a.length > 1) a.splice(a.indexOf(k), 1); } else if (a.length < MAX_CP) a.push(k); else return flash(`Up to ${MAX_CP} parameters`); LS.set("cparams", a); return renderAll(); }
  const cmb = t.closest("[data-cm]");
  if (cmb) { const id = cmb.dataset.cm, cur = cModels(); if (cur.includes(id)) { if (cur.length > 1) S.cmodels = cur.filter(x => x !== id); } else if (cur.length < MAX_CM) S.cmodels = [...cur, id]; else return flash(`Up to ${MAX_CM} models, so each gets its own line pattern`); if (S.sel && !S.cmodels.includes(S.sel)) S.sel = ""; LS.set("cmodels", S.cmodels); return renderAll(); }
  if (t.closest("[data-cobs]")) { S.cobs = !S.cobs; LS.set("cobs", S.cobs); return renderAll(); }
  if (t.closest("[data-cmopen]")) { S.cmOpen = !S.cmOpen; return renderBuilder(); }
  const cav = t.closest("[data-cavg]"); if (cav) { S.cavg = cav.dataset.cavg === "1"; LS.set("cavg", S.cavg); S.sel = ""; return renderAll(); }
  const md = t.closest("#modes button");
  if (md) { S.mode[paramKey()] = md.dataset.mode; LS.set("mode2", S.mode); S.sel = ""; return renderAll(); }
  const rb = t.closest("#range button");
  if (rb) { S.rsel = +rb.dataset.r; LS.set("range", S.rsel); if (S.rsel > 1 && S.start < todayIdx() && S.rsel >= 3) S.start = todayIdx(); applyRange(); return setStart(S.start); }
  const ub = t.closest(".unit button");
  if (ub) { S.unit = ub.dataset.unit; LS.set("unit", S.unit); syncUnitOpts(); return renderAll(); }
  const ld = t.closest("[data-lead]"); if (ld) { S.lead = +ld.dataset.lead; LS.set("lead", S.lead); S.data && S.data.memo.clear(); syncUnitOpts(); return renderAll(); }
  const uo = t.closest("[data-wu],[data-pu]");
  if (uo) { if (uo.dataset.wu) { S.windU = uo.dataset.wu; LS.set("windU", S.windU); } else { S.precipU = uo.dataset.pu; LS.set("precipU", S.precipU); } syncUnitOpts(); return renderAll(); }
  const q = t.closest(".quick button[data-i]"); if (q) return loadLocation(q.classList.contains("recent") ? LS.get("recent", [])[+q.dataset.i] : QUICK[+q.dataset.i]);
  const mp = t.closest("#mpresets button"); if (mp) { applyPreset(mp.dataset.p); return renderAll(), renderModelsSheet(); }
  const mg = t.closest(".mgrp button[data-grp]");
  if (mg) { const on = mg.dataset.on === "1"; MODELS.filter(m => m.provider === mg.dataset.grp).forEach(m => on ? S.shown.add(m.id) : S.shown.delete(m.id)); S.preset = "custom"; saveShown(); return renderAll(), renderModelsSheet(); }
  const cl = t.closest("[data-close]"); if (cl) return closeModal(cl.closest(".modal").id);
  if (t.classList.contains("modal")) return closeModal(t.id);
});
document.addEventListener("change", e => { if (e.target.id === "ovSrc") { S.ovModel = e.target.value; LS.set("ovModel", S.ovModel); S.ovMin = null; renderOverview(); } });
$("mlist").addEventListener("change", e => {
  const id = e.target.dataset.id; if (!id) return;
  e.target.checked ? S.shown.add(id) : S.shown.delete(id);
  S.preset = "custom"; saveShown(); renderAll(); renderModelsSheet();
});
$("modelsBtn").onclick = () => { renderModelsSheet(); openModal("modelsModal"); };
function syncUnitOpts() {
  document.querySelectorAll("[data-lead]").forEach(b => b.classList.toggle("on", +b.dataset.lead === S.lead));
  document.querySelectorAll("[data-wu]").forEach(b => b.classList.toggle("on", b.dataset.wu === windU()));
  document.querySelectorAll("[data-pu]").forEach(b => b.classList.toggle("on", b.dataset.pu === precipU()));
  document.querySelectorAll("#optsModal .u").forEach(u => u.textContent = `°${S.unit}`);
}
$("optsBtn").onclick = () => {
  $("spreadSw").checked = !!S.spread;
  $("lineLow").value = S.lines.low != null ? fmt(lineIn(S.lines.low)) : "";
  $("lineHigh").value = S.lines.high != null ? fmt(lineIn(S.lines.high)) : "";
  syncUnitOpts();
  openModal("optsModal");
};
$("spreadSw").onchange = () => { S.spread = $("spreadSw").checked; LS.set("spread", S.spread); renderMain(); };
const saveLines = () => {
  const v = id => $(id).value.trim() === "" || isNaN(+$(id).value) ? null : +$(id).value;
  S.lines = { low: v("lineLow"), high: v("lineHigh"), unit: S.unit };
  LS.set("lines", S.lines); renderToolbar(); renderMain();
};
$("lineLow").oninput = saveLines; $("lineHigh").oninput = saveLines;
$("prevBtn").onclick = () => setStart(S.start - S.range);
$("nextBtn").onclick = () => setStart(S.start + S.range);
function setStart(i) {
  const n = S.data.dates.length;
  S.start = Math.max(0, Math.min(n - S.range, i));
  S.min = null; renderAll();
  const chip = $("days").children[S.start];
  if (chip) { const strip = $("days"); strip.scrollTo({ left: Math.max(0, chip.offsetLeft - strip.offsetLeft - 8), behavior: "smooth" }); }
}
document.addEventListener("keydown", e => {
  if (e.key === "Escape") { closeFS(); closeModal("modelsModal"); closeModal("optsModal"); hideSugg(); }
  if (!S.data || S.tab === "overview" || /input|textarea/i.test(e.target.tagName) || document.querySelector(".modal:not([hidden])")) return;
  if (e.key === "ArrowLeft" && !e.target.closest(".days,.tabs")) setStart(S.start - S.range);
  if (e.key === "ArrowRight" && !e.target.closest(".days,.tabs")) setStart(S.start + S.range);
});
let rz, lastW = innerWidth; addEventListener("resize", () => { clearTimeout(rz); rz = setTimeout(() => { if (!S.data) return; if (S.tab === "overview") { if (innerWidth !== lastW) renderOverview(); } else renderMain(); lastW = innerWidth; }, 150); });

// ---------- Search ----------
function parseCoords(s) {
  const m = s.trim().match(/^(-?\d+(?:\.\d+)?)\s*°?\s*([NS])?\s*[,;\s]\s*(-?\d+(?:\.\d+)?)\s*°?\s*([EW])?$/i);
  if (!m) return null;
  let lat = +m[1], lon = +m[3];
  if (m[2] && /s/i.test(m[2])) lat = -Math.abs(lat);
  if (m[4] && /w/i.test(m[4])) lon = -Math.abs(lon);
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}
const coordName = (lat, lon) => `${Math.abs(lat).toFixed(3)}°${lat >= 0 ? "N" : "S"}, ${Math.abs(lon).toFixed(3)}°${lon >= 0 ? "E" : "W"}`;
let suggItems = [], suggAct = -1, sTimer, sSeq = 0;
function showSugg(items, emptyMsg, header) {
  suggItems = items; suggAct = items.length ? 0 : -1;
  const ul = $("sugg");
  ul.innerHTML = (header ? `<li class="shd">${esc(header)}</li>` : "") + (items.length ? items.map((p, i) => `<li role="option" data-i="${i}" class="${i === suggAct ? "act" : ""}">
      <div><b>${esc(p.name)}</b><br><small>${esc([p.admin1, p.country].filter(Boolean).join(", ") || "Coordinates")}</small></div>
      <span class="cc">${(+p.lat).toFixed(2)}, ${(+p.lon).toFixed(2)}</span></li>`).join("")
    : `<li class="empty">${esc(emptyMsg || "No places found")}</li>`);
  ul.hidden = false;
}
function addRecent(l) {
  const r = LS.get("recent", []).filter(x => Math.abs(x.lat - l.lat) > 0.01 || Math.abs(x.lon - l.lon) > 0.01);
  LS.set("recent", [l, ...r].slice(0, 6));
}
function showRecent() { const r = LS.get("recent", []); r.length ? showSugg(r, "", "Recent") : hideSugg(); }
function renderQuick() {
  const r = LS.get("recent", []);
  $("quick").innerHTML = (r.length ? `<div class="qlbl">Recent</div>` + r.map((p, i) => `<button class="recent" data-i="${i}">${esc(p.name)}</button>`).join("") + `<div class="qlbl">Popular</div>` : "")
    + QUICK.map((p, i) => `<button data-i="${i}">${esc(p.name)}</button>`).join("");
}
$("q").addEventListener("focus", () => { if (!$("q").value.trim()) showRecent(); });
function hideSugg() { $("sugg").hidden = true; suggItems = []; suggAct = -1; }
$("q").addEventListener("input", () => {
  clearTimeout(sTimer);
  const v = $("q").value.trim();
  if (!v) return showRecent();
  const c = parseCoords(v);
  if (c) return showSugg([{ name: coordName(c.lat, c.lon), lat: c.lat, lon: c.lon }]);
  if (v.length < 2) return hideSugg();
  sTimer = setTimeout(async () => {
    const seq = ++sSeq;
    try {
      const j = await getJSON(`${GEO}?name=${encodeURIComponent(v)}&count=8&language=en&format=json`);
      if (seq !== sSeq) return;
      showSugg((j.results || []).map(r => ({ name: r.name, admin1: r.admin1, country: r.country, lat: r.latitude, lon: r.longitude })));
    } catch { if (seq === sSeq) showSugg([], "Search is unavailable right now"); }
  }, 220);
});
$("q").addEventListener("keydown", e => {
  if ($("sugg").hidden || !suggItems.length) return;
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    suggAct = (suggAct + (e.key === "ArrowDown" ? 1 : -1) + suggItems.length) % suggItems.length;
    $("sugg").querySelectorAll("li[data-i]").forEach((li, i) => li.classList.toggle("act", i === suggAct));
  }
});
$("searchForm").addEventListener("submit", e => {
  e.preventDefault();
  const c = parseCoords($("q").value);
  if (c) return choose({ name: coordName(c.lat, c.lon), lat: c.lat, lon: c.lon });
  if (suggItems.length) choose(suggItems[Math.max(0, suggAct)]);
});
$("sugg").addEventListener("pointerdown", e => { const li = e.target.closest("li[data-i]"); if (li) { e.preventDefault(); choose(suggItems[+li.dataset.i]); } });
document.addEventListener("pointerdown", e => { if (!e.target.closest(".search")) hideSugg(); });
function choose(p) { hideSugg(); $("q").value = ""; $("q").blur(); loadLocation(p); }
$("locate").onclick = () => {
  if (!navigator.geolocation) return status("Location isn't available in this browser. Search a place or type coordinates instead.", true);
  status("Finding your location…");
  navigator.geolocation.getCurrentPosition(
    p => loadLocation({ name: "My location", lat: p.coords.latitude, lon: p.coords.longitude }),
    () => { status("Couldn't get your location. Search a place or type coordinates instead.", true); if (S.data) { $("status").hidden = true; $("view").hidden = false; } },
    { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 });
};

// ---------- Load ----------
function status(msg, err) {
  const st = $("status");
  st.className = "status" + (err ? " err" : "");
  st.innerHTML = err ? esc(msg) : `<div class="spinner"></div>${esc(msg)}`;
  st.hidden = false;
}
async function loadLocation(p, keepView, tab) {
  S.loc = { name: p.name, admin1: p.admin1 || "", country: p.country || "", lat: +p.lat, lon: +p.lon };
  LS.set("loc", S.loc); addRecent(S.loc);
  if (!keepView) S.tab = TABS.includes(tab) ? tab : "overview";
  try { const u = new URL(location.href); u.search = `?lat=${S.loc.lat.toFixed(4)}&lon=${S.loc.lon.toFixed(4)}&name=${encodeURIComponent(S.loc.name)}`; u.hash = S.tab; history.replaceState(null, "", u); } catch {}
  document.title = `${S.loc.name} · Weather Overlay`;
  if (!keepView) { $("hero").hidden = true; $("view").hidden = true; status(`Loading every model for ${S.loc.name}…`); }
  try {
    const D = await fetchForecast(S.loc.lat, S.loc.lon);
    S.data = D; loadVerification(D); applyRange();
    if (!keepView) { S.start = todayIdx(); S.sel = ""; S.ovZ = null; }
    S.start = Math.max(0, Math.min(D.dates.length - S.range, S.start));
    S.min = null;
    $("status").hidden = true; $("view").hidden = false;
    renderAll();
    window.scrollTo({ top: 0 });
  } catch (err) {
    status(`Couldn't load forecasts: ${err.message}`, true);
    if (!S.data) $("hero").hidden = false;
  }
}
$("home").onclick = e => {
  e.preventDefault(); S.data = null; closeFS(); renderQuick();
  $("view").hidden = true; $("status").hidden = true; $("hero").hidden = false;
  try { history.replaceState(null, "", location.pathname); } catch {}
  document.title = "Weather Overlay";
};

setInterval(tickClock, 15000);
setInterval(() => { if (S.data && !document.hidden) S.tab === "overview" ? renderOverview() : renderMain(); }, 5 * 60000);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && S.data && Date.now() - S.data.fetched > 30 * 60000) loadLocation(S.loc, true);
});

// ---------- Boot ----------
renderQuick();
(function boot() {
  const qp = new URLSearchParams(location.search);
  const lat = parseFloat(qp.get("lat")), lon = parseFloat(qp.get("lon"));
  const last = LS.get("loc", null);
  if (isFinite(lat) && isFinite(lon)) return loadLocation({ name: qp.get("name") || coordName(lat, lon), lat, lon, ...(last && Math.abs(last.lat - lat) < 1e-3 ? last : {}) }, false, location.hash.slice(1));
  if (last && isFinite(last.lat)) loadLocation(last);
})();
if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("/sw.js").catch(() => {});
