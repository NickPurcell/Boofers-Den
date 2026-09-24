# Playtest tools

Headless playtests for Five Nights at Claudie's. Serve the repo root first
(`python3 -m http.server 8765`), then run with Python Playwright + Chromium.

- `sim.py [trials] [nights]` — a bot plays whole nights through the `?debug` hooks
  (it only acts on what a player could see: hall lights, the camera it is viewing,
  the bang it hears) and reports wins, deaths and which mechanics fired.
- `mech.py` — scripted scenarios: every animatronic's attack, CAPTCHA's bang,
  power-out, 6 AM rescue, the golden entity.
- `shots.py` — screenshots of every room and screen to `/tmp/claudies_*.png`.
- `perf.py` — frame times in the office and on cameras.

The `?debug` hooks (`window.__claudies`) only exist when the URL has `?debug`.
