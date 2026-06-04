"use strict";

const $ = (id) => document.getElementById(id);

const els = {
  city: $("city"),
  units: $("units"),
  refresh: $("refresh"),
  status: $("status"),
  current: $("current"),
  temp: $("temp"),
  condition: $("condition"),
  place: $("place"),
  humidity: $("humidity"),
  wind: $("wind"),
  feels: $("feels"),
  aiBox: $("ai-box"),
  aiSummary: $("ai-summary"),
  forecast: $("forecast"),
  cacheNote: $("cache-note"),
};

/**
 * The documented response shape isn't exhaustive, so we read fields
 * defensively: try a few likely key names and fall back gracefully.
 */
function pick(obj, keys, fallback = null) {
  if (!obj) return fallback;
  for (const k of keys) {
    const parts = k.split(".");
    let cur = obj;
    let ok = true;
    for (const p of parts) {
      if (cur && typeof cur === "object" && p in cur) {
        cur = cur[p];
      } else {
        ok = false;
        break;
      }
    }
    if (ok && cur !== undefined && cur !== null) return cur;
  }
  return fallback;
}

function unitSymbol() {
  return els.units.value === "imperial" ? "°F" : "°C";
}

function showStatus(message, isError = false) {
  els.status.hidden = false;
  els.status.textContent = message;
  els.status.classList.toggle("error", isError);
}

function clearStatus() {
  els.status.hidden = true;
  els.status.textContent = "";
  els.status.classList.remove("error");
}

async function geocode(query) {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`;
  const res = await fetch(url, { headers: { "Accept-Language": "en" } });
  if (!res.ok) throw new Error("Geocoding service unavailable.");
  const results = await res.json();
  if (!results.length) throw new Error(`Location "${query}" not found. Try a different name.`);
  return { lat: parseFloat(results[0].lat), lon: parseFloat(results[0].lon) };
}

async function loadWeather() {
  const query = els.city.value.trim();
  if (!query) {
    showStatus("Please enter a location.", true);
    return;
  }
  const units = els.units.value;

  els.refresh.disabled = true;
  showStatus("Looking up location…");

  try {
    const { lat, lon } = await geocode(query);
    showStatus("Loading weather…");

    const url = `/api/weather?lat=${lat}&lon=${lon}&units=${units}&days=5&ai=true`;
    const res = await fetch(url);
    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.detail || `Request failed (${res.status})`);
    }

    render(data, units);
    clearStatus();
  } catch (err) {
    showStatus(err.message || "Something went wrong.", true);
    els.current.hidden = true;
    els.aiBox.hidden = true;
    els.forecast.hidden = true;
  } finally {
    els.refresh.disabled = false;
  }
}

function render(data, units) {
  const sym = units === "imperial" ? "°F" : "°C";

  // --- Current conditions -------------------------------------------------
  const current = pick(data, ["current", "current_conditions", "now"], data);

  const temp = pick(current, ["temp", "temperature", "temp_c", "temp_f"]);
  const condition = pick(current, [
    "condition", "summary", "description", "weather", "text",
  ], "—");
  const humidity = pick(current, ["humidity", "humidity_pct"]);
  const wind = pick(current, ["wind", "wind_speed", "windSpeed"]);
  const feels = pick(current, ["feels_like", "feelsLike", "apparent_temp"]);

  const city = pick(data, ["location.city", "city", "place", "name"], "");
  const region = pick(data, ["location.region", "region", "country"], "");

  els.temp.textContent = temp !== null ? `${Math.round(temp)}${sym}` : "—";
  els.condition.textContent = condition;
  els.place.textContent = [city, region].filter(Boolean).join(", ") || "Selected location";
  els.humidity.textContent = humidity !== null ? `${humidity}%` : "—";
  els.wind.textContent = wind !== null ? `${wind}` : "—";
  els.feels.textContent = feels !== null ? `${Math.round(feels)}${sym}` : "—";
  els.current.hidden = false;

  // --- AI summary ---------------------------------------------------------
  const ai = pick(data, [
    "ai_summary", "aiSummary", "summary", "ai.summary", "insights",
  ]);
  if (ai && typeof ai === "string") {
    els.aiSummary.textContent = ai;
    els.aiBox.hidden = false;
  } else {
    els.aiBox.hidden = true;
  }

  // --- Forecast -----------------------------------------------------------
  const forecast = pick(data, [
    "forecast", "daily", "days", "forecast_days",
  ]);
  els.forecast.innerHTML = "";
  if (Array.isArray(forecast) && forecast.length) {
    forecast.slice(0, 7).forEach((day) => {
      const date = pick(day, ["date", "day", "datetime", "valid_date"], "");
      const hi = pick(day, ["max", "high", "temp_max", "max_temp"]);
      const lo = pick(day, ["min", "low", "temp_min", "min_temp"]);
      const cond = pick(day, ["condition", "summary", "description", "weather"], "");

      const card = document.createElement("div");
      card.className = "card day";
      card.innerHTML = `
        <div class="day-date">${formatDate(date)}</div>
        <div class="day-cond">${cond}</div>
        <div class="day-temps">
          <span class="hi">${hi !== null ? Math.round(hi) + sym : "—"}</span>
          <span class="lo">${lo !== null ? Math.round(lo) + sym : "—"}</span>
        </div>`;
      els.forecast.appendChild(card);
    });
    els.forecast.hidden = false;
  } else {
    els.forecast.hidden = true;
  }

  // --- Cache note ---------------------------------------------------------
  els.cacheNote.textContent = data._cached ? "Served from cache" : "Fresh from API";
}

function formatDate(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

els.refresh.addEventListener("click", loadWeather);
els.city.addEventListener("keydown", (e) => { if (e.key === "Enter") loadWeather(); });
els.units.addEventListener("change", loadWeather);

// Initial load
loadWeather();
