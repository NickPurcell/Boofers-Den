// jpesus's corner — Destiny 2 PvE god-roll armory + loadout builder.
// Data: current meta via web search, with rolls & drop sources verified against
// the d2 toolkit (June 2026). Edit WEAPONS to add/adjust picks.

const WEAPONS = [
  // ---------- PRIMARY ----------
  { name: "Fatebringer", type: "Hand Cannon", ammo: "Primary", element: "Kinetic", rarity: "Legendary",
    roll: "Fluted Barrel / Appended Mag / Explosive Payload / Firefly",
    drop: "Vault of Glass raid",
    why: "Explosive Payload + Firefly chain explosions — the benchmark Kinetic add-clear hand cannon." },
  { name: "Sunshot", type: "Hand Cannon", ammo: "Primary", element: "Solar", rarity: "Exotic",
    roll: "Catalyst: +Range/Stability, spawns Orbs; perk Sun Blast — explosive scorching rounds",
    drop: "Exotic engrams / rare world drop",
    why: "Sun Blast detonations chain across packs — top Solar add-clear primary." },
  { name: "Riskrunner", type: "Submachine Gun", ammo: "Primary", element: "Arc", rarity: "Exotic",
    roll: "Catalyst: A Spark of Hope quest (+Range, Masterwork); perk Arc Conductor chain lightning",
    drop: "Exotic engrams / rare world drop",
    why: "Self-sustaining chain lightning that also tanks incoming Arc damage." },
  { name: "Graviton Lance", type: "Pulse Rifle", ammo: "Primary", element: "Void", rarity: "Exotic",
    roll: "Catalyst: Vorpal + Turnabout, +Range/AA; perk Cosmology — kills detonate into tracking Void rounds",
    drop: "Exotic engrams / rare world drop",
    why: "Cosmology detonations clear rooms; Vorpal adds boss damage." },
  { name: "Wicked Implement", type: "Scout Rifle", ammo: "Primary", element: "Stasis", rarity: "Exotic",
    roll: "Catalyst: Hadopelagic Tribute (shards overflow mag); perks Creeping Attrition + Tithing Harvest",
    drop: "Exotic mission (Season of the Deep); catalyst: Deep Dive Tier 7 chest",
    why: "Built-in slow/freeze, self-reloading, handles all three champion types." },
  { name: "Final Warning", type: "Sidearm", ammo: "Primary", element: "Strand", rarity: "Exotic",
    roll: "Catalyst: String Theory (+dmg vs marked, ammo refund); perk Pick Your Poison tracking burst",
    drop: "'The Final Strand' Exotic quest",
    why: "Tracking burst rounds that melt marked enemies — top Strand primary." },
  { name: "Ammit AR2", type: "Auto Rifle", ammo: "Primary", element: "Solar", rarity: "Legendary",
    roll: "Smallbore / Appended Mag / Stats for All / Incandescent",
    drop: "Legendary engrams / world drop",
    why: "Stats for All + Incandescent anchors Solar scorch/ignition add-clear." },
  { name: "Elsie's Rifle", type: "Pulse Rifle", ammo: "Primary", element: "Void", rarity: "Legendary",
    roll: "Arrowhead Brake / Appended Mag / Repulsor Brace / Destabilizing Rounds",
    drop: "Into the Light (BRAVE arsenal)",
    why: "Spreads Volatile and feeds overshields — a self-sustaining Void loop." },

  // ---------- SPECIAL ----------
  { name: "Witherhoard", type: "Grenade Launcher", ammo: "Special", element: "Kinetic", rarity: "Exotic",
    roll: "Catalyst: The Bank Job (auto-reloads holstered); perk Break the Bank blight DoT",
    drop: "Exotic Archive, Tower",
    why: "Passive damage-over-time while you swap weapons — unmatched DPS uptime." },
  { name: "The Fourth Horseman", type: "Shotgun", ammo: "Special", element: "Arc", rarity: "Exotic",
    roll: "Catalyst: And its name was Death (+1 round, faster reload); perk Thunderer full-auto",
    drop: "Exotic Archive, Tower",
    why: "Highest sustained shotgun DPS for short-range boss damage." },
  { name: "Far Future", type: "Sniper Rifle", ammo: "Special", element: "Solar", rarity: "Legendary",
    roll: "Hammer-Forged Rifling / Tactical Mag / Auto-Loading Holster / Frenzy",
    drop: "Battlegrounds reward",
    why: "Frenzy damage buff + Auto-Loading Holster = low-maintenance precision DPS." },
  { name: "Slayer's Fang", type: "Shotgun", ammo: "Special", element: "Void", rarity: "Exotic",
    roll: "Catalyst: Repulsor Brace Refit (overshield on Void-debuff kills); perk Heart Piercer",
    drop: "Revenant Fortress (Episode: Revenant)",
    why: "Weakening submunitions + overshields — a survivable Champion-stunning slug." },
  { name: "Riptide", type: "Fusion Rifle", ammo: "Special", element: "Stasis", rarity: "Legendary",
    roll: "Fluted Barrel / Enhanced Battery / Auto-Loading Holster / Chill Clip",
    drop: "World / Crucible / Vanguard / Nightfall (random rolls)",
    why: "Chill Clip slows and freezes — premier Overload-stunning special weapon." },
  { name: "Refusal of the Call", type: "Glaive", ammo: "Special", element: "Strand", rarity: "Legendary",
    roll: "Ballistic Tuning / Swap Mag / Discord / Sword Logic",
    drop: "The Pale Heart / The Final Shape activities",
    why: "Discord refunds ammo to fuel Sword Logic's escalating damage stacks." },
  { name: "Forbearance", type: "Grenade Launcher", ammo: "Special", element: "Arc", rarity: "Legendary",
    roll: "Quick Launch / Implosion Rounds / Ambitious Assassin / Chain Reaction",
    drop: "Vow of the Disciple raid / Onslaught",
    why: "Wave-frame: Ambitious Assassin overfills, Chain Reaction chains — top add-clear." },
  { name: "The Supremacy", type: "Sniper Rifle", ammo: "Special", element: "Kinetic", rarity: "Legendary",
    roll: "Polygonal Rifling / Appended Mag / Rewind Rounds / Fourth Time's the Charm",
    drop: "Last Wish raid (craftable)",
    why: "Rewind Rounds + FTTC loop crit shots into the mag for zero-downtime DPS." },

  // ---------- HEAVY ----------
  { name: "Gjallarhorn", type: "Rocket Launcher", ammo: "Heavy", element: "Solar", rarity: "Exotic",
    roll: "Catalyst: More Wolves (+1 rocket, extra Wolfpack Rounds); perk Wolfpack Rounds",
    drop: "'And Out Fly the Wolves' Exotic quest",
    why: "Massive AoE plus a fireteam-wide buff that makes everyone's rockets hit harder." },
  { name: "Cataclysmic", type: "Linear Fusion Rifle", ammo: "Heavy", element: "Solar", rarity: "Legendary",
    roll: "Arrowhead Brake / Enhanced Battery / Fourth Time's the Charm / Bait and Switch",
    drop: "Vow of the Disciple raid (craftable)",
    why: "Craftable linear that reaches top-tier sustained boss DPS with Bait and Switch." },
  { name: "The Hothead", type: "Rocket Launcher", ammo: "Heavy", element: "Arc", rarity: "Legendary",
    roll: "Quick Launch / Impact Casing / Reconstruction / Bait and Switch",
    drop: "Altars of Sorrow (Moon)",
    why: "Reconstruction auto-fills the mag; Bait and Switch stacks a huge burst boost." },
  { name: "Edge Transit", type: "Grenade Launcher", ammo: "Heavy", element: "Void", rarity: "Legendary",
    roll: "Quick Launch / Spike Grenades / Envious Assassin / Bait and Switch",
    drop: "Into the Light / Collections",
    why: "Envious Assassin overfills for a long Bait and Switch dump — add-clear AND DPS." },
  { name: "Cold Comfort", type: "Rocket Launcher", ammo: "Heavy", element: "Stasis", rarity: "Legendary",
    roll: "Quick Launch / Black Powder / Reconstruction / Bait and Switch",
    drop: "Ghosts of the Deep dungeon",
    why: "Aggressive Frame that loads up to four shots — huge single-mag Stasis DPS." },
  { name: "Scintillation", type: "Linear Fusion Rifle", ammo: "Heavy", element: "Strand", rarity: "Legendary",
    roll: "Arrowhead Brake / Ionized Battery / Rewind Rounds / Bait and Switch",
    drop: "Nightfall reward",
    why: "Rewind Rounds sustains a Bait and Switch DPS window longer than most linears." },
  { name: "Two-Tailed Fox", type: "Rocket Launcher", ammo: "Heavy", element: "Void", rarity: "Exotic",
    roll: "Catalyst: Third Tail (adds Arc rocket that Jolts); fires Solar + Void per shot",
    drop: "Exotic engrams / rare world drop",
    why: "Stacks Scorch, Weaken (and Jolt) per shot — debuffer and burst DPS in one." },
  { name: "Grand Overture", type: "Machine Gun", ammo: "Heavy", element: "Arc", rarity: "Exotic",
    roll: "Catalyst: Get Up Quick (+Stability/Handling, blinding missiles); perk Omega Strike banked missiles",
    drop: "'Heavy Does It' Exotic quest (Gunsmith)",
    why: "Banks micro-missiles into a devastating volley; great add-clear and major-blinding." },
];

const AMMO = ["Primary", "Special", "Heavy"];
const ELEMENTS = ["Kinetic", "Arc", "Solar", "Void", "Stasis", "Strand"];
const EL_VAR = {
  Kinetic: "var(--kinetic)", Arc: "var(--arc)", Solar: "var(--solar)",
  Void: "var(--void)", Stasis: "var(--stasis)", Strand: "var(--strand)",
};

const state = { ammo: "All", element: "All" };
const loadout = { Primary: null, Special: null, Heavy: null };

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const byName = (n) => WEAPONS.find((w) => w.name === n);

// ---------- filter chips ----------
function buildChips() {
  const ammoWrap = $("#ammoFilter");
  const elWrap = $("#elementFilter");
  const mkChip = (label, group, value, isEl) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chip";
    b.textContent = label;
    b.dataset.group = group;
    b.dataset.value = value;
    if (isEl && value !== "All") {
      b.dataset.element = value;
      b.style.setProperty("--accent", EL_VAR[value]);
    }
    b.setAttribute("aria-pressed", String(state[group] === value));
    b.addEventListener("click", () => {
      state[group] = value;
      document.querySelectorAll(`.chip[data-group="${group}"]`).forEach((c) =>
        c.setAttribute("aria-pressed", String(c.dataset.value === value)));
      render();
    });
    return b;
  };
  ["All", ...AMMO].forEach((a) => ammoWrap.appendChild(mkChip(a, "ammo", a, false)));
  ["All", ...ELEMENTS].forEach((e) => elWrap.appendChild(mkChip(e, "element", e, true)));
}

// ---------- weapon card ----------
function card(w) {
  const equipped = loadout[w.ammo] === w.name;
  const el = document.createElement("div");
  el.className = "wcard";
  el.style.setProperty("--el", EL_VAR[w.element]);
  el.innerHTML =
    `<div class="wcard-top">` +
      `<div><div class="wname">${esc(w.name)}</div><div class="wtype">${esc(w.type)}</div></div>` +
      `<div class="badges">` +
        `<span class="badge el">${esc(w.element)}</span>` +
        `<span class="badge ${w.rarity === "Exotic" ? "exotic" : "legendary"}">${w.rarity === "Exotic" ? "Exotic" : "Legendary"}</span>` +
      `</div>` +
    `</div>` +
    `<div class="roll"><span class="k">God roll</span><span class="v">${esc(w.roll)}</span></div>` +
    `<div class="drop"><span class="pin">📍</span> ${esc(w.drop)}</div>` +
    `<div class="why">${esc(w.why)}</div>` +
    `<button type="button" class="equip-btn${equipped ? " equipped" : ""}">${equipped ? "✓ Equipped" : `Equip as ${w.ammo}`}</button>`;
  el.querySelector(".equip-btn").addEventListener("click", () => {
    loadout[w.ammo] = loadout[w.ammo] === w.name ? null : w.name;
    renderLoadout();
    render();
  });
  return el;
}

// ---------- armory ----------
function render() {
  const armory = $("#armory");
  armory.innerHTML = "";
  let shown = 0;
  AMMO.forEach((ammo) => {
    if (state.ammo !== "All" && state.ammo !== ammo) return;
    const list = WEAPONS.filter((w) =>
      w.ammo === ammo && (state.element === "All" || w.element === state.element));
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
  if (!shown) armory.innerHTML = `<p class="empty-note">No weapons match that filter.</p>`;
  $("#count").textContent = `${shown} weapon${shown === 1 ? "" : "s"} shown`;
}

// ---------- loadout ----------
function renderLoadout() {
  const slots = $("#slots");
  slots.innerHTML = "";
  AMMO.forEach((ammo) => {
    const w = loadout[ammo] ? byName(loadout[ammo]) : null;
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
buildChips();
renderLoadout();
render();
