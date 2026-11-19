// Character creator on the human base (in progress): the figure from ../human-base/ (engineer13's library: the body,
// its shapes, skin, eyes and the Pureblood's features), with this page's hair (hair.js) and, next, its clothes.
import * as THREE from 'three';
import { makeStage } from '../creator-kit/stage.js';
import { loadBase, DEFAULTS } from '../human-base/base.js';
import { pureblood, PUREBLOOD } from '../human-base/species/pureblood.js';
import { makeHair } from './hair.js';
import { STYLES } from './hair-shape.js';

const $ = (id) => document.getElementById(id);
const stage = makeStage($('scene'), { tall: 1.8, minDistance: 0.22, maxDistance: 6, onNoGL: () => { $('nogl').hidden = false; } });
const base = await loadBase();
const fig = base.figure(); stage.scene.add(fig);
const pb = pureblood(fig, base);
const hair = makeHair(base, fig);

// his character's look by default (a heavy, broad-shouldered man, red skin, orange-yellow eyes, black hair slicked back):
// the build and look are the base's own Pureblood preset (human-base-test), until the library exports one
const SHAPE = { gender: 1, age: 0.08, muscle: 0.82, weight: 0.86, height: 0.2, shoulders: 0.9, chest: 0.55, pecs: 0.45, lats: 0.6, belly: 0.45, heavyset: 0.55, arms: 0.45, armMuscle: 0.5,
  neck: 0.9, neckDepth: 0.6, doubleChin: 0.1, browh: -0.3, browr: 0.6, browa: -0.35, lids: -0.35, forehead: 0.1, eyesize: -0.2, eyebags: 0.15, nosew: 0.35, nosel: 0.1, nosehump: 0.3,
  nostrils: 0.2, mouthw: 0.15, lips: -0.1, corners: -0.2, cheekbones: 0.65, cheeks: -0.2, chinw: 0.55, chinjut: 0.3, chinh: 0.15, jaw: 0.9, headfat: 0.1, headage: 0.25, square: 0.45 };
const LOOK = { skin: '#952a22', eyes: 'ember', glow: 0.35, brows: 0, white: '#9a6a48', iris: 1.3, lips: '#2a0c0c', sockets: 0.6 };
const HAIRS = { black: '#16110e', dkbrown: '#2a1d14', redbrown: '#4a1a14', grey: '#8a8684', white: '#d8d4d0' };
const state = { style: 'slick', hair: 'black' };
{ const q = new URLSearchParams(location.hash.slice(1)); if (STYLES[q.get('style')]) state.style = q.get('style'); if (HAIRS[q.get('hair')]) state.hair = q.get('hair'); }

function apply() {
  fig.set({ ...DEFAULTS, ...SHAPE });
  fig.skin.userData.set({ tone: LOOK.skin, browAmount: LOOK.brows, lips: LOOK.lips, sockets: LOOK.sockets });
  fig.eyes.set({ colour: LOOK.eyes, glow: LOOK.glow, white: LOOK.white, iris: LOOK.iris });
  const on = Object.fromEntries(Object.entries(PUREBLOOD.options).map(([k, o]) => [k, o.def])); pb.set({ ...on, jewellery: 'gold', on: true });
  fig.update();
  hair.set(state.style, HAIRS[state.hair]);
  stage.changed();
}

/* ---------------- views ---------------- */
const headAt = () => new THREE.Vector3().addVectors(fig.eyes.l.position, fig.eyes.r.position).multiplyScalar(0.5);
const VIEWS = {
  whole: () => [[0, 0.95, 0.05], [1.4, 1.3, 4.2]],
  bust: () => { const h = headAt(); return [[0, h.y - 0.18, h.z - 0.05], [0.35, h.y - 0.05, h.z + 1.25]]; },
  face: () => { const h = headAt(); return [[0, h.y - 0.03, h.z - 0.04], [0.22, h.y, h.z + 0.62]]; },
};
const view = (n) => { const [t, p] = VIEWS[n](); stage.view(t, p); };
for (const b of document.querySelectorAll('[data-view]')) b.addEventListener('click', () => view(b.dataset.view));
stage.controls.addEventListener('start', () => $('hint').classList.add('gone'));

apply(); view('bust'); $('status').hidden = true;
stage.start();
window.__fig = { fig, base, hair, state, stage, camera: stage.camera, controls: stage.controls, redraw: stage.redraw, ready: Promise.resolve(), views: VIEWS };
