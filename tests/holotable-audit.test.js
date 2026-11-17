// The HoloTable audit page in Nick's section is generated from audit.md by build.mjs. These tests
// fail if the page and the audit drift apart, or if the page starts loading anything from elsewhere.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const DIR = path.join(__dirname, '..', 'sections', 'guitar-goblin', 'holotable-audit');
const build = () => import(path.join(DIR, 'build.mjs'));

test('holotable audit: index.html is exactly what audit.md makes', async () => {
  const { parse, render } = await build();
  const html = render(parse(fs.readFileSync(path.join(DIR, 'audit.md'), 'utf8')));
  assert.equal(fs.readFileSync(path.join(DIR, 'index.html'), 'utf8'), html, 'run: node sections/guitar-goblin/holotable-audit/build.mjs');
});

test('holotable audit: every checklist line is read, and the counts add up', async () => {
  const { parse } = await build();
  const md = fs.readFileSync(path.join(DIR, 'audit.md'), 'utf8');
  const a = parse(md);
  assert.equal(a.items.length, (md.match(/^- \[[ x]\] \*\*/gm) || []).length);
  assert.equal(a.count.done + a.count.partial + a.count.missing, a.items.length);
  assert.equal(a.count.every + a.count.some + a.count.nice, a.items.length);
  assert.equal(a.gaps.length, 10);
  const html = fs.readFileSync(path.join(DIR, 'index.html'), 'utf8');
  for (const x of a.items) assert.ok(html.includes(`id="l-${x.id.replace('.', '-')}"`), `line ${x.id} is on the page`);
});

test('holotable audit: the page loads nothing from anywhere else', () => {
  const html = fs.readFileSync(path.join(DIR, 'index.html'), 'utf8');
  assert.deepEqual(html.match(/<(script|link|img|iframe)[^>]+(src|href)="(https?:)?\/\/[^"]+"/g), null);
  const js = fs.readFileSync(path.join(DIR, 'audit.js'), 'utf8');
  assert.ok(!/fetch\(|XMLHttpRequest|https?:\/\//.test(js));
  const css = fs.readFileSync(path.join(DIR, 'audit.css'), 'utf8');
  assert.ok(!/url\(|@import/.test(css));
});
