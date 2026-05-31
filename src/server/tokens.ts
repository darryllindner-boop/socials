/**
 * Token service: hands out a *valid* decrypted access token for a connected
 * account, transparently refreshing it (and re-persisting the encrypted result)
 * when it is expired or about to expire. The worker calls this immediately
 * before publishing so long-running schedules don't fail on stale tokens.
 */
import type { Platform } from "@/core/types";
import { prisma } from "@/lib/db";
import { decryptToken, encryptToken } from "@/server/crypto";
import { getOAuthAppConfig } from "@/server/oauth-config";
import { getPublisher } from "@/server/publishers";

export interface AccountTokenRow {
  id: string;
  platform: Platform;
  accessToken: string | null;
  refreshToken: string | null;
  tokenExpiresAt: Date | null;
}

// Refresh a little before the real expiry to avoid edge-of-window failures.
const EXPIRY_BUFFER_MS = 5 * 60 * 1000;

export async function getValidAccessToken(account: AccountTokenRow): Promise<string> {
  if (!account.accessToken) {
    throw new Error(`Social account ${account.id} has no access token.`);
  }

  const stillValid =
    !account.tokenExpiresAt ||
    account.tokenExpiresAt.getTime() - Date.now() > EXPIRY_BUFFER_MS;
  if (stillValid) {
    return decryptToken(account.accessToken);
  }

  const publisher = getPublisher(account.platform);
  const app = getOAuthAppConfig(account.platform);

  // If we can't refresh, return the current token and let the publish attempt
  // surface any auth error rather than failing pre-emptively.
  if (!account.refreshToken || !publisher.refreshAccessToken || !app) {
    return decryptToken(account.accessToken);
  }

  const refreshed = await publisher.refreshAccessToken({
    clientId: app.clientId,
    clientSecret: app.clientSecret,
    refreshToken: decryptToken(account.refreshToken),
  });

  await prisma.socialAccount.update({
    where: { id: account.id },
    data: {
      accessToken: encryptToken(refreshed.accessToken),
      refreshToken: refreshed.refreshToken
        ? encryptToken(refreshed.refreshToken)
        : account.refreshToken,
      tokenExpiresAt: refreshed.expiresAt ?? null,
    },
  });

  return refreshed.accessToken;
}
