import { NextRequest, NextResponse } from "next/server";
import {
  saveUserNotificationToken,
  disableUserNotifications,
} from "../../../../../lib/notifications.server";
import {
  parseWebhookEvent,
  verifyAppKeyWithNeynar,
  type ParseWebhookEvent,
} from "@farcaster/miniapp-node";

/**
 * [#489] Webhook for Farcaster miniapp notification events.
 * Handles: miniapp_added, miniapp_removed, notifications_enabled, notifications_disabled
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    if (!process.env.NEYNAR_API_KEY) {
      console.error("[WEBHOOK] NEYNAR_API_KEY not set — rejecting unverified webhook");
      return NextResponse.json({ error: "Server misconfigured" }, { status: 503 });
    }

    let data;
    try {
      data = await parseWebhookEvent(body, verifyAppKeyWithNeynar);
    } catch (e: unknown) {
      const error = e as ParseWebhookEvent.ErrorType;

      switch (error.name) {
        case "VerifyJsonFarcasterSignature.InvalidDataError":
        case "VerifyJsonFarcasterSignature.InvalidEventDataError":
          return NextResponse.json({ error: "Invalid request data" }, { status: 400 });
        case "VerifyJsonFarcasterSignature.InvalidAppKeyError":
          return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
        default:
          console.error("Webhook verification error:", error);
          return NextResponse.json({ error: "Verification failed" }, { status: 500 });
      }
    }

    const { fid, event, appFid } = data;

    switch (event.event) {
      case "miniapp_added":
      case "notifications_enabled":
        if (event.notificationDetails?.token && event.notificationDetails?.url) {
          await saveUserNotificationToken(
            fid,
            event.notificationDetails.token,
            event.notificationDetails.url,
            appFid > 0 ? appFid : undefined,
          );
        }
        break;

      case "notifications_disabled":
      case "miniapp_removed":
        await disableUserNotifications(fid);
        break;
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[WEBHOOK] Error processing webhook:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
