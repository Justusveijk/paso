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

export async function GET(req) {
  if (!isAuthed(req)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/roadmaps?nudge_enabled=eq.true&select=id,goal,user_name,nudge_frequency,nudge_last_sent,created_at&order=created_at.desc`,
      {
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
        },
      }
    );
    const data = await res.json();
    return Response.json(Array.isArray(data) ? data : []);
  } catch (e) {
    console.error("Admin subscribers error:", e);
    return Response.json({ error: "Failed to fetch" }, { status: 500 });
  }
}
