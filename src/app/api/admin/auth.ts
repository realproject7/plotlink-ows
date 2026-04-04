import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createServiceRoleClient } from "../../../../lib/supabase";
import { STORY_FACTORY } from "../../../../lib/contracts/constants";

/**
 * Constant-time string comparison that does NOT leak length.
 * Pads the shorter input with zeros so timingSafeEqual always runs on equal-length buffers.
 */
function safeCompare(a: string, b: string): boolean {
  const maxLen = Math.max(a.length, b.length);
  const bufA = Buffer.alloc(maxLen);
  const bufB = Buffer.alloc(maxLen);
  Buffer.from(a).copy(bufA);
  Buffer.from(b).copy(bufB);
  return a.length === b.length && timingSafeEqual(bufA, bufB);
}

/**
 * Shared handler for admin hide/unhide operations.
 * Authenticates via ADMIN_API_KEY, validates input, and toggles the hidden flag.
 */
export async function handleModeration(
  req: NextRequest,
  action: "hide" | "unhide",
): Promise<NextResponse> {
  const authHeader = req.headers.get("authorization");
  const adminKey = process.env.ADMIN_API_KEY;

  if (!adminKey) {
    return NextResponse.json(
      { error: "Server misconfigured" },
      { status: 500 },
    );
  }

  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!safeCompare(token, adminKey)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { type: string; id: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { type, id } = body;

  if (!type || !["storyline", "plot"].includes(type)) {
    return NextResponse.json(
      { error: 'type must be "storyline" or "plot"' },
      { status: 400 },
    );
  }
  if (typeof id !== "number" || !Number.isInteger(id) || id <= 0) {
    return NextResponse.json(
      { error: "id must be a positive integer" },
      { status: 400 },
    );
  }

  const supabase = createServiceRoleClient();
  if (!supabase) {
    return NextResponse.json(
      { error: "Database unavailable" },
      { status: 500 },
    );
  }

  const hidden = action === "hide";

  const contractAddr = STORY_FACTORY.toLowerCase();
  const { error: dbError } = type === "storyline"
    ? await supabase.from("storylines").update({ hidden }).eq("storyline_id", id).eq("contract_address", contractAddr)
    : await supabase.from("plots").update({ hidden }).eq("id", id).eq("contract_address", contractAddr);

  if (dbError) {
    return NextResponse.json(
      { error: `Database error: ${dbError.message}` },
      { status: 500 },
    );
  }

  console.log(`[admin] ${action} ${type} id=${id} at ${new Date().toISOString()}`);

  return NextResponse.json({ success: true, action, type, id });
}
