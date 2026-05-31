import { prisma } from "@/lib/db";
import { PLATFORMS, type Platform } from "@/core/types";
import { allPublishers } from "@/server/publishers";
import { getOAuthAppConfig } from "@/server/oauth-config";

const DEMO_BRAND_ID = "brand_demo";

export interface ConnectionStatus {
  platform: Platform;
  displayName: string | null;
  connected: boolean;
  appConfigured: boolean;
  requirements: string;
  scopes: string[];
}

/** Status of every platform connection for the connections dashboard. */
export async function getConnectionStatuses(
  brandId: string = DEMO_BRAND_ID,
): Promise<ConnectionStatus[]> {
  let accounts: { platform: Platform; displayName: string; accessToken: string | null }[] = [];
  try {
    accounts = await prisma.socialAccount.findMany({
      where: { brandId },
      select: { platform: true, displayName: true, accessToken: true },
    });
  } catch {
    // DB not ready; report all as unconnected.
    accounts = [];
  }

  const byPlatform = new Map(accounts.map((a) => [a.platform, a]));
  const publishers = new Map(allPublishers().map((p) => [p.platform, p]));

  return PLATFORMS.map((platform): ConnectionStatus => {
    const account = byPlatform.get(platform);
    const publisher = publishers.get(platform)!;
    return {
      platform,
      displayName: account?.displayName ?? null,
      connected: Boolean(account?.accessToken),
      appConfigured: getOAuthAppConfig(platform) !== null,
      requirements: publisher.requirements,
      scopes: publisher.scopes,
    };
  });
}
