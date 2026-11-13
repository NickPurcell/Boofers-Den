// Rule engine tests for Find time to hang v2. Run: node --test tests/
// Every person here is invented.
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../hang/engine.js');

const CHI = 'America/Chicago', NY = 'America/New_York', LA = 'America/Los_Angeles', LON = 'Europe/London', BER = 'Europe/Berlin';
const at = (key, hm, tz) => E.toUtc(key, hm, tz);
const iso = (t) => new Date(t).toISOString().slice(0, 16) + 'Z';
// spans as readable local strings: 'Mon 2026-11-16 20:30–24:00 yes'
function local(spans, tz) {
  return spans.map((s) => {
    const k = E.localKey(s.s, tz), wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][E.weekday(k)];
    const endKey = E.localKey(s.e, tz);
    let end = E.localHM(s.e, tz);
    if (endKey !== k) end = end === '00:00' && E.addDays(k, 1) === endKey ? '24:00' : `${endKey} ${end}`;
    return `${wd} ${k} ${E.localHM(s.s, tz)}–${end} ${s.lvl === 2 ? 'yes' : 'maybe'}`;
  });
}
const week = (tz, from = '2026-11-16', days = 7) => [at(from, '00:00', tz), at(E.addDays(from, days), '00:00', tz)];

test('dates: keys, weekdays, arithmetic', () => {
  assert.equal(E.weekday('2026-11-16'), 1);
  assert.equal(E.addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(E.addDays('2028-03-01', -1), '2028-02-29');
  assert.equal(E.daysBetween('2026-11-01', '2026-12-01'), 30);
  assert.ok(E.isKey('2026-02-28'));
  assert.ok(!E.isKey('2026-02-30'));
  assert.ok(!E.isKey('26-02-01'));
});

test('zones: wall clock to instant, including the hours DST skips and repeats', () => {
  assert.equal(iso(at('2026-11-14', '20:30', CHI)), '2026-11-15T02:30Z');
  assert.equal(iso(at('2026-07-14', '20:30', CHI)), '2026-07-15T01:30Z');
  // 2:30 AM does not exist on 8 Mar 2026 in Chicago: it moves forward to 3:30 CDT
  assert.equal(iso(at('2026-03-08', '02:30', CHI)), '2026-03-08T08:30Z');
  // 1:30 AM happens twice on 1 Nov 2026: take the first (CDT)
  assert.equal(iso(at('2026-11-01', '01:30', CHI)), '2026-11-01T06:30Z');
  assert.equal(iso(at('2026-10-25', '02:30', BER)), '2026-10-25T00:30Z');
  assert.equal(iso(at('2026-11-14', '20:30', 'Asia/Kolkata')), '2026-11-14T15:00Z');
  assert.ok(E.validZone(CHI));
  assert.ok(!E.validZone('Mars/Olympus_Mons'));
  assert.ok(!E.validZone(''));
});

test('weekday rule: Mon–Fri after 8:30 PM', () => {
  const p = { name: 'Avery', tz: CHI, rules: [{ wd: [1, 2, 3, 4, 5], from: '20:30', to: null, lvl: 'yes' }] };
  assert.deepEqual(local(E.personSpans(p, ...week(CHI)), CHI), [
    'Mon 2026-11-16 20:30–24:00 yes', 'Tue 2026-11-17 20:30–24:00 yes', 'Wed 2026-11-18 20:30–24:00 yes',
    'Thu 2026-11-19 20:30–24:00 yes', 'Fri 2026-11-20 20:30–24:00 yes',
  ]);
});

test('every day after 9 PM, and M/W/F between two times', () => {
  const p = { name: 'Blake', tz: CHI, rules: [{ wd: [0, 1, 2, 3, 4, 5, 6], from: '21:00', to: null, lvl: 'yes' }] };
  assert.equal(E.personSpans(p, ...week(CHI)).length, 7);
  const q = { name: 'Cam', tz: CHI, rules: [{ wd: [1, 3, 5], from: '18:00', to: '22:00', lvl: 'yes' }] };
  assert.deepEqual(local(E.personSpans(q, ...week(CHI)), CHI), [
    'Mon 2026-11-16 18:00–22:00 yes', 'Wed 2026-11-18 18:00–22:00 yes', 'Fri 2026-11-20 18:00–22:00 yes',
  ]);
  const r = { name: 'Dana', tz: CHI, rules: [{ wd: [6], from: null, to: '12:00', lvl: 'yes' }] };
  assert.deepEqual(local(E.personSpans(r, ...week(CHI)), CHI), ['Sat 2026-11-21 00:00–12:00 yes']);
});

test('a rule that runs past midnight joins the next day', () => {
  const p = { name: 'Emery', tz: CHI, rules: [
    { wd: [5], from: '21:00', to: '01:00', lvl: 'yes' },
    { wd: [6], from: null, to: null, lvl: 'yes' },
  ] };
  assert.deepEqual(local(E.personSpans(p, ...week(CHI)), CHI), ['Fri 2026-11-20 21:00–2026-11-22 00:00 yes']);
});

test('maybe sits under yes; overlapping rules merge', () => {
  const p = { name: 'Finley', tz: CHI, rules: [
    { wd: [6], from: '12:00', to: null, lvl: 'maybe' },
    { wd: [6], from: '18:00', to: '22:00', lvl: 'yes' },
    { wd: [6], from: '20:00', to: '23:00', lvl: 'yes' },
  ] };
  assert.deepEqual(local(E.personSpans(p, ...week(CHI)), CHI), [
    'Sat 2026-11-21 12:00–18:00 maybe', 'Sat 2026-11-21 18:00–23:00 yes', 'Sat 2026-11-21 23:00–24:00 maybe',
  ]);
});

test('day entries: away for a stretch, only, add, and the later entry wins', () => {
  const base = { name: 'Gray', tz: CHI, rules: [{ wd: [0, 1, 2, 3, 4, 5, 6], from: '21:00', to: '01:00', lvl: 'yes' }] };
  // away 18–20 Nov removes those nights, including Friday's run past midnight; Tuesday's run into Wednesday is cut at midnight
  // (the window starts Monday at midnight, so Sunday night's last hour shows first; it ends Sunday at midnight)
  const away = { ...base, days: [{ d1: '2026-11-18', d2: '2026-11-20', kind: 'away' }] };
  assert.deepEqual(local(E.personSpans(away, ...week(CHI)), CHI), [
    'Mon 2026-11-16 00:00–01:00 yes', 'Mon 2026-11-16 21:00–2026-11-17 01:00 yes', 'Tue 2026-11-17 21:00–24:00 yes',
    'Sat 2026-11-21 21:00–2026-11-22 01:00 yes', 'Sun 2026-11-22 21:00–24:00 yes',
  ]);
  // only on Saturday: 2–5 PM replaces that night's rule, Friday night's run into Saturday stays
  const only = { ...base, days: [{ d1: '2026-11-21', kind: 'only', from: '14:00', to: '17:00', lvl: 'maybe' }] };
  const sat = local(E.personSpans(only, at('2026-11-21', '00:00', CHI), at('2026-11-22', '00:00', CHI)), CHI);
  assert.deepEqual(sat, ['Sat 2026-11-21 00:00–01:00 yes', 'Sat 2026-11-21 14:00–17:00 maybe']);
  // add hours on Sunday afternoon
  const add = { ...base, days: [{ d1: '2026-11-22', kind: 'add', from: '13:00', to: '16:00', lvl: 'yes' }] };
  const sun = local(E.personSpans(add, at('2026-11-22', '00:00', CHI), at('2026-11-23', '00:00', CHI)), CHI);
  assert.deepEqual(sun, ['Sun 2026-11-22 00:00–01:00 yes', 'Sun 2026-11-22 13:00–16:00 yes', 'Sun 2026-11-22 21:00–24:00 yes']);
  // not free, then later "add 2–5 PM" on the same day: the later entry wins
  const both = { ...base, days: [{ d1: '2026-11-22', kind: 'away' }, { d1: '2026-11-22', kind: 'add', from: '14:00', to: '17:00' }] };
  assert.deepEqual(local(E.personSpans(both, at('2026-11-22', '00:00', CHI), at('2026-11-23', '00:00', CHI)), CHI), ['Sun 2026-11-22 14:00–17:00 yes']);
  // and the other way round: add, then away all day removes it
  const rev = { ...base, days: [{ d1: '2026-11-22', kind: 'add', from: '14:00', to: '17:00' }, { d1: '2026-11-22', kind: 'away' }] };
  assert.deepEqual(local(E.personSpans(rev, at('2026-11-22', '00:00', CHI), at('2026-11-23', '00:00', CHI)), CHI), []);
  // busy for some hours only
  const busy = { ...base, days: [{ d1: '2026-11-16', kind: 'away', from: '22:00', to: '23:30' }] };
  assert.deepEqual(local(E.personSpans(busy, at('2026-11-16', '12:00', CHI), at('2026-11-17', '12:00', CHI)), CHI), [
    'Mon 2026-11-16 21:00–22:00 yes', 'Mon 2026-11-16 23:30–2026-11-17 01:00 yes',
  ]);
  // no rules at all, just a day free
  const one = { name: 'Harper', tz: CHI, rules: [], days: [{ d1: '2026-11-21', kind: 'only' }] };
  assert.deepEqual(local(E.personSpans(one, ...week(CHI)), CHI), ['Sat 2026-11-21 00:00–24:00 yes']);
});

test('setting and clearing days splits ranges', () => {
  let d = E.setDays([], '2026-11-20', '2026-11-27', { kind: 'away' });
  assert.deepEqual(d, [{ kind: 'away', d1: '2026-11-20', d2: '2026-11-27' }]);
  d = E.clearDays(d, '2026-11-23');
  assert.deepEqual(d, [{ kind: 'away', d1: '2026-11-20', d2: '2026-11-22' }, { kind: 'away', d1: '2026-11-24', d2: '2026-11-27' }]);
  d = E.setDays(d, '2026-11-27', '2026-11-27', { kind: 'only', from: '19:00', to: '23:00', lvl: 'yes' });
  assert.deepEqual(d, [
    { kind: 'away', d1: '2026-11-20', d2: '2026-11-22' }, { kind: 'away', d1: '2026-11-24', d2: '2026-11-26' },
    { kind: 'only', from: '19:00', to: '23:00', lvl: 'yes', d1: '2026-11-27' },
  ]);
  d = E.clearDays(d, '2026-11-20', '2026-11-20');
  assert.equal(d[0].d1, '2026-11-21');
  assert.equal(E.pruneDays(d, '2026-11-25').length, 2);
});

test('zones: someone in New York is seen at their own 8:30 PM from Los Angeles', () => {
  const p = { name: 'Indy', tz: NY, rules: [{ wd: [3], from: '20:30', to: '23:00', lvl: 'yes' }] };
  assert.deepEqual(local(E.personSpans(p, ...week(LA)), LA), ['Wed 2026-11-18 17:30–20:00 yes']);
});

test('DST never moves a rule: after 8:30 PM stays 8:30 PM on both sides of the change', () => {
  const p = { name: 'Jules', tz: CHI, rules: [{ wd: [0, 1, 2, 3, 4, 5, 6], from: '20:30', to: null, lvl: 'yes' }] };
  // US autumn change, Sunday 1 Nov 2026
  const fall = E.personSpans(p, at('2026-10-30', '00:00', CHI), at('2026-11-04', '00:00', CHI));
  assert.deepEqual(fall.map((s) => E.localHM(s.s, CHI)), ['20:30', '20:30', '20:30', '20:30', '20:30']);
  assert.deepEqual(fall.map((s) => iso(s.s)), ['2026-10-31T01:30Z', '2026-11-01T01:30Z', '2026-11-02T02:30Z', '2026-11-03T02:30Z', '2026-11-04T02:30Z']);
  // US spring change, Sunday 8 Mar 2026
  const spring = E.personSpans(p, at('2026-03-06', '00:00', CHI), at('2026-03-10', '00:00', CHI));
  assert.deepEqual(spring.map((s) => E.localHM(s.s, CHI)), ['20:30', '20:30', '20:30', '20:30']);
  assert.deepEqual(spring.map((s) => iso(s.s)), ['2026-03-07T02:30Z', '2026-03-08T02:30Z', '2026-03-09T01:30Z', '2026-03-10T01:30Z']);
  // the night of the change is an hour longer (fall) / shorter (spring) in real time, not in wall time
  const night = (t0) => E.personSpans({ ...p, rules: [{ wd: [6], from: '22:00', to: '04:00', lvl: 'yes' }] }, t0, t0 + 3 * E.DAY)[0];
  const f = night(at('2026-10-31', '00:00', CHI));
  assert.equal((f.e - f.s) / E.HOUR, 7);
  const s = night(at('2026-03-07', '00:00', CHI));
  assert.equal((s.e - s.s) / E.HOUR, 5);
  // Europe changes a week before the US: a Londoner's 8 PM seen from New York is 3 PM, except 4 PM in the week between
  const lon = { name: 'Kit', tz: LON, rules: [{ wd: [3], from: '20:00', to: '22:00', lvl: 'yes' }] };
  const seen = E.personSpans(lon, at('2026-10-19', '00:00', NY), at('2026-11-09', '00:00', NY)).map((x) => E.localHM(x.s, NY));
  assert.deepEqual(seen, ['15:00', '16:00', '15:00']);
  const seen2 = E.personSpans(lon, at('2026-10-19', '00:00', NY), at('2026-10-20', '00:00', NY));
  assert.equal(seen2.length, 0);
});

// six invented players and a Saturday-night game
function party() {
  const CH = CHI;
  return [
    { name: 'Avery', tz: CH, rules: [{ wd: [5, 6], from: '18:00', to: null, lvl: 'yes' }] },
    { name: 'Blake', tz: CH, rules: [{ wd: [0, 1, 2, 3, 4, 5, 6], from: '19:00', to: null, lvl: 'yes' }] },
    { name: 'Cam', tz: NY, rules: [{ wd: [6], from: '20:00', to: null, lvl: 'yes' }, { wd: [5], from: '20:00', to: null, lvl: 'maybe' }] },
    { name: 'Dana', tz: CH, rules: [{ wd: [5, 6], from: '17:00', to: '23:00', lvl: 'yes' }] },
    { name: 'Emery', tz: LA, rules: [{ wd: [0, 6], from: '12:00', to: '22:00', lvl: 'yes' }] },
    { name: 'Gray', tz: CH, rules: [{ wd: [1, 2, 3, 4], from: '20:00', to: null, lvl: 'yes' }], days: [] },
  ];
}
const opts = (o) => Object.assign({ t0: at('2026-11-16', '00:00', CHI), t1: at('2026-11-30', '00:00', CHI), len: 120, now: at('2026-11-16', '00:00', CHI) }, o);

test('everyone who filled in: nothing fits all six, closest is five', () => {
  const P = party();
  const A = E.analyze(P, opts({}));
  const ds = E.dayStats(A, ['2026-11-20', '2026-11-21', '2026-11-22', '2026-11-23'], CHI);
  // Saturday 21 Nov: Avery 18–24, Blake 19–24, Cam 19–23 CHI (20–24 NY), Dana 17–23, Emery 14–24 CHI (12–22 LA)
  assert.deepEqual(ds['2026-11-21'], { best: 5, all: false, ok: false, open: true, of: 6 });
  // Friday: Avery, Blake, Dana, Cam maybe = 4
  assert.equal(ds['2026-11-20'].best, 4);
  const B = E.bestTimes(A, { tz: CHI });
  assert.equal(B.fallback, true);
  const top = B.windows[0];
  assert.deepEqual(top.who, ['Avery', 'Blake', 'Cam', 'Dana', 'Emery']);
  assert.equal(E.localKey(top.start, CHI), '2026-11-21');
  // all five from 7 PM (Cam's 8 PM New York) until 11 PM (Dana), so a 2-hour game starts 7–9 PM
  assert.equal(E.localHM(top.start, CHI), '19:00');
  assert.equal(E.localHM(top.lastStart, CHI), '21:00');
  assert.equal(E.localHM(top.end, CHI), '23:00');
});

test('everyone except Gray: Saturday works for all who are counted', () => {
  const P = party();
  const A = E.analyze(P, opts({ count: ['Avery', 'Blake', 'Cam', 'Dana', 'Emery'] }));
  const ds = E.dayStats(A, ['2026-11-21', '2026-11-28'], CHI);
  assert.equal(ds['2026-11-21'].all, true);
  assert.equal(ds['2026-11-21'].ok, true);
  assert.equal(ds['2026-11-21'].of, 5);
  const B = E.bestTimes(A, { tz: CHI });
  assert.equal(B.fallback, false);
  assert.deepEqual(B.windows.map((w) => E.localKey(w.start, CHI)), ['2026-11-21', '2026-11-28']);
});

test('required people and a quorum', () => {
  const P = party();
  // Dana runs the game and must be there; four is enough
  const A = E.analyze(P, opts({ required: ['Dana'], quorum: 4 }));
  const ds = E.dayStats(A, ['2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22'], CHI);
  assert.equal(ds['2026-11-19'].ok, false); // a weeknight: Blake and Gray only
  assert.equal(ds['2026-11-20'].ok, true);  // Friday: Avery, Blake, Cam (maybe), Dana
  assert.equal(ds['2026-11-21'].ok, true);
  assert.equal(ds['2026-11-22'].ok, false); // Sunday: Dana is not free
  const B = E.bestTimes(A, { tz: CHI, limit: 10 });
  assert.equal(B.fallback, false);
  // Saturday's five beat Friday's four; every window includes Dana
  assert.ok(B.windows.every((w) => w.who.includes('Dana')));
  assert.equal(B.windows[0].who.length, 5);
  const fri = B.windows.find((w) => E.localKey(w.start, CHI) === '2026-11-20');
  assert.deepEqual(fri.maybe, ['Cam']);
  // if the GM has not answered, nothing can be said to work
  const A2 = E.analyze(P.filter((p) => p.name !== 'Dana'), opts({ required: ['Dana'], quorum: 4 }));
  assert.deepEqual(A2.missing, ['Dana']);
  assert.equal(E.dayStats(A2, ['2026-11-21'], CHI)['2026-11-21'].ok, false);
  // leaving the GM out with the filter drops the requirement only if they answered; quorum still applies
  const A3 = E.analyze(P, opts({ required: ['Dana'], quorum: 4, count: ['Avery', 'Blake', 'Cam', 'Emery', 'Gray'] }));
  assert.equal(E.dayStats(A3, ['2026-11-21'], CHI)['2026-11-21'].ok, true);
});

test('session length: a three-hour game needs three free hours', () => {
  const P = party().slice(0, 4); // Avery, Blake, Cam, Dana
  const two = E.analyze(P, opts({ len: 120 }));
  const four = E.analyze(P, opts({ len: 240 }));
  // Saturday: all four free 7–11 PM (Cam from 7 PM Chicago), exactly four hours
  assert.equal(E.dayStats(two, ['2026-11-21'], CHI)['2026-11-21'].all, true);
  assert.equal(E.dayStats(four, ['2026-11-21'], CHI)['2026-11-21'].all, true);
  const five = E.analyze(P, opts({ len: 300 }));
  assert.equal(E.dayStats(five, ['2026-11-21'], CHI)['2026-11-21'].all, false);
  const w = E.bestTimes(four, { tz: CHI }).windows[0];
  assert.equal(E.localHM(w.start, CHI), '19:00');
  assert.equal(w.start, w.lastStart);
});

test('ranking: more people first, then sure over maybe, then sooner; two per day at most', () => {
  const P = [
    { name: 'Avery', tz: CHI, rules: [{ wd: [5, 6], from: '18:00', to: null, lvl: 'yes' }] },
    { name: 'Blake', tz: CHI, rules: [{ wd: [5], from: '18:00', to: null, lvl: 'maybe' }, { wd: [6], from: '18:00', to: null, lvl: 'yes' }] },
  ];
  const B = E.bestTimes(E.analyze(P, opts({})), { tz: CHI, limit: 4 });
  // Saturdays (both sure) before Fridays (Blake maybe), sooner first within each
  assert.deepEqual(B.windows.map((w) => E.localKey(w.start, CHI)), ['2026-11-21', '2026-11-28', '2026-11-20', '2026-11-27']);
  assert.deepEqual(B.windows[2].maybe, ['Blake']);
  // past starts are ignored
  const later = E.bestTimes(E.analyze(P, opts({ now: at('2026-11-22', '00:00', CHI) })), { tz: CHI, limit: 4 });
  assert.deepEqual(later.windows.map((w) => E.localKey(w.start, CHI)), ['2026-11-28', '2026-11-27']);
  // three windows on one day are capped at two
  const busy = [{ name: 'Cam', tz: CHI, rules: [{ wd: [6], from: '08:00', to: '10:00' }, { wd: [6], from: '12:00', to: '14:00' }, { wd: [6], from: '16:00', to: '18:00' }] }];
  const C = E.bestTimes(E.analyze(busy, opts({ t1: at('2026-11-22', '00:00', CHI) })), { tz: CHI });
  assert.equal(C.windows.length, 2);
});

test('words: rules and day entries read back as sentences', () => {
  assert.equal(E.ruleText({ wd: [1, 2, 3, 4, 5], from: '20:30', to: null }), 'Mon–Fri after 8:30 PM');
  assert.equal(E.ruleText({ wd: [0, 1, 2, 3, 4, 5, 6], from: '21:00', to: null }), 'Every day after 9 PM');
  assert.equal(E.ruleText({ wd: [1, 3, 5], from: '18:00', to: '22:00' }), 'Mon, Wed, Fri 6–10 PM');
  assert.equal(E.ruleText({ wd: [6, 0], from: null, to: null, lvl: 'maybe' }), 'Sat, Sun all day (maybe)');
  assert.equal(E.ruleText({ wd: [5], from: '21:00', to: '01:00' }), 'Fri 9 PM–1 AM');
  assert.equal(E.ruleText({ wd: [2, 4], from: null, to: '12:00' }), 'Tue, Thu before noon');
  assert.equal(E.ruleText({ wd: [1, 2, 3, 5, 6], from: '10:00', to: '14:00' }), 'Mon–Wed, Fri, Sat 10 AM–2 PM');
  assert.equal(E.dayText({ d1: '2026-11-20', d2: '2026-11-27', kind: 'away' }), 'Away Nov 20–27');
  assert.equal(E.dayText({ d1: '2026-11-28', d2: '2026-12-03', kind: 'away' }), 'Away Nov 28–Dec 3');
  assert.equal(E.dayText({ d1: '2026-11-21', kind: 'away' }), 'Not free Sat, Nov 21');
  assert.equal(E.dayText({ d1: '2026-11-21', kind: 'only', from: '14:00', to: '17:00', lvl: 'maybe' }), 'Only 2–5 PM, Sat, Nov 21 (maybe)');
  assert.equal(E.dayText({ d1: '2026-11-21', kind: 'only' }), 'Free all day Sat, Nov 21');
  assert.equal(E.dayText({ d1: '2026-11-21', kind: 'add', from: '13:00', to: '16:00' }), 'Also 1–4 PM, Sat, Nov 21');
  assert.equal(E.spanText(at('2026-11-21', '19:00', CHI), at('2026-11-21', '23:00', CHI), CHI), '7–11 PM');
  assert.equal(E.spanText(at('2026-11-21', '21:00', CHI), at('2026-11-22', '01:00', CHI), CHI), '9 PM–1 AM');
  assert.equal(E.zoneName(CHI), 'Central Time');
});

test('calendar invite and Google link', () => {
  const start = at('2026-11-21', '19:00', CHI), end = at('2026-11-21', '23:00', CHI);
  const ics = E.ics({ uid: 'x@den', name: 'Space game; session 1, the start', start, end, url: 'https://example.test/hang/space-game-abc123', now: Date.UTC(2026, 10, 13) });
  assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
  assert.match(ics, /DTSTART:20261122T010000Z\r\n/);
  assert.match(ics, /DTEND:20261122T050000Z\r\n/);
  assert.match(ics, /SUMMARY:Space game\\; session 1\\, the start\r\n/);
  assert.ok(ics.split('\r\n').every((l) => Buffer.byteLength(l) <= 75));
  const g = new URL(E.googleLink({ name: 'Space game', start, end }));
  assert.equal(g.hostname, 'calendar.google.com');
  assert.equal(g.searchParams.get('dates'), '20261122T010000Z/20261122T050000Z');
});

test('a bad zone falls back to UTC instead of throwing', () => {
  const p = { name: 'Lee', tz: 'Not/AZone', rules: [{ wd: [1], from: '10:00', to: '11:00' }] };
  const s = E.personSpans(p, Date.UTC(2026, 10, 16), Date.UTC(2026, 10, 17));
  assert.equal(iso(s[0].s), '2026-11-16T10:00Z');
});
