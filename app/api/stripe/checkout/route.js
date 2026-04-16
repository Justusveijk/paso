import Stripe from "stripe";
import { NextResponse } from "next/server";

function getStripe() {
  if (!process.env.STRIPE_SECRET_KEY) throw new Error("STRIPE_SECRET_KEY not configured");
  return new Stripe(process.env.STRIPE_SECRET_KEY);
}

const PACKS = {
  starter: { credits: 5, price: 300, name: "Starter — 5 credits" },
  builder: { credits: 15, price: 700, name: "Builder — 15 credits" },
  unlimited: { credits: 99, price: 1200, name: "Unlimited — 99 credits", recurring: true },
};

export async function POST(req) {
  try {
    const { packId, returnUrl } = await req.json();
    const pack = PACKS[packId];
    if (!pack) {
      return NextResponse.json({ error: "Invalid pack" }, { status: 400 });
    }

    const baseUrl = returnUrl || process.env.NEXT_PUBLIC_URL || "https://paso.numinlabs.com";

    const sessionConfig = {
      payment_method_types: ["card", "ideal"],
      line_items: [
        {
          price_data: {
            currency: "eur",
            product_data: { name: pack.name },
            unit_amount: pack.price,
            ...(pack.recurring && { recurring: { interval: "month" } }),
          },
          quantity: 1,
        },
      ],
      mode: pack.recurring ? "subscription" : "payment",
      success_url: `${baseUrl}?purchased=${packId}&credits=${pack.credits}`,
      cancel_url: `${baseUrl}?cancelled=true`,
      metadata: { packId, credits: String(pack.credits) },
    };

    const session = await getStripe().checkout.sessions.create(sessionConfig);

    return NextResponse.json({ url: session.url });
  } catch (e) {
    console.error("Stripe checkout error:", e.message);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
