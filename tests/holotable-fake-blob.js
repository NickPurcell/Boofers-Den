// In-memory stand-in for a PRIVATE Vercel Blob store, for HoloTable's tests and dev server. It has the
// parts of @vercel/blob that _holotable-store.js uses (put, get with byte ranges, head, del, list,
// issueSignedToken, presignUrl) and the same rules a private store enforces: every call says
// access "private", nothing is overwritten unless allowed, and a presigned PUT only accepts the one
// pathname, the size limit, the content types and the lifetime it was signed for.
//
// A presigned PUT URL from the fake looks like `${base}?t=<n>`. In tests, call fake.presignedPut(url,
// bytes, contentType) to play the browser's upload. The dev server routes PUTs on `base` to it.
class BlobNotFoundError extends Error {}
class BlobServiceNotAvailable extends Error {}   // the SDK's name for a store outage
class FakeBlob {
  constructor(base = "/__fakeblob/put") {
    this.files = new Map();     // pathname -> { buf, contentType, uploadedAt }
    this.grants = new Map();    // presigned PUT number -> { pathname, max, types, until, used }
    this.base = base;
    this.calls = [];            // [method, pathname] for tests that check what was touched
    this.n = 0;
    this.failPuts = 0;          // set > 0 to make the next N puts throw (a store outage)
  }
  _access(o) { if (!o || o.access !== "private") throw new Error("fake blob: access must be 'private'"); }
  _meta(p, f) { return { pathname: p, url: `https://fake.private.blob.vercel-storage.com/${p}`, downloadUrl: "", contentType: f.contentType, contentDisposition: "", cacheControl: "", size: f.buf.length, uploadedAt: f.uploadedAt, etag: `"${f.buf.length}-${p}"` }; }
  async put(pathname, body, opts) {
    this._access(opts);
    this.calls.push(["put", pathname]);
    if (this.failPuts > 0) { this.failPuts--; throw new BlobServiceNotAvailable("fake blob: store unavailable"); }
    if (this.files.has(pathname) && !opts.allowOverwrite) throw new Error("fake blob: This blob already exists");
    const buf = Buffer.from(body);
    this.files.set(pathname, { buf, contentType: opts.contentType || "application/octet-stream", uploadedAt: new Date() });
    return this._meta(pathname, this.files.get(pathname));
  }
  async head(pathname) {
    this.calls.push(["head", pathname]);
    const f = this.files.get(pathname);
    if (!f) throw new BlobNotFoundError("The requested blob does not exist");
    return this._meta(pathname, f);
  }
  async get(pathname, opts) {
    this._access(opts);
    this.calls.push(["get", pathname]);
    const f = this.files.get(pathname);
    if (!f) return null;
    let buf = f.buf;
    const headers = new Headers({ "content-type": f.contentType });
    const m = /^bytes=(\d+)-(\d*)$/.exec(String((opts.headers || {}).Range || (opts.headers || {}).range || ""));
    if (m) {
      const start = +m[1], end = Math.min(m[2] ? +m[2] : f.buf.length - 1, f.buf.length - 1);
      buf = f.buf.subarray(start, end + 1);
      headers.set("content-range", `bytes ${start}-${end}/${f.buf.length}`);
    }
    headers.set("content-length", String(buf.length));
    const stream = new ReadableStream({ start(c) { if (buf.length) c.enqueue(new Uint8Array(buf)); c.close(); } });
    return { statusCode: 200, stream, headers, blob: this._meta(pathname, f) };
  }
  async del(paths) {
    for (const p of [].concat(paths)) { this.calls.push(["del", p]); this.files.delete(p); }
  }
  async list(opts = {}) {
    const all = [...this.files.keys()].filter((p) => p.startsWith(opts.prefix || "")).sort();
    const from = +(opts.cursor || 0), limit = opts.limit || 1000;
    const page = all.slice(from, from + limit);
    const hasMore = from + limit < all.length;
    return { blobs: page.map((p) => this._meta(p, this.files.get(p))), hasMore, cursor: hasMore ? String(from + limit) : undefined };
  }
  async issueSignedToken(o) {
    return { delegationToken: JSON.stringify(o), clientSigningToken: "fake-secret", validUntil: o.validUntil || Date.now() + 3600e3 };
  }
  async presignUrl(token, o) {
    const scope = JSON.parse(token.delegationToken);
    if (o.operation !== "put" || !(scope.operations || []).includes("put")) throw new Error("fake blob: only presigned PUT is faked");
    if (scope.pathname && scope.pathname !== o.pathname) throw new Error("fake blob: pathname outside the token's scope");
    if (o.access !== "private") throw new Error("fake blob: access must be 'private'");
    const t = ++this.n;
    this.grants.set(t, {
      pathname: o.pathname, max: Math.min(o.maximumSizeInBytes || Infinity, scope.maximumSizeInBytes || Infinity),
      types: o.allowedContentTypes || scope.allowedContentTypes || null,
      until: Math.min(o.validUntil || Infinity, scope.validUntil || Infinity), overwrite: !!o.allowOverwrite, used: false,
    });
    return { presignedUrl: `${this.base}?t=${t}` };
  }
  // what the store does with a browser's PUT on a presigned URL: [status, message]
  async presignedPut(url, bytes, contentType) {
    const t = +(/[?&]t=(\d+)/.exec(String(url)) || [])[1];
    const g = this.grants.get(t);
    if (!g) return [403, "unknown signature"];
    if (Date.now() > g.until) return [403, "expired"];
    if (g.used) return [403, "already used"];
    if (bytes.length > g.max) return [413, "too large"];
    const type = String(contentType || "").split(";")[0].trim();
    if (g.types && !g.types.includes(type)) return [400, "content type not allowed"];
    if (this.files.has(g.pathname) && !g.overwrite) return [409, "exists"];
    g.used = true;
    this.files.set(g.pathname, { buf: Buffer.from(bytes), contentType: type || "application/octet-stream", uploadedAt: new Date() });
    this.calls.push(["presigned-put", g.pathname]);
    return [200, "ok"];
  }
}
FakeBlob.BlobNotFoundError = BlobNotFoundError;
FakeBlob.BlobServiceNotAvailable = BlobServiceNotAvailable;
module.exports = FakeBlob;
