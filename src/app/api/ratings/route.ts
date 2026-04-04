import { NextRequest, NextResponse } from "next/server";
import { type Address } from "viem";
import { publicClient } from "../../../../lib/rpc";
import { createServerClient, supabase } from "../../../../lib/supabase";
import { erc20Abi } from "../../../../lib/price";
import { STORY_FACTORY } from "../../../../lib/contracts/constants";

const MAX_COMMENT_LENGTH = 500;

function error(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

// ---------------------------------------------------------------------------
// GET /api/ratings?storylineId=N
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest) {
  const storylineId = req.nextUrl.searchParams.get("storylineId");
  if (!storylineId) {
    return error("Missing storylineId");
  }

  const db = supabase;
  if (!db) {
    return error("Supabase not configured", 500);
  }

  const limit = Math.min(Number(req.nextUrl.searchParams.get("limit") ?? 20), 100);
  const offset = Math.max(Number(req.nextUrl.searchParams.get("offset") ?? 0), 0);
  const sid = Number(storylineId);

  // Fetch all ratings for global average/count, then slice for pagination
  const { data: allData, error: allError } = await db.from("ratings")
    .select("rating")
    .eq("storyline_id", sid)
    .eq("contract_address", STORY_FACTORY.toLowerCase());

  if (allError) {
    return error(`Database error: ${allError.message}`, 500);
  }

  const allRatings = allData ?? [];
  const count = allRatings.length;
  const average =
    count > 0
      ? allRatings.reduce((sum: number, r: { rating: number }) => sum + r.rating, 0) / count
      : 0;

  // Paginated query for full rating objects
  const { data, error: dbError } = await db.from("ratings")
    .select("*")
    .eq("storyline_id", sid)
    .eq("contract_address", STORY_FACTORY.toLowerCase())
    .order("updated_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (dbError) {
    return error(`Database error: ${dbError.message}`, 500);
  }

  const ratings = data ?? [];

  // Optionally look up the caller's own rating (may not be on current page)
  const raterAddress = req.nextUrl.searchParams.get("raterAddress");
  let myRating: unknown = null;
  if (raterAddress) {
    const { data: mine } = await db.from("ratings")
      .select("*")
      .eq("storyline_id", sid)
      .eq("rater_address", raterAddress.toLowerCase())
      .eq("contract_address", STORY_FACTORY.toLowerCase())
      .single();
    myRating = mine ?? null;
  }

  return NextResponse.json({ ratings, average, count, limit, offset, myRating });
}

// ---------------------------------------------------------------------------
// POST /api/ratings
// ---------------------------------------------------------------------------

interface RatingBody {
  storylineId: number;
  rating: number;
  comment?: string;
  address: string;
  signature: string;
  message: string;
}

export async function POST(req: NextRequest) {
  let body: RatingBody;
  try {
    body = await req.json();
  } catch {
    return error("Invalid JSON body");
  }

  const { storylineId, rating, comment, address, signature, message } = body;

  // Validate inputs
  if (!storylineId || typeof storylineId !== "number") {
    return error("Missing or invalid storylineId");
  }
  if (!rating || typeof rating !== "number" || !Number.isInteger(rating) || rating < 1 || rating > 5) {
    return error("Rating must be an integer between 1 and 5");
  }
  if (!address || !signature || !message) {
    return error("Missing address, signature, or message");
  }
  if (comment && comment.length > MAX_COMMENT_LENGTH) {
    return error(`Comment must be ${MAX_COMMENT_LENGTH} characters or fewer`);
  }

  // Validate signed message binds to this specific action (including comment)
  const boundComment = comment ?? "";
  const expectedMessage = `Rate storyline ${storylineId} with rating ${rating} comment:${boundComment}`;
  if (message !== expectedMessage) {
    return error(
      `Signed message must be exactly: "${expectedMessage}"`,
    );
  }

  // 1. Verify signature (supports both EOA and EIP-1271 contract wallets)
  const raterAddress = address as Address;
  try {
    const valid = await publicClient.verifyMessage({
      address: raterAddress,
      message,
      signature: signature as `0x${string}`,
    });
    if (!valid) {
      return error("Invalid signature");
    }
  } catch {
    return error("Failed to verify signature");
  }

  // 2. Look up storyline → get token_address
  const serverClient = createServerClient();
  if (!serverClient) {
    return error("Supabase not configured", 500);
  }

  const { data: storyline, error: slError } = await serverClient.from("storylines")
    .select("token_address")
    .eq("storyline_id", storylineId)
    .eq("contract_address", STORY_FACTORY.toLowerCase())
    .single();

  if (slError || !storyline) {
    return error("Storyline not found", 404);
  }

  const tokenAddress = storyline.token_address as Address;

  // 3. Token gate: balanceOf(rater, tokenAddress) > 0
  try {
    const balance = await publicClient.readContract({
      address: tokenAddress,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [raterAddress],
    });

    if (balance === BigInt(0)) {
      return error("Must hold storyline tokens to rate", 403);
    }
  } catch {
    return error("Failed to check token balance", 502);
  }

  // 4. Upsert rating via service role client
  const { error: upsertError } = await serverClient.from("ratings").upsert(
    {
      storyline_id: storylineId,
      rater_address: raterAddress.toLowerCase(),
      rating,
      comment: comment ?? null,
      updated_at: new Date().toISOString(),
      contract_address: STORY_FACTORY.toLowerCase(),
    },
    { onConflict: "storyline_id,rater_address,contract_address" },
  );

  if (upsertError) {
    return error(`Database error: ${upsertError.message}`, 500);
  }

  return NextResponse.json({ success: true });
}
