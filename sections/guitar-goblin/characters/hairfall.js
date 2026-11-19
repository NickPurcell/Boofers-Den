// Hair worn down (the bob and long hair): it hangs past the ears onto the neck and shoulders, so it is not bound to the
// scalp like the other styles but worked out in a worker against the live figure, as the clothes are. The shape is the
// earlier creator's own (../humanoid-creator/hair.js hairField: a cap from the hairline, and a curtain hanging round the
// head and neck, open round the face, combed into locks), seen in the earlier head's frame (as tentacles.js does), kept
// outside the whole figure, and meshed; the result is turned back into the figure's frame. Pure: the workers build it.
import { hairField } from '../humanoid-creator/hair.js';
import { fieldFor } from './bodyfield.js';
import { mesh } from '../duros-creator/sdf.js';

// a: { mesh: { position, normal, index }, frame: { origin, x, up, fw, k }, style: 'bob' | 'long', coarse }
export function hairDown(a) {
  const { position: P, normal: N, index: I } = a.mesh, F = a.frame, k = F.k, all = fieldFor(P, N, I, null, 0.08);
  const toWorld = (p) => [F.origin[0] + k * (p[0] * F.x[0] + p[1] * F.up[0] + p[2] * F.fw[0]), F.origin[1] + k * (p[0] * F.x[1] + p[1] * F.up[1] + p[2] * F.fw[1]), F.origin[2] + k * (p[0] * F.x[2] + p[1] * F.up[2] + p[2] * F.fw[2])];
  const head = (x, y, z) => all(...toWorld([x, y, z])) / k;
  const H = hairField(a.style, head); if (!H) return null;
  const f = (x, y, z) => { const h = H.field(x, y, z); return h > 0.02 ? h : Math.max(h, -(head(x, y, z) - 0.002)); };   // and never inside the figure (the shoulders below the head too)
  const m = mesh(f, H.bounds, 0.0034 * (a.coarse || 1), { aoStep: 0.006, uvScale: 0.03 });
  const n = m.position.length / 3;
  for (let i = 0; i < n; i++) {
    const p = toWorld([m.position[i * 3], m.position[i * 3 + 1], m.position[i * 3 + 2]]); m.position[i * 3] = p[0]; m.position[i * 3 + 1] = p[1]; m.position[i * 3 + 2] = p[2];
    const q = [m.normal[i * 3], m.normal[i * 3 + 1], m.normal[i * 3 + 2]];
    m.normal[i * 3] = q[0] * F.x[0] + q[1] * F.up[0] + q[2] * F.fw[0]; m.normal[i * 3 + 1] = q[0] * F.x[1] + q[1] * F.up[1] + q[2] * F.fw[1]; m.normal[i * 3 + 2] = q[0] * F.x[2] + q[1] * F.up[2] + q[2] * F.fw[2];
  }
  return m;
}
