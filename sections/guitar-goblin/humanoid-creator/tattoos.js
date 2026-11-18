// Mirialan tattoos: small geometric shapes in tidy, mirrored groups, each group a placement that can be worn alone
// or with others. The shapes, groups and inks here are our own arrangements in the tradition's idiom (rows and
// lattices of diamonds, triangles, bars and dots), not any one person's. Drawn by the face painter (face-paint.js).
export const PLACES = { brow: { name: 'Brow' }, eyes: { name: 'Eye corners' }, cheeks: { name: 'Cheeks' }, nose: { name: 'Nose' }, chin: { name: 'Chin' } };
export const SHAPES = { diamond: { name: 'Diamonds' }, triangle: { name: 'Triangles' }, bar: { name: 'Bars' }, dot: { name: 'Dots' } };
export const INKS = [{ key: 'black', name: 'Black', c: '#0e0e11' }, { key: 'blue', name: 'Deep blue', c: '#122340' }, { key: 'green', name: 'Deep green', c: '#0d2c20' }, { key: 'rust', name: 'Rust', c: '#4a1b12' }, { key: 'white', name: 'Chalk', c: '#d9d6cc' }];

// each mark: [x, y, half width, half height, turn (radians, for triangles: which way they point)]; x > 0 marks are mirrored
function layout(place, P) {
  const Y = (y) => y * P.L, e = P.eye[0], m = [];
  if (place === 'brow') { m.push([0, 0.034, 0.0036, 0.0048, 0], [0, 0.0455, 0.003, 0.004, 0], [0, 0.0555, 0.0024, 0.0032, 0], [0.0078, 0.0398, 0.0026, 0.0035, 0], [0.0078, 0.0505, 0.002, 0.0028, 0]); }
  if (place === 'eyes') { for (let i = 0; i < 3; i++) m.push([e + 0.0215 + i * 0.0068, 0.0015 + i * 0.0022, 0.0029 - i * 0.0004, 0.0037 - i * 0.0005, -Math.PI / 2]); }
  if (place === 'cheeks') { for (let i = 0; i < 4; i++) m.push([0.02 + i * 0.0082, Y(-0.0215) - i * 0.0006, 0.003, 0.004, 0]); for (let i = 0; i < 3; i++) m.push([0.0241 + i * 0.0082, Y(-0.0305) - i * 0.0006, 0.0026, 0.0035, 0]); }
  if (place === 'nose') { for (let i = 0; i < 4; i++) m.push([0, 0.006 - i * 0.0095, 0.0022, 0.003, 0]); }
  if (place === 'chin') { for (const x of [0, 0.0078]) m.push([x, Y(-0.0905), 0.0029, 0.0038, 0]); m.push([0.0039, Y(-0.0985), 0.0027, 0.0036, 0], [0, Y(-0.1062), 0.0025, 0.0033, 0]); }
  return m;
}
export function tattooMarks(places, shape, ink) {
  return ({ g, at, P, css }) => {
    const draw = (x, y, w, h, turn) => {
      let pts;
      if (shape === 'triangle') pts = [[-w, h * 0.8], [w, h * 0.8], [0, -h]];
      else if (shape === 'bar') pts = [[-w * 1.25, h * 0.36], [w * 1.25, h * 0.36], [w * 1.25, -h * 0.36], [-w * 1.25, -h * 0.36]];
      else if (shape === 'dot') pts = Array.from({ length: 10 }, (_, i) => [w * 0.85 * Math.cos(i * 0.628), w * 0.85 * Math.sin(i * 0.628)]);
      else pts = [[-w, 0], [0, h], [w, 0], [0, -h]];
      const c = Math.cos(turn), s = Math.sin(turn) * Math.sign(x || 1);
      g.beginPath(); pts.forEach(([a, b], i) => { const p = at(x + a * c - b * s, y + a * s + b * c); if (i) g.lineTo(p[0], p[1]); else g.moveTo(p[0], p[1]); }); g.closePath(); g.fill();
    };
    g.save(); g.fillStyle = css(ink); g.globalAlpha = 0.9;
    for (const place of places) for (const [x, y, w, h, t] of layout(place, P)) { draw(x, y, w, h, t); if (x > 0) draw(-x, y, w, h, t); }
    g.restore();
  };
}
