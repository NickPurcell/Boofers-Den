// jpesus's corner — Destiny 2 god-roll armory (PvE + PvP) + Titan Pantheon DPS build.
// Data: current meta via web search, rolls & drop sources verified against the
// d2 toolkit (June 2026). Edit the arrays/objects below to add or adjust picks.

// ---------- PvE rolls ----------
const WEAPONS_PVE = [
  // PRIMARY
  { name: "Fatebringer", type: "Hand Cannon", ammo: "Primary", element: "Kinetic", rarity: "Legendary",
    roll: "Fluted Barrel / Appended Mag / Explosive Payload / Firefly", drop: "Vault of Glass raid",
    why: "Explosive Payload + Firefly chain explosions — the benchmark Kinetic add-clear hand cannon." },
  { name: "Sunshot", type: "Hand Cannon", ammo: "Primary", element: "Solar", rarity: "Exotic",
    roll: "Catalyst: +Range/Stability, spawns Orbs; perk Sun Blast — explosive scorching rounds", drop: "Exotic engrams / rare world drop",
    why: "Sun Blast detonations chain across packs — top Solar add-clear primary." },
  { name: "Riskrunner", type: "Submachine Gun", ammo: "Primary", element: "Arc", rarity: "Exotic",
    roll: "Catalyst: A Spark of Hope quest (+Range, MW); perk Arc Conductor chain lightning", drop: "Exotic engrams / rare world drop",
    why: "Self-sustaining chain lightning that also tanks incoming Arc damage." },
  { name: "Graviton Lance", type: "Pulse Rifle", ammo: "Primary", element: "Void", rarity: "Exotic",
    roll: "Catalyst: Vorpal + Turnabout, +Range/AA; perk Cosmology — kills detonate into tracking Void rounds", drop: "Exotic engrams / rare world drop",
    why: "Cosmology detonations clear rooms; Vorpal adds boss damage." },
  { name: "Wicked Implement", type: "Scout Rifle", ammo: "Primary", element: "Stasis", rarity: "Exotic",
    roll: "Catalyst: Hadopelagic Tribute; perks Creeping Attrition + Tithing Harvest", drop: "Exotic mission (Season of the Deep); catalyst: Deep Dive T7 chest",
    why: "Built-in slow/freeze, self-reloading, handles all three champion types." },
  { name: "Final Warning", type: "Sidearm", ammo: "Primary", element: "Strand", rarity: "Exotic",
    roll: "Catalyst: String Theory (+dmg vs marked, ammo refund); perk Pick Your Poison tracking burst", drop: "'The Final Strand' Exotic quest",
    why: "Tracking burst rounds that melt marked enemies — top Strand primary." },
  { name: "Ammit AR2", type: "Auto Rifle", ammo: "Primary", element: "Solar", rarity: "Legendary",
    roll: "Smallbore / Appended Mag / Stats for All / Incandescent", drop: "Legendary engrams / world drop",
    why: "Stats for All + Incandescent anchors Solar scorch/ignition add-clear." },
  { name: "Elsie's Rifle", type: "Pulse Rifle", ammo: "Primary", element: "Void", rarity: "Legendary",
    roll: "Arrowhead Brake / Appended Mag / Repulsor Brace / Destabilizing Rounds", drop: "Into the Light (BRAVE arsenal)",
    why: "Spreads Volatile and feeds overshields — a self-sustaining Void loop." },
  // SPECIAL
  { name: "Witherhoard", type: "Grenade Launcher", ammo: "Special", element: "Kinetic", rarity: "Exotic",
    roll: "Catalyst: The Bank Job (auto-reloads holstered); perk Break the Bank blight DoT", drop: "Exotic Archive, Tower",
    why: "Passive damage-over-time while you swap weapons — unmatched DPS uptime." },
  { name: "The Fourth Horseman", type: "Shotgun", ammo: "Special", element: "Arc", rarity: "Exotic",
    roll: "Catalyst: And its name was Death (+1 round, faster reload); perk Thunderer full-auto", drop: "Exotic Archive, Tower",
    why: "Highest sustained shotgun DPS for short-range boss damage." },
  { name: "Far Future", type: "Sniper Rifle", ammo: "Special", element: "Solar", rarity: "Legendary",
    roll: "Hammer-Forged Rifling / Tactical Mag / Auto-Loading Holster / Frenzy", drop: "Battlegrounds reward",
    why: "Frenzy damage buff + Auto-Loading Holster = low-maintenance precision DPS." },
  { name: "Slayer's Fang", type: "Shotgun", ammo: "Special", element: "Void", rarity: "Exotic",
    roll: "Catalyst: Repulsor Brace Refit (overshield on Void-debuff kills); perk Heart Piercer", drop: "Revenant Fortress (Episode: Revenant)",
    why: "Weakening submunitions + overshields — a survivable Champion-stunning slug." },
  { name: "Riptide", type: "Fusion Rifle", ammo: "Special", element: "Stasis", rarity: "Legendary",
    roll: "Fluted Barrel / Enhanced Battery / Auto-Loading Holster / Chill Clip", drop: "World / Crucible / Vanguard / Nightfall (random rolls)",
    why: "Chill Clip slows and freezes — premier Overload-stunning special weapon." },
  { name: "Refusal of the Call", type: "Glaive", ammo: "Special", element: "Strand", rarity: "Legendary",
    roll: "Ballistic Tuning / Swap Mag / Discord / Sword Logic", drop: "The Pale Heart / The Final Shape activities",
    why: "Discord refunds ammo to fuel Sword Logic's escalating damage stacks." },
  { name: "Forbearance", type: "Grenade Launcher", ammo: "Special", element: "Arc", rarity: "Legendary",
    roll: "Quick Launch / Implosion Rounds / Ambitious Assassin / Chain Reaction", drop: "Vow of the Disciple raid / Onslaught",
    why: "Wave-frame: Ambitious Assassin overfills, Chain Reaction chains — top add-clear." },
  { name: "The Supremacy", type: "Sniper Rifle", ammo: "Special", element: "Kinetic", rarity: "Legendary",
    roll: "Polygonal Rifling / Appended Mag / Rewind Rounds / Fourth Time's the Charm", drop: "Last Wish raid (craftable)",
    why: "Rewind Rounds + FTTC loop crit shots into the mag for zero-downtime DPS." },
  // HEAVY
  { name: "Gjallarhorn", type: "Rocket Launcher", ammo: "Heavy", element: "Solar", rarity: "Exotic",
    roll: "Catalyst: More Wolves (+1 rocket, extra Wolfpack Rounds); perk Wolfpack Rounds", drop: "'And Out Fly the Wolves' Exotic quest",
    why: "Massive AoE plus a fireteam-wide buff that makes everyone's rockets hit harder." },
  { name: "Cataclysmic", type: "Linear Fusion Rifle", ammo: "Heavy", element: "Solar", rarity: "Legendary",
    roll: "Arrowhead Brake / Enhanced Battery / Fourth Time's the Charm / Bait and Switch", drop: "Vow of the Disciple raid (craftable)",
    why: "Craftable linear that reaches top-tier sustained boss DPS with Bait and Switch." },
  { name: "The Hothead", type: "Rocket Launcher", ammo: "Heavy", element: "Arc", rarity: "Legendary",
    roll: "Quick Launch / Impact Casing / Reconstruction / Bait and Switch", drop: "Altars of Sorrow (Moon)",
    why: "Reconstruction auto-fills the mag; Bait and Switch stacks a huge burst boost." },
  { name: "Edge Transit", type: "Grenade Launcher", ammo: "Heavy", element: "Void", rarity: "Legendary",
    roll: "Quick Launch / Spike Grenades / Envious Assassin / Bait and Switch", drop: "Into the Light / Collections",
    why: "Envious Assassin overfills for a long Bait and Switch dump — add-clear AND DPS." },
  { name: "Cold Comfort", type: "Rocket Launcher", ammo: "Heavy", element: "Stasis", rarity: "Legendary",
    roll: "Quick Launch / Black Powder / Reconstruction / Bait and Switch", drop: "Ghosts of the Deep dungeon",
    why: "Aggressive Frame that loads up to four shots — huge single-mag Stasis DPS." },
  { name: "Scintillation", type: "Linear Fusion Rifle", ammo: "Heavy", element: "Strand", rarity: "Legendary",
    roll: "Arrowhead Brake / Ionized Battery / Rewind Rounds / Bait and Switch", drop: "Nightfall reward",
    why: "Rewind Rounds sustains a Bait and Switch DPS window longer than most linears." },
  { name: "Two-Tailed Fox", type: "Rocket Launcher", ammo: "Heavy", element: "Void", rarity: "Exotic",
    roll: "Catalyst: Third Tail (adds Arc rocket that Jolts); fires Solar + Void per shot", drop: "Exotic engrams / rare world drop",
    why: "Stacks Scorch, Weaken (and Jolt) per shot — debuffer and burst DPS in one." },
  { name: "Grand Overture", type: "Machine Gun", ammo: "Heavy", element: "Arc", rarity: "Exotic",
    roll: "Catalyst: Get Up Quick (+Stability/Handling, blinding missiles); perk Omega Strike banked missiles", drop: "'Heavy Does It' Exotic quest (Gunsmith)",
    why: "Banks micro-missiles into a devastating volley; great add-clear and major-blinding." },
];

// ---------- PvP rolls ----------
const WEAPONS_PVP = [
  { name: "Eyasluna", type: "Hand Cannon", ammo: "Primary", element: "Stasis", rarity: "Legendary",
    roll: "SteadyHand HCS / Accurized Rounds / Rapid Hit / Moving Target", drop: "World / Crucible loot (random rolls)",
    why: "Best-feeling 140 RPM hand cannon — Rapid Hit consistency + Moving Target forgiveness." },
  { name: "Igneous Hammer", type: "Hand Cannon", ammo: "Primary", element: "Solar", rarity: "Legendary",
    roll: "Hammer-Forged Rifling / Accurized Rounds / Rapid Hit / Opening Shot", drop: "Trials of Osiris",
    why: "S-tier 120 RPM aggressive HC; Opening Shot maximizes opening-engagement range." },
  { name: "The Messenger", type: "Pulse Rifle", ammo: "Primary", element: "Kinetic", rarity: "Legendary",
    roll: "Hammer-Forged Rifling / High-Caliber Rounds / Rapid Hit / Desperado", drop: "Trials of Osiris (Adept at the Lighthouse)",
    why: "Premier high-impact pulse with two-burst lethality." },
  { name: "The Immortal", type: "Submachine Gun", ammo: "Primary", element: "Strand", rarity: "Legendary",
    roll: "Corkscrew Rifling / Ricochet Rounds / Rangefinder / Target Lock", drop: "Trials of Osiris",
    why: "Benchmark PvP SMG — Target Lock gives the fastest close-range TTK in the sandbox." },
  { name: "Unforgiven", type: "Submachine Gun", ammo: "Primary", element: "Void", rarity: "Legendary",
    roll: "Hammer-Forged Rifling / Ricochet Rounds / Tunnel Vision / Rampage", drop: "Duality dungeon",
    why: "720 RPM aggressive Void SMG; Tunnel Vision aim-assist + Rampage shred up close." },
  { name: "Ace of Spades", type: "Hand Cannon", ammo: "Primary", element: "Kinetic", rarity: "Exotic",
    roll: "Catalyst: Funeral Pyre (boosted Firefly during Memento Mori); key perk Memento Mori", drop: "Exotic Archive, Tower",
    why: "Memento Mori reloads high-damage rounds on a kill while keeping radar up — snowballs duels." },
  { name: "Eye of Sol", type: "Sniper Rifle", ammo: "Special", element: "Kinetic", rarity: "Legendary",
    roll: "Fluted Barrel / Ricochet Rounds / Moving Target / Opening Shot", drop: "Trials of Osiris (Adept when featured)",
    why: "Go-to Crucible sniper — pushes aim assist and range near max for reliable flicks." },
  { name: "Riptide", type: "Fusion Rifle", ammo: "Special", element: "Stasis", rarity: "Legendary",
    roll: "Arrowhead Brake / Projection Fuse / Under Pressure / Closing Time", drop: "Crucible (focus at Shaxx)",
    why: "Top special — Under Pressure + Closing Time max its stats on a near-empty mag for one-burst kills." },
  { name: "The Mountaintop", type: "Grenade Launcher", ammo: "Special", element: "Kinetic", rarity: "Legendary",
    roll: "Quick Launch / Spike Grenades / Impulse Amplifier / Vorpal Weapon", drop: "Onslaught",
    why: "Fast, flat-trajectory projectile sets up reliable swap kills." },
  { name: "Conditional Finality", type: "Shotgun", ammo: "Special", element: "Stasis", rarity: "Exotic",
    roll: "Catalyst: Monument of Triumph (+handling/reload); key perk Paracausal Pellets (freeze)", drop: "Root of Nightmares raid (Nezarec)",
    why: "Dual Stasis/Solar slug that freezes on a clean hit — denies any counterplay up close." },
  { name: "Cloudstrike", type: "Sniper Rifle", ammo: "Special", element: "Arc", rarity: "Exotic",
    roll: "Catalyst: adds Triple Tap + Handling; key perk Mortal Polarity (precision = lightning)", drop: "Empire Hunts (Europa)",
    why: "A body-shot can finish via the follow-up lightning bolt; Triple Tap keeps it firing." },
  { name: "The Chaperone", type: "Shotgun", ammo: "Special", element: "Kinetic", rarity: "Exotic",
    roll: "Intrinsic: The Roadborn (precision kills grant bonus damage, handling, slug accuracy)", drop: "Exotic Archive, Tower (Holliday's quest)",
    why: "Long-range slug that snipes Guardians across lanes; Roadborn snowballs after precision kills." },
  { name: "Falling Guillotine", type: "Sword", ammo: "Heavy", element: "Void", rarity: "Legendary",
    roll: "Jagged Edge / Swordmaster's Guard / Vorpal Weapon / Eager Edge", drop: "Into the Light",
    why: "Eager Edge gives an enormous lunge for gap-closing/movement; Vorpal punishes supers." },
  { name: "Cataphract GL3", type: "Grenade Launcher", ammo: "Heavy", element: "Strand", rarity: "Legendary",
    roll: "Quick Launch / High-Velocity Rounds / Impulse Amplifier / Vorpal Weapon", drop: "Trials of Osiris",
    why: "Best heavy in PvP — Impulse Amplifier + High-Velocity make its one-shot nearly undodgeable." },
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
