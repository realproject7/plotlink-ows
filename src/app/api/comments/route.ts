import { NextRequest, NextResponse } from "next/server";
import { type Address } from "viem";
import { publicClient } from "../../../../lib/rpc";
import { createServerClient, supabase } from "../../../../lib/supabase";
import { STORY_FACTORY } from "../../../../lib/contracts/constants";

const MAX_COMMENT_LENGTH = 1000;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

function error(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

// ---------------------------------------------------------------------------
// GET /api/comments?storylineId=N&plotIndex=M&offset=0
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest) {
  const storylineId = req.nextUrl.searchParams.get("storylineId");
  const plotIndex = req.nextUrl.searchParams.get("plotIndex");

  if (!storylineId || !plotIndex) return error("Missing storylineId or plotIndex");

  const db = supabase;
  if (!db) return error("Supabase not configured", 500);

  const sid = Number(storylineId);
  const pidx = Number(plotIndex);
  if (isNaN(sid) || isNaN(pidx)) return error("Invalid storylineId or plotIndex");

  const limit = Math.min(Math.max(Number(req.nextUrl.searchParams.get("limit") ?? DEFAULT_LIMIT), 1), MAX_LIMIT);
  const page = Math.max(Number(req.nextUrl.searchParams.get("page") ?? 1), 1);
  const offset = (page - 1) * limit;

  const { data, error: dbError } = await db.from("comments")
    .select("*")
    .eq("storyline_id", sid)
    .eq("plot_index", pidx)
    .eq("hidden", false)
    .eq("contract_address", STORY_FACTORY.toLowerCase())
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (dbError) return error(`Database error: ${dbError.message}`, 500);

  // Get total count for pagination
  const { count } = await db.from("comments")
    .select("id", { count: "exact", head: true })
    .eq("storyline_id", sid)
    .eq("plot_index", pidx)
    .eq("hidden", false)
    .eq("contract_address", STORY_FACTORY.toLowerCase());

  return NextResponse.json({
    comments: data ?? [],
    total: count ?? 0,
    page,
    limit,
  });
}

// ---------------------------------------------------------------------------
// POST /api/comments
// Body: { storylineId, plotIndex, content, address, signature, message }
// Rate limit: 1 comment per address per plot per minute
// ---------------------------------------------------------------------------

interface CommentBody {
  storylineId: number;
  plotIndex: number;
  content: string;
  address: string;
  signature: string;
  message: string;
}

export async function POST(req: NextRequest) {
  let body: CommentBody;
  try {
    body = await req.json();
  } catch {
    return error("Invalid JSON body");
  }

  const { storylineId, plotIndex, content, address, signature, message } = body;

  if (!storylineId || typeof storylineId !== "number") return error("Missing or invalid storylineId");
  if (typeof plotIndex !== "number" || plotIndex < 0) return error("Missing or invalid plotIndex");
  if (!content || typeof content !== "string") return error("Missing content");
  if (content.length > MAX_COMMENT_LENGTH) return error(`Comment must be ${MAX_COMMENT_LENGTH} characters or fewer`);
  if (!address || !signature || !message) return error("Missing address, signature, or message");

  // Validate signed message binds to this specific comment
  const expectedMessage = `Comment on storyline ${storylineId} plot ${plotIndex}: ${content}`;
  if (message !== expectedMessage) {
    return error(`Signed message must be exactly: "${expectedMessage}"`);
  }

  // Verify signature
  const commenterAddress = address as Address;
  try {
    const valid = await publicClient.verifyMessage({
      address: commenterAddress,
      message,
      signature: signature as `0x${string}`,
    });
    if (!valid) return error("Invalid signature");
  } catch {
    return error("Failed to verify signature");
  }

  const serverClient = createServerClient();
  if (!serverClient) return error("Supabase not configured", 500);

  // Validate that the (storyline_id, plot_index) pair exists
  const { data: plot, error: plotError } = await serverClient.from("plots")
    .select("id")
    .eq("storyline_id", storylineId)
    .eq("plot_index", plotIndex)
    .eq("contract_address", STORY_FACTORY.toLowerCase())
    .limit(1);

  if (plotError) return error(`Database error: ${plotError.message}`, 500);
  if (!plot || plot.length === 0) {
    return error("Plot does not exist");
  }

  // Rate limit: max 1 comment per address per plot per minute
  const oneMinuteAgo = new Date(Date.now() - 60 * 1000).toISOString();
  const { data: recent } = await serverClient.from("comments")
    .select("id")
    .eq("storyline_id", storylineId)
    .eq("plot_index", plotIndex)
    .eq("commenter_address", commenterAddress.toLowerCase())
    .eq("contract_address", STORY_FACTORY.toLowerCase())
    .gte("created_at", oneMinuteAgo)
    .limit(1);

  if (recent && recent.length > 0) {
    return NextResponse.json(
      { error: "Please wait before commenting again" },
      { status: 429, headers: { "Retry-After": "60" } },
    );
  }

  // Insert comment
  const { error: insertError } = await serverClient.from("comments").insert({
    storyline_id: storylineId,
    plot_index: plotIndex,
    commenter_address: commenterAddress.toLowerCase(),
    content,
    contract_address: STORY_FACTORY.toLowerCase(),
  });

  if (insertError) return error(`Database error: ${insertError.message}`, 500);

  return NextResponse.json({ success: true });
}
