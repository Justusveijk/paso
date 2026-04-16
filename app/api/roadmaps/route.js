// app/api/roadmaps/route.js
// All Supabase operations proxied through here.
// Frontend never sees SUPABASE_URL or SUPABASE_KEY.

/* ─── ANIMO DATA HOOKS (scaffold) ───
 * The following roadmap fields will be shared with or expanded in Animo
 * (the full psychology app that Paso feeds into):
 *
 * - meaning_statement  → derived from goal + answers; will map to Animo's
 *                         core "personal meaning" construct for longitudinal tracking
 * - roadmap_steps      → phases[].milestones; Animo will expand these into
 *                         micro-interventions with CBT/ACT framing
 * - completion_rate    → computed from progress object (checked / total milestones);
 *                         Animo will track this over time for behavioral trends
 * - session_frequency  → derived from created_at + progress save timestamps;
 *                         Animo will use this for engagement modeling
 * - notification_engagement → nudge_enabled + nudge_last_sent + push open tracking;
 *                              Animo will expand with adaptive notification timing
 *
 * Current Supabase schema (roadmaps table):
 *   id, goal, roadmap, roadmap_json, answers, progress, user_name,
 *   push_subscription, nudge_enabled, nudge_frequency, nudge_last_sent, created_at
 *
 * When building Animo's schema, add:
 *   - user_id (FK to auth.users — Paso has no auth, Animo will)
 *   - meaning_statement (text, extracted from goal + answer synthesis)
 *   - session_log (jsonb[], timestamped engagement events)
 *   - notification_opens (int, track push tap-throughs)
 *   - therapist_notes (text, for Animo's professional layer)
 * ─────────────────────────────────────────────────────── */

import { NextResponse } from "next/server";
import { apiGuard, handleCORS } from "@/lib/api-guard";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

// Handle CORS preflight
export async function OPTIONS(request) {
  return handleCORS(request);
}

const headers = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  "Content-Type": "application/json",
};

function sanitize(str, maxLen = 2000) {
  if (typeof str !== "string") return "";
  return str.replace(/<[^>]*>/g, "").trim().slice(0, maxLen);
}

// ─── GET /api/roadmaps?id=xxx ───
// Load a single roadmap by ID
export async function GET(request) {
  const guard = apiGuard(request, "roadmapsRead");
  if (guard.blocked) return guard.response;

  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id || !/^[a-z0-9]+$/.test(id)) {
      return NextResponse.json({ error: "Invalid or missing ID" }, { status: 400 });
    }

    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/roadmaps?id=eq.${id}&select=*`,
      { headers }
    );

    if (!res.ok) {
      return NextResponse.json({ error: "Failed to load" }, { status: res.status });
    }

    const data = await res.json();
    if (!data.length) {
      return NextResponse.json({ error: "Roadmap not found" }, { status: 404 });
    }

    return NextResponse.json(data[0]);
  } catch (error) {
    console.error("GET /api/roadmaps error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ─── POST /api/roadmaps ───
// Save a new roadmap
export async function POST(request) {
  const guard = apiGuard(request, "roadmapsWrite");
  if (guard.blocked) return guard.response;

  try {
    const body = await request.json();
    const { id, goal, roadmap, answers, progress } = body;

    if (!id || !goal || !roadmap) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // Validate ID format
    if (!/^[a-z0-9]+$/.test(id)) {
      return NextResponse.json({ error: "Invalid ID format" }, { status: 400 });
    }

    const res = await fetch(`${SUPABASE_URL}/rest/v1/roadmaps`, {
      method: "POST",
      headers: { ...headers, Prefer: "return=representation" },
      body: JSON.stringify({
        id,
        goal: sanitize(goal, 500),
        roadmap,
        answers: answers || [],
        progress: progress || {},
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      return NextResponse.json({ error: `Save failed: ${errText}` }, { status: res.status });
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("POST /api/roadmaps error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ─── PATCH /api/roadmaps ───
// Update progress, nudge settings, roadmap data, user_name, etc.
export async function PATCH(request) {
  const guard = apiGuard(request, "roadmapsWrite");
  if (guard.blocked) return guard.response;

  try {
    const body = await request.json();
    const { id, ...updates } = body;

    if (!id || !/^[a-z0-9]+$/.test(id)) {
      return NextResponse.json({ error: "Invalid or missing ID" }, { status: 400 });
    }

    // Whitelist allowed fields to prevent arbitrary writes
    const allowed = [
      "progress", "nudge_enabled", "nudge_frequency",
      "push_subscription", "user_name", "roadmap",
      "paid", "paid_at", "stripe_session_id", "stripe_customer_email", "stripe_amount",
    ];
    const safeUpdates = {};
    for (const key of allowed) {
      if (key in updates) {
        if (key === "user_name") {
          safeUpdates[key] = sanitize(updates[key], 50) || null;
        } else {
          safeUpdates[key] = updates[key];
        }
      }
    }

    if (Object.keys(safeUpdates).length === 0) {
      return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
    }

    const res = await fetch(`${SUPABASE_URL}/rest/v1/roadmaps?id=eq.${id}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify(safeUpdates),
    });

    if (!res.ok) {
      return NextResponse.json({ error: `Update failed: ${res.status}` }, { status: res.status });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("PATCH /api/roadmaps error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
