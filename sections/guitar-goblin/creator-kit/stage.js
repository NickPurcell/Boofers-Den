// The stage every creator page stands its figure on: the renderer, a studio (a floor that fades into a wall all the
// way round, and a dark room of light panels for reflections), a three-point light with soft shadows, orbit
// controls, drawing only when something has changed, and the picture export. A page makes one stage, adds its
// figure to stage.scene, and calls stage.start().
//
//   const stage = makeStage(document.getElementById('scene'), { tall: 1.8 });
//   stage.scene.add(figure);  stage.view([0, 0.9, 0], [1.3, 1.2, 3.7]);  stage.start();
//   after any change:  stage.redraw()  (or stage.changed() if shadows moved too)
//   pictures:  stage.download(stage.snapshot(1024, 'studio', stage.squareCamera()), 'portrait.png')
//
// three.js is the copy vendored in ../vendor/three (r185), loaded through the page's import map.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export function makeStage(canvas, o = {}) {
  const tall = o.tall ?? 1.8;   // roughly how tall the figure is, in metres: the light and the shadow are set to it
  const phone = Math.min(screen.width, screen.height) < 600 || /Mobi|Android/i.test(navigator.userAgent);
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' }); }
  catch (e) { if (o.onNoGL) o.onNoGL(e); throw e; }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, phone ? 1.75 : 2));
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = o.exposure ?? 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.shadowMap.autoUpdate = false;   // figures mostly stand still: shadows are drawn again only after a change

  const scene = new THREE.Scene();
  // a room to reflect: dark, with light panels, which is what makes metal read as metal and skin catch a sheen
  {
    const env = new THREE.Scene();
    env.add(new THREE.Mesh(new THREE.SphereGeometry(10, 24, 12), new THREE.MeshBasicMaterial({ color: 0x232a36, side: THREE.BackSide })));
    const panel = (w, h, col, pos) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: col, side: THREE.DoubleSide })); m.position.set(...pos); m.lookAt(0, 0.5, 0); env.add(m); };
    panel(4, 5, 0xfff1dc, [5, 4, 6]);       // key softbox
    panel(6, 3, 0x9fd0ff, [-6, 3, -5]);     // rim
    panel(8, 8, 0x6a7686, [0, 8, 0]);       // ceiling bounce
    panel(3, 6, 0xcfe0ff, [-6, 1.5, 4]);    // fill
    panel(12, 1.2, 0x8e8474, [0, -1.2, 6]); // a strip of floor light, so undersides are not black
    const floor = new THREE.Mesh(new THREE.CircleGeometry(10, 24), new THREE.MeshBasicMaterial({ color: 0x1a1d22 })); floor.rotation.x = -Math.PI / 2; floor.position.y = -1.5; env.add(floor);
    const pm = new THREE.PMREMGenerator(renderer);
    scene.environment = pm.fromScene(env, 0.03).texture;
    pm.dispose();
  }
  scene.environmentIntensity = o.environment ?? 0.75;

  // three-point light: a warm key that casts soft shadows, a cool fill, and rims from behind
  const mid = tall * 0.45, key = new THREE.DirectionalLight(0xffecd6, o.key ?? 2.5);
  key.position.set(1.6, mid + 2.25, 2.3); key.target.position.set(0, mid, 0);
  key.castShadow = true;
  key.shadow.mapSize.set(phone ? 1024 : 2048, phone ? 1024 : 2048);
  const reach = Math.max(1.0, tall * 0.75);
  Object.assign(key.shadow.camera, { left: -reach, right: reach, top: reach + 0.1, bottom: -reach, near: 1.2, far: 7 });
  key.shadow.bias = -0.0003; key.shadow.normalBias = o.normalBias ?? 0.006; key.shadow.radius = 4; key.shadow.intensity = 0.8;
  scene.add(key, key.target);
  const fill = new THREE.DirectionalLight(0xb9d4ff, 0.5); fill.position.set(-2.2, mid + 0.6, 1.6); fill.target.position.set(0, mid, 0); scene.add(fill, fill.target);
  const rim = new THREE.DirectionalLight(0xc4dcff, 1.7); rim.position.set(-1.3, mid + 1.4, -2.4); rim.target.position.set(0, mid, 0); scene.add(rim, rim.target);
  const rim2 = new THREE.DirectionalLight(0xffd2b0, 0.8); rim2.position.set(1.8, mid + 0.8, -1.8); rim2.target.position.set(0, mid, 0); scene.add(rim2, rim2.target);
  scene.add(new THREE.HemisphereLight(0x8ea7c7, 0x2a241c, 0.4));

  // the studio: a pool of light on the floor, dark by the time it meets a wall that runs all the way round
  const fade = (g, f) => { const pos = g.attributes.position, col = new Float32Array(pos.count * 3); for (let i = 0; i < pos.count; i++) col.set(f(pos.getX(i), pos.getY(i), pos.getZ(i)), i * 3); g.setAttribute('color', new THREE.BufferAttribute(col, 3)); return g; };
  const studio = new THREE.Group(); scene.add(studio);
  {
    const fg = fade(new THREE.RingGeometry(0.001, 3.4, 72, 20).rotateX(-Math.PI / 2), (x, y, z) => { const t = Math.exp(-(x * x + z * z) / 1.5); return [0.004 + 0.085 * t, 0.005 + 0.095 * t, 0.007 + 0.11 * t]; });
    const floor = new THREE.Mesh(fg, new THREE.MeshLambertMaterial({ vertexColors: true })); floor.receiveShadow = true; studio.add(floor);
    const band = Math.max(1.0, tall * 0.62);   // a soft band of light on the wall at the figure's height
    const bg = fade(new THREE.CylinderGeometry(3.4, 3.4, 5, 72, 14, true), (x, y) => { const h = y + 2.5, t = Math.exp(-(((h - band) / 0.9) ** 2)) * Math.min(1, h / 0.5); return [0.004 + 0.035 * t, 0.005 + 0.048 * t, 0.008 + 0.068 * t]; });
    const sweep = new THREE.Mesh(bg, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })); sweep.position.set(0, 2.5, 0); studio.add(sweep);
  }
  // a floor that shows only the shadow, for a plain or transparent background
  const catcher = new THREE.Mesh(new THREE.PlaneGeometry(4, 4).rotateX(-Math.PI / 2), new THREE.ShadowMaterial({ opacity: 0.42 }));
  catcher.receiveShadow = true; catcher.visible = false; scene.add(catcher);

  let dirty = true;
  const redraw = () => { dirty = true; };
  const changed = () => { renderer.shadowMap.needsUpdate = true; dirty = true; };
  const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 30);
  const controls = new OrbitControls(camera, canvas);
  controls.enablePan = false; controls.enableDamping = true; controls.dampingFactor = 0.08;
  controls.minDistance = o.minDistance ?? 0.4; controls.maxDistance = o.maxDistance ?? 6; controls.minPolarAngle = 0.35; controls.maxPolarAngle = o.maxPolar ?? 1.72;
  controls.addEventListener('change', redraw);
  // a narrow screen gets a wider lens, so the figure still fits
  const fovFor = (aspect) => (aspect < 0.9 ? 30 + (0.9 - aspect) * 26 : 30);

  const stage = {
    THREE, renderer, scene, camera, controls, studio, key, phone, redraw, changed, fovFor,
    beforeRender: null,   // set to a function (camera) to run just before every draw, pictures included
    // look at `target` from `pos`
    view(target, pos) { controls.target.set(...target); camera.position.set(...pos); controls.update(); redraw(); },
    // the current view as a square camera, for a portrait
    squareCamera() { const cam = camera.clone(); cam.aspect = 1; cam.fov = fovFor(1); cam.updateProjectionMatrix(); return cam; },
    // Draw the scene square at `size` from a camera, on the studio ('studio'), a plain colour ('plain') or nothing
    // ('none'), and return a PNG data URL. ground: keep the soft shadow on the floor when there is no studio.
    snapshot(size, bg, cam, ground = true) {
      const keep = { w: canvas.clientWidth, h: canvas.clientHeight, pr: renderer.getPixelRatio() };
      renderer.setPixelRatio(1); renderer.setSize(size, size, false);
      studio.visible = bg === 'studio'; catcher.visible = bg !== 'studio' && ground;
      renderer.setClearColor(0x161d29, bg === 'plain' ? 1 : 0);
      if (stage.beforeRender) stage.beforeRender(cam);
      renderer.render(scene, cam);
      const url = canvas.toDataURL('image/png');
      studio.visible = true; catcher.visible = false; renderer.setClearColor(0x000000, 0);
      renderer.setPixelRatio(keep.pr); renderer.setSize(keep.w, keep.h, false);
      redraw();
      return url;
    },
    download(url, name) { const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); },
    // Start drawing. tick(dt), if given, runs every frame before the draw; return true from it when the figure moved.
    start(tick) {
      let last = performance.now();
      renderer.setAnimationLoop((now) => {
        const dt = Math.min(0.1, (now - last) / 1000); last = now;
        const w = canvas.clientWidth, h = canvas.clientHeight;
        if (w && h) {
          const pr = renderer.getPixelRatio();
          if (canvas.width !== Math.floor(w * pr) || canvas.height !== Math.floor(h * pr)) { renderer.setSize(w, h, false); dirty = true; }
          if (camera.aspect !== w / h) { camera.aspect = w / h; camera.fov = fovFor(w / h); camera.updateProjectionMatrix(); dirty = true; }
        }
        controls.update();   // damping keeps moving the camera for a moment after a drag; 'change' marks those frames
        if (tick && tick(dt)) changed();
        if (!dirty) return;
        dirty = false;
        if (stage.beforeRender) stage.beforeRender(camera);
        renderer.render(scene, camera);
      });
    },
    stats: () => ({ tris: renderer.info.render.triangles, calls: renderer.info.render.calls, geometries: renderer.info.memory.geometries }),
  };
  return stage;
}
