import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { PLATFORMS, type Platform } from "@/core/types";
import { getPublisher } from "@/server/publishers";
import { getOAuthAppConfig, redirectUriFor } from "@/server/oauth-config";

/**
 * Begin the OAuth flow: generate a CSRF `state`, store it in an httpOnly
 * cookie, and redirect to the platform's authorize URL.
 */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ platform: string }> },
): Promise<Response> {
  const { platform } = await ctx.params;
  if (!(PLATFORMS as readonly string[]).includes(platform)) {
    return NextResponse.json({ error: "Unknown platform" }, { status: 404 });
  }
  const p = platform as Platform;

  const app = getOAuthAppConfig(p);
  if (!app) {
    return NextResponse.json(
      { error: `OAuth credentials for "${p}" are not configured in .env.` },
      { status: 400 },
    );
  }

  const publisher = getPublisher(p);
  const state = randomBytes(16).toString("hex");
  const authUrl = publisher.authorizationUrl({
    clientId: app.clientId,
    redirectUri: redirectUriFor(p),
    state,
    scopes: publisher.scopes,
  });

  const res = NextResponse.redirect(authUrl);
  res.cookies.set(`oauth_state_${p}`, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 600,
  });
  return res;
}
