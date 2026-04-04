import { NextRequest, NextResponse } from "next/server";
import { uploadWithRetry } from "../../../../lib/filebase";

export async function POST(req: NextRequest) {
  try {
    const { content, key } = await req.json();
    if (!content || !key) {
      return NextResponse.json(
        { error: "Missing content or key" },
        { status: 400 },
      );
    }

    const cid = await uploadWithRetry(content, key);
    return NextResponse.json({ cid });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Upload failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
