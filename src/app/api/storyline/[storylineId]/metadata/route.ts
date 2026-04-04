import { NextRequest, NextResponse } from "next/server";
import { type Address } from "viem";
import { publicClient } from "../../../../../../lib/rpc";
import { createServerClient } from "../../../../../../lib/supabase";
import { STORY_FACTORY } from "../../../../../../lib/contracts/constants";
import { GENRES, LANGUAGES } from "../../../../../../lib/genres";

function error(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

interface PatchBody {
  genre?: string;
  language?: string;
  address: string;
  signature: string;
  message: string;
}

// ---------------------------------------------------------------------------
// PATCH /api/storyline/[storylineId]/metadata
// ---------------------------------------------------------------------------

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ storylineId: string }> },
) {
  const { storylineId: storylineIdParam } = await params;
  const storylineId = Number(storylineIdParam);
  if (!storylineId || !Number.isInteger(storylineId)) {
    return error("Invalid storylineId");
  }

  let body: PatchBody;
  try {
    body = await req.json();
  } catch {
    return error("Invalid JSON body");
  }

  const { genre, language, address, signature, message } = body;

  if (!address || !signature || !message) {
    return error("Missing address, signature, or message");
  }

  if (!genre && !language) {
    return error("Must provide genre or language");
  }

  if (genre && !(GENRES as readonly string[]).includes(genre)) {
    return error("Invalid genre");
  }

  if (language && !(LANGUAGES as readonly string[]).includes(language)) {
    return error("Invalid language");
  }

  // Build expected message to prevent replay / cross-action attacks
  const expectedMessage = `Update storyline ${storylineId} metadata genre:${genre || ""} language:${language || ""}`;
  if (message !== expectedMessage) {
    return error(`Signed message must be exactly: "${expectedMessage}"`);
  }

  // Verify signature (supports both EOA and EIP-1271 contract wallets)
  const callerAddress = address as Address;
  try {
    const valid = await publicClient.verifyMessage({
      address: callerAddress,
      message,
      signature: signature as `0x${string}`,
    });
    if (!valid) {
      return error("Invalid signature");
    }
  } catch {
    return error("Failed to verify signature");
  }

  const db = createServerClient();
  if (!db) {
    return error("Supabase not configured", 500);
  }

  // Validate caller is the storyline writer
  const { data: storyline, error: fetchErr } = await db
    .from("storylines")
    .select("writer_address")
    .eq("storyline_id", storylineId)
    .eq("contract_address", STORY_FACTORY.toLowerCase())
    .single();

  if (fetchErr || !storyline) {
    return error("Storyline not found", 404);
  }

  if (storyline.writer_address.toLowerCase() !== callerAddress.toLowerCase()) {
    return error("Not the storyline writer", 403);
  }

  // Build update payload
  const update: Record<string, string> = {};
  if (genre) update.genre = genre;
  if (language) update.language = language;

  const { data: updated, error: updateErr } = await db
    .from("storylines")
    .update(update)
    .eq("storyline_id", storylineId)
    .eq("contract_address", STORY_FACTORY.toLowerCase())
    .select()
    .single();

  if (updateErr) {
    return error(`Database error: ${updateErr.message}`, 500);
  }

  return NextResponse.json({ storyline: updated });
}
