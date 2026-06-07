"""
WeatherAI Dashboard — FastAPI backend.

Acts as a thin, cached proxy in front of the WeatherAI API so that:
  * the API key never reaches the browser (it lives only in server env vars),
  * repeated requests for the same location are served from an in-memory
    TTL cache, which keeps us comfortably inside the free-tier quota.
"""

from __future__ import annotations

import os
import time
from typing import Any

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from starlette.requests import Request

# Load variables from a local .env file if present. On hosted platforms
# (Render/Railway) the real env vars take precedence and no .env is needed.
load_dotenv()

# --------------------------------------------------------------------------- #
# Configuration
# --------------------------------------------------------------------------- #

WEATHER_API_BASE = os.getenv("WEATHER_API_BASE", "https://api.weather-ai.co")
WEATHER_API_KEY = os.getenv("WEATHER_API_KEY", "")
# How long (seconds) to keep a successful response cached. Default 10 min.
CACHE_TTL = int(os.getenv("CACHE_TTL_SECONDS", "600"))
REQUEST_TIMEOUT = float(os.getenv("REQUEST_TIMEOUT_SECONDS", "12"))

app = FastAPI(
    title="WeatherAI Dashboard",
    description="A small dashboard over the WeatherAI API for Weather overview.",
    version="1.0.0",
)

app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")

# --------------------------------------------------------------------------- #
# Tiny in-memory TTL cache (no external dependency needed)
# --------------------------------------------------------------------------- #

_cache: dict[str, tuple[float, Any]] = {}


def cache_get(key: str) -> Any | None:
    entry = _cache.get(key)
    if entry is None:
        return None
    expires_at, value = entry
    if time.time() > expires_at:
        _cache.pop(key, None)
        return None
    return value


def cache_set(key: str, value: Any) -> None:
    _cache[key] = (time.time() + CACHE_TTL, value)


# --------------------------------------------------------------------------- #
# Upstream client
# --------------------------------------------------------------------------- #

async def fetch_weather(
    lat: float,
    lon: float,
    days: int,
    units: str,
    ai: bool,
    lang: str,
) -> dict[str, Any]:
    """Call the upstream WeatherAI endpoint, with caching + clean errors."""
    if not WEATHER_API_KEY:
        raise HTTPException(
            status_code=500,
            detail="Server is missing WEATHER_API_KEY. Set it in your environment.",
        )

    cache_key = f"{lat}:{lon}:{days}:{units}:{ai}:{lang}"
    cached = cache_get(cache_key)
    if cached is not None:
        return {**cached, "_cached": True}

    params = {
        "lat": lat,
        "lon": lon,
        "days": days,
        "units": units,
        "ai": str(ai).lower(),
        "lang": lang,
    }
    headers = {"Authorization": f"Bearer {WEATHER_API_KEY}"}

    try:
        async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT) as client:
            resp = await client.get(
                f"{WEATHER_API_BASE}/v1/weather",
                params=params,
                headers=headers,
            )
    except httpx.RequestError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Could not reach the weather service: {exc}",
        ) from exc

    if resp.status_code == 401:
        raise HTTPException(status_code=502, detail="Upstream rejected the API key (401).")
    if resp.status_code == 429:
        raise HTTPException(
            status_code=429,
            detail="Monthly quota exceeded upstream. Try again after the reset window.",
        )
    if resp.status_code >= 400:
        raise HTTPException(
            status_code=502,
            detail=f"Upstream error {resp.status_code}: {resp.text[:200]}",
        )

    data = resp.json()
    cache_set(cache_key, data)
    return {**data, "_cached": False}


# --------------------------------------------------------------------------- #
# Routes
# --------------------------------------------------------------------------- #

@app.get("/", response_class=HTMLResponse)
async def index(request: Request) -> HTMLResponse:
    """Serve the single-page dashboard."""
    return templates.TemplateResponse(request, "index.html")


@app.get("/api/weather")
async def api_weather(
    lat: float = Query(..., description="Latitude, e.g. -1.2921"),
    lon: float = Query(..., description="Longitude, e.g. 36.8219"),
    days: int = Query(5, ge=1, le=7, description="Forecast days (free tier max 7)"),
    units: str = Query("metric", pattern="^(metric|imperial)$"),
    ai: bool = Query(True, description="Include AI summary"),
    lang: str = Query("en", description="AI summary language code"),
) -> dict[str, Any]:
    """Public JSON endpoint the frontend talks to. The key stays server-side."""
    return await fetch_weather(lat, lon, days, units, ai, lang)


@app.get("/health")
async def health() -> dict[str, str]:
    """Lightweight health check for the deploy platform."""
    return {"status": "ok"}
