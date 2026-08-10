"""Backend tests for COSMIC WEAVER STUDIO API."""
import os
import pytest
import requests

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://mocap-preview-studio.preview.emergentagent.com').rstrip('/')
API = f"{BASE_URL}/api"


@pytest.fixture(scope="session")
def client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


# ---------- Root ----------
def test_root(client):
    r = client.get(f"{API}/")
    assert r.status_code == 200
    d = r.json()
    assert "COSMIC WEAVER STUDIO ONLINE" in d.get("message", "")
    assert d.get("status") == "transmitting"


# ---------- Takes CRUD ----------
def test_takes_crud_and_persistence(client):
    # baseline count
    r0 = client.get(f"{API}/takes")
    assert r0.status_code == 200
    baseline = len(r0.json())

    payload = {
        "name": "TEST_take_001",
        "transmission": 1,
        "world": "red-planet",
        "duration": 6.25,
        "size": 123456,
        "mime": "video/webm"
    }
    rc = client.post(f"{API}/takes", json=payload)
    assert rc.status_code == 200, rc.text
    take = rc.json()
    assert take["name"] == payload["name"]
    assert take["transmission"] == 1
    assert take["world"] == "red-planet"
    assert take["duration"] == 6.25
    assert take["size"] == 123456
    assert take["mime"] == "video/webm"
    assert "id" in take and isinstance(take["id"], str) and len(take["id"]) > 0
    assert "created_at" in take
    tid = take["id"]

    # list should contain it
    rl = client.get(f"{API}/takes")
    assert rl.status_code == 200
    items = rl.json()
    assert len(items) == baseline + 1
    assert any(x["id"] == tid for x in items)

    # delete
    rd = client.delete(f"{API}/takes/{tid}")
    assert rd.status_code == 200
    assert rd.json().get("deleted") == tid

    # gone
    rl2 = client.get(f"{API}/takes")
    assert not any(x["id"] == tid for x in rl2.json())


def test_delete_unknown_take_returns_404(client):
    r = client.delete(f"{API}/takes/does-not-exist-xyz")
    assert r.status_code == 404


# ---------- Progress ----------
def test_progress_upsert_and_get(client):
    # set 5 recorded
    r1 = client.post(f"{API}/progress/5", json={"recorded": True})
    assert r1.status_code == 200
    body = r1.json()
    assert body["number"] == 5 and body["recorded"] is True

    r2 = client.get(f"{API}/progress")
    assert r2.status_code == 200
    prog = r2.json()
    assert prog.get("5") is True

    # toggle off (cleanup)
    r3 = client.post(f"{API}/progress/5", json={"recorded": False})
    assert r3.status_code == 200
    assert r3.json()["recorded"] is False


# ---------- Stats ----------
def test_stats_shape(client):
    r = client.get(f"{API}/stats")
    assert r.status_code == 200
    d = r.json()
    for k in ("takes", "scriptsRecorded", "totalDuration"):
        assert k in d
    assert isinstance(d["takes"], int)
    assert isinstance(d["scriptsRecorded"], int)
    assert isinstance(d["totalDuration"], (int, float))


def test_stats_reflects_new_take(client):
    r0 = client.get(f"{API}/stats")
    base = r0.json()

    rc = client.post(f"{API}/takes", json={
        "name": "TEST_stats_take", "transmission": 2, "world": "nebula-drift",
        "duration": 4.5, "size": 1000, "mime": "video/webm"
    })
    assert rc.status_code == 200
    tid = rc.json()["id"]

    r1 = client.get(f"{API}/stats")
    after = r1.json()
    assert after["takes"] == base["takes"] + 1
    assert round(after["totalDuration"] - base["totalDuration"], 2) == 4.5

    # cleanup
    client.delete(f"{API}/takes/{tid}")
