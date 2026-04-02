export const runtime = "nodejs";

import crypto from "crypto";

function getExpectedHash() {
  const password = process.env.ADMIN_PASSWORD;
  if (!password) return null;
  return crypto
    .createHash("sha256")
    .update(password + "paso-admin-salt")
    .digest("hex");
}

// POST — login
export async function POST(req) {
  try {
    const { password } = await req.json();
    const adminPassword = process.env.ADMIN_PASSWORD;

    if (!adminPassword) {
      return Response.json({ error: "Admin not configured" }, { status: 500 });
    }

    if (password !== adminPassword) {
      return Response.json({ error: "Invalid password" }, { status: 401 });
    }

    const hash = getExpectedHash();
    const res = Response.json({ success: true });
    res.headers.set(
      "Set-Cookie",
      `paso_admin_session=${hash}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${60 * 60 * 24}`
    );
    return res;
  } catch {
    return Response.json({ error: "Bad request" }, { status: 400 });
  }
}

// GET — session check
export async function GET(req) {
  const cookie = req.cookies.get("paso_admin_session");
  const expected = getExpectedHash();

  if (!expected || !cookie || cookie.value !== expected) {
    return Response.json({ authenticated: false });
  }

  return Response.json({ authenticated: true });
}

// DELETE — logout
export async function DELETE() {
  const res = Response.json({ success: true });
  res.headers.set(
    "Set-Cookie",
    "paso_admin_session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0"
  );
  return res;
}
