// app/api/stripe/price/route.js
// Returns the current price for the roadmap unlock product.
// Frontend calls this to display the actual Stripe price.

import { NextResponse } from "next/server";
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export async function GET() {
  try {
    const priceId = process.env.STRIPE_PRODUCT_PRICE_ID;
    if (!priceId) {
      return NextResponse.json({ error: "Not configured" }, { status: 500 });
    }

    const price = await stripe.prices.retrieve(priceId);
    const amount = price.unit_amount; // in cents
    const currency = price.currency;  // e.g. "eur"

    // Format for display
    const formatter = new Intl.NumberFormat("en", {
      style: "currency",
      currency: currency.toUpperCase(),
      minimumFractionDigits: amount % 100 === 0 ? 0 : 2,
    });

    return NextResponse.json({
      amount,
      currency,
      formatted: formatter.format(amount / 100),
    });
  } catch (error) {
    console.error("Price fetch error:", error);
    return NextResponse.json({ error: "Failed to fetch price" }, { status: 500 });
  }
}
