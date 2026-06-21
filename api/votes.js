// Shared vote store for the Father's Day Raid Night poll.
// Vercel serverless function backed by the project's KV / Upstash Redis store.
// Uses the Upstash REST API directly (no npm deps -> no build step on the
// otherwise-static site). Each response is one field in a Redis hash, keyed by
// the lowercased name, so two people voting at once can't clobber each other.

const KEY = "raidnight:fathersday";

// The KV / Upstash integrations inject the REST creds under a handful of
// different names depending on how the store was connected. Try the known ones
// first, then fall back to any *REST_API_URL / *REDIS_REST_URL key.
function pickEnv() {
  const env = process.env;
  let url = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL || null;
  let token = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN || null;
  if (!url) {
    const k = Object.keys(env).find((x) => /REST_API_URL$/.test(x) || /REDIS_REST_URL$/.test(x));
    if (k) url = env[k];
  }
  if (!token) {
    const k = Object.keys(env).find(
      (x) => (/REST_API_TOKEN$/.test(x) || /REDIS_REST_TOKEN$/.test(x)) && !/READ_ONLY/.test(x)
    );
    if (k) token = env[k];
  }
  return { url, token };
}

async function redis(command, creds) {
  const r = await fetch(creds.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${creds.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(command),
  });
  if (!r.ok) throw new Error("redis " + r.status + " " + (await r.text()));
  const json = await r.json();
  return json.result;
}

async function readAll(creds) {
  const flat = (await redis(["HGETALL", KEY], creds)) || [];
  const responses = [];
  for (let i = 0; i < flat.length; i += 2) {
    try { responses.push(JSON.parse(flat[i + 1])); } catch { /* skip junk */ }
  }
  return responses;
}

module.exports = async function handler(req, res) {
  // Diagnostic: list which store-related env keys exist (names only, no values).
  if (req.method === "GET" && req.query && req.query.debug === "env") {
    const keys = Object.keys(process.env).filter((k) => /KV|REDIS|UPSTASH/i.test(k));
    res.status(200).json({ envKeys: keys });
    return;
  }

  const creds = pickEnv();
  if (!creds.url || !creds.token) {
    const keys = Object.keys(process.env).filter((k) => /KV|REDIS|UPSTASH/i.test(k));
    res.status(503).json({ error: "store not connected", sawEnvKeys: keys });
    return;
  }

  try {
    if (req.method === "GET") {
      res.status(200).json({ responses: await readAll(creds) });
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
      await redis(["HSET", KEY, name.toLowerCase(), JSON.stringify(entry)], creds);
      res.status(200).json({ responses: await readAll(creds) });
      return;
    }

    res.setHeader("Allow", "GET, POST");
    res.status(405).json({ error: "method not allowed" });
  } catch (err) {
    res.status(500).json({ error: String((err && err.message) || err) });
  }
};
