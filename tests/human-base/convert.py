# Our own converter: MakeHuman's CC0 base mesh and morph targets (plain text) -> compact binaries for sections/guitar-goblin/human-base/data/.
# Reads only the data files in DATA (treated as untrusted text: parsed as numbers, never executed). Run with python3 -I.
# Usage: python3 -I convert.py DATA_DIR OUT_DIR
import sys, os, json, struct, math
from array import array

DATA, OUT = sys.argv[1], sys.argv[2]
os.makedirs(OUT, exist_ok=True)

# ---------------- the mesh ----------------
V, faces, group = [], [], None
with open(os.path.join(DATA, 'base.obj'), encoding='utf-8', errors='replace') as f:
    for line in f:
        if line.startswith('v '):
            p = line.split(); V.append((float(p[1]), float(p[2]), float(p[3])))
        elif line.startswith('g '):
            group = line.split(None, 1)[1].strip()
        elif line.startswith('f '):
            idx = [int(t.split('/')[0]) - 1 for t in line.split()[1:]]
            faces.append((group, idx))
print('obj: vertices', len(V), 'faces', len(faces))
KEEP = {'body'}
EYES = {'helper-l-eye': 'l', 'helper-r-eye': 'r'}
# joint helpers: small cubes the morph targets carry along with the body; their centres make sound landmarks
JOINTS = ['pelvis', 'spine-1', 'spine-2', 'spine-3', 'spine-4', 'neck', 'head', 'head-2', 'mouth'] + [f'{s}-{j}' for s in 'lr' for j in ('clavicle', 'scapula', 'shoulder', 'elbow', 'hand', 'upper-leg', 'knee', 'ankle', 'foot-1', 'eye', 'upperlid', 'lowerlid')]
JG = {'joint-' + j: j for j in JOINTS}
used = set()
for g, idx in faces:
    if g in KEEP or g in EYES or g in JG: used.update(idx)

# ---------------- the skeleton: a cut of the CC0 default skeleton (rigs/default.mhskel, its own "license": "CC0") ------
# The bones a figure needs to run and stand: the hips, the spine, the neck and head, and per side the pelvis, thigh,
# shin, foot and toes, the clavicle, shoulder, upper arm, forearm and wrist. Every other bone's weight goes to the kept
# bone it hangs from (fingers to the wrist, the face and jaw to the head), the toes to one toe bone. A joint's place is
# the middle of the vertices the skeleton names for it (mostly the joint helper cubes, which ride every morph), so
# those vertices are kept too.
skel_file = os.path.join(DATA, 'peek', 'default.mhskel')
SKEL = json.load(open(skel_file, encoding='utf-8')) if os.path.exists(skel_file) else None
CORE = ['root', 'spine05', 'spine04', 'spine03', 'spine02', 'spine01', 'neck01', 'neck02', 'neck03', 'head']
SIDE = ['pelvis', 'upperleg01', 'upperleg02', 'lowerleg01', 'lowerleg02', 'foot', 'toe3-1', 'clavicle', 'shoulder01', 'upperarm01', 'upperarm02', 'lowerarm01', 'lowerarm02', 'wrist']
KEPT = CORE + [f'{b}.{s}' for s in 'LR' for b in SIDE]
if SKEL:
    if SKEL.get('license') != 'CC0': raise SystemExit('the skeleton file does not say CC0')
    MB = SKEL['bones']
    for b in KEPT:
        if b not in MB: raise SystemExit('no bone ' + b)
        for end in ('head', 'tail'): used.update(SKEL['joints'][MB[b][end]])
    def kept_of(b):   # the kept bone a bone's weight goes to
        if b.startswith('toe'): return 'toe3-1.' + b.rsplit('.', 1)[1]
        while b not in KEPT: b = MB[b]['parent']
        return b
order = sorted(used)
remap = {old: new for new, old in enumerate(order)}
pos = array('f')
for old in order: pos.extend(V[old])
quads = array('H')
eyeVerts = {'l': set(), 'r': set()}; jointVerts = {j: set() for j in JOINTS}
for g, idx in faces:
    if g in EYES: eyeVerts[EYES[g]].update(remap[i] for i in idx); continue
    if g in JG: jointVerts[JG[g]].update(remap[i] for i in idx); continue
    if g not in KEEP: continue
    q = [remap[i] for i in idx]
    if len(q) != 4: raise SystemExit('expected quads only in the body')
    quads.extend(q)
n = len(order)
bodyset = set(quads)
inbody = lambda j: j in bodyset
ys = [pos[i*3+1] for i in range(n)]
print('kept vertices', n, 'quads', len(quads) // 4, 'height', round(max(ys) - min(ys), 3), 'min y', round(min(ys), 3))

# ---------------- the targets ----------------
def read_target(name):
    d = {}
    with open(os.path.join(DATA, 'targets', name + '.target'), encoding='utf-8', errors='replace') as f:
        for line in f:
            if not line.strip() or line.startswith('#'): continue
            p = line.split()
            i = int(p[0])
            if i in remap: d[remap[i]] = (float(p[1]), float(p[2]), float(p[3]))
    return d
def combine(parts):   # [(weight, dict)] -> dict
    out = {}
    for w, d in parts:
        for i, (x, y, z) in d.items():
            o = out.get(i, (0.0, 0.0, 0.0)); out[i] = (o[0] + w * x, o[1] + w * y, o[2] + w * z)
    return {i: v for i, v in out.items() if max(abs(v[0]), abs(v[1]), abs(v[2])) > 1e-5}

T = {}   # our name -> dict
# gender and age: the three ethnic shapes of each, averaged in equal parts (our fixed choice)
for g in ('female', 'male'):
    for a in ('young', 'old'):
        T[f'{g}-{a}'] = combine([(1 / 3, read_target(f'{r}-{g}-{a}')) for r in ('african', 'asian', 'caucasian')])
# muscle and weight (young adults; used at every age)
for g in ('female', 'male'):
    for m in ('min', 'average', 'max'):
        for w in ('min', 'average', 'max'):
            if m == w == 'average': continue
            T[f'{g}-{m}muscle-{w}weight'] = read_target(f'universal-{g}-young-{m}muscle-{w}weight')
    for h in ('min', 'max'):
        T[f'{g}-{h}height'] = read_target(f'{g}-young-averagemuscle-averageweight-{h}height')
# the face and a few body pairs: name -> files summed (left and right sides together)
pair = lambda base: [base]
PAIRS = {
    'brow-down': ['eyebrows-trans-down'], 'brow-up': ['eyebrows-trans-up'],
    'brow-back': ['eyebrows-trans-backward'], 'brow-forward': ['eyebrows-trans-forward'],
    'browangle-down': ['eyebrows-angle-down'], 'browangle-up': ['eyebrows-angle-up'],
    'forehead-back': ['forehead-trans-backward'], 'forehead-forward': ['forehead-trans-forward'],
    'eyesize-decr': ['l-eye-scale-decr', 'r-eye-scale-decr'], 'eyesize-incr': ['l-eye-scale-incr', 'r-eye-scale-incr'],
    'eyespace-in': ['l-eye-trans-in', 'r-eye-trans-in'], 'eyespace-out': ['l-eye-trans-out', 'r-eye-trans-out'],
    'eyebag-decr': ['l-eye-bag-decr', 'r-eye-bag-decr'], 'eyebag-incr': ['l-eye-bag-incr', 'r-eye-bag-incr'],
    'nosewidth-decr': ['nose-scale-horiz-decr'], 'nosewidth-incr': ['nose-scale-horiz-incr'],
    'noselength-decr': ['nose-scale-vert-decr'], 'noselength-incr': ['nose-scale-vert-incr'],
    'nosehump-decr': ['nose-hump-decr'], 'nosehump-incr': ['nose-hump-incr'],
    'noseflare-decr': ['nose-flaring-decr'], 'noseflare-incr': ['nose-flaring-incr'],
    'mouthwidth-decr': ['mouth-scale-horiz-decr'], 'mouthwidth-incr': ['mouth-scale-horiz-incr'],
    'lips-decr': ['mouth-lowerlip-volume-decr', 'mouth-upperlip-volume-decr'], 'lips-incr': ['mouth-lowerlip-volume-incr', 'mouth-upperlip-volume-incr'],
    'mouthcorners-down': ['mouth-angles-down'], 'mouthcorners-up': ['mouth-angles-up'],
    'cheekbones-decr': ['l-cheek-bones-decr', 'r-cheek-bones-decr'], 'cheekbones-incr': ['l-cheek-bones-incr', 'r-cheek-bones-incr'],
    'cheeks-decr': ['l-cheek-volume-decr', 'r-cheek-volume-decr'], 'cheeks-incr': ['l-cheek-volume-incr', 'r-cheek-volume-incr'],
    'chinwidth-decr': ['chin-width-decr'], 'chinwidth-incr': ['chin-width-incr'],
    'chinjut-decr': ['chin-prominent-decr'], 'chinjut-incr': ['chin-prominent-incr'],
    'chinheight-decr': ['chin-height-decr'], 'chinheight-incr': ['chin-height-incr'],
    'jaw-decr': ['chin-bones-decr'], 'jaw-incr': ['chin-bones-incr'],
    'head-square': ['head-square'], 'head-oval': ['head-oval'], 'head-round': ['head-round'],
    'headfat-decr': ['head-fat-decr'], 'headfat-incr': ['head-fat-incr'],
    'headage-decr': ['head-age-decr'], 'headage-incr': ['head-age-incr'],
    'neck-decr': ['neck-scale-horiz-decr'], 'neck-incr': ['neck-scale-horiz-incr'],
    'vshape-decr': ['torso-vshape-decr'], 'vshape-incr': ['torso-vshape-incr'],
    'belly-decr': ['stomach-pregnant-decr'], 'belly-incr': ['stomach-pregnant-incr'],
    'chestdepth-decr': ['torso-scale-depth-decr'], 'chestdepth-incr': ['torso-scale-depth-incr'],
    'pecs-decr': ['torso-muscle-pectoral-decr'], 'pecs-incr': ['torso-muscle-pectoral-incr'],
    'lats-decr': ['torso-muscle-dorsi-decr'], 'lats-incr': ['torso-muscle-dorsi-incr'],
    'neckdepth-decr': ['neck-scale-depth-decr'], 'neckdepth-incr': ['neck-scale-depth-incr'],
    'doublechin-decr': ['neck-double-decr'], 'doublechin-incr': ['neck-double-incr'],
    'heavyset': ['bodyshapes-elvs-man-apple'],
    'earsize-decr': ['l-ear-scale-decr', 'r-ear-scale-decr'], 'earsize-incr': ['l-ear-scale-incr', 'r-ear-scale-incr'],
    'earflap-decr': ['l-ear-flap-decr', 'r-ear-flap-decr'], 'earflap-incr': ['l-ear-flap-incr', 'r-ear-flap-incr'],
    'earlobe-decr': ['l-ear-lobe-decr', 'r-ear-lobe-decr'], 'earlobe-incr': ['l-ear-lobe-incr', 'r-ear-lobe-incr'],
    'earpoint': ['l-ear-shape-pointed', 'r-ear-shape-pointed'],
    'lids-decr': [f'{s}-eye-height{h}-decr' for s in 'lr' for h in (1, 2, 3)], 'lids-incr': [f'{s}-eye-height{h}-incr' for s in 'lr' for h in (1, 2, 3)],
    'armfat-decr': ['l-upperarm-fat-decr', 'r-upperarm-fat-decr', 'l-lowerarm-fat-decr', 'r-lowerarm-fat-decr'],
    'armfat-incr': ['l-upperarm-fat-incr', 'r-upperarm-fat-incr', 'l-lowerarm-fat-incr', 'r-lowerarm-fat-incr'],
    'armmuscle-decr': ['l-upperarm-muscle-decr', 'r-upperarm-muscle-decr'], 'armmuscle-incr': ['l-upperarm-muscle-incr', 'r-upperarm-muscle-incr'],
}
for name, files in PAIRS.items(): T[name] = combine([(1.0, read_target(f)) for f in files])

# ---------------- arm weights, from the CC0 skeleton weights (rigs/default_weights.mhw) ----------------
# For our own two-joint skinning: per vertex, how much follows the upper arm (shoulder down) and how much the forearm
# (elbow down), as fractions of all its weight. The deltoid's bone counts half, so the shoulder bends softly.
wfile = os.path.join(DATA, 'peek', 'default_weights.mhw')
armW = array('B', bytes(n)); foreW = array('B', bytes(n))
if os.path.exists(wfile):
    W = json.load(open(wfile, encoding='utf-8'))['weights']
    tot = [0.0] * n; arm = [0.0] * n; fore = [0.0] * n
    UPPER = ('upperarm01', 'upperarm02'); FORE = ('lowerarm01', 'lowerarm02', 'wrist', 'metacarpal', 'finger')
    for bone, lst in W.items():
        base = bone.rsplit('.', 1)[0]
        for i, w in lst:
            if i not in remap: continue
            j = remap[i]; tot[j] += w
            if base.startswith(FORE): arm[j] += w; fore[j] += w
            elif base.startswith(UPPER): arm[j] += w
            elif base == 'shoulder01': arm[j] += 0.5 * w
    for j in range(n):
        if tot[j] > 0: armW[j] = min(255, round(255 * arm[j] / tot[j])); foreW[j] = min(255, round(255 * fore[j] / tot[j]))
    for side in 'lr':   # the joint helpers ride with their bones
        for v in jointVerts.get(f'{side}-elbow', ()): armW[v] = 255
        for v in jointVerts.get(f'{side}-hand', ()): armW[v] = 255; foreW[v] = 255
    # the fingers (2 to 5) and the thumb, for curling the hand
    fingW = array('B', bytes(n)); thumbW = array('B', bytes(n)); fg = [0.0] * n; th = [0.0] * n
    for bone, lst in W.items():
        base = bone.rsplit('.', 1)[0]
        for i, w in lst:
            if i not in remap: continue
            if base.startswith(('finger2', 'finger3', 'finger4', 'finger5')): fg[remap[i]] += w
            elif base.startswith('finger1'): th[remap[i]] += w
    for j in range(n):
        if tot[j] > 0: fingW[j] = min(255, round(255 * fg[j] / tot[j])); thumbW[j] = min(255, round(255 * th[j] / tot[j]))
    # the skeleton's joint cubes at the clavicle and shoulder stay with the body when the arms are lowered (the arm turns
    # about the shoulder joint's own middle, which stays put); the elbow's and wrist's go with the arm, as above
    if SKEL:
        for side in 'LR':
            for b in ('clavicle', 'shoulder01'):
                for i in SKEL['joints'][MB[f'{b}.{side}']['head']]:
                    if i in remap and not inbody(remap[i]): armW[remap[i]] = 0; foreW[remap[i]] = 0
    with open(os.path.join(OUT, 'skin.bin'), 'wb') as f: f.write(armW.tobytes() + foreW.tobytes() + fingW.tobytes() + thumbW.tobytes())
    # per vertex the four kept bones that move it most, and how much (bytes summing to 255): bones.bin holds the n*4
    # bone numbers, then the n*4 weights. A vertex with no weight (a helper) follows the hips.
    if SKEL:
        KI = {b: k for k, b in enumerate(KEPT)}
        per = [dict() for _ in range(n)]
        for bone, lst in W.items():
            kb = KI[kept_of(bone)]
            for i, w in lst:
                if i in remap and w > 0: d = per[remap[i]]; d[kb] = d.get(kb, 0.0) + w
        bi = array('B', bytes(n * 4)); bw = array('B', bytes(n * 4))
        for j in range(n):
            top = sorted(per[j].items(), key=lambda t: -t[1])[:4]
            tot4 = sum(w for _, w in top)
            if tot4 <= 0: bw[j * 4] = 255; continue
            q = [int(255 * w / tot4) for _, w in top]; q[0] += 255 - sum(q)
            for k, (b, _) in enumerate(top): bi[j * 4 + k] = b; bw[j * 4 + k] = q[k]
        with open(os.path.join(OUT, 'bones.bin'), 'wb') as f: f.write(bi.tobytes() + bw.tobytes())
        print('bones', len(KEPT), '| weighted vertices', sum(1 for d in per if d))
    print('finger vertices', sum(1 for v in fingW if v > 0), 'thumb', sum(1 for v in thumbW if v > 0))
    print('arm weights: vertices on the arms', sum(1 for v in armW if v > 0), 'on the forearms', sum(1 for v in foreW if v > 0))

# ---------------- pack: per target, int16 deltas (one scale each) then uint16 vertex numbers ----------------
blob = bytearray(); meta = {}
for name, d in T.items():
    items = sorted(d.items())
    big = max((max(abs(x), abs(y), abs(z)) for _, (x, y, z) in items), default=1e-6)
    s = big / 32767
    q = array('h'); ix = array('H')
    for i, (x, y, z) in items:
        q.extend((round(x / s), round(y / s), round(z / s))); ix.append(i)
    meta[name] = {'n': len(items), 'scale': s, 'at': len(blob)}
    blob += q.tobytes(); blob += ix.tobytes()
with open(os.path.join(OUT, 'targets.bin'), 'wb') as f: f.write(blob)
mesh = pos.tobytes() + quads.tobytes()
with open(os.path.join(OUT, 'mesh.bin'), 'wb') as f: f.write(mesh)
info = {'vertices': n, 'quads': len(quads) // 4, 'unit': 'decimetre', 'eyes': {k: sorted(v) for k, v in eyeVerts.items()}, 'joints': {k: sorted(v) for k, v in jointVerts.items() if v}, 'targets': meta}
if SKEL: info['skeleton'] = [{'name': b, 'parent': KEPT.index(MB[b]['parent']) if MB[b]['parent'] in KEPT else -1, 'head': sorted(remap[i] for i in SKEL['joints'][MB[b]['head']]), 'tail': sorted(remap[i] for i in SKEL['joints'][MB[b]['tail']])} for b in KEPT]
with open(os.path.join(OUT, 'mesh.json'), 'w') as f: json.dump(info, f, separators=(',', ':'))
tot = sum(m['n'] for m in meta.values())
print('targets', len(meta), 'deltas', tot, '| mesh.bin', len(mesh), 'targets.bin', len(blob), 'json', os.path.getsize(os.path.join(OUT, 'mesh.json')))
for k in ('male-young', 'belly-incr', 'heavyset', 'armfat-incr', 'jaw-incr'): print(' ', k, meta[k]['n'], 'max', round(meta[k]['scale'] * 32767, 4))

# ---------------- the derived tables: landmarks, regions and the rest, worked out once (human-base/derive.js) --------
import subprocess
bake = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'bake.mjs')
subprocess.run(['node', bake, OUT], check=True)
subprocess.run(['node', bake, OUT, '--check'], check=True)
