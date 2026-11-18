// Builds index.html from audit.md, so the page and the audit cannot drift apart.
//
//   node build.mjs           write index.html
//   node build.mjs --check   exit 1 if index.html is not what audit.md makes (tests/holotable-audit.test.js runs this)
//
// audit.md is kept exactly as the audit was written. This script reads its checklist lines
// (`- [x] **ID · STATE · HOW · MATTERS** — text. Evidence: …`), its section headings, "The ten gaps
// that matter most" and "Done well", and refuses to build if any line does not fit, rather than
// silently dropping it. No dependencies, nothing fetched.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ITEM = /^- \[( |x)\] \*\*(\d+\.\d+) · (DONE|PARTIAL|MISSING) · (computes|stores|text|none) · (every session|sometimes|nicety)(?: \((.+?)\))?\*\* — (.+)$/;
const MATTERS = { 'every session': 'every', sometimes: 'some', nicety: 'nice' };

export function parse(md) {
  const audit = { title: '', commit: '', when: '', checked: [], sections: [], gaps: [], next: '', doneWell: [] };
  let mode = 'intro', section = null, inChecked = false;
  md.replace(/\r\n?/g, '\n').split('\n').forEach((line, i) => {   // a Windows checkout may bring CRLF
    const where = `audit.md line ${i + 1}`;
    if (line.startsWith('# ')) { audit.title = line.slice(2).trim(); return; }
    const h2 = line.match(/^## (.+)$/);
    if (h2) {
      const n = h2[1].match(/^(\d+)\. (.+)$/);
      if (n) { section = { n: +n[1], title: n[2], intro: [], items: [] }; audit.sections.push(section); mode = 'section'; }
      else if (/^The ten gaps/.test(h2[1])) mode = 'gaps';
      else if (/^Done well/.test(h2[1])) mode = 'done';
      else throw new Error(`${where}: a heading this script does not know: ${line}`);
      return;
    }
    const text = line.trim();
    if (!text || text === '---') return;
    if (mode === 'intro') {
      const c = line.match(/commit \*\*([0-9a-f]{7,40})\*\* \(([^)]+)\)/);
      if (c && !audit.commit) { audit.commit = c[1]; audit.when = c[2]; }
      if (text.startsWith('**How it was checked.**')) inChecked = true;
      else if (text.startsWith('**')) inChecked = false;
      else if (inChecked && text.startsWith('- ')) audit.checked.push(text.slice(2));
      return;
    }
    if (mode === 'section') {
      const m = line.match(ITEM);
      if (m) {
        const [, tick, id, state, how, matters, forWhom, rest] = m;
        if ((tick === 'x') !== (state === 'DONE')) throw new Error(`${where}: the tick and the state disagree (${id})`);
        const cut = rest.lastIndexOf(' Evidence: ');
        section.items.push({ id, state: state.toLowerCase(), how, matters, forWhom: forWhom || '', text: cut < 0 ? rest : rest.slice(0, cut), evidence: cut < 0 ? '' : rest.slice(cut + 11) });
      } else if (/^- \[/.test(text)) throw new Error(`${where}: a checklist line that does not fit the format: ${text.slice(0, 80)}`);
      else section.intro.push(text);
      return;
    }
    if (mode === 'gaps') {
      const g = text.match(/^\d+\. (.+)$/);
      if (g) audit.gaps.push(g[1]);
      else if (/^Next after these/.test(text)) audit.next = text;
      else throw new Error(`${where}: unexpected line in the ten gaps: ${text.slice(0, 80)}`);
      return;
    }
    if (mode === 'done') {
      if (text.startsWith('- ')) audit.doneWell.push(text.slice(2));
      else throw new Error(`${where}: unexpected line in Done well: ${text.slice(0, 80)}`);
    }
  });
  const items = audit.sections.flatMap((s) => s.items);
  const ids = items.map((x) => x.id);
  if (new Set(ids).size !== ids.length) throw new Error('a checklist ID appears twice');
  if (!audit.commit || audit.gaps.length !== 10 || !audit.doneWell.length || !items.length) throw new Error('audit.md is missing its commit, its ten gaps, Done well or its checklist');
  audit.items = items;
  audit.count = { done: 0, partial: 0, missing: 0, every: 0, some: 0, nice: 0 };
  for (const x of items) { audit.count[x.state] += 1; audit.count[MATTERS[x.matters]] += 1; }
  return audit;
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// The audit's own inline marks: `code`, **bold**, *italic*. With `ids`, checklist IDs become links to their lines.
function inline(s, ids) {
  return s.split(/(`[^`]+`)/).map((part) => {
    if (/^`[^`]+`$/.test(part)) return `<code>${esc(part.slice(1, -1))}</code>`;
    let h = esc(part).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/\*([^*]+)\*/g, '<em>$1</em>');
    if (ids) h = h.replace(/\b(\d{1,2})\.(\d{1,2})\b/g, (m, a, b) => (ids.has(m) ? `<a href="#l-${a}-${b}">${m}</a>` : m));
    return h;
  }).join('');
}
const STATE = { done: ['✓', 'Done'], partial: ['◐', 'Partial'], missing: ['✗', 'Missing'] };

export function render(audit) {
  const ids = new Set(audit.items.map((x) => x.id));
  const c = audit.count, total = audit.items.length;
  const item = (x) => {
    const [mark, word] = STATE[x.state];
    const matters = x.matters + (x.forWhom ? ` (${x.forWhom})` : '');
    return `<li class="item ${x.state}" id="l-${x.id.replace('.', '-')}" data-state="${x.state}" data-matters="${MATTERS[x.matters]}">
<p class="row"><span class="state ${x.state}"><span aria-hidden="true">${mark}</span> ${word}</span> <span class="id">${x.id}</span> <span class="meta">${esc(x.how)} · ${esc(matters)}</span></p>
<p class="text">${inline(x.text)}</p>${x.evidence ? `\n<p class="ev">Evidence: ${inline(x.evidence)}</p>` : ''}
</li>`;
  };
  const section = (s) => {
    const n = { done: 0, partial: 0, missing: 0 };
    for (const x of s.items) n[x.state] += 1;
    return `<details class="sec" id="s-${s.n}">
<summary><span class="sn">${s.n}.</span> <span class="st">${esc(s.title)}</span> <span class="sc"><span class="tally">${n.done} done · ${n.partial} partial · ${n.missing} missing</span><span class="shown" hidden></span></span></summary>
${s.intro.map((p) => `<p class="intro">${inline(p)}</p>`).join('\n')}
<ul class="items">
${s.items.map(item).join('\n')}
</ul>
<p class="nomatch" hidden>Nothing in this section matches the filters.</p>
</details>`;
  };
  const description = `HoloTable, jpesus's Star Wars 5e tabletop, checked line by line against the SW5e rules (first at commit ${audit.commit}, kept up to date since): ${c.done} done, ${c.partial} partial, ${c.missing} missing, and the ten gaps that matter most.`;
  return `<!DOCTYPE html>
<!-- Generated by build.mjs from audit.md. Edit audit.md (or build.mjs), then run: node build.mjs -->
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
  <meta name="theme-color" content="#f6f1e7" />
  <title>HoloTable against SW5e: what's done, what's missing</title>
  <meta name="description" content="${esc(description)}" />
  <meta property="og:title" content="HoloTable against SW5e: what's done, what's missing" />
  <meta property="og:description" content="${esc(description)}" />
  <link rel="stylesheet" href="audit.css" />
</head>
<body>
  <nav class="top"><a class="back" href="../">&larr; Guitar Goblin</a><a class="back" href="https://boofers-den.vercel.app/sections/jpesus/holotable/">Open HoloTable &rarr;</a></nav>
  <div class="wrap">
    <header class="hero">
      <p class="kicker">An audit &middot; ${total} lines &middot; first at commit ${audit.commit}, kept up to date</p>
      <h1>HoloTable against SW5e <span>what a table needs to play the whole system, and what is there</span></h1>
      <p class="lead">This is a line-by-line check of <a href="https://boofers-den.vercel.app/sections/jpesus/holotable/">HoloTable</a>, the Star Wars 5e tabletop jpesus built on the Den, against what the SW5e rules ask of a table: making and levelling characters, class resources, powers, the sheet's arithmetic, gear, rests and conditions, combat on the map, the GM's side, starships, downtime, and the table itself. It was first checked at commit <code>${esc(audit.commit)}</code> (${esc(audit.when)}), and each line marked "Since 17 Nov" says what has landed on main since and which pull request did it, so the counts are today's. It is meant as a to-do list for the group, not a verdict.</p>
      <ul class="counts" aria-label="The ${total} lines">
        <li class="done"><b>${c.done}</b> <span aria-hidden="true">✓</span> done</li>
        <li class="partial"><b>${c.partial}</b> <span aria-hidden="true">◐</span> partial</li>
        <li class="missing"><b>${c.missing}</b> <span aria-hidden="true">✗</span> missing</li>
      </ul>
    </header>

    <section aria-labelledby="gaps">
      <h2 id="gaps">The ten gaps that matter most</h2>
      <ol class="gaps">
${audit.gaps.map((g) => `        <li>${inline(g, ids)}</li>`).join('\n')}
      </ol>
      <p class="after">${inline(audit.next, ids)}</p>
    </section>

    <section aria-labelledby="well">
      <h2 id="well">Done well</h2>
      <ul class="well">
${audit.doneWell.map((d) => `        <li>${inline(d, ids)}</li>`).join('\n')}
      </ul>
    </section>

    <section aria-labelledby="list">
      <h2 id="list">The full checklist <small>${total} lines in ${audit.sections.length} sections. Tap a section to open it.</small></h2>
      <dl class="legend">
        <div><dt>State</dt><dd><b>✓ Done</b> works as the rules ask &middot; <b>◐ Partial</b> some of it &middot; <b>✗ Missing</b> no code for it</dd></div>
        <div><dt>How</dt><dd><b>computes</b> HoloTable does the rule's arithmetic &middot; <b>stores</b> keeps what a person types &middot; <b>text</b> shows the rule's words &middot; <b>none</b> no code</dd></div>
        <div><dt>Matters</dt><dd><b>every session</b> &middot; <b>sometimes</b> &middot; <b>nicety</b></dd></div>
      </dl>
      <div class="filters" id="filters" hidden>
        <div class="fgroup" role="group" aria-label="Show by state">
          <button type="button" data-f="state" data-v="done" aria-pressed="true">✓ Done ${c.done}</button>
          <button type="button" data-f="state" data-v="partial" aria-pressed="true">◐ Partial ${c.partial}</button>
          <button type="button" data-f="state" data-v="missing" aria-pressed="true">✗ Missing ${c.missing}</button>
        </div>
        <div class="fgroup" role="group" aria-label="Show by how much it matters">
          <button type="button" data-f="matters" data-v="every" aria-pressed="true">Every session ${c.every}</button>
          <button type="button" data-f="matters" data-v="some" aria-pressed="true">Sometimes ${c.some}</button>
          <button type="button" data-f="matters" data-v="nice" aria-pressed="true">Nicety ${c.nice}</button>
        </div>
        <div class="fgroup">
          <button type="button" id="openall">Open all</button>
          <button type="button" id="closeall">Close all</button>
          <span class="shownall" id="shownall" aria-live="polite">Showing all ${total}.</span>
        </div>
      </div>
${audit.sections.map(section).join('\n')}
    </section>

    <details class="how">
      <summary>How this was checked</summary>
      <ul>
${audit.checked.map((x) => `        <li>${inline(x)}</li>`).join('\n')}
      </ul>
    </details>

    <footer class="foot">
      <p>The full audit as written: <a href="audit.md">audit.md</a> (also <a href="https://github.com/NickPurcell/Boofers-Den/blob/main/sections/guitar-goblin/holotable-audit/audit.md">on GitHub</a>). This page is built from it by <code>build.mjs</code>, so the two say the same thing.</p>
      <p>The rules named here belong to SW5e (<a href="https://sw5e.com">sw5e.com</a>). This page names rules and points at HoloTable's code; it copies none of the rules' text. HoloTable is jpesus's.</p>
    </footer>
  </div>
  <script src="audit.js"></script>
</body>
</html>
`;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const html = render(parse(readFileSync(join(HERE, 'audit.md'), 'utf8')));
  const target = join(HERE, 'index.html');
  if (process.argv.includes('--check')) {
    let current = '';
    try { current = readFileSync(target, 'utf8'); } catch { /* missing counts as different */ }
    if (current.replace(/\r\n?/g, '\n') !== html) { console.error('index.html is not what audit.md makes: run node build.mjs'); process.exit(1); }
    console.log('index.html matches audit.md');
  } else {
    writeFileSync(target, html);
    console.log('wrote index.html');
  }
}
