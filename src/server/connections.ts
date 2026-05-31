import { prisma } from "@/lib/db";
import { PLATFORMS, type AutonomyLevel, type Platform } from "@/core/types";
import { allPublishers } from "@/server/publishers";
import { getOAuthAppConfig } from "@/server/oauth-config";

const DEMO_BRAND_ID = "brand_demo";

export interface ConnectionAccount {
  id: string;
  externalId: string;
  displayName: string;
  connected: boolean;
  isActive: boolean;
  autonomy: AutonomyLevel;
}

export interface ConnectionStatus {
  platform: Platform;
  appConfigured: boolean;
  requirements: string;
  scopes: string[];
  /** Every account connected for this platform (supports multi-Page selection). */
  accounts: ConnectionAccount[];
}

/** Status of every platform connection for the connections dashboard. */
export async function getConnectionStatuses(
  brandId: string = DEMO_BRAND_ID,
): Promise<ConnectionStatus[]> {
  let accounts: Array<{
    id: string;
    platform: Platform;
    externalId: string;
    displayName: string;
    accessToken: string | null;
    isActive: boolean;
    autonomy: AutonomyLevel;
  }> = [];
  try {
    accounts = await prisma.socialAccount.findMany({
      where: { brandId },
      select: {
        id: true,
        platform: true,
        externalId: true,
        displayName: true,
        accessToken: true,
        isActive: true,
        autonomy: true,
      },
      orderBy: { displayName: "asc" },
    });
  } catch {
    // DB not ready; report all as unconnected.
    accounts = [];
  }

  const publishers = new Map(allPublishers().map((p) => [p.platform, p]));

  return PLATFORMS.map((platform): ConnectionStatus => {
    const publisher = publishers.get(platform)!;
    const platformAccounts = accounts
      .filter((a) => a.platform === platform)
      .map(
        (a): ConnectionAccount => ({
          id: a.id,
          externalId: a.externalId,
          displayName: a.displayName,
          connected: Boolean(a.accessToken),
          isActive: a.isActive,
          autonomy: a.autonomy,
        }),
      );
    return {
      platform,
      appConfigured: getOAuthAppConfig(platform) !== null,
      requirements: publisher.requirements,
      scopes: publisher.scopes,
      accounts: platformAccounts,
    };
  });
}

/** Make `accountId` the single active account for its (brand, platform). */
export async function setActiveAccount(accountId: string): Promise<void> {
  const account = await prisma.socialAccount.findUniqueOrThrow({
    where: { id: accountId },
    select: { brandId: true, platform: true },
  });
  await prisma.socialAccount.updateMany({
    where: { brandId: account.brandId, platform: account.platform },
    data: { isActive: false },
  });
  await prisma.socialAccount.update({ where: { id: accountId }, data: { isActive: true } });
}

/** Set the autonomy level for a single connected account. */
export async function setAutonomy(accountId: string, autonomy: AutonomyLevel): Promise<void> {
  await prisma.socialAccount.update({ where: { id: accountId }, data: { autonomy } });
}
