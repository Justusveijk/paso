// app/api/roadmaps/count/route.js
// Returns total roadmap count. No secrets exposed.

import { NextResponse } from "next/server";
import { apiGuard, handleCORS } from "@/lib/api-guard";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

export async function OPTIONS(request) {
  return handleCORS(request);
}

export async function GET(request) {
  const guard = apiGuard(request, "roadmapsRead");
  if (guard.blocked) return guard.response;

  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/roadmaps?select=id`, {
      method: "HEAD",
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        Prefer: "count=exact",
      },
    });

    const range = res.headers.get("content-range");
    const total = range ? parseInt(range.split("/")[1], 10) || 0 : 0;

    return NextResponse.json({ count: total });
  } catch (error) {
    console.error("GET /api/roadmaps/count error:", error);
    return NextResponse.json({ count: 0 });
  }
}
