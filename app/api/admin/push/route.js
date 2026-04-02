export const runtime = "nodejs";

import crypto from "crypto";
import webpush from "web-push";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

function isAuthed(req) {
  const cookie = req.cookies.get("paso_admin_session");
  const password = process.env.ADMIN_PASSWORD;
  if (!password || !cookie) return false;
  const expected = crypto.createHash("sha256").update(password + "paso-admin-salt").digest("hex");
  return cookie.value === expected;
}

export async function POST(req) {
  if (!isAuthed(req)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { title, body, url } = await req.json();

    if (!title || !body) {
      return Response.json({ error: "Title and body are required" }, { status: 400 });
    }

    const vapidPublic = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    const vapidPrivate = process.env.VAPID_PRIVATE_KEY;
    const vapidEmail = process.env.VAPID_EMAIL || "mailto:hello@numinlabs.com";

    if (!vapidPublic || !vapidPrivate) {
      return Response.json({ error: "VAPID keys not configured" }, { status: 500 });
    }

    webpush.setVapidDetails(vapidEmail, vapidPublic, vapidPrivate);

    // Fetch all subscribers
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/roadmaps?nudge_enabled=eq.true&push_subscription=neq.null&select=id,push_subscription`,
      {
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
        },
      }
    );
    const users = await res.json();

    if (!Array.isArray(users) || users.length === 0) {
      return Response.json({ sent: 0, failed: 0, total: 0, message: "No subscribers found" });
    }

    const payload = JSON.stringify({ title, body, url: url || "/" });
    let sent = 0;
    let failed = 0;
    const errors = [];

    for (const user of users) {
      if (!user.push_subscription) { failed++; continue; }
      try {
        const sub = JSON.parse(user.push_subscription);
        await webpush.sendNotification(sub, payload);
        sent++;
      } catch (e) {
        failed++;
        if (e.statusCode === 410 || e.statusCode === 404) {
          // Expired subscription — disable
          await fetch(`${SUPABASE_URL}/rest/v1/roadmaps?id=eq.${user.id}`, {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json",
              apikey: SUPABASE_KEY,
              Authorization: `Bearer ${SUPABASE_KEY}`,
            },
            body: JSON.stringify({ nudge_enabled: false, push_subscription: null }),
          });
          errors.push({ id: user.id, reason: "expired" });
        } else {
          errors.push({ id: user.id, reason: e.message });
        }
      }
    }

    return Response.json({
      sent,
      failed,
      total: users.length,
      errors: errors.slice(0, 10), // Limit error details
      timestamp: new Date().toISOString(),
    });
  } catch (e) {
    console.error("Admin push error:", e);
    return Response.json({ error: e.message }, { status: 500 });
  }
}
