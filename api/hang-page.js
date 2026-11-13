// Serves /hang/<id>: the scheduler page with the event's name in its title and link preview,
// so a link pasted in Discord unfurls as "Space game" rather than as a generic page.
// The page itself is the static hang/index.html; only the block between <!--meta--> and
// <!--/meta--> is replaced. Every value is HTML-escaped.

const fs = require("fs");
const path = require("path");
const E = require("../hang/engine.js");
const S = require("./_hang-store.js");

let tpl = null;
function template() {
  if (!tpl) tpl = fs.readFileSync(path.join(process.cwd(), "hang", "index.html"), "utf8");
  return tpl;
}
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

async function describe(id) {
  const r = S.getClient();
  const ev = await S.readEvent(r, id);
  if (!ev) return null;
  const rows = (await r.hgetall(S.K.pp(id))) || {};
  let done = 0;
  for (const v of Object.values(rows)) { try { if (E.answered(JSON.parse(v))) done++; } catch { /* skip */ } }
  const roster = (ev.roster || []).length;
  const next = (ev.sessions || []).filter((s) => s.end > Date.now()).sort((a, b) => a.start - b.start)[0];
  let desc;
  if (next) {
    desc = `Locked in: ${next.label ? next.label + ", " : ""}${E.dateText(E.localKey(next.start, ev.tz))}, ${E.spanText(next.start, next.end, ev.tz)} ${E.zoneName(ev.tz, "short")}.`;
  } else {
    desc = "Tap your name and pick when you're usually free.";
    if (roster) desc += ` ${Math.min(done, roster)} of ${roster} have filled it in.`;
    else if (done) desc += ` ${done} ${done === 1 ? "person has" : "people have"} filled it in.`;
  }
  return { title: ev.name, desc };
}

module.exports = async function handler(req, res) {
  const id = String((req.query && req.query.id) || "");
  let html = template(), status = 200;
  if (S.validId(id) && S.URL) {
    try {
      const d = await describe(id);
      if (d) {
        const meta = [
          `<title>${esc(d.title)} · Find time to hang</title>`,
          `<meta name="description" content="${esc(d.desc)}" />`,
          `<meta property="og:site_name" content="Boofer's Den · Find time to hang" />`,
          `<meta property="og:title" content="${esc(d.title)}" />`,
          `<meta property="og:description" content="${esc(d.desc)}" />`,
          `<meta property="og:type" content="website" />`,
          `<meta name="twitter:card" content="summary" />`,
        ].join("\n  ");
        html = html.replace(/<!--meta-->[\s\S]*?<!--\/meta-->/, () => meta); // a function, so "$&" in a name stays text
      } else status = 404;
    } catch { /* serve the plain page; the app reports what is wrong */ }
  } else status = 404;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=0, s-maxage=30, stale-while-revalidate=60");
  res.status(status).send(html);
};
