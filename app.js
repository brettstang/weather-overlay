"use strict";
/* Weather Overlay — every Open-Meteo model's hourly temperature on one chart. */

const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const LS = {
  get(k, d) { try { const v = localStorage.getItem("wo:" + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("wo:" + k, JSON.stringify(v)); } catch {} }
};
const r1 = v => Math.round(v * 10) / 10;
const fmt = v => v == null ? "–" : (Math.round(v * 10) / 10).toFixed(1).replace(/\.0$/, "");

const MODEL_BY_ID = Object.fromEntries(MODELS.map(m => [m.id, m]));
const BLEND = { id: "blend", short: "Blend", name: "Open-Meteo best match", provider: "Open-Meteo", res: "auto", color: "#ffffff" };
const META = id => id === "blend" ? BLEND : MODEL_BY_ID[id];
const colorOf = id => id === "blend" ? "rgba(255,255,255,.8)" : (MODEL_BY_ID[id]?.color || "#aaa");

const API = "https://api.open-meteo.com/v1/forecast";
const GEO = "https://geocoding-api.open-meteo.com/v1/search";
const PAST_DAYS = 3, FORECAST_DAYS = 16;

const S = {
  loc: null, data: null,
  unit: LS.get("unit", "C"),
  range: LS.get("range", 1),
  start: PAST_DAYS,
  shown: new Set(LS.get("shown", ["blend", ...CORE_MODELS])),
  preset: LS.get("preset", "core"),
  spread: LS.get("spread", true),
  lines: LS.get("lines", { low: null, high: null, unit: "C" }),
  sel: "", min: null
};

const QUICK = [
  { name: "New York", admin1: "New York", country: "United States", lat: 40.7128, lon: -74.006 },
  { name: "Chicago", admin1: "Illinois", country: "United States", lat: 41.8781, lon: -87.6298 },
  { name: "Dallas", admin1: "Texas", country: "United States", lat: 32.7767, lon: -96.797 },
  { name: "Toronto", admin1: "Ontario", country: "Canada", lat: 43.6532, lon: -79.3832 },
  { name: "Regina", admin1: "Saskatchewan", country: "Canada", lat: 50.4452, lon: -104.6189 },
  { name: "London", admin1: "England", country: "United Kingdom", lat: 51.5072, lon: -0.1276 },
  { name: "Paris", admin1: "Île-de-France", country: "France", lat: 48.8566, lon: 2.3522 },
  { name: "Tokyo", admin1: "Tokyo", country: "Japan", lat: 35.6762, lon: 139.6503 },
  { name: "Karachi", admin1: "Sindh", country: "Pakistan", lat: 24.9065, lon: 67.1608 },
  { name: "Sydney", admin1: "New South Wales", country: "Australia", lat: -33.8688, lon: 151.2093 },
];

// ---------- Units ----------
const cv = c => c == null ? null : S.unit === "F" ? c * 9 / 5 + 32 : c;
const lineIn = v => v == null || v === "" ? null : S.lines.unit === S.unit ? +v : S.unit === "F" ? v * 9 / 5 + 32 : (v - 32) * 5 / 9;

// ---------- Dates ----------
const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MO = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dObj = d => new Date(d + "T12:00:00Z");
const dayShort = d => { const t = dObj(d); return `${WD[t.getUTCDay()]} ${t.getUTCDate()}`; };
const dayLong = d => { const t = dObj(d); return `${WD[t.getUTCDay()]}, ${MO[t.getUTCMonth()]} ${t.getUTCDate()}`; };
const pad = n => String(n).padStart(2, "0");

// ---------- Data ----------
async function getJSON(url) {
  const r = await fetch(url);
  let j; try { j = await r.json(); } catch { throw new Error(`Server returned ${r.status}`); }
  if (!r.ok || j.error) { const e = new Error(j.reason || `Server returned ${r.status}`); e.reason = j.reason || ""; throw e; }
  return j;
}
const fcURL = (lat, lon, ids) =>
  `${API}?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}&hourly=temperature_2m&models=${ids.join(",")}&timezone=auto&past_days=${PAST_DAYS}&forecast_days=${FORECAST_DAYS}`;

async function fetchForecast(lat, lon) {
  let ids = ["best_match", ...MODELS.map(m => m.id)];
  // One request for every model. If Open-Meteo doesn't know a model id, drop it and retry.
  for (let i = 0; i < 10; i++) {
    try { return parse(await getJSON(fcURL(lat, lon, ids)), ids); }
    catch (e) {
      if (e.reason == null) throw e;                         // network failure
      const bad = e.reason.match(/value\s+["']?([a-z0-9_]+)/i);
      if (bad && ids.includes(bad[1])) { ids = ids.filter(x => x !== bad[1]); continue; }
      break;
    }
  }
  // Fallback: one request per model, keep whatever works.
  const res = await Promise.allSettled(ids.map(id => getJSON(fcURL(lat, lon, [id])).then(j => ({ id, j }))));
  const ok = res.filter(r => r.status === "fulfilled").map(r => r.value);
  if (!ok.length) throw new Error("No forecast data came back for this location.");
  const base = ok[0].j, series = {};
  for (const { id, j } of ok) {
    const arr = j.hourly?.temperature_2m;
    if (arr && arr.some(v => v != null) && j.hourly.time.length === base.hourly.time.length) series[id === "best_match" ? "blend" : id] = arr;
  }
  return build(base, series);
}
function parse(j, ids) {
  const h = j.hourly || {}, series = {};
  for (const id of ids) {
    const arr = h[`temperature_2m_${id}`] ?? (ids.length === 1 ? h.temperature_2m : null);
    if (arr && arr.some(v => v != null)) series[id === "best_match" ? "blend" : id] = arr;
  }
  return build(j, series);
}
function build(j, series) {
  const times = j.hourly.time;
  const t2u = t => Date.UTC(+t.slice(0, 4), +t.slice(5, 7) - 1, +t.slice(8, 10), +(t.slice(11, 13) || 0), +(t.slice(14, 16) || 0));
  const base = t2u(times[0].slice(0, 10));
  const mins = times.map(t => (t2u(t) - base) / 60000);
  const dates = [...new Set(times.map(t => t.slice(0, 10)))];
  const pts = {};
  for (const [id, arr] of Object.entries(series)) {
    const p = [];
    arr.forEach((v, i) => { if (v != null) p.push({ m: mins[i], v }); });
    pts[id] = p;
  }
  const order = ["blend", ...MODELS.map(m => m.id)].filter(id => pts[id]);
  // Daily extremes per source (needs most of the day's hours)
  const daily = {};
  for (const id of order) daily[id] = dates.map((_, i) => {
    const d = pts[id].filter(p => p.m >= i * 1440 && p.m < (i + 1) * 1440);
    if (d.length < 18) return null;
    let hi = d[0], lo = d[0];
    for (const p of d) { if (p.v > hi.v) hi = p; if (p.v < lo.v) lo = p; }
    return { hi: hi.v, hiM: hi.m, lo: lo.v, loM: lo.m };
  });
  return { tz: j.timezone, tzAbbr: j.timezone_abbreviation, offset: j.utc_offset_seconds || 0, elev: j.elevation,
           lat: j.latitude, lon: j.longitude, dates, base, pts, order, daily, fetched: Date.now() };
}
const nowMin = () => S.data ? (Date.now() + S.data.offset * 1000 - S.data.base) / 60000 : null;
const todayIdx = () => Math.max(0, Math.min(S.data.dates.length - 1, Math.floor(nowMin() / 1440)));

// ---------- Visible sources ----------
const visible = () => S.data ? S.data.order.filter(id => S.shown.has(id)) : [];
const modelIds = ids => ids.filter(id => id !== "blend");

function applyPreset(p) {
  const all = MODELS.map(m => m.id);
  const pick = {
    core: CORE_MODELS,
    global: MODELS.filter(m => m.kind === "global" || m.kind === "ai").map(m => m.id),
    regional: MODELS.filter(m => m.kind === "regional").map(m => m.id),
    all, none: []
  }[p] || all;
  S.shown = new Set(p === "none" ? [] : ["blend", ...pick]);
  S.preset = p;
  saveShown();
}
function saveShown() { LS.set("shown", [...S.shown]); LS.set("preset", S.preset); }

// ---------- Window (selected days) ----------
function windowSeries() {
  const D = S.data, ws = S.start * 1440, span = S.range * 1440;
  return visible().map(id => ({
    id, pts: D.pts[id].filter(p => p.m >= ws && p.m <= ws + span).map(p => ({ m: p.m - ws, v: cv(p.v) }))
  })).filter(s => s.pts.length);
}
function hhmm(m, multi) {
  const D = S.data, di = Math.min(D.dates.length - 1, S.start + Math.floor(m / 1440));
  return `${multi ? dayShort(D.dates[di]) + " " : ""}${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`;
}

// ---------- Chart ----------
function chartSVG(W, H, compact) {
  const D = S.data, series = windowSeries(), span = S.range * 1440, multi = S.range > 1;
  const L = 38, R = 12, T = 16, B = 26;
  const all = series.flatMap(s => s.pts.map(p => p.v));
  if (!all.length) return { svg: `<div class="status">No models selected. Pick some on the right.</div>`, G: null };
  let lo = Math.min(...all), hi = Math.max(...all);
  const lLow = lineIn(S.lines.low), lHigh = lineIn(S.lines.high);
  for (const e of [lLow, lHigh]) if (e != null && e >= lo - 8 && e <= hi + 8) { lo = Math.min(lo, e); hi = Math.max(hi, e); }
  lo = Math.floor(lo - 1); hi = Math.ceil(hi + 1);
  const x = m => L + (m / span) * (W - L - R), y = v => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const path = pts => { let d = "", prev = null; for (const p of pts) { d += `${!prev || p.m - prev.m > 90 ? "M" : "L"}${x(p.m).toFixed(1)},${y(p.v).toFixed(1)}`; prev = p; } return d; };

  // Y grid
  const rng = hi - lo, step = rng > 45 ? 10 : rng > 22 ? 5 : rng > 9 ? 2 : 1;
  let grid = "";
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step)
    grid += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="rgba(255,255,255,${v === 0 && S.unit === "C" || v === 32 && S.unit === "F" ? ".22" : ".07"})"/><text x="${L - 7}" y="${y(v) + 4}" text-anchor="end" font-size="11" fill="rgba(226,231,255,.5)">${v}°</text>`;
  // X labels
  let xl = "";
  const lab = (m, t, bold) => `<text x="${x(m)}" y="${H - 8}" text-anchor="middle" font-size="11" font-weight="${bold ? 700 : 500}" fill="${bold ? "#fff" : "rgba(226,231,255,.5)"}">${t}</text>`;
  const vline = (m, a) => `<line x1="${x(m)}" x2="${x(m)}" y1="${T}" y2="${H - B}" stroke="rgba(255,255,255,${a})"/>`;
  if (!multi) {
    const every = W < 520 ? 6 : 3;
    for (let h = 0; h <= 24; h += every) {
      const t = h % 24 === 0 ? "12a" : h === 12 ? "12p" : h < 12 ? `${h}a` : `${h - 12}p`;
      xl += vline(h * 60, ".04") + lab(h * 60, t);
    }
  } else {
    const ti = todayIdx() - S.start, perDay = (W - L - R) / S.range;
    for (let i = 0; i < S.range; i++) {
      if (i) xl += vline(i * 1440, ".14");
      if (perDay > 70 && S.range <= 7) xl += vline(i * 1440 + 720, ".04");
      const d = D.dates[S.start + i]; if (!d) continue;
      const t = perDay > 52 ? dayShort(d) : perDay > 22 ? String(dObj(d).getUTCDate()) : (i % 2 ? "" : String(dObj(d).getUTCDate()));
      xl += lab(i * 1440 + 720, t, i === ti);
    }
  }
  // Now
  const nm = nowMin() - S.start * 1440;
  const nowSvg = nm > 0 && nm < span ? `<rect x="${L}" y="${T}" width="${Math.max(0, x(nm) - L)}" height="${H - T - B}" fill="rgba(255,255,255,.035)"/>
    <line x1="${x(nm)}" x2="${x(nm)}" y1="${T}" y2="${H - B}" stroke="rgba(255,255,255,.45)" stroke-dasharray="2 3"/>
    <text x="${x(nm) + 4}" y="${T + 10}" font-size="10.5" fill="rgba(255,255,255,.8)">now</text>` : "";
  // Spread band (min–max of the shown models, not counting Blend)
  let band = "";
  const ms = series.filter(s => s.id !== "blend");
  if (S.spread && ms.length >= 2) {
    const byM = new Map();
    for (const s of ms) for (const p of s.pts) { const a = byM.get(p.m); a ? a.push(p.v) : byM.set(p.m, [p.v]); }
    const keys = [...byM.keys()].sort((a, b) => a - b);
    let run = [];
    const flush = () => {
      if (run.length > 1) band += `<path d="M${run.map(r => `${x(r.m).toFixed(1)},${y(r.hi).toFixed(1)}`).join("L")}L${run.slice().reverse().map(r => `${x(r.m).toFixed(1)},${y(r.lo).toFixed(1)}`).join("L")}Z" fill="rgba(150,165,255,.13)"/>`;
      run = [];
    };
    for (const m of keys) {
      const a = byM.get(m);
      if (a.length < 2 || (run.length && m - run[run.length - 1].m > 90)) { flush(); if (a.length < 2) continue; }
      run.push({ m, hi: Math.max(...a), lo: Math.min(...a) });
    }
    flush();
  }
  const edge = (v, col, lbl) => v == null || v < lo || v > hi ? "" :
    `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="${col}" stroke-width="1.4" stroke-dasharray="6 4" opacity=".95"/>
     <text x="${W - R - 3}" y="${y(v) - 5}" text-anchor="end" font-size="11" font-weight="700" fill="${col}">${lbl}</text>`;
  // Lines: models first, Blend on top
  const lines = series.filter(s => s.id !== "blend").map(s =>
    `<path data-line="${s.id}" d="${path(s.pts)}" fill="none" stroke="${colorOf(s.id)}" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round" opacity=".92"/>`).join("");
  const bl = series.find(s => s.id === "blend");
  const blend = bl ? `<path data-line="blend" d="${path(bl.pts)}" fill="none" stroke="rgba(255,255,255,.7)" stroke-width="1.8" stroke-dasharray="5 4"/>` : "";
  // Day's extremes (single day): Blend, else the models' mean
  let ext = "";
  if (!multi) {
    const e = dayExt(S.start);
    if (e) ext = `<circle cx="${x(e.hiM - S.start * 1440)}" cy="${y(cv(e.hi))}" r="5.5" fill="none" stroke="#ff9f43" stroke-width="2"/>
                  <circle cx="${x(e.loM - S.start * 1440)}" cy="${y(cv(e.lo))}" r="5.5" fill="none" stroke="#5ec8ff" stroke-width="2"/>`;
  }
  const G = { W, H, L, R, T, B, lo, hi, x, y, span, series, multi };
  const svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Hourly temperature by model" style="touch-action:none">
    ${grid}${xl}${nowSvg}${band}
    ${edge(lLow, "#5ec8ff", `≤${fmt(lLow)}°`)}${edge(lHigh, "#ff9f43", `≥${fmt(lHigh)}°`)}
    ${lines}${blend}${ext}
    <g class="xh"></g>
    <rect class="hit" x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}" fill="transparent"/>
  </svg>`;
  return { svg, G };
}
function dayExt(i) {
  const D = S.data;
  if (S.shown.has("blend") && D.daily.blend?.[i]) return D.daily.blend[i];
  const ids = modelIds(visible()).filter(id => D.daily[id][i]);
  if (!ids.length) return null;
  // Mean of the shown models, hour by hour
  const byM = new Map();
  for (const id of ids) for (const p of D.pts[id]) if (p.m >= i * 1440 && p.m < (i + 1) * 1440) { const a = byM.get(p.m); a ? a.push(p.v) : byM.set(p.m, [p.v]); }
  let hi = null, lo = null;
  for (const [m, a] of byM) { const v = a.reduce((s, b) => s + b, 0) / a.length; if (!hi || v > hi.v) hi = { m, v }; if (!lo || v < lo.v) lo = { m, v }; }
  return hi && { hi: hi.v, hiM: hi.m, lo: lo.v, loM: lo.m };
}

function summaryHTML() {
  const D = S.data, U = `°${S.unit}`;
  if (S.range === 1) {
    const i = S.start, d = D.dates[i], e = dayExt(i), src = S.shown.has("blend") && D.daily.blend?.[i] ? "Blend" : "Model mean";
    const highs = modelIds(visible()).map(id => D.daily[id][i]).filter(Boolean);
    const span = highs.length > 1 ? ` · models <span class="hi">${fmt(cv(Math.min(...highs.map(h => h.hi))))}–${fmt(cv(Math.max(...highs.map(h => h.hi))))}°</span> / <span class="lo">${fmt(cv(Math.min(...highs.map(h => h.lo))))}–${fmt(cv(Math.max(...highs.map(h => h.lo))))}°</span>` : "";
    const tag = i === todayIdx() ? "Today" : i === todayIdx() + 1 ? "Tomorrow" : i < todayIdx() ? "Past" : "";
    return `<b>${dayLong(d)}</b>${tag ? ` · ${tag}` : ""}${e ? ` · ${src} high <b class="hi">${fmt(cv(e.hi))}${U}</b> at ${hhmm(e.hiM - i * 1440)}, low <b class="lo">${fmt(cv(e.lo))}${U}</b> at ${hhmm(e.loM - i * 1440)}` : ""}${span}`;
  }
  const a = D.dates[S.start], b = D.dates[S.start + S.range - 1];
  const ser = windowSeries().filter(s => s.id === "blend")[0] || null;
  const v = ser ? ser.pts.map(p => p.v) : [];
  return `<b>${dayShort(a)} – ${dayShort(b)}</b> · ${S.range} days${v.length ? ` · Blend range <b class="lo">${fmt(Math.min(...v))}°</b> to <b class="hi">${fmt(Math.max(...v))}${U}</b>` : ""}`;
}

// ---------- Readout (crosshair) ----------
function valueAt(G, id, minute) { const s = G.series.find(s => s.id === id); return s ? s.pts.find(p => p.m === minute) || null : null; }
function readoutHTML(G, minute) {
  if (!G) return "";
  const U = `°${S.unit}`;
  if (S.sel) {
    const p = valueAt(G, S.sel, minute), m = META(S.sel);
    return p ? `<div><span class="rdot" style="background:${colorOf(S.sel)}"></span><b>${esc(m.short)}</b> at <b>${hhmm(minute, G.multi)}</b> <span class="rbig">${fmt(p.v)}${U}</span></div><small style="color:var(--faint)">${esc(m.name)} · ${esc(m.res)} · tap the name again to see all</small>`
             : `<b>${esc(m.short)}</b> has no value at ${hhmm(minute, G.multi)} (outside its forecast range).`;
  }
  const rows = G.series.map(s => ({ id: s.id, p: s.pts.find(p => p.m === minute) })).filter(r => r.p).sort((a, b) => b.p.v - a.p.v);
  const mv = rows.filter(r => r.id !== "blend").map(r => r.p.v);
  const mean = mv.length ? mv.reduce((a, b) => a + b, 0) / mv.length : null;
  return `<div class="rhead"><span>${hhmm(minute, G.multi)} local</span><small>${S.range === 1 ? dayShort(S.data.dates[S.start]) : ""}</small></div>
    <div class="rgrid">${rows.map(r => `<span title="${esc(META(r.id).name)}"><span class="rdot" style="background:${colorOf(r.id)}"></span>${esc(META(r.id).short)}</span><b>${fmt(r.p.v)}${U}</b>`).join("")}</div>
    ${mv.length > 1 ? `<div class="rstats"><span>Mean <b>${fmt(mean)}°</b></span><span>Spread <b>${fmt(Math.max(...mv) - Math.min(...mv))}°</b></span><span>Models <b>${mv.length}</b></span></div>` : ""}`;
}
function drawCrosshair(scope, minute) {
  const G = scope._G; if (!G) return;
  S.min = minute;
  const { x, y, T, H, B } = G;
  const ids = S.sel ? [S.sel] : G.series.map(s => s.id);
  let dots = "";
  for (const id of ids) { const p = valueAt(G, id, minute); if (p) dots += `<circle cx="${x(p.m)}" cy="${y(p.v)}" r="${S.sel ? 5 : 3.2}" fill="${colorOf(id)}" stroke="#0a0e22" stroke-width="1.5"/>`; }
  const xh = scope.querySelector(".xh");
  if (xh) xh.innerHTML = `<line x1="${x(minute)}" x2="${x(minute)}" y1="${T}" y2="${H - B}" stroke="rgba(255,255,255,.6)"/>${dots}`;
  const ro = scope.querySelector(".readout");
  if (ro) { ro.classList.remove("empty"); ro.innerHTML = readoutHTML(G, minute); }
}
function defaultMinute() {
  const span = S.range * 1440, nm = nowMin() - S.start * 1440;
  if (nm >= 0 && nm < span) return Math.round(nm / 60) * 60;
  if (S.range === 1) { const e = dayExt(S.start); if (e) return e.hiM - S.start * 1440; return 720; }
  return 720;
}
function applyHighlight(scope) {
  scope.querySelectorAll("[data-line]").forEach(el => {
    const k = el.getAttribute("data-line");
    el.style.opacity = !S.sel || k === S.sel ? "" : ".12";
    el.setAttribute("stroke-width", S.sel && k === S.sel ? "3.4" : k === "blend" ? "1.8" : "1.7");
  });
  scope.querySelectorAll(".li").forEach(li => { li.classList.toggle("sel", li.dataset.id === S.sel); li.classList.toggle("dim", !!S.sel && li.dataset.id !== S.sel); });
}

// ---------- Legend ----------
function legendHTML() {
  const D = S.data, i = S.start;
  const val = id => {
    if (S.range === 1) { const e = D.daily[id][i]; return e ? `<span class="h">${fmt(cv(e.hi))}°</span><span class="l">${fmt(cv(e.lo))}°</span>` : `<span class="l" style="color:var(--faint)">partial</span>`; }
    const p = D.pts[id].filter(p => p.m >= i * 1440 && p.m <= (i + S.range) * 1440).map(p => cv(p.v));
    return p.length ? `<span class="h">${fmt(Math.max(...p))}°</span><span class="l">${fmt(Math.min(...p))}°</span>` : "";
  };
  const item = id => { const m = META(id); return `<div class="li${S.shown.has(id) ? " on" : ""}" data-id="${id}" role="button" tabindex="0">
      <button class="eye" style="color:${colorOf(id)}" aria-label="${S.shown.has(id) ? "Hide" : "Show"} ${esc(m.short)}"><i></i></button>
      <div class="nm"><span>${esc(m.short)}</span><small>${esc(id === "blend" ? m.name : `${m.provider} · ${m.res}`)}</small></div>
      <div class="v">${val(id)}</div></div>`; };
  let html = D.pts.blend ? item("blend") : "", lastProv = "";
  for (const id of D.order) {
    if (id === "blend") continue;
    const p = MODEL_BY_ID[id].provider;
    if (p !== lastProv) { html += `<div class="lgrp">${esc(p)}</div>`; lastProv = p; }
    html += item(id);
  }
  return html;
}
function legendTitle() {
  const n = S.data.order.length - (S.data.pts.blend ? 1 : 0), on = modelIds(visible()).length;
  return `<span>${S.range === 1 ? "Day high / low" : "Range high / low"}</span><span>${on} of ${n} models</span>`;
}

// ---------- Day strip & table ----------
function renderDays() {
  const D = S.data, t = todayIdx();
  $("days").innerHTML = D.dates.map((d, i) => {
    const e = D.daily.blend?.[i] || null, inR = i >= S.start && i < S.start + S.range;
    const tag = i === t ? "<em>Today</em>" : "";
    return `<button class="day${i < t ? " past" : ""}${inR ? " in" : ""}${i === S.start && S.range > 1 ? " first" : ""}" data-i="${i}" role="tab" aria-selected="${inR}">
      <div class="dn"><span>${WD[dObj(d).getUTCDay()]}</span>${tag}</div><div class="dt">${MO[dObj(d).getUTCMonth()]} ${dObj(d).getUTCDate()}</div>
      <div class="hl">${e ? `<span class="h">${Math.round(cv(e.hi))}°</span> <span class="l">${Math.round(cv(e.lo))}°</span>` : "&nbsp;"}</div></button>`;
  }).join("");
}
function renderTable() {
  const D = S.data, t = todayIdx(), ids = visible();
  const cls = i => `${i < t ? "past" : ""}${i >= S.start && i < S.start + S.range ? " in" : ""}`;
  const cell = e => e ? `<span class="h">${fmt(cv(e.hi))}</span><br><span class="l">${fmt(cv(e.lo))}</span>` : `<span class="s">–</span>`;
  let h = `<table class="dt"><thead><tr><th class="mcol">°${S.unit} · high<br>low</th>${D.dates.map((d, i) =>
    `<th class="${cls(i)}" data-i="${i}">${i === t ? "Today" : WD[dObj(d).getUTCDay()]}<b>${dObj(d).getUTCDate()}</b></th>`).join("")}</tr></thead><tbody>`;
  for (const id of ids) h += `<tr><th><i style="background:${colorOf(id)}"></i>${esc(META(id).short)}</th>${D.dates.map((_, i) => `<td class="${cls(i)}">${cell(D.daily[id][i])}</td>`).join("")}</tr>`;
  const mids = modelIds(ids);
  if (mids.length > 1) {
    const stat = (label, f) => `<tr class="stat"><th>${label}</th>${D.dates.map((_, i) => {
      const es = mids.map(id => D.daily[id][i]).filter(Boolean);
      return `<td class="${cls(i)}">${es.length > 1 ? f(es) : "–"}</td>`; }).join("")}</tr>`;
    const mean = a => a.reduce((s, b) => s + b, 0) / a.length;
    h += stat("Model mean", es => `<span class="h">${fmt(cv(mean(es.map(e => e.hi))))}</span><br><span class="l">${fmt(cv(mean(es.map(e => e.lo))))}</span>`);
    const k = S.unit === "F" ? 1.8 : 1;
    h += stat("Model spread", es => `${fmt((Math.max(...es.map(e => e.hi)) - Math.min(...es.map(e => e.hi))) * k)}<br>${fmt((Math.max(...es.map(e => e.lo)) - Math.min(...es.map(e => e.lo))) * k)}`);
  }
  $("table").innerHTML = h + "</tbody></table>";
}

// ---------- Render ----------
function chartDims(el) {
  const W = Math.max(320, Math.round(el.clientWidth || 340));
  const H = W < 600 ? Math.round(Math.max(250, W * 0.72)) : Math.round(Math.min(520, Math.max(300, W * 0.5)));
  return { W, H };
}
function renderMain() {
  const scope = $("view"), host = $("chart");
  const { W, H } = chartDims(host);
  const { svg, G } = chartSVG(W, H);
  host.innerHTML = svg; scope._G = G;
  $("gsum").innerHTML = summaryHTML();
  $("legendTitle").innerHTML = legendTitle();
  $("legend").innerHTML = legendHTML();
  if (S.min == null || S.min > S.range * 1440) S.min = defaultMinute();
  drawCrosshair(scope, S.min);
  applyHighlight(scope);
  const fs = document.querySelector(".fsbox"); if (fs) renderFS(fs);
}
function renderAll() {
  if (!S.data) return;
  renderHeader(); renderDays(); renderMain(); renderTable();
  document.querySelectorAll("#range button").forEach(b => b.classList.toggle("on", +b.dataset.r === S.range));
  document.querySelectorAll("#presets button").forEach(b => b.classList.toggle("on", b.dataset.p === S.preset));
  document.querySelectorAll(".unit button").forEach(b => b.classList.toggle("on", b.dataset.unit === S.unit));
  $("spreadBtn").setAttribute("aria-pressed", S.spread);
  $("linesBtn").classList.toggle("on", S.lines.low != null || S.lines.high != null);
}
function renderHeader() {
  const D = S.data, L = S.loc;
  $("locName").textContent = L.name;
  const ns = D.lat >= 0 ? "N" : "S", ew = D.lon >= 0 ? "E" : "W";
  const where = [L.admin1, L.country].filter(Boolean).join(", ") || "Custom coordinates";
  const nModels = D.order.length - (D.pts.blend ? 1 : 0);
  $("locMeta").textContent = `${where ? where + " · " : ""}${Math.abs(D.lat).toFixed(3)}°${ns}, ${Math.abs(D.lon).toFixed(3)}°${ew} · ${Math.round(D.elev ?? 0)} m · ${nModels} models with data`;
  tickClock();
}
function tickClock() {
  if (!S.data) return;
  const t = new Date(Date.now() + S.data.offset * 1000);
  $("clock").innerHTML = `<b>${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}</b>${WD[t.getUTCDay()]} ${MO[t.getUTCMonth()]} ${t.getUTCDate()} · ${esc(S.data.tzAbbr || S.data.tz || "")}`;
}

// ---------- Full-screen chart (drawn sideways on a portrait phone) ----------
function fsSize() {
  const vw = innerWidth, vh = innerHeight, rot = vh > vw && vw < 760;
  const long = rot ? vh : vw, short = rot ? vw : vh;
  const panel = Math.min(300, Math.round(long * 0.34));
  const W = Math.max(320, long - panel - 60), H = Math.max(200, short - 80);
  return { rot, long, short, W, H };
}
function renderFS(box) {
  const fs = box.closest(".fs"), z = fsSize();
  fs.classList.toggle("rot", z.rot);
  box.style.width = z.long + "px"; box.style.height = z.short + "px";
  const { svg, G } = chartSVG(z.W, z.H);
  box._G = G;
  box.innerHTML = `<button class="fsx" aria-label="Close">✕</button>
    <div class="fsl"><div class="fsc"><div class="gsum">${esc(S.loc.name)} · ${summaryHTML()}</div><div class="chart">${svg}</div></div>
    <div class="fsp"><div class="readout"></div><div class="glh">${legendTitle()}</div><div class="legend">${legendHTML()}</div></div></div>`;
  if (S.min != null) drawCrosshair(box, S.min);
  applyHighlight(box);
}
function openFS() {
  const fs = document.createElement("div");
  fs.className = "fs";
  fs.innerHTML = `<div class="fsbox"></div>`;
  document.body.appendChild(fs);
  document.body.classList.add("fs-open");
  renderFS(fs.firstChild);
}
function closeFS() { document.querySelector(".fs")?.remove(); document.body.classList.remove("fs-open"); }

// ---------- Interaction ----------
function scopeOf(el) { return el.closest(".fsbox") || $("view"); }
function pointerToMinute(svg, G, cx, cy) {
  const rect = svg.getBoundingClientRect(), rotated = !!svg.closest(".fs.rot");
  const sx = rotated ? (cy - rect.top) / rect.height * G.W : (cx - rect.left) / rect.width * G.W;
  const frac = Math.min(1, Math.max(0, (sx - G.L) / (G.W - G.L - G.R)));
  const hrs = G.span / 60;
  return Math.min(hrs, Math.round(frac * hrs)) * 60;
}
document.addEventListener("pointerdown", e => {
  const svg = e.target.closest?.(".chart svg"); if (!svg) return;
  const scope = scopeOf(svg), G = scope._G; if (!G) return;
  const move = ev => {
    const m = pointerToMinute(svg, G, ev.clientX, ev.clientY);
    drawCrosshair(scope, m);
    const other = scope.id === "view" ? document.querySelector(".fsbox") : null;
    if (other) drawCrosshair(other, m);
  };
  move(e);
  try { svg.setPointerCapture(e.pointerId); } catch {}
  const up = () => { svg.removeEventListener("pointermove", move); svg.removeEventListener("pointerup", up); svg.removeEventListener("pointercancel", up); if (scope.id !== "view") { drawCrosshair($("view"), S.min); } };
  svg.addEventListener("pointermove", move);
  svg.addEventListener("pointerup", up);
  svg.addEventListener("pointercancel", up);
});
document.addEventListener("click", e => {
  if (e.target.closest(".gexp")) return openFS();
  if (e.target.closest(".fsx")) return closeFS();
  const li = e.target.closest(".li");
  if (li) {
    const id = li.dataset.id;
    if (e.target.closest(".eye")) {
      S.shown.has(id) ? S.shown.delete(id) : S.shown.add(id);
      if (!S.shown.has(id) && S.sel === id) S.sel = "";
      S.preset = "custom"; saveShown(); renderAll(); return;
    }
    if (!S.shown.has(id)) { S.shown.add(id); S.preset = "custom"; saveShown(); S.sel = id; renderAll(); return; }
    S.sel = S.sel === id ? "" : id;
    for (const sc of [$("view"), document.querySelector(".fsbox")]) if (sc) { applyHighlight(sc); drawCrosshair(sc, S.min); }
    return;
  }
  const day = e.target.closest(".day, .dt thead th[data-i]");
  if (day) { setStart(+day.dataset.i); return; }
  const rb = e.target.closest("#range button");
  if (rb) { S.range = +rb.dataset.r; LS.set("range", S.range); if (S.range === 16 && S.start < todayIdx()) S.start = todayIdx(); setStart(S.start); return; }
  const pb = e.target.closest("#presets button");
  if (pb) { applyPreset(pb.dataset.p); if (S.sel && !S.shown.has(S.sel)) S.sel = ""; renderAll(); return; }
  const ub = e.target.closest(".unit button");
  if (ub) { S.unit = ub.dataset.unit; LS.set("unit", S.unit); renderAll(); return; }
  const q = e.target.closest(".quick button");
  if (q) { const p = QUICK[+q.dataset.i]; loadLocation(p); return; }
});
function setStart(i) {
  const n = S.data.dates.length;
  S.start = Math.max(0, Math.min(n - S.range, i));
  S.min = null; renderAll();
  const chip = $("days").children[S.start];
  if (chip) chip.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
}
$("spreadBtn").onclick = () => { S.spread = !S.spread; LS.set("spread", S.spread); renderAll(); };
document.addEventListener("keydown", e => {
  if (e.key === "Escape") { closeFS(); $("linesModal").hidden = true; hideSugg(); }
  if (e.key === "Enter" && e.target.classList?.contains("li")) e.target.click();
});
let rz; addEventListener("resize", () => { clearTimeout(rz); rz = setTimeout(() => { if (!S.data) return; renderMain(); }, 120); });

// Reference lines dialog
$("linesBtn").onclick = () => {
  $("lineLow").value = S.lines.low != null ? fmt(lineIn(S.lines.low)) : "";
  $("lineHigh").value = S.lines.high != null ? fmt(lineIn(S.lines.high)) : "";
  document.querySelectorAll("#linesModal label").forEach((l, i) => l.firstChild.textContent = `${i ? "High line (≥" : "Low line (≤"} °${S.unit}) `);
  $("linesModal").hidden = false; $("lineLow").focus();
};
$("linesSave").onclick = () => {
  const v = id => $(id).value.trim() === "" ? null : +$(id).value;
  S.lines = { low: v("lineLow"), high: v("lineHigh"), unit: S.unit };
  LS.set("lines", S.lines); $("linesModal").hidden = true; renderAll();
};
$("linesClear").onclick = () => { S.lines = { low: null, high: null, unit: S.unit }; LS.set("lines", S.lines); $("linesModal").hidden = true; renderAll(); };
$("linesModal").onclick = e => { if (e.target.id === "linesModal") $("linesModal").hidden = true; };

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
function showSugg(items, emptyMsg) {
  suggItems = items; suggAct = items.length ? 0 : -1;
  const ul = $("sugg");
  ul.innerHTML = items.length ? items.map((p, i) => `<li role="option" data-i="${i}" class="${i === suggAct ? "act" : ""}">
      <div><b>${esc(p.name)}</b><br><small>${esc([p.admin1, p.country].filter(Boolean).join(", ") || "Coordinates")}</small></div>
      <span class="cc">${p.lat.toFixed(2)}, ${p.lon.toFixed(2)}</span></li>`).join("")
    : `<li class="empty">${esc(emptyMsg || "No places found")}</li>`;
  ul.hidden = false;
}
function hideSugg() { $("sugg").hidden = true; suggItems = []; suggAct = -1; }
$("q").addEventListener("input", () => {
  clearTimeout(sTimer);
  const v = $("q").value.trim();
  if (!v) return hideSugg();
  const c = parseCoords(v);
  if (c) return showSugg([{ name: coordName(c.lat, c.lon), lat: c.lat, lon: c.lon, coords: true }]);
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
    [...$("sugg").children].forEach((li, i) => li.classList.toggle("act", i === suggAct));
  }
});
$("searchForm").addEventListener("submit", e => {
  e.preventDefault();
  const c = parseCoords($("q").value);
  if (c) return pick({ name: coordName(c.lat, c.lon), lat: c.lat, lon: c.lon, coords: true });
  if (suggItems.length) pick(suggItems[Math.max(0, suggAct)]);
});
$("sugg").addEventListener("pointerdown", e => { const li = e.target.closest("li[data-i]"); if (li) { e.preventDefault(); pick(suggItems[+li.dataset.i]); } });
document.addEventListener("pointerdown", e => { if (!e.target.closest(".search")) hideSugg(); });
function pick(p) { hideSugg(); $("q").value = ""; $("q").blur(); loadLocation(p); }
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
async function loadLocation(p, keepView) {
  S.loc = { name: p.name, admin1: p.admin1 || "", country: p.country || "", lat: +p.lat, lon: +p.lon };
  LS.set("loc", S.loc);
  try { const u = new URL(location.href); u.search = `?lat=${S.loc.lat.toFixed(4)}&lon=${S.loc.lon.toFixed(4)}&name=${encodeURIComponent(S.loc.name)}`; history.replaceState(null, "", u); } catch {}
  document.title = `${S.loc.name} · Weather Overlay`;
  if (!keepView) { $("hero").hidden = true; $("view").hidden = true; status(`Loading every model for ${S.loc.name}…`); }
  try {
    S.data = await fetchForecast(S.loc.lat, S.loc.lon);
    if (!keepView) { S.start = todayIdx(); S.sel = ""; }
    S.start = Math.max(0, Math.min(S.data.dates.length - S.range, S.start));
    S.min = null;
    $("status").hidden = true; $("view").hidden = false;
    renderAll();
  } catch (err) {
    status(`Couldn't load forecasts: ${err.message}`, true);
    if (!S.data) $("hero").hidden = false;
  }
}
$("home").onclick = e => {
  e.preventDefault(); S.data = null; closeFS();
  $("view").hidden = true; $("status").hidden = true; $("hero").hidden = false;
  try { history.replaceState(null, "", location.pathname); } catch {}
  document.title = "Weather Overlay";
};

// Keep the clock and "now" line fresh; refetch if the data is stale
setInterval(tickClock, 15000);
setInterval(() => { if (S.data && !document.hidden) renderMain(); }, 5 * 60000);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && S.data && Date.now() - S.data.fetched > 30 * 60000) loadLocation(S.loc, true);
});

// ---------- Boot ----------
$("quick").innerHTML = QUICK.map((p, i) => `<button data-i="${i}">${esc(p.name)}</button>`).join("");
(function boot() {
  const qp = new URLSearchParams(location.search);
  const lat = parseFloat(qp.get("lat")), lon = parseFloat(qp.get("lon"));
  if (isFinite(lat) && isFinite(lon)) return loadLocation({ name: qp.get("name") || coordName(lat, lon), lat, lon, ...(LS.get("loc", {})?.lat === lat ? LS.get("loc", {}) : {}) });
  const last = LS.get("loc", null);
  if (last && isFinite(last.lat)) loadLocation(last);
})();
if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("/sw.js").catch(() => {});
