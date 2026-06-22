// moos3s — "Desperado". A rotating trail note for the lone wanderer.
const NOTES = [
  "The fences don't ride themselves. But tonight, they can wait.",
  "Out here, the only thing that follows you is your own dust.",
  "A deer at the treeline. It watched a while, then let me pass.",
  "The sun's gone down on better men. It comes up on us all the same.",
  "Miles behind, miles ahead, and a quiet that suits you fine.",
  "Some folks chase the herd. You'd rather know where the river bends.",
  "The fire's low, the coffee's cold, and the stars don't mind the company.",
  "You weren't running from anything. You were just riding toward.",
  "No town for a hundred miles. Felt about right.",
  "Even a wanderer keeps one trail he never tells a soul about.",
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
