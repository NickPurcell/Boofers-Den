// API tests for Find time to hang v2, against an in-memory stand-in for Redis. Run: node --test tests/
// Every person here is invented.
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

/* ---------- a small in-memory Redis with the commands the API uses ---------- */
class FakeRedis {
  constructor() { this.kv = new Map(); this.ttl = new Map(); }
  on() {}
  async get(k) { return this.kv.has(k) ? this.kv.get(k) : null; }
  async set(k, v, ...a) {
    if (a.includes('NX') && this.kv.has(k)) return null;
    this.kv.set(k, String(v));
    const ex = a.indexOf('EX'); if (ex >= 0) this.ttl.set(k, a[ex + 1]);
    return 'OK';
  }
  async del(...ks) { let n = 0; for (const k of ks) if (this.kv.delete(k)) n++; return n; }
  async expire(k, s) { if (this.kv.has(k)) { this.ttl.set(k, s); return 1; } return 0; }
  async incr(k) { const n = (+(this.kv.get(k) || 0)) + 1; this.kv.set(k, String(n)); return n; }
  h(k) { if (!this.kv.has(k)) this.kv.set(k, new Map()); return this.kv.get(k); }
  async hget(k, f) { const h = this.kv.get(k); return h && h.has(f) ? h.get(f) : null; }
  async hset(k, f, v) { this.h(k).set(f, String(v)); return 1; }
  async hdel(k, f) { const h = this.kv.get(k); return h && h.delete(f) ? 1 : 0; }
  async hlen(k) { const h = this.kv.get(k); return h ? h.size : 0; }
  async hexists(k, f) { const h = this.kv.get(k); return h && h.has(f) ? 1 : 0; }
  async hgetall(k) { const h = this.kv.get(k); return h ? Object.fromEntries(h) : {}; }
  l(k) { if (!this.kv.has(k)) this.kv.set(k, []); return this.kv.get(k); }
  async lpush(k, v) { this.l(k).unshift(String(v)); return this.l(k).length; }
  async ltrim(k, a, b) { this.kv.set(k, this.l(k).slice(a, b + 1)); return 'OK'; }
  async lrange(k, a, b) { return (this.kv.get(k) || []).slice(a, b + 1); }
  async lrem(k, n, v) { const l = this.l(k); const i = l.indexOf(v); if (i >= 0) { l.splice(i, 1); return 1; } return 0; }
}
const orig = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) { return req === 'ioredis' ? 'ioredis-stub' : orig.call(this, req, ...rest); };
require.cache['ioredis-stub'] = { id: 'ioredis-stub', filename: 'ioredis-stub', loaded: true, exports: FakeRedis };
process.env.REDIS_URL = 'redis://stub';

const S = require('../api/_hang-store.js');
const handler = require('../api/hangout.js');
let db = new FakeRedis();
S.getClient = () => db;

let ip = 1;
async function call(method, body, query = {}, from) {
  const req = { method, body, query, headers: { 'x-forwarded-for': from || `10.0.0.${ip}`, host: 'den.test' } };
  const res = { code: 0, headers: {}, data: null,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, status(c) { this.code = c; return this; },
    json(d) { this.data = d; return this; }, send(d) { this.data = d; return this; } };
  await handler(req, res);
  return res;
}
const post = (body, from) => call('POST', body, {}, from);
const get = (id, extra = {}) => call('GET', null, Object.assign({ id }, extra));
function fresh() { db = new FakeRedis(); ip++; }

test('create: a readable, unguessable id, the name, and sensible defaults', async () => {
  fresh();
  const r = await post({ action: 'create', name: 'Space Opera RPG: Session Zero!', tz: 'America/Chicago', roster: ['Avery', 'Blake', 'avery', ' ', 'Cam'] });
  assert.equal(r.code, 200);
  assert.match(r.data.id, /^space-opera-rpg-session-zero-[a-z2-9]{6}$/);
  assert.equal(r.data.key.length, 24);
  const g = await get(r.data.id);
  assert.equal(g.code, 200);
  assert.equal(g.data.event.name, 'Space Opera RPG: Session Zero!');
  assert.equal(g.data.event.len, 120);
  assert.equal(g.data.event.tz, 'America/Chicago');
  assert.deepEqual(g.data.event.roster.map((x) => x.name), ['Avery', 'Blake', 'Cam']);
  assert.equal(g.data.event.key, undefined, 'the delete key never leaves the server');
  assert.deepEqual(g.data.people, []);
  assert.equal(db.ttl.get(S.K.ev(r.data.id)), 90 * 24 * 3600);
});

test('create: validation', async () => {
  fresh();
  assert.equal((await post({ action: 'create', name: '   ' })).code, 400);
  assert.equal((await post({ action: 'create', name: 'x', len: 7 })).code, 400);
  assert.equal((await post({ action: 'create', name: 'x', len: 13 * 60 })).code, 400);
  assert.equal((await post({ action: 'create', name: 'x', quorum: -1 })).code, 400);
  assert.equal((await post({ action: 'create', name: 'x', from: '2026-02-30' })).code, 400);
  const odd = await post({ action: 'create', name: '<b>Game</b> night', tz: 'Nowhere/Land' });
  const ev = (await get(odd.data.id)).data.event;
  assert.equal(ev.name, 'bGame/b night');
  assert.equal(ev.tz, 'UTC');
  const emoji = await post({ action: 'create', name: '🎲🎲🎲' });
  assert.match(emoji.data.id, /^hang-[a-z2-9]{6}$/);
  const big = await post({ action: 'create', name: 'x', roster: Array.from({ length: 80 }, (_, i) => 'Person ' + i) });
  assert.equal((await get(big.data.id)).data.event.roster.length, 30);
});

test('create is rate-limited per address', async () => {
  fresh();
  for (let i = 0; i < 12; i++) assert.equal((await post({ action: 'create', name: 'n' + i }, '10.9.9.9')).code, 200);
  assert.equal((await post({ action: 'create', name: 'one too many' }, '10.9.9.9')).code, 429);
  assert.equal((await post({ action: 'create', name: 'someone else' }, '10.9.9.8')).code, 200);
});

const rules = [{ wd: [1, 2, 3, 4, 5], from: '20:30', to: null, lvl: 'yes' }];

test('people save their own rules and days; each is one field', async () => {
  fresh();
  const { id } = (await post({ action: 'create', name: 'Game night' })).data;
  const a = await post({ action: 'me', id, name: 'Avery', tz: 'America/Chicago', rules, days: [{ d1: E_today(3), d2: E_today(6), kind: 'away' }] });
  assert.equal(a.code, 200);
  await post({ action: 'me', id, name: 'Blake', tz: 'America/New_York', rules: [{ wd: [0, 6], lvl: 'maybe' }] });
  const g = (await get(id)).data;
  assert.deepEqual(g.people.map((p) => p.name), ['Avery', 'Blake']);
  assert.deepEqual(g.people[0].rules, [{ wd: [1, 2, 3, 4, 5], from: '20:30', to: null, lvl: 'yes' }]);
  assert.deepEqual(g.people[0].days, [{ d1: E_today(3), d2: E_today(6), kind: 'away' }]);
  assert.deepEqual(g.people[1].rules, [{ wd: [0, 6], from: null, to: null, lvl: 'maybe' }]);
  assert.equal(g.log.length, 2);
  assert.equal(g.log[0].before, undefined, 'what a change replaced stays on the server');
  // saving the same thing again is not a change
  await post({ action: 'me', id, name: 'blake', tz: 'America/New_York', rules: [{ wd: [0, 6], lvl: 'maybe' }] });
  assert.equal((await get(id)).data.log.length, 3, 'a different spelling of the name is a change (the display name)');
  await post({ action: 'me', id, name: 'blake', tz: 'America/New_York', rules: [{ wd: [0, 6], lvl: 'maybe' }] });
  assert.equal((await get(id)).data.log.length, 3);
});

function E_today(n) { const E = require('../hang/engine.js'); return E.addDays(E.localKey(Date.now(), 'UTC'), n); }

test('people: validation and caps', async () => {
  fresh();
  const { id } = (await post({ action: 'create', name: 'Caps' })).data;
  const bad = async (b) => (await post(Object.assign({ action: 'me', id, name: 'Avery', tz: 'UTC', rules: [], days: [] }, b))).code;
  assert.equal(await bad({ name: '' }), 400);
  assert.equal(await bad({ rules: [{ wd: [], from: '20:00' }] }), 400);
  assert.equal(await bad({ rules: [{ wd: [9] }] }), 400);
  assert.equal(await bad({ rules: [{ wd: [1], from: '25:00' }] }), 400);
  assert.equal(await bad({ rules: [{ wd: [1], from: '20:00', to: '20:00' }] }), 400);
  assert.equal(await bad({ rules: Array.from({ length: 13 }, () => ({ wd: [1] })) }), 400);
  assert.equal(await bad({ days: [{ d1: E_today(1), kind: 'party' }] }), 400);
  assert.equal(await bad({ days: [{ d1: E_today(5), d2: E_today(1), kind: 'away' }] }), 400);
  assert.equal(await bad({ days: [{ d1: E_today(1), d2: E_today(300), kind: 'away' }] }), 400);
  assert.equal(await bad({ days: [{ d1: E_today(900), kind: 'away' }] }), 400);
  assert.equal(await bad({ days: Array.from({ length: 81 }, (_, i) => ({ d1: E_today(i), kind: 'away' })) }), 400);
  assert.equal(await bad({ rules: 'lots' }), 400);
  // long-finished stretches are dropped, not refused
  const ok = await post({ action: 'me', id, name: 'Avery', tz: 'UTC', rules: [], days: [{ d1: E_today(-100), kind: 'away' }, { d1: E_today(2), kind: 'away' }] });
  assert.equal(ok.code, 200);
  assert.deepEqual(ok.data.people[0].days, [{ d1: E_today(2), kind: 'away' }]);
  // names are plain text and capped
  const n = await post({ action: 'me', id, name: '  Blake\u0000 <script>  the   great and powerful of the north ', tz: 'UTC', rules: [] });
  assert.equal(n.data.people.find((p) => p.name.startsWith('Blake')).name, 'Blake script the great and pow');
  // forty people at most
  for (let i = 0; i < 38; i++) assert.equal((await post({ action: 'me', id, name: 'P' + i, tz: 'UTC', rules }, '10.1.' + i + '.1')).code, 200);
  assert.equal((await post({ action: 'me', id, name: 'P99', tz: 'UTC', rules }, '10.2.0.1')).code, 409);
  // an oversized body is refused before anything else
  assert.equal((await post({ action: 'me', id, name: 'Avery', tz: 'UTC', rules: [], pad: 'x'.repeat(30000) })).code, 413);
});

test('writes are rate-limited per address', async () => {
  fresh();
  const { id } = (await post({ action: 'create', name: 'Busy' })).data;
  let last;
  for (let i = 0; i < 91; i++) last = await post({ action: 'me', id, name: 'Avery', tz: 'UTC', rules: [{ wd: [i % 7] }] }, '10.7.7.7');
  assert.equal(last.code, 429);
});

test('undo: someone edits the wrong name, and it comes back', async () => {
  fresh();
  const { id } = (await post({ action: 'create', name: 'Undo' })).data;
  await post({ action: 'me', id, name: 'Avery', tz: 'UTC', rules });
  await post({ action: 'me', id, name: 'Blake', tz: 'UTC', rules });
  // Blake taps Avery's name by mistake and replaces Avery's times
  const wrong = await post({ action: 'me', id, name: 'Avery', tz: 'UTC', rules: [{ wd: [6] }] });
  const change = wrong.data.log[0];
  assert.equal(change.name, 'Avery');
  const u = await post({ action: 'undo', id, n: change.n });
  assert.equal(u.code, 200);
  assert.deepEqual(u.data.people.find((p) => p.name === 'Avery').rules, rules.map((r) => ({ ...r })));
  // the first save can be undone too: Avery disappears
  const first = u.data.log.find((x) => x.name === 'Avery');
  const u2 = await post({ action: 'undo', id, n: first.n });
  assert.deepEqual(u2.data.people.map((p) => p.name), ['Blake']);
  // an older change cannot jump the queue
  await post({ action: 'me', id, name: 'Blake', tz: 'UTC', rules: [{ wd: [0] }] });
  const log = (await get(id)).data.log.filter((x) => x.name === 'Blake');
  assert.equal((await post({ action: 'undo', id, n: log[1].n })).code, 409);
  assert.equal((await post({ action: 'undo', id, n: 9999 })).code, 404);
  // removing someone can be undone
  const f = await post({ action: 'forget', id, name: 'Blake' });
  assert.deepEqual(f.data.people, []);
  const back = await post({ action: 'undo', id, n: f.data.log[0].n });
  assert.deepEqual(back.data.people.map((p) => p.name), ['Blake']);
});

test('settings, required people and quorum, with undo', async () => {
  fresh();
  const { id } = (await post({ action: 'create', name: 'Settings', roster: ['Avery', 'Blake'] })).data;
  const s = await post({ action: 'settings', id, set: { name: 'Renamed', len: 180, roster: [{ name: 'Avery', req: true }, 'Blake', 'Cam'], quorum: 2 } });
  assert.equal(s.code, 200);
  assert.equal(s.data.event.name, 'Renamed');
  assert.equal(s.data.event.len, 180);
  assert.deepEqual(s.data.event.roster, [{ name: 'Avery', req: true }, { name: 'Blake', req: false }, { name: 'Cam', req: false }]);
  assert.equal(s.data.event.quorum, 2);
  assert.equal(s.data.event.tz, 'UTC', 'fields not sent stay as they were');
  assert.equal((await post({ action: 'settings', id, set: { name: '' } })).code, 400);
  const u = await post({ action: 'undo', id, n: s.data.log[0].n });
  assert.equal(u.data.event.name, 'Settings');
  assert.equal(u.data.event.quorum, 0);
});

test('lock it in: a calendar file and unlock', async () => {
  fresh();
  const { id } = (await post({ action: 'create', name: 'Space game; one, two', tz: 'America/Chicago' })).data;
  assert.equal((await get(id, { ics: '1' })).code, 404);
  const start = Math.ceil(Date.now() / 3600000) * 3600000 + 2 * 86400000, end = start + 3 * 3600000;
  assert.equal((await post({ action: 'lock', id, start, end: start })).code, 400);
  assert.equal((await post({ action: 'lock', id, start, end: start + 2 * 86400000 })).code, 400);
  assert.equal((await post({ action: 'lock', id, start: start + 1, end })).code, 400);
  const l = await post({ action: 'lock', id, start, end });
  assert.deepEqual([l.data.event.locked.start, l.data.event.locked.end], [start, end]);
  const ics = await get(id, { ics: '1' });
  assert.equal(ics.code, 200);
  assert.match(ics.headers['content-type'], /^text\/calendar/);
  assert.match(ics.data, /SUMMARY:Space game\\; one\\, two/);
  assert.match(ics.data, new RegExp(`URL:https://den.test/hang/${id}`));
  const un = await post({ action: 'unlock', id });
  assert.equal(un.data.event.locked, null);
});

test('delete needs the key the creating device holds', async () => {
  fresh();
  const { id, key } = (await post({ action: 'create', name: 'Gone soon' })).data;
  await post({ action: 'me', id, name: 'Avery', tz: 'UTC', rules });
  assert.equal((await post({ action: 'delete', id, key: 'nope' })).code, 403);
  assert.equal((await post({ action: 'delete', id })).code, 403);
  assert.equal((await post({ action: 'delete', id, key })).code, 200);
  assert.equal((await get(id)).code, 404);
  assert.equal(await db.hlen(S.K.pp(id)), 0);
});

test('bad ids and unknown actions', async () => {
  fresh();
  assert.equal((await get('../../etc')).code, 400);
  assert.equal((await get('UPPER-abcdef')).code, 400);
  assert.equal((await get('missing-abcdef')).code, 404);
  assert.equal((await post({ action: 'me', id: 'missing-abcdef', name: 'A', rules })).code, 404);
  const { id } = (await post({ action: 'create', name: 'x' })).data;
  assert.equal((await post({ action: 'explode', id })).code, 400);
  assert.equal((await call('PUT', {})).code, 405);
  assert.equal((await post('not json')).code, 400);
  assert.equal((await post([1, 2])).code, 400);
});

test('an old calendar opens as a v2 event, painted hours carried over', async () => {
  fresh();
  // created at Pacific midnight on 22 Oct 2026, three weeks of hour slots; one invented person painted 7–10 PM Pacific on the 24th
  const start = Date.UTC(2026, 9, 22, 7);
  await db.set('hang:cal:abc2def', JSON.stringify({ id: 'abc2def', title: 'Hang with Avery', start, slots: 504, created: start }));
  const cells = '.'.repeat(504).split('');
  for (let h = 2 * 24 + 19; h < 2 * 24 + 22; h++) cells[h] = 'g';
  cells[100] = 'n';
  await db.hset('hang:people:abc2def', 'blake', JSON.stringify({ name: 'Blake', cells: cells.join(''), token: 'x', updated: start }));
  const g = await get('abc2def');
  assert.equal(g.code, 200);
  assert.equal(g.data.event.name, 'Hang with Avery');
  assert.equal(g.data.event.tz, 'America/Los_Angeles');
  assert.equal(g.data.event.from, null, 'rolling, so the old link is usable going forward');
  // 7–10 PM PDT on the 24th is 02:00–05:00 UTC on the 25th
  assert.deepEqual(g.data.people, [{ name: 'Blake', tz: 'UTC', rules: [], days: [{ d1: '2026-10-25', kind: 'add', from: '02:00', to: '05:00', lvl: 'yes' }], updated: start }]);
  // the old keys are untouched, and a second open does not migrate twice
  assert.ok(await db.get('hang:cal:abc2def'));
  await post({ action: 'me', id: 'abc2def', name: 'Cam', tz: 'UTC', rules });
  assert.deepEqual((await get('abc2def')).data.people.map((p) => p.name), ['Blake', 'Cam']);
  assert.equal((await get('zzz9zzz')).code, 404);
});

test('slugs', () => {
  const { slug } = handler._test;
  assert.equal(slug('Star Wars RPG Availability'), 'star-wars-rpg-availability');
  assert.equal(slug('Café night — à la carte'), 'cafe-night-a-la-carte');
  assert.equal(slug('A very long event name that goes on and on and on'), 'a-very-long-event-name-that-goes');
  assert.equal(slug('!!!'), 'hang');
});
