// A small in-memory Redis with the commands the hang API uses. For tests and the dev server only.
class FakeRedis {
  constructor() { this.kv = new Map(); this.ttl = new Map(); }
  on() {}
  async get(k) { return this.kv.has(k) ? this.kv.get(k) : null; }
  async set(k, v, ...a) {
    if (a.includes('NX') && this.kv.has(k)) return null;
    this.kv.set(k, String(v));
    const ex = a.indexOf('EX'); if (ex >= 0) this.ttl.set(k, a[ex + 1]);
    return 'OK';
  }
  async del(...ks) { let n = 0; for (const k of ks) if (this.kv.delete(k)) n++; return n; }
  async expire(k, s) { if (this.kv.has(k)) { this.ttl.set(k, s); return 1; } return 0; }
  async incr(k) { const n = (+(this.kv.get(k) || 0)) + 1; this.kv.set(k, String(n)); return n; }
  h(k) { if (!this.kv.has(k)) this.kv.set(k, new Map()); return this.kv.get(k); }
  async hget(k, f) { const h = this.kv.get(k); return h && h.has(f) ? h.get(f) : null; }
  async hset(k, f, v) { this.h(k).set(f, String(v)); return 1; }
  async hdel(k, f) { const h = this.kv.get(k); return h && h.delete(f) ? 1 : 0; }
  async hlen(k) { const h = this.kv.get(k); return h ? h.size : 0; }
  async hexists(k, f) { const h = this.kv.get(k); return h && h.has(f) ? 1 : 0; }
  async hgetall(k) { const h = this.kv.get(k); return h ? Object.fromEntries(h) : {}; }
  l(k) { if (!this.kv.has(k)) this.kv.set(k, []); return this.kv.get(k); }
  async lpush(k, v) { this.l(k).unshift(String(v)); return this.l(k).length; }
  async ltrim(k, a, b) { this.kv.set(k, this.l(k).slice(a, b + 1)); return 'OK'; }
  async lrange(k, a, b) { return (this.kv.get(k) || []).slice(a, b + 1); }
  async lrem(k, n, v) { const l = this.l(k); const i = l.indexOf(v); if (i >= 0) { l.splice(i, 1); return 1; } return 0; }
}
module.exports = FakeRedis;
