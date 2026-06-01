/**
 * Server-side analytics: load published variants + their latest engagement
 * metrics and run the dependency-free aggregation in core/analytics.
 */
import { prisma } from "@/lib/db";
import { asPlatform } from "@/lib/serialize";
import {
  dailyTrend,
  summarize,
  topPosts,
  type AnalyticsRecord,
  type AnalyticsSummary,
  type EngagementMetrics,
  type TrendPoint,
} from "@/core/analytics/aggregate";
import { tzOffsetMinutes } from "@/server/time";

const DEMO_BRAND_ID = "brand_demo";

export interface TopPost extends AnalyticsRecord {
  topic: string;
  metricsUpdatedAt: string | null;
}

export interface AnalyticsDashboard {
  summary: AnalyticsSummary;
  top: TopPost[];
  trend: TrendPoint[];
  trendDays: number;
  timezone: string;
  /** Published posts that have no metrics pulled yet (UI nudge). */
  awaitingMetrics: number;
}

export async function getAnalytics(
  brandId: string = DEMO_BRAND_ID,
  options: { trendDays?: number } = {},
): Promise<AnalyticsDashboard> {
  const trendDays = options.trendDays ?? 14;
  const tz = process.env.REVIEW_TIMEZONE ?? "Europe/Oslo";

  const rows = await prisma.variant.findMany({
    where: { post: { brandId }, status: "published", publishedAt: { not: null } },
    include: { post: { select: { topic: true } } },
    orderBy: { publishedAt: "desc" },
    take: 500,
  });

  const records: AnalyticsRecord[] = rows.map((r) => ({
    id: r.id,
    platform: asPlatform(r.platform),
    publishedAt: (r.publishedAt ?? r.createdAt).toISOString(),
    bodyPreview: r.body.length > 140 ? `${r.body.slice(0, 139)}…` : r.body,
    metrics: (r.metrics as unknown as EngagementMetrics | null) ?? null,
    evalScore: r.evalScore ?? null,
  }));

  const topRecords = topPosts(records, 10);
  const topByline = new Map(rows.map((r) => [r.id, r]));
  const top: TopPost[] = topRecords.map((rec) => {
    const row = topByline.get(rec.id)!;
    return {
      ...rec,
      topic: row.post.topic,
      metricsUpdatedAt: row.metricsUpdatedAt ? row.metricsUpdatedAt.toISOString() : null,
    };
  });

  const now = new Date();
  return {
    summary: summarize(records),
    top,
    trend: dailyTrend(records, trendDays, tzOffsetMinutes(tz, now), now),
    trendDays,
    timezone: tz,
    awaitingMetrics: rows.filter((r) => r.metrics === null).length,
  };
}
