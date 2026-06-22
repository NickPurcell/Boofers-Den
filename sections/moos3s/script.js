// moos3s — "Desperado". Dispatches from the Den, as the quiet rider watched it
// pass: stitched from the public Boofers Den channel chatter.
const NOTES = [
  "Watched the Goblin rally the whole fireteam for a Father's Day raid — then send a sheepish 'vote again' when the poll ate everyone's answers.",
  "Someone out here is building dinosaurs in the future. Y2K chrome, theropod facts, jazz drifting on the wind. Strange country.",
  "The dreamer turned her sky to water — purple haze one hour, Frutiger aqua the next, Miku humming the whole time.",
  "JP went hunting god rolls and asked if a Golden Gun could drop a King's Fall boss in one shot. It can't. The butler told him straight.",
  "Most folks handed the butler a whole map of themselves. I just changed my icon to a deer and watched.",
  "A bot in a waistcoat, building everyone a home. Didn't expect that out here.",
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
