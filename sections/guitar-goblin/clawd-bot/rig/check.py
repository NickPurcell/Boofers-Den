"""Checks for the Clawd single-leg rig: printed parts are watertight volumes that fit a 220 x 220 bed, and the
assembled parts never intersect over the whole lift/swing range (plus: the foot never goes through the floor in
any pose the gaits or the test sketch use)."""
import json, subprocess, itertools, numpy as np, trimesh
from trimesh.transformations import rotation_matrix, translation_matrix

YOKE_Y, CRANK, LIFT_Z, LEG_Z = 61.0, 16.0, 8.0, 36.0
def load(n): return trimesh.load(f'out/rig/{n}.stl', force='mesh')
report = {'parts': {}, 'pairs': {}, 'floor': {}}

for n in ['base', 'column', 'carriage', 'leg', 'crank']:
    m = trimesh.load(f'out/stl/{n}.stl', force='mesh')
    ext = m.bounds[1] - m.bounds[0]
    adm = subprocess.run(['admesh', f'out/stl/{n}.stl'], capture_output=True, text=True).stdout
    grab = lambda key: next((l.split(':')[1].strip() for l in adm.splitlines() if l.strip().startswith(key)), '?')
    report['parts'][n] = dict(watertight=bool(m.is_watertight), winding=bool(m.is_winding_consistent), volume_ok=bool(m.is_volume),
        volume_cm3=round(m.volume / 1000, 1), size_mm=[round(v, 1) for v in ext], on_bed=round(float(m.bounds[0][2]), 3),
        fits_220=bool(ext[0] <= 220 and ext[1] <= 220), admesh_parts=grab('Number of parts'),
        admesh_degenerate=grab('Degenerate facets'), admesh_edges_fixed=grab('Edges fixed'), admesh_backwards=grab('Backwards edges'))

static = trimesh.util.concatenate([load('column'), load('liftServo'), load('rods')])
base = load('base')
car0 = trimesh.util.concatenate([load('carriage'), load('swingServo'), load('bushings')])
leg0, crank0 = load('leg'), trimesh.util.concatenate([load('crank'), load('pin')])
X = [1, 0, 0]
def car_y(l): return YOKE_Y + CRANK * np.sin(np.radians(l))
def car(l): return car0.copy().apply_translation([0, car_y(l), 0])
def leg(s, l):
    T = translation_matrix([0, car_y(l), LEG_Z]) @ rotation_matrix(np.radians(-s), X) @ translation_matrix([0, 0, -LEG_Z])
    return leg0.copy().apply_transform(T)
def crank(l):
    T = translation_matrix([0, YOKE_Y, LIFT_Z]) @ rotation_matrix(np.radians(-l), X) @ translation_matrix([0, 0, -LIFT_Z])
    return crank0.copy().apply_transform(T)
def overlap(a, b):
    if not (np.all(a.bounds[0] <= b.bounds[1]) and np.all(b.bounds[0] <= a.bounds[1])): return 0.0
    i = trimesh.boolean.intersection([a, b], engine='manifold')
    return float(i.volume) if i is not None and not i.is_empty else 0.0

lifts, swings = [-37, -27, -18, -9, 0, 9, 18, 27, 34], [-24, -18, -12, -6, 0, 6, 12, 18, 24]
worst = {}
for l, s in itertools.product(lifts, swings):
    parts = {'frame+lift servo+rods': static, 'carriage+swing servo+bushings': car(l), 'leg': leg(s, l), 'crank+pin': crank(l)}
    for (na, a), (nb, b) in itertools.combinations(parts.items(), 2):
        if na == 'frame+lift servo+rods' and nb == 'leg': continue      # the slot gauge limits this one: see below
        v = overlap(a, b); k = f'{na} vs {nb}'
        if v > worst.get(k, (-1,))[0]: worst[k] = (v, l, s)
report['pairs'] = {k: dict(max_overlap_mm3=round(v, 3), at_lift=l, at_swing=s) for k, (v, l, s) in worst.items()}
report['pairs_poses'] = f'{len(lifts)} lift x {len(swings)} swing angles, every pair'

poses = json.load(open('poses.json'))
# Leg vs frame (the shell-slot gauge): every pose the gaits and the test sketch use, and the swing limit per lift.
bad = [(round(s, 1), round(l, 1)) for s, l in poses if overlap(static, leg(s, l)) > 0.001]
lim = {}
for l in lifts:
    ok = [s for s in range(0, 31) if overlap(static, leg(s, l)) <= 0.001 and overlap(static, leg(-s, l)) <= 0.001]
    lim[l] = max(s for s in range(0, 31) if all(x in ok for x in range(0, s + 1)))
report['leg_vs_frame'] = dict(poses_checked=len(poses), poses_hitting=bad[:10], hits=len(bad),
                              max_clear_swing_by_lift={str(k): v for k, v in lim.items()})
low = min((float(leg(s, l).bounds[0][1]), s, l) for s, l in poses)
report['floor'] = dict(poses=len(poses), lowest_foot_mm=round(low[0], 2), at_swing=round(low[1], 1), at_lift=round(low[2], 1),
                       base_overlap_at_lowest_mm3=round(overlap(base, leg(low[1], low[2])), 2))
print(json.dumps(report, indent=1))
json.dump(report, open('check.json', 'w'), indent=1)
