// moos3s — "Desperado". A portrait of the rider himself, read off his own tracks
// in the public Boofers Den log: the deer he chose, the way he asked, the patience.
//
// Update: the ledger below is no longer guesswork. 34,122 messages across 20
// channels, back to 2017, were read and ranked. The Den voted on its own best
// moments long ago — every reaction was a vote. This is the count.

// --- the ledger: Desperado's actual moments, pulled from the message log ---
const DISPATCHES = [
  { sigil: "🦌", camp: "Picked his own brand", line:
    "Asked for a deer — a dog as the backup — and rode off with the deer. The one thing the man was dead sure about." },
  { sigil: "👁️", camp: "Asked to be seen", line:
    "Didn't say 'build me a page.' Said 'read my messages and make one that matches me.' Not a request — a challenge. Figure me out." },
  { sigil: "🚒", camp: "Hazmat fireman", line:
    "July 1st, 2026: \"Officially a hazmat fireman today, got my badge. One bugle. Costco discounts here I come.\" The whole camp turned out for it." },
  { sigil: "🏠", camp: "Keeps the door open", line:
    "Caroling parties, hot pot nights, bingo for a cause, \"my place is open, how's schedules looking.\" The quiet ones are always the hosts." },
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
  "Rode into 2026 a hazmat fireman. One bugle. The badge came, the camp cheered, and he mentioned the Costco discount.",
  "Has such beef with quails. Cocky bastards, apparently.",
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

last = Math.floor(Math.random() * NOTES.length);
noteEl.textContent = NOTES[last];


// =====================================================================
//  BEST OF THE DEN
//  Every quote below is verbatim from the log. The reaction counts are
//  real. The Den already voted on what mattered; this is just the count.
// =====================================================================

const FIRE = [
  {
    quote: "Better Call Joe",
    who: "Amnesiac Hawk", where: "general", when: "25 Jun 2026",
    setup: "Joe, casually dispensing small-claims law. Flypetheus: \"Damn is my babe like a damn lawyer or something\"",
    rx: [["this", 3], ["\u{1F602}", 2], ["based", 1]],
  },
  {
    quote: "Omfg I read that as sighs diabolically, just now occurred to me you wrote diabetically \u{1F480}",
    who: "NewJoeVariant", where: "general", when: "7 Apr 2026",
    setup: "On the lost 'sighs diabetically' emote — a photo of Ty smiling, which Umuu asked for out of nowhere and he sent, no questions asked",
    rx: [["\u{1F480}", 4], ["uwu", 3]],
  },
  {
    quote: "Robbie online too late \u{1F626}\nMake sad\nAm old man. Need sleep. Cannot nicotine my way through infinite exhaustion anymore. Gary come the fuck home",
    who: "Desperado", where: "rant", when: "1 May 2024",
    setup: "The rider's own contribution to the canon",
    rx: [["\u{1F474}", 3], ["50yearsoldapparently", 3]],
  },
  {
    quote: "I was at 673",
    who: "SES Stallion of The State", where: "general", when: "5 Dec 2025",
    setup: "Hour counts were requested. The Den answered with 6\uFE0F\u20E3 7\uFE0F\u20E3 3\uFE0F\u20E3 and said nothing further",
    rx: [["6\uFE0F\u20E3", 5], ["7\uFE0F\u20E3", 5], ["8\uFE0F\u20E3", 1], ["9\uFE0F\u20E3", 1]],
  },
  {
    quote: "I tried to go out the back door at work today and got trapped in the back rooms",
    who: "Umuu", where: "flood-n-memes", when: "15 Jun 2026",
    setup: "She had to phone her manager to be let out. Desperado, immediately: \"The unrendered side of things\"",
    rx: [["3HC_pepeLaugh", 5]],
  },
  {
    quote: "Robward and Eddert",
    who: "Flypetheus", where: "general", when: "13 Jul 2026",
    setup: "Two contacts entered into a phone years ago and never once corrected",
    rx: [["MozzyFace", 4]],
  },
  {
    quote: "Sister if I got a stomach ache every time a ate a midnight meal i would have gained a lot less weight",
    who: "BrutalTomRamen", where: "general", when: "13 May 2026",
    setup: "A lady had opinions about the timing of his dinners",
    rx: [["\u{1F4AF}", 4], ["\u{1FAC3}", 2], ["\u{1F525}", 2]],
  },
  {
    quote: "6'3 manlet",
    who: "Desperado", where: "general", when: "30 May 2026",
    setup: "Delivered flat, in defence of a friend, and never once explained",
    rx: [["this", 2], ["3HC_pepeLaugh", 2]],
  },
  {
    quote: "Toe update: it's just sprained",
    who: "NewJoeVariant", where: "general", when: "2 Nov 2025",
    setup: "Live from the ER, after Reed broke his toe for a video. Umuu's verdict: \"Reed hasnt gained full Unc status by breaking a bone doing a TikTok\"",
    rx: [["\u2764\uFE0F", 6]],
  },
  {
    quote: "DADDY MISSED YOU",
    who: "SES Stallion of The State", where: "general", when: "22 Dec 2025",
    setup: "Addressed to the electricity, after days of PG&E and one cry of \"SWEET SWEET ELECTRONS\"",
    rx: [["thirst", 4], ["uwu", 4]],
  },
  {
    quote: "Someone taught Lily that she's supposed to yell \u201CNick\u201D at me when I'm in the garage\u2026",
    who: "BrutalTomRamen", where: "pet-or-cute-place", when: "28 Dec 2024",
    setup: "Amnesiac Hawk: \"Damn, already on that first name basis with her dad\"",
    rx: [["Kannawave", 4], ["3HC_PikaLaugh", 1]],
  },
  {
    quote: "Tali singlehandedly manipulating Reed's sleep test results",
    who: "NewJoeVariant", where: "pet-or-cute-place", when: "16 Jun 2026",
    setup: "Desperado, who knows the cat's record: \"I hear she's quite the pizza thief\"",
    rx: [["shook", 2], ["\u{1F63B}", 2], ["3HC_pepeLaugh", 2]],
  },
  {
    quote: "The face of a man who did MOST of the cardio workout today and did not throw up",
    who: "JayyParm", where: "gym-chat", when: "17 Mar 2026",
    setup: "Desperado, on hand as always: \"Any workout is a good workout\"",
    rx: [["\u2764\uFE0F", 5]],
  },
  {
    quote: "I have such beef with quails\nCocky bastards",
    who: "Desperado", where: "pet-or-cute-place", when: "17 Jun 2026",
    setup: "Unprompted. Unresolved. The quails have not responded",
    rx: [],
  },
  {
    quote: "Yo we had hot pot for the first time\nThat shit fuuucks",
    who: "Desperado", where: "general", when: "23 Feb 2026",
    setup: "A man of few words, using several of them at once",
    rx: [["this", 2], ["\u{1F4AF}", 2]],
  },
];

const SHOWED = [
  {
    quote: "Got a 4.0 this semester \u{1F60E}",
    who: "Flypetheus", where: "general", when: "22 May 2026",
    setup: "Twenty-one reactions. The single most-celebrated message in the entire log",
    rx: [["\u{1F499}", 8], ["Kannaheart", 7], ["knightlove", 2], ["based", 2], ["knucklescosmic", 2]],
  },
  {
    quote: "Just got the keys for a house in Vallejo!!!",
    who: "BrutalTomRamen", where: "general", when: "15 Apr 2026",
    rx: [["\u{1F499}", 7]],
  },
  {
    quote: "This isn't really a rant, but this seems to be the place where we talk about job stuff; I was selected for the next step for an Electrican apprenticeship for the city of Burbank. This is the closest I've been to a job in over 2 years!",
    who: "Amnesiac Hawk", where: "rant", when: "11 Mar 2026",
    setup: "Two years. Posted in the complaints channel, because that is where he knew someone would be listening",
    rx: [["\u{1F525}", 5], ["Kannaheart", 4]],
  },
  {
    quote: "Officially a hazmat fireman today, got my badge.\nOne bugle. Costco discounts here I come",
    who: "Desperado", where: "general", when: "1 Jul 2026",
    setup: "The rider himself. First question back: \"When are you going in the calendar!\"",
    rx: [["\u{1F499}", 2], ["shook", 1], ["based", 1], ["Kannaheart", 1]],
  },
  {
    quote: "I HAVE A CALL WITH THE MINECRAFT TEAM FOR A CONTRACT JOB",
    who: "JayyParm", where: "general", when: "1 Apr 2026",
    rx: [["\u{1F64C}", 5]],
  },
  {
    quote: "60 pounds down since last September!",
    who: "BrutalTomRamen", where: "gym-chat", when: "22 Mar 2025",
    setup: "He had posted at 40 pounds in January. The Den was there for that one too",
    rx: [["POG", 5]],
  },
  {
    quote: "Hit 3 plates on flat bench",
    who: "Amnesiac Hawk", where: "gym-chat", when: "16 Feb 2026",
    rx: [["gigaed", 2], ["knightlove", 2]],
  },
  {
    quote: "Three weeks of being consistent with my classes and not skipping even during vacation time \u{1F62E}\u200D\u{1F4A8}",
    who: "Tyberia", where: "gym-chat", when: "28 May 2026",
    rx: [["LambLetsGo", 4], ["based", 3]],
  },
  {
    quote: "Just sang with a live band",
    who: "JayyParm", where: "general", when: "14 Jun 2026",
    rx: [["\u{1F49A}", 4]],
  },
  {
    quote: "Heyyyyy, not to be too cringe, but I want to say thank you guys and I appreciate you \u2764\uFE0F It's nice getting to feel involved, not used to it during tax season. Okay, back to the normally scheduled sass.",
    who: "Tyberia", where: "general", when: "22 Feb 2026",
    rx: [["\u{1F499}", 5], ["Kannaheart", 1]],
  },
  {
    quote: "This is so cute I actually cried a little LOL \u{1F62D}\u{1F970} I love this friends group sm, thank you Haley and Reed \u{1F495}",
    who: "Umuu", where: "general", when: "30 May 2026",
    rx: [["Kannaheart", 3], ["\u{1F499}", 3]],
  },
];

const BOARDS = { fire: FIRE, showed: SHOWED };

function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// custom Den emoji arrive as bare word-names; unicode ones carry symbols
function isUnicodeEmoji(name) {
  return !/^[\w-]+$/.test(name);
}

function renderReactions(rx) {
  if (!rx || !rx.length) {
    return '<span class="rx-none">no reactions — some things you just had to be there for</span>';
  }
  return rx.map(function (r) {
    const cls = isUnicodeEmoji(r[0]) ? "rx uni" : "rx custom";
    return '<span class="' + cls + '"><b>' + esc(r[0]) + '</b>' + r[1] + '</span>';
  }).join("");
}

function renderBoard(key) {
  const wrap = document.querySelector("#posters");
  wrap.innerHTML = "";
  BOARDS[key].forEach(function (m, i) {
    const card = document.createElement("article");
    card.className = "poster";
    card.style.animationDelay = (i * 55) + "ms";
    const lines = esc(m.quote).split("\n").map(function (l) {
      return "<span>" + l + "</span>";
    }).join("");
    card.innerHTML =
      '<blockquote class="p-quote">' + lines + '</blockquote>' +
      (m.setup ? '<p class="p-setup">' + esc(m.setup) + '</p>' : '') +
      '<div class="p-meta"><span class="p-who">' + esc(m.who) + '</span>' +
      '<span class="p-where">#' + esc(m.where) + ' &middot; ' + esc(m.when) + '</span></div>' +
      '<div class="p-rx">' + renderReactions(m.rx) + '</div>';
    wrap.appendChild(card);
  });
}

document.querySelectorAll(".tab").forEach(function (btn) {
  btn.addEventListener("click", function () {
    document.querySelectorAll(".tab").forEach(function (b) { b.classList.remove("is-on"); });
    btn.classList.add("is-on");
    renderBoard(btn.dataset.board);
  });
});

renderBoard("fire");
