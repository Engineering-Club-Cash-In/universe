export type TypedValue =
  | { readonly type: "string"; readonly value: string }
  | { readonly type: "number"; readonly value: number }
  | { readonly type: "boolean"; readonly value: boolean }
  | { readonly type: "null"; readonly value: null };

export type ExpressionAst =
  | { readonly kind: "literal"; readonly value: TypedValue }
  | { readonly kind: "variable"; readonly name: string; readonly valueType: TypedValue["type"] }
  | {
      readonly kind: "compare";
      readonly operator: "eq" | "neq" | "gt" | "gte" | "lt" | "lte";
      readonly left: ExpressionAst;
      readonly right: ExpressionAst;
    }
  | { readonly kind: "not"; readonly expression: ExpressionAst }
  | { readonly kind: "and" | "or"; readonly expressions: readonly ExpressionAst[] };

export interface ConditionBranchDefinition {
  readonly outcome: string;
  readonly when: unknown;
  readonly next: string;
}

export interface MessageContentDefinition {
  readonly contentVersionId: string;
  readonly text: string;
}

export interface FlowStepDefinition {
  readonly id: string;
  readonly type: string;
  readonly variable?: string;
  readonly value?: unknown;
  readonly next?: string;
  readonly branches?: readonly ConditionBranchDefinition[];
  readonly content?: MessageContentDefinition;
  readonly transitions?: Readonly<Partial<Record<"requested" | "failed", string>>>;
}

export interface FlowDefinition {
  schemaVersion: "conversational-flow/phase1";
  flowId: string;
  flowVersion: string;
  entryStepId: string;
  steps: FlowStepDefinition[];
}

export type CompileErrorCode =
  | "INVALID_DEFINITION"
  | "INVALID_SCHEMA_VERSION"
  | "DUPLICATE_STEP_ID"
  | "DUPLICATE_BRANCH_OUTCOME"
  | "ENTRY_STEP_NOT_FOUND"
  | "UNSUPPORTED_STEP_TYPE"
  | "UNSUPPORTED_FIELD"
  | "RESERVED_NAME"
  | "INVALID_STEP_SHAPE"
  | "INVALID_EXPRESSION_AST"
  | "EXPRESSION_TYPE_ERROR"
  | "VARIABLE_NOT_INITIALIZED"
  | "TRANSITION_TARGET_NOT_FOUND"
  | "CYCLE_NOT_SUPPORTED"
  | "NO_REACHABLE_END"
  | "INTERNAL_MANIFEST_INVALID";

export interface CompileError {
  readonly code: CompileErrorCode;
  readonly stepId?: string;
  readonly path: string;
  readonly details: Readonly<Record<string, string>>;
}

export interface StepHandlerManifest {
  readonly stepType: "set_variable" | "condition" | "send_message" | "end";
  readonly stepHandlerKey: string;
  readonly stepHandlerVersion: string;
  readonly implementationCompatibilityId: string;
  readonly handlerHash: string;
  readonly completionMode: "ON_PERSIST" | "ON_EFFECT_TERMINAL";
  readonly blockingCommandCount: 0 | 1;
}

export type CompiledStep = CompiledSetVariableStep | CompiledConditionStep | CompiledSendMessageStep | CompiledEndStep;

export interface CompiledStepBase {
  readonly id: string;
  readonly type: "set_variable" | "condition" | "send_message" | "end";
  readonly stepHandlerKey: string;
  readonly stepHandlerVersion: string;
  readonly implementationCompatibilityId: string;
  readonly handlerHash: string;
  readonly blockingCommandCount: 0 | 1;
}

export interface CompiledSetVariableStep extends CompiledStepBase {
  readonly type: "set_variable";
  readonly variable: string;
  readonly value: TypedValue;
  readonly next: string;
}

export interface CompiledConditionBranch {
  readonly outcome: string;
  readonly when: ExpressionAst;
  readonly expressionHash: string;
  readonly next: string;
}

export interface CompiledConditionStep extends CompiledStepBase {
  readonly type: "condition";
  readonly branches: readonly CompiledConditionBranch[];
}

export interface CompiledSendMessageStep extends CompiledStepBase {
  readonly type: "send_message";
  readonly content: MessageContentDefinition;
  readonly contentHash: string;
  readonly transitions: Readonly<Record<"requested" | "failed", string>>;
  readonly completionMode: "ON_EFFECT_TERMINAL";
  readonly outcomeMappingVersion: "send-message-terminal-v1";
  readonly outcomeMappingHash: string;
}

export interface CompiledEndStep extends CompiledStepBase {
  readonly type: "end";
}

export interface CompiledManifest {
  readonly schemaVersion: "compiled-manifest/phase1";
  readonly flowId: string;
  readonly flowVersion: string;
  readonly entryStepId: string;
  readonly definitionHash: string;
  readonly manifestHash: string;
  readonly canonicalCodecVersion: "jcs-rfc8785-subset-v1";
  readonly canonicalCodecHash: string;
  readonly expressionLanguageVersion: "typed-expression-phase1-v1";
  readonly expressionExecutorCompatibilityId: "typed-expression-phase1-v1";
  readonly expressionExecutorHash: string;
  readonly outcomeMappingVersion: "send-message-terminal-v1";
  readonly outcomeMappingHash: string;
  readonly stepHandlers: readonly StepHandlerManifest[];
  readonly steps: readonly CompiledStep[];
}

export type RunStatus = "RUNNING" | "WAITING_EFFECT" | "COMPLETED" | "FAILED";

export interface EffectContinuationSnapshot {
  readonly effectContinuationId: string;
  readonly awaitedLogicalEffectId: string;
  readonly expectedPayloadHash: string;
  readonly outcomeMappingVersion: "send-message-terminal-v1";
  readonly outcomeMappingHash: string;
  readonly state: "WAITING";
  readonly terminalOutcomeTransitions: Readonly<Record<"requested" | "failed", string>>;
}

export interface ConsumedContinuationSnapshot {
  readonly outcome: "requested" | "failed";
  readonly ledgerState: ConsumableEffectLedgerState;
  readonly logicalEffectId: string;
  readonly payloadHash: string;
}

export interface RunStateSnapshot {
  readonly runId: string;
  readonly manifestHash: string;
  readonly status: RunStatus;
  readonly currentStepId: string | null;
  readonly variables: Readonly<Record<string, TypedValue>>;
  readonly activationOrdinal: number;
  readonly consumedContinuations: Readonly<Record<string, ConsumedContinuationSnapshot>>;
  readonly waitingContinuation?: EffectContinuationSnapshot;
  readonly lastErrorCode?: EngineErrorCode;
}

export type EngineErrorCode =
  | "INVALID_TRANSITION_BUDGET"
  | "MANIFEST_MISMATCH"
  | "MANIFEST_INTEGRITY_FAILED"
  | "INVALID_RUN_STATE"
  | "INVALID_RESOLUTION"
  | "ACTIVATION_ORDINAL_OVERFLOW"
  | "TRANSITION_BUDGET_EXCEEDED"
  | "STEP_NOT_FOUND"
  | "EXPRESSION_EVALUATION_FAILED"
  | "NO_CONDITION_BRANCH_MATCHED"
  | "NON_CONSUMABLE_EFFECT_STATE"
  | "RUN_NOT_WAITING_EFFECT"
  | "CONTINUATION_MISMATCH"
  | "CONSUMED_CONTINUATION_CONFLICT"
  | "OUTCOME_MAPPER_NOT_FOUND";

export interface EngineError {
  readonly code: EngineErrorCode;
  readonly stepId?: string;
  readonly details: Readonly<Record<string, string>>;
}

export interface AuditFact {
  readonly type:
    | "RUN_STARTED"
    | "STEP_ACTIVATED"
    | "VARIABLE_SET"
    | "CONDITION_BRANCH_SELECTED"
    | "COMMAND_EMITTED"
    | "CONTINUATION_WAITING"
    | "CONTINUATION_CONSUMED"
    | "CONTINUATION_ALREADY_CONSUMED"
    | "RUN_COMPLETED"
    | "RUN_FAILED";
  readonly stepId?: string;
  readonly details: Readonly<Record<string, string>>;
}

export interface SendMessagePayload {
  readonly contentVersionId: string;
  readonly text: string;
}

export interface EngineCommand {
  readonly kind: "SEND_MESSAGE";
  readonly blocking: true;
  readonly completionMode: "ON_EFFECT_TERMINAL";
  readonly logicalEffectId: string;
  readonly effectContinuationId: string;
  readonly commandOrdinal: 0;
  readonly activationOrdinal: number;
  readonly stepId: string;
  readonly payload: SendMessagePayload;
  readonly payloadHash: string;
  readonly outcomeMappingVersion: "send-message-terminal-v1";
  readonly outcomeMappingHash: string;
}

export type ConsumableEffectLedgerState = "CONFIRMED" | "DENIED" | "FAILED_PERMANENT";
export type NonConsumableEffectLedgerState = "UNKNOWN" | "RECONCILING" | "MANUAL_REVIEW" | "NOT_APPLIED" | "CANCELLED_BEFORE_DISPATCH";

export interface EffectResolution {
  readonly effectContinuationId: string;
  readonly logicalEffectId: string;
  readonly payloadHash: string;
  readonly ledgerState: ConsumableEffectLedgerState | NonConsumableEffectLedgerState;
}

export interface EngineTransition {
  readonly nextRunState: RunStateSnapshot;
  readonly commands: readonly EngineCommand[];
  readonly auditFacts: readonly AuditFact[];
  readonly errors: readonly EngineError[];
}

export type CompileResult = { readonly ok: true; readonly manifest: CompiledManifest } | { readonly ok: false; readonly errors: readonly CompileError[] };
