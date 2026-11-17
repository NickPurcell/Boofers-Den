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
  // a short rest gives back all tech points if any of the character's tech casting comes from an Engineer or Scout
  const techOnShortRest = c => (c.classes || []).some(k => { const d = CLASSES[k.name]; return d && d.shortRest && (+k.level || 0) >= (d.from || 1); });

  function casterInfo(c) {
    let force = 0, tech = 0, forceLvl = 0, techLvl = 0;
    const maxLvl = (prog, L) => (L < 1 ? 0 : prog === 'full' ? Math.min(9, Math.ceil(L / 2))
      : prog === 'threeQuarter' ? THREE_QUARTER_AT.filter(t => L >= t).length : Math.min(5, Math.ceil(L / 4)));
    for (const k of c.classes || []) {
      const def = CLASSES[k.name];
      if (!def || !def.caster) continue;
      const L = (+k.level || 0) >= (def.from || 1) ? +k.level || 0 : 0;
      if (def.caster === 'force') { force += def.pp * L; forceLvl = Math.max(forceLvl, maxLvl(def.prog, L)); }
      else { tech += def.pp * L; techLvl = Math.max(techLvl, maxLvl(def.prog, L)); }
    }
    const fAb = Math.max(abilityMod(c, 'wis'), abilityMod(c, 'cha'));
    return {
      forceMax: force ? force + fAb : 0, techMax: tech ? tech + abilityMod(c, 'int') : 0,
      forceMaxLevel: forceLvl, techMaxLevel: techLvl,
      lightDC: 8 + profBonus(c) + abilityMod(c, 'wis'), darkDC: 8 + profBonus(c) + abilityMod(c, 'cha'),
      techDC: 8 + profBonus(c) + abilityMod(c, 'int'),
      lightAtk: profBonus(c) + abilityMod(c, 'wis'), darkAtk: profBonus(c) + abilityMod(c, 'cha'),
      techAtk: profBonus(c) + abilityMod(c, 'int'),
    };
  }

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

  root.SW5E = { ABILITIES, SKILLS, CLASSES, SPECIES, BACKGROUNDS, DAMAGE_TYPES, WEAPONS, CONDITIONS, REFERENCE,
    mod, fmt, totalLevel, profBonus, abilityMod, saveBonus, skillBonus, initiative, passive, casterInfo, techOnShortRest,
    attackBonus, damageExpr, critExpr, hitDiceSummary, hitDice, hitDiceUsedTotal, hitDiceUsedOf, cleanHitDiceUsed, forceRecovery, blankCharacter };
})(typeof window !== 'undefined' ? window : globalThis);
