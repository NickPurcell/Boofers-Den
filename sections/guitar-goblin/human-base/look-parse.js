/* Human base: reading a look someone else wrote. A look is the character creator's share link (or just the part after
   its '#'): species=pureblood&people=powerful&skin=crimson&...&c.jaw=0.30. On the table it comes from data other
   people wrote, so it is read as untrusted text:

   - only the keys and values in the whitelist (look-schema.js, generated from the creator's own lists) are kept;
     everything else is dropped, and an unknown value takes that species' default;
   - numbers are read strictly, clamped to their range and rounded to 0.01;
   - nothing from the text is ever used as an object key, run as code or put into markup: keys and values are looked
     up in the whitelist by own property, and what comes out is built only from the whitelist's own strings and from
     numbers;
   - too long, not text, or an unknown species: the default look of the default species. It never throws.

   A look says which kind of figure it is: kind=jawa for a Jawa (its own creator, its own keys); no kind, as in every look
   made before there were kinds, is a person on the human base (kind 'humanoid').

   parseLook(text) -> { kind, species, values, controls, look, changed, fallback }
     values    the choices, every key the species has (its default where the text had none or a bad one)
     controls  the body and face controls, every one, clamped (the person's own where the text had none)
     look      the same look written out canonically (fixed order, only the controls that differ from the person), so
               two links for the same figure give the same string: the key to cache a figure by
     changed   how many keys were dropped or values replaced; 0 for a clean link
     fallback  true when nothing of the text could be used (not text, too long, no known species): the default look

   Works as a CommonJS module (the server: require), and as a plain script or module in a page (window.HBLook, after
   look-schema.js). */
(function (root, make) {
  if (typeof module === 'object' && module.exports) module.exports = Object.assign(make(require('./look-schema.js')), { make });
  else root.HBLook = Object.assign(make(root.HBLookSchema), { make });
})(typeof globalThis !== 'undefined' ? globalThis : this, function make(SCHEMA) {
  'use strict';
  const own = (o, k) => o !== null && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k);
  const MAX = SCHEMA.maxLength || 2048;
  const KEY = /^[a-z][A-Za-z0-9.]{0,31}$/, VALUE = /^[A-Za-z0-9._\-]{0,200}$/, NUM = /^-?\d{1,4}(\.\d{1,8})?$/;
  const round = (x) => Math.round(x * 100) / 100;

  // the text as a list of [key, value] pairs, kept in a Map (last one wins, as the creator reads its own links)
  function pairs(text) {
    const out = new Map();
    let s = text, at = s.indexOf('#');
    if (at >= 0) s = s.slice(at + 1);
    for (const part of s.split('&')) {
      if (!part) continue;
      const eq = part.indexOf('='), rawK = eq < 0 ? part : part.slice(0, eq), rawV = eq < 0 ? '' : part.slice(eq + 1);
      let k, v;
      try { k = decodeURIComponent(rawK.replace(/\+/g, ' ')); v = decodeURIComponent(rawV.replace(/\+/g, ' ')); } catch (e) { out.set('\u0000bad' + out.size, ''); continue; }
      if (!KEY.test(k) || !VALUE.test(v)) { out.set('\u0000bad' + out.size, ''); continue; }
      out.set(k, v);
    }
    return out;
  }
  const num = (v, lo, hi) => { if (typeof v !== 'string' || !NUM.test(v)) return null; const x = Number(v); return Number.isFinite(x) ? round(Math.min(hi, Math.max(lo, x))) : null; };

  // one choice, against its whitelist entry; returns [value, ok]
  function choose(def, v) {
    if (v === undefined) return [def.def, true];
    if (def.range) { const x = num(v, def.range[0], def.range[1]); return x === null ? [def.def, false] : [def.int ? Math.round(x) : x, !def.int || x === Math.round(x)]; }
    if (def.multi) {
      const want = new Set(v.split('.').filter(Boolean)), keep = def.items.filter((k) => want.has(k));
      return [keep.join('.'), keep.length === want.size];
    }
    return def.items.indexOf(v) >= 0 ? [v, true] : [def.def, false];
  }

  function defaults(sp) {
    const S = SCHEMA.species[sp], values = {};
    for (const k of S.order) values[k] = S.keys[k].def;
    return values;
  }
  function personControls(person) {
    const c = {}, P = own(SCHEMA.people, person) ? SCHEMA.people[person] : {};
    for (const k of SCHEMA.controlOrder) c[k] = own(P, k) ? P[k] : SCHEMA.controls[k].def;
    return c;
  }
  function write(sp, values, controls) {
    const S = SCHEMA.species[sp], base = personControls(values.people), q = ['species=' + sp];
    for (const k of S.order) q.push(k + '=' + encodeURIComponent(String(values[k])));
    for (const k of SCHEMA.controlOrder) if (Math.abs(controls[k] - base[k]) > 0.004) q.push('c.' + k + '=' + controls[k].toFixed(2));
    return q.join('&');
  }
  function fallback(changed) {
    const sp = SCHEMA.speciesOrder[0], values = defaults(sp), controls = personControls(values.people);
    return { kind: 'humanoid', species: sp, values, controls, look: write(sp, values, controls), changed, fallback: true };
  }
  // another kind of figure (a Jawa): only that kind's keys, from its own whitelist, written back in its own order
  function parseKind(kind, p) {
    const K = SCHEMA.kinds[kind], values = {}, used = new Set(['kind']);
    let changed = 0;
    for (const k of K.order) { const [v, ok] = choose(K.keys[k], p.get(k)); values[k] = v; used.add(k); if (!ok) changed++; }
    for (const k of p.keys()) if (!used.has(k)) changed++;
    const look = ['kind=' + kind, ...K.order.map((k) => k + '=' + encodeURIComponent(String(values[k])))].join('&');
    return { kind, species: null, values, controls: null, look, changed, fallback: false };
  }

  function parseLook(text) {
    if (typeof text !== 'string' || text.length > MAX) return fallback(1);
    let p;
    try { p = pairs(text); } catch (e) { return fallback(1); }
    // which kind of figure: none (every look made before kinds) or 'humanoid' is a person on the human base; another
    // kind is read against its own list only, so no kind's keys can reach another's figure
    const kind = p.get('kind');
    if (kind !== undefined && kind !== 'humanoid') return Object.prototype.hasOwnProperty.call(SCHEMA.kinds || {}, kind) ? parseKind(kind, p) : fallback(1);
    const sp = p.get('species');
    if (sp === undefined || SCHEMA.speciesOrder.indexOf(sp) < 0) return fallback(1);
    const S = SCHEMA.species[sp], values = {}, used = new Set(['species', 'kind']);
    let changed = 0;
    for (const k of S.order) { const [v, ok] = choose(S.keys[k], p.get(k)); values[k] = v; used.add(k); if (!ok) changed++; }
    const controls = personControls(values.people);
    for (const k of SCHEMA.controlOrder) {
      const raw = p.get('c.' + k); used.add('c.' + k);
      if (raw === undefined) continue;
      const C = SCHEMA.controls[k], x = num(raw, C.min, C.max);
      if (x === null) { changed++; continue; }
      if (x !== Number(raw)) changed++;
      controls[k] = x;
    }
    for (const k of p.keys()) if (!used.has(k)) changed++;
    return { kind: 'humanoid', species: sp, values, controls, look: write(sp, values, controls), changed, fallback: false };
  }

  return { parseLook, SCHEMA, MAX };
});
