import { PLATFORM_LABELS, type Platform } from "@/core/types";

const STYLES: Record<Platform, string> = {
  linkedin: "bg-[#0a66c2]/10 text-[#0a66c2]",
  facebook: "bg-[#1877f2]/10 text-[#1877f2]",
  x: "bg-slate-200 text-slate-800",
  instagram: "bg-[#d62976]/10 text-[#d62976]",
};

export function PlatformBadge({ platform }: { platform: Platform }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${STYLES[platform]}`}
    >
      {PLATFORM_LABELS[platform]}
    </span>
  );
}
