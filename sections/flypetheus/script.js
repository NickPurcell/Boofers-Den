// flypetheus — silvery mid-2000s futurism × carnivorous theropods × Destiny 2 Hunter builds.
// Daily rotation (date-seeded) of a theropod + a funky/groovy "jazz house" track (à la Moodena).
// Music: various artists via ccMixter, licensed CC BY 3.0 (attribution per track + in footer).

const THEROPODS = [
  { name: "Masiakasaurus", pronounce: "mah-see-AH-kah-SOR-us", era: "Late Cretaceous", mya: "72–66 mya", length: "~1.8–2.1 m / 7 ft", weight: "~20 kg", region: "Madagascar",
    facts: ["Its front teeth jutted almost straight forward, angled barely above horizontal — a buck-toothed setup unlike any other theropod, likely for spearing small prey.", "Heterodont jaws: spoon-like front teeth but blade-like back teeth, hinting at a mixed diet of fish, insects and small vertebrates.", "It grew ~40% slower than other theropods its size, taking 8–10 years to mature — likely an adaptation to Madagascar's harsh climate.", "Its species name honors Dire Straits' Mark Knopfler, whose music the dig crew played for luck."] },
  { name: "Austroraptor", pronounce: "AW-stroh-RAP-tor", era: "Late Cretaceous", mya: "~77–70 mya", length: "~5–6 m / 18 ft", weight: "~300–520 kg", region: "Argentina",
    facts: ["One of the largest raptors ever — yet with comically short arms, an upper-arm bone less than half its thigh length.", "Instead of serrated raptor teeth it had conical, unserrated, fluted teeth like a spinosaur's.", "Tooth shape suggests fish made up much of its diet, an unusual lifestyle for a dromaeosaur.", "It shows giant raptors evolved in the Southern Hemisphere on a path separate from the famous northern ones."] },
  { name: "Concavenator", pronounce: "con-cah-VEN-ah-tor", era: "Early Cretaceous", mya: "~125 mya", length: "~5–6 m / 18 ft", weight: "~320–400 kg", region: "Spain",
    facts: ["Two tall vertebrae just before the hips formed a strange pointed hump or mini-sail of unknown function.", "Its forearm bears bump-like structures some read as quill knobs — possible feather anchors on a large carnivore far outside the bird lineage.", "Exceptional preservation captured scale impressions on its feet and tail, rare soft-tissue detail for a predator.", "Whether those arm bumps are true quill knobs or just muscle scars is still debated."] },
  { name: "Irritator", pronounce: "IRR-ih-tay-tor", era: "Early Cretaceous", mya: "~113–110 mya", length: "~6–8 m / 26 ft", weight: "~1 tonne", region: "Brazil",
    facts: ["It's named for the 'irritation' scientists felt on finding fossil dealers had faked part of its snout with plaster before selling it.", "Its species name honors Professor Challenger from Arthur Conan Doyle's 'The Lost World.'", "An Irritator tooth was found embedded in a pterosaur neck bone — direct evidence this spinosaur ate flying reptiles.", "Despite the smuggling damage, its skull is the most complete spinosaurid skull ever found."] },
  { name: "Guanlong", pronounce: "GWAN-long", era: "Late Jurassic", mya: "~160 mya", length: "~3–3.5 m / 11 ft", weight: "~125 kg", region: "China (Xinjiang)",
    facts: ["An early cousin of T. rex that lived ~92 million years before it — and it still had three long fingers, later lost by big tyrannosaurs.", "It wore a tall, thin, air-filled crest down the midline of its skull, far too delicate for combat — pure show.", "Its name means 'crown dragon' for that flamboyant headgear.", "Specimens show the crest grew dramatically with age, starting small on the snout."] },
  { name: "Monolophosaurus", pronounce: "MON-oh-LOF-oh-SOR-us", era: "Middle Jurassic", mya: "~168–161 mya", length: "~5–5.5 m / 18 ft", weight: "~475 kg", region: "China (Xinjiang)",
    facts: ["Its name means 'single-crested lizard' for the tall ridge running along the top of its snout.", "CT scans show that crest was hollow and riddled with air chambers, so it was surprisingly lightweight — likely display or sound.", "It's one of the most primitive members of Tetanurae, helping pin down early carnivore evolution.", "A mysterious deep groove runs along its face whose purpose remains unknown."] },
  { name: "Sinraptor", pronounce: "SIN-rap-tor", era: "Late Jurassic", mya: "~160 mya", length: "~7.6–8.8 m / 29 ft", weight: "~1.3 tonnes", region: "China (Xinjiang)",
    facts: ["Despite the name it's NOT a raptor — it's a carnosaur related to Allosaurus; 'Sin' just means Chinese.", "Its skull shows bite marks and a fully punched-through hole made by another Sinraptor — evidence of face-biting fights.", "It was the apex predator of its ecosystem, hunting stegosaurs and other large dinosaurs.", "It's the best-known member of the obscure family Metriacanthosauridae."] },
  { name: "Skorpiovenator", pronounce: "SKOR-pee-oh-VEN-ah-tor", era: "Late Cretaceous", mya: "~95–90 mya", length: "~6–6.2 m / 20 ft", weight: "~900 kg", region: "Argentina",
    facts: ["Its name means 'scorpion hunter' — not because it ate scorpions, but because the dig site was crawling with them.", "It's one of the most complete abelisaurids known, found as a nearly intact articulated skeleton.", "Like its relative Carnotaurus it had a short, deep skull and absurdly tiny, near-useless arms.", "Its skull surface is pitted with nerve openings, suggesting an unusually sensitive face."] },
  { name: "Halszkaraptor", pronounce: "HALSH-kah-RAP-tor", era: "Late Cretaceous", mya: "~75–71 mya", length: "~0.6 m / 2 ft (duck-sized)", weight: "mallard-sized", region: "Mongolia",
    facts: ["It looks like a nightmarish duck-swan hybrid: a long swan-like neck, flipper-like forelimbs and a flat snout on a tiny raptor body.", "Each premaxilla packs eleven teeth — a record for any dinosaur (most theropods have four).", "Its snout housed dense networks of nerve canals, possibly sensory organs to detect prey in water.", "Whether it was a semiaquatic swimmer is hotly contested — a 2024 study argues it was a land-based bug-hunter."] },
  { name: "Cryolophosaurus", pronounce: "KRY-oh-LOAF-oh-SOR-us", era: "Early Jurassic", mya: "~194–183 mya", length: "~6–7 m / 23 ft", weight: "~350–465 kg", region: "Antarctica",
    facts: ["Nicknamed 'Elvisaurus' for a bizarre crest above its eyes that rises up and fans sideways like a pompadour.", "It was the first carnivorous dinosaur ever found in Antarctica and the first non-bird dinosaur from the continent to be named.", "Its crest ran crosswise over the head rather than front-to-back like most crested theropods.", "It mixes primitive leg bones with advanced skull features, making its family tree a long-running puzzle."] },
  { name: "Majungasaurus", pronounce: "mah-JUNG-ah-SOR-us", era: "Late Cretaceous", mya: "70–66 mya", length: "~6–7 m / 23 ft", weight: "~750–1,100 kg", region: "Madagascar",
    facts: ["It's the only non-bird dinosaur with confirmed cannibalism — its tooth marks appear on the bones of other Majungasaurus.", "It had a single thick dome-horn on its skull, at first mistaken for a dome-headed pachycephalosaur.", "Its short, wide snout and reinforced neck made it a 'bite-and-hold' predator, more like a big cat than a typical theropod.", "Its bones reveal bird-like one-way airflow lungs, showing that system predates birds themselves."] },
  { name: "Ceratosuchops", pronounce: "SERR-ah-toh-SOO-kops", era: "Early Cretaceous", mya: "~125 mya", length: "~7–8 m / 26 ft", weight: "uncertain (~1–2 t)", region: "England (Isle of Wight)",
    facts: ["Its nickname is the 'horned crocodile-faced hell heron' — for its brow bumps, croc-like snout and presumed heron-style fishing.", "It had bony lumps above its eyes that may have been used for display or species recognition.", "It was one of THREE spinosaurids sharing the same Isle of Wight ecosystem, each likely fishing a different niche.", "Brain scans show it kept a fairly ordinary theropod brain even as its body adapted to water."] },
  { name: "Rajasaurus", pronounce: "RAH-jah-SOR-us", era: "Late Cretaceous", mya: "~69–66 mya", length: "~6.6 m / 22 ft", weight: "~1–2 tonnes", region: "India",
    facts: ["Its name means 'king lizard' (from Sanskrit raja) — fitting for India's best-known predatory dinosaur.", "It sported a low single horn built mostly from the nasal bones, probably for display or head-butting.", "It evolved on the Indian landmass while it was an isolated drifting island breaking off from Gondwana.", "It was the first Indian theropod known from substantial skeleton bones, not just scraps."] },
  { name: "Noasaurus", pronounce: "NOH-ah-SOR-us", era: "Late Cretaceous", mya: "~70 mya", length: "~1.6–2 m / 6 ft", weight: "a few kg (uncertain)", region: "Argentina",
    facts: ["A pint-sized abelisaur cousin: scientists first thought its big curved claw was a raptor-style foot claw.", "Later study flipped that — the claw is now thought to be from the HAND, rewriting how it hunted.", "It may have used that hooked hand claw to snag fish, convergently like spinosaurs despite being unrelated.", "It lends its name to Noasauridae, the small, lightly-built branch of the abelisaur group."] },
  { name: "Eustreptospondylus", pronounce: "yoo-STREP-toh-spon-DY-lus", era: "Middle–Late Jurassic", mya: "~166–154 mya", length: "~6 m / 20 ft", weight: "~0.5 tonne", region: "England",
    facts: ["It lived when Europe was a scattered chain of islands, and it may have swum between them in search of food.", "Long thought a dwarf species — but the famous skeleton is actually just a not-yet-grown subadult.", "That specimen is still the most complete large Jurassic theropod ever found in Europe.", "Its tongue-twister name means 'true reversed vertebra,' a nod to its tangled naming history."] },
  { name: "Buitreraptor", pronounce: "bwee-TRER-ap-tor", era: "Late Cretaceous", mya: "~98–97 mya", length: "~1.5 m / 5 ft", weight: "~3 kg", region: "Argentina",
    facts: ["It had a long, slender, flat snout packed with many tiny unserrated teeth — built for lizards and mammals, not big prey.", "Its discovery proved raptors thrived in the Southern Hemisphere, not just Mongolia and North America.", "It had unusually long arms and hands for a raptor, probably for grabbing small, quick prey.", "Though no feathers were preserved, its kinship to Microraptor means it was almost certainly feathered."] },
  { name: "Yangchuanosaurus", pronounce: "yang-choo-AHN-oh-SOR-us", era: "Middle–Late Jurassic", mya: "~168–145 mya", length: "~8–10.8 m / 35 ft", weight: "up to ~3.4 tonnes", region: "China (Sichuan)",
    facts: ["It was the apex predator of Jurassic China, hunting giant Mamenchisaurus and armored stegosaurs.", "It had a knobbly face with a bony nose ridge and small hornlets, like a Chinese answer to Allosaurus.", "The first skeleton was uncovered in 1977 by a worker building a reservoir dam.", "It's named after Yongchuan, the region where it was found."] },
  { name: "Fukuiraptor", pronounce: "foo-KOO-ee-RAP-tor", era: "Early Cretaceous", mya: "~125–115 mya", length: "~4.2–5 m / 16 ft", weight: "~175–590 kg", region: "Japan",
    facts: ["Its large flat hand claws were first mistaken for foot claws, so it was initially thought a raptor — it's actually a megaraptoran.", "Its teeth blend features of two lineages, resembling both carcharodontosaurids and tyrannosaurids.", "It's one of Japan's most complete predatory dinosaurs and a flagship fossil of Fukui's dinosaur country.", "The quarry yielded several juveniles, a rare glimpse of how the species grew up."] },
  { name: "Achillobator", pronounce: "ah-KILL-oh-BAH-tor", era: "Late Cretaceous", mya: "~96–89 mya", length: "~4.5–5 m / 16 ft", weight: "~250–300 kg", region: "Mongolia",
    facts: ["It was one of the biggest raptors ever, in the heavyweight class with Utahraptor and Austroraptor.", "Its name combines 'Achilles' (for the huge tendon powering its sickle claw) with Mongolian 'baatar,' meaning hero.", "Unlike most slim raptors it had a deep, heavily built skull and stout bones for tackling large prey.", "It kept a primitive vertical hip bone, unusual among raptors."] },
  { name: "Proceratosaurus", pronounce: "pro-seh-RAT-oh-SOR-us", era: "Middle Jurassic", mya: "~166 mya", length: "~3 m / 10 ft", weight: "~28–36 kg", region: "England",
    facts: ["It's among the oldest known relatives of T. rex, showing the tyrannosaur lineage began as small, lightly-built hunters.", "It was mistakenly named for a supposed link to Ceratosaurus after a broken crest was read as a nose horn — the link was false.", "That hollow, air-filled snout crest was almost certainly for display, not fighting.", "A 2023 study estimated a feeble bite force of just ~390 newtons — a far cry from its bone-crushing descendants."] },
  { name: "Megaraptor", pronounce: "MEG-ah-RAP-tor", era: "Late Cretaceous", mya: "~90–88 mya", length: "~8 m / 26 ft", weight: "~1 tonne", region: "Argentina",
    facts: ["Famously misnamed: its huge ~35 cm claw was first assumed to be a giant raptor foot-claw, but it was actually on the HAND.", "It hunted with those enormous sickle hand claws, raking and clutching prey against its chest rather than relying on its jaws.", "Its name means 'giant thief,' yet it's not a raptor at all — it now sits within Coelurosauria.", "It anchors Megaraptora, a mysterious group whose place in dinosaur evolution is still argued."] },
  { name: "Deltadromeus", pronounce: "DEL-tah-DROH-mee-us", era: "Late Cretaceous", mya: "~100–94 mya", length: "~8 m / 26 ft (maybe up to ~12 m)", weight: "~1 tonne", region: "Morocco",
    facts: ["Its name means 'delta runner' — its slim, long leg bones suggest it was built for serious speed, like an oversized ostrich-mimic.", "Its family tree is a genuine mystery: it's been called a coelurosaur, ceratosaur, megaraptoran and ornithomimosaur.", "It may be the same animal as the lost giant Bahariasaurus, which would make it one of North Africa's largest predators.", "It shared its swampy world with Spinosaurus and Carcharodontosaurus — one of the most predator-packed ecosystems known."] },
  { name: "Aucasaurus", pronounce: "AW-kah-SOR-us", era: "Late Cretaceous", mya: "~85–80 mya", length: "~5.5–6.2 m / 20 ft", weight: "~700 kg", region: "Argentina",
    facts: ["When described in 2002 it was the most complete abelisaurid skeleton ever found.", "Its arms were even more reduced than its relative Carnotaurus's — two of its tiny fingers had no claws at all.", "Its tail shows the earliest known case of fused vertebrae (a birth defect) in a non-bird theropod.", "Its braincase suggests it could move its head a bit more freely than the closely related Carnotaurus."] },
  { name: "Bahariasaurus", pronounce: "bah-HAR-ee-ah-SOR-us", era: "Late Cretaceous", mya: "~95 mya", length: "~11–12 m / 40 ft", weight: "~4–4.6 tonnes", region: "North Africa (Egypt)",
    facts: ["Its only known fossils were destroyed in a 1944 WWII bombing raid on Munich — today only old drawings survive.", "It rivaled T. rex and Carcharodontosaurus in size, yet remains one of the most enigmatic giant predators ever found.", "Only body bones — no skull — were ever described, which keeps its identity deeply uncertain.", "Some researchers think it's the same animal as Deltadromeus."] },
  { name: "Qianzhousaurus", pronounce: "chee-AN-joh-SOR-us", era: "Late Cretaceous", mya: "~67–66 mya", length: "~6.3 m / 21 ft", weight: "~750 kg", region: "China",
    facts: ["Nicknamed 'Pinocchio rex' for its long, slender snout — totally unlike the deep, heavy jaws of T. rex.", "It was a gracile, lightweight tyrannosaur built to chase small, fast prey rather than crush bone.", "Its discovery confirmed that long-snouted tyrannosaurs were a real group, not just immature individuals.", "Studies show it did NOT use the bone-crunching 'puncture-and-pull' bite of its bulky cousins."] },
  { name: "Aerosteon", pronounce: "air-OSS-tee-on", era: "Late Cretaceous", mya: "~84–83 mya", length: "~6–9 m / 30 ft", weight: "~0.5–1 tonne", region: "Argentina",
    facts: ["Its name means 'air bone': its skeleton is honeycombed with air spaces, including in the wishbone, hip and belly ribs.", "Those hollow bones reveal a bird-like air-sac breathing system in a large predator, well before flight.", "Researchers think this air-sac system may have first evolved for cooling the body.", "It's a megaraptoran — one of the lightly-built, big-clawed predators of Late Cretaceous South America."] },
  { name: "Kileskus", pronounce: "kih-LESS-kuss", era: "Middle Jurassic", mya: "~166 mya", length: "~4–5 m / 16 ft", weight: "uncertain (fragmentary)", region: "Russia (Siberia)",
    facts: ["It's one of the oldest known tyrannosaur relatives on Earth, predating T. rex by roughly 100 million years.", "Its name simply means 'lizard' in the Khakas language of its Siberian discovery region.", "It was a crested proceratosaurid, sharing a backward-tilted nostril design with the English Proceratosaurus.", "Known mostly from skull scraps, it shows early tyrannosauroids ranged right across Jurassic Eurasia."] },
];

// 7 funky / groovy "jazz house" tracks (the Moodena lane) — various artists via
// ccMixter, all licensed CC BY 3.0. Attribution shown per track + in the footer.
const TRACKS = [
  { file: "music/winter-fusion.mp3",         name: "Winter Fusion",         artist: "tobias_weber", url: "https://ccmixter.org/people/tobias_weber" },
  { file: "music/groove-in-d-minor.mp3",     name: "Groove in D Minor",     artist: "admiralbob77", url: "https://ccmixter.org/people/admiralbob77" },
  { file: "music/straight-to-the-light.mp3", name: "Straight To The Light", artist: "AlexBeroza",   url: "https://ccmixter.org/people/AlexBeroza" },
  { file: "music/put-the-needle-down.mp3",   name: "Put The Needle Down",   artist: "AlexBeroza",   url: "https://ccmixter.org/people/AlexBeroza" },
  { file: "music/summer-house.mp3",          name: "Summer House",          artist: "Robbero",      url: "https://ccmixter.org/people/Robbero" },
  { file: "music/toronto-is-my-beat.mp3",    name: "Toronto Is My Beat",    artist: "Whitewolf225", url: "https://ccmixter.org/people/Whitewolf225" },
  { file: "music/soul-sister.mp3",           name: "Soul Sister",           artist: "Robbero",      url: "https://ccmixter.org/people/Robbero" },
];

// Destiny 2 Hunter builds — Monument of Triumph (9.7.0). Exotic-armor-focused,
// not weapon-dependent. Exotics/aspects/fragments confirmed against the live manifest.
const BUILDS_DISCLAIMER =
  "✓ Exotics, aspects, fragments, supers & rotations are confirmed against the live Bungie manifest. " +
  "Monument of Triumph reworked the artifact ('Artifacts 2.0'): 7 returning artifacts are now selectable, each with named perks, " +
  "and champion counters are intrinsic to weapon frames — so I've recommended an artifact + perks per build below. " +
  "⚠ The exact perk spellings are community-sourced (cross-checked across sources, not first-party confirmed), so double-check them on your in-game artifact screen.";

const BUILDS = [
  {
    name: "Celestial Nighthawk — King's Fall Burst", featured: true,
    subclass: "Solar · Gunslinger",
    super: "Golden Gun (Marksman) → Celestial Nighthawk collapses it into ONE supercharged shot (~6×) that ignites; precision kills refund Super.",
    exotic: { name: "Celestial Nighthawk", why: "Turns Golden Gun into a single massive shot and refunds Super on precision kills — the cornerstone of all GG burst DPS." },
    artifact: "🎯 Queensfoil Censer (Solar): Argent Ordnance + Rays of Precision + Heart of the Flame; or Hunter's Journal → Sniper's Meditation (boosts Still Hunt's Golden Gun shots).",
    aspects: ["Gunpowder Gamble", "On Your Mark"],
    fragments: ["Ember of Torches (Radiant on melee)", "Ember of Empyrean", "Ember of Ashes", "Ember of Solace"],
    weapons: "Weapon-flexible — the biggest multiplier is a DEBUFF (Tractor Cannon ~30% / weaken / Divinity), more than any specific gun. Still Hunt (Solar exotic sniper) is the star pairing: hold-reload fires its OWN Nighthawk-empowered Golden Gun shot — effectively a second huge hit.",
    rotation: ["Get Radiant (powered melee via Ember of Torches).", "Apply a weaken/debuff to the boss — this is the single biggest multiplier.", "Fire the Celestial Nighthawk Golden Gun shot for the big burst + Ignition.", "Hold-reload Still Hunt to fire its Nighthawk-empowered GG shot (second huge hit).", "Empty Still Hunt's sniper rounds, then swap to a heavy for the rest of the window.", "Precision GG kills on adds refund Super between phases."],
    playstyle: "Stand-off burst: stack Radiant + weaken + Solar surge, then dump two Nighthawk-tier Golden Gun shots plus heavy — the biggest single-window Hunter burst in the game.",
    reality: "Real talk: one Nighthawk shot will NOT one-shot a full King's Fall boss (Warpriest ~480k HP, Golgoroth ~409k). But Nighthawk + Still Hunt + a weaken comfortably ONE-PHASES them. True one-shots only land on much lower-HP targets.",
  },
  {
    name: "Gyrfalcon's — Void Invis Nightstalker", featured: false,
    subclass: "Void · Nightstalker",
    super: "Deadfall (tether: weaken + suppress, big team debuff) — or Moebius Quiver for personal burst on a debuffed target.",
    exotic: { name: "Gyrfalcon's Hauberk", why: "Leaving invisibility grants Volatile Rounds to all Void weapons; a finisher while invisible buffs damage and gives team overshields." },
    artifact: "🟣 NPA Repulsion Regulator (Void): Volatile Flow (pairs perfectly with Gyrfalcon's) + Void Weapon Channeling; Tablet of Ruin → Void Flux is the alt.",
    aspects: ["Stylish Executioner", "Vanishing Step / Phantom Surge (new 9.7.0 melee)"],
    fragments: ["Echo of Persistence", "Echo of Obscurity", "Echo of Cessation", "Echo of Expulsion"],
    weapons: "Lean Void so Volatile Rounds apply to whatever you carry (auto / pulse / SMG / scout). Not gun-locked — the build supplies the buffs.",
    rotation: ["Go invisible (Stylish Executioner finisher on a debuffed target, or dodge with Vanishing Step).", "Emerge — Gyrfalcon's grants Volatile Rounds to your Void weapons.", "Spray volatile + weakened adds; Void detonations refresh the loop.", "Finish a target while invisible for the weapon buff + team overshield.", "Tether the boss with Deadfall for a team-wide weaken before the damage phase.", "Repeat invis → volatile → finisher to stay nearly always invisible."],
    playstyle: "Near-permanent invisibility, constant Volatile add-clear, and team weaken on demand — the premier survivability/utility Hunter for endgame.",
    reality: "",
  },
  {
    name: "Liar's Handshake — Arc Punch", featured: false,
    subclass: "Arc · Arcstrider",
    super: "Gathering Storm (stake the boss for jolt DPS + a team debuff) — or Arc Staff for roaming survivability.",
    exotic: { name: "Liar's Handshake", why: "Cross Counter turns your Arc melee into a massive healing one-two punch; stacks with Combination Blow for a huge melee ceiling and self-heal." },
    artifact: "⚡ NPA Repulsion Regulator (Arc): Amped Up + Shock and Awe + Lightning Strikes Twice keep you amplified and add melee lightning.",
    aspects: ["Combination Blow", "Lethal Current / Flow State"],
    fragments: ["Spark of Resistance", "Spark of Shock", "Spark of Ions", "Spark of Feedback"],
    weapons: "Weapon-light — your fists are the damage. Any Arc weapon to stay amplified + feed Ionic Traces; a heavy for bosses you can't punch.",
    rotation: ["Become amplified (Arc kills, dodge, or amplified perk).", "Open with Combination Blow — the kill stacks melee damage, heals you, and refunds dodge.", "Dodge to instantly reset melee, then Cross Counter for a huge empowered, healing punch.", "Chain Combination Blow → dodge → punch to keep three melee stacks and full health.", "On bosses, stake them with Gathering Storm, then resume the punch loop on adds."],
    playstyle: "Aggressive self-healing melee bruiser — dive in, punch everything to death, dodge-reset, and stay amplified. One of the most survivable Hunter loops.",
    reality: "",
  },
  {
    name: "Star-Eater Scales — Prismatic Super Bomber", featured: false,
    subclass: "Prismatic · Hunter",
    super: "Your slotted super (Golden Gun / Silence & Squall / Storm's Edge), overcharged by Star-Eater for bonus damage + heal + overshield.",
    exotic: { name: "Star-Eater Scales", why: "Orbs feed extra Super energy and overcharge a full Super — rewards Prismatic's heavy orb generation with a giant empowered Super on demand." },
    artifact: "✦ Hunter's Journal (favors Prismatic): Prismatic Transfer + Transference + Elemental Siphon + Elemental Supercharger feed Transcendence and your overcharged Super.",
    aspects: ["Ascension", "Gunpowder Gamble / Winter's Shroud"],
    fragments: ["Facet of Courage", "Facet of Dawn", "Facet of Ruin", "Facet of Bravery"],
    weapons: "Fully flexible — match weapon elements to your fragments and surges. Orb generation matters more than the specific gun (orbs are Star-Eater's fuel).",
    rotation: ["Farm orbs with weapon + ability kills (Prismatic makes them trivially).", "Build to full Super, then keep grabbing orbs to OVERcharge it.", "Build Transcendence by alternating Light and Dark ability kills.", "Weaken the boss, then pop your overcharged Super for the buffed burst + heal + overshield.", "Between phases, farm orbs and Transcendence to recharge."],
    playstyle: "The flexible 'one big Super' build — orb spam + Transcendence, then a healing overcharged Super whenever you need burst. Swap in Celestial Nighthawk to become build #1.",
    reality: "",
  },
  {
    name: "Beyblade Threadrunner", featured: false,
    subclass: "Strand · Threadrunner",
    super: "Silkstrike (rope-dart) — a roaming panic-clear / get-out-of-jail super that also refreshes Woven Mail.",
    exotic: { name: "Cyrtarachne's Facade", why: "Grappling instantly grants Woven Mail (~+45% DR) plus flinch resist and heal-on-kill — every grapple makes you tanky on demand." },
    artifact: "🟢 NPA Repulsion Regulator (Strand): Improved Unraveling + Strand Soldier; or Implement of Curiosity → Refresh Threads + Tangled Web.",
    aspects: ["Widow's Silk", "Whirling Maelstrom"],
    fragments: ["Thread of Ascent", "Thread of Generation", "Thread of Transmutation", "Thread of Continuity"],
    weapons: "Not weapon-locked. Strand weapons that make Tangles / apply Unravel synergize best, but any add-clear primary works — Whirling Maelstrom and Threadlings do most of the damage.",
    rotation: ["Grapple a target/Tangle point — Widow's Silk makes a Grapple Tangle and Cyrtarachne's grants Woven Mail.", "With Woven Mail up, get weapon kills — Thread of Transmutation spawns Tangles.", "Shoot a Tangle: Whirling Maelstrom destroys it into a spinning Strand mass that shreds the pack and emits Unravel.", "Thread of Generation feeds grenade energy; Thread of Ascent reloads + buffs on grenade recharge — re-grapple to refresh Woven Mail and repeat.", "Pop Silkstrike to reset a chaotic room or chunk a miniboss."],
    playstyle: "Hyper-mobile, tanky grapple loop — swing in, get Woven Mail, blow Tangles into spinning Strand masses, and stay near-immortal while the room clears itself.",
    reality: "",
  },
  {
    name: "Frozen Bastion", featured: false,
    subclass: "Stasis · Revenant",
    super: "Silence and Squall — freeze a cluster with Silence, then drop Squall's lingering Stasis storm for zone control and freeze→shatter.",
    exotic: { name: "Renewal Grasps", why: "Hugely enlarges your Duskfield and gives allies inside Frost Armor while enemies deal reduced damage — one grenade becomes a team-wide safe zone." },
    artifact: "🔵 Slayer Baron Apothecary Satchel (Stasis): Wind Chill + Crystalline Converter + Frost Renewal + Served Cold for crystal/shatter uptime.",
    aspects: ["Grim Harvest", "Touch of Winter"],
    fragments: ["Whisper of Rime", "Whisper of Shards", "Whisper of Fissures", "Whisper of Conduction"],
    weapons: "Not weapon-locked. Lean Stasis so Frost Armor's damage bonus + Grim Harvest's shatter apply; Kinetic also shatters while armored. Bring the frame that stuns the activity's champs.",
    rotation: ["Throw the enhanced Duskfield (Touch of Winter + Renewal Grasps = a huge field + Frost Armor).", "Slowed/frozen kills drop Stasis shards → Grim Harvest stacks Frost Armor; Whisper of Conduction auto-pulls the shards.", "Finish with Stasis/Kinetic weapons for rising shatter; Whisper of Fissures boosts the shatter burst.", "Shatter Touch-of-Winter crystals for Whisper of Shards grenade regen → near-permanent Duskfield uptime.", "Pop Silence and Squall on dense rooms or a miniboss; Whisper of Rime keeps Frost Armor high for steady DR."],
    playstyle: "Defensive zone control — blanket the area in a giant slowing Duskfield, snowball Frost Armor DR, and clear via shatter while your team holds ground. Excellent for GMs and dungeons.",
    reality: "",
  },
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
    `<img class="th-img" id="thImg" alt="" hidden />` +
    `<p class="th-credit" id="thCredit"></p>` +
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
  fetchDinoImage(t.name);
}

// Pull a representative image for the day's species from Wikipedia's REST API
// (CORS-enabled). Hidden gracefully if the species has no lead image.
function fetchDinoImage(title) {
  const img = $("#thImg"), credit = $("#thCredit");
  const hide = () => { img.hidden = true; img.removeAttribute("src"); credit.innerHTML = ""; };
  img.onerror = hide; // a 404/blocked thumbnail hides gracefully instead of showing a broken-jpg icon
  fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`)
    .then((r) => (r.ok ? r.json() : Promise.reject()))
    .then((d) => {
      const src = d.thumbnail && d.thumbnail.source; // use the source verbatim — the old /480px- upscale 404'd on some files
      if (!src) return hide();
      img.src = src; img.alt = title + " — via Wikipedia"; img.hidden = false;
      const page = (d.content_urls && d.content_urls.desktop && d.content_urls.desktop.page) ||
        ("https://en.wikipedia.org/wiki/" + encodeURIComponent(title));
      credit.innerHTML = `📷 image via <a href="${page}" target="_blank" rel="noopener">Wikipedia</a>`;
    })
    .catch(hide);
}

// ---------- hunter builds ----------
function renderBuilds() {
  $("#buildsDisclaimer").textContent = BUILDS_DISCLAIMER;
  $("#buildsList").innerHTML = BUILDS.map((b) => {
    const chips = (label, arr) => `<div class="b-row"><span class="b-key">${label}</span>` +
      arr.map((x) => `<span class="b-chip">${esc(x)}</span>`).join("") + `</div>`;
    return `<div class="bcard y2kpanel${b.featured ? " featured" : ""}">` +
      (b.featured ? `<span class="b-flag">★ FEATURED</span>` : "") +
      `<h3 class="b-name">${esc(b.name)}</h3>` +
      `<p class="b-sub">${esc(b.subclass)}</p>` +
      `<p class="b-exotic">🛡️ ${esc(b.exotic.name)} <span>— ${esc(b.exotic.why)}</span></p>` +
      `<p class="b-line"><span class="b-key">Super</span> ${esc(b.super)}</p>` +
      chips("Aspects", b.aspects) +
      chips("Fragments", b.fragments) +
      `<p class="b-line"><span class="b-key">Weapons</span> ${esc(b.weapons)}</p>` +
      `<p class="b-artifact"><span class="b-key">Artifact ⚙</span> ${esc(b.artifact)}</p>` +
      `<details class="b-rot"><summary>Damage rotation</summary><ol>${b.rotation.map((r) => `<li>${esc(r)}</li>`).join("")}</ol></details>` +
      `<p class="b-play">${esc(b.playstyle)}</p>` +
      (b.reality ? `<p class="b-reality">${esc(b.reality)}</p>` : "") +
      `</div>`;
  }).join("");
}

// ---------- daily track ----------
const audio = $("#audio");
const player = $("#player");
const track = TRACKS[dayIndex() % TRACKS.length];
function setupTrack() {
  audio.src = track.file;
  $("#trackName").textContent = track.name;
  $("#attr").innerHTML = `♪ &ldquo;${esc(track.name)}&rdquo; — ` +
    `<a href="${track.url}" target="_blank" rel="noopener">${esc(track.artist)}</a> · ` +
    `via <a href="https://ccmixter.org" target="_blank" rel="noopener">ccMixter</a> · CC BY 3.0`;
  $("#credit").innerHTML = `Music by various artists via <a href="https://ccmixter.org" target="_blank" rel="noopener">ccMixter</a>, ` +
    `licensed under Creative Commons Attribution 3.0 (CC BY 3.0)`;
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
renderBuilds();
setupTrack();
setupAutoplay();
