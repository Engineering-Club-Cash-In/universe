import { hashCanonical } from "./canonical";
import type { EffectResolution } from "./types";

export type SendMessageOutcome = "requested" | "failed";
export type ExecuteActionOutcome = "succeeded" | "business_error" | "technical_error";
export type EffectOutcome = SendMessageOutcome | ExecuteActionOutcome;

export interface OutcomeMapper {
  readonly version: "send-message-terminal-v1" | "execute-action-terminal-v1";
  readonly hash: string;
  readonly map: (resolution: EffectResolution, businessResultCodes: readonly string[]) => EffectOutcome | undefined;
}

export const SEND_MESSAGE_OUTCOME_MAPPING_VERSION = "send-message-terminal-v1" as const;

export const SEND_MESSAGE_OUTCOME_MAPPING_HASH = hashCanonical("outcome-mapping", {
  version: SEND_MESSAGE_OUTCOME_MAPPING_VERSION,
  terminal: {
    CONFIRMED: "requested",
    DENIED: "failed",
    FAILED_PERMANENT: "failed",
  },
  nonConsumable: ["CANCELLED_BEFORE_DISPATCH", "MANUAL_REVIEW", "NOT_APPLIED", "RECONCILING", "UNKNOWN"],
});

const SEND_MESSAGE_OUTCOME_MAPPER: OutcomeMapper = Object.freeze({
  version: SEND_MESSAGE_OUTCOME_MAPPING_VERSION,
  hash: SEND_MESSAGE_OUTCOME_MAPPING_HASH,
  map(resolution: EffectResolution): SendMessageOutcome | undefined {
    if (resolution.businessResultCode !== undefined) return undefined;
    switch (resolution.ledgerState) {
      case "CONFIRMED":
        return "requested";
      case "DENIED":
      case "FAILED_PERMANENT":
        return "failed";
      case "UNKNOWN":
      case "RECONCILING":
      case "MANUAL_REVIEW":
      case "NOT_APPLIED":
      case "CANCELLED_BEFORE_DISPATCH":
        return undefined;
    }
  },
});

export const EXECUTE_ACTION_OUTCOME_MAPPING_VERSION = "execute-action-terminal-v1" as const;

export const EXECUTE_ACTION_OUTCOME_MAPPING_HASH = hashCanonical("outcome-mapping", {
  version: EXECUTE_ACTION_OUTCOME_MAPPING_VERSION,
  terminal: {
    CONFIRMED: { withoutBusinessResultCode: "succeeded", withAllowedBusinessResultCode: "business_error" },
    DENIED: "technical_error",
    FAILED_PERMANENT: "technical_error",
  },
  nonConsumable: ["CANCELLED_BEFORE_DISPATCH", "MANUAL_REVIEW", "NOT_APPLIED", "RECONCILING", "UNKNOWN"],
});

const EXECUTE_ACTION_OUTCOME_MAPPER: OutcomeMapper = Object.freeze({
  version: EXECUTE_ACTION_OUTCOME_MAPPING_VERSION,
  hash: EXECUTE_ACTION_OUTCOME_MAPPING_HASH,
  map(resolution: EffectResolution, businessResultCodes: readonly string[]): ExecuteActionOutcome | undefined {
    switch (resolution.ledgerState) {
      case "CONFIRMED":
        if (resolution.businessResultCode === undefined) return "succeeded";
        return businessResultCodes.includes(resolution.businessResultCode) ? "business_error" : undefined;
      case "DENIED":
      case "FAILED_PERMANENT":
        return resolution.businessResultCode === undefined ? "technical_error" : undefined;
      case "UNKNOWN":
      case "RECONCILING":
      case "MANUAL_REVIEW":
      case "NOT_APPLIED":
      case "CANCELLED_BEFORE_DISPATCH":
        return undefined;
    }
  },
});

export function resolveOutcomeMapper(version: string, hash: string): OutcomeMapper | undefined {
  if (version === SEND_MESSAGE_OUTCOME_MAPPER.version && hash === SEND_MESSAGE_OUTCOME_MAPPER.hash) return SEND_MESSAGE_OUTCOME_MAPPER;
  if (version === EXECUTE_ACTION_OUTCOME_MAPPER.version && hash === EXECUTE_ACTION_OUTCOME_MAPPER.hash) return EXECUTE_ACTION_OUTCOME_MAPPER;
  return undefined;
}
