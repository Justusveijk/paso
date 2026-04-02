export const runtime = "nodejs";

import crypto from "crypto";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

function isAuthed(req) {
  const cookie = req.cookies.get("paso_admin_session");
  const password = process.env.ADMIN_PASSWORD;
  if (!password || !cookie) return false;
  const expected = crypto.createHash("sha256").update(password + "paso-admin-salt").digest("hex");
  return cookie.value === expected;
}

const headers = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  "Content-Type": "application/json",
};

export async function GET(req) {
  if (!isAuthed(req)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Total users
    const totalRes = await fetch(
      `${SUPABASE_URL}/rest/v1/roadmaps?select=id&limit=0`,
      { headers: { ...headers, Prefer: "count=exact" } }
    );
    const totalCount = parseInt(totalRes.headers.get("content-range")?.split("/")[1] || "0");

    // Active 7d (created in last 7 days)
    const d7 = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const active7Res = await fetch(
      `${SUPABASE_URL}/rest/v1/roadmaps?select=id&created_at=gte.${d7}&limit=0`,
      { headers: { ...headers, Prefer: "count=exact" } }
    );
    const active7 = parseInt(active7Res.headers.get("content-range")?.split("/")[1] || "0");

    // Active 30d
    const d30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const active30Res = await fetch(
      `${SUPABASE_URL}/rest/v1/roadmaps?select=id&created_at=gte.${d30}&limit=0`,
      { headers: { ...headers, Prefer: "count=exact" } }
    );
    const active30 = parseInt(active30Res.headers.get("content-range")?.split("/")[1] || "0");

    // Push subscribers
    const pushRes = await fetch(
      `${SUPABASE_URL}/rest/v1/roadmaps?select=id&nudge_enabled=eq.true&limit=0`,
      { headers: { ...headers, Prefer: "count=exact" } }
    );
    const pushSubscribers = parseInt(pushRes.headers.get("content-range")?.split("/")[1] || "0");

    // Users with progress (at least one checked milestone)
    const progressRes = await fetch(
      `${SUPABASE_URL}/rest/v1/roadmaps?select=id,progress&progress=neq.{}`,
      { headers }
    );
    const progressData = await progressRes.json();
    const withProgress = Array.isArray(progressData)
      ? progressData.filter(r => {
          if (!r.progress || typeof r.progress !== "object") return false;
          return Object.entries(r.progress).some(([k, v]) => k !== "_credits" && v === true);
        }).length
      : 0;

    return Response.json({
      total_users: totalCount,
      active_7d: active7,
      active_30d: active30,
      push_subscribers: pushSubscribers,
      users_with_progress: withProgress,
    });
  } catch (e) {
    console.error("Admin stats error:", e);
    return Response.json({ error: "Failed to fetch stats" }, { status: 500 });
  }
}
