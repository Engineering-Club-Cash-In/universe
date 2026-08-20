import { hashCanonical } from "./canonical";
import type { EffectResolution } from "./types";

export type SendMessageOutcome = "requested" | "failed";

export interface OutcomeMapper {
  readonly version: "send-message-terminal-v1";
  readonly hash: string;
  readonly map: (ledgerState: EffectResolution["ledgerState"]) => SendMessageOutcome | undefined;
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
  map(ledgerState: EffectResolution["ledgerState"]): SendMessageOutcome | undefined {
    switch (ledgerState) {
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

export function resolveOutcomeMapper(version: string, hash: string): OutcomeMapper | undefined {
  if (version !== SEND_MESSAGE_OUTCOME_MAPPER.version || hash !== SEND_MESSAGE_OUTCOME_MAPPER.hash) {
    return undefined;
  }
  return SEND_MESSAGE_OUTCOME_MAPPER;
}
