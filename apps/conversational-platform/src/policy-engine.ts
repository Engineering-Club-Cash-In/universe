import { cloneAndFreeze, deepClone, hashCanonical, isReservedName, isSafeString } from "./canonical";
import type { ActionPolicyReference, ResolvedActionReference } from "./types";

export type AssuranceLevel = "ANONYMOUS" | "PHONE_MATCHED" | "VERIFIED" | "STRONG_VERIFIED";

export interface TrustedClaim {
  readonly claimType: string;
  readonly subjectId: string;
  readonly assuranceLevel: AssuranceLevel;
  readonly issuerKey: string;
  readonly issuerVersion: string;
  readonly method: string;
  readonly evidenceRef: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly revokedAt?: string;
}

export interface PolicyBundle {
  readonly policyKey: string;
  readonly policyVersion: string;
  readonly policyHash: string;
  readonly flowGrantId: string;
  readonly environment: "SIMULATION";
  readonly requiredAssuranceLevel: AssuranceLevel;
  readonly allowedIssuers: readonly {
    readonly issuerKey: string;
    readonly issuerVersion: string;
  }[];
}

export interface CreatePolicyBundleInput extends Omit<PolicyBundle, "policyHash"> {}

export interface AuthorizationDecisionInput {
  readonly logicalEffectId: string;
  readonly manifestHash: string;
  readonly actionRef: ResolvedActionReference;
  readonly flowGrantId: string;
  readonly environment: "SIMULATION";
  readonly purpose: string;
  readonly trustedClaims: readonly TrustedClaim[];
  readonly dataClasses: readonly string[];
  readonly subjectId: string;
  readonly conversationId: string;
  readonly evaluatedAt: string;
}

export interface AuthorizationDecision {
  readonly decision: "ALLOW" | "DENY";
  readonly policyKey: string;
  readonly policyVersion: string;
  readonly policyHash: string;
  readonly decisionInputHash: string;
  readonly reasons: readonly string[];
}

export interface TrustedClaimLoadResult {
  readonly generation: string;
  readonly claims: readonly TrustedClaim[];
}

export class FakeTrustedClaimRepository {
  readonly capabilityMode = "SIMULATION" as const;
  readonly ownership = "SYSTEM" as const;
  readonly #generation: string;
  readonly #claims: readonly TrustedClaim[];

  static isAuthentic(value: unknown): value is FakeTrustedClaimRepository {
    return typeof value === "object"
      && value !== null
      && #claims in value
      && Object.getPrototypeOf(value) === FakeTrustedClaimRepository.prototype;
  }

  constructor(input: { readonly generation: string; readonly claims: readonly TrustedClaim[] }) {
    assertIdentifier(input.generation, "generation");
    for (const claim of input.claims) assertTrustedClaimShape(claim);
    this.#generation = input.generation;
    this.#claims = cloneAndFreeze(deepClone(input.claims));
    Object.freeze(this);
  }

  loadForDispatch(_subjectId: string, _conversationId: string): TrustedClaimLoadResult {
    return cloneAndFreeze({ generation: this.#generation, claims: deepClone(this.#claims) });
  }
}

export class VersionedPolicyEngine {
  readonly capabilityMode = "SIMULATION" as const;
  readonly #bundles = new Map<string, PolicyBundle>();

  static isAuthentic(value: unknown): value is VersionedPolicyEngine {
    return typeof value === "object"
      && value !== null
      && #bundles in value
      && Object.getPrototypeOf(value) === VersionedPolicyEngine.prototype;
  }

  constructor(bundles: readonly PolicyBundle[]) {
    for (const bundle of bundles) {
      if (!validatePolicyBundleIntegrity(bundle)) throw new Error("Invalid policy bundle");
      const key = policyKey(bundle.policyKey, bundle.policyVersion);
      const existing = this.#bundles.get(key);
      if (existing !== undefined && existing.policyHash !== bundle.policyHash) throw new Error(`Policy immutable bundle conflict for ${bundle.policyKey}@${bundle.policyVersion}`);
      this.#bundles.set(key, cloneAndFreeze(deepClone(bundle)));
    }
    Object.freeze(this);
  }

  evaluate(reference: ActionPolicyReference, input: AuthorizationDecisionInput): AuthorizationDecision {
    const decisionInputHash = hashCanonical("authorization-decision-input", input);
    const bundle = this.#bundles.get(policyKey(reference.policyKey, reference.policyVersion));
    const reasons: string[] = [];
    if (bundle === undefined || bundle.policyHash !== reference.policyHash) {
      reasons.push("POLICY_DEPENDENCY_MISMATCH");
    } else {
      if (input.flowGrantId !== bundle.flowGrantId) reasons.push("FLOW_GRANT_DENIED");
      if (input.environment !== bundle.environment) reasons.push("ENVIRONMENT_DENIED");
      if (input.trustedClaims.length === 0 && bundle.requiredAssuranceLevel !== "ANONYMOUS") reasons.push("TRUSTED_CLAIM_REQUIRED");
      for (const claim of input.trustedClaims) {
        validateClaimForDecision(claim, input, bundle, reasons);
      }
      if (
        input.trustedClaims.length > 0
        && !input.trustedClaims.some((claim) => assuranceRank(claim.assuranceLevel) >= assuranceRank(bundle.requiredAssuranceLevel))
      ) {
        reasons.push("ASSURANCE_INSUFFICIENT");
      }
    }
    return cloneAndFreeze({
      decision: reasons.length === 0 ? "ALLOW" : "DENY",
      policyKey: reference.policyKey,
      policyVersion: reference.policyVersion,
      policyHash: reference.policyHash,
      decisionInputHash,
      reasons: [...new Set(reasons)].sort(),
    });
  }
}

export function createPolicyBundle(input: CreatePolicyBundleInput): PolicyBundle {
  assertIdentifier(input.policyKey, "policyKey");
  assertVersion(input.policyVersion, "policyVersion");
  assertIdentifier(input.flowGrantId, "flowGrantId");
  if (input.environment !== "SIMULATION") throw new Error("Policy environment must be SIMULATION");
  if (!isAssuranceLevel(input.requiredAssuranceLevel)) throw new Error("Invalid requiredAssuranceLevel");
  if (!Array.isArray(input.allowedIssuers) || input.allowedIssuers.length === 0) throw new Error("At least one fake issuer is required");
  const allowedIssuers = [...input.allowedIssuers]
    .map((issuer) => {
      assertIdentifier(issuer.issuerKey, "issuerKey");
      assertVersion(issuer.issuerVersion, "issuerVersion");
      return { issuerKey: issuer.issuerKey, issuerVersion: issuer.issuerVersion };
    })
    .sort((left, right) => compareStrings(`${left.issuerKey}\u0000${left.issuerVersion}`, `${right.issuerKey}\u0000${right.issuerVersion}`));
  if (new Set(allowedIssuers.map((issuer) => `${issuer.issuerKey}\u0000${issuer.issuerVersion}`)).size !== allowedIssuers.length) throw new Error("Duplicate issuer");
  const withoutHash = {
    policyKey: input.policyKey,
    policyVersion: input.policyVersion,
    flowGrantId: input.flowGrantId,
    environment: input.environment,
    requiredAssuranceLevel: input.requiredAssuranceLevel,
    allowedIssuers,
  };
  return cloneAndFreeze({ ...withoutHash, policyHash: hashCanonical("policy-bundle", withoutHash) });
}

export function validatePolicyBundleIntegrity(value: unknown): value is PolicyBundle {
  if (!isRecord(value) || !hasExactKeys(value, ["allowedIssuers", "environment", "flowGrantId", "policyHash", "policyKey", "policyVersion", "requiredAssuranceLevel"])) return false;
  if (!isIdentifier(value.policyKey) || !isVersion(value.policyVersion) || value.policyVersion === "latest" || !isIdentifier(value.flowGrantId) || value.environment !== "SIMULATION" || !isAssuranceLevel(value.requiredAssuranceLevel) || !Array.isArray(value.allowedIssuers)) return false;
  const issuers: { readonly issuerKey: string; readonly issuerVersion: string }[] = [];
  for (const issuer of value.allowedIssuers) {
    if (!isRecord(issuer) || !hasExactKeys(issuer, ["issuerKey", "issuerVersion"]) || !isIdentifier(issuer.issuerKey) || !isVersion(issuer.issuerVersion)) return false;
    issuers.push({ issuerKey: issuer.issuerKey, issuerVersion: issuer.issuerVersion });
  }
  if (issuers.length === 0 || new Set(issuers.map((issuer) => `${issuer.issuerKey}\u0000${issuer.issuerVersion}`)).size !== issuers.length) return false;
  if (!issuers.every((issuer, index) => index === 0 || compareStrings(`${issuers[index - 1]!.issuerKey}\u0000${issuers[index - 1]!.issuerVersion}`, `${issuer.issuerKey}\u0000${issuer.issuerVersion}`) < 0)) return false;
  const withoutHash = {
    policyKey: value.policyKey,
    policyVersion: value.policyVersion,
    flowGrantId: value.flowGrantId,
    environment: value.environment,
    requiredAssuranceLevel: value.requiredAssuranceLevel,
    allowedIssuers: issuers,
  };
  return value.policyHash === hashCanonical("policy-bundle", withoutHash);
}

function validateClaimForDecision(claim: TrustedClaim, input: AuthorizationDecisionInput, bundle: PolicyBundle, reasons: string[]): void {
  try {
    assertTrustedClaimShape(claim);
  } catch (_caught) {
    reasons.push("TRUSTED_CLAIM_MALFORMED");
    return;
  }
  if (claim.subjectId !== input.subjectId) reasons.push("TRUSTED_CLAIM_SUBJECT_MISMATCH");
  if (!bundle.allowedIssuers.some((issuer) => issuer.issuerKey === claim.issuerKey && issuer.issuerVersion === claim.issuerVersion)) reasons.push("TRUSTED_CLAIM_ISSUER_DENIED");
  if (claim.revokedAt !== undefined) reasons.push("TRUSTED_CLAIM_REVOKED");
  if (compareTimestamp(claim.issuedAt, input.evaluatedAt) > 0) reasons.push("TRUSTED_CLAIM_NOT_YET_VALID");
  if (compareTimestamp(claim.expiresAt, input.evaluatedAt) <= 0) reasons.push("TRUSTED_CLAIM_EXPIRED");
}

function assertTrustedClaimShape(claim: TrustedClaim): void {
  const record = claim as unknown;
  if (!isRecord(record)) throw new Error("Invalid trusted claim");
  const expected = claim.revokedAt === undefined
    ? ["assuranceLevel", "claimType", "evidenceRef", "expiresAt", "issuedAt", "issuerKey", "issuerVersion", "method", "subjectId"]
    : ["assuranceLevel", "claimType", "evidenceRef", "expiresAt", "issuedAt", "issuerKey", "issuerVersion", "method", "revokedAt", "subjectId"];
  if (!hasExactKeys(record, expected)) throw new Error("Invalid trusted claim fields");
  for (const [field, value] of Object.entries({
    claimType: claim.claimType,
    subjectId: claim.subjectId,
    issuerKey: claim.issuerKey,
    issuerVersion: claim.issuerVersion,
    method: claim.method,
    evidenceRef: claim.evidenceRef,
  })) assertIdentifier(value, field);
  if (!isAssuranceLevel(claim.assuranceLevel) || !isCanonicalTimestamp(claim.issuedAt) || !isCanonicalTimestamp(claim.expiresAt) || (claim.revokedAt !== undefined && !isCanonicalTimestamp(claim.revokedAt))) throw new Error("Invalid trusted claim values");
}

function assuranceRank(value: AssuranceLevel): number {
  switch (value) {
    case "ANONYMOUS": return 0;
    case "PHONE_MATCHED": return 1;
    case "VERIFIED": return 2;
    case "STRONG_VERIFIED": return 3;
  }
}

function compareTimestamp(left: string, right: string): number {
  return left.localeCompare(right);
}

function isCanonicalTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

function isAssuranceLevel(value: unknown): value is AssuranceLevel {
  return value === "ANONYMOUS" || value === "PHONE_MATCHED" || value === "VERIFIED" || value === "STRONG_VERIFIED";
}

function assertIdentifier(value: string, field: string): void {
  if (!isIdentifier(value)) throw new Error(`Invalid ${field}`);
}

function assertVersion(value: string, field: string): void {
  if (!isVersion(value) || value === "latest") throw new Error(`Invalid ${field}`);
}

function isIdentifier(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && isSafeString(value) && !isReservedName(value);
}

function isVersion(value: unknown): value is string {
  return isIdentifier(value);
}

function policyKey(key: string, version: string): string {
  return `${key}\u0000${version}`;
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value: Record<string, unknown>, expectedKeys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}
