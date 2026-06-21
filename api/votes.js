// Shared vote store for the Father's Day Raid Night poll.
// Vercel serverless function backed by the project's KV / Upstash Redis store.
// Uses the Upstash REST API directly (no npm deps -> no build step on the
// otherwise-static site). Each response is one field in a Redis hash, keyed by
// the lowercased name, so two people voting at once can't clobber each other.

const KEY = "raidnight:fathersday";

// The KV / Upstash-for-Redis integrations inject one of these env-var pairs.
const REST_URL =
  process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const REST_TOKEN =
  process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

async function redis(command) {
  const r = await fetch(REST_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${REST_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(command),
  });
  if (!r.ok) throw new Error("redis " + r.status + " " + (await r.text()));
  const json = await r.json();
  return json.result;
}

async function readAll() {
  const flat = (await redis(["HGETALL", KEY])) || [];
  const responses = [];
  for (let i = 0; i < flat.length; i += 2) {
    try { responses.push(JSON.parse(flat[i + 1])); } catch { /* skip junk */ }
  }
  return responses;
}

module.exports = async function handler(req, res) {
  if (!REST_URL || !REST_TOKEN) {
    // Store not connected yet — tell the client so it can fall back to local.
    res.status(503).json({ error: "store not connected" });
    return;
  }

  try {
    if (req.method === "GET") {
      res.status(200).json({ responses: await readAll() });
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
      await redis(["HSET", KEY, name.toLowerCase(), JSON.stringify(entry)]);
      res.status(200).json({ responses: await readAll() });
      return;
    }

    res.setHeader("Allow", "GET, POST");
    res.status(405).json({ error: "method not allowed" });
  } catch (err) {
    res.status(500).json({ error: String((err && err.message) || err) });
  }
};
