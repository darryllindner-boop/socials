"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AUTONOMY_LEVELS, PLATFORMS } from "@/core/types";
import {
  applyAction,
  collectMetrics,
  generateBatch,
  reevaluateVariant,
  scheduleApproved,
  scheduleVariant,
  setMedia,
} from "@/server/service";
import { setActiveAccount, setAutonomy } from "@/server/connections";

const platformSchema = z.enum(PLATFORMS);

const generateSchema = z.object({
  topic: z.string().min(3, "Give the post a topic (at least 3 characters)."),
  instruction: z.string().optional(),
  platforms: z.array(platformSchema).min(1, "Pick at least one platform."),
});

export interface ActionResult {
  ok: boolean;
  message?: string;
}

export async function generateAction(formData: FormData): Promise<ActionResult> {
  const parsed = generateSchema.safeParse({
    topic: formData.get("topic"),
    instruction: formData.get("instruction") || undefined,
    platforms: formData.getAll("platforms"),
  });
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const { count } = await generateBatch(parsed.data);
  revalidatePath("/");
  return { ok: true, message: `Generated ${count} draft(s) into the review queue.` };
}

export async function approveAction(variantId: string): Promise<ActionResult> {
  await applyAction(variantId, { type: "approve" });
  revalidatePath("/");
  return { ok: true };
}

export async function rejectAction(variantId: string): Promise<ActionResult> {
  await applyAction(variantId, { type: "reject" });
  revalidatePath("/");
  return { ok: true };
}

export async function editAction(
  variantId: string,
  body: string,
  hashtags: string[],
): Promise<ActionResult> {
  await applyAction(variantId, { type: "edit", body, hashtags });
  revalidatePath("/");
  return { ok: true };
}

export async function setMediaAction(
  variantId: string,
  urls: string[],
): Promise<ActionResult> {
  await setMedia(variantId, urls);
  revalidatePath("/");
  return { ok: true, message: urls.length > 0 ? "Media attached." : "Media cleared." };
}

export async function scheduleVariantAction(
  variantId: string,
  scheduledFor: string,
): Promise<ActionResult> {
  const when = new Date(scheduledFor);
  if (Number.isNaN(when.getTime())) {
    return { ok: false, message: "Invalid date/time." };
  }
  await scheduleVariant(variantId, when);
  revalidatePath("/");
  return { ok: true, message: `Scheduled for ${when.toLocaleString()}.` };
}

export async function scheduleAllApprovedAction(): Promise<ActionResult> {
  const { scheduled, unscheduled } = await scheduleApproved();
  revalidatePath("/");
  const note =
    unscheduled > 0 ? ` (${unscheduled} left for tomorrow — not enough slots)` : "";
  return { ok: true, message: `Scheduled ${scheduled} post(s)${note}.` };
}

const autonomySchema = z.enum(AUTONOMY_LEVELS);

export async function setAutonomyAction(
  accountId: string,
  autonomy: string,
): Promise<ActionResult> {
  const parsed = autonomySchema.safeParse(autonomy);
  if (!parsed.success) {
    return { ok: false, message: "Invalid autonomy level." };
  }
  await setAutonomy(accountId, parsed.data);
  revalidatePath("/connections");
  return { ok: true, message: "Autonomy updated." };
}

export async function setActiveAccountAction(accountId: string): Promise<ActionResult> {
  await setActiveAccount(accountId);
  revalidatePath("/connections");
  return { ok: true, message: "Active account updated." };
}

export async function refreshMetricsAction(variantId: string): Promise<ActionResult> {
  const metrics = await collectMetrics(variantId);
  revalidatePath("/");
  if (!metrics) {
    return { ok: false, message: "No metrics yet (post may not be published or connected)." };
  }
  return { ok: true, message: "Metrics refreshed." };
}

export async function reevaluateAction(variantId: string): Promise<ActionResult> {
  const result = await reevaluateVariant(variantId);
  revalidatePath("/");
  if (!result) {
    return { ok: false, message: "Could not evaluate." };
  }
  const blocked = result.blocked ? " (blocked)" : "";
  return { ok: true, message: `Re-checked: score ${Math.round(result.score * 100)}%${blocked}.` };
}
