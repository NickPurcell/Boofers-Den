// Shared vote store for the Father's Day Raid Night poll.
// Vercel serverless function backed by the project's Redis store. The store
// only exposes a native Redis connection string (REDIS_URL), so we talk the
// Redis wire protocol via ioredis. Each response is one field in a Redis hash,
// keyed by lowercased name, so two people voting at once can't clobber each
// other.

const Redis = require("ioredis");

const KEY = "raidnight:fathersday";
const URL =
  process.env.REDIS_URL ||
  process.env.KV_URL ||
  process.env.UPSTASH_REDIS_URL ||
  null;

// Reused across warm invocations; created once per cold start.
let client = null;
function getClient() {
  if (!client) {
    client = new Redis(URL, {
      maxRetriesPerRequest: 3,
      connectTimeout: 8000,
      enableReadyCheck: true,
    });
    client.on("error", () => { /* swallow so a blip can't crash the function */ });
  }
  return client;
}

async function readAll(r) {
  const map = (await r.hgetall(KEY)) || {};
  const responses = [];
  for (const field of Object.keys(map)) {
    try { responses.push(JSON.parse(map[field])); } catch { /* skip junk */ }
  }
  return responses;
}

module.exports = async function handler(req, res) {
  if (req.method === "GET" && req.query && req.query.debug === "env") {
    res.status(200).json({
      envKeys: Object.keys(process.env).filter((k) => /KV|REDIS|UPSTASH/i.test(k)),
    });
    return;
  }

  if (!URL) {
    res.status(503).json({
      error: "store not connected",
      sawEnvKeys: Object.keys(process.env).filter((k) => /KV|REDIS|UPSTASH/i.test(k)),
    });
    return;
  }

  try {
    const r = getClient();

    if (req.method === "GET") {
      res.status(200).json({ responses: await readAll(r) });
      return;
    }

    if (req.method === "POST") {
      let body = req.body;
      if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
      body = body || {};

      const name = String(body.name || "").trim().slice(0, 40);
      if (!name) { res.status(400).json({ error: "name required" }); return; }

      const valid = new Set(["in", "maybe", "out"]);
      const status = valid.has(body.status) ? body.status : "in";
      const raids =
        status === "out" || !Array.isArray(body.raids)
          ? []
          : body.raids.filter((x) => typeof x === "string").slice(0, 20);
      const notes = status === "out" ? "" : String(body.notes || "").trim().slice(0, 120);

      const entry = { name, status, raids, notes };
      await r.hset(KEY, name.toLowerCase(), JSON.stringify(entry));
      res.status(200).json({ responses: await readAll(r) });
      return;
    }

    res.setHeader("Allow", "GET, POST");
    res.status(405).json({ error: "method not allowed" });
  } catch (err) {
    res.status(500).json({ error: String((err && err.message) || err) });
  }
};
