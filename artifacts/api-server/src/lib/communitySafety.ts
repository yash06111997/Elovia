export const COMMUNITY_TERMS_VERSION = "2026-09-03";
export const COMMUNITY_MINIMUM_AGE = 18;

export const REPORT_REASONS = [
  "harassment",
  "hate",
  "sexual_content",
  "self_harm",
  "dangerous_advice",
  "privacy",
  "spam",
  "other",
] as const;

export type ReportReason = (typeof REPORT_REASONS)[number];

export const MODERATION_STATUSES = [
  "queued",
  "reviewing",
  "actioned",
  "dismissed",
] as const;
export type ModerationStatus = (typeof MODERATION_STATUSES)[number];
export type MutableModerationStatus = Exclude<ModerationStatus, "queued">;

export type CommunityTextDecision =
  | { allowed: true; text: string }
  | {
      allowed: false;
      code: "personal_contact" | "external_link" | "threatening_language";
    };

const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const URL_PATTERN = /\b(?:https?:\/\/|www\.)\S+/i;
const PHONE_CANDIDATE_PATTERN = /(?:\+?\d[\d\s().-]{7,}\d)/g;
const EXPLICIT_THREAT_PATTERN =
  /\b(?:go\s+kill\s+yourself|kill\s+yourself|i(?:'|’)?ll\s+kill\s+you|i\s+will\s+kill\s+you|go\s+die)\b/i;

/**
 * A deliberately narrow publish-time guard.
 *
 * It blocks high-confidence personal contact details, external links, and
 * explicit threats. It does not pretend to replace human moderation, and it
 * avoids broad keyword matching that would silence legitimate health topics.
 */
export function screenCommunityText(value: unknown): CommunityTextDecision {
  const text =
    typeof value === "string"
      ? value.replace(/[\x00-\x1F\x7F]/g, " ").trim()
      : "";

  if (EMAIL_PATTERN.test(text)) {
    return { allowed: false, code: "personal_contact" };
  }

  PHONE_CANDIDATE_PATTERN.lastIndex = 0;
  const phoneCandidate = PHONE_CANDIDATE_PATTERN.exec(text)?.[0];
  if (phoneCandidate && phoneCandidate.replace(/\D/g, "").length >= 8) {
    return { allowed: false, code: "personal_contact" };
  }

  if (URL_PATTERN.test(text)) {
    return { allowed: false, code: "external_link" };
  }

  if (EXPLICIT_THREAT_PATTERN.test(text)) {
    return { allowed: false, code: "threatening_language" };
  }

  return { allowed: true, text };
}

export function isReportReason(value: unknown): value is ReportReason {
  return (
    typeof value === "string" &&
    (REPORT_REASONS as readonly string[]).includes(value)
  );
}

export function reportPriority(reason: ReportReason): "standard" | "urgent" {
  return reason === "self_harm" || reason === "dangerous_advice"
    ? "urgent"
    : "standard";
}

export function reviewDeadline(
  priority: "standard" | "urgent",
  now = new Date(),
): Date {
  const hours = priority === "urgent" ? 4 : 24;
  return new Date(now.getTime() + hours * 60 * 60 * 1000);
}

export function canTransitionReportStatus(
  current: ModerationStatus,
  next: MutableModerationStatus,
): boolean {
  if (current === "queued") {
    return ["reviewing", "actioned", "dismissed"].includes(next);
  }
  return (
    current === "reviewing" && (next === "actioned" || next === "dismissed")
  );
}
