/* SW5e ruleset: core math + a quick-reference compendium.
 * Text is summarised for table use; for full wording see the SW5e Player's Handbook (sw5e.com).
 * Values marked "default" are starting points — every number is editable on the character sheet. */
(function (root) {
  const ABILITIES = [
    { key: 'str', name: 'Strength' }, { key: 'dex', name: 'Dexterity' }, { key: 'con', name: 'Constitution' },
    { key: 'int', name: 'Intelligence' }, { key: 'wis', name: 'Wisdom' }, { key: 'cha', name: 'Charisma' },
  ];

  const SKILLS = [
    { key: 'acrobatics', name: 'Acrobatics', ab: 'dex' },
    { key: 'animalHandling', name: 'Animal Handling', ab: 'wis' },
    { key: 'athletics', name: 'Athletics', ab: 'str' },
    { key: 'deception', name: 'Deception', ab: 'cha' },
    { key: 'insight', name: 'Insight', ab: 'wis' },
    { key: 'intimidation', name: 'Intimidation', ab: 'cha' },
    { key: 'investigation', name: 'Investigation', ab: 'int' },
    { key: 'lore', name: 'Lore', ab: 'int' },
    { key: 'medicine', name: 'Medicine', ab: 'wis' },
    { key: 'nature', name: 'Nature', ab: 'int' },
    { key: 'perception', name: 'Perception', ab: 'wis' },
    { key: 'performance', name: 'Performance', ab: 'cha' },
    { key: 'persuasion', name: 'Persuasion', ab: 'cha' },
    { key: 'piloting', name: 'Piloting', ab: 'int' },
    { key: 'sleightOfHand', name: 'Sleight of Hand', ab: 'dex' },
    { key: 'stealth', name: 'Stealth', ab: 'dex' },
    { key: 'survival', name: 'Survival', ab: 'wis' },
    { key: 'technology', name: 'Technology', ab: 'int' },
  ];

  // Checked against SW5e's class data (sw5eapi /api/class): hit die, saves, points per level and max power level.
  // caster: force/tech; pp = power points per class level; prog = full | threeQuarter | half; from = first casting level
  // shortRest = the class regains all its tech points on a short rest as well as a long one (Engineer, Scout)
  // arch = what each class page calls its archetype (singular of "Berserker Approaches", "Sentinel Callings"...);
  // every SW5e class picks its archetype at class level 3.
  const CLASSES = {
    Berserker: { hd: 12, saves: ['str', 'con'], arch: 'Berserker Approach' },
    Consular:  { hd: 6,  saves: ['wis', 'cha'], arch: 'Consular Tradition', caster: 'force', pp: 4, prog: 'full' },
    Engineer:  { hd: 8,  saves: ['con', 'int'], arch: 'Engineering Discipline', caster: 'tech',  pp: 2, prog: 'full', shortRest: true },
    Fighter:   { hd: 10, saves: ['str', 'con'], arch: 'Fighter Specialty' },
    Guardian:  { hd: 10, saves: ['con', 'cha'], arch: 'Guardian Focus', caster: 'force', pp: 2, prog: 'half' },
    Monk:      { hd: 8,  saves: ['str', 'dex'], arch: 'Monastic Order' },
    Operative: { hd: 8,  saves: ['dex', 'int'], arch: 'Operative Practice' },
    Scholar:   { hd: 8,  saves: ['int', 'wis'], arch: 'Academic Pursuit' },
    Scout:     { hd: 10, saves: ['str', 'dex'], arch: 'Scout Technique', caster: 'tech',  pp: 1, prog: 'half', from: 2, shortRest: true },  // tech casting starts at 2nd level
    Sentinel:  { hd: 8,  saves: ['dex', 'cha'], arch: 'Sentinel Calling', caster: 'force', pp: 3, prog: 'threeQuarter' },
  };

  const SPECIES = ["Human", "Aqualish", "Arcona", "Barabel", "Bith", "Bothan", "Cathar", "Cerean", "Chiss", "Devaronian",
    "Droid, Class I", "Droid, Class II", "Droid, Class III", "Droid, Class IV", "Droid, Class V", "Duros", "Ewok", "Gamorrean",
    "Gran", "Gungan", "Ithorian", "Jawa", "Kel Dor", "Kiffar", "Mandalorian (Human)", "Miraluka", "Mirialan", "Mon Calamari",
    "Nautolan", "Nikto", "Pantoran", "Quarren", "Rattataki", "Rodian", "Sith Pureblood", "Sullustan", "Togruta", "Trandoshan",
    "Twi'lek", "Weequay", "Wookiee", "Zabrak", "Zeltron"];

  const BACKGROUNDS = ["Agent", "Bounty Hunter", "Criminal", "Entertainer", "Force Adept", "Gambler", "Investigator",
    "Jedi", "Mandalorian", "Mercenary", "Noble", "Outlaw", "Pirate", "Politician", "Scientist", "Sith", "Smuggler",
    "Soldier", "Spacer", "Student", "Trader", "Underworld"];

  const DAMAGE_TYPES = ['acid', 'cold', 'energy', 'fire', 'force', 'ion', 'kinetic', 'lightning', 'necrotic', 'poison', 'psychic', 'sonic', 'true'];

  // Starter weapon table (default values — adjust to match your book / sheet).
  const WEAPONS = [
    { name: 'Unarmed strike', damage: '1', type: 'kinetic', ab: 'str', props: 'Melee', melee: true },
    { name: 'Vibroknife', damage: '1d4', type: 'kinetic', ab: 'finesse', props: 'Finesse, Light, Thrown (20/60)', melee: true },
    { name: 'Vibrosword', damage: '1d8', type: 'kinetic', ab: 'str', props: 'Versatile (1d10)', melee: true },
    { name: 'Vibrostaff', damage: '1d6', type: 'kinetic', ab: 'str', props: 'Double, Two-handed', melee: true },
    { name: 'Electrostaff', damage: '1d6', type: 'kinetic', ab: 'str', props: 'Double, Two-handed', melee: true },
    { name: 'Lightsaber', damage: '1d8', type: 'energy', ab: 'str', props: 'Versatile (1d10)', melee: true },
    { name: 'Shoto lightsaber', damage: '1d6', type: 'energy', ab: 'finesse', props: 'Finesse, Light', melee: true },
    { name: 'Double-bladed lightsaber', damage: '1d6', type: 'energy', ab: 'str', props: 'Double, Two-handed', melee: true },
    { name: 'Hold-out blaster', damage: '1d4', type: 'energy', ab: 'dex', props: 'Range (30/120), Hidden, Light' },
    { name: 'Blaster pistol', damage: '1d6', type: 'energy', ab: 'dex', props: 'Range (40/160), Light' },
    { name: 'Heavy blaster pistol', damage: '1d8', type: 'energy', ab: 'dex', props: 'Range (40/160)' },
    { name: 'Blaster carbine', damage: '1d8', type: 'energy', ab: 'dex', props: 'Range (60/240)' },
    { name: 'Blaster rifle', damage: '1d8', type: 'energy', ab: 'dex', props: 'Range (100/400), Two-handed' },
    { name: 'Bowcaster', damage: '1d10', type: 'energy', ab: 'dex', props: 'Range (40/160), Strength, Two-handed' },
    { name: 'Sniper rifle', damage: '1d12', type: 'energy', ab: 'dex', props: 'Range (150/600), Two-handed' },
    { name: 'Ion blaster', damage: '1d6', type: 'ion', ab: 'dex', props: 'Range (40/160)' },
    { name: 'Fragmentation grenade', damage: '3d6', type: 'kinetic', ab: 'dex', props: 'Thrown (30/90), 10-ft radius, Dex save for half' },
  ];

  // The 21 conditions in Appendix A of SW5e's Player's Handbook (checked against the PHB chapter itself;
  // sw5eapi's short /api/conditions list leaves out Corroded, Diseased, Ignited, Slowed and Weakened).
  // Summaries are in our own words; the PHB has the full wording.
  const CONDITIONS = {
    Blinded: 'Can\'t see; auto-fails sight checks. Attacks against it have advantage; its attacks have disadvantage.',
    Charmed: 'Can\'t attack or target the charmer with harmful effects. Charmer has advantage on social checks with it.',
    Corroded: 'Up to 3 levels. Takes 1 extra damage from weapons for each level.',
    Deafened: 'Can\'t hear; auto-fails hearing checks.',
    Diseased: 'Suffers whatever the particular disease does.',
    Exhaustion: 'Six levels; each includes the ones below it: 1 disadvantage on ability checks · 2 one slowed level · 3 disadvantage on attack rolls and saves · 4 hit point maximum halved · 5 four slowed levels · 6 death. A long rest (with food and drink) removes one level.',
    Frightened: 'Disadvantage on checks and attacks while the source is in sight; can\'t willingly move closer to it.',
    Grappled: 'Speed 0. Ends if the grappler is incapacitated or it is moved out of reach.',
    Ignited: 'Takes the listed fire damage at the end of each of its turns, until someone within 5 ft uses an action to put the flames out (or something else does).',
    Incapacitated: 'Can\'t take actions or reactions.',
    Invisible: 'Can\'t be seen without special senses. Its attacks have advantage; attacks against it have disadvantage.',
    Paralyzed: 'Incapacitated, can\'t move or speak. Fails Str/Dex saves. Attacks against it have advantage; hits from within 5 ft are critical.',
    Petrified: 'Turned to inanimate substance (e.g., carbonite). Incapacitated, unaware, resistant to all damage, fails Str/Dex saves.',
    Poisoned: 'Disadvantage on attack rolls and ability checks.',
    Prone: 'Can only crawl; disadvantage on attacks. Melee attacks within 5 ft have advantage against it, ranged attacks have disadvantage. Standing costs half speed.',
    Restrained: 'Speed 0. Its attacks and Dex saves have disadvantage; attacks against it have advantage.',
    Shocked: "Can't take reactions, and on its turn takes an action or a bonus action, not both.",
    Slowed: 'Up to 4 levels: speed −15 ft · −25 ft · −30 ft · speed 0 and no bonuses to speed.',
    Stunned: 'Incapacitated, can\'t move, speaks falteringly. Fails Str/Dex saves; attacks against it have advantage.',
    Unconscious: 'Incapacitated, drops what it holds, falls prone. Fails Str/Dex saves; attacks have advantage, and hits within 5 ft are critical.',
    Weakened: 'Healing it receives is halved, and it adds only half its ability modifier (if positive) to checks, attacks and saves.',
  };

  const REFERENCE = [
    { title: 'Core roll', body: `Roll <b>d20 + ability modifier</b> (+ proficiency bonus if proficient) and compare to a DC or AC.<br>
      <b>Advantage</b>: roll 2d20, keep higher. <b>Disadvantage</b>: keep lower. They cancel out.<br>
      Ability modifier = (score − 10) ÷ 2, rounded down. Proficiency: +2 (lvl 1–4), +3 (5–8), +4 (9–12), +5 (13–16), +6 (17–20).` },
    { title: 'Typical DCs', body: 'Very easy 5 · Easy 10 · Medium 15 · Hard 20 · Very hard 25 · Nearly impossible 30' },
    { title: 'Your turn in combat', body: `Move up to your speed (can split before/after actions), take one <b>action</b>, possibly one <b>bonus action</b>, and one free object interaction. One <b>reaction</b> per round (e.g., opportunity attack).<br>
      <b>Actions:</b> Attack · Cast a Power · Dash · Disengage · Dodge · Help · Hide · Ready · Search · Use an Object.` },
    { title: 'Attacks & damage', body: `Attack roll = d20 + ability mod + proficiency (if proficient). Melee uses Str (Finesse: Str or Dex), ranged uses Dex.<br>
      Natural 20 = critical hit: roll all damage dice twice. Natural 1 always misses.<br>
      Ranged attack at long range or with a hostile creature within 5 ft: disadvantage.<br>
      <b>Cover</b>: half +2 AC/Dex saves · three-quarters +5 · total = can't be targeted directly.` },
    { title: 'Force powers', body: `Force casting ability: <b>Wisdom</b> for light side powers, <b>Charisma</b> for dark side, either for universal.<br>
      Force point max = (class multiplier × class level) + Wis or Cha modifier. Casting costs <b>1 + power level</b> force points (at-will powers are free).<br>
      Save DC = 8 + proficiency + ability mod · Attack = proficiency + ability mod. Points return on a long rest.<br>
      Casting a light side power is easier for light-aligned users and harder for dark-aligned ones (and vice versa) — see the PHB for alignment rules.` },
    { title: 'Tech powers', body: `Tech casting ability: <b>Intelligence</b>. Requires a wristpad or chassis (tech focus).<br>
      Tech point max = (class multiplier × class level) + Int modifier. Casting costs <b>1 + power level</b> tech points.
      Engineers and Scouts regain all tech points on a <b>short or long rest</b>.<br>
      Save DC = 8 + proficiency + Int mod · Attack = proficiency + Int mod.` },
    { title: 'Concentration', body: 'Some powers need concentration. Taking damage forces a Con save, DC 10 or half the damage (whichever is higher), or the power ends. Only one concentration power at a time.' },
    { title: 'Resting', body: `<b>Short rest</b> (1 hour): spend Hit Dice — roll each + Con mod and regain that many HP.<br>
      Engineers and Scouts also regain all their tech points.<br>
      <b>Long rest</b> (8 hours): regain all HP, all force/tech points, and up to half your total Hit Dice (min 1); exhaustion drops one level. Only one per 24 hours.` },
    { title: 'Dropping to 0 HP', body: `You fall unconscious. At the start of each turn make a <b>death save</b> (d20, no modifiers): 10+ success, 9− failure. Three successes = stable, three failures = death.
      Natural 20: regain 1 HP. Natural 1: two failures. Damage while at 0 HP = one failure (crit = two). Damage ≥ your HP max in one hit = instant death.` },
    { title: 'Weapon properties', body: `<b>Finesse</b>: use Str or Dex. <b>Light</b>: good for two-weapon fighting. <b>Heavy</b>: small creatures have disadvantage.
      <b>Two-handed</b> / <b>Versatile</b> (bigger die two-handed). <b>Reach</b>: +5 ft melee reach. <b>Thrown</b> / <b>Range (normal/long)</b>.
      <b>Reload / Ammunition</b>: limited shots before reloading a power cell or magazine. <b>Strength N / Dexterity N</b>: need that score or suffer disadvantage.
      <b>Burst</b>, <b>Rapid</b>, <b>Double</b>, <b>Hidden</b>, <b>Silent</b> and other SW5e properties are detailed in the PHB.` },
    { title: 'Damage types', body: 'Acid · Cold · Energy (blasters, lightsabers) · Fire · Force · Ion (especially effective vs droids & electronics) · Kinetic (physical) · Lightning · Necrotic · Poison · Psychic · Sonic. Resistance halves, vulnerability doubles.' },
    { title: 'Currency & XP', body: 'Currency is <b>credits (cr)</b>. Level XP thresholds: 2: 300 · 3: 900 · 4: 2,700 · 5: 6,500 · 6: 14,000 · 7: 23,000 · 8: 34,000 · 9: 48,000 · 10: 64,000 · 11: 85,000 · 12: 100,000 · 13: 120,000 · 14: 140,000 · 15: 165,000 · 16: 195,000 · 17: 225,000 · 18: 265,000 · 19: 305,000 · 20: 355,000.' },
    { title: 'Chat commands', body: `<code>/r 1d20+5 # label</code> roll · <code>/r 2d20kh1+3</code> advantage · <code>/r 4d6dl1</code> drop lowest · <code>/r 1d6!</code> exploding<br>
      <code>/w Name message</code> whisper · <code>/w gm message</code> · <code>/gmr 1d20</code> secret roll to GM · <code>/me waves</code> emote · <code>/desc text</code> GM narration` },
  ];

  const mod = s => Math.floor(((+s || 10) - 10) / 2);
  const fmt = n => (n >= 0 ? '+' : '') + n;
  const totalLevel = c => (c.classes || []).reduce((a, k) => a + (+k.level || 0), 0) || +c.level || 1;
  const profBonus = c => (c.profOverride != null && c.profOverride !== '') ? +c.profOverride : 2 + Math.floor((totalLevel(c) - 1) / 4);
  const abilityMod = (c, ab) => mod((c.abilities || {})[ab]);

  function saveBonus(c, ab) {
    return abilityMod(c, ab) + ((c.saves || {})[ab] ? profBonus(c) : 0) + (+((c.saveMisc || {})[ab]) || 0);
  }
  function skillBonus(c, sk) {
    const def = SKILLS.find(s => s.key === sk);
    const lvl = +((c.skills || {})[sk]) || 0; // 0 none, 0.5 half, 1 prof, 2 expertise
    return abilityMod(c, def.ab) + Math.floor(profBonus(c) * lvl) + (+((c.skillMisc || {})[sk]) || 0);
  }
  const initiative = c => abilityMod(c, 'dex') + (+c.initMisc || 0);
  const passive = (c, sk) => 10 + skillBonus(c, sk);

  // Sentinel table: a new max power level at levels 1, 3, 6, 9, 11, 14 and 17 (up to 7th)
  const THREE_QUARTER_AT = [1, 3, 6, 9, 11, 14, 17];
  // Archetypes that cast (audit 3.13), from SW5e's archetype data (/api/archetype: casterType, and each one's
  // Forcecasting or Techcasting table). They start at class level 3, when the archetype is chosen. Force ones: 1 force
  // point per class level. Tech ones: half the class level, rounded up, in tech points, back on a short rest too. Both
  // reach max power level 1st at 3, 2nd at 7, 3rd at 13 and 4th at 17. An Archaeologist may use Intelligence for its
  // force powers. (Artificer Engineering, Inquisitor Technique and Path of Synthesis also have a casterType: they give a
  // class that already casts two powers of the other kind that count as its own, so they bring no points of their own.)
  const ARCHETYPE_CASTERS = {
    'Beguiler Practice': { cls: 'Operative', caster: 'force' }, 'Marauder Approach': { cls: 'Berserker', caster: 'force' },
    'Adept Specialist': { cls: 'Fighter', caster: 'force' }, 'Aing-Tii Order': { cls: 'Monk', caster: 'force' },
    'Archaeologist Pursuit': { cls: 'Scholar', caster: 'force', int: true },
    'Shield Specialist': { cls: 'Fighter', caster: 'tech' }, 'Industrial Approach': { cls: 'Berserker', caster: 'tech' },
    'Saboteur Practice': { cls: 'Operative', caster: 'tech' }, 'Slicer Pursuit': { cls: 'Scholar', caster: 'tech' },
  };
  const ARCHETYPE_AT = [3, 7, 13, 17];
  // High-level casting (#160), from each class's own text in SW5e's data: from this power level up, each level can be cast
  // only once per long rest (full casters 6th-9th, Sentinel 5th-7th, half casters 4th-5th, casting archetypes 4th)
  const HIGH_FROM = { full: 6, threeQuarter: 5, half: 4, archetype: 4 };
  const lc = s => String(s || '').trim().toLowerCase();
  // the casting archetype a class entry has, by its full name or without its last word ("Marauder", "Aing-Tii")
  function casterArchetype(k) {
    const a = lc(k && k.archetype);
    if (!a) return null;
    const name = Object.keys(ARCHETYPE_CASTERS).find(n => lc(n) === a || lc(n.replace(/\s+\S+$/, '')) === a);
    return name && lc(ARCHETYPE_CASTERS[name].cls) === lc(k.name) ? Object.assign({ name }, ARCHETYPE_CASTERS[name]) : null;
  }
  // Where a character's casting comes from: one entry per class (or archetype) that gives force or tech casting at its
  // level. points: before the ability modifier; maxLevel: its own table; potential: the highest level it ever reaches.
  function castingSources(c) {
    const out = [];
    for (const k of c.classes || []) {
      const def = CLASSES[k.name], L = Math.min(20, +k.level || 0);
      if (def && def.caster && L >= (def.from || 1)) {
        const maxLevel = def.prog === 'full' ? Math.min(9, Math.ceil(L / 2))
          : def.prog === 'threeQuarter' ? THREE_QUARTER_AT.filter(t => L >= t).length : Math.min(5, Math.ceil(L / 4));
        out.push({ of: k.name, caster: def.caster, level: L, points: def.pp * L, maxLevel,
          potential: def.prog === 'full' ? 9 : def.prog === 'threeQuarter' ? 7 : 5, shortRest: !!def.shortRest, highFrom: HIGH_FROM[def.prog] });
      }
      const arch = casterArchetype(k);
      if (arch && L >= 3) {
        out.push({ of: arch.name, caster: arch.caster, level: L, points: arch.caster === 'force' ? L : Math.ceil(L / 2),
          maxLevel: ARCHETYPE_AT.filter(t => L >= t).length, potential: 4, shortRest: arch.caster === 'tech', int: !!arch.int, highFrom: HIGH_FROM.archetype });
      }
    }
    return out;
  }
  // Max power level (audit 3.14). One source: its own table. Two or more of the same kind (PHB, Customization Options,
  // "Max Power Level"): each one's potential max level / 9 x its class levels, added up and rounded down, read from the
  // Multiclass Max Power Level table (1st at 1-2, 2nd at 3-4 ... 9th from 17). The rule's own weights can come out below
  // one class's own table (a Sentinel 3 / Guardian 1 counts as 2nd, so 1st, where Sentinel 3 alone casts at 2nd); a
  // character never loses a level by multiclassing here, so it takes the higher of the two.
  function maxPowerLevel(sources) {
    if (!sources.length) return 0;
    const own = Math.max(...sources.map(s => s.maxLevel));
    if (sources.length === 1) return own;
    const casterLevel = Math.floor(sources.reduce((n, s) => n + s.potential * s.level, 0) / 9);
    return Math.max(own, casterLevel < 1 ? 0 : Math.min(9, Math.ceil(casterLevel / 2)));
  }
  // High-level casting (#160): the power level from which each level may be cast once per long rest, for force or tech
  // (0: none). A multiclassed caster follows the class with the most levels (PHB, Customization Options, "High-Level
  // Casting"); on a tie, the later threshold. c[kind].high lists the levels cast since the last long rest.
  function highCastFrom(c, kind) {
    const src = castingSources(c).filter(s => s.caster === kind);
    if (!src.length) return 0;
    return src.reduce((a, s) => (s.level > a.level || (s.level === a.level && s.highFrom > a.highFrom) ? s : a)).highFrom;
  }
  const highCastUsed = (c, kind) => (Array.isArray(((c || {})[kind] || {}).high) ? c[kind].high.map(Number).filter(n => n >= 1 && n <= 9) : []);
  // a cast at this level that the once-per-long-rest rule stops, or null
  function highCastBlocked(c, pw, level) {
    const kind = pw && pw.type === 'tech' ? 'tech' : 'force', L = +level || 0, from = highCastFrom(c, kind);
    if (!from || L < from || !highCastUsed(c, kind).includes(L)) return null;
    const who = (c && c.name) || 'This character', th = n => n + (n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th');
    return { level: L, from, text: `${who} has already cast a ${th(L)}-level ${kind} power since the last long rest (${th(from)} level and up: once each per long rest).` };
  }
  // a short rest gives back all tech points if any of the character's tech casting comes from an Engineer, a Scout or a
  // tech archetype
  const techOnShortRest = c => castingSources(c).some(s => s.caster === 'tech' && s.shortRest);

  function casterInfo(c) {
    const src = castingSources(c), force = src.filter(s => s.caster === 'force'), tech = src.filter(s => s.caster === 'tech');
    const sum = list => list.reduce((n, s) => n + s.points, 0);
    // an Archaeologist may use Intelligence instead of Wisdom (light side) or Charisma (dark side)
    const int = force.some(s => s.int) ? abilityMod(c, 'int') : -99;
    const light = Math.max(abilityMod(c, 'wis'), int), dark = Math.max(abilityMod(c, 'cha'), int);
    return {
      forceMax: sum(force) ? sum(force) + Math.max(light, dark) : 0, techMax: sum(tech) ? sum(tech) + abilityMod(c, 'int') : 0,
      forceMaxLevel: maxPowerLevel(force), techMaxLevel: maxPowerLevel(tech),
      lightDC: 8 + profBonus(c) + light, darkDC: 8 + profBonus(c) + dark,
      techDC: 8 + profBonus(c) + abilityMod(c, 'int'),
      lightAtk: profBonus(c) + light, darkAtk: profBonus(c) + dark,
      techAtk: profBonus(c) + abilityMod(c, 'int'),
      sources: src.map(s => ({ of: s.of, caster: s.caster, level: s.level, maxLevel: s.maxLevel })),
    };
  }

  // audit 4.5: a power above the character's max power level for its kind (force or tech), or null. ci: casterInfo to
  // check against, when not the character's own (the level-up wizard checks the level being gained).
  function overMaxPowerLevel(c, pw, ci) {
    const lvl = +(pw && pw.level) || 0, tech = pw && pw.type === 'tech';
    const max = (tech ? (ci || casterInfo(c)).techMaxLevel : (ci || casterInfo(c)).forceMaxLevel) || 0;
    if (lvl <= max) return null;
    const who = (c && c.name) || 'This character', kind = tech ? 'tech' : 'force';
    return { level: lvl, max, text: max ? `Level ${lvl} is above ${who}'s max ${kind} power level (${max}).`
      : `${who} can't cast leveled ${kind} powers yet (no max ${kind} power level).` };
  }

  // Armor Class from what's worn (audit 5.3, #74). An item marked as armor ({ kind, ac }) and equipped counts: light is
  // ac + Dex, medium ac + Dex (at most +2), heavy ac; a shield adds its bonus. With no armor, the best of 10 + Dex and
  // SW5e's Unarmored Defense: Berserker 10 + Dex + Con (a shield still counts), Monk 10 + Dex + Wis or Cha and
  // Blademaster Specialist 10 + Dex + Str (both with no shield). The sheet's misc AC is added last. Used only when the
  // sheet's "auto" is on (acAuto); otherwise the typed AC stands, as before.
  const ARMOR_KINDS = ['light', 'medium', 'heavy', 'shield'];
  function armorFromItem(it) {   // a SW5e gear entry (the picker's row) -> { kind, ac } or null
    const kind = String((it && it.accl) || '').toLowerCase(), ac = parseInt(String((it && it.ac) || '').replace(/^\+/, ''), 10);
    return ARMOR_KINDS.includes(kind) && Number.isFinite(ac) ? { kind, ac } : null;
  }
  function armorClass(c) {
    const m = (k) => abilityMod(c, k), dex = m('dex'), lv = (n) => (c.classes || []).some((k) => String(k.name).toLowerCase() === n);
    const worn = (c.equipment || []).filter((e) => e && e.equipped && e.armor && ARMOR_KINDS.includes(e.armor.kind));
    const shields = worn.filter((e) => e.armor.kind === 'shield'), shield = shields.reduce((b, e) => Math.max(b, +e.armor.ac || 0), 0);
    const bodyAc = (e) => { const a = +e.armor.ac || 0; return e.armor.kind === 'light' ? a + dex : e.armor.kind === 'medium' ? a + Math.min(2, dex) : a; };
    const body = worn.filter((e) => e.armor.kind !== 'shield').sort((x, y) => bodyAc(y) - bodyAc(x))[0];
    const misc = +c.acMisc || 0, sh = shields.length ? [`${shields.find((e) => +e.armor.ac === shield).name} +${shield}`] : [];
    let best;
    if (body) best = { v: bodyAc(body) + shield, parts: [`${body.name} (${body.armor.kind}) ${bodyAc(body)}`, ...sh] };
    else {
      const opts = [{ v: 10 + dex + shield, parts: [`unarmored 10 + Dex ${fmt(dex)}`, ...sh] }];
      if (lv('berserker')) opts.push({ v: 10 + dex + m('con') + shield, parts: [`Unarmored Defense (Berserker) 10 + Dex + Con`, ...sh] });
      if (!shields.length && lv('monk')) opts.push({ v: 10 + dex + Math.max(m('wis'), m('cha')), parts: ['Unarmored Defense (Monk) 10 + Dex + Wis or Cha'] });
      if (!shields.length && (c.classes || []).some((k) => /blademaster/i.test(String(k.archetype || '')) && +k.level >= 3))
        opts.push({ v: 10 + dex + m('str'), parts: ['Unarmored Defense (Blademaster) 10 + Dex + Str'] });
      best = opts.sort((x, y) => y.v - x.v)[0];
    }
    return { total: best.v + misc, text: [...best.parts, misc ? `misc ${fmt(misc)}` : ''].filter(Boolean).join(' · ') };
  }
  // the d20 a weapon crits on: 20, or lower for an attack's own crit range or a "Keen N" weapon (SW5e: the range grows by N)
  // Reliable Talent (Operative 11, SW5e): ability checks that add the proficiency bonus get the d20's minimum roll
  // threshold, 8 (PHB chapter 7). Skill rolls with proficiency or expertise use 1d20min8.
  const classLevelOf = (c, name) => (c.classes || []).filter((k) => String(k.name).toLowerCase() === name).reduce((a, k) => a + (+k.level || 0), 0);
  const reliableTalent = (c) => classLevelOf(c, 'operative') >= 11;
  function skillRollExpr(c, sk) {
    const b = skillBonus(c, sk), rt = reliableTalent(c) && +((c.skills || {})[sk] || 0) >= 1;
    return { expr: `1d20${rt ? 'min8' : ''}${b >= 0 ? '+' : ''}${b}`, reliable: rt };
  }
  // Brutal Critical (Berserker 9 / 13 / 17): one, two or three more weapon damage dice on a melee critical hit
  const brutalDice = (c) => { const l = classLevelOf(c, 'berserker'); return l >= 17 ? 3 : l >= 13 ? 2 : l >= 9 ? 1 : 0; };
  const isMelee = (a) => !/\b(range|reload|power cell|slug|ammunition)\b/i.test(String(a.props || ''));
  function critDamage(c, a) {
    const base = critExpr(damageExpr(c, a)), n = isMelee(a) ? brutalDice(c) : 0, die = /d(\d+)/i.exec(String(a.damage || ''));
    return n && die ? { expr: `${base}+${n}d${die[1]}`, brutal: n } : { expr: base, brutal: 0 };
  }
  // Reload N (SW5e): N shots, then a reload (an action or bonus action) that uses one power cell or slug cartridge
  const reloadOf = (a) => { const m = /\breload\s*(\d+)/i.exec(String(a.props || '')); return m ? Math.min(999, +m[1]) : 0; };
  const ammoOf = (a) => /slug/i.test(String(a.props || '')) ? 'Slug cartridge' : /power\s*cell/i.test(String(a.props || '')) || reloadOf(a) ? 'Power cell' : null;
  const shotsOf = (a) => { const n = reloadOf(a); return n ? Math.max(0, Math.min(n, a.shots == null || a.shots === '' ? n : +a.shots || 0)) : null; };

  function critFrom(props) { const k = /\bkeen\s*(\d)/i.exec(String(props || '')); return k ? Math.max(15, 20 - +k[1]) : 20; }

  function attackBonus(c, a) {
    if (a.bonus !== undefined && a.bonus !== '' && a.bonus !== null && !isNaN(+a.bonus)) return +a.bonus;
    let ab = a.ab || 'str';
    if (ab === 'finesse') ab = abilityMod(c, 'dex') > abilityMod(c, 'str') ? 'dex' : 'str';
    return abilityMod(c, ab) + (a.proficient === false ? 0 : profBonus(c)) + (+a.magic || 0);
  }
  function damageExpr(c, a) {
    if (a.damageFull) return a.damageFull;
    let ab = a.ab || 'str';
    if (ab === 'finesse') ab = abilityMod(c, 'dex') > abilityMod(c, 'str') ? 'dex' : 'str';
    const m = a.noModDamage ? 0 : abilityMod(c, ab) + (+a.magic || 0);
    const base = a.damage || '1';
    return m ? base + (m > 0 ? '+' : '') + m : base;
  }
  // double the dice in an expression for a critical
  const critExpr = e => e.replace(/(\d*)d(\d+)/gi, (_, n, s) => (2 * (+n || 1)) + 'd' + s);

  function hitDiceSummary(c) {
    const by = {};
    for (const k of c.classes || []) {
      const hd = (CLASSES[k.name] || {}).hd || +k.hd || 8;
      by[hd] = (by[hd] || 0) + (+k.level || 0);
    }
    return Object.entries(by).map(([d, n]) => n + 'd' + d).join(' + ') || (totalLevel(c) + 'd8');
  }

  // Hit dice by size (audit 7.2): [{ die: 10, total: 3, used: 1, classes: ['Fighter 3'] }], largest first. The used
  // counts are kept per size in hitDiceUsed ({ d10: 1, d6: 0 }); an old single number is read as that many of the
  // largest dice, which is how the sheet spent them before.
  function hitDice(c) {
    const by = {};
    for (const k of c.classes || []) {
      const hd = (CLASSES[k.name] || {}).hd || +k.hd || 8, L = +k.level || 0;
      if (!L) continue;
      const d = by[hd] = by[hd] || { die: hd, total: 0, used: 0, classes: [] };
      d.total += L; d.classes.push(`${k.name} ${L}`);
    }
    const list = Object.values(by).sort((a, b) => b.die - a.die);
    if (!list.length) list.push({ die: 8, total: totalLevel(c), used: 0, classes: [] });
    const u = c.hitDiceUsed;
    if (u && typeof u === 'object') for (const d of list) d.used = Math.max(0, Math.min(d.total, +u['d' + d.die] || 0));
    else { let n = Math.max(0, +u || 0); for (const d of list) { d.used = Math.min(d.total, n); n -= d.used; } }
    return list;
  }
  // hitDiceUsed as stored: per die size ({ d10: 2, d6: 1 }, whole numbers 0-40) or an old single number. The one cleaner
  // for every place that keeps it (the sheet, the combat view's undo), so none of them drops the per-die shape.
  const cleanHitDiceUsed = u => u && typeof u === 'object' && !Array.isArray(u)
    ? Object.fromEntries(Object.entries(u).filter(([k]) => /^d(4|6|8|10|12|20)$/.test(k)).map(([k, v]) => [k, Math.max(0, Math.min(40, parseInt(v, 10) || 0))]))
    : (u === '' || u == null || !Number.isFinite(+u) ? 0 : +u);
  const hitDiceUsedTotal = c => hitDice(c).reduce((n, d) => n + d.used, 0);
  const hitDiceUsedOf = list => Object.fromEntries(list.map(d => ['d' + d.die, d.used]));
  // Force Recovery (Consular, 1st level): on a short rest, half the consular level plus Wis or Cha (the better), at least 1
  const forceRecovery = c => {
    const k = (c.classes || []).find(x => x.name === 'Consular' && (+x.level || 0) >= 1);
    return k ? Math.max(1, Math.floor((+k.level || 0) / 2) + Math.max(abilityMod(c, 'wis'), abilityMod(c, 'cha'))) : 0;
  };

  // ---- ability scores (audit 1.4), from SW5e's Player's Handbook, "Step-By-Step Characters": roll four d6 and keep the
  // highest three, six times, or use the standard set 15, 14, 13, 12, 10, 8; then place each number on an ability. The
  // variant "Customizing Ability Scores" (the GM's option) spends 27 points on scores from 8 to 15 at these costs.
  const STANDARD_ARRAY = [15, 14, 13, 12, 10, 8];
  const POINT_COST = { 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9 };
  const POINT_BUDGET = 27;
  // what a set of scores ({ str: 8, ... }) costs under point buy; Infinity when one is outside 8-15
  const pointBuyCost = scores => ABILITIES.reduce((n, a) => n + (POINT_COST[+scores[a.key]] ?? Infinity), 0);
  // do these scores use each of the six numbers exactly once?
  const usesEachOnce = (scores, values) => {
    const got = ABILITIES.map(a => +scores[a.key]).sort((x, y) => x - y), want = (values || []).map(Number).sort((x, y) => x - y);
    return want.length === 6 && got.every((v, i) => v === want[i]);
  };

  function blankCharacter() {
    return {
      _format: 'holotable-sw5e', name: 'New Character', species: 'Human', background: '', alignment: '',
      classes: [{ name: 'Fighter', level: 1, archetype: '' }], xp: 0,
      abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
      saves: {}, skills: {}, skillMisc: {}, saveMisc: {},
      ac: 10, speed: 30, hp: { max: 10, current: 10, temp: 0 }, hitDiceUsed: 0,
      deathSaves: { s: 0, f: 0 }, initMisc: 0, profOverride: '',
      force: { max: '', used: 0 }, tech: { max: '', used: 0 },
      attacks: [], powers: [], features: [], equipment: [], credits: 0,
      conditions: [], exhaustion: 0, inspiration: false,
      proficiencies: '', languages: 'Galactic Basic', notes: '', image: '', color: '#4fc3f7',
    };
  }

  // ---- class tables (audit 3.2-3.11), generated from SW5e's class data (/api/class, levelChanges) by
  // gen_classes.py: each class's table columns by level (spell-point columns are left to casterInfo), and the
  // spendable uses each class gets, in the combat view's resource shape (max / die read at the class level).
  const CLASS_TABLE = {"Berserker":{"Rages":["2","2","3","3","3","4","4","4","4","4","4","5","5","5","5","5","6","6","6","Unlimited"],"Rage Damage":["+2","+2","+2","+2","+2","+2","+2","+2","+3","+3","+3","+3","+4","+4","+4","+4","+5","+5","+5","+5"],"Berserker Instincts":["","2","2","2","2","2","3","3","3","3","3","3","4","4","4","4","5","5","5","5"]},"Consular":{"Force Powers Known":["9","11","13","15","17","19","21","23","25","26","28","29","31","32","34","35","37","38","39","40"],"Force-Empowered Casting Options":["","2","2","2","2","2","2","2","3","3","3","3","3","3","3","3","4","4","4","4"]},"Engineer":{"Tech Powers Known":["6","7","9","10","12","13","15","16","18","19","21","22","23","24","25","26","27","28","29","30"],"Potent Aptitude":["d4","d4","d4","d4","d6","d6","d6","d6","d8","d8","d8","d8","d10","d10","d10","d10","d12","d12","d12","d12"],"Modification Slots":["","","4","4","5","5","5","5","6","6","7","7","8","8","8","8","9","9","9","9"]},"Fighter":{"Maneuvers Known":["","1","2","2","4","4","5","5","6","6","7","7","9","9","10","10","11","11","12","12"],"Superiority Dice Quantity":["","2","2","2","3","3","3","3","4","4","4","4","5","5","5","5","6","6","6","6"],"Superiority Dice Size":["","d4","d4","d4","d6","d6","d6","d6","d8","d8","d8","d8","d10","d10","d10","d10","d12","d12","d12","d12"],"Strategies Known":["","","1","1","1","1","2","2","2","2","2","2","3","3","3","3","4","4","4","4"]},"Guardian":{"Force Powers Known":["5","7","9","10","12","13","14","15","17","18","19","20","22","23","24","25","27","28","29","30"],"Focused Strikes":["","2d8","2d8","2d8","3d8","3d8","3d8","3d8","4d8","4d8","4d8","4d8","5d8","5d8","5d8","5d8","6d8","6d8","6d8","6d8"],"Auras Known":["","","1","1","1","1","1","1","1","2","2","2","2","2","2","2","2","3","3","3"],"Aura Radius":["","","5 ft.","5 ft.","5 ft.","5 ft.","5 ft.","5 ft.","15 ft.","15 ft.","15 ft.","15 ft.","15 ft.","15 ft.","15 ft.","15 ft.","30 ft.","30 ft.","30 ft.","30 ft."]},"Monk":{"Martial Arts":["d4","d4","d4","d4","d6","d6","d6","d6","d8","d8","d8","d8","d10","d10","d10","d10","d12","d12","d12","d12"],"Focus Points":["","2","3","4","5","6","7","8","9","10","11","12","13","14","15","16","17","18","19","20"],"Monastic Vows":["","2","2","2","2","2","3","3","3","3","3","3","4","4","4","4","5","5","5","5"],"Unarmored Movement":["","","+10 ft.","+10 ft.","+15 ft.","+15 ft.","+15 ft.","+15 ft.","+20 ft.","+20 ft.","+20 ft.","+20 ft.","+25 ft.","+25 ft.","+25 ft.","+25 ft.","+30 ft.","+30 ft.","+30 ft.","+30 ft."]},"Operative":{"Sneak Attack":["1d6","1d6","2d6","2d6","3d6","3d6","4d6","4d6","5d6","5d6","6d6","6d6","7d6","7d6","8d6","8d6","9d6","9d6","10d6","10d6"],"Operative Exploits":["","2","2","2","2","2","3","3","3","3","3","3","4","4","4","4","5","5","5","5"]},"Scholar":{"Maneuvers Known":["1","2","4","5","6","7","9","10","11","12","14","15","16","17","19","20","21","22","23","24"],"Superiority Dice Quantity":["3","3","4","4","5","5","6","6","7","7","8","8","9","9","10","10","11","11","12","12"],"Superiority Dice Size":["d4","d4","d4","d4","d6","d6","d6","d6","d8","d8","d8","d8","d10","d10","d10","d10","d12","d12","d12","d12"],"Discoveries":["","2","4","4","5","5","5","5","6","6","7","7","8","8","8","8","9","9","9","9"]},"Scout":{"Ranger's Quarry":["d4","d4","d4","d4","d6","d6","d6","d6","d8","d8","d8","d8","d10","d10","d10","d10","d12","d12","d12","d12"],"Tech Powers Known":["","4","5","6","7","8","9","10","12","13","14","15","16","17","18","19","20","21","22","23"],"Routines Known":["","","1","1","1","1","2","2","2","2","2","2","2","2","3","3","3","3","3","3"],"Routine Radius":["","","5 ft.","5 ft.","5 ft.","5 ft.","5 ft.","5 ft.","15 ft.","15 ft.","15 ft.","15 ft.","15 ft.","15 ft.","15 ft.","15 ft.","30 ft.","30 ft.","30 ft.","30 ft."]},"Sentinel":{"Force Powers Known":["7","9","11","13","15","17","18","19","21","22","24","25","26","28","29","30","32","33","34","35"],"Kinetic Combat":["","d4","d4","d4","d6","d6","d6","d6","d8","d8","d8","d8","d10","d10","d10","d10","d12","d12","d12","d12"],"Ideals Known":["","2","2","2","2","3","3","3","3","3","4","4","4","4","4","4","4","4","4","4"],"Ideal Manifests":["","2","2","2","2","2","2","2","3","3","3","3","3","3","3","3","4","4","4","4"]}};
  const CLASS_RESOURCES = {"Berserker":[{"key":"rage","name":"Rages","max":{"class":"Berserker","levels":[2,2,3,3,3,4,4,4,4,4,4,5,5,5,5,5,6,6,6,99]},"refill":"long"}],"Consular":[{"key":"force-shield","name":"Force Shield","max":{"class":"Consular","levels":[0,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,6,6,6,6]},"refill":"long"}],"Engineer":[{"key":"potent-aptitude","name":"Potent Aptitude","max":{"class":"Engineer","levels":[2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,6,6,6,6]},"die":{"class":"Engineer","levels":["d4","d4","d4","d4","d6","d6","d6","d6","d8","d8","d8","d8","d10","d10","d10","d10","d12","d12","d12","d12"]},"refill":"short"}],"Fighter":[{"key":"superiority","name":"Superiority dice","max":{"class":"Fighter","levels":[0,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,6,6,6,6]},"die":{"class":"Fighter","levels":["","d4","d4","d4","d6","d6","d6","d6","d8","d8","d8","d8","d10","d10","d10","d10","d12","d12","d12","d12"]},"refill":"short"},{"key":"second-wind","name":"Second Wind","max":{"class":"Fighter","levels":[1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1]},"refill":"short"},{"key":"action-surge","name":"Action Surge","max":{"class":"Fighter","levels":[0,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,2,2,2,2]},"refill":"short"},{"key":"indomitable","name":"Indomitable","max":{"class":"Fighter","levels":[0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3]},"refill":"long"}],"Guardian":[{"key":"channel-the-force","name":"Channel the Force","max":{"class":"Guardian","levels":[2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,6,6,6,6]},"refill":"short"}],"Monk":[{"key":"focus","name":"Focus points","max":{"class":"Monk","levels":[0,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20]},"refill":"short"}],"Scholar":[{"key":"superiority-scholar","name":"Superiority dice (Scholar)","max":{"class":"Scholar","levels":[3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12]},"die":{"class":"Scholar","levels":["d4","d4","d4","d4","d6","d6","d6","d6","d8","d8","d8","d8","d10","d10","d10","d10","d12","d12","d12","d12"]},"refill":"short"}],"Sentinel":[{"key":"ideal-manifests","name":"Ideal manifests","max":{"class":"Sentinel","levels":[0,2,2,2,2,2,2,2,3,3,3,3,3,3,3,3,4,4,4,4]},"refill":"long"}]};
  const classOf = name => Object.keys(CLASS_TABLE).find(k => k.toLowerCase() === String(name || '').trim().toLowerCase());
  const levelIn = (c, cls) => { const k = (c.classes || []).find(x => classOf(x.name) === classOf(cls)); return k ? +k.level || 0 : 0; };
  // a resource's max or die at the character's level in its class (plain values pass through)
  const resAt = (c, v) => {
    if (v == null || typeof v !== 'object') return v;
    const L = Math.min(20, levelIn(c, v.class));
    return L >= 1 && Array.isArray(v.levels) ? v.levels[L - 1] : null;
  };
  const classPresets = c => (c.classes || []).flatMap(k => CLASS_RESOURCES[classOf(k.name)] || []);
  // the class uses this character has at its level but hasn't added yet
  const missingClassResources = c => {
    const have = new Set((c.resources || []).map(r => r.key));
    return classPresets(c).filter(p => !have.has(p.key) && (+resAt(c, p.max) || 0) > 0);
  };
  // the resource list with the class uses added: every existing resource and its used count stays; class ones take
  // the current table (so a fix to the data reaches old sheets)
  function withClassResources(c) {
    const by = new Map(classPresets(c).map(p => [p.key, p]));
    const kept = (c.resources || []).map(r => (by.has(r.key) ? Object.assign({}, by.get(r.key), { used: +r.used || 0 }) : r));
    const have = new Set(kept.map(r => r.key));
    return kept.concat(missingClassResources(c).filter(p => !have.has(p.key)).map(p => Object.assign({}, p, { used: 0 })));
  }
  // the resources as numbers for the sheet: index in c.resources, max and die at this level, used (kept within max)
  const resourceRows = c => (c.resources || []).map((r, i) => {
    const max = +resAt(c, r.max) || 0;
    return { i, key: r.key, name: r.name || r.key, max, die: resAt(c, r.die) || '', used: Math.max(0, Math.min(max, +r.used || 0)), refill: r.refill };
  }).filter(r => r.max > 0);
  // each class's table values at its level (Rage Damage +2, Sneak Attack 3d6, Martial Arts d6...), blanks left out
  const classTableAt = c => (c.classes || []).map(k => {
    const cls = classOf(k.name), L = Math.min(20, +k.level || 0);
    if (!cls || L < 1) return null;
    return { cls, level: L, cols: Object.entries(CLASS_TABLE[cls]).map(([h, v]) => [h, v[L - 1]]).filter(([, v]) => v) };
  }).filter(Boolean);

  // ---- senses (audit 5.12): [{ kind, range }] on the sheet. The four kinds SW5e's creatures and species use; feet 1-9999.
  const SENSES = ['darkvision', 'blindsight', 'tremorsense', 'truesight'];
  function cleanSenses(list) {
    const best = {};
    for (const x of Array.isArray(list) ? list.slice(0, 12) : []) {
      const kind = String((x && x.kind) || '').toLowerCase(), range = Math.round(+(x && x.range));
      if (SENSES.includes(kind) && range >= 1) best[kind] = Math.min(9999, Math.max(best[kind] || 0, range));
    }
    return SENSES.filter(k => best[k]).map(k => ({ kind: k, range: best[k] }));
  }
  // a species' senses from its traits ("Darkvision ... within 60 feet", "Energy Sensors ... blindsight ... 30 feet")
  function sensesFromTraits(traits) {
    const out = [];
    for (const t of Array.isArray(traits) ? traits : []) {
      const txt = `${(t && t.n) || ''} ${(t && t.d) || ''}`, m = /(darkvision|blindsight|tremorsense|truesight)/i.exec(txt);
      const ft = /(\d+)\s*(?:feet|ft)/i.exec((t && t.d) || '');
      if (m && ft) out.push({ kind: m[1].toLowerCase(), range: +ft[1] });
    }
    return cleanSenses(out);
  }
  const sensesText = list => cleanSenses(list).map(x => `${x.kind[0].toUpperCase()}${x.kind.slice(1)} ${x.range} ft`).join(' · ');
  // "darkvision 60, blindsight 30" (the GM's typing) to the list
  const parseSenses = text => cleanSenses(String(text || '').split(/[,;·\n]+/).map(p => { const m = /([a-z]+)\D*(\d+)/i.exec(p); return m && { kind: m[1], range: +m[2] }; }).filter(Boolean));

  root.SW5E = { ABILITIES, SKILLS, CLASSES, SPECIES, BACKGROUNDS, DAMAGE_TYPES, WEAPONS, CONDITIONS, REFERENCE,
    mod, fmt, totalLevel, profBonus, abilityMod, saveBonus, skillBonus, initiative, passive, casterInfo, techOnShortRest, overMaxPowerLevel, highCastFrom, highCastUsed, highCastBlocked,
    ARCHETYPE_CASTERS, casterArchetype, castingSources,
    attackBonus, damageExpr, critExpr, armorClass, armorFromItem, critFrom, ARMOR_KINDS, reliableTalent, skillRollExpr, brutalDice, critDamage, isMelee, reloadOf, ammoOf, shotsOf, hitDiceSummary, hitDice, hitDiceUsedTotal, hitDiceUsedOf, cleanHitDiceUsed, forceRecovery, blankCharacter, STANDARD_ARRAY, POINT_COST, POINT_BUDGET, pointBuyCost, usesEachOnce,
    CLASS_TABLE, CLASS_RESOURCES, missingClassResources, withClassResources, resourceRows, classTableAt,
    SENSES, cleanSenses, sensesFromTraits, sensesText, parseSenses };
})(typeof window !== 'undefined' ? window : globalThis);
