// app/api/cron/nudge/route.js
// Vercel cron — runs weekly, sends push notifications to all opted-in users
// vercel.json: { "crons": [{ "path": "/api/cron/nudge", "schedule": "0 9 * * 1" }] }

export const runtime = "nodejs";

import webpush from "web-push";

// No fallbacks — if env vars are missing, fail loudly
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

export async function GET(req) {
  // CRON_SECRET is mandatory — without it, anyone can trigger nudges
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization");
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const vapidPublic = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const vapidPrivate = process.env.VAPID_PRIVATE_KEY;
  const vapidEmail = process.env.VAPID_EMAIL || "mailto:hello@numinlabs.com";

  if (!vapidPublic || !vapidPrivate || !SUPABASE_URL || !SUPABASE_KEY) {
    return Response.json({ error: "Missing env vars" }, { status: 500 });
  }

  webpush.setVapidDetails(vapidEmail, vapidPublic, vapidPrivate);

  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/roadmaps?nudge_enabled=eq.true&select=id,goal,roadmap_json,push_subscription,nudge_frequency,nudge_last_sent,user_name`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
    );
    const users = await res.json();

    if (!Array.isArray(users) || users.length === 0) {
      return Response.json({ message: "No nudge users", sent: 0 });
    }

    const now = new Date();
    let sent = 0, skipped = 0, expired = 0;

    for (const user of users) {
      if (!user.push_subscription || !user.goal) { skipped++; continue; }

      const lastSent = user.nudge_last_sent ? new Date(user.nudge_last_sent) : null;
      const daysSince = lastSent ? (now - lastSent) / (1000 * 60 * 60 * 24) : 999;
      if (user.nudge_frequency === "weekly" && daysSince < 6) { skipped++; continue; }
      if (user.nudge_frequency === "biweekly" && daysSince < 13) { skipped++; continue; }
      if (user.nudge_frequency === "monthly" && daysSince < 27) { skipped++; continue; }

      let milestone = "your next milestone";
      try {
        const rm = typeof user.roadmap_json === "string" ? JSON.parse(user.roadmap_json) : user.roadmap_json;
        if (rm?.phases?.[0]?.milestones?.[0]) milestone = rm.phases[0].milestones[0];
      } catch (e) {}

      const name = user.user_name || "";
      const goalShort = (user.goal || "your goal").slice(0, 60);

      const titles = name ? [
        `${name}, your roadmap misses you`,
        `Hey ${name}! That goal won't chase itself`,
        `${name}... we need to talk about your milestones`,
        `${name}, you've been quiet. Too quiet.`,
        `Plot twist: ${name} actually does the thing`,
        `${name}, your future self is watching`,
        `Quick check-in, ${name}!`,
      ] : [
        "Your roadmap misses you",
        "That goal won't chase itself",
        "We need to talk about your milestones...",
        "You've been quiet. Too quiet.",
        "Your future self is watching",
        "Monday check-in time!",
        "Plot twist: you actually do the thing",
      ];

      const bodies = [
        `"${goalShort}" — remember this? Still on track?`,
        `One step closer to "${goalShort}". Or one week further from it. Your call.`,
        `${milestone} — that's literally all you need to focus on today.`,
        `Quick reminder: "${goalShort}" isn't going to happen by itself.`,
        `Focus on: ${milestone}. That's it. That's the whole plan for today.`,
      ];

      const title = titles[Math.floor(Math.random() * titles.length)];
      const body = bodies[Math.floor(Math.random() * bodies.length)];

      const payload = JSON.stringify({
        title,
        body,
        url: `/?r=${user.id}`,
      });

      try {
        const sub = JSON.parse(user.push_subscription);
        await webpush.sendNotification(sub, payload);
        sent++;
        await fetch(`${SUPABASE_URL}/rest/v1/roadmaps?id=eq.${user.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
          body: JSON.stringify({ nudge_last_sent: now.toISOString() }),
        });
      } catch (e) {
        if (e.statusCode === 410 || e.statusCode === 404) {
          expired++;
          await fetch(`${SUPABASE_URL}/rest/v1/roadmaps?id=eq.${user.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json", apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
            body: JSON.stringify({ nudge_enabled: false, push_subscription: null }),
          });
        }
      }
    }

    return Response.json({ sent, skipped, expired });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
