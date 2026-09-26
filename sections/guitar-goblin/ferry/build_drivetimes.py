#!/usr/bin/env python3
"""Precompute city -> ferry terminal and city -> downtown Napa drive times.

Reads places.json and terminals.json, asks the public OSRM demo router
(router.project-osrm.org, car profile) for a duration/distance matrix, and
writes drivetimes.json. OSRM times are free-flow: no traffic, no parking.

The demo server allows 100 coordinates per table request and asks for light
use, so the places are sent in chunks with a pause between requests. Rerun
this only when places.json or terminals.json change:

    python3 build_drivetimes.py
"""
import json, time, urllib.request
from pathlib import Path

HERE = Path(__file__).parent
OSRM = "https://router.project-osrm.org/table/v1/driving/"
UA = "boofers-den-ferry-map/1.0 (github.com/NickPurcell/Boofers-Den)"
CHUNK = 40      # places per request; + destinations stays well under 100
PAUSE = 2.0     # seconds between requests

places = json.loads((HERE / "places.json").read_text())["places"]
t = json.loads((HERE / "terminals.json").read_text())
dests = t["terminals"] + [t["napa"]]


def table(srcs):
    coords = srcs + dests
    path = ";".join(f"{c['lon']},{c['lat']}" for c in coords)
    src_idx = ";".join(str(i) for i in range(len(srcs)))
    dst_idx = ";".join(str(len(srcs) + i) for i in range(len(dests)))
    url = f"{OSRM}{path}?sources={src_idx}&destinations={dst_idx}&annotations=duration,distance"
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    for attempt in range(4):
        try:
            data = json.load(urllib.request.urlopen(req, timeout=60))
            if data.get("code") == "Ok":
                return data
            raise RuntimeError(data.get("code"))
        except Exception as e:  # noqa: BLE001
            print("  retry after", e)
            time.sleep(5 * (attempt + 1))
    raise SystemExit("OSRM request kept failing")


out = {}
snaps = {}
for i in range(0, len(places), CHUNK):
    chunk = places[i:i + CHUNK]
    print(f"places {i + 1}-{i + len(chunk)} of {len(places)}")
    data = table(chunk)
    for w, d in zip(data["destinations"], dests):
        snaps[d["id"]] = round(w["distance"])
    for row, (dur, dist) in enumerate(zip(data["durations"], data["distances"])):
        p = chunk[row]
        out[p["id"]] = {
            d["id"]: [None if s is None else round(s / 60, 1), None if m is None else round(m / 1000, 1)]
            for d, s, m in zip(dests, dur, dist)
        }
    time.sleep(PAUSE)

result = {
    "about": "Free-flow drive times from OSRM (car profile, OpenStreetMap data). "
             "Each entry is [minutes, km] from the place to the terminal or downtown Napa.",
    "source": "router.project-osrm.org",
    "generated": time.strftime("%Y-%m-%d"),
    "snapMeters": snaps,
    "times": out,
}
lines = ["{"]
for k in ("about", "source", "generated", "snapMeters"):
    lines.append(f' "{k}": {json.dumps(result[k], ensure_ascii=False)},')
lines.append(' "times": {')
lines.append(",\n".join(f'  "{k}": {json.dumps(v, separators=(",", ":"))}' for k, v in out.items()))
lines.append(" }")
lines.append("}")
(HERE / "drivetimes.json").write_text("\n".join(lines) + "\n")
print("wrote drivetimes.json;", "terminal snap distances (m):", snaps)
