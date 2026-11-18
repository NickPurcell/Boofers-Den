/* Character sheet importer.
 * Accepts:
 *  - SW5e.com character builder: "Roll20" export (exportedBy www.sw5e.com, attribs[])
 *  - SW5e.com character builder: raw character JSON (baseAbilityScores, classes[].levels, currentStats …)
 *  - Foundry VTT (sw5e system) actor export
 *  - HoloTable JSON, and a loose "generic" JSON
 * Always returns { char, notes[], source } — notes list anything the user should double-check. */
(function (root) {
  const { SKILLS, ABILITIES, CLASSES, WEAPONS, blankCharacter } = root.SW5E;
  const ABBR = { strength: 'str', dexterity: 'dex', constitution: 'con', intelligence: 'int', wisdom: 'wis', charisma: 'cha',
    str: 'str', dex: 'dex', con: 'con', int: 'int', wis: 'wis', cha: 'cha' };
  const abKey = s => ABBR[String(s || '').toLowerCase().trim()];
  const norm = s => String(s || '').toLowerCase().replace(/[^a-z]/g, '');
  const skillKey = name => { const n = norm(name); const s = SKILLS.find(s => norm(s.name) === n || s.key.toLowerCase() === n); return s && s.key; };
  const num = (v, d = 0) => { const n = parseFloat(v); return isNaN(n) ? d : n; };
  const cleanHtml = s => String(s || '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n').replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\r/g, '').trim();
  const titleCase = s => String(s || '').trim().replace(/\b\w/g, m => m.toUpperCase());
  const classDef = name => CLASSES[titleCase(name)] || null;
  const conModOf = c => Math.floor((c.abilities.con - 10) / 2);
  const pbFor = lvl => 2 + Math.floor((Math.max(1, lvl) - 1) / 4);

  function attackFromWeapon(name) {
    const w = WEAPONS.find(w => norm(w.name) === norm(name));
    return w && { name: w.name, ab: w.ab, damage: w.damage, type: w.type, props: w.props, proficient: true };
  }

  function importAny(raw) {
    let obj = raw;
    if (typeof raw === 'string') obj = JSON.parse(raw.replace(/^﻿/, ''));
    if (Array.isArray(obj)) return obj.map(o => importAny(o));
    if (obj && typeof obj.jsonData === 'string') obj = JSON.parse(obj.jsonData);          // SW5e API wrapper
    if (obj && obj.character && typeof obj.character === 'object' && !obj.attribs) obj = obj.character;
    if (obj._format === 'holotable-sw5e') return { char: Object.assign(blankCharacter(), obj, { id: undefined, owner: undefined }), notes: [], source: 'HoloTable' };
    if (Array.isArray(obj.attribs)) return fromRoll20(obj);
    if (obj.items && (obj.system || obj.data) && ((obj.system || obj.data).abilities)) return fromFoundry(obj);
    if (obj.baseAbilityScores || (Array.isArray(obj.classes) && obj.classes.some(c => 'levels' in c))) return fromSw5eBuilder(obj);
    return fromGeneric(obj);
  }

  // ---------------------------------------------------------------- SW5e.com builder → Roll20 export
  function fromRoll20(o) {
    const c = blankCharacter(), notes = [];
    const A = {}, AM = {}, rep = {};
    for (const a of o.attribs) {
      A[a.name] = a.current; AM[a.name] = a.max;
      const m = /^repeating_([a-z0-9-]+)_(-?[A-Za-z0-9_-]{15,25}?)_(.+)$/.exec(a.name);
      if (m) { ((rep[m[1]] = rep[m[1]] || {})[m[2]] = rep[m[1]][m[2]] || {})[m[3]] = a.current; }
    }
    const rows = sec => Object.values(rep[sec] || {});
    c.name = o.name || A.character_name || c.name;
    if (/^https?:/.test(o.avatar || '')) c.image = o.avatar;
    c.species = A.race_display || A.race || '';
    c.background = A.background || '';
    c.alignment = A.alignment || '';
    c.xp = num(A.experience);

    // classes: "Guardian 3 / Scout 2" in class_display, else class + level
    const disp = String(A.class_display || '');
    const found = [...disp.matchAll(/([A-Za-z][A-Za-z ']*?)\s+(\d+)/g)].map(m => ({ name: titleCase(m[1]), level: +m[2], archetype: '' }));
    c.classes = found.length ? found : [{ name: titleCase(A.class || 'Fighter'), level: num(A.level || A.base_level, 1), archetype: '' }];
    if (A.subclass) c.classes[0].archetype = A.subclass;
    const lvl = c.classes.reduce((s, k) => s + k.level, 0);
    const pb = num(A.pb, pbFor(lvl));

    for (const a of ABILITIES) {
      c.abilities[a.key] = num(A[a.name.toLowerCase()], 10);
      const p = String(A[a.name.toLowerCase() + '_save_prof'] || '0');
      c.saves[a.key] = p !== '0' && p !== '';
    }
    // skills: use the prof flag when present, otherwise infer from the exported bonus
    for (const s of SKILLS) {
      const k = s.key.replace(/[A-Z]/g, m => '_' + m.toLowerCase());
      const prof = String(A[k + '_prof'] || '0'), type = String(A[k + '_type'] || '0');
      let level = 0;
      if (prof !== '0' && prof !== '') level = /\*\s*2|expert/i.test(prof) || type === '2' ? 2 : 1;
      else if (A[k + '_bonus'] != null) {
        const diff = num(A[k + '_bonus']) - Math.floor((c.abilities[s.ab] - 10) / 2);
        if (diff >= 2 * pb) level = 2; else if (diff >= pb) level = 1;
      }
      if (level) c.skills[s.key] = level;
    }

    c.ac = num(A.ac, 10);
    c.speed = num(A.speed, 30);
    const hpMax = num(AM.hp, num(A.hp_max, num(A.hp, 10)));
    c.hp = { max: hpMax || 10, current: num(A.hp, hpMax), temp: num(A.hp_temp) };
    c.hitDiceUsed = Math.max(0, lvl - num(A.hit_dice, lvl));
    const fpT = num(A.force_power_points_total), fpE = num(A.force_power_points_expended);
    const tpT = num(A.tech_power_points_total), tpE = num(A.tech_power_points_expended);
    if (fpT) { c.force.max = fpT; c.force.used = Math.max(0, fpT - fpE); }
    if (tpT) { c.tech.max = tpT; c.tech.used = Math.max(0, tpT - tpE); }
    if (fpT || tpT) notes.push('Force/tech point max taken from the export. Points are set to full — adjust “used” if needed.');
    if (A.initiative_bonus && num(A.initiative_bonus) !== Math.floor((c.abilities.dex - 10) / 2)) c.initMisc = num(A.initiative_bonus) - Math.floor((c.abilities.dex - 10) / 2);
    if (A.pb && num(A.pb) !== pbFor(lvl)) c.profOverride = num(A.pb);

    // powers: sections power-cantrip, power-1 … power-9
    for (const [sec, items] of Object.entries(rep)) {
      const m = /^power-(cantrip|\d)$/.exec(sec);
      if (!m) continue;
      for (const p of Object.values(items)) {
        if (!p.powername) continue;
        const school = String(p.powerschool || '').toLowerCase();
        const details = [p.powercastingtime, p.powerrange && 'Range ' + p.powerrange, p.powerduration,
          p.powerconcentration === '1' || /concentration/i.test(p.powerduration || '') ? 'Concentration' : ''].filter(Boolean).join(' · ');
        c.powers.push({ name: p.powername, level: m[1] === 'cantrip' ? 0 : +m[1], type: school.includes('tech') ? 'tech' : 'force',
          // the casting ability reveals the side: Wisdom = light, Charisma = dark
          alignment: /light/.test(school) || /wisdom/.test(p.power_ability || '') ? 'light'
            : /dark/.test(school) || /charisma/.test(p.power_ability || '') ? 'dark' : 'universal',
          notes: details, description: cleanHtml(p.powerdescription) });
      }
    }
    // attacks
    const abFromAttr = s => { const m = /@\{(\w+)_mod\}/.exec(s || ''); return m ? abKey(m[1]) : null; };
    for (const a of rows('attack')) {
      if (!a.atkname) continue;
      const ab = abFromAttr(a.atkattr_base) || 'str';
      c.attacks.push({ name: a.atkname, ab, bonus: a.atkbonus !== undefined && a.atkbonus !== '' ? num(a.atkbonus) : '',
        damage: a.dmgbase || '1', noModDamage: !abFromAttr(a.dmgattr), type: String(a.dmgtype || '').toLowerCase(),
        props: [a.atkrange, a.saveeffect].map(s => String(s || '').trim()).filter(Boolean).join(' · '), proficient: true });
    }
    for (const it of rows('inventory')) if (it.itemname) c.equipment.push({ name: it.itemname, qty: num(it.itemcount, 1), notes: it.itemweight ? it.itemweight + ' lb' : '' });
    for (const t of rows('traits')) if (t.name) c.features.push({ name: t.name, text: cleanHtml(t.description) });
    const profs = rows('proficiencies'), langs = profs.filter(p => /lang/i.test(p.prof_type || '') || !p.prof_type);
    c.languages = langs.map(p => p.name).filter(Boolean).join(', ') || c.languages;
    c.proficiencies = [...profs.filter(p => !langs.includes(p)).map(p => p.name), ...rows('tool').map(t => t.toolname)].filter(Boolean).join(', ');
    c.notes = [A.character_backstory, A.personality_traits && 'Personality: ' + A.personality_traits, A.ideals && 'Ideal: ' + A.ideals,
      A.bonds && 'Bond: ' + A.bonds, A.flaws && 'Flaw: ' + A.flaws, A.character_appearance && 'Appearance: ' + A.character_appearance,
      [A.age && 'Age ' + A.age, A.height, A.hair && 'Hair: ' + A.hair, A.eyes && 'Eyes: ' + A.eyes, A.skin && 'Skin: ' + A.skin].filter(Boolean).join(' · '),
      cleanHtml(o.bio)].filter(Boolean).join('\n\n').replace(/�/g, '’');
    return { char: c, notes, source: 'SW5e.com builder (Roll20 export)' };
  }

  // ---------------------------------------------------------------- SW5e.com builder → raw character JSON
  function fromSw5eBuilder(o) {
    const c = blankCharacter(), notes = [];
    const T = o.tweaks || {};
    const tweak = (t, base) => !t ? base : (t.override != null && t.override !== '' ? +t.override : base + (+t.bonus || 0));
    c.name = o.name || c.name;
    if (/^https?:/.test(o.image || '')) c.image = o.image;
    c.species = (o.species && (o.species.name || o.species)) || '';
    c.background = (o.background && (o.background.name || o.background)) || '';
    const ch = o.characteristics || {};
    c.alignment = ch.alignment || '';
    c.xp = num(o.experiencePoints);
    c.credits = num(o.credits);
    c.classes = (o.classes || []).map(k => ({ name: titleCase(k.name), level: num(k.levels, 1), archetype: (k.archetype && k.archetype.name) || '' }));
    if (!c.classes.length) c.classes = [{ name: 'Fighter', level: 1, archetype: '' }];
    const lvl = c.classes.reduce((s, k) => s + k.level, 0);

    // ability scores = base + species map + class ASIs / feats + background feat
    for (const [k, v] of Object.entries(o.baseAbilityScores || {})) if (abKey(k)) c.abilities[abKey(k)] = num(v, 10);
    let asi = 0;
    const addMap = m => { for (const [k, v] of Object.entries(m || {})) if (abKey(k) && +v) { c.abilities[abKey(k)] += +v; asi++; } };
    addMap(o.species && o.species.abilityScoreImprovement);
    for (const k of o.classes || []) for (const imp of k.abilityScoreImprovements || []) {
      if (Array.isArray(imp.abilitiesIncreased)) imp.abilitiesIncreased.forEach(x => { if (abKey(x.name) && +x.value) { c.abilities[abKey(x.name)] += +x.value; asi++; } });
      else addMap(imp.abilityScoreImprovements);
    }
    if (o.background && o.background.feat) addMap(o.background.feat.abilityScoreImprovements);
    for (const a of ABILITIES) {
      const tw = ((T.abilityScores || {})[a.name] || (T.abilityScores || {})[a.key] || {});
      c.abilities[a.key] = tweak(tw.score, c.abilities[a.key]);
    }
    notes.push(asi ? `Applied ${asi} ability bonus(es) from species, class and feats — compare with your sheet.` : 'Ability scores are base scores — add any species/ASI bonuses the export left out.');

    // saves from starting class (first class in the list)
    const sdef = classDef((o.classes || [])[0] && o.classes[0].name);
    if (sdef) sdef.saves.forEach(s => c.saves[s] = true);

    // skills & expertise
    const add = (s, l = 1) => { const k = skillKey(s); if (k) c.skills[k] = Math.max(c.skills[k] || 0, l); };
    (o.background && o.background.skills || []).forEach(s => add(s));
    for (const k of o.classes || []) { (k.skills || []).forEach(s => add(s)); (k.expertise || []).forEach(s => add(s, 2)); }
    for (const p of o.customProficiencies || []) add(p.name, p.proficiencyLevel === 'expertise' ? 2 : 1);
    for (const [ab, t] of Object.entries(T.abilityScores || {})) for (const [sk, tw] of Object.entries(t.skills || {})) {
      if (tw && tw.proficiency === 'Expertise') add(sk, 2); else if (tw && tw.proficiency === 'Proficient') add(sk, 1);
    }

    // HP: first class level = max die, then rolled values (or average when fixed HP), + Con per level
    const fixed = o.settings && o.settings.isFixedHitPoints;
    let hp = 0;
    (o.classes || []).forEach((k, i) => {
      const hd = (classDef(k.name) || {}).hd || 8, L = num(k.levels, 1);
      const rolls = (Array.isArray(k.hitPoints) ? k.hitPoints : []).map(x => num(x));
      const first = i === 0 ? hd : 0, need = L - (i === 0 ? 1 : 0);
      for (let j = 0; j < need; j++) hp += fixed || rolls[j] == null ? hd / 2 + 1 : rolls[j];
      hp += first;
    });
    hp += conModOf(c) * lvl;
    c.hp.max = Math.max(1, tweak((T.hitPoints || {}).maximum, hp));
    const cs = o.currentStats || {};
    c.hp.current = Math.max(0, c.hp.max - num(cs.hitPointsLost));
    c.hp.temp = num(cs.temporaryHitPoints);
    c.hitDiceUsed = Object.values(cs.hitDiceUsed || {}).reduce((a, b) => a + num(b), 0);
    c.force.used = num(cs.forcePointsUsed); c.tech.used = num(cs.techPointsUsed);
    if (T.forceCasting && T.forceCasting.maxPoints) c.force.max = tweak(T.forceCasting.maxPoints, '') || '';
    if (T.techCasting && T.techCasting.maxPoints) c.tech.max = tweak(T.techCasting.maxPoints, '') || '';
    c.deathSaves = { s: num((cs.deathSaves || {}).successes), f: num((cs.deathSaves || {}).failures) };
    c.inspiration = !!cs.hasInspiration;
    c.exhaustion = num(cs.exhaustion);
    c.conditions = (cs.conditions || []).map(titleCase);
    if (T.proficiencyBonus) c.profOverride = tweak(T.proficiencyBonus, pbFor(lvl));
    if (T.initiative) c.initMisc = tweak(T.initiative, 0);
    if (T.speed && T.speed.base) c.speed = tweak(T.speed.base, 30);
    c.ac = tweak(T.armorClass, 10 + Math.floor((c.abilities.dex - 10) / 2));
    if (!T.armorClass || T.armorClass.override == null) notes.push('AC set to 10 + Dex — enter your armored AC on the sheet.');
    notes.push('HP computed from hit dice + Con — compare with your sheet.');

    // powers (levels aren't in the export)
    const pw = [];
    const push = (list, type) => (list || []).forEach(n => n && pw.push({ name: n, level: 0, type, alignment: 'universal', notes: '' }));
    for (const k of o.classes || []) { push(k.forcePowers, 'force'); push(k.techPowers, 'tech'); if (k.archetype) { push(k.archetype.forcePowers, 'force'); push(k.archetype.techPowers, 'tech'); } }
    push(o.customForcePowers, 'force'); push(o.customTechPowers, 'tech');
    const seen = new Set(); c.powers = pw.filter(p => !seen.has(p.name) && seen.add(p.name));
    if (c.powers.length) notes.push('This export doesn’t include power levels — set each power’s level on the Attacks & Powers tab (or use the Roll20 export, which does).');

    // equipment
    for (const e of o.equipment || []) {
      c.equipment.push({ name: e.name, qty: num(e.quantity, 1), equipped: !!e.equipped, notes: e.category === 'EnhancedItem' ? 'enhanced' : '' });
      const atk = attackFromWeapon(e.name); if (atk && e.equipped !== false) c.attacks.push(atk);
    }
    for (const e of o.customEquipment || []) {
      c.equipment.push({ name: e.name, qty: num(e.quantity, 1), equipped: !!e.equipped, notes: e.description || e.equipmentCategory || '' });
      if (e.equipmentCategory === 'Weapon') {   // the export's own die where it has one (1.2), else 1d6
        const die = parseInt(String(e.damageDieType || e.damageDie || '').replace(/^d/i, ''), 10);
        c.attacks.push({ name: e.name, ab: /finesse|ranged|blaster/i.test(String(e.properties || e.weaponClassification || '')) && c.abilities.dex > c.abilities.str ? 'dex' : 'str',
          damage: `${num(e.damageNumberOfDice, 1) || 1}d${[4, 6, 8, 10, 12].includes(die) ? die : 6}`, type: String(e.damageType || 'kinetic').toLowerCase(), props: String(e.properties || '').slice(0, 200), proficient: true });
      }
    }
    if (!c.attacks.some(a => /unarmed/i.test(a.name))) c.attacks.push(attackFromWeapon('Unarmed strike'));
    c.features = (o.customFeatures || []).map(f => ({ name: f.name, text: cleanHtml(f.content) }));
    (o.customFeats || []).forEach(f => c.features.push({ name: f, text: 'Feat' }));
    for (const k of o.classes || []) for (const imp of k.abilityScoreImprovements || []) if (imp.type === 'Feat' && imp.name) c.features.push({ name: imp.name, text: 'Feat' });
    if (o.background && o.background.feat && o.background.feat.name) c.features.push({ name: o.background.feat.name, text: 'Background feat' });
    const langs = [...(o.customLanguages || []), ...((o.background || {}).languages || []), o.species && o.species.language].filter(Boolean);
    if (langs.length) c.languages = ['Galactic Basic', ...langs].join(', ');
    c.proficiencies = (o.customProficiencies || []).filter(p => !skillKey(p.name)).map(p => p.name).join(', ');
    const g = k => ch[k] || ch[k.toLowerCase()];
    c.notes = [g('Backstory'), g('Personality Traits') && 'Personality: ' + g('Personality Traits'), g('Ideal') && 'Ideal: ' + g('Ideal'),
      g('Bond') && 'Bond: ' + g('Bond'), g('Flaw') && 'Flaw: ' + g('Flaw'), g('Appearance') && 'Appearance: ' + g('Appearance'), o.notes].filter(Boolean).join('\n\n');
    // the AC wasn't in the export: the sheet works it out (acAuto, #165) once the importer has the armor's numbers (1.2)
    return { char: c, notes, source: 'SW5e.com builder (character JSON)', acFromDex: !T.armorClass || T.armorClass.override == null };
  }

  // ---------------------------------------------------------------- Foundry VTT
  const FOUNDRY_SKILLS = { acr: 'acrobatics', ani: 'animalHandling', ath: 'athletics', dec: 'deception', ins: 'insight',
    itm: 'intimidation', inv: 'investigation', lor: 'lore', med: 'medicine', nat: 'nature', prc: 'perception',
    prf: 'performance', per: 'persuasion', pil: 'piloting', slt: 'sleightOfHand', ste: 'stealth', sur: 'survival', tec: 'technology' };

  function fromFoundry(o) {
    const c = blankCharacter(), notes = [], d = o.system || o.data;
    c.name = o.name || c.name;
    if (o.img && /^https?:/.test(o.img)) c.image = o.img;
    for (const a of ABILITIES) {
      const x = (d.abilities || {})[a.key] || {};
      c.abilities[a.key] = num(x.value, 10);
      if (x.proficient) c.saves[a.key] = true;
    }
    for (const [k, v] of Object.entries(d.skills || {})) if (FOUNDRY_SKILLS[k] && num(v.value)) c.skills[FOUNDRY_SKILLS[k]] = num(v.value);
    const at = d.attributes || {}, det = d.details || {};
    c.hp = { max: num(at.hp && at.hp.max, 10), current: num(at.hp && at.hp.value, 10), temp: num(at.hp && at.hp.temp) };
    c.ac = num(at.ac && (at.ac.value ?? at.ac.flat), 10);
    c.speed = num((at.movement && at.movement.walk) ?? (at.speed && at.speed.value), 30);
    c.species = typeof det.species === 'string' ? det.species : (typeof det.race === 'string' ? det.race : '');
    c.background = typeof det.background === 'string' ? det.background : '';
    c.alignment = det.alignment || '';
    c.xp = num(det.xp && det.xp.value);
    c.notes = cleanHtml((det.biography && det.biography.value) || '');
    c.credits = num(d.currency && (d.currency.gc ?? d.currency.cr ?? d.currency.credits));
    if (at.death) c.deathSaves = { s: num(at.death.success), f: num(at.death.failure) };
    c.exhaustion = num(at.exhaustion);
    c.inspiration = !!at.inspiration;
    if (at.force && at.force.points) { c.force.max = num(at.force.points.max, ''); c.force.used = num(at.force.points.max) - num(at.force.points.value); }
    if (at.tech && at.tech.points) { c.tech.max = num(at.tech.points.max, ''); c.tech.used = num(at.tech.points.max) - num(at.tech.points.value); }
    c.classes = [];
    for (const it of o.items || []) {
      const s = it.system || it.data || {};
      if (it.type === 'class') c.classes.push({ name: it.name, level: num(s.levels, 1), archetype: s.archetype || s.subclass || '' });
      else if (it.type === 'species' || it.type === 'race') c.species = c.species || it.name;
      else if (it.type === 'background') c.background = c.background || it.name;
      else if (it.type === 'weapon') {
        const parts = (s.damage && s.damage.parts) || [];
        const props = Object.entries(s.properties || {}).filter(([, v]) => v).map(([k]) => k).join(', ');
        const ab = s.ability || (/fin/.test(props) ? 'finesse' : s.actionType === 'rwak' ? 'dex' : 'str');
        c.attacks.push({ name: it.name, ab, damage: parts.length ? String(parts[0][0]).replace(/\s*\+\s*@mod/gi, '') : '1d6',
          type: parts.length ? parts[0][1] : 'energy', props: props + (s.range && s.range.value ? ` Range (${s.range.value}/${s.range.long || s.range.value})` : ''),
          proficient: s.proficient !== false, magic: num(s.attackBonus) });
        c.equipment.push({ name: it.name, qty: num(s.quantity, 1), equipped: !!s.equipped, notes: 'weapon' });
      } else if (it.type === 'power' || it.type === 'spell') {
        const school = s.school || '';
        c.powers.push({ name: it.name, level: num(s.level), type: /tec/.test(school) ? 'tech' : 'force',
          alignment: ({ lgt: 'light', drk: 'dark', uni: 'universal' })[school] || 'universal', notes: '', description: cleanHtml(s.description && s.description.value) });
      } else if (['feat', 'classfeature', 'feature', 'maneuver'].includes(it.type)) {
        c.features.push({ name: it.name, text: cleanHtml(s.description && s.description.value).slice(0, 2000) });
      } else if (['equipment', 'consumable', 'loot', 'tool', 'backpack'].includes(it.type)) {
        c.equipment.push({ name: it.name, qty: num(s.quantity, 1), equipped: !!s.equipped, notes: it.type });
      }
    }
    if (!c.classes.length) { c.classes = [{ name: 'Fighter', level: num(det.level, 1), archetype: '' }]; notes.push('No class found — set your class.'); }
    return { char: c, notes, source: 'Foundry VTT actor' };
  }

  // ---------------------------------------------------------------- generic
  function fromGeneric(o) {
    const c = blankCharacter(), notes = ['Unrecognised format — imported what could be matched. Please review every field.'];
    const flat = {};
    const walk = (n, depth = 0) => {
      if (!n || typeof n !== 'object' || depth > 5) return;
      for (const [k, v] of Object.entries(n)) {
        if (v && typeof v === 'object' && !Array.isArray(v)) walk(v, depth + 1);
        else if (!(k.toLowerCase() in flat)) flat[k.toLowerCase()] = v;
      }
    };
    walk(o);
    c.name = o.name || flat.name || flat.charactername || c.name;
    for (const a of ABILITIES) {
      const v = flat[a.key] ?? flat[a.name.toLowerCase()];
      if (v != null) c.abilities[a.key] = num(typeof v === 'object' ? v.value : v, 10);
    }
    if (flat.ac || flat.armorclass) c.ac = num(flat.ac ?? flat.armorclass, 10);
    const hp = flat.hp ?? flat.hitpoints ?? flat.maxhp;
    if (hp != null) c.hp.max = c.hp.current = num(hp, 10);
    if (flat.species || flat.race) c.species = flat.species || flat.race;
    if (flat.class) c.classes = [{ name: titleCase(flat.class), level: num(flat.level, 1), archetype: flat.archetype || '' }];
    if (Array.isArray(o.skills)) o.skills.forEach(s => { const k = skillKey(s.name || s); if (k) c.skills[k] = 1; });
    return { char: c, notes, source: 'Generic JSON' };
  }

  root.SheetImporter = { importAny };
})(window);
