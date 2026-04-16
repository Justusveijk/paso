// app/api/stripe/webhook/route.js
// Handles Stripe webhook events. Register this endpoint in Stripe Dashboard:
// https://paso.numinalabs.app/api/stripe/webhook
//
// Required events: checkout.session.completed
//
// Supabase table: user_tokens
//   user_id (text, primary key)
//   tokens (integer, default 0)
//   total_purchased (integer, default 0)
//   total_spent_cents (integer, default 0)
//   last_purchase_pack (text, nullable)
//   last_purchase_at (timestamptz, nullable)
//   purchases (jsonb[], default '[]')

import { NextResponse } from "next/server";
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

const supaHeaders = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  "Content-Type": "application/json",
};

export const dynamic = "force-dynamic";

export async function POST(request) {
  const body = await request.text();
  const sig = request.headers.get("stripe-signature");

  if (!sig) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error("Webhook signature verification failed:", err.message);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const { userId, tokens, pack } = session.metadata || {};

    if (userId && tokens) {
      const tokenCount = parseInt(tokens, 10);
      const amountCents = session.amount_total || 0;
      const email = session.customer_details?.email || null;
      const now = new Date().toISOString();

      try {
        // Check if user_tokens row exists
        const getRes = await fetch(
          `${SUPABASE_URL}/rest/v1/user_tokens?user_id=eq.${userId}&select=tokens,total_purchased,total_spent_cents,purchases`,
          { headers: supaHeaders }
        );
        const existing = await getRes.json();

        if (existing.length > 0) {
          // Update existing row — add tokens
          const row = existing[0];
          const newPurchases = [...(row.purchases || []), { pack, tokens: tokenCount, amount: amountCents, email, at: now, session_id: session.id }];
          await fetch(
            `${SUPABASE_URL}/rest/v1/user_tokens?user_id=eq.${userId}`,
            {
              method: "PATCH",
              headers: supaHeaders,
              body: JSON.stringify({
                tokens: (row.tokens || 0) + tokenCount,
                total_purchased: (row.total_purchased || 0) + tokenCount,
                total_spent_cents: (row.total_spent_cents || 0) + amountCents,
                last_purchase_pack: pack,
                last_purchase_at: now,
                purchases: newPurchases,
              }),
            }
          );
        } else {
          // Insert new row
          await fetch(
            `${SUPABASE_URL}/rest/v1/user_tokens`,
            {
              method: "POST",
              headers: { ...supaHeaders, Prefer: "return=minimal" },
              body: JSON.stringify({
                user_id: userId,
                tokens: tokenCount,
                total_purchased: tokenCount,
                total_spent_cents: amountCents,
                last_purchase_pack: pack,
                last_purchase_at: now,
                purchases: [{ pack, tokens: tokenCount, amount: amountCents, email, at: now, session_id: session.id }],
              }),
            }
          );
        }

        console.log(`[Stripe] ${pack} pack (${tokenCount} tokens) added for user ${userId}`);
      } catch (err) {
        console.error("Failed to update user_tokens:", err);
      }
    }
  }

  return NextResponse.json({ received: true });
}
