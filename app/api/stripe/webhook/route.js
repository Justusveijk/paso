// app/api/stripe/webhook/route.js
// Handles Stripe webhook events. Register this endpoint in Stripe Dashboard:
// https://paso.numinalabs.app/api/stripe/webhook
//
// Required events to listen for: checkout.session.completed

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

// Next.js App Router: export config to disable body parsing for webhooks
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
    const roadmapId = session.metadata?.roadmapId;

    if (roadmapId) {
      try {
        // Update roadmap in Supabase with payment info
        const res = await fetch(
          `${SUPABASE_URL}/rest/v1/roadmaps?id=eq.${roadmapId}`,
          {
            method: "PATCH",
            headers: supaHeaders,
            body: JSON.stringify({
              paid: true,
              paid_at: new Date().toISOString(),
              stripe_session_id: session.id,
              stripe_customer_email: session.customer_details?.email || null,
              stripe_amount: session.amount_total,
            }),
          }
        );

        if (!res.ok) {
          console.error("Supabase update failed:", await res.text());
        } else {
          console.log(`[Stripe] Payment recorded for roadmap ${roadmapId}`);
        }
      } catch (err) {
        console.error("Failed to record payment:", err);
      }
    }
  }

  return NextResponse.json({ received: true });
}
