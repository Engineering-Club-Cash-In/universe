const CREDIT_SOURCE_MAP: Record<string, string> = {
  website: "website",
  referral: "referral",
  cold_call: "cold_call",
  email: "email",
  social_media: "social_media",
  event: "event",
  other: "other",
  facebook: "facebook",
  instagram: "instagram",
  google: "google",
  meta: "meta",
  whatsapp: "Whatsapp",
};

const INVESTMENT_SOURCE_MAP: Record<string, string> = {
  website: "website",
  referral: "referral",
  cold_call: "cold_call",
  email: "email",
  social_media: "social_media",
  event: "event",
  other: "other",
  facebook: "facebook",
  instagram: "instagram",
  google: "google",
  meta: "meta",
  whatsapp: "whatsapp",
};

function normalizeSource(
  source: string | undefined,
  sourceMap: Record<string, string>
): string | undefined {
  if (!source) return undefined;
  const normalized = source.trim().toLowerCase();
  return sourceMap[normalized] ?? "other";
}

export function normalizeCreditLeadSource(source?: string): string | undefined {
  return normalizeSource(source, CREDIT_SOURCE_MAP);
}

export function normalizeInvestmentLeadSource(
  source?: string
): string | undefined {
  return normalizeSource(source, INVESTMENT_SOURCE_MAP);
}
