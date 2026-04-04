import { NextRequest, NextResponse } from "next/server";
import { saveUserNotificationToken } from "../../../../../lib/notifications.server";

/**
 * [#489] Client-side endpoint for saving notification tokens.
 * Belt-and-suspenders alongside the Farcaster webhook.
 */
export async function POST(request: NextRequest) {
  try {
    const { fid, token, url } = await request.json();

    if (!fid || !token || !url) {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    }

    await saveUserNotificationToken(fid, token, url);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to save notification token:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
