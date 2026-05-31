import { NextResponse, type NextRequest } from "next/server";
import { PLATFORMS, type Platform } from "@/core/types";
import { prisma } from "@/lib/db";
import { getPublisher } from "@/server/publishers";
import { getOAuthAppConfig, redirectUriFor } from "@/server/oauth-config";
import { encryptToken } from "@/server/crypto";

const DEMO_BRAND_ID = "brand_demo";

/**
 * OAuth callback: verify state (CSRF), exchange the code for tokens, encrypt
 * them, and upsert the SocialAccount.
 *
 * NOTE (Phase 1 TODO): deriving the real account/page id + display name needs a
 * follow-up call to each platform's "me"/pages endpoint. Until that's wired we
 * store a placeholder externalId; publishing checks for a real token before
 * sending anything, so nothing is posted to the wrong place in the meantime.
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ platform: string }> },
): Promise<Response> {
  const { platform } = await ctx.params;
  if (!(PLATFORMS as readonly string[]).includes(platform)) {
    return NextResponse.json({ error: "Unknown platform" }, { status: 404 });
  }
  const p = platform as Platform;

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieState = req.cookies.get(`oauth_state_${p}`)?.value;

  if (url.searchParams.get("error")) {
    return redirectToConnections(req, p, `denied:${url.searchParams.get("error")}`);
  }
  if (!code) {
    return redirectToConnections(req, p, "missing_code");
  }
  if (!state || state !== cookieState) {
    return redirectToConnections(req, p, "state_mismatch");
  }

  const app = getOAuthAppConfig(p);
  if (!app) {
    return redirectToConnections(req, p, "app_not_configured");
  }

  try {
    const publisher = getPublisher(p);
    const tokens = await publisher.exchangeCode({
      clientId: app.clientId,
      clientSecret: app.clientSecret,
      code,
      redirectUri: redirectUriFor(p),
    });

    const externalId = String(
      (tokens.raw["account_id"] as string | undefined) ??
        (tokens.raw["sub"] as string | undefined) ??
        `pending_${p}`,
    );

    await prisma.socialAccount.upsert({
      where: { brandId_platform_externalId: { brandId: DEMO_BRAND_ID, platform: p, externalId } },
      update: {
        accessToken: encryptToken(tokens.accessToken),
        refreshToken: tokens.refreshToken ? encryptToken(tokens.refreshToken) : null,
        tokenExpiresAt: tokens.expiresAt,
        connectedAt: new Date(),
      },
      create: {
        brandId: DEMO_BRAND_ID,
        platform: p,
        externalId,
        displayName: `${p} account`,
        accessToken: encryptToken(tokens.accessToken),
        refreshToken: tokens.refreshToken ? encryptToken(tokens.refreshToken) : null,
        tokenExpiresAt: tokens.expiresAt,
        connectedAt: new Date(),
      },
    });

    const res = redirectToConnections(req, p, "connected");
    res.cookies.delete(`oauth_state_${p}`);
    return res;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return redirectToConnections(req, p, `error:${encodeURIComponent(message)}`);
  }
}

function redirectToConnections(req: NextRequest, platform: Platform, status: string): NextResponse {
  const dest = new URL("/connections", req.url);
  dest.searchParams.set("platform", platform);
  dest.searchParams.set("status", status);
  return NextResponse.redirect(dest);
}
