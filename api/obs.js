// Observed temperature and dew point at the airport nearest a location.
// Same source as Weather Scanner: aviationweather.gov METARs, ROUTINE reports only,
// using the precise T-group (e.g. T01560072 = 15.6 °C / 7.2 °C) when the report has one.
// Rows: [time ms, temp °C, dew °C, wind km/h, gust km/h, cloud %, precip mm (last hour)]
// GET /api/obs?lat=35.47&lon=-97.52&hours=100

const AWC = "https://aviationweather.gov/api/data/metar";

async function getJSON(url) {
  const r = await fetch(url, { headers: { accept: "application/json", "user-agent": "weather-overlay" }, signal: AbortSignal.timeout(9000) });
  if (r.status === 204) return [];
  if (!r.ok) throw new Error(`${r.status} from aviationweather.gov`);
  const t = await r.text();
  return t ? JSON.parse(t) : [];
}
const signed = (s, d) => (s === "1" ? -1 : 1) * Number(d) / 10;
export function parseMetar(o) {
  const raw = o.rawOb || o.raw_text || "";
  const rmk = raw.includes(" RMK ") ? raw.split(" RMK ")[1] : "";
  let c = typeof o.temp === "number" ? o.temp : null;
  let d = typeof o.dewp === "number" ? o.dewp : null;
  const t = rmk.match(/(?:^|\s)T([01])(\d{3})(?:([01])(\d{3}))?(?=\s|$)/);
  if (t) { c = signed(t[1], t[2]); if (t[3]) d = signed(t[3], t[4]); }
  const time = typeof o.obsTime === "number" ? o.obsTime * 1000 : Date.parse(o.reportTime || o.obsTime);
  const special = o.metarType === "SPECI" || /^SPECI\b/.test(raw);
  // Wind (kt → km/h), gust only when reported
  const KT = 1.852;
  const w = typeof o.wspd === "number" ? o.wspd * KT : null;
  const g = typeof o.wgst === "number" ? o.wgst * KT : null;
  // Cloud cover from the reported layers (largest coverage)
  const COV = { SKC: 0, CLR: 0, NSC: 0, NCD: 0, CAVOK: 0, FEW: 19, SCT: 44, BKN: 75, OVC: 100, OVX: 100, VV: 100 };
  let cl = null;
  if (Array.isArray(o.clouds) && o.clouds.length) cl = Math.max(...o.clouds.map(x => COV[x.cover] ?? 0));
  else if (/\b(CLR|SKC|NSC|NCD|CAVOK)\b/.test(raw)) cl = 0;
  else { const ls = [...raw.matchAll(/\b(FEW|SCT|BKN|OVC|VV)\d{3}/g)].map(m => COV[m[1]]); if (ls.length) cl = Math.max(...ls); }
  // Hourly precipitation: P-group in US ASOS remarks (hundredths of an inch); AO2 stations omit it when dry
  let pr = null;
  const p = rmk.match(/(?:^|\s)P(\d{4})(?=\s|$)/);
  if (p) pr = Number(p[1]) * 0.254; else if (/\bAO2\b/.test(rmk)) pr = 0;
  const r1 = x => x == null ? null : Math.round(x * 10) / 10;
  return { time, c, d, special, w: r1(w), g: r1(g), cl, pr: r1(pr) };
}
function km(lat1, lon1, lat2, lon2) {
  const r = Math.PI / 180, a = Math.sin((lat2 - lat1) * r / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin((lon2 - lon1) * r / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(a));
}
async function nearestStation(lat, lon) {
  for (const box of [0.6, 1.5, 3]) {
    const bbox = [lat - box, lon - box, lat + box, lon + box].map(v => v.toFixed(3)).join(",");
    const list = await getJSON(`${AWC}?bbox=${bbox}&format=json`);
    const st = (Array.isArray(list) ? list : [])
      .filter(o => /^[A-Z][A-Z0-9]{3}$/.test(o.icaoId || "") && typeof o.lat === "number" && typeof o.temp === "number")
      .map(o => ({ id: o.icaoId, name: o.name || o.icaoId, lat: o.lat, lon: o.lon, elev: o.elev ?? null, distKm: km(lat, lon, o.lat, o.lon) }))
      .sort((a, b) => a.distKm - b.distKm);
    if (st.length) return st[0];
  }
  return null;
}
export default async function handler(req, res) {
  const lat = parseFloat(req.query.lat), lon = parseFloat(req.query.lon);
  const hours = Math.min(168, Math.max(24, parseInt(req.query.hours || "100", 10) || 100));
  if (!isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return res.status(400).json({ error: "lat and lon are required" });
  try {
    let station = null;
    if (req.query.station && /^[A-Z0-9]{4}$/i.test(req.query.station)) station = { id: req.query.station.toUpperCase() };
    else station = await nearestStation(lat, lon);
    if (!station) { res.setHeader("Cache-Control", "s-maxage=3600"); return res.status(200).json({ station: null, obs: [] }); }
    const list = await getJSON(`${AWC}?ids=${station.id}&format=json&hours=${hours}`);
    const obs = (Array.isArray(list) ? list : []).map(parseMetar).filter(o => o.time && o.c != null && !o.special)
      .sort((a, b) => a.time - b.time).map(o => [o.time, o.c, o.d, o.w, o.g, o.cl, o.pr]);
    if (!station.name && list[0]) Object.assign(station, { name: list[0].name, lat: list[0].lat, lon: list[0].lon, distKm: km(lat, lon, list[0].lat, list[0].lon) });
    res.setHeader("Cache-Control", "s-maxage=600, stale-while-revalidate=1200");
    return res.status(200).json({ station, obs });
  } catch (e) {
    return res.status(502).json({ error: e.message });
  }
}
