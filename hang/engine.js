/* Find time to hang, version two: the rule engine.
   Shared by the page (window.HangEngine) and the tests (require). No DOM, no network.

   A person is { name, tz, rules, days }.
   - tz: an IANA zone. Every rule and day entry is wall-clock time in this zone, worked out
     date by date, so a daylight-saving change never moves "after 8:30 PM".
   - rules: [{ wd: [0..6] (0 = Sunday), from: 'HH:MM' | null, to: 'HH:MM' | null, lvl: 'yes' | 'maybe' }]
     from null = from midnight; to null = until midnight; to <= from = runs past midnight.
   - days: [{ d1: 'YYYY-MM-DD', d2: 'YYYY-MM-DD' (inclusive, optional), kind: 'away' | 'only' | 'add',
              from, to (optional hours, same rules as above), lvl }]
     Applied after the rules, in list order, so a later entry wins over an earlier one:
       away  – not free (the whole day, including that night's run past midnight, or just those hours)
       only  – that day's own times are replaced by these hours
       add   – these hours are added
   Time a person has not marked is time they are not free. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HangEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const MIN = 60000, HOUR = 60 * MIN, DAY = 24 * HOUR, STEP = 15 * MIN;
  const YES = 2, MAYBE = 1;

  /* ---------- calendar dates as 'YYYY-MM-DD' (pure arithmetic, no zones) ---------- */
  const pad = (n) => String(n).padStart(2, '0');
  const KEY_RE = /^\d{4}-\d{2}-\d{2}$/;
  const HM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
  function keyOf(y, m, d) {
    const x = new Date(Date.UTC(y, m - 1, d));
    return `${x.getUTCFullYear()}-${pad(x.getUTCMonth() + 1)}-${pad(x.getUTCDate())}`;
  }
  function parseKey(k) { const [y, m, d] = k.split('-').map(Number); return { y, m, d }; }
  function isKey(k) { if (typeof k !== 'string' || !KEY_RE.test(k)) return false; const { y, m, d } = parseKey(k); return keyOf(y, m, d) === k; }
  function addDays(k, n) { const { y, m, d } = parseKey(k); return keyOf(y, m, d + n); }
  function weekday(k) { const { y, m, d } = parseKey(k); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); }
  function daysBetween(a, b) { const A = parseKey(a), B = parseKey(b); return Math.round((Date.UTC(B.y, B.m - 1, B.d) - Date.UTC(A.y, A.m - 1, A.d)) / DAY); }
  function keyUtc(k) { const { y, m, d } = parseKey(k); return Date.UTC(y, m - 1, d); }

  /* ---------- time zones ---------- */
  const fmts = new Map();
  function fmt(tz) {
    let f = fmts.get(tz);
    if (!f) {
      f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' });
      fmts.set(tz, f);
    }
    return f;
  }
  function validZone(tz) {
    if (typeof tz !== 'string' || !tz || tz.length > 64) return false;
    try { fmt(tz); return true; } catch { return false; }
  }
  function parts(t, tz) {
    const o = {};
    for (const p of fmt(tz).formatToParts(new Date(t))) o[p.type] = p.value;
    return { y: +o.year, m: +o.month, d: +o.day, hh: +o.hour % 24, mm: +o.minute, ss: +o.second };
  }
  // the zone's offset from UTC in minutes at instant t, cached per quarter hour (every real
  // transition falls on a quarter-hour boundary)
  const offs = new Map();
  function offset(t, tz) {
    const b = Math.floor(t / STEP), ck = tz + '|' + b;
    let o = offs.get(ck);
    if (o === undefined) {
      const p = parts(b * STEP, tz);
      o = Math.round((Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm, p.ss) - b * STEP) / MIN);
      if (offs.size > 50000) offs.clear();
      offs.set(ck, o);
    }
    return o;
  }
  // wall-clock time on a date in a zone -> instant. A time that does not exist (the hour skipped in
  // spring) moves forward, like a clock would; a time that happens twice (autumn) takes the first.
  function toUtc(key, hm, tz) {
    const { y, m, d } = parseKey(key);
    const [hh, mm] = hm.split(':').map(Number);
    const guess = Date.UTC(y, m - 1, d, hh, mm);
    // the offsets a day either side cover both sides of any transition
    const cands = [guess - offset(guess - DAY, tz) * MIN, guess - offset(guess + DAY, tz) * MIN];
    const good = cands.filter((t) => guess - offset(t, tz) * MIN === t);
    return good.length ? Math.min(...good) : Math.max(...cands);
  }
  function localKey(t, tz) { const p = parts(t, tz); return `${p.y}-${pad(p.m)}-${pad(p.d)}`; }
  function localHM(t, tz) { const p = parts(t, tz); return `${pad(p.hh)}:${pad(p.mm)}`; }
  function dayStart(key, tz) { return toUtc(key, '00:00', tz); }

  /* ---------- one person's free time ---------- */
  // [start, end) of a run of hours on a date, or null if empty. No hours = the whole day.
  function hoursOn(key, from, to, tz) {
    const s = toUtc(key, from || '00:00', tz);
    let e;
    if (to == null) e = toUtc(addDays(key, 1), '00:00', tz);
    else if (from != null && to <= from) e = toUtc(addDays(key, 1), to, tz);
    else e = toUtc(key, to, tz);
    return e > s ? [s, e] : null;
  }
  const lvlOf = (l) => (l === 'maybe' ? MAYBE : YES);

  function cut(items, a, b, seq) {
    const out = [];
    for (const it of items) {
      if (it.seq >= seq || it.e <= a || it.s >= b) { out.push(it); continue; }
      if (it.s < a) out.push({ ...it, e: a });
      if (it.e > b) out.push({ ...it, s: b });
    }
    return out;
  }
  function union(list) {
    const xs = list.slice().sort((p, q) => p[0] - q[0]), out = [];
    for (const [s, e] of xs) {
      const last = out[out.length - 1];
      if (last && s <= last[1]) { if (e > last[1]) last[1] = e; } else out.push([s, e]);
    }
    return out;
  }
  function minus(a, b) {
    const out = [];
    for (let [s, e] of a) {
      for (const [bs, be] of b) {
        if (be <= s || bs >= e) continue;
        if (bs > s) out.push([s, bs]);
        s = Math.max(s, be);
        if (s >= e) break;
      }
      if (s < e) out.push([s, e]);
    }
    return out;
  }

  // free spans for a person between instants t0 and t1: [{ s, e, lvl }] sorted, yes winning over maybe
  function personSpans(person, t0, t1) {
    const tz = validZone(person && person.tz) ? person.tz : 'UTC';
    const k0 = addDays(localKey(t0, tz), -1), k1 = addDays(localKey(t1, tz), 1);
    let items = [];
    for (let k = k0; k <= k1; k = addDays(k, 1)) {
      const wd = weekday(k);
      for (const r of person.rules || []) {
        if (!r || !Array.isArray(r.wd) || !r.wd.includes(wd)) continue;
        const iv = hoursOn(k, r.from, r.to, tz);
        if (iv) items.push({ s: iv[0], e: iv[1], lvl: lvlOf(r.lvl), day: k, seq: -1 });
      }
    }
    (person.days || []).forEach((x, seq) => {
      if (!x || !isKey(x.d1)) return;
      let a = x.d1, b = isKey(x.d2) && x.d2 >= x.d1 ? x.d2 : x.d1;
      if (b < k0 || a > k1) return;
      if (a < k0) a = k0;
      if (b > k1) b = k1;
      for (let k = a; k <= b; k = addDays(k, 1)) {
        const whole = x.from == null && x.to == null;
        const iv = hoursOn(k, x.from, x.to, tz);
        if (x.kind === 'away') {
          if (whole) items = items.filter((it) => !(it.day === k && it.seq < seq));
          if (iv) items = cut(items, iv[0], iv[1], seq);
        } else if (x.kind === 'only') {
          items = items.filter((it) => !(it.day === k && it.seq < seq));
          if (iv) items.push({ s: iv[0], e: iv[1], lvl: lvlOf(x.lvl), day: k, seq });
        } else if (x.kind === 'add') {
          if (iv) items.push({ s: iv[0], e: iv[1], lvl: lvlOf(x.lvl), day: k, seq });
        }
      }
    });
    const clip = (it) => [Math.max(t0, it.s), Math.min(t1, it.e)];
    const yes = union(items.filter((it) => it.lvl === YES && it.e > t0 && it.s < t1).map(clip));
    const maybe = minus(union(items.filter((it) => it.lvl === MAYBE && it.e > t0 && it.s < t1).map(clip)), yes);
    return yes.map(([s, e]) => ({ s, e, lvl: YES })).concat(maybe.map(([s, e]) => ({ s, e, lvl: MAYBE }))).sort((p, q) => p.s - q.s);
  }

  // has this person said anything at all?
  const answered = (p) => !!p && ((p.rules && p.rules.length > 0) || (p.days && p.days.length > 0));

  /* ---------- editing day entries ---------- */
  // remove every entry's effect on the dates a..b (inclusive), splitting ranges that straddle them
  function clearDays(days, a, b = a) {
    const out = [];
    for (const x of days || []) {
      const x2 = x.d2 && x.d2 >= x.d1 ? x.d2 : x.d1;
      if (x2 < a || x.d1 > b) { out.push(x); continue; }
      if (x.d1 < a) out.push({ ...x, d2: addDays(a, -1) });
      if (x2 > b) out.push({ ...x, d1: addDays(b, 1), d2: x2 });
    }
    return out.map((x) => (x.d2 === x.d1 ? (({ d2, ...rest }) => rest)(x) : x));
  }
  // set the dates a..b to one state, replacing whatever was there
  function setDays(days, a, b, entry) {
    const out = clearDays(days, a, b);
    if (entry) { const e = { ...entry, d1: a }; if (b > a) e.d2 = b; else delete e.d2; out.push(e); }
    return out;
  }
  // entries that end before `key` are history; drop them so a person's list stays short
  function pruneDays(days, key) { return (days || []).filter((x) => (x.d2 || x.d1) >= key); }

  /* ---------- everyone together ---------- */
  // How a start time counts. For each counted person, a session starting then is
  //   sure   – free for the whole session, all of it marked yes
  //   maybe  – free for the whole session, some of it marked maybe
  //   no     – not free for all of it.
  // A start WORKS when the event's rule is met by sure answers alone: every required person sure,
  // and at least `quorum` sure (quorum 0 = everyone counted). It works IF THE MAYBES COME when the
  // rule is met only by counting maybes as yes. Nothing else is highlighted.
  //
  // people: [{ name, tz, rules, days }] (only those who answered); opts:
  //   t0, t1   instants bounding the search; len: session minutes
  //   count    names counted (who filled in, minus anyone the filter leaves out)
  //   required names that must be there; quorum: at least this many (0 = all counted)
  //   now      starts before this are ignored
  function analyze(people, opts) {
    const t0 = Math.floor(opts.t0 / STEP) * STEP;
    const n = Math.max(0, Math.floor((opts.t1 - t0) / STEP));
    const k = Math.max(1, Math.round((opts.len || 120) / 15));
    const names = people.map((p) => p.name);
    const low = (s) => String(s).toLowerCase();
    const countSet = new Set((opts.count || names).map(low));
    const counted = people.map((p, i) => (countSet.has(low(p.name)) ? i : -1)).filter((i) => i >= 0);
    const reqSet = new Set((opts.required || []).map(low));
    const required = counted.filter((i) => reqSet.has(low(names[i])));
    // someone who must be there and has not answered yet: nothing can be said to work
    const known = new Set(names.map(low));
    const missing = (opts.required || []).filter((r) => !known.has(low(r)));
    const quorum = opts.quorum > 0 ? opts.quorum : counted.length;
    const spans = people.map((p) => personSpans(p, t0, t0 + n * STEP));
    // prefix sums of free and yes quarter-hours, so "free for the whole session from tick i" is O(1)
    const F = [], Y = [];
    for (const sp of spans) {
      const lv = new Uint8Array(n);
      for (const s of sp) {
        let i = Math.max(0, Math.ceil((s.s - t0) / STEP));
        const j = Math.min(n, Math.floor((s.e - t0) / STEP));
        for (; i < j; i++) if (s.lvl > lv[i]) lv[i] = s.lvl;
      }
      const f = new Int32Array(n + 1), y = new Int32Array(n + 1);
      for (let i = 0; i < n; i++) { f[i + 1] = f[i] + (lv[i] > 0); y[i + 1] = y[i] + (lv[i] === YES); }
      F.push(f); Y.push(y);
    }
    const last = n - k; // last possible start tick
    const first = Math.max(0, Math.ceil(((opts.now == null ? -Infinity : opts.now) - t0) / STEP));
    function status(p, i) {
      if (i < 0 || i > last) return 0;
      if (F[p][i + k] - F[p][i] !== k) return 0;
      return Y[p][i + k] - Y[p][i] === k ? YES : MAYBE;
    }
    const size = Math.max(0, last + 1);
    const sure = new Int16Array(size), maybe = new Int16Array(size), tier = new Uint8Array(size); // tier 2 works, 1 if the maybes come
    const can = counted.length > 0 && !missing.length;
    for (let i = first; i <= last; i++) {
      let c = 0, m = 0;
      for (const p of counted) { const s = status(p, i); if (s === YES) c++; else if (s === MAYBE) m++; }
      sure[i] = c; maybe[i] = m;
      if (!can) continue;
      if (c >= quorum && required.every((p) => status(p, i) === YES)) tier[i] = 2;
      else if (c + m >= quorum && required.every((p) => status(p, i) > 0)) tier[i] = 1;
    }
    return { t0, n, k, len: k * 15, step: STEP, first, last, people, names, spans, counted, required, missing, quorum, status, sure, maybe, tier };
  }

  // per local date in zone tz: whether a session can start that day that works (2) or works if
  // the maybes come (1), and the sure and maybe counts at that day's best start
  function dayStats(A, keys, tz) {
    const out = {};
    for (const key of keys) {
      const a = Math.max(A.first, Math.ceil((dayStart(key, tz) - A.t0) / STEP));
      const b = Math.min(A.last, Math.ceil((dayStart(addDays(key, 1), tz) - A.t0) / STEP) - 1);
      let best = -1, open = false;
      const better = (i, j) => A.tier[i] - A.tier[j] || (A.sure[i] + A.maybe[i]) - (A.sure[j] + A.maybe[j]) || A.sure[i] - A.sure[j];
      for (let i = a; i <= b; i++) { open = true; if (best < 0 || better(i, best) > 0) best = i; }
      out[key] = best < 0 ? { tier: 0, sure: 0, maybe: 0, of: A.counted.length, open }
        : { tier: A.tier[best], sure: A.sure[best], maybe: A.maybe[best], of: A.counted.length, open, at: A.t0 + best * STEP };
    }
    return out;
  }

  // ranked windows: a set of people and a run of start times where all of them are free for a
  // whole session. Ranked: works before works-if-the-maybes-come, then more people, then fewer
  // maybes, then sooner. With nothing that works, the closest: the most people free at once.
  function bestTimes(A, opts = {}) {
    const limit = opts.limit || 6, perDay = opts.perDay || 2, tz = opts.tz || 'UTC';
    const lo = Math.max(0, A.first);
    let pick = (i) => A.tier[i] > 0, fallback = false, any = false;
    for (let i = lo; i <= A.last; i++) if (A.tier[i]) { any = true; break; }
    if (!any) {
      let max = 0;
      for (let i = lo; i <= A.last; i++) max = Math.max(max, A.sure[i] + A.maybe[i]);
      if (!max) return { windows: [], fallback: true };
      fallback = true;
      pick = (i) => A.sure[i] + A.maybe[i] === max;
    }
    const freeAt = (i) => A.counted.filter((p) => A.status(p, i) > 0);
    const sets = new Map();
    for (let i = lo; i <= A.last; i++) {
      if (!pick(i)) continue;
      const mem = freeAt(i), key = mem.join(',');
      if (!sets.has(key)) sets.set(key, mem);
      if (sets.size > 400) break;
    }
    const wins = [];
    for (const [key, mem] of sets) {
      let a = -1, exact = false;
      for (let i = lo; i <= A.last + 1; i++) {
        const inSet = i <= A.last && mem.every((p) => A.status(p, i) > 0);
        if (inSet) {
          if (a < 0) { a = i; exact = false; }
          if (!exact && pick(i) && freeAt(i).join(',') === key) exact = true;
          continue;
        }
        if (a < 0) continue;
        if (exact) {
          // the best start in the run: the best tier, then the fewest maybes among these people, then the earliest
          let bi = -1, bm = Infinity;
          for (let j = a; j < i; j++) {
            const m = mem.reduce((c, p) => c + (A.status(p, j) === MAYBE), 0);
            if (bi < 0 || A.tier[j] > A.tier[bi] || (A.tier[j] === A.tier[bi] && m < bm)) { bi = j; bm = m; }
          }
          wins.push({
            who: mem.map((p) => A.names[p]),
            maybe: mem.filter((p) => A.status(p, bi) === MAYBE).map((p) => A.names[p]),
            tier: A.tier[bi],
            start: A.t0 + a * STEP, lastStart: A.t0 + (i - 1) * STEP, end: A.t0 + (i - 1 + A.k) * STEP, best: A.t0 + bi * STEP,
          });
        }
        a = -1;
      }
    }
    wins.sort((p, q) => q.tier - p.tier || q.who.length - p.who.length || p.maybe.length - q.maybe.length || p.start - q.start);
    const perKey = {}, out = [];
    for (const w of wins) {
      const dk = localKey(w.best, tz);
      if ((perKey[dk] || 0) >= perDay) continue;
      perKey[dk] = (perKey[dk] || 0) + 1;
      out.push(w);
      if (out.length >= limit) break;
    }
    return { windows: out, fallback };
  }

  /* ---------- words, in the viewer's locale (12-hour clock and English words for en-US) ---------- */
  let LOC = 'en-US', H12 = true;
  function setLocale(loc) {
    try {
      const o = new Intl.DateTimeFormat(loc || undefined, { hour: 'numeric' }).resolvedOptions();
      LOC = o.locale;
      H12 = o.hourCycle ? /h1[12]/.test(o.hourCycle) : !!o.hour12;
    } catch { LOC = 'en-US'; H12 = true; }
    return LOC;
  }
  // 0 = Sunday, 1 = Monday
  function weekStart(loc) {
    const l = loc || LOC;
    try {
      const L = new Intl.Locale(l);
      const w = (typeof L.getWeekInfo === 'function' && L.getWeekInfo()) || L.weekInfo;
      if (w && w.firstDay) return w.firstDay % 7;
    } catch { /* older browsers */ }
    return /^en(-US|-CA)?$|-(US|CA|MX|BR|JP|IL|PH|KR|TW)$/i.test(l) ? 0 : 1;
  }
  const wdName = (d) => (LOC === 'en-US' ? WD[d] : new Date(Date.UTC(2026, 10, 15 + d)).toLocaleDateString(LOC, { weekday: 'short', timeZone: 'UTC' }));
  const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  function daysText(wd) {
    const s = [...new Set(wd)].filter((d) => d >= 0 && d <= 6);
    if (s.length === 7) return 'Every day';
    const order = [1, 2, 3, 4, 5, 6, 0].filter((d) => s.includes(d));
    const runs = [];
    for (const d of order) {
      const pos = [1, 2, 3, 4, 5, 6, 0].indexOf(d);
      const last = runs[runs.length - 1];
      if (last && last.end === pos - 1) { last.end = pos; last.days.push(d); } else runs.push({ end: pos, days: [d] });
    }
    return runs.map((r) => (r.days.length >= 3 ? `${wdName(r.days[0])}–${wdName(r.days[r.days.length - 1])}` : r.days.map(wdName).join(', '))).join(', ');
  }
  function timeText(hm) {
    if (hm == null) hm = '00:00';
    const [h, m] = hm.split(':').map(Number);
    if (!H12) return `${pad(h)}:${pad(m)}`;
    if (hm === '00:00') return 'midnight';
    if (hm === '12:00') return 'noon';
    return `${h % 12 || 12}${m ? ':' + pad(m) : ''} ${h < 12 ? 'AM' : 'PM'}`;
  }
  function rangeText(from, to) {
    if (from == null && to == null) return 'all day';
    if (from == null) return `before ${timeText(to)}`;
    if (to == null) return `after ${timeText(from)}`;
    const a = timeText(from), b = timeText(to);
    if (H12 && from < to && a.slice(-3) === b.slice(-3) && / [AP]M$/.test(a)) return `${a.slice(0, -3)}–${b}`;
    return `${a}–${b}`;
  }
  function ruleText(r) {
    return `${daysText(r.wd)} ${rangeText(r.from, r.to)}${r.lvl === 'maybe' ? ' (maybe)' : ''}`;
  }
  function dateText(key, opt) {
    return new Date(keyUtc(key)).toLocaleDateString(LOC, Object.assign({ timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' }, opt || {}));
  }
  function datesText(a, b) {
    if (!b || b === a) return dateText(a);
    const A = parseKey(a), B = parseKey(b);
    if (LOC !== 'en-US') {
      const f = new Intl.DateTimeFormat(LOC, { timeZone: 'UTC', month: 'short', day: 'numeric' });
      return f.formatRange ? f.formatRange(new Date(keyUtc(a)), new Date(keyUtc(b))) : `${f.format(new Date(keyUtc(a)))}–${f.format(new Date(keyUtc(b)))}`;
    }
    const mon = (k) => new Date(keyUtc(k)).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short' });
    if (A.y === B.y && A.m === B.m) return `${mon(a)} ${A.d}–${B.d}`;
    return `${mon(a)} ${A.d}–${mon(b)} ${B.d}`;
  }
  function dayText(x) {
    const when = datesText(x.d1, x.d2);
    const hours = x.from == null && x.to == null ? null : rangeText(x.from, x.to);
    const maybe = x.lvl === 'maybe' ? ' (maybe)' : '';
    if (x.kind === 'away') return hours ? `Busy ${hours}, ${when}` : (x.d2 && x.d2 !== x.d1 ? `Away ${when}` : `Not free ${when}`);
    if (x.kind === 'only') return hours ? `Only ${hours}, ${when}${maybe}` : `Free all day ${when}${maybe}`;
    return hours ? `Also ${hours}, ${when}${maybe}` : `Free all day ${when}${maybe}`;
  }
  // an instant as a time of day in a zone: '8:30 PM' (or '20:30')
  function clock(t, tz) { return H12 ? timeText(localHM(t, tz)).replace('midnight', '12 AM').replace('noon', '12 PM') : localHM(t, tz); }
  function spanText(s, e, tz) {
    const a = clock(s, tz), b = clock(e, tz);
    if (H12 && a.slice(-2) === b.slice(-2) && localKey(s, tz) === localKey(e - 1, tz) && e - s < 12 * HOUR) return `${a.slice(0, -3)}–${b}`;
    return `${a}–${b}`;
  }
  function zoneName(tz, style = 'long') {
    try {
      const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: style === 'long' ? 'longGeneric' : 'shortGeneric' }).formatToParts(new Date()).find((x) => x.type === 'timeZoneName');
      return p ? p.value : tz;
    } catch { return tz; }
  }

  /* ---------- the locked-in time, for calendars and Discord ---------- */
  const icsTime = (t) => new Date(t).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  function icsEscape(s) { return String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n'); }
  function ics({ uid, name, start, end, url, now }) {
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Boofers Den//Find time to hang//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'BEGIN:VEVENT',
      `UID:${uid}`, `DTSTAMP:${icsTime(now || Date.now())}`, `DTSTART:${icsTime(start)}`, `DTEND:${icsTime(end)}`, `SUMMARY:${icsEscape(name)}`];
    if (url) { lines.push(`URL:${url}`); lines.push(`DESCRIPTION:${icsEscape(url)}`); }
    lines.push('END:VEVENT', 'END:VCALENDAR');
    // fold lines longer than 75 octets
    return lines.map((l) => { let out = '', s = l; while (octets(s) > 75) { let n = 75; while (octets(s.slice(0, n)) > 75) n--; out += s.slice(0, n) + '\r\n '; s = s.slice(n); } return out + s; }).join('\r\n') + '\r\n';
  }
  function octets(s) { return unescape(encodeURIComponent(s)).length; }
  function googleLink({ name, start, end, url }) {
    const q = new URLSearchParams({ action: 'TEMPLATE', text: name, dates: `${icsTime(start)}/${icsTime(end)}` });
    if (url) q.set('details', url);
    return 'https://calendar.google.com/calendar/render?' + q.toString();
  }

  return {
    MIN, HOUR, DAY, STEP, YES, MAYBE,
    keyOf, parseKey, isKey, addDays, weekday, daysBetween, keyUtc, HM_RE,
    validZone, offset, toUtc, localKey, localHM, dayStart,
    personSpans, answered, clearDays, setDays, pruneDays,
    analyze, dayStats, bestTimes,
    setLocale, weekStart, daysText, timeText, rangeText, ruleText, dateText, datesText, dayText, clock, spanText, zoneName,
    ics, googleLink,
  };
});
