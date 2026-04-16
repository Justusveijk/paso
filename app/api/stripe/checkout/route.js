// app/api/stripe/checkout/route.js
// Creates a Stripe Checkout session for one-time roadmap unlock.
//
// Stripe setup required:
// 1. Create a product in Stripe Dashboard called "PASO — Full Roadmap"
// 2. Add a one-time price (e.g. €4.99)
// 3. Copy the Price ID (starts with price_) into STRIPE_PRODUCT_PRICE_ID env var
// 4. Set STRIPE_SECRET_KEY from Stripe Dashboard → Developers → API keys

import { NextResponse } from "next/server";
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export async function POST(request) {
  try {
    const body = await request.json();
    const { roadmapId } = body;

    if (!roadmapId || !/^[a-z0-9]+$/.test(roadmapId)) {
      return NextResponse.json({ error: "Invalid roadmap ID" }, { status: 400 });
    }

    const priceId = process.env.STRIPE_PRODUCT_PRICE_ID;
    if (!priceId) {
      return NextResponse.json({ error: "Payment not configured" }, { status: 500 });
    }

    const baseUrl = process.env.NEXT_PUBLIC_URL || "https://paso.numinalabs.app";

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${baseUrl}?r=${roadmapId}&unlocked=true`,
      cancel_url: `${baseUrl}?r=${roadmapId}`,
      metadata: { roadmapId },
    });

    return NextResponse.json({ url: session.url });
  } catch (error) {
    console.error("Stripe checkout error:", error);
    return NextResponse.json(
      { error: "Failed to create checkout session" },
      { status: 500 }
    );
  }
}
