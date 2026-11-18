/* HoloTable combat engine: the rules of a fight, as pure functions. No page code, no storage, no dice of its own.
   The server (api/_holotable-fight.js) uses it to decide and apply every action; the combat view (view.js) uses the
   same code to show what is possible before anyone clicks.

   A fight is a "world": the units in the initiative order that have a token on the map, the grid, whose turn it is,
   and what that turn has spent. apply(world, action, roll) says whether one action is legal and, if it is, returns
   the new world, the log lines and the events to show on the board. roll(expr) is passed in (the server's dice), so
   the engine never decides a number by itself and tests can use loaded dice.

   What it knows in this slice: turn order, each turn's movement / action / bonus action / reaction, distance on the
   grid in feet, reach and range, weapon attacks against AC with advantage and disadvantage, natural 20s and 1s, and
   damage taken from temporary hit points first. Later rules belong in the tables below (REASONS, the attack spec,
   the budget) and in new action types, not in rewrites.

   The arithmetic HoloTable already does (attack bonus, damage expression, critical dice) is not repeated here:
   attacksOf() calls rules.js (window.SW5E / globalThis.SW5E), which the sheet uses too. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HTCombatEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const FT = 5;                      // feet per square
  const no = (why) => ({ ok: false, why });
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const sgn = (n) => (n >= 0 ? '+' : '') + n;

  /* ---------------- geometry: a unit fills size×size squares from its top-left square (x, y) ---------------- */
  // squares between two footprints, counting diagonals as one square (adjacent = 1, overlapping = 0)
  function squaresBetween(a, b) {
    const as = a.size || 1, bs = b.size || 1;
    const dx = Math.max(0, b.x - (a.x + as - 1), a.x - (b.x + bs - 1));
    const dy = Math.max(0, b.y - (a.y + as - 1), a.y - (b.y + bs - 1));
    return Math.max(dx, dy);
  }
  // SW5e's grid rule (PHB ch. 9, "Playing on a Grid"): diagonals alternate 5 ft and 10 ft when measuring or moving
  const gridFeet = (dx, dy) => { const d = Math.min(dx, dy), s = Math.max(dx, dy) - d; return (s + d + Math.floor(d / 2)) * FT; };
  function feetBetween(a, b) {
    const as = a.size || 1, bs = b.size || 1;
    return gridFeet(Math.max(0, b.x - (a.x + as - 1), a.x - (b.x + bs - 1)), Math.max(0, b.y - (a.y + as - 1), a.y - (b.y + bs - 1)));
  }
  /* ---------------- walls (issue #93): segments in grid units, a square's corners at whole numbers ---------------- */
  // { a: [x, y], b: [x, y], kind: 'wall' | 'door' | 'window', open }. A wall blocks sight and movement; a closed door
  // blocks both; a window blocks movement only. A world with no walls behaves exactly as before.
  const WALL_KINDS = ['wall', 'door', 'window'];
  // 'sight' is a map object the GM marked as blocking sight (#110): it blocks sight and gives cover, never movement or an area
  const blocksSight = (w) => w.kind === 'wall' || w.kind === 'sight' || (w.kind === 'door' && !w.open);
  const blocksMove = (w) => w.kind === 'wall' || w.kind === 'window' || (w.kind === 'door' && !w.open);
  // do segments p1–p2 and q1–q2 meet (touching counts, so nothing slips through where two walls join)?
  function crosses(p1, p2, q1, q2) {
    const d = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const on = (a, b, c) => Math.min(a[0], b[0]) - 1e-9 <= c[0] && c[0] <= Math.max(a[0], b[0]) + 1e-9 && Math.min(a[1], b[1]) - 1e-9 <= c[1] && c[1] <= Math.max(a[1], b[1]) + 1e-9;
    const d1 = d(q1, q2, p1), d2 = d(q1, q2, p2), d3 = d(p1, p2, q1), d4 = d(p1, p2, q2);
    if (((d1 > 1e-9 && d2 < -1e-9) || (d1 < -1e-9 && d2 > 1e-9)) && ((d3 > 1e-9 && d4 < -1e-9) || (d3 < -1e-9 && d4 > 1e-9))) return true;
    return (Math.abs(d1) <= 1e-9 && on(q1, q2, p1)) || (Math.abs(d2) <= 1e-9 && on(q1, q2, p2)) || (Math.abs(d3) <= 1e-9 && on(p1, p2, q1)) || (Math.abs(d4) <= 1e-9 && on(p1, p2, q2));
  }
  const clear = (walls, p, q, test) => !(walls || []).some((w) => test(w) && crosses(p, q, w.a, w.b));
  // points that stand for a unit's space: its centre and its corners, a little inside so a line along a wall's face
  // doesn't count as blocked
  function spots(u) {
    const s = u.size || 1, e = 0.15;
    return [[u.x + s / 2, u.y + s / 2], [u.x + e, u.y + e], [u.x + s - e, u.y + e], [u.x + e, u.y + s - e], [u.x + s - e, u.y + s - e]];
  }
  // can `a` see `b`: some line from a's space to b's crosses no wall and no closed door (windows don't block sight)
  function sees(world, a, b) {
    const walls = (world.walls || []).filter(blocksSight);
    if (!walls.length || !a || !b) return true;
    const sa = spots(a), sb = spots(b);
    return sa.some((p) => sb.some((q) => clear(walls, p, q, () => true)));
  }
  // Cover (issue #93, step 2), only on a map with walls (without walls the GM applies cover by hand, as before).
  // SW5e's four degrees: one-quarter +2, half +3, three-quarters +5 to AC and Dex saves; total: can't be targeted.
  // How much a wall covers isn't measured in SW5e's text, so the default here is the grid method: lines from the
  // attacker's best corner to the target's four corners; 1 blocked is one-quarter, 2 half, 3 three-quarters, 4 total.
  // A creature in the way covers by its size against the target's, as SW5e says: one size smaller one-quarter, the same
  // size half, larger three-quarters. Only the most protective degree counts.
  const COVER = [null, { name: 'one-quarter', bonus: 2 }, { name: 'half', bonus: 3 }, { name: 'three-quarters', bonus: 5 }, { name: 'total', bonus: null }];
  const corners = (u) => { const s = u.size || 1, e = 0.05; return [[u.x + e, u.y + e], [u.x + s - e, u.y + e], [u.x + e, u.y + s - e], [u.x + s - e, u.y + s - e]]; };
  // cover from a point (an area's origin) for a Dex save: the same lines, from that one point
  function coverFrom(world, p, t) {
    const walls = (world.walls || []).filter(blocksSight);
    if (!walls.length || !p || !t) return null;
    const deg = corners(t).filter((q) => !clear(walls, [p.x, p.y], q, () => true)).length;
    return deg && deg < 4 ? COVER[deg] : null;
  }
  function coverOf(world, a, t) {
    const walls = (world.walls || []).filter(blocksSight);
    if (!(world.walls || []).length || !a || !t || a.id === t.id) return null;
    let deg = walls.length ? Math.min(...corners(a).map((p) => corners(t).filter((q) => !clear(walls, p, q, () => true)).length)) : 0;
    const mid = (u) => [u.x + (u.size || 1) / 2, u.y + (u.size || 1) / 2];
    for (const o of Object.values(world.units)) {
      if (o.id === a.id || o.id === t.id || o.down) continue;
      const s = o.size || 1, box = [[[o.x, o.y], [o.x + s, o.y]], [[o.x + s, o.y], [o.x + s, o.y + s]], [[o.x + s, o.y + s], [o.x, o.y + s]], [[o.x, o.y + s], [o.x, o.y]]];
      if (!box.some(([p, q]) => crosses(mid(a), mid(t), p, q))) continue;
      const d = sizeCat(o) - sizeCat(t);
      deg = Math.max(deg, d <= -2 ? 0 : d === -1 ? 1 : d === 0 ? 2 : 3);
    }
    return deg ? COVER[deg] : null;
  }
  /* ---------------- fog of war (issue #93, step 4): what a viewer can see, as squares ---------------- */
  // The visibility polygon from one point among sight-blocking walls and the board's edges, by an angular sweep: a ray
  // towards every wall end (and just either side of it) stops at the nearest wall. The polygon's points come back
  // sorted by angle.
  function sightPolygon(walls, o, cols, rows) {
    const edges = [[[0, 0], [cols, 0]], [[cols, 0], [cols, rows]], [[cols, rows], [0, rows]], [[0, rows], [0, 0]]];
    const segs = edges.concat(walls.map((w) => [w.a, w.b])), n = segs.length;
    // flat arrays for the inner loop: each segment's start, relative to the eye, and its direction
    const AX = new Float64Array(n), AY = new Float64Array(n), EX = new Float64Array(n), EY = new Float64Array(n);
    for (let i = 0; i < n; i++) { const [a, b] = segs[i]; AX[i] = a[0] - o[0]; AY[i] = a[1] - o[1]; EX[i] = b[0] - a[0]; EY[i] = b[1] - a[1]; }
    const angles = new Float64Array(n * 6);
    for (let i = 0, k = 0; i < n; i++) {
      const t1 = Math.atan2(AY[i], AX[i]), t2 = Math.atan2(AY[i] + EY[i], AX[i] + EX[i]);
      angles[k++] = t1 - 1e-4; angles[k++] = t1; angles[k++] = t1 + 1e-4; angles[k++] = t2 - 1e-4; angles[k++] = t2; angles[k++] = t2 + 1e-4;
    }
    angles.sort();
    const out = [];
    for (let j = 0; j < angles.length; j++) {
      const t = angles[j], dx = Math.cos(t), dy = Math.sin(t);
      let best = Infinity;
      for (let i = 0; i < n; i++) {   // the ray r*(dx,dy) against segment A + s*E
        const den = dx * EY[i] - dy * EX[i];
        if (den > -1e-12 && den < 1e-12) continue;
        const r = (AX[i] * EY[i] - AY[i] * EX[i]) / den;
        if (r <= 1e-9 || r >= best) continue;
        const sp = (AX[i] * dy - AY[i] * dx) / den;
        if (sp >= -1e-9 && sp <= 1 + 1e-9) best = r;
      }
      if (best < Infinity) out.push({ t, x: o[0] + dx * best, y: o[1] + dy * best });
    }
    return out;
  }
  // The squares whose centre lies inside the polygon, filled row by row (even-odd crossings at the row's centre line).
  function fillPolygon(poly, cols, rows, into) {
    const n = poly.length;
    if (n < 3) return into;
    for (let y = 0; y < rows; y++) {
      const cy = y + 0.5, xs = [];
      for (let i = 0; i < n; i++) {
        const p = poly[i], q = poly[(i + 1) % n];
        if ((p.y <= cy && q.y > cy) || (q.y <= cy && p.y > cy)) xs.push(p.x + ((cy - p.y) / (q.y - p.y)) * (q.x - p.x));
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const from = Math.max(0, Math.ceil(xs[k] - 0.5)), to = Math.min(cols - 1, Math.floor(xs[k + 1] - 0.5));
        for (let x = from; x <= to; x++) into[y * cols + x] = 1;
      }
    }
    return into;
  }
  // What the given units can see, together, on a cols x rows board: 1 per visible square. A unit sees from its centre;
  // its own squares are always visible. Windows and open doors don't block sight; walls and closed doors do.
  // With `light` ({ lit, dark: { unitId: darkvision feet } }, step 5), a square in sight counts only if it's lit, or
  // dark but within that unit's darkvision (SW5e: darkness within darkvision is seen as dim light).
  function visibleSquares(world, ids, cols, rows, light) {
    const vis = new Uint8Array(cols * rows), walls = (world.walls || []).filter(blocksSight);
    for (const id of ids) {
      const u = world.units[id];
      if (!u || u.down) continue;
      const s = u.size || 1, o = [u.x + s / 2, u.y + s / 2];
      if (!light) fillPolygon(sightPolygon(walls, o, cols, rows), cols, rows, vis);
      else {
        const own = fillPolygon(sightPolygon(walls, o, cols, rows), cols, rows, new Uint8Array(cols * rows)), dv = +((light.dark || {})[id]) || 0;
        for (let i = 0; i < own.length; i++) {
          if (!own[i] || vis[i]) continue;
          if (light.lit[i]) { vis[i] = 1; continue; }
          if (!dv) continue;
          const x = i % cols, y = (i - x) / cols;
          if (sqFeet(Math.max(0, u.x - x, x - (u.x + s - 1)), Math.max(0, u.y - y, y - (u.y + s - 1))) <= dv) vis[i] = 1;
        }
      }
      for (let x = u.x; x < u.x + s; x++) for (let y = u.y; y < u.y + s; y++) if (x >= 0 && y >= 0 && x < cols && y < rows) vis[y * cols + x] = 1;
    }
    return vis;
  }
  /* ---------------- light (issue #93, step 5): each square 2 bright, 1 dim or 0 dark ---------------- */
  // The map's own level ('bright', the default, 'dim' or 'dark') and its lights: { x, y } a point in squares, bright and
  // dim radii in feet (a glow rod 20/20: bright 20 ft, dim 20 ft beyond). A light reaches only where it can "see":
  // walls, closed doors and objects that block sight stop it. Distances count as the table measures (5/10 diagonals).
  const LIGHT_LEVELS = { bright: 2, dim: 1, dark: 0 };
  const sqFeet = (dx, dy) => { const a = Math.abs(dx), b = Math.abs(dy); return FT * (Math.max(a, b) + Math.floor(Math.min(a, b) / 2)); };
  function lightSquares(walls, lights, level, cols, rows) {
    const base = LIGHT_LEVELS[level] == null ? 2 : LIGHT_LEVELS[level], lit = new Uint8Array(cols * rows).fill(base);
    if (base === 2) return lit;
    const sight = (walls || []).filter(blocksSight);
    for (const l of lights || []) {
      const bright = Math.max(0, +l.bright || 0), reach = bright + Math.max(0, +l.dim || 0), lx = +l.x, ly = +l.y;
      if (!reach || !Number.isFinite(lx) || !Number.isFinite(ly)) continue;
      const r = reach / FT + 1, x0 = Math.max(0, Math.floor(lx - r)), x1 = Math.min(cols - 1, Math.ceil(lx + r)), y0 = Math.max(0, Math.floor(ly - r)), y1 = Math.min(rows - 1, Math.ceil(ly + r));
      if (x0 > x1 || y0 > y1) continue;
      // only walls near the light can stop it within its reach
      const near = sight.filter((w) => Math.max(w.a[0], w.b[0]) >= lx - r && Math.min(w.a[0], w.b[0]) <= lx + r && Math.max(w.a[1], w.b[1]) >= ly - r && Math.min(w.a[1], w.b[1]) <= ly + r);
      const area = fillPolygon(sightPolygon(near, [lx, ly], cols, rows), cols, rows, new Uint8Array(cols * rows));
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const i = y * cols + x;
        if (!area[i] || lit[i] === 2) continue;
        const d = sqFeet(Math.round(Math.abs(x + 0.5 - lx)), Math.round(Math.abs(y + 0.5 - ly)));   // squares from the light to this one
        const v = d <= bright ? 2 : d <= reach ? 1 : 0;
        if (v > lit[i]) lit[i] = v;
      }
    }
    return lit;
  }
  // a unit is seen if any of its squares is visible
  const seenIn = (vis, cols, rows, u) => {
    for (let x = u.x; x < u.x + (u.size || 1); x++) for (let y = u.y; y < u.y + (u.size || 1); y++) if (x >= 0 && y >= 0 && x < cols && y < rows && vis[y * cols + x]) return true;
    return false;
  };
  // the visible squares as a short string for the browser: base64 of the bits, row by row
  function packSquares(vis) {
    const bytes = new Uint8Array(Math.ceil(vis.length / 8));
    for (let i = 0; i < vis.length; i++) if (vis[i]) bytes[i >> 3] |= 1 << (i & 7);
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    return typeof btoa === 'function' ? btoa(bin) : Buffer.from(bin, 'binary').toString('base64');
  }
  function unpackSquares(str, n) {
    const bin = typeof atob === 'function' ? atob(str) : Buffer.from(str, 'base64').toString('binary');
    const vis = new Uint8Array(n);
    for (let i = 0; i < n; i++) vis[i] = (bin.charCodeAt(i >> 3) >> (i & 7)) & 1;
    return vis;
  }
  const overlaps = (ax, ay, as, b) => ax < b.x + (b.size || 1) && b.x < ax + as && ay < b.y + (b.size || 1) && b.y < ay + as;
  const hostile = (a, b) => a.side !== b.side;
  const ABILS_ALL = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
  // a unit by id, from the world's own units only: an id like "__proto__" or "constructor" is no unit (#147 review)
  const unitAt = (w, id) => (w && w.units && typeof id === 'string' && Object.prototype.hasOwnProperty.call(w.units, id) ? w.units[id] : null);

  // Every square the unit could move its top-left corner to with `feet` of movement: { "x,y": feet spent }.
  // By SW5e's grid rule: each straight step is 5 ft, diagonals alternate 5 ft and 10 ft, another creature's space is
  // difficult terrain (each step into it costs 5 ft more), and a prone unit crawls (every step costs double). A unit
  // may pass through allies, and through an enemy only one at least two sizes larger or smaller than itself; it may not
  // stop where another unit stands. Units the mover can't see (hidden ones, for a player) are not in the world at all,
  // so they never give themselves away by blocking. The diagonal count carries across a turn's moves (spent.diag):
  // stepping one diagonal at a time costs what one long move would, 5, 10, 5, 10…
  // Size: a stat block's size when the GM's screen sent it (0 Tiny … 5 Gargantuan), otherwise from the token's squares.
  const sizeCat = (o) => (o.sizeCat != null ? +o.sizeCat : [2, 2, 3, 4, 5][Math.min(4, o.size || 1)]);
  function search(world, unitId, feet) {
    const u = world.units[unitId];
    if (!u) return { out: {}, par: {}, prev: {}, at: {} };
    const start = unitId === world.turnId ? (+spentOf(world, unitId).diag ? 1 : 0) : 0;
    const others = Object.values(world.units).filter((o) => o.id !== u.id && !o.down);
    const size = u.size || 1, budget = Math.max(0, feet), crawl = (u.conditions || []).includes('Prone') ? 2 : 1;
    const blocked = (x, y) => others.some((o) => hostile(u, o) && overlaps(x, y, size, o) && Math.abs(sizeCat(u) - sizeCat(o)) < 2);
    // only the walls the move could reach (a big map's other walls cost nothing): a box around the mover, as far as its feet go
    const R = Math.ceil(budget / FT) + size + 1, x0 = u.x - R, x1 = u.x + size + R, y0 = u.y - R, y1 = u.y + size + R;
    const moveWalls = (world.walls || []).filter((w) => blocksMove(w) && Math.max(w.a[0], w.b[0]) >= x0 && Math.min(w.a[0], w.b[0]) <= x1 && Math.max(w.a[1], w.b[1]) >= y0 && Math.min(w.a[1], w.b[1]) <= y1);
    const occupied = (x, y) => others.some((o) => overlaps(x, y, size, o));
    const best = {}, out = {}, par = {}, prev = {}, at = {};
    const key = (x, y, p) => `${x},${y},${p}`;
    let open = [[0, u.x, u.y, start]];   // [feet, x, y, diagonal parity]
    best[key(u.x, u.y, start)] = 0;
    while (open.length) {
      open.sort((p, q) => p[0] - q[0]);
      const [c, x, y, pr] = open.shift();
      if (c > best[key(x, y, pr)]) continue;
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        if (!dx && !dy) continue;
        const nx = x + dx, ny = y + dy;
        if (nx < -500 || ny < -500 || nx > 1000 || ny > 1000 || blocked(nx, ny)) continue;
        if (moveWalls.length && !clear(moveWalls, [x + size / 2, y + size / 2], [nx + size / 2, ny + size / 2], () => true)) continue;
        const diag = dx && dy, np = diag ? 1 - pr : pr;
        const step = ((diag && pr ? 2 * FT : FT) + (occupied(nx, ny) ? FT : 0)) * crawl;
        const nc = c + step, k = key(nx, ny, np);
        if (nc > budget || (best[k] !== undefined && best[k] <= nc)) continue;
        best[k] = nc; prev[k] = key(x, y, pr);
        open.push([nc, nx, ny, np]);
        if (!occupied(nx, ny) && (out[`${nx},${ny}`] === undefined || out[`${nx},${ny}`] > nc)) { out[`${nx},${ny}`] = nc; par[`${nx},${ny}`] = np; at[`${nx},${ny}`] = k; }
      }
    }
    return { out, par, prev, at, start: key(u.x, u.y, start) };
  }
  const reachable = (world, unitId, feet) => search(world, unitId, feet).out;
  // Can a token get from where it stands to (tx, ty) without crossing a wall, a window or a closed door, however far
  // (issue #93: a player's drag under fog)? A walk over the board's own squares only: its edge is a wall too, so a
  // wall drawn to the edge can't be stepped round off the board, and a drop off the board is refused (review of #125).
  // Each step is a straight line between square centres as in search(); walls are filed by the squares they touch,
  // so a big map costs little. Other tokens never block it, and neither do objects that block only sight.
  function walkable(walls, cols, rows, t, tx, ty) {
    const s = Math.max(1, t.size || 1), X0 = 0, Y0 = 0, X1 = cols - s, Y1 = rows - s;
    const on = (x, y) => x >= X0 && y >= Y0 && x <= X1 && y <= Y1;
    if (t.x === tx && t.y === ty) return true;
    if (!on(tx, ty) || !on(t.x, t.y) || X1 < 0 || Y1 < 0) return false;   // off the board: not under fog
    const stops = (walls || []).filter(blocksMove);
    if (!stops.length) return true;
    // walls filed by the board squares they touch (a step's line, even a big token's, lies over board squares)
    const sq = (x, y) => y * cols + x, files = new Map();
    for (const w of stops) {
      const ax = Math.floor(Math.min(w.a[0], w.b[0]) - 0.01), bx = Math.floor(Math.max(w.a[0], w.b[0]) + 0.01), ay = Math.floor(Math.min(w.a[1], w.b[1]) - 0.01), by = Math.floor(Math.max(w.a[1], w.b[1]) + 0.01);
      for (let x = Math.max(0, ax); x <= Math.min(cols - 1, bx); x++) for (let y = Math.max(0, ay); y <= Math.min(rows - 1, by); y++) {
        const k = sq(x, y); if (!files.has(k)) files.set(k, []); files.get(k).push(w);
      }
    }
    // does a step cross a wall filed under any square its line passes over (no allocation: called for every step)
    const walled = (p, q) => {
      for (let x = Math.floor(Math.min(p[0], q[0])); x <= Math.floor(Math.max(p[0], q[0])); x++) for (let y = Math.floor(Math.min(p[1], q[1])); y <= Math.floor(Math.max(p[1], q[1])); y++) {
        if (x < 0 || x >= cols || y < 0 || y >= rows) continue;
        const f = files.get(sq(x, y));
        if (f) for (const w of f) if (crosses(p, q, w.a, w.b)) return true;
      }
      return false;
    };
    // where the token's top-left square may stand: anywhere it fits on the board
    const W = X1 - X0 + 1, H = Y1 - Y0 + 1, cell = (x, y) => (y - Y0) * W + (x - X0);
    const seen = new Uint8Array(W * H), queue = [[t.x, t.y]];
    seen[cell(t.x, t.y)] = 1;
    while (queue.length) {
      const [x, y] = queue.pop();
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        const nx = x + dx, ny = y + dy;
        if ((!dx && !dy) || nx < X0 || ny < Y0 || nx > X1 || ny > Y1 || seen[cell(nx, ny)]) continue;
        const p = [x + s / 2, y + s / 2], q = [nx + s / 2, ny + s / 2];
        if (walled(p, q)) continue;
        if (nx === tx && ny === ty) return true;
        seen[cell(nx, ny)] = 1; queue.push([nx, ny]);
      }
    }
    return false;
  }
  // the squares a move passes through, from where the unit stands to (x, y), by the cheapest way; null if out of reach
  function pathTo(world, unitId, feet, x, y) {
    const s = search(world, unitId, feet);
    let k = s.at[`${x},${y}`];
    if (!k) return null;
    const path = [];
    while (k) { const [px, py] = k.split(',').map(Number); path.unshift({ x: px, y: py }); k = k === s.start ? null : s.prev[k]; }
    return path;
  }

  /* ---------------- attacks ---------------- */
  // An attack spec: { name, bonus, damage, crit, type, melee: reach in feet or 0, range: [normal, long] or null }.
  // Reach and range come from the weapon's properties text: "Reach" adds 5 ft; "Thrown (20/60)", "Range (80/320)",
  // "Ammunition (range 80/320)" give a range. A weapon with no range is melee with 5 ft reach.
  function readRange(props) {
    const p = String(props || '');
    const m = /(?:range|thrown)[^0-9]{0,12}(\d+)\s*\/\s*(\d+)/i.exec(p) || /\((\d+)\s*\/\s*(\d+)\)/.exec(p);
    const range = m ? [+m[1], +m[2]] : null;
    const thrown = /thrown/i.test(p), reach = /\breach\b/i.test(p);
    const melee = !range || thrown ? (reach ? 2 * FT : FT) : 0;
    return { melee, range };
  }
  // Weapon properties that change an attack (audit 5.8), read from the properties text as SW5e writes it:
  //   Versatile (1d10): the two-handed die for a melee attack; Heavy: half the Strength modifier (at least 1) on a hit
  //   with a Strength attack; Strength N / Dexterity N: disadvantage unless the wielder's score is at least N.
  function weaponProps(ch, a, abil, rules) {
    const p = String(a.props || ''), out = {};
    const v = /\bversatile\s*\(\s*(\d*d\d+)\s*\)/i.exec(p);
    if (v) out.versatile = v[1].toLowerCase();
    if (/\bheavy\b/i.test(p) && abil === 'str') out.heavy = Math.max(1, Math.floor(rules.abilityMod(ch, 'str') / 2));
    const burst = /\bburst\s+(\d{1,2})\b/i.exec(p), rapid = /\brapid\s+(\d{1,2})\b/i.exec(p);
    if (burst) out.burst = +burst[1];
    if (rapid) out.rapid = +rapid[1];
    if (/\blight\b/i.test(p)) out.light = true;
    if (/\btwo-handed\b/i.test(p)) out.twoHanded = true;             // Great Weapon Style needs it (#150)                       // Two- and Double-Weapon Fighting need it
    const dbl = /\bdouble\s*\(\s*(\d*d\d+)/i.exec(p);                  // "Double (1d6 kinetic)": the other end's damage
    if (dbl) out.otherEnd = dbl[1].toLowerCase();
    for (const [, name, n] of p.matchAll(/\b(strength|dexterity)\s+(\d{1,2})\b/gi)) {
      const k = name.toLowerCase() === 'strength' ? 'str' : 'dex', score = +((ch.abilities || {})[k]) || 10;
      if (score < +n) out.unmet = `${name[0].toUpperCase()}${name.slice(1).toLowerCase()} ${n}`;
    }
    return out;
  }
  /* ---------------- the Monk's Martial Arts (#67, 3.7's combat half) ---------------- */
  // SW5e's Monk, in our own words: unarmed strikes and monk weapons (vibroweapons without the dexterity, heavy, special
  // or two-handed property) get finesse and may roll the Martial Arts die in place of their own damage; after the Attack
  // action with one, an unarmed strike as a bonus action (Flurry of Blows: one more for a focus point); Dash and
  // Disengage as a bonus action; Dex for the Athletics of a grapple or shove. All of it only while the sheet has no
  // armor or shield equipped (its gear's armor rows, as rules.js armorClass reads them).
  const wearsArmor = (ch) => ((ch && ch.equipment) || []).some((e) => e && e.equipped && e.armor && ['light', 'medium', 'heavy', 'shield'].includes(e.armor.kind));
  const monkColumn = (ch, rules, h) => {
    if (!rules || !rules.classTableAt || wearsArmor(ch)) return '';
    const row = rules.classTableAt(ch).find((x) => x.cls === 'Monk');
    return String((row && (row.cols.find(([k]) => k === h) || [])[1]) || '');
  };
  function martialDieOf(ch, rules) {
    const v = monkColumn(ch, rules, 'Martial Arts');
    return /^d\d+$/.test(v) ? v : null;
  }
  // Unarmored Movement: the feet in its column of the Monk table, added to the sheet's speed (the sheet keeps the base)
  function unarmoredMoveOf(ch, rules) {
    const m = /^\+?(\d+)\s*ft/i.exec(monkColumn(ch, rules, 'Unarmored Movement'));
    return m ? +m[1] : 0;
  }
  const isUnarmed = (a) => /\bunarmed\b/i.test(String((a && a.name) || ''));
  const monkWeapon = (a) => isUnarmed(a) || (!/\b(dexterity|heavy|special|two-handed|range|ammunition|power cell|reload)\b/i.test(String(a.props || '')));
  // the Martial Arts die in place of a weapon's own dice, when it's better on average
  function martialDamage(expr, die) {
    const m = /^(\d*)d(\d+)/i.exec(String(expr || '')), s = +String(die).slice(1);
    if (!m) return '1' + die + String(expr || '').replace(/^\d+/, '');
    const n = +m[1] || 1, avg = n * (+m[2] + 1) / 2;
    return (s + 1) / 2 > avg ? String(expr).replace(/^(\d*)d(\d+)/i, '1d' + s) : String(expr);
  }
  // the attacks on a character sheet, with HoloTable's own arithmetic (rules.js)
  function attacksOf(ch, rules) {
    const st = stylesOf(ch), md = martialDieOf(ch, rules);
    // a monk's unarmed strikes and monk weapons as Martial Arts makes them, and an unarmed strike if the sheet has none
    const rows = (ch.attacks || []).map((a) => (md && monkWeapon(a) && !/\b(range|thrown)\b/i.test(String(a.props || '')) ? Object.assign({}, a, { ab: 'finesse', damage: martialDamage(a.damage || (isUnarmed(a) ? '1' : ''), md), martial: true }) : a));
    const extra = md && !rows.some((a) => isUnarmed(a)) ? [{ name: 'Unarmed strike', ab: 'finesse', damage: '1' + md, type: 'kinetic', props: '', martial: true, key: 'ua' }] : [];
    return rows.concat(extra).map((a, i) => {
      const damage = rules.damageExpr(ch, a);
      const ab = a.ab === 'finesse' ? (rules.abilityMod(ch, 'dex') > rules.abilityMod(ch, 'str') ? 'dex' : 'str') : ABILS.includes(a.ab) ? a.ab : 'str';
      const bonus = rules.attackBonus(ch, a), wp = weaponProps(ch, a, ab, rules);
      // critFrom: the sheet's crit range (#165) or a Keen N weapon (R.critFrom), a crit on this d20 or higher
      return Object.assign({ key: a.key || String(i), name: a.name || 'Attack', bonus, abil: ab, damage, crit: rules.critExpr(damage), type: a.type || '', enhanced: +a.magic > 0,
        finesse: a.ab === 'finesse' || /\bfinesse\b/i.test(String(a.props || '')), weapon: true, proficient: a.proficient !== false,
        ...(a.martial ? { martial: true, unarmed: isUnarmed(a) } : {}),
        ...(rules.reloadOf && rules.reloadOf(a) ? { reload: rules.reloadOf(a), ammo: rules.ammoOf(a) } : {}),   // shots and reload (6.6, #179); Brutal Critical and the crit range next
        ...(rules.brutalDice && rules.isMelee && rules.isMelee(a) && rules.brutalDice(ch) ? { brutal: rules.brutalDice(ch) } : {}),
        ...(() => { const k = Math.min(+a.critRange >= 15 && +a.critRange < 20 ? Math.round(+a.critRange) : 20, rules.critFrom ? +rules.critFrom(a.props) || 20 : 20); return k < 20 ? { critFrom: k } : {}; })() }, readRange(a.props), wp, offhandNumbers(ch, a, ab, bonus, wp, st, rules));
    }).filter((a) => a.melee || a.range);
  }
  /* ---------------- Two- and Double-Weapon Fighting (audit 5.8) ---------------- */
  // The fighting styles that change them, read from the sheet's features ("Dual Wield Style", "Fighting Style: Split")
  function stylesOf(ch) {
    const names = ((ch && ch.features) || []).map((f) => String((f && f.name) || '').toLowerCase().replace(/fighting style|style|[:()\[\]\-–—]/g, ' ').replace(/\s+/g, ' ').trim());
    const has = (n) => names.includes(n);
    return { twfDamage: has('dual wield') || has('split'), dwfAttack: has('twin blade') || has('split'), greatWeapon: has('great weapon'), snapshot: has('snapshot'), sharpshooter: has('sharpshooter') };
  }
  // SW5e's minimum roll threshold (PHB chapter 7, #150): no die counts under 2 (d4, d6), 3 (d8), 4 (d10), 5 (d12) or
  // 8 (d20). Written into an expression as the roller's `min` suffix: "1d12+3" becomes "1d12min5+3".
  const MIN_THRESHOLD = { 4: 2, 6: 2, 8: 3, 10: 4, 12: 5, 20: 8 };
  const withThreshold = (expr) => String(expr).replace(/(\d*)d(\d+)(?![\dkdm!])/gi, (all, n, sides) => (MIN_THRESHOLD[sides] ? `${all}min${MIN_THRESHOLD[sides]}` : all));
  // whose weapon damage gets one: Great Weapon Style with a two-handed melee weapon (or a versatile one in both hands)
  // it's proficient with; Snapshot Style with a ranged weapon (not a thrown one) against a creature within 30 ft
  function thresholdFor(a, attack, ranged, feet, twoHands) {
    const st = (a && a.styles) || {};
    if (!attack || !attack.weapon) return '';
    if (st.greatWeapon && !ranged && attack.proficient !== false && (attack.twoHanded || twoHands)) return 'Great Weapon Style';
    if (st.snapshot && ranged && !attack.melee && feet <= 30) return 'Snapshot Style';
    return '';
  }
  // A light weapon's off-hand attack (Two-Weapon Fighting): no positive ability modifier on its damage. A light and
  // double weapon's other end (Double-Weapon Fighting): the die in its Double property, no positive ability modifier on
  // its attack roll. The styles above put the modifier back. A damage box typed in full is left as it is.
  function offhandNumbers(ch, a, ab, bonus, wp, st, rules) {
    if (!wp.light) return {};
    const mod = rules.abilityMod(ch, ab), magic = +a.magic || 0, plus = (n) => (n ? (n > 0 ? '+' : '') + n : '');
    const out = { offDamage: a.damageFull ? a.damageFull : (a.damage || '1') + plus((st.twfDamage || mod < 0 ? mod : 0) + magic) };
    if (wp.otherEnd) Object.assign(out, { endDamage: wp.otherEnd + plus(mod + magic), endBonus: bonus - (st.dwfAttack || mod < 0 ? 0 : mod) });
    return out;
  }
  // Can this be the Martial Arts bonus strike now? An unarmed strike after the Attack action with one or a monk weapon:
  // the first takes the bonus action; Flurry of Blows makes a second for a focus point. { spec, flurry } or { why }
  function martialOf(w, me, a) {
    if (!me || !me.monk || !a || !a.unarmed) return { why: 'The Martial Arts bonus attack is a monk\'s unarmed strike.' };
    const sp = spentOf(w, me.id), b = budget(w, me.id), focus = (me.pools || {}).focus;
    if (!sp.ma) return { why: `${me.name} takes the Attack action first, with an unarmed strike or a monk weapon.` };
    if (!sp.mab) return b.bonus ? { spec: Object.assign({}, a, { name: `${a.name} (bonus)` }) } : { why: `${me.name} has already used the bonus action this turn.` };
    if (sp.mab === 1) return focus && focus.used < focus.max ? { spec: Object.assign({}, a, { name: `${a.name} (Flurry of Blows)` }), flurry: true } : { why: `${me.name} has no focus points left for Flurry of Blows.` };
    return { why: `${me.name} has made both Martial Arts strikes this turn.` };
  }
  // Can this attack be a bonus action attack now, and as what? { spec } or { why }. After the Attack action: the other
  // end of the light and double weapon it attacked with, or a different light weapon from the light one it attacked
  // with. One bonus attack (two for a Fighter from 11th level, Greater Extra Attack).
  function offhandOf(w, me, a) {
    if (!me || me.side !== 'pc' || !a || !a.weapon) return { why: 'Only a character\'s weapon makes a bonus attack this way.' };
    const sp = spentOf(w, me.id), b = budget(w, me.id);
    if (!(sp.off ? sp.off < (+me.offhands || 1) : b.bonus)) return { why: sp.off ? `${me.name} has made ${sp.off === 1 ? 'its bonus attack' : 'both bonus attacks'} this turn.` : `${me.name} has already used the bonus action this turn.` };
    if (!sp.atk) return { why: `${me.name} takes the Attack action first, with a light weapon.` };
    const key = String(a.key);
    if (a.otherEnd && a.endDamage && sp.dw && key === String(sp.dw - 1)) {
      return { kind: 'double', spec: Object.assign({}, a, { name: `${a.name} (other end)`, bonus: a.endBonus, damage: a.endDamage, crit: doubleDice(a.endDamage), versatile: null }) };
    }
    if (!a.light) return { why: `${a.name} isn't a light weapon.` };
    if (!sp.lt) return { why: `${me.name} didn't attack with a light weapon this turn.` };
    if (key === String(sp.lt - 1)) return { why: `Two-Weapon Fighting takes a different light weapon from the one ${me.name} attacked with.` };
    const dmg = a.offDamage || a.damage;
    return { kind: 'two', spec: Object.assign({}, a, { name: `${a.name} (off-hand)`, damage: dmg, crit: doubleDice(dmg), versatile: null }) };
  }
  // a creature's attack from its stat block entry ({ n, atk, dmg, dt, rng, d } as HoloTable's creature list keeps it)
  function attackFromBehavior(b) {
    if (!b || b.atk == null || !b.dmg) return null;
    const text = `${b.rng || ''} ${b.d || ''}`;
    const reach = /reach\s*(\d+)\s*f/i.exec(text), range = /range\s*(\d+)(?:\s*\/\s*(\d+))?\s*f/i.exec(text);
    const damage = String(b.dmg).replace(/\s+/g, '');
    return {
      name: b.n, bonus: +b.atk, damage, crit: damage.replace(/(\d*)d(\d+)/gi, (_, n, s) => (2 * (+n || 1)) + 'd' + s), type: b.dt || '',
      melee: reach ? +reach[1] : range ? 0 : FT, range: range ? [+range[1], +(range[2] || range[1])] : null,
    };
  }
  // Reasons that tilt a roll. Each is data: who it applies to and which way. Conditions and features join this list later.
  const REASONS = [
    { id: 'long', dis: true, text: 'long range', when: (c) => c.ranged && c.feet > c.attack.range[0] },
    { id: 'close', dis: true, text: 'an enemy within 5 ft', when: (c) => c.ranged && c.enemyClose && !(((c.actor || {}).styles || {}).snapshot && c.attack.weapon) },   // Snapshot Style (#150)
    { id: 'help', adv: true, text: 'helped', each: (c) => { const ef = helpOn(c.world, c.actor, c.target); return [{ adv: true, text: `${ef.condition === 'Distracted' ? 'distracted by' : 'helped by'} ${unitAt(c.world, ef.source).name}` }]; }, when: (c) => !!helpOn(c.world, c.actor, c.target) },   // #144
  ];
  /* ---------------- conditions that take effect (issue #72) ---------------- */
  // What each condition does to the arithmetic, following HoloTable's own descriptions in rules.js (CONDITIONS).
  // Only the plainly mechanical parts are here; a condition with no entry is a label, as it is today. Later
  // conditions (levels of Slowed or Exhaustion, Ignited's damage) are new entries, not new code.
  // Checked against SW5e's Player's Handbook, appendix A (not only HoloTable's one-line tooltips), in our own words.
  // Slowed and Corroded take their level, and Ignited its damage, from the effect that gave them (the DM's form or an
  // ability's data); one set by hand as a bare name stays a label. Frightened, Blinded and Invisible always apply
  // (sight and special senses aren't modelled; the DM overrides). These defaults are the coordinator's, 17 Nov 2026.
  const CONDITION_EFFECTS = {
    Blinded: { attacks: 'dis', attacked: 'adv' },
    Charmed: { charmed: true },                              // can't attack whoever charmed it (when the combat view knows who)
    Frightened: { attacks: 'dis', checksDis: true },         // while its source is in sight (when the source is known and there are walls)
    Grappled: { speed0: true },
    Incapacitated: { noActions: true },                      // no actions and no reactions
    Invisible: { attacks: 'adv', attacked: 'dis' },
    Paralyzed: { noActions: true, speed0: true, autoFail: ['str', 'dex'], attacked: 'adv', closeCrit: true },
    Petrified: { noActions: true, speed0: true, autoFail: ['str', 'dex'], attacked: 'adv', resistAll: true, immune: ['poison'], condImmune: ['Poisoned', 'Diseased'] },
    Poisoned: { attacks: 'dis', checksDis: true },
    Prone: { attacks: 'prone', attacked: 'near', crawl: true }, // melee, and ranged within 30 ft, at disadvantage; crawls
    Restrained: { speed0: true, attacks: 'dis', attacked: 'adv', saveDis: ['dex'] },   // the book: 4 slowed levels, so speed 0
    Shocked: { noReactions: true, oneAction: true },         // an action or a bonus action, not both; speed is not affected
    Stunned: { noActions: true, speed0: true, autoFail: ['str', 'dex'], attacked: 'adv' },
    Unconscious: { noActions: true, speed0: true, autoFail: ['str', 'dex'], attacked: 'adv', closeCrit: true },
    Weakened: { weakened: true },                            // healing halved; half of a positive ability modifier
    Slowed: { levels: 4 },                                   // speed −15 / −25 / −30 ft, then 0
    Corroded: { levels: 3 },                                 // 1 more damage from weapons for each level
    Ignited: { burns: true },                                // fire damage at the end of each of its turns, until put out
    // a Berserker's rage (audit 5.9): Rage Damage on Strength melee weapon attacks, resistance to kinetic and energy,
    // advantage on Strength saves; 1 minute (10 of its turns), and it ends if the berserker drops
    Raging: { rage: true, resist: ['kinetic', 'energy'], saveAdv: ['str'] },
  };
  /* ---------------- senses (audit 5.12): { kind, range } on a unit ---------------- */
  // SW5e's creature data uses blindsight, darkvision, tremorsense and truesight. In our words: blindsight perceives
  // without sight within its range; truesight sees invisible things within its range; darkvision sees in the dark
  // (lighting isn't modelled yet, so it changes nothing here). SW5e's books don't define tremorsense; the default here
  // treats it like blindsight within its range (the table has no flying or height to tell ground from air).
  const SENSES = ['blindsight', 'darkvision', 'tremorsense', 'truesight'];
  const NO_SIGHT = ['blindsight', 'tremorsense'];                 // perceives without eyes: being blinded doesn't stop it
  const SEES_INVISIBLE = ['blindsight', 'tremorsense', 'truesight'];
  // a stat block's senses line ("blindsight 30 ft. (blind beyond this radius)") as data; anything else is ignored
  function readSenses(lines) {
    const out = [];
    for (const line of Array.isArray(lines) ? lines : [lines]) {
      for (const part of String(line || '').split(/[,;]/)) {
        const m = /\b(blindsight|darkvision|tremorsense|truesight)\s+(\d{1,4})\s*(ft|feet)/i.exec(part);
        if (m && !out.some((x) => x.kind === m[1].toLowerCase())) out.push({ kind: m[1].toLowerCase(), range: Math.min(9999, +m[2]) });
      }
    }
    return out;
  }
  const cleanSenses = (list) => (Array.isArray(list) ? list : []).filter((x) => x && SENSES.includes(x.kind)).slice(0, 4)
    .map((x) => ({ kind: x.kind, range: clampN(Math.round(+x.range) || 0, 0, 9999) })).filter((x) => x.range > 0);
  // the sense with which `a` perceives `b`, out of `kinds`, if `b` is within its range
  const senseFor = (a, b, kinds) => (a && b && (a.senses || []).find((x) => kinds.includes(x.kind) && feetBetween(a, b) <= x.range)) || null;
  // Light in a fight (issue #93, step 5): world.light = { lit, cols, rows } while the map is dimmed or dark under fog.
  // A unit stands in the dark when none of its squares is lit. `a` can see `b` as far as light goes when `b` is lit, or
  // within a's darkvision, or a perceives it without light (blindsight, tremorsense, truesight) within range.
  function inDark(w, u) {
    const L = w && w.light;
    if (!L || !L.lit || !u) return false;
    for (let x = u.x; x < u.x + (u.size || 1); x++) for (let y = u.y; y < u.y + (u.size || 1); y++)
      if (x >= 0 && y >= 0 && x < L.cols && y < L.rows && L.lit[y * L.cols + x]) return false;
    return true;
  }
  const seesInLight = (w, a, b) => !inDark(w, b) || !!senseFor(a, b, ['darkvision', 'blindsight', 'tremorsense', 'truesight']);
  // a sense that takes the bite out of a condition between two units: the blinded one perceiving the other without
  // sight, or the other one finding the invisible one. Returns { who, sense } for the preview's note, or null.
  // the source of a condition on `u`, when an effect recorded who caused it
  const sourceOf = (w, u, cond) => { const ef = ((w && w.effects) || []).find((x) => x.unit === u.id && x.condition === cond && x.source); return ef && w.units[ef.source] || null; };
  function defeated(cond, holder, other) {
    if (cond === 'Blinded') { const x = senseFor(holder, other, NO_SIGHT); return x && { who: holder, sense: x }; }
    if (cond === 'Invisible') { const x = senseFor(other, holder, SEES_INVISIBLE); return x && { who: other, sense: x }; }
    return null;
  }
  const senseNote = (d, cond) => ({ note: true, text: `${d.who.name}'s ${d.sense.kind} (${d.sense.range} ft): ${cond.toLowerCase()} doesn't count` });
  const effectsOf = (u) => (u.conditions || []).map((c) => [c, CONDITION_EFFECTS[c]]).filter(([, e]) => e);
  // heavily encumbered (the table's encumbrance variant, audit 6.5): disadvantage on Str, Dex and Con checks, attacks and saves
  const heavyDis = (u, abil) => !!u && u.encumbered === 'heavy' && ['str', 'dex', 'con'].includes(abil);
  const has = (u, flag) => effectsOf(u).find(([, e]) => e[flag]);
  const INCAPACITATING = (u) => !!has(u, 'noActions');
  const LEVELS = { Slowed: 4, Corroded: 3 }, SLOWED_FT = [0, 15, 25, 30];
  // a levelled condition's level: the sum of the effects that gave it (more slowing adds levels), up to its top level
  const levelOf = (w, u, c) => (u && (u.conditions || []).includes(c)
    ? Math.min(LEVELS[c], ((w && w.effects) || []).filter((ef) => ef.unit === u.id && ef.condition === c).reduce((n, ef) => n + (+ef.level || 0), 0)) : 0);
  const burnOf = (w, u) => (u && (u.conditions || []).includes('Ignited')
    ? (((w && w.effects) || []).find((ef) => ef.unit === u.id && ef.condition === 'Ignited' && ef.amount) || {}).amount || '' : '');
  // weakened: only half of a positive ability modifier (rounded down) counts on attack rolls and saves
  const weakPenalty = (u, ab) => { const m = +((u && u.mods) || {})[ab]; return u && has(u, 'weakened') && m > 0 ? m - Math.floor(m / 2) : 0; };
  const immuneTo = (t, cond) => (t.condImmune || []).concat(...effectsOf(t).map(([, e]) => e.condImmune || [])).some((c) => String(c).toLowerCase() === String(cond).toLowerCase());
  // conditions join the reasons a roll tilts: the attacker's own, then the target's
  REASONS.push(
    { id: 'self', when: (c) => effectsOf(c.actor).some(([, e]) => e.attacks), each: (c) => effectsOf(c.actor).filter(([, e]) => e.attacks)
      .filter(([, e]) => e.attacks !== 'prone' || !c.ranged || c.feet <= 30)   // prone: melee, or ranged at a target within 30 ft
      .map(([n, e]) => {
        const d = defeated(n, c.actor, c.target);
        if (d) return senseNote(d, n);
        if (n === 'Frightened') { const src = sourceOf(c.world, c.actor, n); if (src && !sees(c.world, c.actor, src)) return { note: true, text: `frightened, but ${src.name} is out of sight` }; }
        return { [e.attacks === 'prone' ? 'dis' : e.attacks]: true, text: `${c.actor.name} is ${n.toLowerCase()}` };   // the table reads the line too
      }) },
    { id: 'dark', when: (c) => !!(c.world && c.world.light), each: (c) => {   // unseen in the dark (step 5): attacking what you can't see, or being attacked by it
      const out = [], blind = (u) => (u.conditions || []).includes('Blinded');
      if (!blind(c.actor) && !seesInLight(c.world, c.actor, c.target)) out.push({ dis: true, text: `${c.target.name} is unseen in the dark` });
      if (!blind(c.target) && !seesInLight(c.world, c.target, c.actor)) out.push({ adv: true, text: `${c.actor.name} is unseen in the dark` });
      return out;
    } },
    { id: 'exhausted', when: (c) => (+c.actor.exhaustion || 0) >= 3, each: () => [{ dis: true, text: 'exhaustion' }] },
    { id: 'heavy', when: (c) => heavyDis(c.actor, c.attack && c.attack.abil), each: () => [{ dis: true, text: 'heavily encumbered' }] },   // the encumbrance variant (6.5)
    { id: 'requirement', when: (c) => !!(c.attack && c.attack.unmet), each: (c) => [{ dis: true, text: `${c.attack.unmet} not met` }] },   // a weapon's Strength or Dexterity number (5.8)
    { id: 'dodge', when: (c) => c.dodging, each: (c) => [{ dis: true, text: `${c.target.name} is dodging` }] },
    { id: 'target', when: (c) => effectsOf(c.target).some(([, e]) => e.attacked), each: (c) => effectsOf(c.target).filter(([, e]) => e.attacked).map(([n, e]) => {
      const d = defeated(n, c.target, c.actor);
      if (d) return senseNote(d, n);
      const way = e.attacked === 'near' ? (c.feet <= FT ? 'adv' : 'dis') : e.attacked;
      return { [way]: true, text: `${c.target.name} is ${n.toLowerCase()}` };
    }) },
  );

  // Every reason an attack roll from `a` at `t` tilts, as { adv | dis, text } or a { note } saying why one doesn't
  // (a sense defeating a condition): shared by weapon attacks, powers' attack rolls and both previews, so what the
  // preview says is what the server rolls. An enemy close by counts only if it can perceive you (not blinded, unless a
  // sense makes up for it) and can act.
  function reasons(world, a, t, attack, feet, ranged) {
    const enemyClose = Object.values(world.units).some((o) => o.id !== a.id && hostile(a, o) && !o.down && feetBetween(a, o) <= FT
      && (!(o.conditions || []).includes('Blinded') || senseFor(o, a, NO_SIGHT)) && !INCAPACITATING(o));
    const ctx = { feet, ranged, enemyClose, attack, actor: a, target: t, dodging: dodging(world, t), world };
    return REASONS.filter((r) => r.when(ctx)).flatMap((r) => (r.each ? r.each(ctx) : [{ dis: !!r.dis, adv: !!r.adv, text: r.text }]))
      .map((x) => (x.note ? { note: true, text: x.text } : { dis: !!x.dis, adv: !!x.adv, text: x.text }));
  }
  /* ---------------- SW5e's variant rules (audit 9.16), applied only when the GM has marked them for this table ---------------- */
  const variant = (w, name) => ((w && w.variants) || []).includes(name);
  // the d20s for a roll: plain advantage and disadvantage cancel; with Compound Advantage, sources stack up to three
  // (super- and hyperadvantage: three and four d20s) and opposite sources cancel one for one
  function d20(w, advN, disN) {
    if (!variant(w, 'Compound Advantage')) { const a = advN > 0, d = disN > 0; return a && !d ? { mode: 'adv', k: 2 } : d && !a ? { mode: 'dis', k: 2 } : { mode: 'normal', k: 1 }; }
    const net = Math.max(-3, Math.min(3, advN - disN));
    return net > 0 ? { mode: 'adv', k: net + 1 } : net < 0 ? { mode: 'dis', k: 1 - net } : { mode: 'normal', k: 1 };
  }
  const d20expr = (m) => (m.mode === 'normal' ? '1d20' : `${m.k}d20${m.mode === 'adv' ? 'kh1' : 'kl1'}`);
  const modeName = (m) => (m.mode === 'normal' ? '' : (m.k === 3 ? 'super' : m.k === 4 ? 'hyper' : '') + (m.mode === 'adv' ? 'advantage' : 'disadvantage'));
  const d20chance = (m, p) => (m.mode === 'adv' ? 1 - (1 - p) ** m.k : m.mode === 'dis' ? p ** m.k : p);
  // Flanking (the variant): a creature engaged by more than one enemy within 5 ft is flanked against sources within 5 ft
  // of it. SW5e measures it as how surrounded it is; the default here counts the sides (north, east, south, west) its
  // enemies within 5 ft stand on: one side is one-quarter (-2), two half (-3), three or four three-quarters (-5).
  // A creature hidden from players (marked .hidden in the GM's world) counts only when the attacker or the target is
  // hidden too, which is when the line goes to the GM alone; otherwise "flanked" on a public line would give it away.
  function flankOf(w, t, src) {
    if (!variant(w, 'Flanking') || !t || !src || feetBetween(src, t) > FT) return 0;
    const secret = !!(src.hidden || t.hidden);
    const near = Object.values(w.units).filter((o) => o.id !== t.id && (secret || !o.hidden) && hostile(o, t) && !o.down && !INCAPACITATING(o) && feetBetween(o, t) <= FT);
    if (near.length < 2) return 0;
    const ts = t.size || 1, cx = t.x + ts / 2, cy = t.y + ts / 2, sides = new Set();
    for (const o of near) {
      const dx = o.x + (o.size || 1) / 2 - cx, dy = o.y + (o.size || 1) / 2 - cy;
      sides.add(Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 'E' : 'W') : (dy > 0 ? 'S' : 'N'));
    }
    return [0, 2, 3, 5, 5][sides.size];
  }
  // a dice expression's lowest or highest total ("2d6+3": 5 or 15), for Critical Saving Throws and Crueler Criticals
  function fixedTotal(expr, top) {
    let n = 0;
    for (const m of String(expr).replace(/\s+/g, '').matchAll(/([+-]?)(\d*d\d+|\d+)/gi)) {
      const sg = m[1] === '-' ? -1 : 1, t = m[2];
      const dm = /^(\d*)d(\d+)$/i.exec(t);
      n += sg * (dm ? (+dm[1] || 1) * (top ? +dm[2] : 1) : +t);
    }
    return n;
  }
  // the dice alone at their maximum ("1d8+3": 8)
  const maxDice = (expr) => [...String(expr).matchAll(/(\d*)d(\d+)/gi)].reduce((n, m) => n + (+m[1] || 1) * +m[2], 0);
  // Crueler Criticals: one set of the dice at their maximum, the other rolled, the modifier once
  const cruel = (expr) => `${expr}+${maxDice(expr)}`;
  // Can `actorId` hit `targetId` with `attack` right now, and what would it take?
  /* ---------------- Extra Attack (#139) ---------------- */
  // How many attacks one Attack action gives a character: SW5e's Extra Attack by class level (Fighter's later features
  // make it three and four), and the archetypes that grant it. Multiclassing doesn't add them up; the best one counts.
  // A feature on the sheet named "Extra Attack" counts as two, for a sheet whose classes don't say.
  const EXTRA_ATTACK = { berserker: [5], fighter: [5, 11, 20], guardian: [5], monk: [5], scout: [5], sentinel: [5] };
  const EXTRA_ARCHETYPE = { 'armormech engineering': 6, 'detective pursuit': 6, 'pugnacity practice': 9 };
  function attacksPerAction(ch) {
    let n = 1;
    for (const k of (ch && ch.classes) || []) {
      const L = +k.level || 0, low = (x) => String(x || '').trim().toLowerCase();
      n = Math.max(n, 1 + (EXTRA_ATTACK[low(k.name)] || []).filter((at) => L >= at).length);
      if (L >= (EXTRA_ARCHETYPE[low(k.archetype)] || 99)) n = Math.max(n, 2);
    }
    if (((ch && ch.features) || []).some((f) => f && /^extra attack\b/i.test(String(f.name || '')))) n = Math.max(n, 2);
    return Math.min(4, n);
  }
  // Greater Extra Attack: from Fighter 11, a Two- or Double-Weapon Fighting bonus action makes two attacks
  const bonusAttacksOf = (ch) => ((ch && ch.classes) || []).some((k) => String(k.name || '').trim().toLowerCase() === 'fighter' && +k.level >= 11) ? 2 : 1;
  // A creature's attacks per Attack action, from its stat block's Multiattack text: "makes three attacks: two with its
  // claws and one with its bite" is 3, "attacks twice" is 2, "makes one bite attack and one slam attack" is 2. Between
  // alternatives ("two melee attacks or four ranged attacks") the largest counts. Which attacks it may combine, and
  // conditions such as "if it has half its hit points or fewer", aren't checked; the GM picks.
  const COUNT_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, twice: 2, thrice: 3 };
  function multiattackOf(text) {
    const t = String(text || '').slice(0, 2500), num = (x) => COUNT_WORDS[x.toLowerCase()] || +x || 0;
    let n = 0;
    for (const m of t.matchAll(/\b(one|two|three|four|five|six|\d)\b(?=\s+(?:[\w-]+\s+){0,4}?attacks?\b)/gi)) n = Math.max(n, num(m[1]));
    for (const m of t.matchAll(/\battacks?\s+(twice|thrice)\b/gi)) n = Math.max(n, num(m[1]));
    const mk = /\bmakes?\s+(one|two|three|four|five|six|\d)\b/i.exec(t);
    if (mk) n = Math.max(n, num(mk[1]));
    if (n <= 1) n = Math.max(1, (t.match(/\bone\b[^,.;:]*?\battacks?\b/gi) || []).length);
    return clampN(n, 1, 6);
  }
  /* ---------------- maneuvers: superiority dice spent on an attack (#67, the combat view's half) ---------------- */
  // SW5e's chapter 13, in our own words. One maneuver per attack, each once a turn, a die from the superiority pool
  // (Fighter or Scholar); the die is spent on the hit (Precision Attack: when it's used). Large or smaller only, where
  // the maneuver says so. Its save DC: 8 + proficiency + the best of the type's abilities (physical Str/Dex/Con, mental
  // Int/Wis/Cha, general any).
  const MANEUVERS = {
    'trip-attack': { name: 'Trip Attack', type: 'physical', save: 'str', large: true, then: 'prone' },
    'pushing-attack': { name: 'Pushing Attack', type: 'physical', save: 'str', large: true, then: 'push' },
    'menacing-attack': { name: 'Menacing Attack', type: 'mental', save: 'wis', then: 'frightened' },
    'distracting-blow': { name: 'Distracting Blow', type: 'mental', then: 'distract' },
    'crippling-blow': { name: 'Crippling Blow', type: 'physical', then: 'slowed' },
    'weak-point-strike': { name: 'Weak Point Strike', type: 'physical', save: 'con', then: 'stunned' },
    'exploit-weakness': { name: 'Exploit Weakness', type: 'physical', trueDmg: true },
    'precision-attack': { name: 'Precision Attack', type: 'general', onRoll: true },
    // reactions: offered as a prompt when a creature misses the one who knows it (#67, second batch)
    'riposte': { name: 'Riposte', type: 'physical', reaction: 'melee' },
    'return-fire': { name: 'Return Fire', type: 'physical', reaction: 'ranged' },
    'parry': { name: 'Parry', type: 'physical', reaction: 'damage' },   // waits before a melee hit's damage lands
  };
  const MANEUVER_KEYS = Object.keys(MANEUVERS);
  const MANEUVER_ABILS = { physical: ['str', 'dex', 'con'], mental: ['int', 'wis', 'cha'], general: ABILS_ALL };
  // the maneuvers a sheet knows (its features named as SW5e's), and its save DC for each type
  function maneuversOf(ch, rules) {
    const names = new Set(((ch && ch.features) || []).map((f) => String((f && f.name) || '').trim().toLowerCase()));
    const known = MANEUVER_KEYS.filter((k) => names.has(MANEUVERS[k].name.toLowerCase()));
    if (!known.length || !rules) return null;
    const dc = Object.fromEntries(Object.entries(MANEUVER_ABILS).map(([type, abs]) => [type, 8 + rules.profBonus(ch) + Math.max(...abs.map((ab) => rules.abilityMod(ch, ab)))]));
    return { known, dc };
  }
  // the superiority pool with a die left (a Fighter's, or a Scholar's)
  const superiorityOf = (u) => ['superiority', 'superiority-scholar'].map((k) => ((u && u.pools) || {})[k]).find((p) => p && p.used < p.max && /^d\d+$/.test(String(p.die || ''))) || null;
  const maneuverUsed = (w, id, key) => !!((+spentOf(w, id).mv || 0) & (1 << MANEUVER_KEYS.indexOf(key)));
  /* ---------------- bonus damage from class features (audit 5.9) ---------------- */
  // What a character's classes add to a weapon hit, from HoloTable's class table (#108) at its levels: Sneak Attack dice
  // (Operative) and Rage Damage (Berserker). Worked out here from the sheet, never taken from a request.
  function ridersOf(ch, rules) {
    const out = {};
    for (const row of (rules && rules.classTableAt ? rules.classTableAt(ch) : [])) for (const [h, v] of row.cols) {
      if (h === 'Sneak Attack' && /^\d+d\d+$/i.test(String(v))) out.sneak = String(v);
      if (h === 'Rage Damage' && /^\+?\d+$/.test(String(v))) out.rage = +String(v).replace('+', '');
      if (h === 'Focused Strikes' && /^\d+d8$/i.test(String(v))) out.fes = parseInt(v, 10);          // Force-Empowered Strikes: up to N d8s
      if (h === 'Kinetic Combat' && /^d\d+$/i.test(String(v))) out.kinetic = String(v).toLowerCase();  // Double Strike: one Kinetic Combat die
    }
    return out;
  }
  // which of them this attack gets. Sneak Attack (SW5e, Operative): once per turn, a finesse or ranged weapon, with
  // advantage, or with another enemy of the target within 5 ft of it (not incapacitated) and no disadvantage.
  // Rage Damage: while raging, a melee weapon attack using Strength.
  function ridersFor(world, a, t, attack, ranged, mode) {
    const r = a.riders || {}, out = [];
    if (r.sneak && attack.weapon && (attack.finesse || ranged) && !spentOf(world, a.id).sneak) {
      const helper = Object.values(world.units).some((o) => o.id !== a.id && o.id !== t.id && !o.down && hostile(o, t) && !INCAPACITATING(o) && feetBetween(o, t) <= FT);
      if (mode === 'adv' || (helper && mode !== 'dis')) out.push({ key: 'sneak', name: 'Sneak Attack', dice: r.sneak });
    }
    if (r.rage && attack.weapon && !ranged && attack.abil === 'str' && effectsOf(a).some(([, e]) => e.rage)) out.push({ key: 'rage', name: 'Rage', flat: r.rage });
    // these cost force points, so they're the attacker's choice (opt-in): Force-Empowered Strikes (Guardian) on a melee
    // weapon hit, 1d8 a point up to the Focused Strikes column; Double Strike (Sentinel) on a weapon hit, 1 point for a
    // Kinetic Combat die, once a turn
    const fp = (a.pools || {}).force, left = poolLeft(fp);
    if (r.fes && attack.weapon && !ranged && left > 0) out.push({ key: 'fes', name: 'Force-Empowered Strikes', perPoint: '1d8', max: Math.min(r.fes, left), optIn: true });
    if (r.kinetic && attack.weapon && left > 0 && !spentOf(world, a.id).double) out.push({ key: 'double', name: 'Double Strike', dice: '1' + r.kinetic, cost: 1, optIn: true });
    // a maneuver (#67): the ones it knows and hasn't used this turn, while a superiority die is left
    const sup = superiorityOf(a), mk = a.maneuvers;
    if (sup && mk && attack.weapon) {
      const options = mk.known.filter((k) => !MANEUVERS[k].reaction && !maneuverUsed(world, a.id, k)).map((k) => { const m = MANEUVERS[k]; return { key: k, name: m.name, save: m.save || null, dc: m.save ? mk.dc[m.type] : null }; });
      if (options.length) out.push({ key: 'maneuver', name: 'Maneuver', optIn: true, die: sup.die, options });
    }
    return out;
  }
  function preview(world, actorId, targetId, attack, opts = {}) {
    const a = unitAt(world, actorId), t = unitAt(world, targetId);
    if (!a || !t) return { legal: false, why: 'No such target.' };
    if (a.id === t.id) return { legal: false, why: "You can't attack yourself." };
    if (t.ac == null || t.ac === '') return { legal: false, why: `${t.name} has no AC set.` };
    if ((world.effects || []).some((ef) => ef.unit === a.id && ef.condition === 'Charmed' && ef.source === t.id)) return { legal: false, why: `${a.name} is charmed by ${t.name} and can't attack it.` };
    const feet = feetBetween(a, t);
    const inReach = attack.melee && feet <= attack.melee;
    const inRange = attack.range && feet <= attack.range[1];
    if (!inReach && !inRange) return { legal: false, why: `${t.name} is ${feet} ft away: out of ${attack.range ? 'range' : 'reach'}.`, feet };
    const ranged = !inReach;
    const all = reasons(world, a, t, attack, feet, ranged);
    const tilts = all.filter((x) => !x.note), notes = all.filter((x) => x.note).map((x) => x.text);
    if (opts.adv) tilts.push({ adv: true, text: 'chosen' });
    if (opts.dis) tilts.push({ dis: true, text: 'chosen' });
    const m = d20(world, tilts.filter((x) => x.adv).length, tilts.filter((x) => x.dis).length), mode = m.mode;
    const weak = weakPenalty(a, attack.abil), bonus = attack.bonus - weak;
    // Snapshot Style (within 30 ft) and Sharpshooter Style (beyond it) step partial cover down one for ranged weapon attacks (#157)
    const cover0 = coverOf(world, a, t), st = a.styles || {};
    const stepBy = cover0 && cover0.bonus != null && attack.weapon && ranged ? (st.snapshot && feet <= 30 ? 'Snapshot Style' : st.sharpshooter && feet > 30 ? 'Sharpshooter Style' : '') : '';
    const cover = stepBy ? COVER[COVER.indexOf(cover0) - 1] : cover0;
    if (cover && cover.bonus == null) return { legal: false, why: `${t.name} has total cover.`, feet };
    if (stepBy) notes.push(`${cover ? `${cover.name} cover` : 'no cover'}, down from ${cover0.name} (${stepBy})`);
    const flank = flankOf(world, t, a);
    if (cover) notes.push(`${cover.name} cover, +${cover.bonus} AC`);   // (after a step-down, the line above says from what)
    if (flank) notes.push(`${t.name} is flanked, -${flank} AC`);
    const ac = +t.ac + (cover ? cover.bonus : 0) - flank;
    const need = Math.min(+attack.critFrom >= 15 ? +attack.critFrom : 20, Math.max(2, ac - bonus));   // the d20 needed; a 20 (or the crit range) always hits, a 1 always misses
    const chance = d20chance(m, (21 - need) / 20);
    const riders = ridersFor(world, a, t, attack, ranged, mode);
    return { legal: true, feet, ranged, mode, k: m.k, tilts, notes, need, chance, weak, bonus, ac, cover, riders, expr: d20expr(m) + sgn(bonus) };
  }

  /* ---------------- resources (audit 3.1) ---------------- */
  // One shape for everything that has a maximum and is spent and refilled:
  //   { key, name, max, die?, used, refill: 'turn' | 'short' | 'long' | 'manual' }
  // max and die are a plain value or { class, levels: [20 values] } read at the character's level in that class
  // ('total' = total level), so a level-up changes them with no code. Force points, tech points and hit dice stay
  // where the sheet keeps them (force.used, tech.used, hitDiceUsed) and are read and written in place.
  const REFILLS = ['turn', 'short', 'long', 'manual'];
  const clampN = (v, a, b) => Math.max(a, Math.min(b, v));
  const totalLevel = (ch) => (ch.classes || []).reduce((a, k) => a + (+k.level || 0), 0);
  function levelIn(ch, cls) {
    if (String(cls).toLowerCase() === 'total') return totalLevel(ch);
    const k = (ch.classes || []).find((c) => String(c.name).toLowerCase() === String(cls).toLowerCase());
    return k ? +k.level || 0 : 0;
  }
  function atLevel(ch, v) {
    if (v == null || typeof v !== 'object') return v;
    const L = Math.min(20, levelIn(ch, v.class));
    return L >= 1 && Array.isArray(v.levels) ? v.levels[L - 1] : null;
  }
  // a resource list as the server keeps it: plain fields, bounded sizes, nothing else
  function cleanResources(list) {
    const lv = (v, ok) => (v && typeof v === 'object' && !Array.isArray(v)
      ? { class: String(v.class || '').slice(0, 30), levels: (Array.isArray(v.levels) ? v.levels : []).slice(0, 20).map(ok) }
      : ok(v));
    const num = (x) => clampN(Math.round(+x) || 0, 0, 999);
    const die = (x) => (/^d(4|6|8|10|12|20)$/.test(String(x || '')) ? String(x) : '');
    return (Array.isArray(list) ? list : []).slice(0, 30).filter((r) => r && typeof r === 'object').map((r) => ({
      key: String(r.key || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 30), name: String(r.name || '').slice(0, 60),
      max: lv(r.max, num), die: r.die ? lv(r.die, die) : undefined, used: num(r.used), refill: REFILLS.includes(r.refill) ? r.refill : 'manual',
    })).filter((r) => r.key && !['force', 'tech', 'hitdice', 'move', 'action', 'bonus', 'reaction'].includes(r.key));
  }
  // every resource a character has, resolved to numbers for their level
  function resourcesOf(ch, rules) {
    const out = [];
    for (const r of ch.resources || []) {
      const max = +atLevel(ch, r.max) || 0;
      if (!r.key || max <= 0) continue;
      out.push({ key: r.key, name: r.name || r.key, max, die: atLevel(ch, r.die) || null, used: clampN(+r.used || 0, 0, max), refill: REFILLS.includes(r.refill) ? r.refill : 'manual', from: 'sheet' });
    }
    if (rules && rules.casterInfo) {
      const ci = rules.casterInfo(ch);
      const set = (o) => o && o.max !== '' && o.max != null;
      const fm = set(ch.force) ? +ch.force.max : ci.forceMax, tm = set(ch.tech) ? +ch.tech.max : ci.techMax;
      // temporary points (#185, audit 4.9) are spent before the pool's own (SW5e PHB: "the temporary points are spent first")
      const tempOf = (o) => clampN(Math.round(+(o || {}).temp || 0), 0, 999);
      if (fm > 0) out.push({ key: 'force', name: 'Force points', max: fm, used: clampN(+(ch.force || {}).used || 0, 0, fm), temp: tempOf(ch.force), refill: 'long', from: 'force' });
      // tech points come back on a short rest only for an Engineer or a Scout (audit 7.3, rules.js techOnShortRest)
      if (tm > 0) out.push({ key: 'tech', name: 'Tech points', max: tm, used: clampN(+(ch.tech || {}).used || 0, 0, tm), temp: tempOf(ch.tech), refill: rules.techOnShortRest && rules.techOnShortRest(ch) ? 'short' : 'long', from: 'tech' });
    }
    const L = totalLevel(ch);
    const hdUsed = rules && rules.hitDiceUsedTotal ? rules.hitDiceUsedTotal(ch) : +ch.hitDiceUsed || 0;
    if (L > 0) out.push({ key: 'hitdice', name: 'Hit dice', max: L, used: clampN(hdUsed, 0, L), refill: 'long', regain: Math.max(1, Math.floor(L / 2)), from: 'hitdice' });
    return out;
  }
  // hit dice per die size: a new total used, taken from (or given back to) the largest dice first
  function hitDiceTo(c, used, rules) {
    const list = rules.hitDice(c);
    let now = list.reduce((n, d) => n + d.used, 0);
    for (const d of list) {   // give back from the largest first
      while (now > used && d.used > 0) { d.used--; now--; }
    }
    for (const d of list) {   // spend from the largest first
      while (now < used && d.used < d.total) { d.used++; now++; }
    }
    return rules.hitDiceUsedOf(list);
  }
  // what a pool has left, temporary points included (#190), and paying n from it: the temporary points first
  const poolLeft = (p) => (p ? Math.max(0, p.max - p.used) + Math.max(0, +p.temp || 0) : 0);
  function payPool(p, n) {
    const temp = Math.max(0, +p.temp || 0), fromTemp = Math.min(temp, n);
    p.used = Math.min(p.max, p.used + n - fromTemp);
    if (p.temp != null) p.temp = temp - fromTemp;
    return p;
  }
  // write one resource's used count back where it lives (a new character; the one passed in is not changed); force and
  // tech also take their temporary points when given
  function withUsed(ch, res, used, rules, temp) {
    const c = clone(ch);
    const pts = (o) => Object.assign({}, o, { used }, temp != null ? (temp > 0 ? { temp } : { temp: 0 }) : {});
    if (res.from === 'force') c.force = pts(c.force);
    else if (res.from === 'tech') c.tech = pts(c.tech);
    else if (res.from === 'hitdice') c.hitDiceUsed = rules && rules.hitDice ? hitDiceTo(c, used, rules) : used;
    else c.resources = (c.resources || []).map((r) => (r.key === res.key ? Object.assign({}, r, { used }) : r));
    return c;
  }
  function spend(ch, key, n, rules) {
    const res = resourcesOf(ch, rules).find((r) => r.key === key);
    n = Math.round(+n);
    if (!res) return no(`No ${key} to spend.`);
    if (!(n > 0)) return no('Spend at least one.');
    if (poolLeft(res) < n) return no(`Not enough ${res.name}: ${res.max - res.used} of ${res.max} left${res.temp ? `, and ${res.temp} temporary` : ''}.`);
    const after = payPool(Object.assign({}, res), n);
    return { ok: true, ch: withUsed(ch, res, after.used, rules, res.temp != null ? after.temp : undefined), res: after };
  }
  // a rest refills what each resource says: 'short' refills short; 'long' refills short and long (hit dice: half back)
  function rest(ch, kind, rules) {
    let c = ch;
    for (const res of resourcesOf(ch, rules)) {
      const due = res.refill === 'short' || (kind === 'long' && res.refill === 'long');
      if (!due || !res.used) continue;
      c = withUsed(c, res, res.regain ? Math.max(0, res.used - res.regain) : 0, rules);
    }
    return c;
  }

  /* ---------------- abilities as data (issue #73) ---------------- */
  // An ability, as the table stores it (the format posted on #73). Numbers that depend on the caster are written as
  // references ("force", "tech", "weapon", an ability like "str") and resolved here for one character:
  //   { key, name, kind, level, use: action|bonus|reaction|free, cost: { pool: n }, reach, range: [n, l], area,
  //     targets: n|'self'|'area', attack: { bonus }, save: { ability, dc, onSave: half|none },
  //     damage: [{ dice, add, type }], heal: { dice, add }, applies: [...], concentration, upcast: { damage } }
  const ABILS = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
  const USES = ['action', 'bonus', 'reaction', 'free'];
  // A power's cost and numbers, as HoloTable's sheet works them out (app.js 'cast' and the power card): the cost is
  // its level plus one (at-will: free); tech uses tech numbers; force uses the side it belongs to, universal the better.
  function powerNumbers(ch, pw, rules) {
    const ci = rules.casterInfo(ch), lvl = +pw.level || 0, tech = pw.type === 'tech';
    const pick = (light, dark, t) => (tech ? t : pw.alignment === 'dark' ? dark : pw.alignment === 'light' ? light : Math.max(light, dark));
    const abil = tech ? 'int' : pw.alignment === 'dark' ? 'cha' : pw.alignment === 'light' ? 'wis' : rules.abilityMod(ch, 'cha') > rules.abilityMod(ch, 'wis') ? 'cha' : 'wis';
    return { pool: tech ? 'tech' : 'force', cost: lvl ? lvl + 1 : 0, level: lvl, dc: pick(ci.lightDC, ci.darkDC, ci.techDC), atk: pick(ci.lightAtk, ci.darkAtk, ci.techAtk), maxLevel: tech ? ci.techMaxLevel : ci.forceMaxLevel, abil };
  }
  // the table's data for a power, with this character's numbers filled in; null when the table has no data for it
  function resolvePower(ch, pw, data, rules) {
    if (!data) return null;
    const n = powerNumbers(ch, pw, rules), mod = (ab) => (ABILS.includes(ab) ? rules.abilityMod(ch, ab) : +ab || 0);
    const num = (v) => (v === 'force' || v === 'tech' || v === 'power' ? n.atk : v === 'weapon' ? n.atk : Number.isFinite(+v) ? +v : 0);
    const dc = (v) => (v === 'force' || v === 'tech' || v === 'power' ? n.dc : Number.isFinite(+v) ? +v : n.dc);
    return {
      key: 'pw:' + String(pw.name).toLowerCase(), name: pw.name, kind: 'power', level: n.level, maxLevel: n.maxLevel,
      use: USES.includes(data.use) ? data.use : 'action', cost: n.cost ? { [n.pool]: n.cost } : {}, pool: n.pool,
      reach: data.reach == null ? null : +data.reach, range: Array.isArray(data.range) ? [+data.range[0], +data.range[1] || +data.range[0]] : null,
      area: data.area || null, targets: data.targets === 'self' ? 'self' : data.targets === 'area' ? 'area' : Math.max(1, +data.targets || 1),
      attack: data.attack ? { bonus: num(data.attack.bonus == null ? 'power' : data.attack.bonus), abil: n.abil } : null,
      save: data.save ? { ability: ABILS.includes(data.save.ability) ? data.save.ability : 'dex', dc: dc(data.save.dc), onSave: data.save.onSave === 'half' ? 'half' : 'none' } : null,
      damage: (data.damage || []).map((d) => ({ dice: String(d.dice || ''), add: d.add == null ? 0 : mod(d.add), type: d.type || '' })).filter((d) => d.dice),
      heal: data.heal && data.heal.dice ? { dice: String(data.heal.dice), add: data.heal.add == null ? 0 : mod(data.heal.add) } : null,
      applies: Array.isArray(data.applies) ? data.applies : [], concentration: !!data.concentration,
      upcast: data.upcast && data.upcast.damage ? { damage: String(data.upcast.damage) } : null,
    };
  }
  // a weapon attack row as an ability (its arithmetic still comes from rules.js through attacksOf)
  const weaponAbility = (a) => ({ key: 'atk:' + a.key, name: a.name, kind: 'weapon', use: 'action', cost: {}, reach: a.melee || null, range: a.range, targets: 1,
    attack: { bonus: a.bonus, abil: a.abil }, save: null, damage: [{ dice: a.damage, add: 0, type: a.type }], crit: a.crit, applies: [], concentration: false });
  // Burst and Rapid (audit 5.8): a ranged weapon's other way to fire, as a Dexterity save (DC 8 + the attack bonus)
  // instead of an attack roll; not while its Strength number isn't met (SW5e: the property needs it). Burst sprays a
  // 10-ft cube within range: each creature in it saves or takes the weapon's damage. Rapid unloads on one target: it
  // saves or takes the weapon's damage dice twice (modifiers once). Ammunition isn't counted yet (6.6).
  function volleysOf(a) {
    if (!a.range || (a.unmet && /^strength/i.test(a.unmet))) return [];
    const base = { kind: 'volley', use: 'action', cost: {}, reach: null, range: a.range, attack: null, applies: [], concentration: false, weapon: a.key,
      save: { ability: 'dex', dc: 8 + (+a.bonus || 0), onSave: 'none' } };
    const out = [];
    if (a.burst) out.push(Object.assign({}, base, { shots: a.burst, key: 'burst:' + a.key, name: `${a.name}, burst`, targets: 'area', area: { shape: 'cube', size: 10, width: 10, from: 'point' },
      damage: [{ dice: a.damage, add: 0, type: a.type }], hint: `Burst ${a.burst}: a 10-ft cube; Dex save DC ${8 + (+a.bonus || 0)} or ${a.damage}` }));
    if (a.rapid) out.push(Object.assign({}, base, { shots: a.rapid, key: 'rapid:' + a.key, name: `${a.name}, rapid`, targets: 1,
      damage: [{ dice: doubleDice(a.damage), add: 0, type: a.type }], hint: `Rapid ${a.rapid}: one target; Dex save DC ${8 + (+a.bonus || 0)} or ${doubleDice(a.damage)}` }));
    return out;
  }
  // everything a character can use in the combat view: weapon attacks (and their bursts and rapid fire), and the powers
  // on the sheet the table has data for
  function abilitiesOf(ch, rules, library) {
    const lib = library || {};
    const atks = attacksOf(ch, rules);
    return atks.map(weaponAbility).concat(...atks.map(volleysOf))
      .concat((ch.powers || []).map((pw) => resolvePower(ch, pw, lib[String(pw.name || '').toLowerCase()], rules)).filter(Boolean));
  }
  // ability data as the table keeps it: only the fields of the format, each checked; null if nothing usable is left
  const DICE = /^(\d{0,2}d(4|6|8|10|12|20|100)|\d{1,3})([+-](\d{0,2}d(4|6|8|10|12|20|100)|\d{1,3})){0,5}$/i;
  const SHAPES = ['cone', 'cube', 'cylinder', 'line', 'sphere'];
  function cleanAbility(d) {
    if (!d || typeof d !== 'object') return null;
    const ft = (v) => (v == null || v === '' ? null : clampN(Math.round(+v) || 0, 0, 2000));
    const ref = (v, extra) => (ABILS.includes(v) || extra.includes(v) ? v : Number.isFinite(+v) && v !== '' && v != null ? clampN(Math.round(+v), -10, 40) : null);
    const dice = (v) => { const x = String(v || '').replace(/\s+/g, ''); return DICE.test(x) ? x : ''; };
    const out = {
      use: USES.includes(d.use) ? d.use : 'action',
      reach: ft(d.reach), range: Array.isArray(d.range) && ft(d.range[0]) ? [ft(d.range[0]), Math.max(ft(d.range[0]), ft(d.range[1]) || 0)] : null,
      area: d.area && SHAPES.includes(d.area.shape) ? { shape: d.area.shape, size: ft(d.area.size) || 5, width: ft(d.area.width) || 5, from: d.area.from === 'point' ? 'point' : 'self' } : null,
      targets: d.targets === 'self' || d.targets === 'area' ? d.targets : clampN(Math.round(+d.targets) || 1, 1, 10),
      attack: d.attack ? { bonus: ref(d.attack.bonus, ['power', 'force', 'tech', 'weapon']) ?? 'power' } : null,
      save: d.save && ABILS.includes(d.save.ability) ? { ability: d.save.ability, dc: ref(d.save.dc, ['power', 'force', 'tech']) ?? 'power', onSave: d.save.onSave === 'half' ? 'half' : 'none' } : null,
      damage: (Array.isArray(d.damage) ? d.damage : []).slice(0, 4).map((x) => ({ dice: dice(x && x.dice), add: x && ABILS.includes(x.add) ? x.add : null, type: String((x && x.type) || '').toLowerCase().replace(/[^a-z]/g, '').slice(0, 20) })).filter((x) => x.dice),
      heal: d.heal && dice(d.heal.dice) ? { dice: dice(d.heal.dice), add: ABILS.includes(d.heal.add) ? d.heal.add : null } : null,
      applies: (Array.isArray(d.applies) ? d.applies : []).slice(0, 4).filter((x) => x && x.condition).map((x) => ({ condition: String(x.condition).slice(0, 30),
        level: LEVELS[x.condition] ? clampN(Math.round(+x.level) || 0, 0, LEVELS[x.condition]) : 0, amount: x.condition === 'Ignited' ? dice(x.amount) : '',
        until: x.until && typeof x.until === 'object' ? { ends: x.until.ends === 'start' ? 'start' : 'end', of: x.until.of === 'self' ? 'self' : 'target', rounds: clampN(Math.round(+x.until.rounds) || 1, 1, 100), save: !!x.until.save } : null })),
      concentration: !!d.concentration,
      upcast: d.upcast && dice(d.upcast.damage) ? { damage: dice(d.upcast.damage) } : null,
    };
    if (out.targets !== 'self' && !out.reach && !out.range && !out.area) out.reach = FT;
    if (!out.attack && !out.save && !out.damage.length && !out.heal && !out.applies.length) return null;
    return out;
  }
  // set one resource's used count where it lives (force points, tech points, hit dice, or the sheet's own list)
  function setPoolUsed(ch, key, used, rules, temp) {
    const res = resourcesOf(ch, rules).find((r) => r.key === key);
    const t = temp == null || res == null || res.temp == null ? undefined : clampN(Math.round(+temp) || 0, 0, 999);
    return res ? withUsed(ch, res, clampN(Math.round(+used) || 0, 0, res.max), rules, t) : ch;
  }
  const diceExpr = (d, add) => (add ? `${d}${add > 0 ? '+' : ''}${add}` : d);
  const doubleDice = (e) => e.replace(/(\d*)d(\d+)/gi, (_, n, s) => (2 * (+n || 1)) + 'd' + s);
  // can this ability reach that target from here?
  function inReachOf(world, a, t, ab) {
    const feet = feetBetween(a, t);
    if (ab.targets === 'self') return a.id === t.id ? { ok: true, feet: 0 } : { ok: false, why: `${ab.name} only affects its user.` };
    if (ab.reach && feet <= ab.reach) return { ok: true, feet, melee: true };
    if (ab.range && feet <= ab.range[1]) return { ok: true, feet, long: feet > ab.range[0] };
    return { ok: false, why: `${t.name} is ${feet} ft away: out of ${ab.range ? 'range' : 'reach'}.` };
  }

  /* ---------------- measuring and areas (issue #70) ---------------- */
  // Points are in squares and may sit on a corner or a centre (x.0 or x.5). A square is inside a template when its
  // centre is. Cones open to the same width as their length (a half-angle whose tangent is 1/2); spheres and
  // cylinders are a radius around the point; cubes run from the point away from the caster; lines have a width.
  const HALF_CONE = Math.atan(0.5);
  function ruler(a, b) { // feet between two points, by the same grid rule as movement
    return gridFeet(Math.abs(Math.floor(b.x) - Math.floor(a.x)), Math.abs(Math.floor(b.y) - Math.floor(a.y)));
  }
  function areaSquares(area, origin, aim) {
    const n = Math.max(1, Math.round((area.size || FT) / FT)), out = [];
    const dx = aim.x - origin.x, dy = aim.y - origin.y, len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len;
    const box = (x0, y0, x1, y1, test) => {
      for (let x = Math.floor(x0); x <= Math.ceil(x1); x++) for (let y = Math.floor(y0); y <= Math.ceil(y1); y++) if (test(x + 0.5, y + 0.5)) out.push([x, y]);
    };
    if (area.shape === 'sphere' || area.shape === 'cylinder') {
      box(origin.x - n - 1, origin.y - n - 1, origin.x + n, origin.y + n, (cx, cy) => Math.hypot(cx - origin.x, cy - origin.y) <= n + 1e-9);
    } else if (area.shape === 'cube') {
      const sx = dx >= 0 ? 1 : -1, sy = dy >= 0 ? 1 : -1;
      const x0 = Math.round(origin.x), y0 = Math.round(origin.y);
      box(Math.min(x0, x0 + sx * n), Math.min(y0, y0 + sy * n), Math.max(x0, x0 + sx * n) - 1, Math.max(y0, y0 + sy * n) - 1, () => true);
    } else if (area.shape === 'cone') {
      box(origin.x - n - 1, origin.y - n - 1, origin.x + n, origin.y + n, (cx, cy) => {
        const vx = cx - origin.x, vy = cy - origin.y, d = Math.hypot(vx, vy);
        return d > 0 && d <= n + 1e-9 && Math.acos(Math.max(-1, Math.min(1, (vx * ux + vy * uy) / d))) <= HALF_CONE + 1e-9;
      });
    } else if (area.shape === 'line') {
      const half = Math.max(1, Math.round((area.width || FT) / FT)) / 2;
      box(origin.x - n - 1, origin.y - n - 1, origin.x + n, origin.y + n, (cx, cy) => {
        const vx = cx - origin.x, vy = cy - origin.y, along = vx * ux + vy * uy;
        return along > 0 && along <= n + 1e-9 && Math.abs(vx * uy - vy * ux) <= half + 1e-9;
      });
    }
    return out;
  }
  // where an area starts: the point aimed at (it must be in range), or the caster's edge toward the aim (cones, lines)
  function areaOrigin(world, u, ab, point) {
    const size = u.size || 1, cx = u.x + size / 2, cy = u.y + size / 2;
    if (ab.area.from === 'point') {
      const feet = Math.max(0, squaresBetween(u, { x: Math.floor(point.x), y: Math.floor(point.y), size: 1 }) * FT);
      const reach = ab.range ? ab.range[1] : ab.reach || 0;
      if (feet > reach) return { ok: false, why: `That point is ${feet} ft away: out of range (${reach} ft).` };
      return { ok: true, origin: { x: point.x, y: point.y }, aim: point };
    }
    const dx = point.x - cx, dy = point.y - cy, len = Math.hypot(dx, dy) || 1;
    return { ok: true, origin: { x: cx + (dx / len) * size / 2, y: cy + (dy / len) * size / 2 }, aim: { x: cx + dx * 10, y: cy + dy * 10 } };
  }
  // the squares and the combatants an area ability would catch, aimed at a point
  function areaHits(world, unitId, ab, point) {
    const u = world.units[unitId];
    if (!u || !ab.area || !point || !Number.isFinite(+point.x) || !Number.isFinite(+point.y)) return { ok: false, why: 'Pick where to aim it.' };
    const o = areaOrigin(world, u, ab, { x: +point.x, y: +point.y });
    if (!o.ok) return o;
    // walls stop an area: a square with no clear straight line from the origin isn't in it (SW5e: an area spreads in
    // straight lines from its point of origin). Walls, windows and closed doors stop it.
    const stops = (world.walls || []).filter(blocksMove);
    const squares = areaSquares(ab.area, o.origin, o.aim).filter(([x, y]) => !stops.length || clear(stops, [o.origin.x, o.origin.y], [x + 0.5, y + 0.5], () => true));
    const set = new Set(squares.map(([x, y]) => `${x},${y}`));
    const caught = Object.values(world.units).filter((t) => !t.down && (ab.area.from === 'point' || t.id !== u.id) && (() => {
      for (let x = t.x; x < t.x + (t.size || 1); x++) for (let y = t.y; y < t.y + (t.size || 1); y++) if (set.has(`${x},${y}`)) return true;
      return false;
    })());
    return { ok: true, squares, units: caught.map((t) => t.id), origin: o.origin };
  }

  /* ---------------- turns: the turn budget is resources too, refilled at the start of the unit's own turn ---------------- */
  const turnKey = (world) => `${world.round}:${world.turnId}`;
  const TURN = ['move', 'action', 'bonus', 'reaction'];
  const blank = (key) => ({ key, move: 0, action: 0, bonus: 0, reaction: 0, diag: 0, dash: 0, disengage: 0, dodge: 0, ds: 0, sneak: 0, double: 0, atk: 0, atkMax: 0, lt: 0, dw: 0, off: 0, mv: 0, surge: 0, ma: 0, mab: 0 });
  function spentOf(world, id) {
    const s = (world.spent || {})[id];
    return s && (id !== world.turnId || s.key === turnKey(world)) ? Object.assign(blank(s.key), s) : blank(id === world.turnId ? turnKey(world) : '');
  }
  // what a unit's turn has left (by default, the unit whose turn it is)
  function budget(world, id) {
    id = id || world.turnId;
    const u = world.units[id], s = spentOf(world, id);
    let speed = u ? Math.max(0, +u.speed || 0) : 0;
    const ex = u ? +u.exhaustion || 0 : 0;   // exhaustion on the sheet: level 2 is one slowed level, level 5 four
    const slow = Math.min(4, (ex >= 5 ? 4 : ex >= 2 ? 1 : 0) + levelOf(world, u, 'Slowed'));
    if (u && (has(u, 'speed0') || slow >= 4)) speed = 0; else speed = Math.max(0, speed - SLOWED_FT[slow]);
    const out = has(u || {}, 'noActions'), noReact = out || has(u || {}, 'noReactions');
    const one = has(u || {}, 'oneAction') && (s.action >= 1 || s.bonus >= 1);   // shocked: an action or a bonus action, not both
    const total = speed * (1 + (+s.dash || 0));   // each Dash adds the speed again
    return { key: s.key, moved: s.move, speed, total, moveLeft: Math.max(0, total - s.move), action: !out && !one && s.action < 1 + (+s.surge || 0), bonus: !out && !one && s.bonus < 1, reaction: !noReact && s.reaction < 1,
      dash: +s.dash || 0, disengage: !!s.disengage, dodge: !!s.dodge,
      attacks: !out && s.atk > 0 ? Math.max(0, (+s.atkMax || 1) - s.atk) : 0 };   // attacks left in an Attack action already begun (#139)
  }
  // a new turn gives its unit full movement, an action, a bonus action and its reaction back
  function fresh(world) {
    const w = clone(world);
    w.spent = w.spent || {}; w.effects = w.effects || []; w.conc = w.conc || {};
    if (w.turnId && (!w.spent[w.turnId] || w.spent[w.turnId].key !== turnKey(w))) w.spent[w.turnId] = blank(turnKey(w));
    else if (w.turnId) w.spent[w.turnId] = Object.assign(blank(turnKey(w)), w.spent[w.turnId]);
    return w;
  }

  /* ---------------- the actions everyone has (SW5e chapter 9), as data ---------------- */
  // `gives` is what taking it does: more movement this turn, or a flag that lasts until the unit's next turn starts.
  // A class feature that offers one of these as a bonus action (or a new one) is the same shape with its own `use`.
  const COMMON = [
    { key: 'dash', name: 'Dash', use: 'action', gives: { dash: 1 }, hint: 'Your speed again in movement, this turn' },
    { key: 'disengage', name: 'Disengage', use: 'action', gives: { disengage: 1 }, hint: 'Leaving a reach provokes no opportunity attack this turn' },
    { key: 'dodge', name: 'Dodge', use: 'action', gives: { dodge: 1 }, hint: 'Until your next turn: attacks against you at disadvantage, Dex saves at advantage' },
  ];
  // dodging counts only while the unit can see trouble coming: not incapacitated, and not at speed 0
  const dodging = (w, t) => !!spentOf(w, t.id).dodge && !INCAPACITATING(t) && budget(w, t.id).speed > 0;

  /* ---------------- shots and reload (6.6, the combat view's half of #179) ---------------- */
  // a Reload weapon's shots, kept per attack key on the unit (and written back to the sheet's row): why not, or ''
  function noShots(me, attack, n = 1) {
    if (!attack || !attack.reload || !me.shots || me.shots[attack.key] == null) return '';
    const left = +me.shots[attack.key] || 0;
    return left >= n ? '' : left ? `${attack.name} has ${left} shot${left === 1 ? '' : 's'} left; this needs ${n}. Reload first.` : `${attack.name} is out of shots: reload first.`;
  }
  const spendShots = (me, attack, n = 1) => { if (attack && attack.reload && me.shots && me.shots[attack.key] != null) me.shots[attack.key] = Math.max(0, (+me.shots[attack.key] || 0) - n); };
  /* ---------------- Grapple, Shove, escaping a grapple, Help (#144) ---------------- */
  // A contest's bonus: a character's Athletics or Acrobatics from its sheet, a creature's from its stat block's skills,
  // or else the ability's modifier. Frightened and poisoned roll their checks at disadvantage.
  const SKILL_AB = { athletics: 'str', acrobatics: 'dex' }, SKILL_NAME = { athletics: 'Athletics', acrobatics: 'Acrobatics' };
  function contestBonus(u, skill) {
    const v = ((u && u.skills) || {})[skill];
    return (v != null && v !== '' && Number.isFinite(+v) ? +v : +((u && u.mods) || {})[SKILL_AB[skill]] || 0) - weakPenalty(u, SKILL_AB[skill]);
  }
  // `me` against `t`: me's skill against the better of t's (it picks); a tie leaves things as they are, so me loses it
  function contest(w, me, t, mine, theirs, roll, log, what) {
    // Reliable Talent (#179): a proficient check's d20 counts at least 8
    const side = (u, k) => { const b = contestBonus(u, k), m = d20(w, 0, has(u, 'checksDis') || heavyDis(u, SKILL_AB[k]) ? 1 : 0); return { k, b, expr: d20expr(m) + ((u.reliable || {})[k] ? 'min8' : '') + sgn(b) }; };
    const a = side(me, mine), d = theirs.map((k) => side(t, k)).sort((p, q) => q.b - p.b)[0];
    const ra = roll(a.expr), rt = roll(d.expr), won = ra.total > rt.total;
    log.push({ unit: me.id, kind: 'check', roll: ra, expr: a.expr, text: `${me.name} tries to ${what} ${t.name} (${SKILL_NAME[a.k]}): ${ra.total}.` });
    log.push({ unit: t.id, kind: 'check', roll: rt, expr: d.expr, text: `${t.name} resists (${SKILL_NAME[d.k]}): ${rt.total}, ${won ? `${me.name} wins` : `${t.name} holds`}${ra.total === rt.total ? ' (a tie changes nothing)' : ''}.` });
    return won;
  }
  // Grapple and Shove: one attack of the Attack action, on a creature within reach no more than one size larger
  function maneuverCheck(w, me, t, what) {
    if (!t) return 'No such target.';
    if (t.id === me.id) return `${me.name} can't ${what} itself.`;
    if (isDead(t)) return `${t.name} is dead.`;
    const feet = feetBetween(me, t), reach = Math.max(FT, +me.reach || FT);
    if (feet > reach) return `${t.name} is ${feet} ft away: out of reach.`;
    if (sizeCat(t) - sizeCat(me) > 1) return `${t.name} is too big for ${me.name} to ${what}: no more than one size larger.`;
    if ((w.effects || []).some((ef) => ef.unit === me.id && ef.condition === 'Charmed' && ef.source === t.id)) return `${me.name} is charmed by ${t.name} and can't attack it.`;
    return '';
  }
  // the help a unit is getting: an effect on the target, used up by the first attack an ally of the helper makes on it
  // ...and Distracting Blow's opening (#67): the next attack on it by anyone but the one who made it
  const helpOn = (w, a, t) => (w.effects || []).find((ef) => ef.unit === t.id && ef.source && ef.source !== a.id && unitAt(w, ef.source)
    && ((ef.condition === 'Helped' && unitAt(w, ef.source).side === a.side) || ef.condition === 'Distracted'));
  // one attack of the Attack action (#139): the first takes the action. Returns why not, or what to record once it's made
  function attackSlot(w, me, b, act) {
    const more = b.attacks > 0;
    if (!b.action && !more) return { why: spentOf(w, me.id).atkMax > 1 ? `${me.name} has made every attack this action allows.` : `${me.name} has already used the action this turn.` };
    return { take: () => { const sp = w.spent[me.id];
      if (more) sp.atk += 1;
      else Object.assign(sp, { action: sp.action + 1, atk: 1, atkMax: me.side === 'npc' ? clampN(Math.round(+act.multi || 1), 1, 6) : Math.max(1, +me.attacks || 1) });
      return sp; } };
  }

  /* ---------------- applying one action ---------------- */
  function apply(world, act, roll) {
    const r = applyOne(world, act, roll);
    if (r.ok) settle(r.world, r.log);
    return r;
  }
  function applyOne(world, act, roll) {
    if (!world.active) return no('Combat has not started: start initiative first.');
    const u = unitAt(world, act.unit);
    if (!u) return no('That combatant is not on the map.');
    if (act.unit !== world.turnId) return no(`It's not ${u.name}'s turn.`);
    const w = fresh(world), me = w.units[u.id], b = budget(w);
    if (isDead(me) && act.type !== 'end') return no(`${me.name} is dead.`);
    if (act.type !== 'end' && act.type !== 'move' && act.type !== 'deathsave' && INCAPACITATING(me)) return no(`${me.name} is ${String((has(me, 'noActions') || [''])[0]).toLowerCase()} and can't act.`);
    switch (act.type) {
      case 'move': {
        const x = Math.round(+act.x), y = Math.round(+act.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return no('Bad square.');
        if (x === me.x && y === me.y) return no('Already there.');
        const found = search(w, me.id, b.moveLeft), cost = found.out[`${x},${y}`];
        if (cost === undefined) return no(b.moveLeft ? `${me.name} can't reach that square with ${b.moveLeft} ft of movement left.` : `${me.name} has no movement left this turn.`);
        // frightened: it can't willingly move closer to the source of its fear while it can see it
        const fear = (me.conditions || []).includes('Frightened') && sourceOf(w, me, 'Frightened');
        if (fear && sees(w, me, fear) && feetBetween(Object.assign({}, me, { x, y }), fear) < feetBetween(me, fear)) return no(`${me.name} is frightened of ${fear.name} and can't move closer to it.`);
        const path = pathTo(w, me.id, b.moveLeft, x, y) || [{ x: me.x, y: me.y }, { x, y }];
        const reactions = opportunities(w, me, path);
        me.x = x; me.y = y; w.spent[me.id].move += cost; w.spent[me.id].diag = found.par[`${x},${y}`] ? 1 : 0;
        return { ok: true, world: w, log: [{ text: `${me.name} moves ${cost} ft.` }], events: [{ kind: 'move', unit: me.id, feet: cost }], reactions };
      }
      case 'attack': {
        if (act.martial) {   // Martial Arts' bonus-action unarmed strike, then Flurry of Blows' second for a focus point (#67)
          const o = martialOf(w, me, act.attack);
          if (!o.spec) return no(o.why);
          const s = strike(w, me, act.target, o.spec, { adv: !!act.adv, dis: !!act.dis, no: act.no || [], add: act.add || {} }, roll, '');
          if (!s.ok) return s;
          const sp = w.spent[me.id];
          if (o.flurry) { me.pools.focus.used += 1; sp.mab = 2; s.log[0].text += ' (Flurry of Blows, 1 focus point)'; } else Object.assign(sp, { bonus: sp.bonus + 1, mab: 1 });
          return { ok: true, world: w, log: s.log, events: s.events, reactions: s.reactions || [] };
        }
        if (act.offhand) {   // Two- or Double-Weapon Fighting (audit 5.8): a bonus action attack after the Attack action
          const o = offhandOf(w, me, act.attack);
          if (!o.spec) return no(o.why);
          const dry = noShots(me, act.attack);
          if (dry) return no(dry);
          const s = strike(w, me, act.target, o.spec, { adv: !!act.adv, dis: !!act.dis, no: act.no || [], add: act.add || {} }, roll, '');
          if (!s.ok) return s;
          spendShots(me, act.attack);
          const sp = w.spent[me.id];
          if (sp.off) sp.off += 1; else Object.assign(sp, { bonus: sp.bonus + 1, off: 1 });
          return { ok: true, world: w, log: s.log, events: s.events, reactions: s.reactions || [] };
        }
        // Extra Attack and Multiattack (#139): the first attack takes the action; the rest of that Attack action don't,
        // and the unit can move between them. A creature's count comes with the attack (its stat block, the GM's).
        const slot = attackSlot(w, me, b, act);
        if (!slot.take) return no(slot.why);
        const dry = noShots(me, act.attack);
        if (dry) return no(dry);
        const s = strike(w, me, act.target, act.attack, { adv: !!act.adv, dis: !!act.dis, no: act.no || [], add: act.add || {}, twoHands: !!act.twoHands }, roll, '');
        if (!s.ok) return s;
        spendShots(me, act.attack);
        const sp = slot.take();
        if (me.monk && act.attack.martial) sp.ma = 1;   // Martial Arts: a bonus-action unarmed strike after this (#67)
        // the light (or light and double) weapon it attacked with, for a bonus attack after (audit 5.8)
        if (me.side === 'pc' && act.attack.light && /^\d{1,2}$/.test(String(act.attack.key))) {
          if (!sp.lt) sp.lt = 1 + +act.attack.key;
          if (act.attack.otherEnd && !sp.dw) sp.dw = 1 + +act.attack.key;
        }
        return { ok: true, world: w, log: s.log, events: s.events, reactions: s.reactions || [] };
      }
      case 'grapple': case 'shove': {   // #144: one attack of the Attack action, a contest instead of an attack roll
        const t = unitAt(w, act.target), what = act.type === 'grapple' ? 'grapple' : 'shove';
        const why = maneuverCheck(w, me, t, what);
        if (why) return no(why);
        if (what === 'grapple' && (w.effects || []).some((ef) => ef.unit === t.id && ef.condition === 'Grappled' && ef.source === me.id)) return no(`${me.name} is already grappling ${t.name}.`);
        if (what === 'grapple' && immuneTo(t, 'Grappled')) return no(`${t.name} can't be grappled.`);
        if (what === 'shove' && !act.push && immuneTo(t, 'Prone')) return no(`${t.name} can't be knocked prone.`);
        const slot = attackSlot(w, me, b, act);
        if (!slot.take) return no(slot.why);
        const log = [];
        const won = contest(w, me, t, 'athletics', ['athletics', 'acrobatics'], roll, log, what === 'grapple' ? 'grapple' : act.push ? 'push' : 'knock down');
        slot.take();
        if (won && what === 'grapple') {
          t.conditions = Array.from(new Set((t.conditions || []).concat('Grappled')));
          w.effects.push({ id: `grapple-${me.id}-${t.id}-${w.effects.length}`, unit: t.id, condition: 'Grappled', ends: 'never', of: t.id, rounds: 1, save: null, source: me.id, conc: false, level: 0, amount: '' });
          log.push({ unit: t.id, about: me.id, text: `${t.name} is grappled by ${me.name}.` });
        } else if (won && !act.push) {
          t.conditions = Array.from(new Set((t.conditions || []).concat('Prone')));
          log.push({ unit: t.id, text: `${t.name} is knocked prone.` });
        } else if (won) {   // 5 ft straight away from the shover, if the square is free and no wall is in the way
          if (pushAway(w, me, t, 1)) log.push({ unit: t.id, text: `${t.name} is pushed 5 ft.` });
          else log.push({ unit: t.id, text: `There's no room to push ${t.name}: it stays where it is.` });
        }
        return { ok: true, world: w, log, events: won && act.push ? [{ kind: 'move', unit: t.id, feet: FT }] : [] };
      }
      case 'escape': {   // #144: the grappled unit's action, a contest against its grappler
        const ef = (w.effects || []).find((e) => e.unit === me.id && e.condition === 'Grappled' && e.source && unitAt(w, e.source));
        if (!ef) return no((me.conditions || []).includes('Grappled') ? `The combat view doesn't know who is grappling ${me.name}: the GM can take the condition off.` : `${me.name} isn't grappled.`);
        if (!b.action) return no(`${me.name} has already used the action this turn.`);
        const g = unitAt(w, ef.source), log = [];
        const won = contest(w, me, g, act.skill === 'athletics' ? 'athletics' : 'acrobatics', ['athletics'], roll, log, 'escape');
        w.spent[me.id].action += 1;
        if (won) {
          w.effects = w.effects.filter((e) => e !== ef);
          dropCondition(w, ef);
          log.push({ unit: me.id, text: `${me.name} escapes ${g.name}'s grapple.` });
        }
        return { ok: true, world: w, log, events: [] };
      }
      case 'release': {   // #144: letting go needs no action
        const mine = (w.effects || []).filter((e) => e.condition === 'Grappled' && e.source === me.id && (!act.target || e.unit === act.target));
        if (!mine.length) return no(`${me.name} isn't grappling anyone${unitAt(w, act.target) ? ` (not ${unitAt(w, act.target).name})` : ''}.`);
        w.effects = w.effects.filter((e) => !mine.includes(e));
        const log = [];
        for (const ef of mine) { dropCondition(w, ef); const u = unitAt(w, ef.unit); if (u) log.push({ unit: u.id, text: `${me.name} lets go of ${u.name}.` }); }
        return { ok: true, world: w, log, events: [] };
      }
      case 'common': {   // Dash, Disengage, Dodge; and a Berserker's Rage
        if (act.key === 'reload') {   // Reload N (6.6, #179): an action or a bonus action, the weapon full again
          const key = String(act.weapon || ''), full = Object.prototype.hasOwnProperty.call(me.reloads || {}, key) ? me.reloads[key] : 0;
          if (!full) return no('That weapon has no Reload number.');
          const use = act.asBonus ? 'bonus' : 'action';
          if (!b[use]) return no(`${me.name} has already used the ${use === 'bonus' ? 'bonus action' : 'action'} this turn.`);
          w.spent[me.id][use] += 1;
          me.shots = Object.assign({}, me.shots, { [key]: full });
          return { ok: true, world: w, log: [{ unit: me.id, text: `${me.name} reloads${act.weaponName ? ' ' + String(act.weaponName).slice(0, 80) : ''}: ${full} shots${use === 'bonus' ? ' (a bonus action)' : ''}.` }], events: [] };
        }
        if (act.key === 'surge') {   // a Fighter's Action Surge (#67): one more action this turn, once a turn, a use of its pool
          const pool = (me.pools || {})['action-surge'];
          if (!pool) return no(`${me.name} has no Action Surge.`);
          if (+spentOf(w, me.id).surge) return no(`${me.name} has already surged this turn.`);
          if (pool.used >= pool.max) return no(`${me.name} has no Action Surge left until a short or long rest.`);
          pool.used += 1;
          w.spent[me.id] = Object.assign(spentOf(w, me.id), { surge: 1 });
          return { ok: true, world: w, log: [{ unit: me.id, text: `${me.name} surges: one more action this turn (${pool.max - pool.used} of ${pool.max} Action Surge left).` }], events: [] };
        }
        if (act.key === 'help') {   // #144: the first attack an ally makes on a creature within 5 ft of me, before my next turn, has advantage
          const t = unitAt(w, act.target);
          if (!t || t.id === me.id) return no('Pick a creature within 5 ft to help against.');
          if (feetBetween(me, t) > FT) return no(`${t.name} is ${feetBetween(me, t)} ft away: Help needs it within 5 ft.`);
          if (!b.action) return no(`${me.name} has already used the action this turn.`);
          w.spent[me.id].action += 1;
          w.effects = w.effects.filter((ef) => !(ef.condition === 'Helped' && ef.source === me.id));   // one at a time
          w.effects.push({ id: `help-${me.id}-${t.id}-${w.effects.length}`, unit: t.id, condition: 'Helped', ends: 'start', of: me.id, rounds: 1, save: null, source: me.id, conc: false, level: 0, amount: '' });
          return { ok: true, world: w, log: [{ unit: me.id, about: t.id, text: `${me.name} helps: the next attack an ally makes on ${t.name} before ${me.name}'s next turn has advantage.` }], events: [] };
        }
        if (act.key === 'rage') {   // a bonus action and one use of its Rages (audit 5.9); 1 minute, ended early by dropping
          if (!(me.riders || {}).rage) return no(`${me.name} can't rage.`);
          if (!b.bonus) return no(`${me.name} has already used the bonus action this turn.`);
          if (effectsOf(me).some(([, e]) => e.rage)) return no(`${me.name} is already raging.`);
          const pool = (me.pools || {}).rage;
          if (pool && pool.used >= pool.max) return no(`${me.name} has no rages left until a long rest.`);
          if (pool) pool.used += 1;
          w.spent[me.id].bonus += 1;
          me.conditions = Array.from(new Set((me.conditions || []).concat('Raging')));
          w.effects.push({ id: `rage-${me.id}-${w.effects.length}`, unit: me.id, condition: 'Raging', ends: 'end', of: me.id, rounds: 10, save: null, source: me.id, conc: false, level: 0, amount: '' });
          return { ok: true, world: w, log: [{ unit: me.id, text: `${me.name} rages${pool ? ` (${pool.max >= 99 ? 'unlimited' : `${pool.max - pool.used} of ${pool.max} left`})` : ''}: +${me.riders.rage} damage on Strength melee weapon attacks, resistance to kinetic and energy.` }], events: [] };
        }
        const c = COMMON.find((x) => x.key === act.key);
        if (!c) return no('Unknown action.');
        // a monk can Dash or Disengage as a bonus action (Martial Arts, #67)
        const use = act.asBonus && me.monk && (c.key === 'dash' || c.key === 'disengage') ? 'bonus' : c.use;
        if (act.asBonus && use !== 'bonus') return no(`${me.name} can't take ${c.name} as a bonus action.`);
        if (!b[use]) return no(`${me.name} has already used the ${use === 'bonus' ? 'bonus action' : use} this turn.`);
        w.spent[me.id][use] += 1;
        for (const [k, v] of Object.entries(c.gives)) w.spent[me.id][k] = (+w.spent[me.id][k] || 0) + v;
        return { ok: true, world: w, log: [{ text: `${me.name} takes the ${c.name} action${use !== c.use ? ' as a bonus action' : ''}.` }], events: [] };
      }
      case 'use': {
        // an ability from the table's data: its turn cost, its point cost, then an attack roll or a save for each target
        const ab = act.ability;
        if (!ab || !ab.name) return no('Pick an ability.');
        const slot = ab.use || 'action';
        // Burst and Rapid use as many shots as their number (SW5e), from the weapon they fire
        const gun = ab.kind === 'volley' && ab.weapon != null ? { key: String(ab.weapon), name: ab.name.replace(/, (burst|rapid)$/, ''), reload: (me.shots || {})[String(ab.weapon)] != null } : null;
        const dryV = gun ? noShots(me, gun, +ab.shots || 1) : '';
        if (dryV) return no(dryV);
        if (slot !== 'free' && !b[slot]) return no(`${me.name} has already used the ${slot === 'bonus' ? 'bonus action' : slot} this turn.`);
        const up = Math.max(0, Math.round(+act.upcast || 0));
        // a power's level, upcast included, can't pass the caster's highest level (an at-will power's upcast too)
        if (ab.kind === 'power' && (ab.level || up) && ab.maxLevel != null && ab.level + up > ab.maxLevel) return no(ab.maxLevel ? `${me.name} can cast powers up to level ${ab.maxLevel}.` : `${me.name} can't cast leveled powers yet.`);
        const cost = Object.assign({}, ab.cost || {});
        if (up && ab.pool) cost[ab.pool] = (cost[ab.pool] || 0) + up;
        for (const [pool, n] of Object.entries(cost)) {
          const p = (me.pools || {})[pool];
          if (!p || poolLeft(p) < n) return no(`Not enough ${p ? p.name : pool}: ${n} needed${p ? `, ${poolLeft(p)} left` : ''}.`);
        }
        let ids, origin = null;
        if (ab.area) {   // everyone the template catches, aimed at a point
          const hits = areaHits(w, me.id, ab, act.point);
          if (!hits.ok) return no(hits.why);
          ids = hits.units; origin = hits.origin;
        } else {
          ids = ab.targets === 'self' ? [me.id] : (Array.isArray(act.targets) ? act.targets : [act.target]).filter(Boolean).map(String);
          const max = ab.targets === 'self' ? 1 : ab.targets;
          if (!ids.length) return no('Pick a target.');
          if (new Set(ids).size !== ids.length || ids.length > max) return no(`${ab.name} affects ${max === 1 ? 'one target' : `up to ${max} targets`}.`);
          for (const id of ids) {
            const t = unitAt(w, id);
            if (!t) return no('No such target.');
            if (t.id !== me.id && (w.effects || []).some((ef) => ef.unit === me.id && ef.condition === 'Charmed' && ef.source === t.id) && (ab.attack || ab.save || ab.damage.length)) return no(`${me.name} is charmed by ${t.name} and can't target it with that.`);
            if (ab.attack && (t.ac == null || t.ac === '' || !Number.isFinite(+t.ac))) return no(`${t.name} has no AC set.`);
            const r = inReachOf(w, me, t, ab);
            if (!r.ok) return no(r.why);
            const cv = t.id !== me.id && coverOf(w, me, t);
            if (cv && cv.bonus == null && (ab.attack || ab.save || ab.damage.length)) return no(`${t.name} has total cover.`);
          }
        }
        // pay first: the turn slot and the points; a new concentration power ends the old one
        if (slot !== 'free') w.spent[me.id][slot] += 1;
        if (gun) spendShots(me, gun, +ab.shots || 1);   // a volley's shots
        if (ab.concentration && w.conc[me.id]) endConcentration(w, me.id, `${me.name} starts concentrating on ${ab.name}`, null);
        if (ab.concentration) w.conc[me.id] = ab.name;
        for (const [pool, n] of Object.entries(cost)) if (n) me.pools[pool] = payPool(Object.assign({}, me.pools[pool]), n);   // temporary points first (#190)
        const costText = Object.entries(cost).filter(([, n]) => n).map(([pool, n]) => `${n} ${(me.pools[pool] || {}).name || pool}`).join(', ');
        const log = [{ text: `${me.name} uses ${ab.name}${up ? ` at level ${ab.level + up}` : ''}${costText ? ` (${costText})` : ''}.` }], events = [];   // never says who or how many: a hidden creature may be among them
        const extra = up && ab.upcast ? Array.from({ length: up }, () => ab.upcast.damage).join('+') : '';
        const cruelV = variant(w, 'Crueler Criticals');
        const dmgExpr = (crit) => ab.damage.map((d) => diceExpr(crit ? (cruelV ? `${d.dice}+${maxDice(d.dice)}` : doubleDice(d.dice)) : d.dice, d.add)).join('+') + (extra ? '+' + (crit ? (cruelV ? `${extra}+${maxDice(extra)}` : doubleDice(extra)) : extra) : '');
        const dtype = (ab.damage[0] || {}).type || '';
        for (const id of ids) {
          const t = unitAt(w, id);
          let hit = true, crit = false, half = false, fixed = null;
          if (ab.attack) {
            if (t.ac == null || t.ac === '' || !Number.isFinite(+t.ac)) { log.push({ unit: t.id, text: `${t.name} has no AC set: ${ab.name} can't be rolled against it.` }); continue; }
            const r0 = inReachOf(w, me, t, ab);
            const all = me.id === t.id ? [] : reasons(w, me, t, { melee: r0.melee ? ab.reach : 0, range: ab.range }, r0.feet, !r0.melee);
            const tl = all.filter((x) => !x.note), notes = all.filter((x) => x.note).map((x) => x.text);
            const md = d20(w, tl.filter((x) => x.adv).length + (act.adv ? 1 : 0), tl.filter((x) => x.dis).length + (act.dis ? 1 : 0));
            const adv = md.mode === 'adv', dis = md.mode === 'dis';
            const cv = me.id === t.id || ab.area ? null : coverOf(w, me, t);
            const pfl = me.id === t.id ? 0 : flankOf(w, t, me), ac = +t.ac + (cv ? cv.bonus || 0 : 0) - pfl;
            const tilts = tl.filter((x) => (adv ? x.adv : x.dis)).map((x) => x.text).concat(notes, pfl ? [`${t.name} is flanked, -${pfl} AC`] : []);
            const expr = d20expr(md) + sgn(ab.attack.bonus - weakPenalty(me, ab.attack.abil));
            const r = roll(expr);
            const helped = me.id === t.id ? null : helpOn(w, me, t);   // Help (#144) is used up by a power's attack roll too
            if (helped) w.effects = w.effects.filter((ef) => ef !== helped);
            crit = r.nat === 20; hit = crit || (r.nat !== 1 && r.total >= ac);
            log.push({ unit: t.id, kind: 'attack', roll: r, expr, text: `${ab.name} against ${t.name}${tilts.length ? ` (${adv ? 'advantage: ' : dis ? 'disadvantage: ' : ''}${tilts.join(', ')})` : ''}${cv ? ` (${cv.name} cover, +${cv.bonus} AC)` : ''}: ${r.total} against AC ${ac}, ${crit ? 'a critical hit!' : hit ? 'a hit.' : 'a miss.'}` });
          } else if (ab.save) {
            const bonus = (t.saves || {})[ab.save.ability];
            const fail = effectsOf(t).find(([, e]) => (e.autoFail || []).includes(ab.save.ability));
            const sdis = effectsOf(t).some(([, e]) => (e.saveDis || []).includes(ab.save.ability)) || heavyDis(t, ab.save.ability);
            const sadv = (ab.save.ability === 'dex' && dodging(w, t)) || effectsOf(t).some(([, e]) => (e.saveAdv || []).includes(ab.save.ability));
            // cover helps a Dex save: from the caster for a power aimed at the target, from the origin for an area; flanked makes it worse
            const scv = ab.save.ability !== 'dex' || t.id === me.id ? null : ab.area ? coverFrom(w, origin, t) : coverOf(w, me, t);
            const sfl = ab.save.ability === 'dex' && t.id !== me.id ? flankOf(w, t, me) : 0;
            // a volley (burst or rapid): what would have tilted the attack roll tilts the save the other way
            let vadv = 0, vdis = 0;
            if (ab.kind === 'volley' && t.id !== me.id) {
              const vr = reasons(w, me, t, { range: ab.range, melee: 0 }, feetBetween(me, t), true).filter((x) => !x.note);
              const vm = d20(w, vr.filter((x) => x.adv).length + (act.adv ? 1 : 0), vr.filter((x) => x.dis).length + (act.dis ? 1 : 0));
              if (vm.mode === 'adv') vdis = 1; else if (vm.mode === 'dis') vadv = 1;
            }
            const sm = d20(w, (sadv ? 1 : 0) + vadv, (sdis ? 1 : 0) + vdis);
            const sexpr = d20expr(sm) + sgn((+bonus || 0) - weakPenalty(t, ab.save.ability) + (scv ? scv.bonus || 0 : 0) - sfl);
            const r = roll(sexpr);
            // Critical Saving Throws (the variant): a 20 always saves (any damage at its minimum), a 1 always fails (at its maximum)
            const critSaves = variant(w, 'Critical Saving Throws'), snat = r.nat;
            const saved = !fail && (critSaves && snat === 20 ? true : critSaves && snat === 1 ? false : r.total >= ab.save.dc);
            fixed = critSaves && !fail && snat === 20 ? 'min' : critSaves && snat === 1 ? 'max' : null;
            hit = !saved || ab.save.onSave === 'half'; half = saved && ab.save.onSave === 'half';
            log.push({ unit: t.id, kind: 'save', roll: r, expr: sexpr, text: `${t.name} makes a ${ab.save.ability.toUpperCase()} save against DC ${ab.save.dc}${bonus == null ? ' (no save bonus known)' : ''}${scv ? ` (${scv.name} cover, +${scv.bonus})` : ''}${sdis && !sadv ? ' with disadvantage' : sadv && !sdis ? ' with advantage (dodging)' : ''}: ${r.total}, ${fail ? `an automatic failure (${fail[0].toLowerCase()})` : saved ? 'a success' : 'a failure'}.` });
          }
          if (!hit) { events.push({ kind: 'miss', unit: t.id }); continue; }
          // conditions the ability puts on its target, with how long they last
          if (!half) for (const ap of ab.applies || []) {
            if (!ap.condition) continue;
            if (immuneTo(t, ap.condition)) { log.push({ unit: t.id, text: `${t.name} can't be ${String(ap.condition).toLowerCase()}.` }); continue; }
            t.conditions = Array.from(new Set((t.conditions || []).concat(ap.condition)));
            const until = ap.until || { ends: 'end', of: 'self', rounds: 1 };
            if (ap.condition === 'Ignited' && ap.amount) w.effects = w.effects.filter((ef) => !(ef.unit === t.id && ef.condition === 'Ignited'));   // new flames replace the old
            w.effects.push({ id: `${me.id}-${ab.key}-${t.id}-${w.effects.length}`, unit: t.id, condition: ap.condition, ends: until.ends, of: until.of === 'target' ? t.id : me.id,
              rounds: until.rounds || 1, save: until.save && ab.save ? { ability: ab.save.ability, dc: ab.save.dc } : null, source: me.id, conc: !!ab.concentration,
              level: LEVELS[ap.condition] ? Math.min(LEVELS[ap.condition], +ap.level || 0) : 0, amount: ap.condition === 'Ignited' ? ap.amount || '' : '' });
            log.push({ unit: t.id, text: `${t.name} is ${String(ap.condition).toLowerCase()}${ab.concentration ? ` while ${me.name} concentrates` : ''}.` });
          }
          if (ab.damage.length) {
            const expr = dmgExpr(crit);
            const d = fixed ? { total: fixedTotal(expr, fixed === 'max'), detail: fixed === 'max' ? 'the maximum (a natural 1 on the save)' : 'the minimum (a natural 20 on the save)', nat: null } : roll(expr);
            const raw = Math.max(0, half ? Math.floor(d.total / 2) : d.total) + (ab.kind === 'weapon' ? levelOf(w, t, 'Corroded') : 0);
            const df = defended(t, raw, String(dtype || '').toLowerCase(), ab.kind === 'weapon' ? 'weapon' : 'power');
            const amount = df.amount;
            const took = takeDamage(t, amount);
            log.push({ unit: t.id, kind: 'damage', roll: d, expr, text: `${t.name} takes ${amount}${dtype ? ' ' + dtype : ''} damage${half ? ' (half, on a save)' : ''}${df.note ? ` (${df.note})` : ''}${took.fromTemp ? ` (${took.fromTemp} from temporary hit points)` : ''}${t.hp != null && t.hp <= 0 && took.before > 0 ? ' and drops to 0 hit points.' : '.'}` });
            fallen(t, took, crit, log, w);
            events.push({ kind: crit ? 'crit' : 'hit', unit: t.id, amount });
            concentrationCheck(w, t, amount, roll, log);
          } else if (ab.heal) {
            const expr = diceExpr(ab.heal.dice, ab.heal.add);
            const d = roll(expr);
            const amount = Math.max(0, has(t, 'weakened') ? Math.floor(d.total / 2) : d.total);   // weakened: healing halved
            const top = t.maxHp == null ? null : (+t.exhaustion || 0) >= 4 ? Math.floor(t.maxHp / 2) : t.maxHp;   // exhaustion 4: maximum halved
            if (isDead(t)) { log.push({ unit: t.id, kind: 'heal', roll: d, expr, text: `${t.name} is dead: healing doesn't bring it back.` }); continue; }
            const was0 = t.hp === 0;
            if (t.hp != null) { t.hp = top != null ? Math.max(t.hp, Math.min(top, t.hp + amount)) : t.hp + amount; if (t.hp > 0) delete t.down; }
            if (was0 && t.hp > 0 && t.side === 'pc') { t.deathSaves = { s: 0, f: 0 }; t.conditions = (t.conditions || []).filter((c) => c !== 'Unconscious'); }
            log.push({ unit: t.id, kind: 'heal', roll: d, expr, text: `${t.name} regains ${amount} hit points${was0 && t.hp > 0 && t.side === 'pc' ? ' and wakes' : ''}.` });
            events.push({ kind: 'heal', unit: t.id, amount });
          } else events.push({ kind: 'hit', unit: t.id, amount: 0 });
        }
        return { ok: true, world: w, log, events, spentPools: cost };
      }
      case 'stand': {   // standing up from prone costs half your speed (and can't be done at speed 0)
        if (!(me.conditions || []).includes('Prone')) return no(`${me.name} isn't prone.`);
        const half = Math.ceil(b.speed / 2 / FT) * FT;
        if (!b.speed || b.moveLeft < half) return no(`${me.name} needs ${half || 'some'} ft of movement to stand up.`);
        w.spent[me.id].move += half;
        me.conditions = me.conditions.filter((c) => c !== 'Prone');
        w.effects = (w.effects || []).filter((ef) => !(ef.unit === me.id && ef.condition === 'Prone'));
        return { ok: true, world: w, log: [{ text: `${me.name} stands up (${half} ft).` }], events: [] };
      }
      case 'douse': {   // putting out the flames, on yourself or on someone within 5 ft, takes an action
        if (!b.action) return no(`${me.name} has already used the action this turn.`);
        const t = unitAt(w, act.target);
        if (!t || !(t.conditions || []).includes('Ignited')) return no('Nobody there is on fire.');
        if (t.id !== me.id && feetBetween(me, t) > FT) return no(`${t.name} is out of reach: within 5 ft only.`);
        w.spent[me.id].action += 1;
        w.effects = w.effects.filter((ef) => !(ef.unit === t.id && ef.condition === 'Ignited'));
        t.conditions = t.conditions.filter((c) => c !== 'Ignited');
        return { ok: true, world: w, log: [{ unit: t.id, text: t.id === me.id ? `${me.name} puts out the flames.` : `${me.name} puts out the flames on ${t.name}.` }], events: [] };
      }
      case 'deathsave': {
        if (!isDying(me)) return no(`${me.name} isn't dying.`);
        if (w.spent[me.id].ds) return no(`${me.name} has already made this turn's death save.`);
        const log = [];
        deathSave(me, roll, log);
        w.spent[me.id].ds = 1;
        return { ok: true, world: w, log, events: [] };
      }
      case 'end': {
        const log = [{ text: `${me.name} ends the turn.` }];
        if (isDying(me) && !w.spent[me.id].ds) { deathSave(me, roll, log); w.spent[me.id].ds = 1; }   // the save that starts a dying character's turn
        return { ok: true, world: w, log, events: [], endTurn: true };
      }
      default:
        return no('Unknown combat action.');
    }
  }
  // One weapon attack, rolled and applied: on your turn (the Attack action) or as a reaction. `how` names a reaction.
  function strike(w, me, targetId, attack, opts, roll, how) {
    if (!attack || !Number.isFinite(+attack.bonus) || !attack.damage) return no('Pick an attack.');
    const t = unitAt(w, targetId);
    const pv = preview(w, me.id, targetId, attack, opts);
    if (!pv.legal) return no(pv.why);
    // a maneuver the attacker chose (#67), if it's on offer: Precision Attack adds its die to this roll and is spent now
    const mvOpt = (pv.riders || []).find((x) => x.key === 'maneuver'), want = (opts.add || {}).maneuver;
    const mvKey = mvOpt && typeof want === 'string' && mvOpt.options.some((o) => o.key === want) ? want : null;
    const mv = mvKey ? MANEUVERS[mvKey] : null, sup = mv ? superiorityOf(me) : null;
    const spendMv = () => { sup.used += 1; w.spent[me.id] = Object.assign(spentOf(w, me.id), { mv: (+spentOf(w, me.id).mv || 0) | (1 << MANEUVER_KEYS.indexOf(mvKey)) }); };
    const rexpr = mv && mv.onRoll ? `${pv.expr}+1${sup.die}` : pv.expr;
    const r = roll(rexpr);
    if (mv && mv.onRoll) spendMv();
    const helped = helpOn(w, me, t);   // Help (#144) is used up by this attack, hit or miss
    if (helped) w.effects = w.effects.filter((ef) => ef !== helped);
    const nat = r.nat, fumble = nat === 1;
    let crit = nat === 20 || (nat != null && +attack.critFrom >= 15 && nat >= +attack.critFrom);   // a wider crit range (#165), which always hits
    const hit = crit || (!fumble && r.total >= pv.ac);
    if (hit && pv.feet <= FT && has(t, 'closeCrit')) crit = true;   // any hit from within 5 ft on the paralyzed or unconscious
    const tilt = pv.mode === 'normal' ? '' : ` with ${modeName(pv)} (${pv.tilts.map((x) => x.text).join(', ')})`;
    const log = [{ unit: me.id, kind: 'attack', roll: r, expr: rexpr, text: `${me.name} ${how ? `makes ${how} against` : 'attacks'} ${t.name} with ${attack.name}${tilt}${mv && mv.onRoll ? ` (${mv.name}, +1${sup.die})` : ''}${pv.notes.length ? ` (${pv.notes.join('; ')})` : ''}${pv.weak ? ` (weakened, −${pv.weak})` : ''}: ${r.total} against AC ${pv.ac}, ${crit ? 'a critical hit!' : hit ? 'a hit.' : fumble ? 'a natural 1, a miss.' : 'a miss.'}` }];
    const events = [];
    if (!hit) {
      events.push({ kind: 'miss', unit: t.id });
      // a miss against one who knows Riposte (melee) or Return Fire (ranged) and can use it: a prompt, like an opportunity attack
      const rk = pv.ranged ? 'return-fire' : 'riposte';
      const can = !how && t.maneuvers && t.maneuvers.known.includes(rk) && superiorityOf(t) && !INCAPACITATING(t) && budget(w, t.id).reaction && !maneuverUsed(w, t.id, rk)
        && (rk !== 'riposte' || feetBetween(t, me) <= Math.max(FT, +t.reach || FT));   // a riposte needs the attacker in its reach (#163 review)
      return { ok: true, log, events, reactions: can ? [{ reactor: t.id, against: me.id, kind: rk }] : [] };
    }
    // versatile in two hands (5.8): its larger die for a melee attack, in place of the weapon's own
    const twoHands = !!(opts.twoHands && attack.versatile && !pv.ranged), dmg0 = twoHands ? String(attack.damage).replace(/\d*d\d+/i, attack.versatile) : attack.damage;
    const thr = thresholdFor(me, attack, pv.ranged, pv.feet, twoHands);   // a fighting style's minimum roll threshold (#150)
    const die0 = /d(\d+)/i.exec(String(dmg0 || '')), brutal = crit && !pv.ranged && +attack.brutal > 0 && die0 ? `+${+attack.brutal}d${die0[1]}` : '';   // Brutal Critical (#179)
    const base0 = (!crit ? dmg0 : variant(w, 'Crueler Criticals') ? cruel(dmg0) : twoHands ? doubleDice(dmg0) : attack.crit || dmg0) + brutal;
    const base = (thr ? withThreshold(base0) : base0) + (attack.heavy ? '+' + attack.heavy : '');
    // bonus damage from class features (audit 5.9); a rider the attacker turned down (opts.no) isn't added
    const add = opts.add || {}, fp = (me.pools || {}).force;
    const offered = (pv.riders || []).filter((x) => !((opts.no || []).includes(x.key)));
    // Double Strike's point comes out of the same pool, so with it chosen Force-Empowered Strikes gets one point fewer
    const dbl = add.double && offered.some((x) => x.key === 'double') ? 1 : 0;
    const left = poolLeft(fp);
    const riders = offered.map((x) => {
      if (!x.optIn) return x;
      if (x.key === 'fes') { const n = Math.max(0, Math.min(x.max, left - dbl, Math.round(+add.fes || 0))); return n ? Object.assign({}, x, { dice: `${n}d8`, points: n }) : null; }
      if (x.key === 'double') return add.double ? Object.assign({}, x, { points: 1 }) : null;
      if (x.key === 'maneuver') return mv && !mv.onRoll && !mv.trueDmg ? { key: 'maneuver', name: mv.name, dice: '1' + sup.die } : null;
      return null;
    }).filter(Boolean);
    if (mv && !mv.onRoll) spendMv();   // a superiority die goes on the hit
    if (opts.extra) riders.push(opts.extra);   // a reaction maneuver's die (Riposte, Return Fire), on its hit
    const paid = riders.reduce((n, x) => n + (x.points || 0), 0);
    if (paid && fp) payPool(fp, paid);   // the force points go on the hit, temporary ones first (#190)
    if (riders.some((x) => x.key === 'double')) w.spent[me.id] = Object.assign(spentOf(w, me.id), { double: 1 });   // once a turn
    const expr = base + riders.map((x) => (x.dice ? '+' + (crit ? doubleDice(x.dice) : x.dice) : '+' + x.flat)).join('');
    if (riders.some((x) => x.key === 'sneak')) w.spent[me.id] = Object.assign(spentOf(w, me.id), { sneak: 1 });   // once per turn
    const d = roll(expr);
    const corr = levelOf(w, t, 'Corroded');   // corroded: 1 more damage from weapons for each level
    const df = defended(t, Math.max(0, d.total) + corr, String(attack.type || '').toLowerCase(), attack.enhanced ? 'enhanced' : 'weapon');
    const tr = mv && mv.trueDmg ? roll('1' + sup.die) : null;   // Exploit Weakness: true damage, past any resistance
    const amount = df.amount + (tr ? Math.max(0, tr.total) : 0);
    const what = `${amount}${attack.type ? ' ' + attack.type : ''} damage${twoHands ? ' (two-handed)' : ''}${attack.heavy ? ` (heavy +${attack.heavy})` : ''}${thr ? ` (${thr}: no die under its threshold)` : ''}${brutal ? ` (Brutal Critical ${brutal.slice(1)})` : ''}${riders.length ? ` (with ${riders.map((x) => `${x.name} ${x.dice ? (crit ? doubleDice(x.dice) : x.dice) : '+' + x.flat}${x.points ? `, ${x.points} force point${x.points === 1 ? '' : 's'}` : ''}`).join('; ')})` : ''}${corr ? ` (${corr} more from corrosion)` : ''}${df.note ? ` (${df.note})` : ''}${tr ? ` (${mv.name}: ${tr.total} true damage)` : ''}`;
    const landing = { amount, crit, type: attack.type || '', mv: mv && mv.then ? mvKey : null, dc: mv && mv.then ? me.maneuvers.dc[mv.type] : 0 };
    // Parry (#67): a melee hit on one who knows it, with its reaction and a die, waits for its answer before it lands
    if (!how && !pv.ranged && amount > 0 && t.maneuvers && t.maneuvers.known.includes('parry') && superiorityOf(t) && !INCAPACITATING(t)
      && budget(w, t.id).reaction && !maneuverUsed(w, t.id, 'parry') && !me.hidden && !t.hidden) {
      log.push({ unit: t.id, kind: 'damage', roll: d, expr, text: `${t.name} is hit for ${what}: ${t.name} can parry.` });
      return { ok: true, log, events, reactions: [{ reactor: t.id, against: me.id, kind: 'parry', hit: landing }] };
    }
    const took = takeDamage(t, amount);
    log.push({ unit: t.id, kind: 'damage', roll: d, expr, text: `${t.name} takes ${what}${took.fromTemp ? ` (${took.fromTemp} from temporary hit points)` : ''}${t.hp != null && t.hp <= 0 && took.before > 0 ? ' and drops to 0 hit points.' : '.'}` });
    afterHit(w, me, t, landing, took, roll, log, events);
    return { ok: true, log, events };
  }
  // what follows a hit's damage: dropping at 0, the floating number, concentration, and the attacker's maneuver
  function afterHit(w, me, t, landing, took, roll, log, events) {
    fallen(t, took, landing.crit, log, w);
    events.push({ kind: landing.crit ? 'crit' : 'hit', unit: t.id, amount: landing.amount });
    concentrationCheck(w, t, landing.amount, roll, log);
    const mv = landing.mv && Object.prototype.hasOwnProperty.call(MANEUVERS, landing.mv) ? MANEUVERS[landing.mv] : null;
    if (mv && mv.then && me) maneuverThen(w, me, t, mv, landing.dc, roll, log, events);
  }
  // a hit that waited (Parry): it lands now, less what a parry took off
  function landHit(w, me, t, landing, roll, log, events) {
    const took = takeDamage(t, landing.amount);
    log.push({ unit: t.id, kind: 'landed', text: `${t.name} takes ${landing.amount}${landing.type ? ' ' + landing.type : ''} damage${took.fromTemp ? ` (${took.fromTemp} from temporary hit points)` : ''}${t.hp != null && t.hp <= 0 && took.before > 0 ? ' and drops to 0 hit points.' : '.'}` });
    afterHit(w, me, t, landing, took, roll, log, events);
  }
  // a save against something the engine itself asks for (a maneuver): the target's bonus, automatic failures, and
  // advantage or disadvantage from its conditions and from dodging (Dex)
  function saveVs(w, t, ab, dc, roll, log, what) {
    const fail = effectsOf(t).find(([, e]) => (e.autoFail || []).includes(ab));
    const sdis = effectsOf(t).some(([, e]) => (e.saveDis || []).includes(ab)) || heavyDis(t, ab);
    const sadv = (ab === 'dex' && dodging(w, t)) || effectsOf(t).some(([, e]) => (e.saveAdv || []).includes(ab));
    const m = d20(w, sadv ? 1 : 0, sdis ? 1 : 0), bonus = (+((t.saves || {})[ab]) || 0) - weakPenalty(t, ab), expr = d20expr(m) + sgn(bonus);
    const r = roll(expr), ok = !fail && r.total >= dc;
    log.push({ unit: t.id, kind: 'save', roll: r, expr, text: `${t.name} makes a ${ab.toUpperCase()} save against ${what} (DC ${dc}): ${r.total}, ${fail ? `an automatic failure (${fail[0].toLowerCase()})` : ok ? 'a success' : 'a failure'}.` });
    return ok;
  }
  // what a maneuver does to a creature it hit, once its damage is in
  function maneuverThen(w, me, t, mv, dc, roll, log, events) {
    if (isDead(t)) return;
    if (mv.large && sizeCat(t) > 3) { log.push({ unit: t.id, text: `${t.name} is too big for ${mv.name}.` }); return; }
    if (mv.save && saveVs(w, t, mv.save, dc, roll, log, mv.name)) return;
    const mine = w.turnId === me.id, theirs = w.turnId === t.id;   // "until the end of your (its) next turn"
    const put = (condition, ends, of, rounds, level) => {
      if (immuneTo(t, condition)) { log.push({ unit: t.id, text: `${t.name} can't be ${condition.toLowerCase()}.` }); return false; }
      t.conditions = Array.from(new Set((t.conditions || []).concat(condition)));
      w.effects.push({ id: `mv-${me.id}-${t.id}-${w.effects.length}`, unit: t.id, condition, ends, of, rounds, save: null, source: me.id, conc: false, level: level || 0, amount: '' });
      return true;
    };
    if (mv.then === 'prone') { if (immuneTo(t, 'Prone')) log.push({ unit: t.id, text: `${t.name} can't be knocked prone.` }); else { t.conditions = Array.from(new Set((t.conditions || []).concat('Prone'))); log.push({ unit: t.id, text: `${t.name} is knocked prone.` }); } }
    else if (mv.then === 'push') { const ft = pushAway(w, me, t, 3); log.push({ unit: t.id, text: ft ? `${t.name} is pushed ${ft} ft.` : `There's no room to push ${t.name}: it stays where it is.` }); if (ft) events.push({ kind: 'move', unit: t.id, feet: ft }); }
    else if (mv.then === 'frightened') { if (put('Frightened', 'end', me.id, mine ? 2 : 1)) log.push({ unit: t.id, about: me.id, text: `${t.name} is frightened of ${me.name} until the end of ${me.name}'s next turn.` }); }
    else if (mv.then === 'distract') { w.effects.push({ id: `mv-${me.id}-${t.id}-${w.effects.length}`, unit: t.id, condition: 'Distracted', ends: 'start', of: me.id, rounds: 1, save: null, source: me.id, conc: false, level: 0, amount: '' }); log.push({ unit: t.id, text: `${t.name} is distracted: the next attack on it by someone other than ${me.name} has advantage.` }); }
    else if (mv.then === 'slowed') { if (put('Slowed', 'end', t.id, theirs ? 2 : 1, 1)) log.push({ unit: t.id, text: `${t.name} is slowed (1 level) until the end of its next turn.` }); }
    else if (mv.then === 'stunned') { if (put('Stunned', 'end', t.id, theirs ? 2 : 1)) log.push({ unit: t.id, text: `${t.name} is stunned until the end of its next turn.` }); }
  }
  // moves `t` straight away from `me`, a square at a time, up to `squares`, stopping at a creature, a wall or the board's
  // edge; returns the feet it moved
  function pushAway(w, me, t, squares) {
    const c = (u) => [u.x + (u.size || 1) / 2, u.y + (u.size || 1) / 2], [mx, my] = c(me), [tx0, ty0] = c(t);
    const dx = Math.sign(Math.round(tx0 - mx)), dy = Math.sign(Math.round(ty0 - my)), ts = t.size || 1, stops = (w.walls || []).filter(blocksMove);
    let moved = 0;
    for (let i = 0; i < squares && (dx || dy); i++) {
      const nx = t.x + dx, ny = t.y + dy, [tx, ty] = c(t);
      const taken = Object.values(w.units).some((o) => o.id !== t.id && !o.down && overlaps(nx, ny, ts, o))
        || nx < 0 || ny < 0 || (w.board && (nx + ts > w.board.cols || ny + ts > w.board.rows));   // the board's edge is a wall
      if (taken || !clear(stops, [tx, ty], [tx + dx, ty + dy], () => true)) break;
      t.x = nx; t.y = ny; moved += FT;
    }
    return moved;
  }
  // Who may make an opportunity attack on a move along `path`: a hostile unit that can see the mover, can react, and
  // whose melee reach the mover leaves. `at` is the last square still in that reach, where the attack happens.
  // Disengage, and an invisible mover, give none.
  function opportunities(w, me, path) {
    const out = [];
    if (spentOf(w, me.id).disengage) return out;
    for (const o of Object.values(w.units)) {
      if (o.id === me.id || !hostile(me, o) || o.down || INCAPACITATING(o) || !budget(w, o.id).reaction) continue;
      if ((o.conditions || []).includes('Blinded') && !senseFor(o, me, NO_SIGHT)) continue;           // it must perceive the mover
      if ((me.conditions || []).includes('Invisible') && !senseFor(o, me, SEES_INVISIBLE)) continue;
      const reach = +o.reach || FT;
      for (let i = 0; i + 1 < path.length; i++) {
        const here = Object.assign({}, me, path[i]), next = Object.assign({}, me, path[i + 1]);
        if (feetBetween(o, here) <= reach && feetBetween(o, next) > reach) { out.push({ reactor: o.id, against: me.id, kind: 'opportunity', at: { x: path[i].x, y: path[i].y } }); break; }
      }
    }
    return out;
  }
  // A reaction taken: the opportunity attack, made where the mover left the reach. If it drops the mover, the mover
  // stays there (its movement ends); otherwise it carries on to where it went.
  function react(world, re, roll) {
    const w = clone(world);
    w.spent = w.spent || {}; w.effects = w.effects || []; w.conc = w.conc || {};
    const me = unitAt(w, re.reactor), t = unitAt(w, re.against);
    if (!me || !t) return no('That combatant is not on the map.');
    if (re.kind === 'parry') {   // #67: the hit that waited lands, less a superiority die + the maneuver ability, if parried
      const h = re.hit || {}, landing = { amount: clampN(Math.round(+h.amount || 0), 0, 9999), crit: !!h.crit, type: String(h.type || '').slice(0, 20), mv: typeof h.mv === 'string' ? h.mv : null, dc: clampN(Math.round(+h.dc || 0), 0, 40) };
      const log = [], events = [];
      if (re.take) {
        const sup = superiorityOf(me);
        if (!me.maneuvers || !me.maneuvers.known.includes('parry')) return no(`${me.name} doesn't know Parry.`);
        if (!sup) return no(`${me.name} has no superiority dice left.`);
        if (INCAPACITATING(me) || !budget(w, me.id).reaction) return no(`${me.name} has no reaction left.`);
        const mod = Math.max(...['str', 'dex', 'con'].map((ab) => +((me.mods || {})[ab]) || 0)), expr = '1' + sup.die + sgn(mod), pr = roll(expr);
        const less = Math.min(landing.amount, Math.max(0, pr.total));
        sup.used += 1;
        w.spent[me.id] = Object.assign(spentOf(w, me.id), { reaction: spentOf(w, me.id).reaction + 1, mv: (+spentOf(w, me.id).mv || 0) | (1 << MANEUVER_KEYS.indexOf('parry')) });
        log.push({ unit: me.id, kind: 'parry', roll: pr, expr, text: `${me.name} parries: ${less} less damage.` });
        landing.amount -= less;
      }
      landHit(w, t, me, landing, roll, log, events);
      settle(w, log);
      return { ok: true, world: w, log, events };
    }
    if (t.down) return no(`${t.name} is already down.`);
    if (INCAPACITATING(me)) return no(`${me.name} can't react right now.`);
    if (!budget(w, me.id).reaction) return no(`${me.name} has no reaction left.`);
    if (re.kind === 'riposte' || re.kind === 'return-fire') {   // a reaction maneuver (#67): a superiority die, spent as it's used
      const mv = MANEUVERS[re.kind], sup = superiorityOf(me);
      if (!me.maneuvers || !me.maneuvers.known.includes(re.kind)) return no(`${me.name} doesn't know ${mv.name}.`);
      if (!sup) return no(`${me.name} has no superiority dice left.`);
      if (maneuverUsed(w, me.id, re.kind)) return no(`${me.name} has used ${mv.name} this turn.`);
      if (!re.attack || !re.attack.weapon || (re.kind === 'riposte' ? !(+re.attack.melee > 0) : !re.attack.range)) return no(re.kind === 'riposte' ? 'A riposte is a melee weapon attack.' : 'Return fire is a ranged weapon attack.');
      const dry = noShots(me, re.attack);
      if (dry) return no(dry);
      const s = strike(w, me, t.id, re.attack, { adv: !!re.adv, dis: !!re.dis, extra: { key: 'maneuver', name: mv.name, dice: '1' + sup.die } }, roll, re.kind === 'riposte' ? 'a riposte' : 'return fire');
      if (!s.ok) return s;
      spendShots(me, re.attack);
      sup.used += 1;
      w.spent[me.id] = Object.assign(spentOf(w, me.id), { reaction: spentOf(w, me.id).reaction + 1, mv: (+spentOf(w, me.id).mv || 0) | (1 << MANEUVER_KEYS.indexOf(re.kind)) });
      settle(w, s.log);
      return { ok: true, world: w, log: s.log, events: s.events };
    }
    if (!re.attack || !(+re.attack.melee > 0)) return no('An opportunity attack is a melee attack.');
    const there = { x: t.x, y: t.y };
    if (re.at) { t.x = re.at.x; t.y = re.at.y; }
    const dry = noShots(me, re.attack);
    if (dry) return no(dry);
    const s = strike(w, me, t.id, re.attack, { adv: !!re.adv, dis: !!re.dis }, roll, 'an opportunity attack');
    if (!s.ok) return s;
    spendShots(me, re.attack);
    if (!(t.hp != null && t.hp <= 0)) { t.x = there.x; t.y = there.y; }
    w.spent[me.id] = Object.assign(spentOf(w, me.id), { reaction: spentOf(w, me.id).reaction + 1 });
    settle(w, s.log);
    return { ok: true, world: w, log: s.log, events: s.events };
  }
  // a unit's concentration ends: its effects (and the conditions they gave) go
  function endConcentration(w, id, why, log) {
    const name = w.conc[id];
    if (!name) return;
    delete w.conc[id];
    const gone = w.effects.filter((ef) => ef.source === id && ef.conc);
    w.effects = w.effects.filter((ef) => !(ef.source === id && ef.conc));
    for (const ef of gone) dropCondition(w, ef);
    if (log) log.push({ text: `${why}: ${name} ends.` });
  }
  // a condition given by an effect goes when the effect does (unless another effect still gives it)
  function dropCondition(w, ef) {
    const u = w.units[ef.unit];
    if (!u || w.effects.some((o) => o.unit === ef.unit && o.condition === ef.condition)) return;
    u.conditions = (u.conditions || []).filter((c) => c !== ef.condition);
  }
  // A grapple whose grappler is known ends when the grappler is incapacitated or down, or no longer within 5 ft of it.
  // A grappler this world can't see (hidden from a player) leaves the grapple as it is.
  function settle(w, log) {
    const gone = (w.effects || []).filter((ef) => {
      if (ef.condition !== 'Grappled' || !ef.source || ef.source === ef.unit) return false;
      const g = w.units[ef.source], u = w.units[ef.unit];
      return !!(g && u && (g.down || INCAPACITATING(g) || feetBetween(g, u) > FT));
    });
    if (!gone.length) return;
    w.effects = w.effects.filter((ef) => !gone.includes(ef));
    for (const ef of gone) {
      const u = w.units[ef.unit], was = u && (u.conditions || []).includes('Grappled');
      dropCondition(w, ef);
      if (was && !(u.conditions || []).includes('Grappled')) log.push({ unit: u.id, text: `${u.name} is no longer grappled.` });
    }
  }
  // The DM puts a condition on a unit, or takes one off, from the combat view. A level (Slowed, Corroded), a damage
  // amount (Ignited) or who caused it (any condition; it matters for Charmed and Grappled) is kept on an effect that
  // lasts until the DM takes it off. A bare condition with none of those is the same label HoloTable's tracker sets.
  function setCondition(world, c) {
    const w = clone(world), log = [];
    w.effects = w.effects || []; w.conc = w.conc || {};
    const u = w.units[c.unit];
    if (!u) return no('That combatant is not on the map.');
    const name = String(c.condition || ''), lower = name.toLowerCase();
    if (!name) return no('Pick a condition.');
    if (c.op === 'remove') {
      if (!(u.conditions || []).includes(name)) return no(`${u.name} isn't ${lower}.`);
      w.effects = w.effects.filter((ef) => !(ef.unit === u.id && ef.condition === name));
      u.conditions = u.conditions.filter((x) => x !== name);
      log.push({ unit: u.id, text: `${u.name} is no longer ${lower}.` });
    } else {
      if (immuneTo(u, name)) return no(`${u.name} can't be ${lower}.`);
      const lv = LEVELS[name] ? Math.max(0, Math.min(LEVELS[name], Math.round(+c.level || 0))) : 0;
      const amount = name === 'Ignited' ? String(c.amount || '').replace(/\s+/g, '') : '';
      if (amount && !DICE.test(amount)) return no("That fire damage isn't a dice expression (like 1d6 or 5).");
      const src = c.source && c.source !== u.id && w.units[c.source] ? c.source : null;
      if (!lv && !amount && !src && (u.conditions || []).includes(name)) return no(`${u.name} is already ${lower}.`);
      if (amount) w.effects = w.effects.filter((ef) => !(ef.unit === u.id && ef.condition === 'Ignited'));   // new flames replace the old
      u.conditions = Array.from(new Set((u.conditions || []).concat(name)));
      if (lv || amount || src) w.effects.push({ id: `dm-${u.id}-${w.effects.length}`, unit: u.id, condition: name, ends: 'never', of: u.id, rounds: 1, save: null, source: src, conc: false, level: lv, amount });
      const total = LEVELS[name] ? levelOf(w, u, name) : 0;
      log.push({ unit: u.id, about: src, text: `${u.name} is ${lower}${src ? ` by ${w.units[src].name}` : ''}${total ? ` (level ${total})` : ''}${amount ? ` (${amount} fire damage at the end of each of its turns)` : ''}.` });
    }
    settle(w, log);
    return { ok: true, world: w, log, events: [] };
  }
  // after damage: concentration needs a Con save (DC 10 or half the damage, whichever is higher); 0 hp ends it
  function concentrationCheck(w, t, amount, roll, log) {
    if (!w.conc || !w.conc[t.id] || amount <= 0) return;
    if (t.hp != null && t.hp <= 0) return endConcentration(w, t.id, `${t.name} drops`, log);
    const dc = Math.max(10, Math.floor(amount / 2)), bonus = (+((t.saves || {}).con) || 0) - weakPenalty(t, 'con');
    const r = roll('1d20' + sgn(bonus));
    log.push({ unit: t.id, kind: 'save', roll: r, expr: '1d20' + sgn(bonus), text: `${t.name} makes a concentration save (CON, DC ${dc}): ${r.total}, ${r.total >= dc ? 'a success' : 'a failure'}.` });
    if (r.total < dc) endConcentration(w, t.id, `${t.name} loses concentration`, log);
  }
  // A turn passed from one unit to the next: effects that end at the end of the first one's turn or the start of
  // the next one's go (after their rounds), and an effect that a save can end gives its unit that save at the end of
  // its own turn. Returns the new world and the log; the world passed in is not changed.
  function turnPassed(world, prevId, nextId, roll) {
    const w = clone(world), log = [];
    w.effects = w.effects || []; w.conc = w.conc || {};
    const keep = [];
    for (const ef of w.effects) {
      let ends = false;
      if (ef.save && ef.unit === prevId) {
        const u = w.units[ef.unit], bonus = (+((u && u.saves) || {})[ef.save.ability] || 0) - weakPenalty(u, ef.save.ability);
        const r = roll('1d20' + sgn(bonus));
        log.push({ unit: ef.unit, kind: 'save', roll: r, expr: '1d20' + sgn(bonus), text: `${u ? u.name : 'Someone'} tries to shake off ${ef.condition.toLowerCase()} (${ef.save.ability.toUpperCase()}, DC ${ef.save.dc}): ${r.total}, ${r.total >= ef.save.dc ? 'a success' : 'a failure'}.` });
        if (r.total >= ef.save.dc) ends = true;
      }
      if (!ends && ((ef.ends === 'end' && ef.of === prevId) || (ef.ends === 'start' && ef.of === nextId))) {
        ef.rounds = (ef.rounds || 1) - 1;
        if (ef.rounds <= 0) ends = true;
      }
      if (ends) { const u = w.units[ef.unit]; if (ef.condition !== 'Helped' && ef.condition !== 'Distracted') log.push({ unit: ef.unit, text: `${u ? u.name : 'Someone'} is no longer ${ef.condition.toLowerCase()}.` }); w.endedEffects = (w.endedEffects || []).concat(ef); }
      else keep.push(ef);
    }
    const ended = w.effects.filter((ef) => !keep.includes(ef));
    w.effects = keep;
    for (const ef of ended) dropCondition(w, ef);
    // ignited: the fire damage comes at the end of the burning unit's own turn
    const burning = w.units[prevId], burn = burnOf(w, burning);
    if (burn) {
      const d = roll(burn);
      const df = defended(burning, Math.max(0, d.total), 'fire', 'other');
      const took = takeDamage(burning, df.amount);
      log.push({ unit: burning.id, kind: 'damage', roll: d, expr: burn, text: `${burning.name} burns for ${df.amount} fire damage${df.note ? ` (${df.note})` : ''}${took.fromTemp ? ` (${took.fromTemp} from temporary hit points)` : ''}${burning.hp != null && burning.hp <= 0 && took.before > 0 ? ' and drops to 0 hit points.' : '.'}` });
      fallen(burning, took, false, log, w);
      concentrationCheck(w, burning, df.amount, roll, log);
    }
    // incapacitated casters stop concentrating
    for (const id of Object.keys(w.conc)) if (w.units[id] && INCAPACITATING(w.units[id])) endConcentration(w, id, `${w.units[id].name} is incapacitated`, log);
    settle(w, log);
    return { world: w, log };
  }
  /* ---------------- resistances, immunities, vulnerabilities (audit 5.10, 9.6) ---------------- */
  // A defence is { type, only: 'unenhanced' | null }, read from a stat block line like "Kinetic, Energy" or
  // "Kinetic from unenhanced weapons". Types are HoloTable's own (rules.js DAMAGE_TYPES).
  const DAMAGE = ['acid', 'cold', 'energy', 'fire', 'force', 'ion', 'kinetic', 'lightning', 'necrotic', 'poison', 'psychic', 'sonic', 'true'];
  function readDefenses(lines) {
    const out = [];
    for (const line of Array.isArray(lines) ? lines : [lines]) {
      const t = String(line || '').toLowerCase(), only = /unenhanced|non-?enhanced|nonmagical/.test(t) ? 'unenhanced' : null;
      for (const d of DAMAGE) if (new RegExp(`\\b${d}\\b`).test(t) && !out.some((x) => x.type === d && x.only === only)) out.push({ type: d, only });
    }
    return out.slice(0, 13);
  }
  // how much of a hit a target takes: immune 0, resistant half (rounded down), vulnerable double. A defence that only
  // covers unenhanced weapons doesn't apply to an enhanced weapon or to a power.
  function defended(t, amount, type, how) {
    const applies = (list) => (list || []).some((d) => d.type === type && (!d.only || how === 'weapon'));
    if (amount <= 0) return { amount, note: '' };
    const pet = has(t, 'resistAll');
    if (pet && (pet[1].immune || []).includes(type)) return { amount: 0, note: 'immune' };
    if (pet) return { amount: Math.floor(amount / 2), note: 'resisted' };   // petrified: resistance to all damage
    if (!type) return { amount, note: '' };
    if (applies(t.immune)) return { amount: 0, note: 'immune' };
    let n = amount, note = '';
    if (applies(t.resist) || effectsOf(t).some(([, e]) => (e.resist || []).includes(type))) { n = Math.floor(n / 2); note = 'resisted'; }
    if (applies(t.vuln)) { n *= 2; note = note ? '' : 'vulnerable'; }
    return { amount: n, note };
  }
  // temporary hit points go first; hit points stop at 0; a creature whose hit points aren't known just takes the hit
  function takeDamage(t, amount) {
    const fromTemp = Math.min(Math.max(0, +t.temp || 0), amount), before = t.hp;
    t.temp = (+t.temp || 0) - fromTemp;
    if (t.hp != null) t.hp = Math.max(0, t.hp - (amount - fromTemp));
    if (t.hp === 0) t.down = true;
    return { fromTemp, before, hurt: amount - fromTemp, over: before == null ? 0 : Math.max(0, amount - fromTemp - before) };
  }
  /* ---------------- 0 hit points (audit 7.6), SW5e chapter 9 in our words ---------------- */
  // A character brought to 0 falls unconscious (and prone), unless the damage left over is at least its hit point
  // maximum: then it dies outright. Damage while at 0 is a death save failure (two on a critical hit), or death if
  // it is at least the maximum, and a stable character starts dying again. Death saves live where the sheet keeps
  // them: { s, f }; three successes is stable, three failures is dead. Creatures drop as before (the GM decides).
  const saves0 = (t) => (t.deathSaves = { s: +((t.deathSaves || {}).s) || 0, f: +((t.deathSaves || {}).f) || 0 });
  const isDead = (t) => t.side === 'pc' && t.hp === 0 && +((t.deathSaves || {}).f) >= 3;
  const isStable = (t) => t.side === 'pc' && t.hp === 0 && !isDead(t) && +((t.deathSaves || {}).s) >= 3;
  const isDying = (t) => t.side === 'pc' && t.hp === 0 && !isDead(t) && !isStable(t);
  function fallen(t, took, crit, log, w) {
    if (t.side !== 'pc' || t.hp == null || t.hp > 0 || !(took.hurt > 0)) return;
    const ds = saves0(t), max = +t.maxHp || 0;
    if (ds.f >= 3) return;
    if (took.before > 0) {
      if (max && took.over >= max) { ds.f = 3; log.push({ unit: t.id, text: `${t.name} is killed outright: the damage left over is at least ${t.name}'s hit point maximum.` }); return; }
      ds.s = 0; ds.f = 0;
      t.conditions = Array.from(new Set((t.conditions || []).concat('Unconscious', 'Prone'))).filter((c) => c !== 'Raging');   // a rage ends when knocked unconscious
      if (w && w.effects) w.effects = w.effects.filter((ef) => !(ef.unit === t.id && ef.condition === 'Raging'));
      log.push({ unit: t.id, text: `${t.name} falls unconscious.` });
      return;
    }
    if (max && took.hurt >= max) { ds.f = 3; log.push({ unit: t.id, text: `${t.name} dies: damage at 0 hit points that is at least the hit point maximum.` }); return; }
    if (ds.s >= 3) ds.s = 0;   // stable no longer
    ds.f = Math.min(3, ds.f + (crit ? 2 : 1));
    log.push({ unit: t.id, text: `${t.name} takes damage at 0 hit points: ${crit ? 'two death save failures' : 'a death save failure'}${ds.f >= 3 ? `. ${t.name} dies.` : ` (${ds.f} of 3).`}` });
  }
  // a death save at the start of the dying character's turn: 10 or more succeeds, a 1 is two failures, a 20 is 1 hit point
  function deathSave(t, roll, log) {
    const ds = saves0(t), r = roll('1d20');
    const nat = r.nat == null ? r.total : r.nat;
    let text;
    if (nat >= 20) { t.hp = 1; delete t.down; ds.s = 0; ds.f = 0; t.conditions = (t.conditions || []).filter((c) => c !== 'Unconscious'); text = `a 20: ${t.name} regains 1 hit point and wakes.`; }
    else if (nat <= 1) { ds.f = Math.min(3, ds.f + 2); text = `a 1: two failures${ds.f >= 3 ? `. ${t.name} dies.` : ` (${ds.f} of 3).`}`; }
    else if (r.total >= 10) { ds.s = Math.min(3, ds.s + 1); text = ds.s >= 3 ? `a success: ${t.name} is stable.` : `a success (${ds.s} of 3).`; }
    else { ds.f = Math.min(3, ds.f + 1); text = `a failure${ds.f >= 3 ? `. ${t.name} dies.` : ` (${ds.f} of 3).`}`; }
    log.push({ unit: t.id, kind: 'save', roll: r, expr: '1d20', text: `${t.name} makes a death save: ${r.total}, ${text}` });
  }

  // walls as stored on a map: checked, rounded to 0.01 of a square, at most 2000
  // kinds and max: what may come in. A map stores only WALL_KINDS, at most 2,000; a world also takes 'sight' (objects
  // that block sight, #110: four edges for each of up to 1,500 props), which the server adds from the map and never stores
  function cleanWalls(list, kinds = WALL_KINDS, max = 2000) {
    const n = (v) => Math.round(clampN(+v || 0, -500, 1000) * 100) / 100;
    return (Array.isArray(list) ? list : []).slice(0, max).filter((w) => w && Array.isArray(w.a) && Array.isArray(w.b) && kinds.includes(w.kind || 'wall'))
      .map((w) => ({ id: String(w.id || '').replace(/[^a-z0-9]/g, '').slice(0, 20), a: [n(w.a[0]), n(w.a[1])], b: [n(w.b[0]), n(w.b[1])], kind: w.kind || 'wall', ...(w.kind === 'door' ? { open: !!w.open } : {}) }))
      .filter((w) => w.a[0] !== w.b[0] || w.a[1] !== w.b[1]);
  }
  /* ---------------- building a world from the table ---------------- */
  // table: { characters, entries (initiative, in order), active, turn (index) or turnId, round, tokens, unitTokens: { entryId: tokenId },
  //          npcSpeed: { entryId: feet }, spent: { unitId: { key, move, action, bonus, reaction } } }
  function buildWorld(table, rules) {
    const tokens = Object.fromEntries((table.tokens || []).map((t) => [t.id, t]));
    const units = {};
    for (const e of table.entries || []) {
      const tok = tokens[(table.unitTokens || {})[e.id]];
      if (!tok) continue;
      const ch = e.charId && (table.characters || {})[e.charId];
      const hp = ch ? ch.hp || {} : null;
      units[e.id] = {
        id: e.id, name: e.name, side: e.charId ? 'pc' : 'npc', charId: e.charId || null, owner: ch ? ch.owner : null, tokenId: tok.id,
        x: tok.x, y: tok.y, size: tok.size || 1,
        sizeCat: ch ? null : ((table.npcStats || {})[e.id] || {}).sizeCat ?? null,
        reach: ch && rules ? Math.max(FT, ...attacksOf(ch, rules).map((a) => a.melee || 0)) : +(((table.npcStats || {})[e.id] || {}).reach) || FT,
        ac: ch ? +ch.ac : e.ac == null || e.ac === '' ? null : +e.ac,
        hp: ch ? +hp.current : e.hp == null || e.hp === '' ? null : +e.hp, maxHp: ch ? +hp.max : e.maxHp == null ? null : +e.maxHp,
        temp: ch ? +hp.temp || 0 : 0,
        // the table's encumbrance variant (audit 6.5, rules.js carrying): a character's load slows it, and a heavy one tilts its rolls;
        // a Monk out of armor adds its Unarmored Movement (#67)
        ...(() => { const cw = ch && rules && rules.carrying ? rules.carrying(ch, table.variants) : null;
          return { speed: ch ? Math.max(0, (+ch.speed || 30) + unarmoredMoveOf(ch, rules) - (cw ? cw.slow : 0)) : +((table.npcSpeed || {})[e.id]) || 30,
            encumbered: cw && cw.slow >= 20 ? 'heavy' : cw && cw.slow ? 'encumbered' : '' }; })(),
        // its classes' own pools (#108's presets) are there even before the sheet has added them; the server stores one on
        // the sheet the first time it's spent (writeBack), so Action Surge, maneuvers and the rest work on any sheet
        pools: ch ? Object.fromEntries(resourcesOf(rules && rules.withClassResources ? Object.assign({}, ch, { resources: cleanResources(rules.withClassResources(ch)) }) : ch, rules).map((r) => [r.key, r])) : {},
        riders: ch ? ridersOf(ch, rules) : {},
        attacks: ch ? attacksPerAction(ch) : 1, offhands: ch ? bonusAttacksOf(ch) : 0,
        // shots left in each Reload weapon (6.6, #179), by attack key; Reliable Talent on the contest skills
        shots: ch && rules && rules.shotsOf ? Object.fromEntries((ch.attacks || []).map((a, i) => [String(i), rules.shotsOf(a)]).filter(([, v]) => v != null)) : {},
        reloads: ch && rules && rules.reloadOf ? Object.fromEntries((ch.attacks || []).map((a, i) => [String(i), rules.reloadOf(a)]).filter(([, v]) => v)) : {},
        reliable: ch && rules && rules.reliableTalent && rules.reliableTalent(ch) ? Object.fromEntries(['athletics', 'acrobatics'].map((k) => [k, +((ch.skills || {})[k] || 0) >= 1])) : {}, maneuvers: ch ? maneuversOf(ch, rules) : null, styles: ch ? stylesOf(ch) : {},   // per Attack action (#139); a creature's Multiattack comes with its attack
        // Raging is a rage in progress: without its live effect (the fight ended, a new one began) it's dropped here
        conditions: Array.from(new Set([].concat(e.conditions || [], ch ? ch.conditions || [] : [])))
          .filter((c) => c !== 'Raging' || (table.effects || []).some((ef) => ef.unit === e.id && ef.condition === 'Raging')),
        exhaustion: ch ? +ch.exhaustion || 0 : 0,
        deathSaves: ch ? { s: +((ch.deathSaves || {}).s) || 0, f: +((ch.deathSaves || {}).f) || 0 } : null,
        ...(() => { const d = ch ? (table.defenses || {})[e.charId] || {} : (table.npcStats || {})[e.id] || {};
          return { resist: d.resist || [], immune: d.immune || [], vuln: d.vuln || [], condImmune: d.condImmune || [],
            senses: cleanSenses(ch ? ch.senses : d.senses) }; })(),   // a character's from its sheet (#92, the GM's), a creature's from its stat block
        saves: ch && rules ? Object.fromEntries(ABILS.map((ab) => [ab, rules.saveBonus(ch, ab)])) : Object.assign({}, ((table.npcStats || {})[e.id] || {}).saves),
        mods: ch && rules ? Object.fromEntries(ABILS.map((ab) => [ab, rules.abilityMod(ch, ab)])) : Object.assign({}, ((table.npcStats || {})[e.id] || {}).mods),
        // for Grapple and Shove (#144): a character's from its sheet, a creature's from its stat block
        // ...a monk's Athletics may use Dex in place of Str (Martial Arts)
        skills: ch && rules ? { athletics: rules.skillBonus(ch, 'athletics') + (martialDieOf(ch, rules) ? Math.max(0, rules.abilityMod(ch, 'dex') - rules.abilityMod(ch, 'str')) : 0), acrobatics: rules.skillBonus(ch, 'acrobatics') } : Object.assign({}, ((table.npcStats || {})[e.id] || {}).skills),
        monk: ch ? martialDieOf(ch, rules) : null,   // the Martial Arts die (#67)
      };
      if (units[e.id].hp != null && units[e.id].hp <= 0) units[e.id].down = true;
    }
    const cur = table.turnId !== undefined ? (table.entries || []).find((e) => e.id === table.turnId) : (table.entries || [])[table.turn];
    return {
      active: !!table.active && !!cur, round: table.round || 1, turnId: cur ? cur.id : null, units,
      spent: table.spent || {}, effects: table.effects || [], conc: table.conc || {}, walls: cleanWalls(table.walls, WALL_KINDS.concat('sight'), 8000), variants: Array.isArray(table.variants) ? table.variants.map(String) : [],
    };
  }

  return { FT, TURN, squaresBetween, feetBetween, reachable, readRange, attacksOf, attackFromBehavior, REASONS, preview, budget, apply, takeDamage, buildWorld, turnKey,
    cleanResources, resourcesOf, atLevel, spend, rest, powerNumbers, resolvePower, weaponAbility, abilitiesOf, inReachOf, cleanAbility, setPoolUsed,
    ruler, areaSquares, areaHits, CONDITION_EFFECTS, turnPassed, endConcentration, readDefenses, defended, DAMAGE, gridFeet,
    setCondition, levelOf, burnOf, weakPenalty, LEVELS, DICE, pathTo, opportunities, react, COMMON, sizeCat, spentOf,
    SENSES, readSenses, cleanSenses, senseFor, reasons, isDead, isStable, isDying, crosses, sees, cleanWalls, WALL_KINDS, coverOf, d20, flankOf, fixedTotal, cruel, modeName,
    sightPolygon, visibleSquares, seenIn, packSquares, unpackSquares, lightSquares, LIGHT_LEVELS, sqFeet, inDark, seesInLight, walkable, poolLeft, payPool, ridersOf, unarmoredMoveOf, wearsArmor, ridersFor, attacksPerAction, multiattackOf, offhandOf, stylesOf, withThreshold, thresholdFor, MIN_THRESHOLD, contestBonus, helpOn, maneuverCheck, unitAt, weaponProps, volleysOf, MANEUVERS, maneuversOf, superiorityOf, saveVs, pushAway, landHit, martialOf, martialDieOf, noShots };
});
