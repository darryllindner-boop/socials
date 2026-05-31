import { NextResponse, type NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { PLATFORMS, type Platform } from "@/core/types";
import { prisma } from "@/lib/db";
import { getPublisher } from "@/server/publishers";
import type { AccountIdentity } from "@/server/publishers/publisher";
import { getOAuthAppConfig, redirectUriFor } from "@/server/oauth-config";
import { encryptToken } from "@/server/crypto";

const DEMO_BRAND_ID = "brand_demo";

/**
 * OAuth callback: verify state (CSRF), exchange the code for tokens, resolve the
 * connected account(s), encrypt tokens, and upsert them.
 *
 * Platforms that expose multiple publishable targets (e.g. Meta Pages / IG
 * accounts) return several candidates via `listAccounts`; we store each and
 * activate one (META_PAGE_ID match, else the first). The user can switch the
 * active account from the Connections page. The worker refuses to publish
 * without a usable token, so a placeholder never posts anywhere.
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

    // Gather candidate accounts: prefer listAccounts (multi-account platforms
    // like Meta), else a single fetchIdentity, else a safe placeholder.
    let identities: AccountIdentity[] = [];
    try {
      if (publisher.listAccounts) {
        identities = await publisher.listAccounts(tokens.accessToken, tokens.raw);
      } else if (publisher.fetchIdentity) {
        identities = [await publisher.fetchIdentity(tokens.accessToken, tokens.raw)];
      }
    } catch (idErr) {
      console.warn(
        `[oauth/${p}] identity resolution failed; storing placeholder:`,
        idErr instanceof Error ? idErr.message : idErr,
      );
    }
    if (identities.length === 0) {
      identities = [{ externalId: `pending_${p}`, displayName: `${p} account` }];
    }

    // Upsert each candidate account. For Meta the identity carries a Page token
    // override; otherwise we store the OAuth-exchange token.
    const upserted: { id: string; externalId: string; pageId?: string }[] = [];
    for (const identity of identities) {
      const storeToken = identity.accessToken ?? tokens.accessToken;
      const storeExpiry = identity.accessToken ? identity.tokenExpiresAt : tokens.expiresAt;
      const metaInput = (identity.metadata ?? undefined) as unknown as
        | Prisma.InputJsonValue
        | undefined;

      const acc = await prisma.socialAccount.upsert({
        where: {
          brandId_platform_externalId: {
            brandId: DEMO_BRAND_ID,
            platform: p,
            externalId: identity.externalId,
          },
        },
        update: {
          displayName: identity.displayName,
          metadata: metaInput,
          accessToken: encryptToken(storeToken),
          refreshToken: tokens.refreshToken ? encryptToken(tokens.refreshToken) : null,
          tokenExpiresAt: storeExpiry ?? null,
          connectedAt: new Date(),
        },
        create: {
          brandId: DEMO_BRAND_ID,
          platform: p,
          externalId: identity.externalId,
          displayName: identity.displayName,
          metadata: metaInput,
          accessToken: encryptToken(storeToken),
          refreshToken: tokens.refreshToken ? encryptToken(tokens.refreshToken) : null,
          tokenExpiresAt: storeExpiry ?? null,
          connectedAt: new Date(),
        },
      });
      const pageId =
        typeof identity.metadata?.pageId === "string" ? identity.metadata.pageId : undefined;
      upserted.push({ id: acc.id, externalId: identity.externalId, pageId });
    }

    // Activate exactly one account for this (brand, platform).
    const preferred = process.env.META_PAGE_ID;
    const chosen =
      (preferred &&
        upserted.find((a) => a.pageId === preferred || a.externalId === preferred)) ||
      upserted[0]!;
    await prisma.socialAccount.updateMany({
      where: { brandId: DEMO_BRAND_ID, platform: p },
      data: { isActive: false },
    });
    await prisma.socialAccount.update({ where: { id: chosen.id }, data: { isActive: true } });

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
