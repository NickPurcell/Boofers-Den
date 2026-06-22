// jpesus's corner — Destiny 2 god-roll armory (PvE + PvP) + Titan Pantheon DPS build.
// Current to the Monument of Triumph update (9.7.0, June 2026). Weapon facts pulled
// from Bungie's live manifest (the same data light.gg surfaces; light.gg itself
// blocks automated scraping), god rolls from current community sources.
// "new: true" = new or significantly reworked in Monument of Triumph / recent updates.

// ---------- PvE rolls ----------
const WEAPONS_PVE = [
  { name: "Fafnir", type: "Linear Fusion Rifle", ammo: "Heavy", element: "Void", rarity: "Exotic", new: true,
    roll: "Catalyst: No Distractions (near-zero flinch); perk Quantum Nova — consumes reserves to ~30% Weaken + delayed detonation",
    drop: "Monument of Triumph — Tenet of Bravery pillar, Tower (50 Legendary Marks)",
    why: "Standout new exotic of 9.7.0 — a Heavy that both applies a 30% Weaken AND does real boss DPS in one slot." },
  { name: "Turncoat", type: "Hand Cannon", ammo: "Primary", element: "Void", rarity: "Exotic", new: true,
    roll: "Catalyst: free for all players; intrinsic Latent Power + Heavy Grip, rides the 9.7.0 +40%-vs-minors buff",
    drop: "Monument of Triumph Rewards Pass",
    why: "Brand-new Void exotic primary that shreds ad waves while feeding Void builds." },
  { name: "Sunshot", type: "Hand Cannon", ammo: "Primary", element: "Solar", rarity: "Exotic", new: true,
    roll: "Catalyst Loose Change (+reload/handling on rapid kills); perk Sun Blast explosive chain-kills (retuned in 9.7.0)",
    drop: "Exotic Archive, Tower",
    why: "Post-9.7.0 explosion retune + primary buffs make its Solar chain-reactions top-tier solo add-clear." },
  { name: "The Jade Rabbit", type: "Scout Rifle", ammo: "Primary", element: "Kinetic", rarity: "Exotic", new: true,
    roll: "Catalyst: Fate of All Fools → Micro Missile bonus round; reworked with Firefly + Shoot to Loot, 15-round mag",
    drop: "Exotic engrams / rare world drop",
    why: "A big 9.7.0 winner — Firefly + Shoot to Loot + the Micro Missile catalyst finally give it real PvE value." },
  { name: "Blast Furnace", type: "Pulse Rifle", ammo: "Primary", element: "Kinetic", rarity: "Legendary", new: true,
    roll: "Smallbore / Tactical Mag / Kinetic Tremors / Firefly",
    drop: "Black Armory reissue — Arena Ops (Vanguard Ops)",
    why: "Cleanest Kinetic primary of the Black Armory reissues — Kinetic Tremors + Firefly with the new 9.7.0 pool." },
  { name: "Khvostov 7G-0X", type: "Auto Rifle", ammo: "Primary", element: "Kinetic", rarity: "Exotic", new: false,
    roll: "Catalyst: +reserves/stability; ricochet rounds that chain on kills, rotating perks",
    drop: "Exploring the Pale Heart (Final Shape exotic quest)",
    why: "A comfortable do-everything Kinetic primary that benefits from the +30% all-primary buff." },
  { name: "Choir of One", type: "Auto Rifle", ammo: "Special", element: "Void", rarity: "Exotic", new: false,
    roll: "Catalyst: +reserves/handling; perk Variable Magazine — burst rounds at range, full-auto up close",
    drop: "Exotic mission 'Encore' (rotator)",
    why: "One of the most versatile specials — ad-clear and elite burst from a single gun." },
  { name: "Divinity", type: "Trace Rifle", ammo: "Special", element: "Arc", rarity: "Exotic", new: false,
    roll: "Catalyst: +ammo/reserves; perk Judgment — precision cage that Weakens and gives the team a crit zone",
    drop: "'Divine Fragmentation' exotic quest (Garden of Salvation)",
    why: "Unmatched team utility — its weaken bubble and crit cage raise everyone's boss DPS." },
  { name: "Microcosm", type: "Trace Rifle", ammo: "Heavy", element: "Kinetic", rarity: "Exotic", new: false,
    roll: "Catalyst: +handling/reserves; perk Architectural Logic — huge bonus vs shields/Subjugators",
    drop: "Exploring the Pale Heart (Final Shape)",
    why: "Premier answer to Subjugator-heavy content and a comfy sustained-DPS heavy." },
  { name: "Gjallarhorn", type: "Rocket Launcher", ammo: "Heavy", element: "Solar", rarity: "Exotic", new: false,
    roll: "Catalyst: faster reload/handling; perk Wolfpack Rounds — tracking clusters that buff allied rockets",
    drop: "'And Out Fly the Wolves' exotic quest",
    why: "Best broad-use heavy for groups — Wolfpack buffs every teammate's rocket." },
  { name: "Cataclysmic", type: "Linear Fusion Rifle", ammo: "Heavy", element: "Solar", rarity: "Legendary", new: false,
    roll: "Fluted Barrel / Liquid Coils / Fourth Time's the Charm / Bait and Switch",
    drop: "Vow of the Disciple raid (craftable)",
    why: "Top legendary boss-DPS LFR — FTTC self-refunds while Bait and Switch delivers a huge damage window." },
  { name: "Cold Comfort", type: "Rocket Launcher", ammo: "Heavy", element: "Stasis", rarity: "Legendary", new: false,
    roll: "Quick Launch / Impact Casing / Envious Assassin / Bait and Switch",
    drop: "Ghosts of the Deep dungeon",
    why: "S-tier legendary rocket — Envious Assassin overflows the tube, Bait and Switch stacks a big burst." },
  { name: "Scintillation", type: "Linear Fusion Rifle", ammo: "Heavy", element: "Strand", rarity: "Legendary", new: false,
    roll: "Fluted Barrel / Liquid Coils / Envious Assassin / Bait and Switch",
    drop: "Nightfall (rotating)",
    why: "Premier Strand heavy LFR — a craftable-tier boss burst option for Strand builds." },
];

// ---------- PvP rolls ----------
const WEAPONS_PVP = [
  { name: "Spare Rations", type: "Hand Cannon", ammo: "Primary", element: "Kinetic", rarity: "Legendary", new: true,
    roll: "Hammer-Forged Rifling / High-Caliber Rounds / Slideshot / Kill Clip",
    drop: "Reissued — focus/attune at the vendor station",
    why: "Reissued 140 Adaptive HC with the classic Slideshot/Kill Clip workhorse roll that punishes rushers." },
  { name: "The Last Word", type: "Hand Cannon", ammo: "Primary", element: "Kinetic", rarity: "Exotic", new: true,
    roll: "New 9.7.0 catalyst: Killing Wind + Envious Assassin; hip-fire Fan Fire intrinsic",
    drop: "Exotic Archive, Tower; catalyst via Monument of Triumph triumphs",
    why: "Its brand-new catalyst makes the hip-fire close-range king the top PvP exotic primary, especially on M&K." },
  { name: "Luna's Howl", type: "Hand Cannon", ammo: "Primary", element: "Solar", rarity: "Legendary", new: false,
    roll: "Hammer-Forged Rifling / Accurized Rounds / Eye of the Storm / Magnificent Howl",
    drop: "Into the Light / Hall of Champions",
    why: "Strongest energy 140 HC — reworked Magnificent Howl can two-tap, Eye of the Storm rules duels." },
  { name: "Kept Confidence", type: "Hand Cannon", ammo: "Primary", element: "Strand", rarity: "Legendary", new: false,
    roll: "Hammer-Forged Rifling / Accurized Rounds / Killing Wind / Eye of the Storm",
    drop: "Season of the Witch — seasonal archive",
    why: "Killing Wind + Eye of the Storm make it a long-range 140 that never loses a 1v1." },
  { name: "The Messenger", type: "Pulse Rifle", ammo: "Primary", element: "Kinetic", rarity: "Legendary", new: false,
    roll: "Arrowhead Brake / Accurized Rounds / Rapid Hit / Desperado",
    drop: "Trials of Osiris (Adept from Flawless)",
    why: "Benchmark High-Impact pulse — a 3-burst killer that defines the long-range meta." },
  { name: "Last Thursday", type: "Pulse Rifle", ammo: "Primary", element: "Strand", rarity: "Legendary", new: true,
    roll: "Arrowhead Brake / Accurized Rounds / Rapid Hit / Headseeker",
    drop: "Exploring Kepler (tiered loot)",
    why: "Near-recoilless Adaptive pulse with forgiving headshot TTK — far easier to farm than The Messenger." },
  { name: "Elsie's Rifle", type: "Pulse Rifle", ammo: "Primary", element: "Void", rarity: "Legendary", new: false,
    roll: "Hammer-Forged Rifling / Accurized Rounds / Zen Moment / Headseeker",
    drop: "Into the Light / Hall of Champions",
    why: "Void High-Impact pulse that rivals The Messenger — Zen Moment stability, Headseeker 3-bursts." },
  { name: "Astral Horizon", type: "Shotgun", ammo: "Special", element: "Kinetic", rarity: "Legendary", new: false,
    roll: "Rifled Barrel / Accurized Rounds / Threat Detector / Opening Shot",
    drop: "Trials of Osiris packages",
    why: "Aggressive Trials shotgun with the timeless Threat Detector + Opening Shot one-shot package." },
  { name: "Keen Thistle", type: "Sniper Rifle", ammo: "Special", element: "Solar", rarity: "Legendary", new: false,
    roll: "Arrowhead Brake / Accurized Rounds / Lone Wolf / Closing Time",
    drop: "Trials of Osiris",
    why: "Aggressive 90-RPM sniper with meta Lone Wolf + Closing Time — outrageous handling and flinch resist." },
  { name: "Iterative Loop", type: "Fusion Rifle", ammo: "Special", element: "Arc", rarity: "Legendary", new: false,
    roll: "Liquid Coils / Projection Fuse / Under Pressure / Kickstart",
    drop: "Exploring Neomuna",
    why: "Rapid-Fire fusion with Kickstart slashing slide charge time — brought fusions back to the meta." },
  { name: "The Spiteful Fang", type: "Combat Bow", ammo: "Primary", element: "Kinetic", rarity: "Legendary", new: true,
    roll: "High Tension String / Helical Fletching / Archer's Tempo / Explosive Head",
    drop: "Black Armory reissue — Arena Ops",
    why: "Best Lightweight bow right now — Archer's Tempo + Explosive Head make it a dominant mid-range duelist." },
  { name: "Cataphract GL3", type: "Grenade Launcher", ammo: "Heavy", element: "Strand", rarity: "Legendary", new: false,
    roll: "Quick Launch / Proximity Grenades / Impulse Amplifier / Full Court",
    drop: "Trials of Osiris packages",
    why: "Best heavy in PvP — Proximity Grenades + Impulse Amplifier give forgiving one-shots off spawn." },
];

// ---------- Pantheon Titan DPS build ----------
const BUILD = {
  subclass: "Solar — Sunbreaker",
  super: "Burning Maul (with Pyrogale Gauntlets) — one massive Percussive Flames slam (~650% boosted). Your opening/closing burst each damage phase, not a roaming super.",
  exotic: { name: "Pyrogale Gauntlets", why: "Converts Burning Maul into a single giant slam + scorch shockwaves — post-Armor-3.0 it rivals/beats Cuirass Thundercrash for Solar single-target burst." },
  aspects: ["Sol Invictus — sunspots refund ability energy + Restoration, fueling a 2nd slam", "Consecration — slide-uppercut ignition slam for add damage and Roaring Flames stacking"],
  fragments: ["Ember of Ashes (more scorch → faster ignitions)", "Ember of Torches (powered melee → Radiant, +25% weapon damage)", "Ember of Empyrean (Solar kills extend Radiant/Restoration)", "Ember of Solace (longer Radiant/Restoration so the buff survives the phase)", "Ember of Singeing (ability kills speed class ability for barricade uptime)"],
  weapons: {
    primary: "Outbreak Perfected — fast Super generation (helps land a 2nd slam) + strong nanite DPS. Alt: Sunshot for scorch add-clear.",
    special: "Izanagi's Burden — Honed Edge 4x weaves a big hit between heavy reloads; kinetic so it surges separately.",
    heavy: "The Queenbreaker (MAIN DPS) — top sustained heavy boss DPS; Heresy catalyst grants Rewind Rounds so you rarely reload. Alt: Whisper of the Worm on long-range precision bosses.",
  },
  rotation: [
    "Pre-phase: build Super on adds (Consecration + Outbreak), get x3 Roaring Flames, go Radiant via powered melee.",
    "Apply a weaken to the boss (team Divinity or Tractor Cannon — no artifact debuff mod post-9.7.0).",
    "Open: slam Burning Maul (Pyrogale) into the boss with Radiant + weaken active.",
    "Swap to Queenbreaker and hold sustained crit fire (Rewind Rounds keeps the mag full); weave an Izanagi 4x shot on any lull.",
    "Walk through Sol Invictus sunspots to refund ability energy; Consecration adds to rebuild Super.",
    "Long phase? Fire a 2nd Burning Maul once Super returns, then resume Queenbreaker until the phase ends.",
    "Keep re-applying weaken and refresh Radiant via Solace/Empyrean throughout.",
  ],
  stats: "Armor 3.0: major in Super (faster/2nd slam) + Class (barricade/Restoration uptime); push Melee 100+ for the Consecration loop. Mods: surge x3 matched to your heavy (Arc for Queenbreaker, Solar for Whisper), Heavy/Special Ammo Finder + Scavenger, Melee-Kickstart/Heavy-Handed to refund melee.",
  alt: "Absolute top Titan burst right now is Prismatic/Arc Thundercrash + Cuirass of the Falling Star with a Bolt Charge setup — pop Thundercrash, Rally Barricade, fire heavy until Super returns.",
  notes: "Surge-match your heavy to the weekly surge. Queenbreaker needs an external weaken (Divinity/Tractor) post-9.7.0 and burns reserves fast — bring ammo economy. Use Whisper on long precision bosses; lead with the Pyrogale slam on short final-stand windows.",
};

const AMMO = ["Primary", "Special", "Heavy"];
const ELEMENTS = ["Kinetic", "Arc", "Solar", "Void", "Stasis", "Strand"];
const EL_VAR = { Kinetic: "var(--kinetic)", Arc: "var(--arc)", Solar: "var(--solar)", Void: "var(--void)", Stasis: "var(--stasis)", Strand: "var(--strand)" };
const MAINS = { Solar: "main", Void: "dabble", Stasis: "dabble" }; // jpesus mains Solar, dabbles Void/Stasis

const state = { mode: "PvE", ammo: "All", element: "All" };
const loadout = { Primary: null, Special: null, Heavy: null }; // stores weapon objects

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const activeWeapons = () => (state.mode === "PvE" ? WEAPONS_PVE : WEAPONS_PVP);

// ---------- Pantheon build render ----------
function renderBuild() {
  const b = BUILD;
  const li = (arr) => arr.map((x) => `<li>${esc(x)}</li>`).join("");
  $("#build").innerHTML =
    `<h2>🔱 Pantheon — Titan Boss-DPS Build</h2>` +
    `<div class="build-head">` +
      `<span class="build-sub">${esc(b.subclass)}</span>` +
      `<span class="build-exotic">⭐ ${esc(b.exotic.name)}</span>` +
    `</div>` +
    `<div class="build-grid">` +
      `<div class="bcol"><h4>Super</h4><p>${esc(b.super)}</p>` +
        `<h4>Exotic armor</h4><p>${esc(b.exotic.why)}</p>` +
        `<h4>Aspects</h4><ul>${li(b.aspects)}</ul>` +
        `<h4>Fragments</h4><ul>${li(b.fragments)}</ul></div>` +
      `<div class="bcol"><h4>Weapons</h4>` +
        `<p><span class="wkey">Primary</span> ${esc(b.weapons.primary)}</p>` +
        `<p><span class="wkey">Special</span> ${esc(b.weapons.special)}</p>` +
        `<p><span class="wkey">Heavy</span> ${esc(b.weapons.heavy)}</p>` +
        `<h4>Damage rotation</h4><ol>${li(b.rotation)}</ol></div>` +
    `</div>` +
    `<div class="build-foot">` +
      `<p><strong>Stats &amp; mods:</strong> ${esc(b.stats)}</p>` +
      `<p><strong>Top-DPS alt:</strong> ${esc(b.alt)}</p>` +
      `<p class="bnote">${esc(b.notes)}</p>` +
    `</div>`;
}

// ---------- filter chips ----------
function mkChip(label, group, value, opts = {}) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "chip";
  b.innerHTML = label;
  b.dataset.group = group;
  b.dataset.value = value;
  if (opts.element) { b.dataset.element = value; b.style.setProperty("--accent", EL_VAR[value]); }
  b.setAttribute("aria-pressed", String(state[group] === value));
  b.addEventListener("click", () => {
    state[group] = value;
    document.querySelectorAll(`.chip[data-group="${group}"]`).forEach((c) =>
      c.setAttribute("aria-pressed", String(c.dataset.value === value)));
    render();
  });
  return b;
}
function buildChips() {
  ["PvE", "PvP"].forEach((m) => $("#modeFilter").appendChild(mkChip(m, "mode", m)));
  ["All", ...AMMO].forEach((a) => $("#ammoFilter").appendChild(mkChip(a, "ammo", a)));
  $("#elementFilter").appendChild(mkChip("All", "element", "All"));
  $("#elementFilter").appendChild(mkChip("⭐ My mains", "element", "Mains"));
  ELEMENTS.forEach((e) => $("#elementFilter").appendChild(mkChip(e, "element", e, { element: true })));
}

// ---------- weapon card ----------
function card(w) {
  const equipped = loadout[w.ammo] === w;
  const isMine = MAINS[w.element];
  const el = document.createElement("div");
  el.className = "wcard" + (isMine ? " mine" : "");
  el.style.setProperty("--el", EL_VAR[w.element]);
  el.innerHTML =
    `<div class="wcard-top">` +
      `<div><div class="wname">${isMine ? "⭐ " : ""}${esc(w.name)}</div><div class="wtype">${esc(w.type)}</div></div>` +
      `<div class="badges">` +
        (w.new ? `<span class="badge new">NEW</span>` : "") +
        `<span class="badge el">${esc(w.element)}</span>` +
        `<span class="badge ${w.rarity === "Exotic" ? "exotic" : "legendary"}">${esc(w.rarity)}</span>` +
      `</div></div>` +
    `<div class="roll"><span class="k">${state.mode} god roll</span><span class="v">${esc(w.roll)}</span></div>` +
    `<div class="drop"><span class="pin">📍</span> ${esc(w.drop)}</div>` +
    `<div class="why">${esc(w.why)}</div>` +
    `<button type="button" class="equip-btn${equipped ? " equipped" : ""}">${equipped ? "✓ Equipped" : `Equip as ${w.ammo}`}</button>`;
  el.querySelector(".equip-btn").addEventListener("click", () => {
    loadout[w.ammo] = loadout[w.ammo] === w ? null : w;
    renderLoadout();
    render();
  });
  return el;
}

// ---------- armory ----------
function render() {
  const armory = $("#armory");
  armory.innerHTML = "";
  const matchEl = (w) =>
    state.element === "All" ||
    (state.element === "Mains" ? !!MAINS[w.element] : w.element === state.element);
  let shown = 0;
  AMMO.forEach((ammo) => {
    if (state.ammo !== "All" && state.ammo !== ammo) return;
    const list = activeWeapons().filter((w) => w.ammo === ammo && matchEl(w));
    if (!list.length) return;
    shown += list.length;
    const block = document.createElement("section");
    block.className = "ammo-block";
    block.innerHTML = `<h3>${ammo} <span class="ammo-tag">· ${list.length} weapon${list.length === 1 ? "" : "s"}</span></h3>`;
    const grid = document.createElement("div");
    grid.className = "card-grid";
    list.forEach((w) => grid.appendChild(card(w)));
    block.appendChild(grid);
    armory.appendChild(block);
  });
  if (!shown) armory.innerHTML = `<p class="empty-note">No ${state.mode} weapons match that filter.</p>`;
  $("#count").textContent = `${shown} ${state.mode} weapon${shown === 1 ? "" : "s"} shown`;
}

// ---------- loadout ----------
function renderLoadout() {
  const slots = $("#slots");
  slots.innerHTML = "";
  AMMO.forEach((ammo) => {
    const w = loadout[ammo];
    const div = document.createElement("div");
    div.className = "slot" + (w ? " filled" : "");
    if (w) div.style.setProperty("border-color", EL_VAR[w.element]);
    div.innerHTML = w
      ? `<span class="slot-label">${ammo}</span>` +
        `<span class="slot-weapon" style="color:${EL_VAR[w.element]}">${esc(w.name)}</span>` +
        `<span class="slot-meta">${esc(w.element)} · ${esc(w.type)}</span>`
      : `<span class="slot-label">${ammo}</span><span class="slot-empty">— pick a weapon —</span>`;
    slots.appendChild(div);
  });
}

// ---------- init ----------
$("#clearLoadout").addEventListener("click", () => {
  loadout.Primary = loadout.Special = loadout.Heavy = null;
  renderLoadout();
  render();
});
renderBuild();
buildChips();
renderLoadout();
render();
