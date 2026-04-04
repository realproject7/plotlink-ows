import { NextResponse } from "next/server";
import { getPlotUsdPrice } from "../../../../../lib/usd-price";

export const revalidate = 120; // ISR: revalidate every 2 minutes

export async function GET() {
  const price = await getPlotUsdPrice();
  return NextResponse.json(
    { price, timestamp: Date.now() },
    {
      headers: {
        "Cache-Control": "public, s-maxage=120, stale-while-revalidate=300",
      },
    },
  );
}
