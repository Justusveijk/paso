export const maxDuration = 60;

/* ─── RATE LIMITING ─── */
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX = 8; // max 8 requests per minute per IP

function getRateLimitKey(req) {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"
  );
}

function checkRateLimit(key) {
  const now = Date.now();
  const entry = rateLimitMap.get(key);

  // Clean up old entries periodically
  if (rateLimitMap.size > 10000) {
    for (const [k, v] of rateLimitMap) {
      if (now - v.windowStart > RATE_LIMIT_WINDOW * 2) rateLimitMap.delete(k);
    }
  }

  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW) {
    rateLimitMap.set(key, { windowStart: now, count: 1 });
    return true;
  }

  if (entry.count >= RATE_LIMIT_MAX) return false;

  entry.count++;
  return true;
}

/* ─── INPUT VALIDATION ─── */
function sanitizeServerInput(str, maxLen = 8000) {
  if (typeof str !== "string") return "";
  return str.replace(/<[^>]*>/g, "").trim().slice(0, maxLen);
}

/* ─── ROUTE HANDLER ─── */
export async function POST(req) {
  try {
    // Rate limit check
    const ip = getRateLimitKey(req);
    if (!checkRateLimit(ip)) {
      return Response.json(
        { error: "Too many requests. Please wait a moment and try again." },
        { status: 429 }
      );
    }

    const body = await req.json();
    const { system, userMsg, maxTokens = 1024 } = body;

    // Validate inputs
    if (!system || !userMsg) {
      return Response.json({ error: "Missing required fields" }, { status: 400 });
    }

    if (typeof system !== "string" || typeof userMsg !== "string") {
      return Response.json({ error: "Invalid input types" }, { status: 400 });
    }

    // Cap max_tokens to prevent abuse
    const clampedTokens = Math.min(Math.max(parseInt(maxTokens) || 1024, 256), 8192);

    // Sanitize
    const cleanSystem = sanitizeServerInput(system, 6000);
    const cleanUserMsg = sanitizeServerInput(userMsg, 15000);

    if (!cleanSystem || !cleanUserMsg) {
      return Response.json({ error: "Input too short after sanitization" }, { status: 400 });
    }

    // Check API key exists
    if (!process.env.ANTHROPIC_API_KEY) {
      console.error("ANTHROPIC_API_KEY not configured");
      return Response.json({ error: "Server configuration error" }, { status: 500 });
    }

    // Call Anthropic
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: clampedTokens,
        system: cleanSystem,
        messages: [{ role: "user", content: cleanUserMsg }],
      }),
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      console.error("Anthropic API error:", res.status, errData);
      return Response.json(
        { error: errData?.error?.message || `API error: ${res.status}` },
        { status: res.status }
      );
    }

    const data = await res.json();
    return Response.json(data);
  } catch (e) {
    console.error("Generate API error:", e);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
