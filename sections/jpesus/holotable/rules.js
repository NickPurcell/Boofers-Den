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

  // caster: force/tech; pp = power points per class level; prog = full | threeQuarter | half
  const CLASSES = {
    Berserker: { hd: 12, saves: ['str', 'con'] },
    Consular:  { hd: 6,  saves: ['wis', 'cha'], caster: 'force', pp: 4, prog: 'full' },
    Engineer:  { hd: 8,  saves: ['con', 'int'], caster: 'tech',  pp: 2, prog: 'full' },
    Fighter:   { hd: 10, saves: ['str', 'con'] },
    Guardian:  { hd: 10, saves: ['con', 'cha'], caster: 'force', pp: 2, prog: 'half' },
    Monk:      { hd: 8,  saves: ['str', 'dex'] },
    Operative: { hd: 8,  saves: ['dex', 'cha'] },
    Scholar:   { hd: 8,  saves: ['int', 'wis'] },
    Scout:     { hd: 10, saves: ['str', 'dex'], caster: 'tech',  pp: 1, prog: 'half' },
    Sentinel:  { hd: 8,  saves: ['dex', 'cha'], caster: 'force', pp: 3, prog: 'threeQuarter' },
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

  const CONDITIONS = {
    Blinded: 'Can\'t see; auto-fails sight checks. Attacks against it have advantage; its attacks have disadvantage.',
    Charmed: 'Can\'t attack or target the charmer with harmful effects. Charmer has advantage on social checks with it.',
    Deafened: 'Can\'t hear; auto-fails hearing checks.',
    Exhaustion: 'Cumulative levels: 1 disadv. on checks · 2 speed halved · 3 disadv. on attacks & saves · 4 HP max halved · 5 speed 0 · 6 death. Long rest removes one level.',
    Frightened: 'Disadvantage on checks and attacks while the source is in sight; can\'t willingly move closer to it.',
    Grappled: 'Speed 0. Ends if the grappler is incapacitated or it is moved out of reach.',
    Incapacitated: 'Can\'t take actions or reactions.',
    Invisible: 'Can\'t be seen without special senses. Its attacks have advantage; attacks against it have disadvantage.',
    Paralyzed: 'Incapacitated, can\'t move or speak. Fails Str/Dex saves. Attacks against it have advantage; hits from within 5 ft are critical.',
    Petrified: 'Turned to inanimate substance (e.g., carbonite). Incapacitated, unaware, resistant to all damage, fails Str/Dex saves.',
    Poisoned: 'Disadvantage on attack rolls and ability checks.',
    Prone: 'Can only crawl; disadvantage on attacks. Melee attacks within 5 ft have advantage against it, ranged attacks have disadvantage. Standing costs half speed.',
    Restrained: 'Speed 0. Its attacks and Dex saves have disadvantage; attacks against it have advantage.',
    Shocked: 'SW5e condition — the creature\'s reactions and actions are disrupted (see SW5e PHB for exact effect).',
    Slowed: 'SW5e condition — the creature\'s speed is reduced (see SW5e PHB for exact amount).',
    Stunned: 'Incapacitated, can\'t move, speaks falteringly. Fails Str/Dex saves; attacks against it have advantage.',
    Unconscious: 'Incapacitated, drops what it holds, falls prone. Fails Str/Dex saves; attacks have advantage, and hits within 5 ft are critical.',
    Weakened: 'SW5e condition — the creature deals reduced weapon damage (see SW5e PHB for exact effect).',
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
      Tech point max = (class multiplier × class level) + Int modifier. Casting costs <b>1 + power level</b> tech points; points return on a long rest.<br>
      Save DC = 8 + proficiency + Int mod · Attack = proficiency + Int mod.` },
    { title: 'Concentration', body: 'Some powers need concentration. Taking damage forces a Con save, DC 10 or half the damage (whichever is higher), or the power ends. Only one concentration power at a time.' },
    { title: 'Resting', body: `<b>Short rest</b> (1 hour): spend Hit Dice — roll each + Con mod and regain that many HP.<br>
      <b>Long rest</b> (8 hours): regain all HP, all force/tech points, and up to half your total Hit Dice (min 1). Only one per 24 hours.` },
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

  function casterInfo(c) {
    let force = 0, tech = 0, forceLvl = 0, techLvl = 0;
    const maxLvl = (prog, L) => prog === 'full' ? Math.min(9, Math.ceil(L / 2)) : prog === 'threeQuarter' ? Math.min(7, Math.ceil(L / 3)) : Math.min(5, Math.ceil(L / 4));
    for (const k of c.classes || []) {
      const def = CLASSES[k.name];
      if (!def || !def.caster) continue;
      const L = +k.level || 0;
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
    mod, fmt, totalLevel, profBonus, abilityMod, saveBonus, skillBonus, initiative, passive, casterInfo,
    attackBonus, damageExpr, critExpr, hitDiceSummary, blankCharacter };
})(typeof window !== 'undefined' ? window : globalThis);
