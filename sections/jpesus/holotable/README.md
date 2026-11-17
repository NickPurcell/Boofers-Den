# HoloTable

jpesus's Star Wars 5e campaign table, at `/sections/jpesus/holotable/`. One person hosts and the others join
with a 5-letter room code. Campaigns save automatically, so the group can pick up again next session.

## What it does

- **Character sheets:** upload the SW5e.com character builder's **Roll20 export** or character JSON.
  Foundry VTT (sw5e) exports also work.
- **Click-to-roll:** checks, saves, skills, attacks and damage. Dice are rolled on the server.
- **Chat:** whispers, secret GM rolls, `/r 2d20kh1+5`.
- **Combat tracker:** initiative order, HP, conditions, and hidden NPCs.
- **Battle map:** tokens, plus profile and token photos for each character.
- **Asset packs:** Dungeondraft `.dungeondraft_pack` files or zips of images, placed on the map as props, tokens or floors.
- **Handouts, GM notes, backups:** one GM-only backup file, and a restore from it.

## How it runs

Everything is a single function, `api/holotable.js`. It uses `_holotable-game.js` for the rules and `_holotable-store.js`
for storage in the project's existing Redis (`REDIS_URL`). Its keys start with `ht:`, or `htpv:` on preview deployments,
following the same pattern as hang2.

- **Live updates** use long-polling. Each open table keeps one request waiting for up to 8 s, and Redis pub/sub
  answers it the moment anything changes.
- **Asset packs** are unpacked in the browser (`packs.js`), converted to WebP, and uploaded in batches of about 3 MB.
  That keeps every request under Vercel's 4.5 MB limit. A 57 MB Dungeondraft pack takes about 10 MB in Redis.
  The whole library is capped at 150 MB; set `HOLOTABLE_LIBRARY_MB` to change the cap.
- **Images** (photos, maps, pack art) are served from `/api/holotable?img=…` and `?a=…` with immutable cache headers,
  so the CDN serves each one from Redis only once.
- **Campaigns** don't expire. A backup copy is kept every 10 minutes of play (the last 10 are kept).

## Local testing

```
node --test tests/holotable-api.test.js
node tests/holotable-devserver.js          # then open http://localhost:8788/sections/jpesus/holotable/
```

Both run on an in-memory stand-in for Redis (`tests/holotable-fake-redis.js`).
