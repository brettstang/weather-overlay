# Weather Overlay

Every forecast model on one chart. Search any city or type coordinates (`35.47, -97.52` or `35.47N 97.52W`) and see hourly 2 m temperature from every Open-Meteo model overlaid — the same overlay system as Weather Scanner.

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
