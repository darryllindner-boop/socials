/**
 * Runtime verification + smoke test for the dependency-free core.
 *
 * Run via `npm run verify:core`, which compiles this with the global TypeScript
 * compiler and executes it on plain Node — no installed packages required. It
 * exercises the full Phase-0 happy path:
 *
 *   generate (mock LLM) -> review (approve/edit/reject) -> schedule -> assert
 *
 * Exits non-zero on any failed assertion so it can gate CI.
 */
import { MockLLMProvider } from "../llm/mock";
import { generateVariants } from "../content/generator";
import { applyReviewAction, groupForReview } from "../review/queue";
import { planSchedule, nextReviewWindow } from "../schedule/planner";
import { validateForPlatform } from "../content/platform-rules";
import { evaluateVariant } from "../eval/evaluator";
import { textSimilarity } from "../eval/similarity";
import type { Brand, PostVariant } from "../types";

let failures = 0;
function check(label: string, condition: boolean): void {
  const mark = condition ? "PASS" : "FAIL";
  if (!condition) failures += 1;
  console.log(`  [${mark}] ${label}`);
}

const brand: Brand = {
  id: "brand_demo",
  name: "Fjord Roasters",
  voice: {
    description: "A small-batch specialty coffee roaster shipping fresh beans to homes and cafes.",
    toneAdjectives: ["warm", "knowledgeable", "down-to-earth"],
    audience: "home brewing enthusiasts and independent cafe owners",
    contentPillars: ["brewing tips", "origin stories", "behind the roastery"],
    dos: ["Share a concrete, useful tip", "Sound like a real person"],
    donts: ["Use corporate buzzwords", "Make health claims"],
    emojiUsage: "sparing",
    ctaStyle: "invite a reply",
  },
  assets: [
    {
      id: "a1",
      title: "Pour-over ratio",
      content:
        "Our house pour-over ratio is 1:16 (60g coffee per litre). Bloom for 30s with double the coffee weight in water.",
      tags: ["brewing", "pour-over", "ratio"],
    },
    {
      id: "a2",
      title: "Ethiopia Guji origin",
      content:
        "Our Ethiopia Guji is washed, with notes of jasmine and bergamot. Sourced from a co-op of 200 smallholders.",
      tags: ["origin", "ethiopia"],
    },
  ],
};

async function main(): Promise<void> {
  console.log("Social Autopilot - core verification\n");
  const provider = new MockLLMProvider();

  console.log("1) Generate drafts across all four platforms (mock LLM, deterministic):");
  const variants = await generateVariants(provider, {
    brand,
    topic: "how to get a sweeter pour-over at home",
    platforms: ["linkedin", "facebook", "x", "instagram"],
    seed: 42,
  });

  for (const v of variants) {
    console.log(`\n  --- ${v.platform.toUpperCase()} (${v.status}) ---`);
    console.log(`  ${v.body.replace(/\n/g, "\n  ")}`);
    if (v.hashtags.length > 0) console.log(`  ${v.hashtags.join(" ")}`);
  }

  console.log("\n2) Assertions:");
  check("generated one variant per platform", variants.length === 4);
  check(
    "every variant starts in pending_review",
    variants.every((v) => v.status === "pending_review"),
  );
  check(
    "every variant has a non-empty body",
    variants.every((v) => v.body.trim().length > 0),
  );

  const x = variants.find((v) => v.platform === "x")!;
  const xValidation = validateForPlatform("x", x.body, x.hashtags);
  check(`X variant respects 280-char limit (len=${x.body.length})`, xValidation.ok);

  // Determinism: same input + seed => identical output.
  const again = await generateVariants(provider, {
    brand,
    topic: "how to get a sweeter pour-over at home",
    platforms: ["linkedin"],
    seed: 42,
  });
  check(
    "generation is deterministic for a fixed seed",
    again[0]!.body === variants.find((v) => v.platform === "linkedin")!.body,
  );

  console.log("\n3) Review workflow: approve LinkedIn (with an edit), reject X:");
  let reviewed: PostVariant[] = variants.map((v) => {
    if (v.platform === "linkedin") {
      const edited = applyReviewAction(v, {
        type: "edit",
        body: `${v.body}\n\nP.S. free shipping this week.`,
      });
      return applyReviewAction(edited, { type: "approve" });
    }
    if (v.platform === "x") {
      return applyReviewAction(v, { type: "reject" });
    }
    return applyReviewAction(v, { type: "approve" });
  });

  const grouped = groupForReview(reviewed);
  check("3 approved, 1 rejected after review", grouped.approved.length === 3);
  check("rejected post is not in the publish path", grouped.scheduled.length === 0);

  // Illegal transition guard.
  let blockedIllegalTransition = false;
  try {
    applyReviewAction({ ...x, status: "published" }, { type: "approve" });
  } catch {
    blockedIllegalTransition = true;
  }
  check("cannot approve an already-published post", blockedIllegalTransition);

  console.log("\n4) Schedule approved posts across preferred slots:");
  const now = new Date("2026-06-01T04:00:00Z"); // 06:00 Oslo: before the 07:00 review + 09:00 slot
  const { scheduled, unscheduled } = planSchedule(reviewed, {
    slotHours: [9, 13, 17],
    tzOffsetMinutes: 120, // Oslo summer (CEST)
    now,
    horizonDays: 7,
  });

  const nowScheduled = scheduled.filter((v) => v.status === "scheduled");
  for (const v of nowScheduled) {
    console.log(`  ${v.platform.padEnd(10)} -> ${v.scheduledFor}`);
  }
  check("all 3 approved posts got a slot", nowScheduled.length === 3);
  check("no approved posts left unscheduled", unscheduled.length === 0);
  check(
    "scheduled times are strictly in the future",
    nowScheduled.every((v) => new Date(v.scheduledFor!).getTime() > now.getTime()),
  );
  check(
    "scheduled times are in chronological order",
    isSortedAscending(nowScheduled.map((v) => new Date(v.scheduledFor!).getTime())),
  );

  const review = nextReviewWindow(now, 7, 120);
  console.log(`\n  Next morning review window: ${review.toISOString()}`);
  check(
    "next review window is 07:00 Oslo (05:00 UTC) same day",
    review.toISOString() === "2026-06-01T05:00:00.000Z",
  );

  console.log("\n5) Eval tool: catch repetitive / off-brand content:");
  const cleanText = "Bloom your grounds for 30 seconds before the main pour — it vents CO2 and makes the cup noticeably sweeter.";

  const cleanEval = evaluateVariant({
    platform: "linkedin",
    body: cleanText,
    hashtags: ["#coffee"],
    voice: brand.voice,
    priorTexts: ["Totally unrelated post about office furniture and standing desks."],
  });
  check("clean on-brand post is not blocked", !cleanEval.blocked);
  check("clean post scores high", cleanEval.score >= 0.8);

  const dupEval = evaluateVariant({
    platform: "linkedin",
    body: cleanText,
    hashtags: [],
    voice: brand.voice,
    priorTexts: [cleanText], // identical to a recent post
  });
  check("near-duplicate of a recent post is blocked", dupEval.blocked);
  check(
    "duplicate raises a repetition issue",
    dupEval.issues.some((i) => i.code === "repetition"),
  );

  const bannedVoice = { ...brand.voice, bannedTerms: ["CheapBeans"] };
  const bannedEval = evaluateVariant({
    platform: "x",
    body: "Unlike CheapBeans, we roast fresh.",
    hashtags: [],
    voice: bannedVoice,
  });
  check("banned term is blocked", bannedEval.blocked);

  const placeholderEval = evaluateVariant({
    platform: "facebook",
    body: "Try our [PRODUCT NAME] today!",
    hashtags: [],
    voice: brand.voice,
  });
  check("template/placeholder leakage is blocked", placeholderEval.blocked);

  const buzzEval = evaluateVariant({
    platform: "linkedin",
    body: "Leverage our revolutionary game-changer to supercharge synergy and disrupt the paradigm.",
    hashtags: [],
    voice: brand.voice,
  });
  check("buzzword-heavy copy is flagged (not necessarily blocked)", buzzEval.issues.length > 0);

  const emojiEval = evaluateVariant({
    platform: "linkedin",
    body: "New roast just dropped 🎉🔥☕🚀✨🌟",
    hashtags: [],
    voice: { ...brand.voice, emojiUsage: "none" },
  });
  check(
    "emoji-free voice flags emoji usage",
    emojiEval.issues.some((i) => i.code === "emoji_policy"),
  );

  check("identical texts are ~100% similar", textSimilarity(cleanText, cleanText) > 0.99);
  check(
    "unrelated texts are dissimilar",
    textSimilarity(cleanText, "Quarterly tax filing tips for freelancers.") < 0.2,
  );

  console.log("");
  if (failures > 0) {
    console.error(`Core verification FAILED: ${failures} assertion(s) failed.`);
    process.exit(1);
  }
  console.log("Core verification PASSED: all assertions green.");
}

function isSortedAscending(xs: number[]): boolean {
  for (let i = 1; i < xs.length; i++) {
    if (xs[i]! < xs[i - 1]!) return false;
  }
  return true;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
