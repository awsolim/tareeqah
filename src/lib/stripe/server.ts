import "server-only";

import Stripe from "stripe";

let stripe: Stripe | undefined;

export function getStripe() {
  if (stripe) {
    return stripe;
  }

  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    throw new Error("Missing required environment variable: STRIPE_SECRET_KEY");
  }

  stripe = new Stripe(secretKey);
  return stripe;
}

export function getStripeWebhookSecret() {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    throw new Error("Missing required environment variable: STRIPE_WEBHOOK_SECRET");
  }

  return webhookSecret;
}

export function shouldUseStripeConnect() {
  return process.env.STRIPE_CONNECT_PLATFORM === "true";
}
