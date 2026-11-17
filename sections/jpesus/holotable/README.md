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

Optional: `HOLOTABLE_STORAGE_MB` (default 250) caps the total size of uploaded images and asset-pack art.

## What it does

- **Character sheets:** upload the SW5e.com builder's Roll20 export or character JSON. Foundry VTT (sw5e) exports also work.
  Uploading the same character again updates it, keeping its photos and current HP.
- **Profile and token photos** for each character.
- **Click-to-roll:** checks, saves, skills, attacks and damage, rolled on the server.
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
  - The board, where the background image sits, is outlined.
  - Tokens, plus Dungeondraft packs or zips of images placed as props, tokens or floors.
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
  - **The other buttons:** Save, Save as new, New blank, Rename and Delete. A table can keep up to 30 scenes.
  - **Images:** an uploaded image is deleted only once nothing on the table, saved scenes included, uses it.
- **Level ups:** the GM grants a level to the party or to chosen characters. Each player gets a pop-up and a guided wizard:
  pick a class or multiclass, roll or take average HP, take an ability score improvement or feat, add new features and powers,
  then see a before/after summary. The GM can level a character for a player who missed the session.
- **Look:** an original sci-fi console design, with framed panels, angled tabs and glowing accents. It uses the Orbitron and
  Exo 2 fonts (SIL Open Font License, in `fonts/`), served from this folder.
- **Colour themes (🎨):** each person picks their own look. Republic Command is the default, and there are 18 more themes in three groups: Light Side, Dark Side and
  Across the Galaxy. The GM also gets an exclusive Green & Silver theme. Anyone can then fine-tune five colours.
  The choice is saved with your account and follows you to other devices. Every theme passes a contrast check (themes.js).
- **GM tools:** handouts, GM notes, a backup file download, automatic backups, and restore.

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
- **Storage:** the project's Redis, under `ht:` keys (`htpv:` on preview deployments). Nothing touches Find time to hang's keys.
  - Uploaded images and pack art share the `HOLOTABLE_STORAGE_MB` cap.
  - The game document is capped at 1.5 MB, with 10 automatic backups kept.
- **If the save goes missing** (for example, a full Redis evicting keys), changes are refused and everyone sees a notice.
  The GM gets a one-click restore from the latest automatic backup, so a blank table is never saved over it.
  A full database shows a clear "database is full" message.
- **Asset pack uploads** go in numbered ~1.5 MB batches. Each batch is written to Redis in one pipeline, so a distant
  database can't push a request past Vercel's 10 s limit. A batch retried after a timeout is applied only once.
  `node tests/holotable-devserver.js 8789 --slow=80` simulates database delay and the 10 s limit.
- **Live updates:** long-polling woken by Redis pub/sub. Each request waits up to 8 s, and hidden tabs stop polling.

## Local testing

```
node --test tests/holotable-api.test.js
node tests/holotable-devserver.js     # then open http://localhost:8788/sections/jpesus/holotable/
```

The dev server runs on an in-memory stand-in for Redis, with local-only passwords `dev-player` and `dev-gm`.
