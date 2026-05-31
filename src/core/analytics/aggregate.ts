/**
 * Pure analytics aggregation over published-post engagement.
 *
 * Dependency-free and deterministic so it runs under `npm run verify:core`. The
 * server loads published variants + their latest metrics from the DB, maps them
 * to `AnalyticsRecord`s, and calls these functions; the UI just renders the
 * result. Timezone is offset-based (passed in) to keep this layer pure.
 */
import { PLATFORMS, type Platform } from "../types";

/** Minimal engagement shape; structurally compatible with the server PostMetrics. */
export interface EngagementMetrics {
  likes?: number;
  comments?: number;
  shares?: number;
  impressions?: number;
  reach?: number;
}

export interface AnalyticsRecord {
  id: string;
  platform: Platform;
  /** ISO 8601 publish time. */
  publishedAt: string;
  /** Short preview of the post body for top-post lists. */
  bodyPreview: string;
  metrics: EngagementMetrics | null;
  evalScore?: number | null;
}

export interface Totals {
  likes: number;
  comments: number;
  shares: number;
  impressions: number;
  reach: number;
  /** Weighted interaction score (see engagementScore). */
  engagement: number;
}

export interface PlatformSummary extends Totals {
  platform: Platform;
  posts: number;
  avgEngagement: number;
}

export interface AnalyticsSummary {
  totalPosts: number;
  totals: Totals;
  byPlatform: PlatformSummary[];
  /** Average eval quality score across posts that have one (0..1), or null. */
  avgEvalScore: number | null;
}

export interface TrendPoint {
  /** Local date key, YYYY-MM-DD. */
  date: string;
  posts: number;
  engagement: number;
}

/**
 * Weighted engagement: comments and shares signal more intent than a like, so
 * they're weighted higher. Tune freely — every consumer goes through here.
 */
export function engagementScore(m: EngagementMetrics | null | undefined): number {
  if (!m) return 0;
  return (m.likes ?? 0) + 2 * (m.comments ?? 0) + 3 * (m.shares ?? 0);
}

function emptyTotals(): Totals {
  return { likes: 0, comments: 0, shares: 0, impressions: 0, reach: 0, engagement: 0 };
}

function addInto(t: Totals, m: EngagementMetrics | null): void {
  if (!m) {
    return;
  }
  t.likes += m.likes ?? 0;
  t.comments += m.comments ?? 0;
  t.shares += m.shares ?? 0;
  t.impressions += m.impressions ?? 0;
  t.reach += m.reach ?? 0;
  t.engagement += engagementScore(m);
}

export function summarize(records: AnalyticsRecord[]): AnalyticsSummary {
  const totals = emptyTotals();
  const perPlatform = new Map<Platform, PlatformSummary>();
  for (const p of PLATFORMS) {
    perPlatform.set(p, { platform: p, posts: 0, avgEngagement: 0, ...emptyTotals() });
  }

  let evalSum = 0;
  let evalCount = 0;

  for (const r of records) {
    addInto(totals, r.metrics);
    const ps = perPlatform.get(r.platform)!;
    ps.posts += 1;
    addInto(ps, r.metrics);
    if (typeof r.evalScore === "number") {
      evalSum += r.evalScore;
      evalCount += 1;
    }
  }

  const byPlatform = PLATFORMS.map((p) => {
    const ps = perPlatform.get(p)!;
    ps.avgEngagement = ps.posts > 0 ? Number((ps.engagement / ps.posts).toFixed(1)) : 0;
    return ps;
  }).filter((ps) => ps.posts > 0);

  return {
    totalPosts: records.length,
    totals,
    byPlatform,
    avgEvalScore: evalCount > 0 ? Number((evalSum / evalCount).toFixed(3)) : null,
  };
}

/** Top posts by weighted engagement (ties broken by most recent). */
export function topPosts(records: AnalyticsRecord[], limit = 10): AnalyticsRecord[] {
  return [...records]
    .sort((a, b) => {
      const diff = engagementScore(b.metrics) - engagementScore(a.metrics);
      if (diff !== 0) return diff;
      return b.publishedAt.localeCompare(a.publishedAt);
    })
    .slice(0, limit);
}

/** Local date key (YYYY-MM-DD) for an ISO timestamp at a given UTC offset. */
export function localDateKey(iso: string, tzOffsetMinutes: number): string {
  const local = new Date(new Date(iso).getTime() + tzOffsetMinutes * 60_000);
  const y = local.getUTCFullYear();
  const m = String(local.getUTCMonth() + 1).padStart(2, "0");
  const d = String(local.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Engagement + post count per day over the last `days` days (inclusive of
 * today), oldest first. Days with no posts are present with zeroes so the chart
 * has a continuous axis.
 */
export function dailyTrend(
  records: AnalyticsRecord[],
  days: number,
  tzOffsetMinutes: number,
  now: Date = new Date(),
): TrendPoint[] {
  const buckets = new Map<string, TrendPoint>();
  const todayLocal = new Date(now.getTime() + tzOffsetMinutes * 60_000);
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(
      Date.UTC(
        todayLocal.getUTCFullYear(),
        todayLocal.getUTCMonth(),
        todayLocal.getUTCDate() - i,
      ),
    );
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
    buckets.set(key, { date: key, posts: 0, engagement: 0 });
  }

  for (const r of records) {
    const key = localDateKey(r.publishedAt, tzOffsetMinutes);
    const point = buckets.get(key);
    if (point) {
      point.posts += 1;
      point.engagement += engagementScore(r.metrics);
    }
  }

  return Array.from(buckets.values());
}
