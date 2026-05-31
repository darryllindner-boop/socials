/**
 * Seed a demo brand and generate a first batch of drafts so the review queue
 * has something to show on first run. Uses the deterministic mock provider so
 * it works without any LLM API key.
 *
 * Run with: npm run db:seed
 */
import { PrismaClient } from "@prisma/client";
import { MockLLMProvider } from "../src/core/llm/mock";
import { generateVariants } from "../src/core/content/generator";
import type { Brand as DomainBrand, BrandVoice } from "../src/core/types";

const prisma = new PrismaClient();

const voice: BrandVoice = {
  description:
    "A small-batch specialty coffee roaster shipping fresh beans to homes and cafes.",
  toneAdjectives: ["warm", "knowledgeable", "down-to-earth"],
  audience: "home brewing enthusiasts and independent cafe owners",
  contentPillars: ["brewing tips", "origin stories", "behind the roastery"],
  dos: ["Share a concrete, useful tip", "Sound like a real person"],
  donts: ["Use corporate buzzwords", "Make health claims"],
  emojiUsage: "sparing",
  ctaStyle: "invite a reply",
};

async function main(): Promise<void> {
  console.log("Seeding demo brand…");

  const brand = await prisma.brand.upsert({
    where: { id: "brand_demo" },
    update: { name: "Fjord Roasters", voice: voice as object },
    create: {
      id: "brand_demo",
      name: "Fjord Roasters",
      voice: voice as object,
      assets: {
        create: [
          {
            title: "Pour-over ratio",
            content:
              "Our house pour-over ratio is 1:16 (60g coffee per litre). Bloom for 30s with double the coffee weight in water.",
            tags: ["brewing", "pour-over", "ratio"],
          },
          {
            title: "Ethiopia Guji origin",
            content:
              "Our Ethiopia Guji is washed, with notes of jasmine and bergamot. Sourced from a co-op of 200 smallholders.",
            tags: ["origin", "ethiopia"],
          },
        ],
      },
    },
    include: { assets: true },
  });

  const domainBrand: DomainBrand = {
    id: brand.id,
    name: brand.name,
    voice,
    assets: brand.assets.map((a) => ({
      id: a.id,
      title: a.title,
      content: a.content,
      tags: a.tags,
    })),
  };

  const topic = "how to get a sweeter pour-over at home";
  const provider = new MockLLMProvider();
  const variants = await generateVariants(provider, {
    brand: domainBrand,
    topic,
    platforms: ["linkedin", "facebook", "x", "instagram"],
    seed: 7,
  });

  const post = await prisma.post.create({
    data: {
      brandId: brand.id,
      topic,
      llmProvider: provider.name,
      llmModel: provider.model,
      variants: {
        create: variants.map((v) => ({
          platform: v.platform,
          status: v.status,
          body: v.body,
          hashtags: v.hashtags,
          validationNote: v.error,
          events: { create: { type: "generated", detail: { provider: provider.name } } },
        })),
      },
    },
    include: { variants: true },
  });

  console.log(
    `Seeded brand "${brand.name}" with ${post.variants.length} draft variants in the review queue.`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
