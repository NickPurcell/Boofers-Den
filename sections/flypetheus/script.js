// flypetheus — Y2K futurism × carnivorous theropods.
// Daily rotation (date-seeded) of a theropod species + an upbeat royalty-free track.
// Music: Kevin MacLeod (incompetech.com), licensed CC BY 4.0.

const THEROPODS = [
  { name: "Tyrannosaurus rex", pronounce: "tie-RAN-oh-SOR-us REX", era: "Late Cretaceous", mya: "68–66 mya",
    length: "up to ~12–13 m / 40 ft", weight: "~6–9 tonnes", region: "western North America",
    facts: ["It had the most powerful bite of any known land animal, crushing bone with a U-shaped jaw that tore out huge chunks of flesh.", "Teenagers exploded in size, packing on roughly 600 kg a year during a four-year growth spurt.", "The specimen 'Sue' is ~85% complete and lived to about 28 — the longest known lifespan of any tyrannosaur.", "Most paleontologists now agree it was both an active hunter and an opportunistic scavenger."] },
  { name: "Velociraptor", pronounce: "veh-LOSS-ih-RAP-tor", era: "Late Cretaceous", mya: "75–71 mya",
    length: "~1.5–2 m / 6 ft", weight: "~15–20 kg", region: "Mongolia & northern China",
    facts: ["It was about the size of a turkey and had feathers, confirmed by quill knobs on a fossil forearm.", "The 'Fighting Dinosaurs' fossil preserves one locked in combat with a Protoceratops, buried alive by collapsing sand.", "Its sickle claw likely pierced vital areas like the throat, much like a modern bird of prey.", "Jurassic Park's 'raptors' were actually modeled on the much larger Deinonychus."] },
  { name: "Spinosaurus", pronounce: "SPY-no-SOR-us", era: "Late Cretaceous", mya: "100–94 mya",
    length: "up to ~14–15 m / 50 ft", weight: "~7+ tonnes", region: "North Africa",
    facts: ["It is the longest known carnivorous dinosaur, likely outstripping even T. rex in length.", "A towering sail of neural spines over 1.6 m tall rose from its back.", "Its narrow, crocodile-like snout held conical, unserrated teeth built for snagging fish.", "A paddle-like tail suggests it was the most aquatic of all known large theropods."] },
  { name: "Allosaurus", pronounce: "AL-oh-SOR-us", era: "Late Jurassic", mya: "155–145 mya",
    length: "~8.5–9.7 m / 30 ft", weight: "~1.7–2.7 tonnes", region: "western North America & Portugal",
    facts: ["Its skull could flex and bow outward, widening its gape to deliver hatchet-like slashing bites.", "Utah's Cleveland-Lloyd Quarry has yielded dozens of individuals, making it one of the best-known Jurassic predators.", "The skeleton 'Big Al' shows 19 broken or infected bones, yet it survived long enough for many to heal.", "It was the first dinosaur species known from both North America and Europe."] },
  { name: "Giganotosaurus", pronounce: "GIG-a-NOTE-oh-SOR-us", era: "Late Cretaceous", mya: "~100–95 mya",
    length: "~12–13 m / 43 ft", weight: "~4–8 tonnes", region: "Patagonia, Argentina",
    facts: ["It was one of the largest land carnivores ever, rivaling or exceeding T. rex in length.", "An amateur found its shin bone while driving a dune buggy through the badlands in 1993.", "Its lower jaw had a distinctive downward 'chin' to brace against the stress of biting struggling prey.", "Bonebeds of its close relatives hint it may have hunted in groups to take down giant sauropods."] },
  { name: "Carnotaurus", pronounce: "KAR-no-TOR-us", era: "Late Cretaceous", mya: "~72–69 mya",
    length: "~7.5–8 m / 26 ft", weight: "~1.3–2.1 tonnes", region: "Patagonia, Argentina",
    facts: ["It is the only known meat-eater with a pair of bull-like horns above its eyes.", "Its arms were even more stunted than a T. rex's, with fused, nearly useless fingers.", "A massive tail muscle may have made it one of the fastest large theropods.", "Big olfactory bulbs and small optic lobes suggest it hunted more by smell than sight."] },
  { name: "Deinonychus", pronounce: "die-NON-ih-kus", era: "Early–Late Cretaceous", mya: "~115–108 mya",
    length: "~3.4 m / 11 ft", weight: "~60–100 kg", region: "western & central USA",
    facts: ["John Ostrom's 1960s study of it sparked the 'Dinosaur Renaissance,' recasting dinosaurs as active, agile animals.", "Its name means 'terrible claw,' for the curved sickle talon over 12 cm long on each second toe.", "Fossil evidence suggests it brooded its eggs with body heat, like a modern bird.", "It was almost certainly feathered and inspired the 'raptors' of Jurassic Park."] },
  { name: "Utahraptor", pronounce: "YOO-tah-RAP-tor", era: "Early Cretaceous", mya: "~139–135 mya",
    length: "~6–7 m / 23 ft", weight: "~250–500 kg", region: "eastern Utah, USA",
    facts: ["It is the largest raptor (dromaeosaur) ever discovered, dwarfing its cousin Velociraptor.", "Its second-toe killing claw measured a fearsome ~24 cm along the curve.", "Built more for ambush than speed, it hunted large herbivores like iguanodonts and ankylosaurs.", "One rock block held at least seven individuals, hinting at social or pack behavior."] },
  { name: "Dilophosaurus", pronounce: "die-LOAF-oh-SOR-us", era: "Early Jurassic", mya: "~195–184 mya",
    length: "~7 m / 23 ft", weight: "~400 kg", region: "Arizona, USA",
    facts: ["Its name means 'two-crested lizard,' for the pair of thin, arched crests on its skull.", "It was one of the largest land animals of the Early Jurassic and a genuine apex predator.", "Jurassic Park invented its venomous spit and frilled neck — neither is supported by any fossil.", "The movie also shrank it dramatically; the real animal was roughly the size of a small car."] },
  { name: "Baryonyx", pronounce: "bah-RON-icks", era: "Early Cretaceous", mya: "~130–125 mya",
    length: "~7.5–10 m / 30 ft", weight: "~1.2–2 tonnes", region: "England & Iberia",
    facts: ["It was the first theropod proven to eat fish, with fish scales preserved in its stomach region.", "Its name means 'heavy claw,' after the huge ~31 cm hooked claw on its thumb.", "An amateur plumber, William Walker, discovered it in a Surrey clay pit in 1983.", "Its long, narrow, gharial-like snout was perfect for snatching slippery prey from rivers."] },
  { name: "Ceratosaurus", pronounce: "seh-RAT-oh-SOR-us", era: "Late Jurassic", mya: "~155–150 mya",
    length: "~5.3–7 m / 23 ft", weight: "~0.4–1.2 tonnes", region: "western North America & Portugal",
    facts: ["It sported a prominent blade-like horn on its snout, now thought to be mainly for display.", "A row of bony armor plates ran down its back and tail — unique among theropods.", "Its blade-like teeth were proportionally enormous, with crowns up to ~9 cm long.", "Young Ceratosaurus could pile on nearly half their adult body mass in a single year."] },
  { name: "Majungasaurus", pronounce: "mah-JUNG-ah-SOR-us", era: "Late Cretaceous", mya: "70–66 mya",
    length: "~5.6–7 m / 23 ft", weight: "~750–1,100 kg", region: "Madagascar",
    facts: ["It is one of very few dinosaurs with direct fossil evidence of cannibalism — tooth marks from its own kind.", "A single dome-like horn topped its skull, so odd it was first mistaken for a pachycephalosaur.", "It was the apex predator of Cretaceous Madagascar, preying on long-necked sauropods.", "It replaced its teeth up to 13 times faster than other theropods, likely from gnawing bone."] },
  { name: "Acrocanthosaurus", pronounce: "AK-roh-KAN-thoh-SOR-us", era: "Early Cretaceous", mya: "~125–100 mya",
    length: "~11–11.5 m / 38 ft", weight: "~4.4–8.4 tonnes", region: "south-central USA",
    facts: ["Its name means 'high-spined lizard,' for tall neural spines forming a ridge along its back.", "It was the largest predator in its ecosystem, hunting sauropods, ornithopods, and armored dinosaurs.", "Famous Texas trackways may record one stalking a sauropod across an ancient shoreline.", "Its forelimbs could retract powerfully toward the body to clamp onto struggling prey."] },
  { name: "Albertosaurus", pronounce: "al-BER-toh-SOR-us", era: "Late Cretaceous", mya: "~71–68 mya",
    length: "~8–9 m / 30 ft", weight: "~1.7–3 tonnes", region: "Alberta, Canada",
    facts: ["A single Alberta bonebed holds at least 26 individuals — strong evidence these tyrannosaurs lived in groups.", "That site yielded over 1,100 bones, the largest concentration of big theropod fossils from the Cretaceous.", "It was a leaner, faster cousin of T. rex that lived a few million years earlier.", "Young pack members had long, ostrich-like legs and may have driven prey toward slower adults."] },
  { name: "Tarbosaurus", pronounce: "TAR-boh-SOR-us", era: "Late Cretaceous", mya: "~70 mya",
    length: "~10–12 m / 39 ft", weight: "~4.5–5 tonnes", region: "Mongolia & China",
    facts: ["It was the Asian counterpart of Tyrannosaurus and its closest known giant relative.", "It had the smallest arms relative to body size of any tyrannosaur.", "A unique locking ridge in its lower jaw stiffened the bite, shared only with Alioramus.", "Its powerful jaws could crush bone, much like its North American cousin."] },
  { name: "Yutyrannus", pronounce: "YOO-tih-RAN-us", era: "Early Cretaceous", mya: "~125 mya",
    length: "~7.5–9 m / 30 ft", weight: "~1.1–1.4 tonnes", region: "Liaoning, China",
    facts: ["It is the largest dinosaur with direct evidence of feathers — far heavier than any feathered dinosaur known before.", "Its filamentous plumage reached up to 20 cm long and likely insulated it in a cool climate.", "Three skeletons found together — adult, subadult, juvenile — hint at group living.", "Its name means 'beautiful feathered tyrant.'"] },
  { name: "Microraptor", pronounce: "MY-kro-RAP-tor", era: "Early Cretaceous", mya: "~125–120 mya",
    length: "~0.8–0.9 m / 3 ft", weight: "~0.5–1.9 kg", region: "Liaoning, China",
    facts: ["It had four wings — long flight feathers on both arms and legs — unique among known dinosaurs.", "Fossil pigment cells reveal it was glossy black with an iridescent, raven-like sheen.", "Wind-tunnel tests show it could glide between trees, a step toward powered flight.", "With hundreds of specimens found, it is among the most abundant of all raptor dinosaurs."] },
  { name: "Megalosaurus", pronounce: "MEG-ah-loh-SOR-us", era: "Middle Jurassic", mya: "~166–165 mya",
    length: "~6 m / 20 ft", weight: "~700 kg", region: "southern England",
    facts: ["It was the very first non-bird dinosaur ever scientifically named, by William Buckland in 1824.", "Early fossils were once misread as the bones of Roman war elephants or biblical giants.", "A famous 1852 Crystal Palace statue first introduced the British public to prehistoric reptiles.", "It hunted as a bipedal predator, its horizontal body balanced by a long tail."] },
  { name: "Cryolophosaurus", pronounce: "KRY-oh-LOAF-oh-SOR-us", era: "Early Jurassic", mya: "~194–183 mya",
    length: "~6–7 m / 23 ft", weight: "~350–465 kg", region: "Antarctica",
    facts: ["It was the first meat-eating dinosaur ever found in Antarctica.", "An unusual crest swept sideways across its head, earning the nickname 'Elvisaurus' for its pompadour look.", "It mixed primitive leg bones with a surprisingly advanced skull, puzzling scientists about its family tree.", "Its fossils came from Mount Kirkpatrick, high in the Transantarctic Mountains."] },
  { name: "Suchomimus", pronounce: "SOO-koh-MY-mus", era: "Early Cretaceous", mya: "~125–112 mya",
    length: "~9.5–11 m / 36 ft", weight: "~2.5–3.8 tonnes", region: "Niger, North Africa",
    facts: ["Its name means 'crocodile mimic,' for its long, low, narrow snout full of conical teeth.", "It was a fish-eating spinosaur adapted to grabbing slippery prey in shallow water.", "A low sail ran along its back, like a shorter version of its cousin Spinosaurus.", "Its thumb bore a large hooked claw about 19 cm long for hooking prey."] },
  { name: "Mapusaurus", pronounce: "MAH-poo-SOR-us", era: "Late Cretaceous", mya: "~97–93 mya",
    length: "~10.2–12.6 m / 41 ft", weight: "~6–8 tonnes", region: "Patagonia, Argentina",
    facts: ["A bonebed holds up to nine individuals of different ages, hinting these giants may have hunted in packs.", "It rivaled T. rex in size and was among the largest of the shark-toothed carcharodontosaurs.", "It was a close relative of Giganotosaurus, set apart by a deeper, rougher skull.", "Despite its bulk, its arms were proportionally tiny, much like a tyrannosaur's."] },
  { name: "Gorgosaurus", pronounce: "GOR-go-SOR-us", era: "Late Cretaceous", mya: "~76.5–75 mya",
    length: "~8–9 m / 30 ft", weight: "~2–3 tonnes", region: "Alberta, Canada & Montana, USA",
    facts: ["It is the best-represented tyrannosaur of all, known from dozens of specimens including a full growth series.", "A juvenile preserved with its last meals shows young tyrannosaurs hunted small, fast prey before switching diets.", "It was so similar to Albertosaurus that some experts debate whether they are the same genus.", "Healed bite marks on many skulls reveal frequent face-biting fights between individuals."] },
  { name: "Troodon", pronounce: "TROH-oh-don", era: "Late Cretaceous", mya: "~77.5–76.5 mya",
    length: "~2 m / 6.5 ft", weight: "~50 kg", region: "western North America, incl. Alaska",
    facts: ["It had one of the largest brains relative to body size of any dinosaur, long called one of the 'smartest.'", "Huge, forward-facing eyes suggest excellent vision and possibly nocturnal hunting.", "Its name means 'wounding tooth,' coined in 1856 from one of the first dinosaur fossils described in North America.", "It was mainly a carnivore but may have eaten some plants — likely an opportunistic omnivore."] },
  { name: "Herrerasaurus", pronounce: "huh-RAIR-uh-SOR-us", era: "Late Triassic", mya: "~231–229 mya",
    length: "~4.5–6 m / 20 ft", weight: "~200–350 kg", region: "northwestern Argentina",
    facts: ["It is one of the earliest known dinosaurs, from a time when dinosaurs were still minor players.", "It was named for Victorino Herrera, an Andean goat herder who spotted its bones in 1959.", "Its odd anatomy confused scientists for decades until a near-complete skull settled it as an early predator.", "One skull shows bite wounds — evidence of fights between members of its own species."] },
  { name: "Compsognathus", pronounce: "komp-SOG-nah-thus", era: "Late Jurassic", mya: "~150–145 mya",
    length: "~0.7–1.4 m / up to 4.6 ft", weight: "~0.3–3.5 kg", region: "Germany & France",
    facts: ["About the size of a chicken, it was long considered the smallest known non-bird dinosaur.", "Both known skeletons preserve small, agile lizards in their bellies — their last meals.", "Its two skeletons were found over a century apart, in the 1850s and around 1971.", "Thomas Huxley compared it with Archaeopteryx, helping build the case that birds descend from dinosaurs."] },
];

// 8 upbeat royalty-free tracks — Kevin MacLeod (incompetech.com), CC BY 4.0
const TRACKS = [
  { file: "music/Pixelland.mp3", name: "Pixelland" },
  { file: "music/Monkeys_Spinning_Monkeys.mp3", name: "Monkeys Spinning Monkeys" },
  { file: "music/Hyperfun.mp3", name: "Hyperfun" },
  { file: "music/Carefree.mp3", name: "Carefree" },
  { file: "music/Run_Amok.mp3", name: "Run Amok" },
  { file: "music/Itty_Bitty_8_Bit.mp3", name: "Itty Bitty 8 Bit" },
  { file: "music/Wallpaper.mp3", name: "Wallpaper" },
  { file: "music/Mister_Exposition.mp3", name: "Mister Exposition" },
];

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const dayIndex = () => Math.floor(Date.now() / 86400000);

// ---------- theropod of the day ----------
function renderTheropod() {
  const t = THEROPODS[dayIndex() % THEROPODS.length];
  $("#theropodCard").innerHTML =
    `<p class="th-kicker">🦖 THEROPOD OF THE DAY</p>` +
    `<h2 class="th-name">${esc(t.name)}</h2>` +
    `<p class="th-pron">/ ${esc(t.pronounce)} /</p>` +
    `<div class="th-stats">` +
      `<span><b>Era</b>${esc(t.era)}</span>` +
      `<span><b>When</b>${esc(t.mya)}</span>` +
      `<span><b>Length</b>${esc(t.length)}</span>` +
      `<span><b>Weight</b>${esc(t.weight)}</span>` +
      `<span><b>Range</b>${esc(t.region)}</span>` +
    `</div>` +
    `<ul class="th-facts">${t.facts.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>`;
}

// ---------- daily track ----------
const audio = $("#audio");
const player = $("#player");
const track = TRACKS[dayIndex() % TRACKS.length];
function setupTrack() {
  audio.src = track.file;
  $("#trackName").textContent = track.name;
  $("#attr").innerHTML = `♪ &ldquo;${esc(track.name)}&rdquo; — Kevin MacLeod · ` +
    `<a href="https://incompetech.com" target="_blank" rel="noopener">incompetech.com</a> · CC BY 4.0`;
  $("#credit").innerHTML = `All music by Kevin MacLeod (<a href="https://incompetech.com" target="_blank" rel="noopener">incompetech.com</a>), licensed under Creative Commons: By Attribution 4.0`;
}
$("#playBtn").addEventListener("click", () => {
  if (audio.paused) audio.play().catch(() => {});
  else audio.pause();
});
audio.addEventListener("play", () => { player.classList.add("playing"); $("#playBtn").textContent = "❚❚ PAUSE"; });
audio.addEventListener("pause", () => { player.classList.remove("playing"); $("#playBtn").textContent = "► PLAY"; });
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

// ---------- init ----------
renderTheropod();
setupTrack();
setupAutoplay();
