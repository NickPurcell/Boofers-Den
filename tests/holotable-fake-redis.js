// In-memory Redis for HoloTable's tests and dev server: the shared FakeRedis plus raw bytes
// (images), MGET/EXISTS/LINDEX, NX/PX on SET, and publish/subscribe across duplicate() connections.
const { EventEmitter } = require("events");
const FakeRedis = require("./fake-redis.js");

class HoloFakeRedis extends FakeRedis {
  constructor(bus) { super(); this.bus = bus || new EventEmitter(); this.handlers = []; this.subs = new Set(); this.bus.setMaxListeners(0); }
  on(ev, fn) { if (ev === "message") this.handlers.push(fn); return this; }
  async set(k, v, ...a) {
    if (a.includes("NX") && this.kv.has(k)) return null;
    this.kv.set(k, Buffer.isBuffer(v) ? Buffer.from(v) : String(v));
    return "OK";
  }
  async get(k) { const v = this.kv.get(k); return v === undefined ? null : Buffer.isBuffer(v) ? v.toString() : v; }
  async getBuffer(k) { const v = this.kv.get(k); return v === undefined ? null : Buffer.isBuffer(v) ? v : Buffer.from(String(v)); }
  async mget(...ks) { return Promise.all(ks.flat().map((k) => this.get(k))); }
  async exists(k) { return this.kv.has(k) ? 1 : 0; }
  async llen(k) { const l = this.kv.get(k); return Array.isArray(l) ? l.length : 0; }
  async lindex(k, i) { const l = this.kv.get(k) || []; return l[i] === undefined ? null : l[i]; }
  async hdel(k, ...fs) { const h = this.kv.get(k); let n = 0; for (const f of fs) if (h && h.delete(f)) n++; return n; }
  // ioredis-style pipeline: queue commands, run them in order on exec(), results as [err, value]
  pipeline() {
    const ops = [], self = this;
    const p = new Proxy({}, { get(_, name) {
      if (name === "exec") return async () => { const out = []; for (const [n, a] of ops) { try { out.push([null, await self[n](...a)]); } catch (e) { out.push([e, null]); } } return out; };
      return (...a) => { ops.push([name, a]); return p; };
    } });
    return p;
  }
  async publish(ch, msg) { this.bus.emit("msg", ch, msg); return 1; }
  duplicate() {
    const d = new HoloFakeRedis(this.bus);
    d.kv = this.kv;
    this.bus.on("msg", (ch, msg) => { if (d.subs.has(ch)) for (const fn of d.handlers) fn(ch, msg); });
    return d;
  }
  async subscribe(ch) { this.subs.add(ch); return 1; }
  async unsubscribe(ch) { this.subs.delete(ch); return 1; }
}
module.exports = HoloFakeRedis;
