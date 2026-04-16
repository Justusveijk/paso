// app/api/tokens/route.js
// GET: Fetch token balance for a user
// PATCH: Deduct tokens after generation/expand/adjust

import { NextResponse } from "next/server";
import { apiGuard, handleCORS } from "@/lib/api-guard";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

const headers = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  "Content-Type": "application/json",
};

export async function OPTIONS(request) {
  return handleCORS(request);
}

// GET /api/tokens?userId=xxx
export async function GET(request) {
  const guard = apiGuard(request, "roadmapsRead");
  if (guard.blocked) return guard.response;

  const { searchParams } = new URL(request.url);
  const userId = searchParams.get("userId");

  if (!userId) {
    return NextResponse.json({ tokens: 0 });
  }

  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/user_tokens?user_id=eq.${encodeURIComponent(userId)}&select=tokens`,
      { headers }
    );
    const data = await res.json();
    return NextResponse.json({ tokens: data[0]?.tokens ?? 0 });
  } catch {
    return NextResponse.json({ tokens: 0 });
  }
}

// PATCH /api/tokens — deduct tokens
// Body: { userId, cost }
export async function PATCH(request) {
  const guard = apiGuard(request, "roadmapsWrite");
  if (guard.blocked) return guard.response;

  try {
    const body = await request.json();
    const { userId, cost } = body;

    if (!userId || typeof cost !== "number" || cost <= 0) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    // Get current balance
    const getRes = await fetch(
      `${SUPABASE_URL}/rest/v1/user_tokens?user_id=eq.${encodeURIComponent(userId)}&select=tokens`,
      { headers }
    );
    const rows = await getRes.json();
    const current = rows[0]?.tokens ?? 0;

    if (current < cost) {
      return NextResponse.json({ error: "Insufficient tokens", tokens: current }, { status: 402 });
    }

    // Deduct
    await fetch(
      `${SUPABASE_URL}/rest/v1/user_tokens?user_id=eq.${encodeURIComponent(userId)}`,
      {
        method: "PATCH",
        headers,
        body: JSON.stringify({ tokens: current - cost }),
      }
    );

    return NextResponse.json({ tokens: current - cost });
  } catch (error) {
    console.error("Token deduct error:", error);
    return NextResponse.json({ error: "Failed to deduct tokens" }, { status: 500 });
  }
}
