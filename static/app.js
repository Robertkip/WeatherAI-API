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

function getWeatherIcon(conditionText) {
  if (!conditionText || conditionText === "—") return "";
  const t = conditionText.toLowerCase();
  if (t.includes("thunder") || t.includes("storm")) return "⛈";
  if (t.includes("drizzle") || t.includes("light rain") || t.includes("partly rain") || t.includes("partial rain") || t.includes("light shower")) return "🌦";
  if (t.includes("heavy rain") || t.includes("downpour")) return "🌧";
  if (t.includes("rain") || t.includes("shower")) return "🌧";
  if (t.includes("snow") || t.includes("blizzard") || t.includes("sleet")) return "🌨";
  if (t.includes("fog") || t.includes("mist") || t.includes("haze")) return "🌫";
  if (t.includes("partly cloudy") || t.includes("mostly cloudy") || t.includes("scattered cloud")) return "⛅";
  if (t.includes("overcast") || t.includes("cloudy")) return "☁";
  if (t.includes("clear") || t.includes("sunny") || t.includes("fair") || t.includes("mainly clear")) return "☀";
  if (t.includes("wind") || t.includes("breezy")) return "💨";
  return "🌡";
}

// Extract human-readable condition from icon URL, e.g.
// "https://cdn.weather-ai.co/icons/default/53_drizzle_moderate_day.svg" → "Drizzle Moderate"
function conditionFromIcon(iconUrl) {
  if (!iconUrl) return null;
  const filename = iconUrl.split("/").pop().replace(".svg", "");
  const parts = filename.split("_").slice(1); // strip leading WMO code number
  if (parts[parts.length - 1] === "day" || parts[parts.length - 1] === "night") {
    parts.pop();
  }
  return parts.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

function render(data, units) {
  const sym = units === "imperial" ? "°F" : "°C";

  // --- Current conditions -------------------------------------------------
  const current = pick(data, ["current", "current_conditions", "now"], data);

  const temp = pick(current, ["temp", "temperature", "temp_c", "temp_f"]);

  // Condition text lives in the icon filename, e.g. "53_drizzle_moderate_day.svg"
  const conditionText = pick(current, [
    "condition", "condition.text", "summary", "description",
    "weather", "weather_description", "text", "weather_text",
    "sky_condition", "sky", "status",
  ]);
  const iconUrl = pick(current, ["icon", "icon_url", "weather_icon"]);
  const condition = conditionText || conditionFromIcon(iconUrl) || "—";

  // humidity & feels_like are in the hourly array, not current
  const hourly = pick(data, ["hourly"], []);
  const currentTime = pick(current, ["time"], "");
  let currentHour = null;
  if (Array.isArray(hourly) && currentTime) {
    const prefix = currentTime.substring(0, 13); // "YYYY-MM-DDTHH"
    currentHour = hourly.find((h) => (h.time || "").startsWith(prefix)) || hourly[0];
  }

  const humidity = pick(currentHour || current, ["humidity", "humidity_pct"]);
  const wind = pick(current, ["wind", "wind_speed", "windSpeed"]);
  const feels = pick(currentHour || current, ["feels_like", "feelsLike", "apparent_temp"]);

  const city = pick(data, ["location.city", "city", "place", "name"], "");
  const region = pick(data, ["location.region", "region", "country"], "");

  els.temp.textContent = temp !== null ? `${Math.round(temp)}${sym}` : "—";

  const icon = getWeatherIcon(condition);
  els.condition.textContent = condition !== "—" && icon
    ? `${icon} ${condition}`
    : condition;
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
      const condText = pick(day, ["condition", "condition.text", "summary", "description", "weather", "weather_description", "text"]);
      const dayIconUrl = pick(day, ["icon", "icon_url", "weather_icon"]);
      const cond = condText || conditionFromIcon(dayIconUrl) || "";
      const dayIcon = getWeatherIcon(cond);

      const card = document.createElement("div");
      card.className = "card day";
      card.innerHTML = `
        <div class="day-date">${formatDate(date)}</div>
        <div class="day-cond">${dayIcon ? `<span class="day-icon">${dayIcon}</span>` : ""}${cond}</div>
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
