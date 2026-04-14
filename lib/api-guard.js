// lib/api-guard.js
// Three layers of protection:
// 1. Custom secret header (blocks curl/terminal/external sites)
// 2. Origin check when present (blocks cross-origin attacks)
// 3. Per-IP rate limiting (limits damage even if bypassed)

const ALLOWED_ORIGINS = [
  "https://paso.numinalabs.app",
  // Uncomment for local dev:
  // "http://localhost:3000",
];

// The frontend sends this on EVERY request.
// Terminal/curl users don't know it. Cross-origin sites can't send it
// without passing CORS preflight (which we only allow for our origin).
const CLIENT_HEADER = "X-Paso-Client";
const CLIENT_SECRET = "paso-web-2026";

// ─── CORS HEADERS ───
function corsHeaders(origin) {
  const isAllowed = origin && ALLOWED_ORIGINS.includes(origin);
  return {
    "Access-Control-Allow-Origin": isAllowed ? origin : "",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
    "Access-Control-Allow-Headers": `Content-Type, ${CLIENT_HEADER}`,
    "Access-Control-Max-Age": "86400",
  };
}

// Call this for OPTIONS requests in every route
export function handleCORS(request) {
  const origin = request.headers.get("origin") || "";
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}

// ─── RATE LIMITING ───
class RateLimitStore {
  constructor(maxSize = 5000) {
    this.map = new Map();
    this.maxSize = maxSize;
  }
  get(key) {
    const entry = this.map.get(key);
    if (!entry) return null;
    if (Date.now() > entry.resetTime) { this.map.delete(key); return null; }
    return entry;
  }
  increment(key, windowMs) {
    let entry = this.get(key);
    if (!entry) {
      if (this.map.size >= this.maxSize) {
        this.map.delete(this.map.keys().next().value);
      }
      entry = { count: 0, resetTime: Date.now() + windowMs };
      this.map.set(key, entry);
    }
    entry.count++;
    return entry;
  }
}

const LIMITS = {
  generate:       { windowMs: 60_000,     maxRequests: 4,  store: new RateLimitStore() },
  generateHourly: { windowMs: 3_600_000,  maxRequests: 20, store: new RateLimitStore() },
  roadmapsWrite:  { windowMs: 60_000,     maxRequests: 6,  store: new RateLimitStore() },
  roadmapsRead:   { windowMs: 60_000,     maxRequests: 30, store: new RateLimitStore() },
};

function getClientIP(request) {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return request.headers.get("x-real-ip") || "unknown";
}

function checkRateLimit(ip, config) {
  const entry = config.store.increment(ip, config.windowMs);
  if (entry.count > config.maxRequests) {
    return { allowed: false, retryAfter: Math.ceil((entry.resetTime - Date.now()) / 1000) };
  }
  return { allowed: true };
}

function blocked(status, msg, origin) {
  return {
    blocked: true,
    response: new Response(
      JSON.stringify({ error: msg }),
      { status, headers: { "Content-Type": "application/json", ...corsHeaders(origin) } }
    ),
  };
}

// ─── MAIN GUARD ───
export function apiGuard(request, limitKey) {
  const origin = request.headers.get("origin") || "";

  // Layer 1: Require secret header on ALL requests
  // Same-origin fetch sends it (we add it in frontend).
  // curl/terminal won't have it. Cross-origin sites trigger CORS
  // preflight and we only allow our origin to send custom headers.
  const clientValue = request.headers.get(CLIENT_HEADER);
  if (clientValue !== CLIENT_SECRET) {
    return blocked(403, "Forbidden", origin);
  }

  // Layer 2: If origin header IS present (cross-origin), it must be allowed
  if (origin && !ALLOWED_ORIGINS.includes(origin)) {
    return blocked(403, "Forbidden", origin);
  }

  // Layer 3: Rate limiting
  const ip = getClientIP(request);
  const config = LIMITS[limitKey];
  if (config) {
    const r = checkRateLimit(ip, config);
    if (!r.allowed) return blocked(429, "Too many requests. Please wait and try again.", origin);
  }
  if (limitKey === "generate") {
    const r = checkRateLimit(ip, LIMITS.generateHourly);
    if (!r.allowed) return blocked(429, "Hourly limit reached. Please try again later.", origin);
  }

  return { blocked: false, corsHeaders: corsHeaders(origin) };
}
