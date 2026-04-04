import { NextRequest, NextResponse } from "next/server";
import { createServerClient, supabase } from "../../../../lib/supabase";
import { STORY_FACTORY } from "../../../../lib/contracts/constants";

function error(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

// ---------------------------------------------------------------------------
// Rate limit constants
// ---------------------------------------------------------------------------

const RATE_LIMIT_MAX = 10;

// ---------------------------------------------------------------------------
// GET /api/views?storylineId=N
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest) {
  const storylineId = req.nextUrl.searchParams.get("storylineId");
  if (!storylineId) return error("Missing storylineId");

  const db = supabase;
  if (!db) return error("Supabase not configured", 500);

  const sid = Number(storylineId);
  if (isNaN(sid) || sid <= 0) return error("Invalid storylineId");

  const { data, error: dbError } = await db.from("storylines")
    .select("view_count")
    .eq("storyline_id", sid)
    .eq("contract_address", STORY_FACTORY.toLowerCase())
    .single();

  if (dbError) return error(`Database error: ${dbError.message}`, 500);
  if (!data) return error("Storyline not found", 404);

  return NextResponse.json({ storylineId: sid, viewCount: data.view_count ?? 0 });
}

// ---------------------------------------------------------------------------
// POST /api/views
// Body: { storylineId, plotIndex?, sessionId, viewerAddress? }
// Dedup: max 1 view per session per page per hour
// ---------------------------------------------------------------------------

interface ViewBody {
  storylineId: number;
  plotIndex?: number | null;
  sessionId: string;
  viewerAddress?: string | null;
}

export async function POST(req: NextRequest) {
  let body: ViewBody;
  try {
    body = await req.json();
  } catch {
    return error("Invalid JSON body");
  }

  const { storylineId, plotIndex, sessionId, viewerAddress } = body;

  if (!storylineId || typeof storylineId !== "number" || storylineId <= 0) {
    return error("Missing or invalid storylineId");
  }
  if (!sessionId || typeof sessionId !== "string" || sessionId.length > 128) {
    return error("Missing or invalid sessionId");
  }

  const plotVal = plotIndex ?? null;

  const serverClient = createServerClient();
  if (!serverClient) return error("Supabase not configured", 500);

  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

  // Durable rate limit: max 10 views per session per storyline per hour
  const { count: recentCount, error: countError } = await serverClient.from("page_views")
    .select("id", { count: "exact", head: true })
    .eq("session_id", sessionId)
    .eq("storyline_id", storylineId)
    .gte("viewed_at", oneHourAgo);

  if (countError) return error(`Database error: ${countError.message}`, 500);

  if (recentCount !== null && recentCount >= RATE_LIMIT_MAX) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": "3600" } },
    );
  }

  // Dedup: check if this session already viewed this page in the last hour
  let dedupQuery = serverClient.from("page_views")
    .select("id")
    .eq("storyline_id", storylineId)
    .eq("contract_address", STORY_FACTORY.toLowerCase())
    .eq("session_id", sessionId)
    .gte("viewed_at", oneHourAgo)
    .limit(1);

  if (plotVal === null) {
    dedupQuery = dedupQuery.is("plot_index", null);
  } else {
    dedupQuery = dedupQuery.eq("plot_index", plotVal);
  }

  const { data: existing } = await dedupQuery;

  if (existing && existing.length > 0) {
    return NextResponse.json({ success: true, deduplicated: true });
  }

  // Insert page view record
  const { error: insertError } = await serverClient.from("page_views").insert({
    storyline_id: storylineId,
    plot_index: plotVal,
    viewer_address: viewerAddress?.toLowerCase() ?? null,
    session_id: sessionId,
    contract_address: STORY_FACTORY.toLowerCase(),
  });

  if (insertError) return error(`Database error: ${insertError.message}`, 500);

  // Increment denormalized counter (storyline-level views only)
  if (plotVal === null) {
    // Ignore errors — counter will be slightly behind but page_views table is authoritative
    const { error: rpcError } = await serverClient.rpc("increment_view_count", {
      sid: storylineId,
      caddr: STORY_FACTORY.toLowerCase(),
    });
    if (rpcError) console.warn("increment_view_count failed:", rpcError.message);
  }

  return NextResponse.json({ success: true, deduplicated: false });
}
