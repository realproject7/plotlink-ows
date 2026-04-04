import { ImageResponse } from "next/og";
import { type Address } from "viem";
import { createServerClient, type Storyline } from "../../../../../lib/supabase";
import { getTokenTVL } from "../../../../../lib/price";
import { getFarcasterProfile } from "../../../../../lib/actions";
import { RESERVE_LABEL, STORY_FACTORY } from "../../../../../lib/contracts/constants";
import { formatPrice } from "../../../../../lib/format";
import { truncateAddress } from "../../../../../lib/utils";
import { getPlotUsdPrice, formatUsdValue } from "../../../../../lib/usd-price";

export const runtime = "edge";

async function loadFont(): Promise<ArrayBuffer | null> {
  try {
    const res = await fetch(
      "https://fonts.googleapis.com/css2?family=Lora:wght@700&display=swap",
    );
    const css = await res.text();
    const match =
      css.match(/src:\s*url\(([^)]+)\)\s*format\(['"]truetype['"]\)/) ??
      css.match(/src:\s*url\(([^)]+)\)\s*format\(['"]woff['"]\)/);
    if (!match?.[1]) return null;
    const fontRes = await fetch(match[1]);
    return fontRes.arrayBuffer();
  } catch {
    return null;
  }
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ storylineId: string }> },
) {
  const { storylineId } = await params;
  const id = Number(storylineId);

  if (isNaN(id) || id <= 0) {
    return new Response("Invalid storyline ID", { status: 400 });
  }

  const supabase = createServerClient();
  if (!supabase) {
    return new Response("Database unavailable", { status: 503 });
  }

  const { data: storyline } = await supabase
    .from("storylines")
    .select("*")
    .eq("storyline_id", id)
    .eq("hidden", false)
    .eq("contract_address", STORY_FACTORY.toLowerCase())
    .single();

  if (!storyline) {
    return new Response("Storyline not found", { status: 404 });
  }

  const sl = storyline as Storyline;

  const [tvlInfo, plotUsd, farcasterProfile, fontData] = await Promise.all([
    sl.token_address ? getTokenTVL(sl.token_address as Address) : null,
    getPlotUsdPrice(),
    getFarcasterProfile(sl.writer_address).catch(() => null),
    loadFont(),
  ]);

  const reserveLabel = RESERVE_LABEL;
  const authorName = farcasterProfile
    ? `@${farcasterProfile.username}`
    : truncateAddress(sl.writer_address);
  const plotLabel = `${sl.plot_count} ${sl.plot_count === 1 ? "plot" : "plots"}`;
  const titleDisplay =
    sl.title.length > 50 ? `${sl.title.slice(0, 47)}...` : sl.title;

  // TVL display with USD
  let tvlDisplay: string | null = null;
  if (tvlInfo) {
    const tvlNum = parseFloat(tvlInfo.tvl);
    tvlDisplay = `TVL: ${formatPrice(tvlInfo.tvl)} ${reserveLabel}`;
    if (plotUsd && tvlNum > 0) {
      tvlDisplay += ` (${formatUsdValue(tvlNum * plotUsd)})`;
    }
  }

  const fonts = fontData
    ? [{ name: "Lora", data: fontData, weight: 700 as const }]
    : [];

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#DDD3C2",
          fontFamily: fontData ? "Lora" : "Georgia, serif",
        }}
      >
        {/* Centered moleskine card */}
        <div
          style={{
            width: "360px",
            height: "540px",
            display: "flex",
            flexDirection: "column",
            backgroundColor: "#F5EFE6",
            borderRadius: "5px 15px 15px 5px",
            border: "1px solid #D4C5B0",
            boxShadow:
              "4px 6px 20px rgba(44, 24, 16, 0.18), 1px 1px 4px rgba(44, 24, 16, 0.08)",
            position: "relative",
            overflow: "hidden",
          }}
        >
          {/* Elastic band */}
          <div
            style={{
              position: "absolute",
              top: "-1px",
              bottom: "-1px",
              right: "28px",
              width: "8px",
              borderRadius: "2px",
              background: "rgba(139, 69, 19, 0.18)",
              display: "flex",
            }}
          />

          {/* Top-left: genre tag */}
          <div
            style={{
              display: "flex",
              padding: "24px 28px 0",
            }}
          >
            {sl.genre ? (
              <div
                style={{
                  display: "flex",
                  fontSize: "13px",
                  color: "#8B4513",
                  backgroundColor: "rgba(139, 69, 19, 0.08)",
                  borderRadius: "3px",
                  padding: "4px 12px",
                  textTransform: "uppercase",
                  letterSpacing: "0.1em",
                  fontWeight: 700,
                }}
              >
                {sl.genre}
              </div>
            ) : (
              <div style={{ display: "flex" }} />
            )}
          </div>

          {/* Center: title */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
              alignItems: "center",
              flex: 1,
              padding: "0 36px",
              textAlign: "center",
            }}
          >
            <div
              style={{
                fontSize: titleDisplay.length > 30 ? "32px" : "38px",
                fontWeight: 700,
                color: "#8B4513",
                lineHeight: 1.25,
                display: "flex",
                textAlign: "center",
                justifyContent: "center",
                maxWidth: "380px",
              }}
            >
              {titleDisplay}
            </div>
          </div>

          {/* Bottom: plot count + TVL */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "6px",
              padding: "0 28px 24px",
              fontSize: "15px",
              color: "#6B5B47",
            }}
          >
            <div style={{ display: "flex" }}>{plotLabel}</div>
            {tvlDisplay && (
              <div style={{ display: "flex", fontWeight: 700, color: "#8B4513" }}>
                {tvlDisplay}
              </div>
            )}
          </div>
        </div>

        {/* Below moleskine: author + branding */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            width: "360px",
            marginTop: "16px",
            fontSize: "16px",
            color: "#8B7355",
          }}
        >
          <div style={{ display: "flex" }}>by {authorName}</div>
          <div style={{ display: "flex", color: "#A89880" }}>plotlink.xyz</div>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
      fonts,
    },
  );
}
