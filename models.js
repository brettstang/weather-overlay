// Every Open-Meteo deterministic forecast model that has 2 m temperature.
// Regional models only return data inside their coverage area; the app hides
// any model that comes back empty for the chosen location.
// kind: "seamless" = provider's best mix of its global + regional runs,
//       "global", "regional", "ai" (machine-learning model).
window.MODELS = [
  // ECMWF
  { id: "ecmwf_ifs025",          short: "ECMWF",        name: "ECMWF IFS 0.25°",          provider: "ECMWF",             res: "25 km",  kind: "global",   color: "#4cc9f0", pat: 0 },
  { id: "ecmwf_ifs",             short: "ECMWF HRES",   name: "ECMWF IFS HRES 9 km",      provider: "ECMWF",             res: "9 km",   kind: "global",   color: "#0096c7", pat: 1 },
  { id: "ecmwf_aifs025_single",  short: "ECMWF AIFS",   name: "ECMWF AIFS (AI)",          provider: "ECMWF",             res: "25 km",  kind: "ai",       color: "#a2e3f5", pat: 2 },
  // NOAA / NCEP
  { id: "gfs_seamless",          short: "GFS",          name: "NCEP GFS Seamless",        provider: "NOAA NCEP",         res: "3–25 km", kind: "seamless", color: "#f72585", pat: 0 },
  { id: "gfs_global",            short: "GFS Global",   name: "NCEP GFS Global 0.11°",    provider: "NOAA NCEP",         res: "13 km",  kind: "global",   color: "#d1006b", pat: 1 },
  { id: "gfs_hrrr",              short: "HRRR",         name: "NCEP HRRR (U.S.)",         provider: "NOAA NCEP",         res: "3 km",   kind: "regional", color: "#ff7eb6", pat: 4 },
  { id: "ncep_nbm_conus",        short: "NBM",          name: "NCEP NBM (U.S.)",          provider: "NOAA NCEP",         res: "3 km",   kind: "regional", color: "#ffb3d1", pat: 3 },
  { id: "ncep_nam_conus",        short: "NAM",          name: "NCEP NAM (U.S.)",          provider: "NOAA NCEP",         res: "3 km",   kind: "regional", color: "#c9184a", pat: 6 },
  { id: "gfs_graphcast025",      short: "GraphCast",    name: "GFS GraphCast (AI)",       provider: "NOAA NCEP",         res: "25 km",  kind: "ai",       color: "#e879f9", pat: 2 },
  { id: "ncep_aigfs025",         short: "AIGFS",        name: "NCEP AIGFS (AI)",          provider: "NOAA NCEP",         res: "25 km",  kind: "ai",       color: "#f0abfc", pat: 5 },
  // Environment Canada
  { id: "gem_seamless",          short: "GEM",          name: "GEM Seamless",             provider: "Env. Canada",       res: "2.5–15 km", kind: "seamless", color: "#ffd166", pat: 0 },
  { id: "gem_global",            short: "GEM Global",   name: "GEM Global",               provider: "Env. Canada",       res: "15 km",  kind: "global",   color: "#e9b949", pat: 1 },
  { id: "gem_regional",          short: "GEM Reg",      name: "GEM Regional",             provider: "Env. Canada",       res: "10 km",  kind: "regional", color: "#ffe39a", pat: 4 },
  { id: "gem_hrdps_continental", short: "HRDPS",        name: "GEM HRDPS Continental",    provider: "Env. Canada",       res: "2.5 km", kind: "regional", color: "#fff1c1", pat: 3 },
  { id: "gem_hrdps_west",        short: "HRDPS West",   name: "GEM HRDPS West",           provider: "Env. Canada",       res: "1 km",   kind: "regional", color: "#d4a72c", pat: 2 },
  // DWD
  { id: "icon_seamless",         short: "ICON",         name: "DWD ICON Seamless",        provider: "DWD Germany",       res: "2–11 km", kind: "seamless", color: "#b388ff", pat: 0 },
  { id: "icon_global",           short: "ICON Global",  name: "DWD ICON Global",          provider: "DWD Germany",       res: "11 km",  kind: "global",   color: "#9d4edd", pat: 1 },
  { id: "icon_eu",               short: "ICON-EU",      name: "DWD ICON-EU",              provider: "DWD Germany",       res: "7 km",   kind: "regional", color: "#c9a7ff", pat: 4 },
  { id: "icon_d2",               short: "ICON-D2",      name: "DWD ICON-D2",              provider: "DWD Germany",       res: "2 km",   kind: "regional", color: "#e4d4ff", pat: 3 },
  // UK Met Office
  { id: "ukmo_seamless",         short: "UKMO",         name: "UK Met Office Seamless",   provider: "UK Met Office",     res: "2–10 km", kind: "seamless", color: "#ff9f43", pat: 0 },
  { id: "ukmo_global_deterministic_10km", short: "UKMO Global", name: "UKMO Global 10 km", provider: "UK Met Office",    res: "10 km",  kind: "global",   color: "#f77f00", pat: 1 },
  { id: "ukmo_uk_deterministic_2km",      short: "UKV",         name: "UKMO UK 2 km",      provider: "UK Met Office",    res: "2 km",   kind: "regional", color: "#ffc285", pat: 4 },
  // Météo-France
  { id: "meteofrance_seamless",       short: "Météo-Fr",    name: "Météo-France Seamless",  provider: "Météo-France",    res: "1.5–25 km", kind: "seamless", color: "#2ec4b6", pat: 0 },
  { id: "meteofrance_arpege_world",   short: "ARPEGE",      name: "ARPEGE World",           provider: "Météo-France",    res: "25 km",  kind: "global",   color: "#1a9e92", pat: 1 },
  { id: "meteofrance_arpege_europe",  short: "ARPEGE EU",   name: "ARPEGE Europe",          provider: "Météo-France",    res: "11 km",  kind: "regional", color: "#5fd8cc", pat: 4 },
  { id: "meteofrance_arome_france",   short: "AROME",       name: "AROME France",           provider: "Météo-France",    res: "2.5 km", kind: "regional", color: "#8ee6dd", pat: 3 },
  { id: "meteofrance_arome_france_hd",short: "AROME HD",    name: "AROME France HD",        provider: "Météo-France",    res: "1.5 km", kind: "regional", color: "#c0f2ec", pat: 2 },
  // JMA
  { id: "jma_seamless",          short: "JMA",          name: "JMA Seamless",             provider: "JMA Japan",         res: "5–55 km", kind: "seamless", color: "#ff6b6b", pat: 0 },
  { id: "jma_gsm",               short: "JMA GSM",      name: "JMA GSM",                  provider: "JMA Japan",         res: "55 km",  kind: "global",   color: "#e03131", pat: 1 },
  { id: "jma_msm",               short: "JMA MSM",      name: "JMA MSM",                  provider: "JMA Japan",         res: "5 km",   kind: "regional", color: "#ffa8a8", pat: 4 },
  // KMA
  { id: "kma_seamless",          short: "KMA",          name: "KMA Seamless",             provider: "KMA Korea",         res: "1.5–12 km", kind: "seamless", color: "#a3e635", pat: 0 },
  { id: "kma_gdps",              short: "KMA GDPS",     name: "KMA GDPS",                 provider: "KMA Korea",         res: "12 km",  kind: "global",   color: "#7cb518", pat: 1 },
  { id: "kma_ldps",              short: "KMA LDPS",     name: "KMA LDPS",                 provider: "KMA Korea",         res: "1.5 km", kind: "regional", color: "#d9f99d", pat: 4 },
  // Others — global
  { id: "cma_grapes_global",     short: "CMA",          name: "CMA GRAPES Global",        provider: "CMA China",         res: "15 km",  kind: "global",   color: "#d4a373", pat: 0 },
  { id: "bom_access_global",     short: "BOM",          name: "BOM ACCESS-G",             provider: "BOM Australia",     res: "15 km",  kind: "global",   color: "#818cf8", pat: 0 },
  // Others — European regional
  { id: "metno_seamless",        short: "MET Norway",   name: "MET Norway Seamless",      provider: "MET Norway",        res: "1–25 km", kind: "seamless", color: "#94a3b8", pat: 0 },
  { id: "metno_nordic",          short: "MET Nordic",   name: "MET Nordic",               provider: "MET Norway",        res: "1 km",   kind: "regional", color: "#cbd5e1", pat: 4 },
  { id: "knmi_seamless",         short: "KNMI",         name: "KNMI Seamless",            provider: "KNMI Netherlands",  res: "2–5.5 km", kind: "seamless", color: "#e76f51", pat: 0 },
  { id: "knmi_harmonie_arome_europe",      short: "KNMI EU", name: "KNMI HARMONIE Europe", provider: "KNMI Netherlands", res: "5.5 km", kind: "regional", color: "#f4a261", pat: 1 },
  { id: "knmi_harmonie_arome_netherlands", short: "KNMI NL", name: "KNMI HARMONIE NL",     provider: "KNMI Netherlands", res: "2 km",   kind: "regional", color: "#ffcdb2", pat: 4 },
  { id: "dmi_seamless",          short: "DMI",          name: "DMI Seamless",             provider: "DMI Denmark",       res: "2 km",   kind: "seamless", color: "#5eead4", pat: 0 },
  { id: "dmi_harmonie_arome_europe", short: "DMI EU",   name: "DMI HARMONIE Europe",      provider: "DMI Denmark",       res: "2 km",   kind: "regional", color: "#a7f3e7", pat: 4 },
  { id: "italia_meteo_arpae_icon_2i", short: "ItaliaMeteo", name: "ItaliaMeteo ICON-2I",  provider: "ItaliaMeteo",       res: "2 km",   kind: "regional", color: "#4ade80", pat: 0 },
  { id: "meteoswiss_icon_ch1",   short: "ICON-CH1",     name: "MeteoSwiss ICON-CH1",      provider: "MeteoSwiss",        res: "1 km",   kind: "regional", color: "#f43f5e", pat: 0 },
  { id: "meteoswiss_icon_ch2",   short: "ICON-CH2",     name: "MeteoSwiss ICON-CH2",      provider: "MeteoSwiss",        res: "2 km",   kind: "regional", color: "#fda4af", pat: 4 },
];

// The same seven models the Weather Scanner overlays.
window.CORE_MODELS = ["ecmwf_ifs025", "gfs_seamless", "gem_seamless", "icon_seamless", "ukmo_seamless", "meteofrance_seamless", "jma_seamless"];

// Line pattern per model so sister models (same colour family) stay distinguishable:
// 0 solid · 1 long dash · 2 dotted · 3 dash-dot · 4 short dash · 5 sparse dots · 6 dash-dot-dot
window.MODEL_DASH = ["", "9 4", "2 3", "10 3 2 3", "5 3", "1.5 5", "12 3 2 3 2 3"];
