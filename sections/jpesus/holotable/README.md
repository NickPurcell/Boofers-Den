# HoloTable

jpesus's Star Wars 5e table at `/sections/jpesus/holotable/`. It runs one game for the group, behind two passwords.

## Setup (site owner)

Set two environment variables in Vercel:

| Variable | Lets in |
|---|---|
| `HOLOTABLE_PLAYER_PASSWORD` | players |
| `HOLOTABLE_GM_PASSWORD` | the GM |

Until both are set (and different from each other), the API refuses every request. Changing either one signs everybody out.
Sessions are signed with a random secret the server creates once and keeps in Redis (`ht:secret`). Nobody has to configure it.

Uploaded files (images, asset-pack art, table audio) are kept in the project's **private Vercel Blob store**, connected
to the project in Vercel's Storage tab (it authenticates by OIDC, so there's no token to set). Without it, the table
still plays and old files still show, but new uploads are refused with a message saying so.

Optional: `HOLOTABLE_STORAGE_MB` (default 1000) caps the total size of uploaded images, asset-pack art and table audio.

## What it does

- **Character sheets:** upload the SW5e.com builder's Roll20 export or character JSON. Foundry VTT (sw5e) exports also work.
  Uploading the same character again updates it, keeping its photos and current HP.
- **Profile and token photos** for each character.
- **Click-to-roll:** checks, saves, skills, attacks and damage, rolled on the server.
- **Class resources** (Attacks & Powers page): "＋ Add …" fills in the uses a character's classes give at its level,
  from SW5e's class tables: Rages, Superiority dice (count and die), Second Wind, Action Surge, Indomitable, Focus points,
  Channel the Force, Force Shield, Potent Aptitude and Ideal manifests. **Use** spends one, **+1** gives one back, rests
  refill them, and a die's name rolls it. The numbers follow the level; the combat view reads the same list. Below them,
  each class's table at its level (Rage Damage, Sneak Attack dice, Martial Arts die, aura and routine radius, and what's
  known). `tests/holotable_gen_classes.py` rebuilds the tables from SW5e's `/api/class`.
- **Chat:** type `/` for a menu of commands that narrows as you type. After `/w`, it suggests player and character names.
  - `/r` (or `/roll`): roll dice.
  - `/gmr`: a secret roll only you and the GM see.
  - `/w` (or `/whisper`, `/tell`, `/msg`): whisper a player, or a character, which reaches whoever plays it.
    Speaking as a character only works for characters you play (the GM can voice any). The real sender is always shown.
  - `/yell` (or `/y`, `/shout`): a loud message with a pop-up on every screen.
  - `/me`: describe what your character does.
  - `/ooc`: out-of-character talk.
  - `/init`: roll initiative.
  - `/desc` and `/clear`: GM only.
  - `/help`: show every command.
- **Combat tracker:** initiative, HP, conditions, hidden NPCs.
- **Battle map:** an endless grid of 70 px squares (the usual VTT size) that fills the map pane.
  - Drag empty space to pan, and scroll or pinch to zoom. The **−**, **100%**, **+** and **Fit** buttons reset the view.
  - The map always opens fitted to the board, whatever size the GM has set. It refits when the GM changes the board's
    size or the scene, and when the window resizes or a phone rotates, unless you've zoomed or panned since.
  - On a phone, the map tab gives the map most of the screen: the roster and chat shrink, and the map tools scroll
    sideways in one row.
  - The board, where the background image sits, is outlined.
  - Tokens, plus Dungeondraft packs or zips of images placed as props, tokens or floors.
  - **Objects that block sight (GM):** click a placed piece (a crate stack, a parked freighter, a pillar) and press
    "👁 Blocks sight". With the fog of war on, characters can't see through or past it, like a wall. The GM sees a dotted
    outline on blocking pieces; players never receive the setting, only its effect.
  - **Token names:** each token shows a short label that fits its own square (the full name, the first name, or the
    initials), so neighbours never overlap. Hover a token for its full name.
  - **Unknown names (GM):** click a token and choose "Hide name from players" (or tick "hide their names" when adding
    NPCs). Players then see "???" on the map and in initiative, and the real name and sheet link never reach their
    browser. The GM sees the label dimmed in amber until it's revealed.
- **Power tooltips:** hover any force or tech power for its cost, save DC, attack bonus, casting details and description.
  Use ✎ to write or edit a description.
- **Power pickers:** **＋ force power** and **＋ tech power** open the whole SW5e list. Filter by level (0–9), by name, and,
  for force powers, by alignment (Light, Dark, Universal, using checkboxes). Picking a power adds it with its level, type,
  alignment, casting details and description.
  - **Where the list comes from:** the server fetches it from SW5e's public API and caches it for a week (`ht:powers`).
    Players' browsers never contact another site.
- **Features & traits:** names and descriptions are fixed on the sheet. Hover a name to see its description.
  New features are written once, when they're added.
- **Scenes (GM):** save the map setup (background, floor, grid, tokens, props) under a name and pick one from the
  Scene dropdown to show it to everyone at once.
  - **Switching keeps your work:** changes to the current scene are kept in that scene when you switch away.
  - **Screen wipes:** every scene change plays a random film-style wipe for the whole table (left, right, down, up,
    diagonal, clock, iris or barn doors; the server picks it, so everyone sees the same one). They follow each device's
    "reduce motion" setting by default, and anyone can switch them on or off for themselves in the 🎨 menu.
  - **Scene movements (like keyframes):** click a token or an asset piece (a speeder, say), then "🎬 Scene movement…",
    and click squares to lay out up to 12
    waypoints. Optionally pick an exit off one edge of the board and a start delay. The paths show only to the GM, as
    dashed lines. They play once, for everyone, right after that scene is loaded (after the wipe), and the pieces stay
    where they end. "▶ Play movements" plays the current board's movements without a wipe. Asset pieces can also "turn
    to face their path": point the piece along its first leg and it turns at each waypoint as it goes.
  - **Movements for when combat starts (GM):** in the same bar, set "Plays" to "⚔ when combat starts". The path is drawn
    red. It waits through scene changes, and plays the moment you press Start in initiative or switch the combat view on.
    Say talks go wrong: the bounty hunter dives behind the crates and the sniper runs up to the balcony.
  - **The other buttons:** Save, Save as new, New blank, Rename and Delete. A table can keep up to 30 scenes.
  - **Images:** an uploaded image is deleted only once nothing on the table, saved scenes included, uses it.
- **Level ups:** the GM grants a level to the party or to chosen characters. Each player gets a pop-up and a guided wizard:
  - **Class:** pick a class or multiclass (multiclassing happens only here, not on the sheet). On reaching level 3 in a
    class, a "Pick <name>" button (Sentinel Calling, Berserker Approach, Monastic Order..., each class's own word) lists
    that class's archetypes from the Player's Handbook and Expanded Content, with each description on hover. It's chosen
    once, shows in the summary, and its features are added at level 3 and at every later level that grants one.
  - **Hit points:** take the average, roll the die (in chat), or take the die's maximum. Maximum is a table rule the GM can
    switch off in the GM tab.
  - **Ability score improvement:** only at the levels the SW5e class table gives one (4, 8, 12, 16 and 19, plus the
    Fighter, Monk and Operative extras); otherwise the wizard says the class gets none. +1 to two scores, +2 to one, or a
    feat (picked from SW5e's list, with its text filled in).
  - **Features:** the class (and archetype) features SW5e gives at the new level are added to Features & Traits automatically.
  - **Powers:** "+ force power" / "+ tech power" open the same SW5e pickers as the sheet.
  - Then a before/after summary. The GM can level a character for a player who missed the session.
- **Every SW5e book** (the server fetches SW5e's lists and caches them for a week under `ht:sw5e:list:<name>`;
  all cached SW5e lists together are capped at 15 MB, today about 6.3 MB). The books have their own switch, separate from
  the power and equipment pickers: set `HOLOTABLE_SW5E_BOOKS=off` to turn just them off (their buttons hide).
  Content from [SW5e](https://sw5e.com), a free fan project, credited wherever it's shown:
  - **Player's Handbook and Expanded Content:** ◈ buttons on the sheet choose a species (adds its traits, speed and
    languages, and can apply a fixed ability increase) and a background (adds its feature and proficiencies); archetypes
    are picked in the level-up wizard. "+ from SW5e" in Features & Traits adds feats, class and archetype features,
    maneuvers, fighting styles and masteries, and lightsaber forms, each with its full text.
  - **Wretched Hives:** its gear and enhanced items are in the equipment picker, its feats in the feat list, its chapters
    (downtime, factions, tools and more) in the rulebook library.
  - **Scum and Villainy:** the GM's "☠ Add an SW5e creature" (Combat tab) adds any of its 271 creatures to initiative,
    with AC, HP (average or rolled) and a map token. 📜 opens the stat block, and its attacks, damage, saving throws, skills and
    ability checks roll GM-only (shift-click for advantage, ctrl-click for disadvantage). The tracker's "Save…" menu
    rolls a creature's save straight from its row: its listed bonus, or the plain modifier if it isn't proficient.
  - **Encounter difficulty (GM):** above the initiative list, a meter rates the fight Easy, Medium, Hard or Deadly.
    It uses SW5e's encounter-building rules: the creatures' XP, multiplied for how many there are, against the party's
    thresholds. The party is the characters in initiative, or every player's character before anyone has rolled.
    Players never see which creature an NPC is.
  - **Starships of the Galaxy:** a Ships tab with ship sheets (size, tier, AC, hull and shield points, speed, hyperdrive,
    ship ability scores, saves and the 14 ship skills), crew with deployments and ranks, weapons that roll attack (Wis +
    the crew member's proficiency) and damage (+ Str), and SotG equipment and modification pickers. Starship ventures are
    in the feature picker. Anyone can edit the party's ships; the GM can also keep hidden (enemy) ships.
  - **Variant Rules:** all 40 are in the library, and the GM switches on the ones the table uses (shown to everyone).
  - **Rulebook library (Rules tab):** every chapter of each book, searchable, plus reference tables and weapon and armor
    properties.
- **Look:** an original sci-fi console design, with framed panels, angled tabs and glowing accents. It uses the Orbitron and
  Exo 2 fonts (SIL Open Font License, in `fonts/`), served from this folder.
- **Colour themes (🎨):** each person picks their own look. Republic Command is the default, and there are 18 more themes in three groups: Light Side, Dark Side and
  Across the Galaxy. The GM also gets an exclusive Green & Silver theme. Anyone can then fine-tune five colours.
  The choice is saved with your account and follows you to other devices. Every theme passes a contrast check (themes.js).
- **Table audio:** the GM uploads music or ambience (GM tab → Table audio; MP3, OGG, WAV, FLAC, M4A or WebM, up to
  30 MB each, counted against the storage cap) and plays, pauses, loops or stops it for everyone. Every screen streams
  the same file from this site and keeps itself in step with the GM. Nothing plays on a device until that person turns
  table audio on there once ("🔈 Turn on table audio" in the top bar); after that, the ♪ button sets their own volume,
  mutes it, or turns it off again. If a browser still waits for a click before playing sound, that button says so.
- **GM tools:** handouts, GM notes, a backup file download, automatic backups, and restore. A File storage box shows
  what the file store holds and how much of the cap is used, and moves files uploaded before the store out of the database.

## How it runs

- **One function:** `api/holotable.js`, routed by `?op=`. The rules live in `_holotable-game.js` and storage in `_holotable-store.js`.
- **Sign-in:** a password is exchanged for a signed (HMAC), expiring session in an HttpOnly cookie. The signing key mixes
  the server-only secret with both passwords, so a cookie can't be used to test password guesses offline.
  - The session carries the person's id and role, and only the role decides who is GM.
  - Every read, write and image needs a session.
  - POSTs also need an `X-HoloTable: 1` header, which other sites can't send.
  - Wrong passwords are limited to 10 per address per 15 minutes, with no shared limit anyone could trip for the whole group.
    They're compared in constant time.
- **Input cleaning:** the server cleans every character sheet and table edit. Numbers stay numbers, colours must be `#rrggbb`,
  and images must be ones uploaded to this table.
- **Storage:** the game, chat, sessions, backups and the file index are in the project's Redis, under `ht:` keys
  (`htpv:` on preview deployments). Nothing touches Find time to hang's keys.
  - Files are in the private Blob store under `ht/img/<id>`, `ht/pack/<id>/<n>` and `ht/aud/<id>` (`htpv/` on previews).
    The store can't be read without the project's credentials, so every file still goes out through `/api/holotable`
    after the session check, and no store address is ever sent to a browser. `ht:files` lists what's in the store.
  - Audio goes from the GM's browser straight to the store, on a one-off upload address that accepts only that file,
    at most its declared size, for 10 minutes. The server then checks what arrived (size, and that it really is audio)
    before the track is listed; a file that fails, or is never finished, is deleted.
  - Files uploaded before the store are read from Redis until the GM presses "Move files to file storage". The move goes
    in batches, writes each file to the store before deleting its Redis copy, and is safe to stop and run again.
  - Images, pack art and audio share the `HOLOTABLE_STORAGE_MB` cap, enforced by the function before anything is written.
  - The game document is capped at 1.5 MB, with 10 automatic backups kept. A backup file carries the game's own images;
    asset packs and audio are the table's library and stay out of it.
- **If the save goes missing** (for example, a full Redis evicting keys), changes are refused and everyone sees a notice.
  The GM gets a one-click restore from the latest automatic backup, so a blank table is never saved over it.
  A full database shows a clear "database is full" message.
- **Asset pack uploads** go in numbered ~1.5 MB batches, each written to the store several images at a time, so a
  request stays inside Vercel's 10 s limit. A batch retried after a timeout is applied only once, and a batch that
  fails leaves no half pack behind.
  `node tests/holotable-devserver.js 8789 --slow=80` simulates database delay and the 10 s limit.
- **Live updates:** long-polling woken by Redis pub/sub. Each request waits up to 8 s, and hidden tabs stop polling.

## Local testing

```
node --test tests/holotable-api.test.js
node tests/holotable-devserver.js     # then open http://localhost:8788/sections/jpesus/holotable/
```

The dev server runs on in-memory stand-ins for Redis and the Blob store (`tests/holotable-fake-redis.js`,
`tests/holotable-fake-blob.js`), with local-only passwords `dev-player` and `dev-gm`.
