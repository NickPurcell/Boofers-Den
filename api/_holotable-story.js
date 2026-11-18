"use strict";
// The story between fights (audit section 11, Wretched Hives and the PHB), all the GM's to keep:
//  - factions (11.3): a tier and renown for the faction, and each character's rank and renown in it;
//  - rivals and complications (11.4): who's after the party, known to the players only when the GM says so;
//  - lifestyle (11.5): each sheet's lifestyle (the sheet keeps it), and the GM charging N days of it at once.
// Players see factions the GM shows and rivals the GM has made known; notes marked for the GM stay the GM's.

const ID = /^[a-z0-9]{4,20}$/;
const own = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k);
const int = (v, d = 0) => (Number.isFinite(+v) ? Math.trunc(+v) : d);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const str = (v, n) => String(v == null ? "" : v).slice(0, n);
const rid = () => require("crypto").randomBytes(5).toString("hex");

// SW5e's lifestyle expenses (PHB, Equipment): credits a day
const LIFESTYLES = { Wretched: 0, Squalid: 1, Poor: 2, Modest: 10, Comfortable: 20, Wealthy: 40, Aristocratic: 100 };

function cleanFaction(f, chars) {
  if (!f || typeof f !== "object" || !str(f.name, 80).trim()) return null;
  const members = {};
  for (const [id, m] of Object.entries(f.members && typeof f.members === "object" ? f.members : {})) {
    if (!own(chars, id) || !m || typeof m !== "object") continue;
    members[id] = { rank: clamp(int(m.rank), 0, 5), renown: clamp(int(m.renown), 0, 100000) };
  }
  return { id: ID.test(String(f.id || "")) ? String(f.id) : rid(), name: str(f.name, 80).trim(), tier: clamp(int(f.tier, 1), 1, 20),
    renown: clamp(int(f.renown), 0, 1000000), notes: str(f.notes, 2000), gmNotes: str(f.gmNotes, 2000), shown: !!f.shown, members };
}
function cleanRival(r, chars) {
  if (!r || typeof r !== "object" || !str(r.name, 80).trim()) return null;
  return { id: ID.test(String(r.id || "")) ? String(r.id) : rid(), name: str(r.name, 80).trim(), kind: r.kind === "complication" ? "complication" : "rival",
    notes: str(r.notes, 2000), gmNotes: str(r.gmNotes, 2000), known: !!r.known,
    chars: [...new Set((Array.isArray(r.chars) ? r.chars : []).map(String).filter((id) => own(chars, id)))].slice(0, 30) };
}
const cleanList = (list, fn, chars, max) => (Array.isArray(list) ? list : []).slice(0, max).map((x) => fn(x, chars)).filter(Boolean)
  .filter((x, i, a) => a.findIndex((y) => y.id === x.id) === i);

function apply(camp, cid, gm, type, p, G) {
  p = p || {};
  if (!gm) throw new G.Forbidden("GM only");
  const chars = camp.characters || {};
  if (type === "faction.save" || type === "rival.save") {
    const key = type === "faction.save" ? "factions" : "rivals", fn = key === "factions" ? cleanFaction : cleanRival;
    const x = fn(p.item, chars);
    if (!x) throw new G.Invalid("It needs a name.");
    const list = cleanList(camp[key], fn, chars, 50), at = list.findIndex((y) => y.id === x.id);
    if (at < 0 && list.length >= 50) throw new G.Invalid("That's the most a table can keep (50). Delete one first.");
    if (at < 0) list.push(x); else list[at] = x;
    camp[key] = list;
    return { id: x.id };
  }
  if (type === "faction.remove" || type === "rival.remove") {
    const key = type === "faction.remove" ? "factions" : "rivals";
    camp[key] = (camp[key] || []).filter((y) => y.id !== String(p.id || ""));
    if (!camp[key].length) delete camp[key];
    return {};
  }
  if (type === "faction.renown") {   // renown earned for the faction: the character's and the faction's both go up
    const f = (camp.factions || []).find((y) => y.id === String(p.id || ""));
    const id = String(p.charId || "");
    if (!f) throw new G.Invalid("No such faction.");
    if (!own(chars, id)) throw new G.Invalid("No such character.");
    const d = clamp(int(p.delta), -1000, 1000);
    const m = f.members[id] || { rank: 0, renown: 0 };
    m.renown = clamp(m.renown + d, 0, 100000); f.members[id] = m;
    f.renown = clamp(f.renown + d, 0, 1000000);
    if (d && f.shown && p.announce !== false) G.addChat(camp, { system: true, text: `⚑ ${G.shownName(camp, { charId: id, name: chars[id].name })} ${d > 0 ? "earns" : "loses"} ${Math.abs(d)} renown with ${f.name}${d > 0 ? "" : ""}.` });
    return { renown: m.renown };
  }
  if (type === "lifestyle.charge") {   // N days of each character's lifestyle, taken from their credits (it can't go below 0)
    const days = clamp(int(p.days, 1), 1, 365);
    const ids = [...new Set((Array.isArray(p.chars) ? p.chars : []).map(String))].filter((id) => own(chars, id)).slice(0, 30);
    if (!ids.length) throw new G.Invalid("Pick whose lifestyle to charge.");
    const lines = [], short = [];
    for (const id of ids) {
      const c = chars[id], perDay = own(LIFESTYLES, c.lifestyle) ? LIFESTYLES[c.lifestyle] : null;
      if (perDay == null) continue;
      const cost = perDay * days, had = Math.max(0, int(c.credits));
      c.credits = Math.max(0, had - cost);
      const nm = G.shownName(camp, { charId: id, name: c.name });   // a name the GM hides stays hidden (#199 review)
      lines.push(`${nm} ${cost} cr (${c.lifestyle})`);
      if (had < cost) short.push(nm);
    }
    if (!lines.length) throw new G.Invalid("None of them has a lifestyle set (Bio & Notes on the sheet).");
    G.addChat(camp, { system: true, text: `🏠 ${days} day${days === 1 ? "" : "s"} of living: ${lines.join(", ")}.${short.length ? ` ${short.join(", ")} couldn't cover it all.` : ""}` });
    return { charged: lines.length };
  }
  throw new G.Invalid("Unknown request.");
}

// what each person sees: the GM all of it; a player the factions the GM shows and the rivals the GM has made known,
// without the GM's notes
function view(camp, gm) {
  const out = {};
  const f = camp.factions || [], r = camp.rivals || [];
  if (gm) { if (f.length) out.factions = f; if (r.length) out.rivals = r; return out; }
  const fs = f.filter((x) => x.shown).map((x) => Object.assign({}, x, { gmNotes: undefined }));
  const rs = r.filter((x) => x.known).map((x) => Object.assign({}, x, { gmNotes: undefined }));
  if (fs.length) out.factions = fs; if (rs.length) out.rivals = rs;
  return out;
}
function clean(g) {
  const chars = g.characters || {};
  const f = cleanList(g.factions, cleanFaction, chars, 50), r = cleanList(g.rivals, cleanRival, chars, 50);
  if (f.length) g.factions = f; else delete g.factions;
  if (r.length) g.rivals = r; else delete g.rivals;
}
const handles = (type) => /^(faction|rival|lifestyle)\./.test(type);

module.exports = { apply, view, clean, handles, LIFESTYLES };
