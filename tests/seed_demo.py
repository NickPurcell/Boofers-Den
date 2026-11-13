"""Seed a demo event for Find time to hang v2, with invented people only.

    python3 tests/seed_demo.py BASE_URL

Six invented players planning a game: a GM who must be there, four is enough, three-hour
sessions, loose weekly rules, a maybe, an away stretch, one day off, and one person who has not
filled in. Locks in the top best time as "Session 0". Prints the link and the creator key (the key
deletes it; keep it out of anything public).
"""
import datetime as dt
import json
import sys
import urllib.request
from zoneinfo import ZoneInfo

BASE = sys.argv[1].rstrip("/")


def post(body):
    req = urllib.request.Request(BASE + "/api/hangout", data=json.dumps(body).encode(), headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


today = dt.datetime.now(ZoneInfo("America/Chicago")).date()
nxt = lambda d, wd: d + dt.timedelta(days=(wd - d.weekday()) % 7)  # noqa: E731  Monday 0 .. Sunday 6
thu = nxt(today + dt.timedelta(days=7), 3)
sat = nxt(today + dt.timedelta(days=1), 5)

ev = post({"action": "create", "name": "Space game (demo)", "tz": "America/Chicago", "len": 180, "quorum": 4,
           "roster": [{"name": "Avery", "req": True}, "Blake", "Cam", "Dana", "Emery", "Finley"]})
eid = ev["id"]
WKN, ALL = [1, 2, 3, 4, 5], [0, 1, 2, 3, 4, 5, 6]
people = [
    {"name": "Avery", "tz": "America/Chicago", "rules": [{"wd": WKN, "from": "20:30", "lvl": "yes"}, {"wd": [5, 6], "from": "18:00", "lvl": "yes"}], "days": []},
    {"name": "Blake", "tz": "America/New_York", "rules": [{"wd": [0, 6], "lvl": "yes"}, {"wd": WKN, "from": "20:00", "lvl": "maybe"}], "days": []},
    {"name": "Cam", "tz": "America/Chicago", "rules": [{"wd": ALL, "from": "21:00", "lvl": "yes"}],
     "days": [{"d1": thu.isoformat(), "d2": (thu + dt.timedelta(days=3)).isoformat(), "kind": "away"}]},
    {"name": "Dana", "tz": "America/Los_Angeles", "rules": [{"wd": [5, 6], "from": "17:00", "to": "23:00", "lvl": "yes"}, {"wd": [0], "from": "12:00", "to": "18:00", "lvl": "maybe"}], "days": []},
    {"name": "Emery", "tz": "America/Chicago", "rules": [{"wd": [0, 6], "lvl": "yes"}, {"wd": [3], "from": "19:00", "to": "23:00", "lvl": "maybe"}],
     "days": [{"d1": sat.isoformat(), "kind": "away"}]},
]
for p in people:
    out = post(dict(p, action="me", id=eid))
# lock in the best time the page would show first: work it out with the engine the page uses
import subprocess  # noqa: E402
js = r"""
const E = require('./hang/engine.js');
const d = JSON.parse(require('fs').readFileSync(0, 'utf8'));
const now = Date.now(), t0 = now - (now % (15 * 60000)), t1 = t0 + 56 * 86400000;
const ans = d.people.filter(E.answered);
const A = E.analyze(ans, { t0, t1: t1 + d.event.len * 60000, len: d.event.len, count: ans.map((p) => p.name),
  required: d.event.roster.filter((r) => r.req).map((r) => r.name), quorum: d.event.quorum, now });
const w = E.bestTimes(A, { tz: d.event.tz }).windows[0];
process.stdout.write(JSON.stringify(w ? { start: w.best, end: w.best + d.event.len * 60000 } : null));
"""
best = json.loads(subprocess.run(["node", "-e", js], input=json.dumps(out), capture_output=True, text=True, check=True).stdout)
if best:
    post({"action": "lock", "id": eid, "start": best["start"], "end": best["end"], "label": "Session 0"})
print(json.dumps({"url": f"{BASE}/hang/{eid}", "id": eid, "key": ev["key"], "locked": best}))
