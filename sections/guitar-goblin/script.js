// Father's Day Raid Night — availability + raid-preference poll.
// Pure client-side; responses persist in this browser's localStorage.

// ---- The ten currently-available raids (live list from the d2 toolkit) ----
const RAIDS = [
  { id: "crotas-end",          name: "Crota's End",        emoji: "🗡️", accent: "#79b85a",
    flavor: "Light the lamps, drop the sword, kill the son of Oryx." },
  { id: "deep-stone-crypt",    name: "Deep Stone Crypt",   emoji: "❄️", accent: "#6fc6e6",
    flavor: "Suit up, Guardian — the crypt runs cold." },
  { id: "garden-of-salvation", name: "Garden of Salvation",emoji: "🌿", accent: "#a6d84a",
    flavor: "Tether the motes. Don't get greedy." },
  { id: "kings-fall",          name: "King's Fall",        emoji: "👑", accent: "#e0b94a",
    flavor: "We've come for you, Oryx." },
  { id: "last-wish",           name: "Last Wish",          emoji: "🐉", accent: "#9d6cf0",
    flavor: "Make the wish... or don't. Riven's waiting." },
  { id: "root-of-nightmares",  name: "Root of Nightmares", emoji: "🌹", accent: "#ff5c8a",
    flavor: "Photosynthesis, baby. Plug in and burn Nezarec." },
  { id: "salvations-edge",     name: "Salvation's Edge",   emoji: "🔺", accent: "#d9c6ff",
    flavor: "Shapes, shapes, and the Witness at the end." },
  { id: "the-desert-perpetual",name: "The Desert Perpetual",emoji: "⏳", accent: "#e89a4f",
    flavor: "Time's a flat circle. Koregos at the end of it." },
  { id: "vault-of-glass",      name: "Vault of Glass",     emoji: "🔱", accent: "#34d6c6",
    flavor: "Form up, hold the relic, no one left behind in time." },
  { id: "vow-of-the-disciple", name: "Vow of the Disciple",emoji: "🪱", accent: "#46c08a",
    flavor: "Read the symbols. Send Rhulk back to the deep." },
];

// ---- Raids of the week (bonus loot) — EDIT THIS LINE to match the live rotator.
// Verified via web search for the week of June 16-23, 2026 (Tue reset).
// (The Desert Perpetual is also "always featured" — add "the-desert-perpetual" to glow it too.)
const RAIDS_OF_THE_WEEK = ["kings-fall", "garden-of-salvation"];

const STORE_KEY = "gg-raidnight-v1";
const ME_KEY = "gg-raidnight-me";

const $ = (sel) => document.querySelector(sel);

// ---------- music player ----------
const audio = $("#audio");
const player = $("#player");
$("#playToggle").addEventListener("click", () => {
  if (audio.paused) {
    audio.play().then(() => player.classList.add("playing")).catch(() => {});
  } else {
    audio.pause();
    player.classList.remove("playing");
  }
});
audio.addEventListener("pause", () => player.classList.remove("playing"));
audio.addEventListener("play", () => player.classList.add("playing"));

// ---------- raid buttons ----------
const selected = new Set();
const raidGrid = $("#raidGrid");
RAIDS.forEach((r) => {
  const isRotator = RAIDS_OF_THE_WEEK.includes(r.id);
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "raid-btn" + (isRotator ? " rotator" : "");
  btn.style.setProperty("--accent", r.accent);
  btn.dataset.id = r.id;
  btn.setAttribute("aria-pressed", "false");
  btn.innerHTML =
    `<span class="r-check">✓</span>` +
    `<span class="r-top"><span class="r-emoji">${r.emoji}</span>` +
    `<span class="r-name">${r.name}</span></span>` +
    `<span class="r-flavor">${r.flavor}</span>`;
  btn.addEventListener("click", () => {
    const on = btn.getAttribute("aria-pressed") === "true";
    btn.setAttribute("aria-pressed", on ? "false" : "true");
    if (on) selected.delete(r.id); else selected.add(r.id);
  });
  raidGrid.appendChild(btn);
});

// ---------- availability gating ----------
const raidsField = $("#raidsField");
const notesField = $("#notesField");
document.querySelectorAll('input[name="status"]').forEach((radio) => {
  radio.addEventListener("change", () => {
    const show = radio.value === "in" || radio.value === "maybe";
    raidsField.hidden = !show;
    notesField.hidden = !show;
  });
});

// ---------- storage ----------
// Shared store via /api/votes; localStorage is a cache + offline fallback so
// the page still works if the store isn't connected yet.
const API = "/api/votes";
let RESPONSES = [];

function cacheLocal() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify({ responses: RESPONSES })); } catch {}
}
function loadLocal() {
  try {
    const data = JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
    RESPONSES = Array.isArray(data.responses) ? data.responses : [];
  } catch { RESPONSES = []; }
}

async function pull() {
  try {
    const r = await fetch(API, { cache: "no-store" });
    if (!r.ok) throw new Error("status " + r.status);
    const j = await r.json();
    RESPONSES = Array.isArray(j.responses) ? j.responses : [];
    cacheLocal();
    return true;
  } catch {
    loadLocal();
    return false;
  }
}

async function push(entry) {
  try {
    const r = await fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(entry),
    });
    if (!r.ok) throw new Error("status " + r.status);
    const j = await r.json();
    RESPONSES = Array.isArray(j.responses) ? j.responses : RESPONSES;
    cacheLocal();
    return true;
  } catch {
    const i = RESPONSES.findIndex((x) => x.name.toLowerCase() === entry.name.toLowerCase());
    if (i >= 0) RESPONSES[i] = entry; else RESPONSES.push(entry);
    cacheLocal();
    return false;
  }
}

// ---------- submit ----------
const submitBtn = $("#submit");
$("#poll").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = $("#name").value.trim();
  const status = (document.querySelector('input[name="status"]:checked') || {}).value;
  if (!name || !status) return;
  const raids = status === "out" ? [] : [...selected];
  const notes = status === "out" ? "" : $("#notes").value.trim();
  const entry = { name, status, raids, notes };

  submitBtn.disabled = true;
  const label = submitBtn.textContent;
  submitBtn.textContent = "Locking in…";
  await push(entry);
  localStorage.setItem(ME_KEY, name);
  submitBtn.disabled = false;
  submitBtn.textContent = label;

  $("#poll").hidden = true;
  renderResults();
});

// ---------- edit ----------
$("#editBtn").addEventListener("click", () => {
  $("#results").hidden = true;
  $("#poll").hidden = false;
  $("#name").focus();
});

// ---------- results ----------
function renderResults() {
  const responses = RESPONSES;
  const results = $("#results");
  if (!responses.length) { results.hidden = true; return; }
  results.hidden = false;

  const order = { in: 0, maybe: 1, out: 2 };
  const sorted = [...responses].sort((a, b) => order[a.status] - order[b.status]);
  const label = { in: "In", maybe: "Maybe", out: "Out" };

  $("#roster").innerHTML = sorted.map((r) => {
    const picks = r.raids
      .map((id) => RAIDS.find((x) => x.id === id))
      .filter(Boolean);
    let detail = "";
    if (r.status === "out") detail = "can't make it";
    else if (picks.length) detail = picks.map((p) => p.emoji).join(" ");
    else detail = "no raid picked yet";
    if (r.notes) detail += ` · ${r.notes}`;
    return `<div class="roster-row">` +
      `<span class="roster-dot ${r.status}"></span>` +
      `<span class="roster-name">${escapeHtml(r.name)}</span>` +
      `<span class="roster-detail">${escapeHtml(detail)}</span>` +
      `</div>`;
  }).join("");

  // leaderboard: tally raid picks among people who are in/maybe
  const tally = {};
  responses.forEach((r) => r.raids.forEach((id) => { tally[id] = (tally[id] || 0) + 1; }));
  const ranked = RAIDS
    .map((r) => ({ ...r, count: tally[r.id] || 0 }))
    .sort((a, b) => b.count - a.count);
  const max = Math.max(1, ...ranked.map((r) => r.count));
  const topCount = ranked[0].count;

  const lb = $("#leaderboard");
  if (topCount === 0) {
    lb.innerHTML = `<p class="empty-line">No raid votes yet — pick your poison above.</p>`;
  } else {
    lb.innerHTML = ranked.filter((r) => r.count > 0).map((r) => {
      const pct = Math.round((r.count / max) * 100);
      const winner = r.count === topCount ? " winner" : "";
      return `<div class="lb-row${winner}">` +
        `<span class="lb-label">${r.emoji} ${escapeHtml(r.name)}</span>` +
        `<span class="lb-bar-wrap"><span class="lb-bar" style="width:${pct}%;background:${r.accent}"></span></span>` +
        `<span class="lb-count">${r.count}</span>` +
        `</div>`;
    }).join("");
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ---------- autoplay ----------
// Try to start the track immediately; browsers block unmuted autoplay until the
// user interacts, so fall back to kicking it off on the first click/keypress.
function tryPlay() {
  return audio.play().then(() => player.classList.add("playing"));
}
function setupAutoplay() {
  tryPlay().catch(() => {
    const kick = (e) => {
      // if they clicked the play button, let its own handler do the toggling
      if (e && e.target.closest && e.target.closest("#playToggle")) { cleanup(); return; }
      tryPlay().catch(() => {});
      cleanup();
    };
    function cleanup() {
      document.removeEventListener("pointerdown", kick);
      document.removeEventListener("keydown", kick);
    }
    document.addEventListener("pointerdown", kick);
    document.addEventListener("keydown", kick);
  });
}

// ---------- init ----------
(async function init() {
  const me = localStorage.getItem(ME_KEY);
  if (me) $("#name").value = me;
  await pull();
  if (RESPONSES.length) renderResults();
  setupAutoplay();
})();
