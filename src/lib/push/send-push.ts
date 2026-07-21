import "server-only";

import webpush from "web-push";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

function requireEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

let vapidConfigured = false;
function ensureVapidConfigured() {
  if (vapidConfigured) {
    return;
  }
  webpush.setVapidDetails(requireEnv("VAPID_SUBJECT"), requireEnv("VAPID_PUBLIC_KEY"), requireEnv("VAPID_PRIVATE_KEY"));
  vapidConfigured = true;
}

/**
 * Sends a real browser push notification to every device the given profile(s) subscribed
 * from. Mirrors recordFinanceAuditEvent's calling convention (server-only, takes an
 * already-created service-role client, never throws into the caller) — a failed push should
 * never break the action that triggered it. `url` is resolved relative to the app origin by
 * the service worker's notificationclick handler (public/sw.js), so pass an app path like
 * `/m/{slug}/teacher/inbox`, not an absolute URL.
 */
export async function sendPushNotification(
  supabase: SupabaseClient<Database>,
  options: { recipientProfileIds: string | (string | null | undefined)[]; title: string; body: string; url?: string },
) {
  try {
    ensureVapidConfigured();
    const recipientIds = Array.from(
      new Set((Array.isArray(options.recipientProfileIds) ? options.recipientProfileIds : [options.recipientProfileIds]).filter((id): id is string => Boolean(id))),
    );
    if (recipientIds.length === 0) {
      return;
    }

    const { data: subscriptions } = await supabase.from("push_subscriptions").select("*").in("profile_id", recipientIds);
    if (!subscriptions?.length) {
      return;
    }

    const payload = JSON.stringify({ title: options.title, body: options.body, url: options.url ?? "/" });

    await Promise.all(
      subscriptions.map(async (subscription) => {
        try {
          await webpush.sendNotification(
            {
              endpoint: subscription.endpoint,
              keys: { p256dh: subscription.p256dh, auth: subscription.auth },
            },
            payload,
          );
        } catch (error) {
          const statusCode = (error as { statusCode?: number }).statusCode;
          if (statusCode === 404 || statusCode === 410) {
            await supabase.from("push_subscriptions").delete().eq("id", subscription.id);
            return;
          }
          console.error("Failed to send push notification:", error instanceof Error ? error.message : error);
        }
      }),
    );
  } catch (error) {
    console.error("sendPushNotification failed:", error instanceof Error ? error.message : error);
  }
}
