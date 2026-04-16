// app/api/stripe/checkout/route.js
// Creates a Stripe Checkout session for token pack purchase.
//
// Stripe setup:
// 1. Create 3 products in Stripe Dashboard:
//    - "PASO — Chispa" (8 tokens, €2)   → price ID in STRIPE_PRICE_CHISPA
//    - "PASO — Camino" (24 tokens, €5)  → price ID in STRIPE_PRICE_CAMINO
//    - "PASO — Destino" (64 tokens, €10) → price ID in STRIPE_PRICE_DESTINO
// 2. Each should be a one-time payment.

import { NextResponse } from "next/server";
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const PACKS = {
  chispa:  { env: "STRIPE_PRICE_CHISPA",  tokens: 8 },
  camino:  { env: "STRIPE_PRICE_CAMINO",  tokens: 24 },
  destino: { env: "STRIPE_PRICE_DESTINO", tokens: 64 },
};

export async function POST(request) {
  try {
    const body = await request.json();
    const { pack, userId } = body;

    if (!pack || !PACKS[pack]) {
      return NextResponse.json({ error: "Invalid pack" }, { status: 400 });
    }
    if (!userId || typeof userId !== "string") {
      return NextResponse.json({ error: "Missing userId" }, { status: 400 });
    }

    const packInfo = PACKS[pack];
    const priceId = process.env[packInfo.env];
    if (!priceId) {
      return NextResponse.json({ error: "Payment not configured for this pack" }, { status: 500 });
    }

    const baseUrl = process.env.NEXT_PUBLIC_URL || "https://paso.numinalabs.app";

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${baseUrl}?unlocked=true&pack=${pack}`,
      cancel_url: baseUrl,
      metadata: {
        userId,
        tokens: String(packInfo.tokens),
        pack,
      },
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
