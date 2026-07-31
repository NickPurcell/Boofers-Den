#!/usr/bin/env python3
"""Generate an accurately scaled floor plan for the Backrooms walkthrough.

Everything is defined in feet and converted once, at the end, so the drawing
cannot drift from the numbers quoted beside it. Path length is measured off the
actual centreline rather than estimated, which matters: dwell time is the whole
product, and it is a function of how far someone walks.

Layout is a serpentine — the cheapest way to buy path length in a small box —
interrupted by three wider rooms. The rooms are where people stop to take
photographs, so they are deliberately placed off the main run rather than in it,
which keeps a stopped group from blocking the corridor behind them.
"""

from __future__ import annotations
import math

FT = 9.0          # px per foot
W, H = 80.0, 75.0  # the leased box, 6,000 sf
CORR = 5.0         # corridor width, ft — see note on egress below
PITCH = 10.0       # corridor + wall, ft

# Walkable rectangles, in feet, origin bottom-left. (x, y, w, h, kind, label)
rects: list[tuple] = []
# Serpentine rows. Alternate rows stop short to leave room for the link.
rows = [
    (0.0,  0.0, 62.0, "corridor"),
    (18.0, 10.0, 62.0, "corridor"),
    (0.0,  20.0, 62.0, "corridor"),
    (18.0, 30.0, 62.0, "corridor"),
    (0.0,  40.0, 62.0, "corridor"),
    (18.0, 50.0, 62.0, "corridor"),
    (0.0,  60.0, 62.0, "corridor"),
    (18.0, 70.0, 62.0, "corridor"),
]
for x, y, w, kind in rows:
    rects.append((x, y, w, CORR, kind, ""))

# Vertical links joining the runs, alternating ends.
links = [
    (57.0, 0.0,  CORR, 15.0),   # right end, row0 -> row1
    (18.0, 10.0, CORR, 15.0),   # left,      row1 -> row2
    (57.0, 20.0, CORR, 15.0),
    (18.0, 30.0, CORR, 15.0),
    (57.0, 40.0, CORR, 15.0),
    (18.0, 50.0, CORR, 15.0),
    (57.0, 60.0, CORR, 15.0),
]
for x, y, w, h in links:
    rects.append((x, y, w, h, "corridor", ""))

# Rooms, hung off the serpentine so a stopped group does not plug the run.
# Each room overlaps the corridor row it opens off, so it is reachable without
# a separate doorway rectangle. It then extends into the dead wall band above,
# which is otherwise wasted floor.
rooms = [
    (0.0,  0.0,  16.0, 18.0, "The Pool Room"),
    (64.0, 20.0, 16.0, 18.0, "Fluorescent Hall"),
    (0.0,  40.0, 16.0, 18.0, "The Repeat"),
]
for x, y, w, h, label in rooms:
    rects.append((x, y, w, h, "room", label))

# Entry and exit vestibules.
rects.append((62.0, 0.0, 18.0, 5.0, "vestibule", "ENTRY"))
rects.append((0.0, 70.0, 18.0, 5.0, "vestibule", "EXIT"))

# Centreline the visitor actually walks, in feet.
path: list[tuple[float, float]] = [
    (71.0, 2.5),                                  # entry vestibule
    (8.0, 2.5),   (8.0, 14.0),  (8.0, 2.5),       # west, up into Pool Room, back
    (59.5, 2.5),  (59.5, 12.5),                   # east, link up
    (20.5, 12.5), (20.5, 22.5),                   # west, link up
    (59.5, 22.5), (59.5, 32.5),                   # east, link up
    (72.0, 32.5), (72.0, 36.0), (72.0, 32.5),     # into Fluorescent Hall, back
    (20.5, 32.5), (20.5, 42.5),                   # west, link up
    (8.0, 42.5),  (8.0, 54.0),   (8.0, 42.5),     # into The Repeat, back
    (59.5, 42.5), (59.5, 52.5),                   # east, link up
    (20.5, 52.5), (20.5, 62.5),                   # west, link up
    (59.5, 62.5), (59.5, 72.5),                   # east, link up
    (9.0, 72.5),                                  # west to the exit
]


def length(pts) -> float:
    return sum(math.dist(pts[i], pts[i + 1]) for i in range(len(pts) - 1))


walk = length(path)
area = W * H
corridor_area = sum(r[2] * r[3] for r in rects if r[4] == "corridor")
room_area = sum(r[2] * r[3] for r in rects if r[4] == "room")

print(f"  box              {W:.0f} x {H:.0f} ft = {area:,.0f} sf")
print(f"  walkable         {corridor_area + room_area:,.0f} sf "
      f"({(corridor_area + room_area) / area * 100:.0f}% of the floor)")
print(f"  path centreline  {walk:,.0f} ft")
for speed, label in [(0.75, "strolling, few stops"), (0.55, "with photo stops"), (0.40, "lingering")]:
    print(f"    at {speed} ft/s ({label}): {walk / speed / 60:.1f} min")
print()

# ---- SVG ----------------------------------------------------------------
PAD = 46
sw, sh = W * FT + PAD * 2, H * FT + PAD * 2


def X(x): return PAD + x * FT
def Y(y): return PAD + (H - y) * FT   # flip: SVG y grows downward


out = [f'<svg viewBox="0 0 {sw:.0f} {sh:.0f}" width="100%" role="img" '
       f'aria-label="Scaled floor plan, {W:.0f} by {H:.0f} feet" xmlns="http://www.w3.org/2000/svg">']
out.append('<style>'
           '.wall{fill:#9a9068}'
           '.corr{fill:#cfc48d}'
           '.room{fill:#dcd29c}'
           '.vest{fill:#b9ad76}'
           '.edge{fill:none;stroke:#2a2617;stroke-width:2}'
           '.path{fill:none;stroke:#8c3a1e;stroke-width:2.5;stroke-dasharray:7 5;stroke-linejoin:round;stroke-linecap:round}'
           '.lbl{font:600 11px system-ui;fill:#2a2617}'
           '.dim{font:11px system-ui;fill:#5c543a}'
           '.tick{stroke:#5c543a;stroke-width:1.5}'
           '.exit{fill:#3d5c2a}'
           '.emerg{fill:#8c3a1e}'
           '</style>')

# Everything not walkable is wall.
out.append(f'<rect x="{X(0):.1f}" y="{Y(H):.1f}" width="{W*FT:.1f}" height="{H*FT:.1f}" class="wall"/>')

cls = {"corridor": "corr", "room": "room", "vestibule": "vest"}
for x, y, w, h, kind, label in rects:
    out.append(f'<rect x="{X(x):.1f}" y="{Y(y+h):.1f}" width="{w*FT:.1f}" '
               f'height="{h*FT:.1f}" class="{cls[kind]}"/>')

out.append(f'<rect x="{X(0):.1f}" y="{Y(H):.1f}" width="{W*FT:.1f}" height="{H*FT:.1f}" class="edge"/>')

pts = " ".join(f"{X(px):.1f},{Y(py):.1f}" for px, py in path)
out.append(f'<polyline points="{pts}" class="path"/>')

for x, y, w, h, kind, label in rects:
    if label:
        out.append(f'<text x="{X(x+w/2):.1f}" y="{Y(y+h/2):.1f}" class="lbl" '
                   f'text-anchor="middle" dominant-baseline="middle">{label}</text>')

# Emergency egress. Not decoration: with only the entry and the far exit, the
# worst point on a 572 ft path is 265 ft from either, and the IBC limit for a
# sprinklered Group A occupancy is 250 ft. Two doors punched through the outer
# wall mid-run bring the worst case to about 90 ft. They stay locked-shut in
# appearance and open on alarm, so they cost atmosphere only when it matters.
EMERG = [(0.0, 22.5, "west"), (80.0, 52.5, "east")]
for ex, ey, side in EMERG:
    dx = 0 if side == "west" else -6 * FT
    out.append(f'<rect x="{X(ex)+dx:.1f}" y="{Y(ey+2.5):.1f}" width="{6*FT:.1f}" '
               f'height="{5*FT:.1f}" class="emerg"/>')
    out.append(f'<text x="{X(ex)+dx+3*FT:.1f}" y="{Y(ey):.1f}" class="lbl" fill="#fff" '
               f'text-anchor="middle" dominant-baseline="middle">EM</text>')

# Required second exit, opposite corner from the entry.
out.append(f'<rect x="{X(74):.1f}" y="{Y(75):.1f}" width="{6*FT:.1f}" height="{5*FT:.1f}" class="exit"/>')
out.append(f'<text x="{X(77):.1f}" y="{Y(72.5):.1f}" class="lbl" fill="#fff" '
           f'text-anchor="middle" dominant-baseline="middle">EXIT 2</text>')

# Scale bar: 20 ft.
bx, by = X(0), Y(0) + 26
out.append(f'<line x1="{bx:.1f}" y1="{by:.1f}" x2="{bx+20*FT:.1f}" y2="{by:.1f}" class="tick"/>')
for i in (0, 10, 20):
    out.append(f'<line x1="{bx+i*FT:.1f}" y1="{by-5:.1f}" x2="{bx+i*FT:.1f}" y2="{by+5:.1f}" class="tick"/>')
out.append(f'<text x="{bx+20*FT+8:.1f}" y="{by+4:.1f}" class="dim">20 ft</text>')

# Overall dimensions.
out.append(f'<text x="{X(W/2):.1f}" y="{Y(H)-14:.1f}" class="dim" text-anchor="middle">{W:.0f} ft</text>')
out.append(f'<text x="{X(0)-14:.1f}" y="{Y(H/2):.1f}" class="dim" text-anchor="middle" '
           f'transform="rotate(-90 {X(0)-14:.1f} {Y(H/2):.1f})">{H:.0f} ft</text>')

out.append('</svg>')
svg = "\n".join(out)
open("/var/lib/clawcius/workspaces/1105739162230984735/_scratch/plan.svg", "w").write(svg)
print(f"  svg written, {len(svg)} bytes")
