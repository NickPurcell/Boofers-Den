/* HoloTable colour themes. Each person picks their own (it only changes what they see).
 * A theme sets the core colours; every other colour in the UI is mixed from these in style.css.
 *   bg / bg2      page background and sidebars      panel / panel2   cards and raised cards
 *   line          borders                           text / muted     main and secondary text
 *   holo          main accent (buttons, links)      amber            second accent (highlights, turn marker)
 *   red / green / violet   danger, success, special
 * `light: true` tells the browser to draw form controls in light mode. */
(function (root) {
  const T = (id, name, group, tagline, light, c) => ({ id, name, group, tagline, light: !!light, colors: c });
  const THEMES = [
    // ---------------------------------------------------------------- the galaxy (neutral)
    T('holo-blue', 'Holo Blue', 'galaxy', 'The classic hologram glow.', false,
      { bg: '#0b0f17', bg2: '#111827', panel: '#151d2b', panel2: '#1b2536', line: '#26344b', text: '#dbe6f5', muted: '#8fa1ba', holo: '#4fc3f7', amber: '#ffb74d', red: '#ef5350', green: '#66bb6a', violet: '#b388ff' }),
    T('smuggler', "Smuggler's Freighter", 'galaxy', 'Worn leather, warm cockpit lights.', false,
      { bg: '#14100b', bg2: '#1b150e', panel: '#221a11', panel2: '#2b2116', line: '#45351f', text: '#f2e8da', muted: '#b19e83', holo: '#f0a03c', amber: '#6ec6ff', red: '#ef5350', green: '#8bc34a', violet: '#c3a6ff' }),
    T('coruscant', 'Coruscant Nights', 'galaxy', 'Neon over the undercity.', false,
      { bg: '#0b0b1a', bg2: '#111126', panel: '#171733', panel2: '#1e1e42', line: '#33335e', text: '#ecebff', muted: '#a3a2cc', holo: '#ff5fd9', amber: '#3ee0ff', red: '#ff6b85', green: '#5ef2a0', violet: '#b79bff' }),
    T('endor', 'Endor Forest', 'galaxy', 'Moss, bark and the moon\'s canopy.', false,
      { bg: '#0f130d', bg2: '#151b12', panel: '#1b2317', panel2: '#222c1d', line: '#374632', text: '#e9efe1', muted: '#a3b096', holo: '#9ccc65', amber: '#e0ac62', red: '#ef7a66', green: '#a5d6a7', violet: '#c9abff' }),
    T('kyber', 'Kyber Crystal', 'galaxy', 'A cave full of singing crystals.', false,
      { bg: '#0d0b16', bg2: '#13101f', panel: '#19152a', panel2: '#211b37', line: '#372d57', text: '#ece8fb', muted: '#a8a1c8', holo: '#7df9ff', amber: '#c99bff', red: '#ff7b8f', green: '#6ee7b7', violet: '#c99bff' }),
    T('beskar', 'Beskar Steel', 'galaxy', 'This is the way.', false,
      { bg: '#111417', bg2: '#171b1f', panel: '#1d2227', panel2: '#252b31', line: '#3a434c', text: '#e6eaee', muted: '#a0aab4', holo: '#64c4c4', amber: '#ddb877', red: '#ef6f6f', green: '#8fcf8f', violet: '#b9a6e8' }),

    // ---------------------------------------------------------------- light side
    T('jedi-temple', 'Jedi Temple', 'light', 'Sunlit sandstone and archive gold. A light UI.', true,
      { bg: '#f4efe3', bg2: '#ebe4d4', panel: '#fffaf0', panel2: '#f3ecdc', line: '#d4c6a8', text: '#2b2418', muted: '#665a48', holo: '#1d5aa0', amber: '#946200', red: '#b3261e', green: '#2e7d32', violet: '#6a3fb5' }),
    T('hoth', 'Hoth Echo Base', 'light', 'Ice-white and comm-panel blue. A light UI.', true,
      { bg: '#eef3f7', bg2: '#e2eaf1', panel: '#ffffff', panel2: '#edf2f7', line: '#c8d5e1', text: '#1b2733', muted: '#556677', holo: '#0f68ad', amber: '#b4400a', red: '#c62828', green: '#2e7d32', violet: '#6d4cc2' }),
    T('tatooine', 'Tatooine Twin Suns', 'light', 'Desert sand at double sunset. A light UI.', true,
      { bg: '#f6ead6', bg2: '#efdcc0', panel: '#fdf6ea', panel2: '#f3e4cb', line: '#d7bc91', text: '#3a2a18', muted: '#6e5640', holo: '#a8440f', amber: '#7a5000', red: '#b3261e', green: '#4d7c0f', violet: '#6f47b8' }),
    T('rebel', 'Rebel Alliance', 'light', 'Flight-suit orange on starfighter navy.', false,
      { bg: '#0c1422', bg2: '#121c2e', panel: '#16233a', panel2: '#1c2c47', line: '#2a3d5e', text: '#e6edf7', muted: '#97a8c2', holo: '#ff8a3d', amber: '#ffd166', red: '#ff6b6b', green: '#6fcf7f', violet: '#a7afff' }),
    T('jedi-knight', 'Jedi Knight', 'light', 'A green blade in a quiet temple.', false,
      { bg: '#0c1612', bg2: '#10201a', panel: '#142820', panel2: '#1a3329', line: '#28473a', text: '#e3f2ea', muted: '#93b2a2', holo: '#57d68d', amber: '#f2c94c', red: '#ef6a6a', green: '#7ee2a8', violet: '#aebcff' }),
    T('naboo', 'Naboo Royal', 'light', 'Palace violet and royal gold.', false,
      { bg: '#160f22', bg2: '#1e1530', panel: '#251a3b', panel2: '#2e2149', line: '#44325f', text: '#f1eaf9', muted: '#ac9fc6', holo: '#e0b84c', amber: '#f48fb1', red: '#ff7070', green: '#7bd88f', violet: '#c3a6ff' }),

    // ---------------------------------------------------------------- dark side
    T('sith', 'Sith Holocron', 'dark', 'Black glass and a red glow.', false,
      { bg: '#0d0606', bg2: '#150909', panel: '#1c0c0c', panel2: '#261010', line: '#4a1c1c', text: '#f5e6e6', muted: '#b89393', holo: '#ff4040', amber: '#ff9a66', red: '#ff5c5c', green: '#81c784', violet: '#d699ff' }),
    T('imperial', 'Imperial Navy', 'dark', 'Durasteel grey, bridge-light white.', false,
      { bg: '#101215', bg2: '#16191d', panel: '#1d2126', panel2: '#252a31', line: '#3a414b', text: '#e8ebef', muted: '#a0a9b4', holo: '#c9d3de', amber: '#e5c07b', red: '#e57373', green: '#8bc28c', violet: '#b8a6e8' }),
    T('mustafar', 'Mustafar', 'dark', 'Lava rivers under black rock.', false,
      { bg: '#120a06', bg2: '#1a0e08', panel: '#22120a', panel2: '#2c170c', line: '#4e2a14', text: '#f7e9df', muted: '#bc9b84', holo: '#ff7a1a', amber: '#ffc04d', red: '#ff5c5c', green: '#9ccc65', violet: '#cf9cf0' }),
    T('inquisitor', 'Inquisitorius', 'dark', 'Charcoal armour, a crimson spinning blade.', false,
      { bg: '#121214', bg2: '#18181b', panel: '#1f1f23', panel2: '#27272c', line: '#3d3d45', text: '#ececf1', muted: '#a3a3b0', holo: '#ff3b54', amber: '#c0c4cc', red: '#ff6b6b', green: '#7fc98c', violet: '#b9a3e0' }),
    T('nightsister', 'Nightsister', 'dark', 'Dathomir mist and ichor green.', false,
      { bg: '#0b0f0b', bg2: '#101710', panel: '#142014', panel2: '#1a2a1a', line: '#2f452f', text: '#e5efe2', muted: '#9bb097', holo: '#ff4d6d', amber: '#9be564', red: '#ff6b6b', green: '#9be564', violet: '#c79aff' }),
    T('death-star', 'Death Star', 'dark', 'Battle-station grey and a superlaser glow.', false,
      { bg: '#0e0f10', bg2: '#141617', panel: '#1a1d1f', panel2: '#212528', line: '#353b40', text: '#e2e6e9', muted: '#9aa2a9', holo: '#7cf06a', amber: '#ff8a5c', red: '#ff5f5f', green: '#7cf06a', violet: '#b0a2f0' }),

    // ---------------------------------------------------------------- just for the GM
    T('gm-green-silver', "GM's Green & Silver", 'gm', 'Emerald and polished silver, for the one running the table.', false,
      { bg: '#0b1410', bg2: '#0f1b15', panel: '#13221a', panel2: '#182b21', line: '#2c4536', text: '#eef3f0', muted: '#aab8b0', holo: '#2fcf7d', amber: '#c9d1d9', red: '#ef6b6b', green: '#5be39a', violet: '#bcc7d1' }),
  ];
  const GROUPS = [
    { id: 'light', name: 'Light Side' }, { id: 'dark', name: 'Dark Side' },
    { id: 'galaxy', name: 'Across the Galaxy' }, { id: 'gm', name: 'GM exclusive' },
  ];
  const CUSTOM_KEYS = [
    { key: 'bg', label: 'Background' }, { key: 'panel', label: 'Panels' }, { key: 'text', label: 'Text' },
    { key: 'holo', label: 'Main accent' }, { key: 'amber', label: 'Second accent' },
  ];
  const byId = id => THEMES.find(t => t.id === id) || THEMES[0];

  // --- colour helpers
  const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const toHex = rgb => '#' + rgb.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
  const mix = (a, b, t) => toHex(hex(a).map((v, i) => v + (hex(b)[i] - v) * t));
  const lum = h => { const [r, g, b] = hex(h).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const onColor = h => (contrast(h, '#0b0f17') >= contrast(h, '#ffffff') ? '#0b0f17' : '#ffffff');
  const isHex = v => /^#[0-9a-fA-F]{6}$/.test(String(v || ''));

  // The final colours for a choice: the template, plus any custom picks (with the in-between
  // shades worked out again from the new background, panel and text).
  function resolve(prefs) {
    const t = byId(prefs && prefs.theme);
    const c = Object.assign({}, t.colors);
    const custom = (prefs && prefs.custom) || {};
    for (const { key } of CUSTOM_KEYS) if (isHex(custom[key])) c[key] = custom[key].toLowerCase();
    if (isHex(custom.bg) || isHex(custom.panel) || isHex(custom.text)) {
      c.bg2 = mix(c.bg, c.panel, 0.45);
      c.panel2 = mix(c.panel, c.text, 0.06);
      c.line = mix(c.panel, c.text, 0.2);
      c.muted = mix(c.text, c.panel, 0.38);
    }
    const light = lum(c.bg) > 0.4;
    return { theme: t, colors: c, light, onHolo: onColor(c.holo), onAmber: onColor(c.amber) };
  }

  function apply(prefs, el = document.documentElement) {
    const r = resolve(prefs);
    for (const [k, v] of Object.entries(r.colors)) el.style.setProperty('--' + k, v);
    el.style.setProperty('--on-holo', r.onHolo);
    el.style.setProperty('--on-amber', r.onAmber);
    el.style.colorScheme = r.light ? 'light' : 'dark';
    el.dataset.theme = r.theme.id;
    return r;
  }

  root.HoloThemes = { THEMES, GROUPS, CUSTOM_KEYS, byId, resolve, apply, contrast, isHex };
})(typeof window !== 'undefined' ? window : globalThis);
