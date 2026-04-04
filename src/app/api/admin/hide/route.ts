import { type NextRequest } from "next/server";
import { handleModeration } from "../auth";

export async function POST(req: NextRequest) {
  return handleModeration(req, "hide");
}
