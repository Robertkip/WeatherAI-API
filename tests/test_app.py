"""Basic test suite. Run with: pytest"""
from fastapi.testclient import TestClient
import app.main as m

client = TestClient(m.app)


def test_healthz():
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_index_renders():
    r = client.get("/")
    assert r.status_code == 200
    assert "WeatherAI Dashboard" in r.text


def test_missing_key_is_graceful():
    original = m.WEATHER_API_KEY
    m.WEATHER_API_KEY = ""
    try:
        r = client.get("/api/weather?lat=-1.29&lon=36.82")
        assert r.status_code == 500
    finally:
        m.WEATHER_API_KEY = original


def test_invalid_units_rejected():
    r = client.get("/api/weather?lat=-1.29&lon=36.82&units=kelvin")
    assert r.status_code == 422


def test_cache_roundtrip():
    m.cache_set("k", {"v": 1})
    assert m.cache_get("k") == {"v": 1}
    assert m.cache_get("absent") is None
