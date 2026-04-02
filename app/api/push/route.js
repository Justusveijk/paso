// app/api/push/route.js
// MUST run on Node.js (not Edge) — web-push uses Node crypto
export const runtime = "nodejs";

import webpush from "web-push";
import { apiGuard, handleCORS } from "@/lib/api-guard";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

// Handle CORS preflight
export async function OPTIONS(request) {
  return handleCORS(request);
}

export async function POST(req) {
  const guard = apiGuard(req, "roadmapsWrite");
  if (guard.blocked) return guard.response;

  try {
    const { shareId, title, body, url } = await req.json();

    if (!shareId) {
      return Response.json({ error: "Missing shareId" }, { status: 400 });
    }

    const vapidPublic = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    const vapidPrivate = process.env.VAPID_PRIVATE_KEY;
    const vapidEmail = process.env.VAPID_EMAIL || "mailto:hello@numinlabs.com";

    if (!vapidPublic || !vapidPrivate) {
      return Response.json({
        error: "VAPID keys not configured",
        public: vapidPublic ? "set" : "MISSING",
        private: vapidPrivate ? "set" : "MISSING",
      }, { status: 500 });
    }

    webpush.setVapidDetails(vapidEmail, vapidPublic, vapidPrivate);

    // Fetch subscription from Supabase
    const supaRes = await fetch(
      `${SUPABASE_URL}/rest/v1/roadmaps?id=eq.${shareId}&select=push_subscription`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
    );
    const rows = await supaRes.json();

    if (!Array.isArray(rows) || !rows[0]?.push_subscription) {
      return Response.json({
        error: "No push subscription found",
        shareId,
        rowCount: rows?.length || 0,
      }, { status: 404 });
    }

    const subscription = JSON.parse(rows[0].push_subscription);

    const payload = JSON.stringify({
      title: title || "Paso — time to check in",
      body: body || "How's your goal going? Tap to see your roadmap.",
      url: url || "/",
    });

    await webpush.sendNotification(subscription, payload);

    return Response.json({ success: true });
  } catch (e) {
    console.error("Push send error:", e);
    if (e.statusCode === 410 || e.statusCode === 404) {
      return Response.json({ error: "Subscription expired — re-enable notifications", expired: true }, { status: 410 });
    }
    return Response.json({ error: e.message || String(e) }, { status: 500 });
  }
}
