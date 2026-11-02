#!/usr/bin/env python3
"""Build the seafloor explorer's map tiles from Sandwell's 1-arc-minute global grids.

Sources (topex.ucsd.edu/pub, Scripps Institution of Oceanography):
  global_topo_1min/topo_27.1.img           SRTM15+ V2.7 depth/elevation, metres
  global_grav_1min/curv_34.1.img           vertical gravity gradient, conventional (nadir) altimeters only, Eotvos x 10
  global_grav_1min_SWOT/curv_SWOT_06.img   vertical gravity gradient with 3 years of SWOT added, Eotvos x 10

Each .img is 21600 x 17280 big-endian int16 in spherical Mercator (lon 0..360, lat +-80.738), which lines up
with Web Mercator tiles, so a grid is streamed once in 128-row chunks and never held in memory whole. One pass
builds a zoom-4 global base (block means) plus native-resolution crops for the fly-to regions; tiles are cut from those.

  pass 1:  python3 build_tiles.py stream topo|before|swot   (each ~700 MB download, a few MB of RAM per chunk)
  pass 2:  python3 build_tiles.py tiles                      (writes tiles/ next to this script)
Needs numpy and Pillow (with WebP).
"""
import sys, os, math, json, urllib.request
import numpy as np
import warnings
warnings.filterwarnings('ignore', category=RuntimeWarning)

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.environ.get('SEAFLOOR_CACHE', os.path.join(HERE, '.cache'))
OUT = os.path.join(HERE, 'tiles')
GRIDS = {
    'topo': 'https://topex.ucsd.edu/pub/global_topo_1min/topo_27.1.img',
    'before': 'https://topex.ucsd.edu/pub/global_grav_1min/curv_34.1.img',
    'swot': 'https://topex.ucsd.edu/pub/global_grav_1min_SWOT/curv_SWOT_06.img',
}
NC, NR = 21600, 17280          # img columns (lon 0..360) and rows (north to south)
TOP = 2160                     # img row 0 sits this many img pixels below the top of the Web Mercator world
BASE_Z = 4
# fly-to regions: lon in 0..360 (contiguous in img columns), lat, deepest zoom for gravity / depth tiles
REGIONS = {
    'mid-atlantic': dict(lon=(312, 324), lat=(18, 32), zg=7, zd=6),
    'mariana':      dict(lon=(138, 150), lat=(8, 20), zg=7, zd=6),
    'hawaii':       dict(lon=(168, 205), lat=(17, 35), zg=6, zd=6),
    'south-pacific': dict(lon=(232, 244), lat=(-34, -22), zg=7, zd=6),
    'galapagos':    dict(lon=(266, 274), lat=(-4, 4), zg=7, zd=6),
}

def img_row(lat):
    y = math.log(math.tan(math.pi / 4 + math.radians(lat) / 2))
    return NR / 2 - y / (2 * math.pi / NC)

def crop_box(reg):
    r0, r1 = int(math.floor(img_row(reg['lat'][1]))) - 4, int(math.ceil(img_row(reg['lat'][0]))) + 4
    c0, c1 = reg['lon'][0] * 60 - 4, reg['lon'][1] * 60 + 4
    return max(r0, 0), min(r1, NR), c0, c1

def stream(name):
    os.makedirs(CACHE, exist_ok=True)
    W = 256 * 2 ** BASE_Z; s = NC / W
    rows_out = np.floor((TOP + np.arange(NR)) / s).astype(np.int64)
    py0, py1 = int(rows_out[0]), int(rows_out[-1]) + 1
    sums = np.zeros((py1 - py0, W)); cnt = np.zeros(py1 - py0)
    edges = np.ceil(np.arange(W) * s).astype(np.int64)            # web columns start at lon -180 -> rolled img columns
    widths = np.diff(np.append(edges, NC))
    boxes = {k: crop_box(v) for k, v in REGIONS.items()}
    crops = {k: np.zeros((b[1] - b[0], b[3] - b[2]), np.int16) for k, b in boxes.items()}
    resp = urllib.request.urlopen(urllib.request.Request(GRIDS[name], headers={'User-Agent': 'boofers-den-seafloor'}), timeout=120)
    CH = 128; r = 0
    while r < NR:
        n = min(CH, NR - r); want = n * NC * 2; buf = bytearray()
        while len(buf) < want:
            part = resp.read(want - len(buf))
            if not part: raise SystemExit('stream ended early at row %d' % r)
            buf += part
        a = np.frombuffer(bytes(buf), dtype='>i2').reshape(n, NC)
        for k, (r0, r1, c0, c1) in boxes.items():
            lo, hi = max(r0, r), min(r1, r + n)
            if lo < hi: crops[k][lo - r0:hi - r0] = a[lo - r:hi - r, c0:c1]
        rolled = np.roll(a, NC // 2, axis=1).astype(np.float64)
        binned = np.add.reduceat(rolled, edges, axis=1) / widths
        for i in range(n):
            o = rows_out[r + i] - py0; sums[o] += binned[i]; cnt[o] += 1
        r += n
        if (r // CH) % 20 == 0: print(name, f'{r}/{NR}', flush=True)
    base = (sums / cnt[:, None]).astype(np.float32)
    np.save(os.path.join(CACHE, f'{name}_base.npy'), base)
    for k, c in crops.items(): np.save(os.path.join(CACHE, f'{name}_{k}.npy'), c)
    json.dump({'py0': py0, 'boxes': boxes}, open(os.path.join(CACHE, 'meta.json'), 'w'))
    print(name, 'done; base', base.shape, 'rows', py0, py1)

# ---------- tiles ----------
def vgg_rgba(v, land):
    """Diverging: negative curvature blue, positive amber, a dark neutral in the middle. Eotvos in, RGBA out."""
    t = np.tanh(np.nan_to_num(v) / 40.0)
    neg = np.array([46, 110, 230]); mid = np.array([30, 34, 44]); pos = np.array([255, 178, 64])
    k = np.abs(t)[..., None] ** 0.85
    rgb = np.where(t[..., None] < 0, mid + (neg - mid) * k, mid + (pos - mid) * k)
    a = np.where(land | np.isnan(v), 0, 255)
    return np.dstack([rgb.clip(0, 255), a]).astype(np.uint8)

def terrarium(h, q=1):
    # whole multiples of q metres keep the low bytes quiet so lossless WebP stays small
    h = np.round(np.nan_to_num(h, nan=0.0) / q) * q + 32768.0
    r = np.floor(h / 256); g = np.floor(h - r * 256); b = np.floor((h - np.floor(h)) * 256)
    return np.dstack([r, g, b]).clip(0, 255).astype(np.uint8)

def save(img, kind, z, x, y, lossless):
    from PIL import Image
    d = os.path.join(OUT, kind, str(z), str(x)); os.makedirs(d, exist_ok=True)
    Image.fromarray(img).save(os.path.join(d, f'{y}.webp'), 'WEBP', lossless=lossless, quality=80 if not lossless else 100, method=5)

def box_mean(a, k):
    if k <= 1: return a
    p = np.pad(np.nan_to_num(a, nan=0.0), ((1, 0), (1, 0))).cumsum(0).cumsum(1)
    h, w = a.shape; out = np.empty_like(a)
    r = k // 2
    ri0 = np.clip(np.arange(h) - r, 0, h); ri1 = np.clip(np.arange(h) + k - r, 0, h)
    ci0 = np.clip(np.arange(w) - r, 0, w); ci1 = np.clip(np.arange(w) + k - r, 0, w)
    out = (p[ri1][:, ci1] - p[ri0][:, ci1] - p[ri1][:, ci0] + p[ri0][:, ci0]) / ((ri1 - ri0)[:, None] * (ci1 - ci0)[None, :])
    return out

def tiles():
    meta = json.load(open(os.path.join(CACHE, 'meta.json'))); py0 = meta['py0']
    W4 = 256 * 2 ** BASE_Z
    manifest = {'regions': {}}
    topo = np.load(os.path.join(CACHE, 'topo_base.npy'))
    full = {'topo': np.full((W4, W4), np.nan, np.float32)}
    full['topo'][py0:py0 + topo.shape[0]] = topo
    for name in ('before', 'swot'):
        b = np.load(os.path.join(CACHE, f'{name}_base.npy')) / 10.0
        f = np.full((W4, W4), np.nan, np.float32); f[py0:py0 + b.shape[0]] = b; full[name] = f
    topo4 = full['topo'].copy()   # fills regional depth tiles past the edge of their crop
    # global pyramid z0..4 by 2x2 means
    for z in range(BASE_Z, -1, -1):
        n = 2 ** z
        for ty in range(n):
            for tx in range(n):
                sl = (slice(ty * 256, ty * 256 + 256), slice(tx * 256, tx * 256 + 256))
                t = full['topo'][sl]
                if np.isnan(t).all(): continue
                save(terrarium(t, 5), 'dem', z, tx, ty, True)
                land = np.nan_to_num(t, nan=1) > 0
                for name in ('before', 'swot'):
                    v = full[name][sl]
                    if not (np.isnan(v) | land).all(): save(vgg_rgba(v, land), 'vgg-' + name, z, tx, ty, False)
        if z:
            for k in full:
                a = full[k]; full[k] = np.nanmean(np.stack([a[0::2, 0::2], a[1::2, 0::2], a[0::2, 1::2], a[1::2, 1::2]]), axis=0)
        print('global z', z, flush=True)
    del full

    def base_depth(X, Y, z):
        f = 2 ** (z - BASE_Z)
        xb, yb = np.meshgrid(np.clip(X / f - 0.5, 0, W4 - 1.001), np.clip(Y / f - 0.5, 0, W4 - 1.001))
        xi, yi = xb.astype(int), yb.astype(int); fx, fy = xb - xi, yb - yi
        return (topo4[yi, xi] * (1 - fx) * (1 - fy) + topo4[yi, xi + 1] * fx * (1 - fy)
                + topo4[yi + 1, xi] * (1 - fx) * fy + topo4[yi + 1, xi + 1] * fx * fy)
    # regional detail z5..zmax from native crops
    for key, reg in REGIONS.items():
        r0, r1, c0, c1 = meta['boxes'][key]
        crop = {n: np.load(os.path.join(CACHE, f'{n}_{key}.npy')).astype(np.float32) for n in ('topo', 'before', 'swot')}
        for n in ('before', 'swot'): crop[n] /= 10.0
        bounds = []
        for z in range(BASE_Z + 1, max(reg['zg'], reg['zd']) + 1):
            W = 256 * 2 ** z; s = NC / W
            src = {n: box_mean(crop[n], int(round(s))) if s > 1.5 else crop[n] for n in crop}
            ys = [int(math.floor((TOP + img_row(lat)) / s / 256)) for lat in (reg['lat'][1], reg['lat'][0])]
            lons = np.arange(reg['lon'][0], reg['lon'][1] + 1e-9, 0.25)
            txs = sorted(set(int(math.floor(((l - 180) % 360) / 360 * 2 ** z)) for l in lons))
            for ty in range(ys[0], ys[1] + 1):
                for tx in txs:
                    X = tx * 256 + np.arange(256) + 0.5; Y = ty * 256 + np.arange(256) + 0.5
                    col = ((X / W * 360 + 180) % 360) * 60 - 0.5 - c0
                    row = Y * s - TOP - 0.5 - r0
                    cc, rr = np.meshgrid(col, row)
                    ok = (cc >= 0) & (cc <= crop['topo'].shape[1] - 1.001) & (rr >= 0) & (rr <= crop['topo'].shape[0] - 1.001)
                    if not ok.any(): continue
                    c_ = np.clip(cc, 0, crop['topo'].shape[1] - 1.001); r_ = np.clip(rr, 0, crop['topo'].shape[0] - 1.001)
                    ci, ri = c_.astype(int), r_.astype(int); fc, fr = c_ - ci, r_ - ri
                    def bil(a):
                        v = a[ri, ci] * (1 - fc) * (1 - fr) + a[ri, ci + 1] * fc * (1 - fr) + a[ri + 1, ci] * (1 - fc) * fr + a[ri + 1, ci + 1] * fc * fr
                        return np.where(ok, v, np.nan)
                    t = bil(src['topo']); land = np.nan_to_num(t, nan=1) > 0
                    if z <= reg['zd']: save(terrarium(np.where(ok, t, base_depth(X, Y, z)), 2), 'dem-' + key, z, tx, ty, True)
                    if z <= reg['zg']:
                        for n in ('before', 'swot'): save(vgg_rgba(bil(src[n]), land), f'vgg-{n}-{key}', z, tx, ty, False)
            print(key, 'z', z, flush=True)
        manifest['regions'][key] = {'zg': reg['zg'], 'zd': reg['zd'], 'lon': reg['lon'], 'lat': reg['lat']}
    json.dump(manifest, open(os.path.join(OUT, 'manifest.json'), 'w'))

if __name__ == '__main__':
    if sys.argv[1] == 'stream': stream(sys.argv[2])
    elif sys.argv[1] == 'tiles': tiles()
