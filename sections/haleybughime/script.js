// haley's dreamland — daily features, cassette player, and webcore trinkets.
// Daily picks rotate by calendar day (deterministic), so everyone sees the same
// puppet/character on a given day, and it changes at midnight.

const PUPPETS = [
  { face: "🐸", name: "Kermit the Frog", blurb: "it's not easy being green, but he hosts the show anyway." },
  { face: "🐷", name: "Miss Piggy", blurb: "a diva in pearls. do NOT call her a pig." },
  { face: "🔴", name: "Elmo", blurb: "tickle at your own risk." },
  { face: "🍪", name: "Cookie Monster", blurb: "C is for a mostly balanced diet." },
  { face: "🐤", name: "Big Bird", blurb: "eight feet of pure optimism." },
  { face: "🗑️", name: "Oscar the Grouch", blurb: "lives in trash, thrives on spite." },
  { face: "🐻", name: "Fozzie Bear", blurb: "wocka wocka — the jokes are bad and he knows it." },
  { face: "🦅", name: "Gonzo", blurb: "part daredevil, part mystery, all heart." },
  { face: "🐶", name: "Rowlf the Dog", blurb: "the piano-playing good boy." },
  { face: "🐑", name: "Lamb Chop", blurb: "small sock, enormous personality." },
  { face: "🪵", name: "Pinocchio", blurb: "a real boy — conditions apply." },
  { face: "😼", name: "Triumph the Insult Comic Dog", blurb: "a compliment, for him to poop on." },
  { face: "💃", name: "Madame", blurb: "glamour, sequins, and zero patience." },
  { face: "🐭", name: "Topo Gigio", blurb: "the gentlest mouse on late-night TV." },
  { face: "🤠", name: "Howdy Doody", blurb: "freckles, strings, and 1950s cheer." },
  { face: "🐘", name: "Mr. Snuffleupagus", blurb: "big, shy, and possibly imaginary." },
  { face: "🌱", name: "Audrey II", blurb: "feed me. don't ask what." },
  { face: "🧙", name: "Yoda (the puppet)", blurb: "judge him by his size, you should not." },
  { face: "🪑", name: "Chairry", blurb: "a chair that loves you back." },
  { face: "👨‍🍳", name: "The Swedish Chef", blurb: "bork bork bork." },
  { face: "🧪", name: "Beaker", blurb: "meep. it never ends well." },
  { face: "🧛", name: "Count von Count", blurb: "ah ah ah — one great puppet!" },
  { face: "🟦", name: "Grover", blurb: "near... far... wherever you are." },
  { face: "🐻", name: "Sweetums", blurb: "enormous, lovable, mildly terrifying." },
  { face: "🦆", name: "Ernie", blurb: "rubber duckie enthusiast, professional." },
  { face: "🟧", name: "Bert", blurb: "bottle caps and quiet disappointment." },
];

const SILLIES = [
  { face: "🧽", name: "SpongeBob SquarePants", blurb: "ready, kids? he can't hear you." },
  { face: "⭐", name: "Patrick Star", blurb: "is mayonnaise an instrument?" },
  { face: "🤖", name: "GIR", blurb: "gonna sing the doom song now." },
  { face: "🟫", name: "Domo", blurb: "brown, fuzzy, perpetually startled." },
  { face: "🟢", name: "Shrek", blurb: "it's all ogre now." },
  { face: "🐹", name: "the Hampster Dance hamsters", blurb: "dee dee dee, da da da." },
  { face: "🌙", name: "the Spongmonkeys", blurb: "we like the moon." },
  { face: "🍊", name: "the Annoying Orange", blurb: "hey apple. hey. hey apple." },
  { face: "🌈", name: "Nyan Cat", blurb: "pop-tart cat, infinite rainbow." },
  { face: "🥄", name: "Salad Fingers", blurb: "he likes rusty spoons. don't ask." },
  { face: "🏃", name: "Homestar Runner", blurb: "a terrific athlete." },
  { face: "🥊", name: "Strong Bad", blurb: "another email gloriously destroyed." },
  { face: "👶", name: "the Dancing Baby", blurb: "the original viral cha-cha." },
  { face: "🐵", name: "BonziBuddy", blurb: "a purple ape who knew far too much." },
  { face: "📎", name: "Clippy", blurb: "it looks like you're having a dream. need help?" },
  { face: "🐶", name: "Courage the Cowardly Dog", blurb: "scared of everything, brave anyway." },
  { face: "😾", name: "Ren & Stimpy", blurb: "you eediot!" },
  { face: "🧠", name: "Pinky and the Brain", blurb: "same thing we do every night." },
  { face: "🐸", name: "Crazy Frog", blurb: "ring ding ding, a menace." },
  { face: "🦔", name: "very silly Sonic", blurb: "you're too slow!" },
  { face: "🟩", name: "Weegee", blurb: "do not make eye contact." },
  { face: "🍌", name: "Bananas in Pyjamas", blurb: "coming down the stairs, as ever." },
  { face: "🦑", name: "Squidward", blurb: "doomed to the clarinet, forever." },
  { face: "👽", name: "Invader Zim", blurb: "DOOM DOOM DOOM." },
  { face: "🐔", name: "Robot Chicken", blurb: "flipped through one channel too many." },
  { face: "🎩", name: "the Trololo man", blurb: "no words — only vibes." },
];

const DREAM_QUOTES = [
  "everyone left hours ago, but the lights stayed on for you.",
  "you've walked this hallway before, in a dream you can't quite name.",
  "the pool is empty. it has always been empty. it is waiting.",
  "somewhere a television hums softly to no one.",
  "the carpet remembers every footstep. it does not mind.",
  "it is 3am here, and it always will be.",
  "you were happy here once. or you will be. it's hard to tell.",
  "the vending machine still glows, patient and kind.",
  "step softly — the dream is sleeping too.",
  "this place misses a version of you that never existed.",
];

const BLINKIES = [
  ["♥ DREAMCORE ♥", "#ffb3de"],
  ["WEBCORE 4 LIFE", "#8ff0ff"],
  ["★ Y2K ★", "#c9a7ff"],
  ["MIKU MILES ♪", "#b6ffd6"],
  ["NO ADULTS ALLOWED", "#fff4d6"],
  ["100% ORGANIC HTML", "#ffb3de"],
  ["♡ BE KIND ♡", "#8ff0ff"],
  ["LIMINAL ZONE", "#d6ff7a"],
  ["best in NETSCAPE", "#c9a7ff"],
];

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// ---------- daily features ----------
function dayIndex() { return Math.floor(Date.now() / 86400000); } // days since epoch (UTC)
function renderDaily(sel, kicker, item) {
  $(sel).innerHTML =
    `<p class="dc-kicker">${kicker}</p>` +
    `<div class="dc-face">${item.face}</div>` +
    `<p class="dc-name">${esc(item.name)}</p>` +
    `<p class="dc-blurb">${esc(item.blurb)}</p>`;
}
function renderDailies() {
  const d = dayIndex();
  renderDaily("#puppetCard", "🎭 puppet of the day", PUPPETS[d % PUPPETS.length]);
  renderDaily("#sillyCard", "🤪 silly character of the day", SILLIES[(d + 3) % SILLIES.length]);
}

// ---------- dream quote (random each visit) ----------
function renderQuote() {
  const q = DREAM_QUOTES[Math.floor(Math.random() * DREAM_QUOTES.length)];
  $("#dreamQuote").textContent = "“" + q + "”";
}

// ---------- visitor counter (decorative, per-browser) ----------
function renderCounter() {
  let n = 0;
  try { n = parseInt(localStorage.getItem("haley-visits") || "0", 10) || 0; } catch {}
  n += 1;
  try { localStorage.setItem("haley-visits", String(n)); } catch {}
  const total = 13337 + n;
  $("#counter").textContent = "☆ you are wanderer #" + String(total).padStart(6, "0") + " ☆";
}

// ---------- blinkies ----------
function renderBlinkies() {
  $("#blinkies").innerHTML = BLINKIES
    .map(([t, c]) => `<span class="blinkie" style="background:${c}">${esc(t)}</span>`)
    .join("");
}

// ---------- cassette player ----------
const audio = $("#audio");
const player = $("#player");
$("#playBtn").addEventListener("click", () => {
  if (audio.paused) audio.play().catch(() => {});
  else audio.pause();
});
audio.addEventListener("play", () => { player.classList.add("playing"); $("#playBtn").innerHTML = "❚❚ pause"; });
audio.addEventListener("pause", () => { player.classList.remove("playing"); $("#playBtn").innerHTML = "▶︎ play"; });
function setupAutoplay() {
  audio.play().catch(() => {
    const kick = (e) => {
      if (e && e.target.closest && e.target.closest("#player")) { cleanup(); return; }
      audio.play().catch(() => {});
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

// ---------- dream journal (guestbook, per-browser) ----------
const GB_KEY = "haley-guestbook";
function loadGB() { try { return JSON.parse(localStorage.getItem(GB_KEY) || "[]"); } catch { return []; } }
function renderGB() {
  const entries = loadGB();
  $("#gbList").innerHTML = entries.length
    ? entries.slice(-20).reverse().map((e) =>
        `<li><b>${esc(e.name)}</b> &mdash; <span>${esc(e.msg)}</span></li>`).join("")
    : `<li><span>no dreams yet... be the first ✶</span></li>`;
}
$("#gbSign").addEventListener("click", () => {
  const name = $("#gbName").value.trim() || "a stranger";
  const msg = $("#gbMsg").value.trim();
  if (!msg) return;
  const entries = loadGB();
  entries.push({ name: name.slice(0, 24), msg: msg.slice(0, 80) });
  try { localStorage.setItem(GB_KEY, JSON.stringify(entries.slice(-50))); } catch {}
  $("#gbMsg").value = "";
  renderGB();
});

// ---------- init ----------
renderDailies();
renderQuote();
renderCounter();
renderBlinkies();
renderGB();
setupAutoplay();
