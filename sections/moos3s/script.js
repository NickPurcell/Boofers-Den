// moos3s — "Desperado". A portrait of the rider himself, read off his own tracks
// in the public Boofers Den log: the deer he chose, the way he asked, the patience.

// --- the ledger: Desperado's actual moments, pulled from the message log ---
const DISPATCHES = [
  { sigil: "🦌", camp: "Picked his own brand", line:
    "Asked for a deer — a dog as the backup — and rode off with the deer. The one thing the man was dead sure about." },
  { sigil: "👁️", camp: "Asked to be seen", line:
    "Didn't say 'build me a page.' Said 'read my messages and make one that matches me.' Not a request — a challenge. Figure me out." },
  { sigil: "🎯", camp: "Particular, not fussy", line:
    "Took care to say it plain — the public trail, not the private letters. A precise man who doesn't waste a word." },
  { sigil: "🤠", camp: "Waited like a gentleman", line:
    "Asked again, and again, and never once raised his voice. A patient rider gets where he's going all the same." },
  { sigil: "🌅", camp: "Watches more than he speaks", line:
    "While the camp built dino labs and dreamhouses and chased god rolls, the rider mostly watched — and missed nothing." },
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

// --- rotating one-liners, all about the rider ---
const NOTES = [
  "Turned down the dog and rode off on the deer. Knew his own mind, at least about that.",
  "Didn't say 'build me this.' Said 'read my tracks and tell me who I am.' Bold ask for a quiet man.",
  "Asked for his page more than once, and never once unkindly. Patience like that is its own kind of legend.",
  "Careful with his words — public trail, not private letters, he made sure to say. Precise rider.",
  "Said little while the camp roared around him. The trick of the lurker: hear everything, answer to nothing.",
  "His whole footprint in the Den: a deer, a few patient questions, and a steady gaze. Travels light, this one.",
  "Out here the legend writes itself in other people's stories. The rider keeps his own close, and that suits him fine.",
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
