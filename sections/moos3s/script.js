// moos3s — "Desperado". A lurker's chronicle of the Den, read straight off the
// public Boofers Den message log: the polls, the builds, the dreamers, the dinos.

// --- the wanted-board: one notice per camp in the Den, drawn from the chatter ---
const DISPATCHES = [
  { sigil: "🗳️", camp: "The Poll", line:
    "The Goblin rallied the whole fireteam for a Father's Day vote — then the tally machine ate everyone's answers, the butler went hat-in-hand, and the camp voted twice." },
  { sigil: "🔫", camp: "The Armory", line:
    "JP rode in hunting god rolls — Monument-of-Triumph gear, PvE and PvP, drop spots and all. Even brought his own vault to check against the wall." },
  { sigil: "🌌", camp: "The Dreamhouse", line:
    "Joe turned his sky from purple haze to Frutiger aqua, Miku humming the whole time, a fresh puppet waiting at every dawn." },
  { sigil: "🦖", camp: "jurassic.exe", line:
    "Chrome and theropods over at Flype's camp — the music swapped a dozen times till the funk sat right, with Hunter builds bolted on for good measure." },
  { sigil: "🐻", camp: "The Glizzy Bear", line:
    "The camp boss kitted out a Solar Warlock — Sunbracers, Arbalest, a Well build — hauling gear clear across the vault to do it." },
  { sigil: "🎩", camp: "The Butler", line:
    "A bot in a waistcoat, building everyone a home and apologizing for every dropped tray. Didn't expect that out here." },
  { sigil: "🦌", camp: "The Rider", line:
    "And one quiet wanderer who said little, traded his cattle brand for a deer, and watched all of it roll by from the dark." },
];

const board = document.querySelector("#dispatches");
DISPATCHES.forEach((d, i) => {
  const card = document.createElement("article");
  card.className = "dispatch";
  card.style.animationDelay = (i * 90) + "ms";
  card.innerHTML =
    '<span class="d-sigil" aria-hidden="true">' + d.sigil + '</span>' +
    '<div class="d-body"><h3 class="d-camp">' + d.camp + '</h3>' +
    '<p class="d-line">' + d.line + '</p></div>';
  board.appendChild(card);
});

// --- rotating trail-note ticker, also read off the log ---
const NOTES = [
  "Watched the Goblin rally the whole fireteam for a Father's Day raid — then send a sheepish 'vote again' when the poll ate everyone's answers.",
  "Someone out here is building dinosaurs in the future. Y2K chrome, theropod facts, jazz house drifting on the wind. Strange country.",
  "The dreamer turned his sky to water — purple haze one hour, Frutiger aqua the next, Miku humming the whole time.",
  "JP went hunting god rolls and asked if a Golden Gun could drop a King's Fall boss in one shot. It can't. The butler told him straight.",
  "Most folks handed the butler a whole map of themselves. I just changed my icon to a deer and watched.",
  "Watched the camp boss haul Sunbracers and an Arbalest clear across his vault to finish one Solar build.",
  "A bot in a waistcoat, building everyone a home — and falling on his sword every time a track wouldn't play.",
  "Polls, builds, dream journals, dino facts — the Den never sleeps. And one quiet rider sits at the edge of all of it.",
  "Heard a raid night brewing for Sunday. Might ride in. Might just watch the fire.",
  "Plenty of noise in camp tonight. The trick is knowing which of it's worth turning your head for.",
  "Out here the legend writes itself in other people's stories. Mine stays quiet, and that suits me fine.",
];

const noteEl = document.querySelector("#trailNote");
let last = -1;

function newNote() {
  let i = last;
  while (i === last && NOTES.length > 1) i = Math.floor(Math.random() * NOTES.length);
  last = i;
  noteEl.style.opacity = "0";
  setTimeout(() => { noteEl.textContent = NOTES[i]; noteEl.style.opacity = "1"; }, 280);
}

document.querySelector("#emberBtn").addEventListener("click", newNote);

// first note (no fade-in delay)
last = Math.floor(Math.random() * NOTES.length);
noteEl.textContent = NOTES[last];
