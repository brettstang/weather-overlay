# Weather Overlay

Every forecast model on one chart. Search any city or type coordinates (`35.47, -97.52` or `35.47N 97.52W`).

**Overview** — a stacked meteogram (like SpotWx) on one shared time axis: Temperature & humidity (temp, dew point, feels like, RH, observed), Precipitation & cloud (hourly bars coloured by rain/snow/mix, running totals, cloud cover), Wind & pressure (wind, gusts, direction arrows, sea-level pressure, observed), CAPE & helicity. Source = average of your models (shaded range) or any single model; 2–10 days; drag any chart to read every panel at that hour.

**Tabs** (each with the overlay chart, readout and daily table): Temperature · Feels like · Dew point · Cloud · Precipitation (total / hourly / snow, with a rain-snow-mix type strip) · Wind (sustained / gusts, with direction) · CAPE · Helicity.

Helicity: Open-Meteo doesn't publish model helicity, so the app estimates 0–3 km storm-relative helicity (Bunkers right-mover) from each model's pressure-level winds, next 8 days.

## What's in it
- **45 models** (`models.js`): ECMWF IFS / HRES / AIFS, GFS, HRRR, NBM, NAM, GraphCast, GEM / HRDPS, ICON / ICON-EU / ICON-D2, UKMO, Météo-France ARPEGE / AROME, JMA, KMA, CMA, BOM, MET Norway, KNMI, DMI, ItaliaMeteo, MeteoSwiss. Regional models appear only where they have coverage. If Open-Meteo rejects a model id, the app drops it and retries automatically.
- Circles mark the day's high and low of the shown models' average.
- **Spread band** = min–max of the models shown.
- Tap/drag the chart for every model's value at that hour, plus mean and spread.
- Tap a model to highlight it; tap its dot to hide/show it. Presets: Core 7 (Weather Scanner's set), Global, High-res, All.
- 1 / 3 / 7 / 16-day views, including the past 3 days.
- Daily high/low table for every model, with model mean and spread.
- Reference lines (e.g. market bucket edges) and °C / °F.
- Full-screen chart, drawn sideways on a phone held upright.
- Installable to the home screen (manifest + service worker). Shareable links: `/?lat=..&lon=..&name=..`.

## Files
`index.html`, `styles.css`, `app.js`, `models.js`, `manifest.json`, `sw.js`, `icons/`, `vercel.json`. Pure static site, no build step, no server code — the browser calls Open-Meteo directly.

## Deploy (same as Weather Scanner)
1. Create a new GitHub repo, e.g. `weather-overlay`, and upload these files to its root.
2. In Vercel: **Add New → Project → import the repo → Deploy** (no settings needed).
3. On iPhone, open the site in Safari → Share → **Add to Home Screen**.

Run locally: `npx serve .` (or any static server) and open http://localhost:3000.

## Before charging subscriptions
Open-Meteo's free API is for **non-commercial use**. A paid product needs an Open-Meteo API subscription (then use `customer-api.open-meteo.com` with `&apikey=` in `app.js`), and keep the CC BY 4.0 attribution in the footer. Accounts and payments (e.g. Stripe + Supabase/Clerk) can be added later without changing the chart code.

## Observations & model bias
`api/obs.js` (Vercel serverless function) finds the nearest METAR airport and returns its ROUTINE reports for the last ~4 days from aviationweather.gov — the same source and parsing (precise T-group temps) as Weather Scanner. On the Temp and Dew point tabs, past days show:
- the observed line (white) on the chart and an "Observed" row in the table,
- each model's high/low bias in brackets, e.g. `17.9° (+1.7)`, plus an average-bias column,
- and the Overview ranks models by average error.

Past-day model values come from Open-Meteo's Previous Runs API (`temperature_2m_previous_day1` etc.), so the bias scores the forecast made 1 day before (changeable to 2, 3 days or latest run in Chart options).

## Custom tab
Pick up to 5 parameters and up to 6 models to overlay together. **Colour = parameter, line pattern = model** (solid, dashed, dotted, dash-dot…); gusts are dots with a different marker shape per model. Parameters with different units get left/right axes; more than two unit types stack into panels on a shared time axis. "Average" mode draws one line per parameter with the models' range shaded.
