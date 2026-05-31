import type { Platform } from "@/core/types";
import { FacebookPublisher } from "./facebook";
import { InstagramPublisher } from "./instagram";
import { LinkedInPublisher } from "./linkedin";
import type { Publisher } from "./publisher";
import { XPublisher } from "./x";

const REGISTRY: Record<Platform, Publisher> = {
  linkedin: new LinkedInPublisher(),
  facebook: new FacebookPublisher(),
  x: new XPublisher(),
  instagram: new InstagramPublisher(),
};

export function getPublisher(platform: Platform): Publisher {
  return REGISTRY[platform];
}

export function allPublishers(): Publisher[] {
  return Object.values(REGISTRY);
}

export type { Publisher } from "./publisher";
