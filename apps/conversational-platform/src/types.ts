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
  readonly actionKey?: string;
  readonly actionVersion?: string;
  readonly subjectId?: string;
  readonly conversationId?: string;
  readonly input?: Readonly<Record<string, TypedValue>>;
  readonly transitions?: Readonly<Partial<Record<"requested" | "failed" | "succeeded" | "business_error" | "technical_error", string>>>;
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
  | "ACTION_REGISTRY_REQUIRED"
  | "ACTION_DEPENDENCY_NOT_FOUND"
  | "ACTION_INPUT_SCHEMA_MISMATCH"
  | "INTERNAL_MANIFEST_INVALID";

export interface CompileError {
  readonly code: CompileErrorCode;
  readonly stepId?: string;
  readonly path: string;
  readonly details: Readonly<Record<string, string>>;
}

export interface StepHandlerManifest {
  readonly stepType: "set_variable" | "condition" | "send_message" | "execute_action" | "end";
  readonly stepHandlerKey: string;
  readonly stepHandlerVersion: string;
  readonly implementationCompatibilityId: string;
  readonly handlerHash: string;
  readonly completionMode: "ON_PERSIST" | "ON_EFFECT_TERMINAL";
  readonly blockingCommandCount: 0 | 1;
}

export type CompiledStep = CompiledSetVariableStep | CompiledConditionStep | CompiledSendMessageStep | CompiledExecuteActionStep | CompiledEndStep;

export interface CompiledStepBase {
  readonly id: string;
  readonly type: "set_variable" | "condition" | "send_message" | "execute_action" | "end";
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

export type ActionSensitivity = "NON_SENSITIVE" | "SENSITIVE" | "PRIVILEGED";
export type ReconcileMode = "READ_ONLY" | "WEBHOOK_ONLY" | "MUTATING";
export type EffectGuarantee = "RECEIVER_DEDUP" | "RECONCILABLE" | "AT_LEAST_ONCE" | "AT_MOST_ONCE" | "MANUAL_ON_AMBIGUITY";

export interface ActionSchemaField {
  readonly name: string;
  readonly type: TypedValue["type"];
  readonly required: boolean;
}

export interface ActionSchema {
  readonly schemaVersion: "typed-record/v1";
  readonly fields: readonly ActionSchemaField[];
  readonly additionalProperties: false;
}

export interface ActionRetryPolicy {
  readonly retryPolicyKey: string;
  readonly retryPolicyVersion: string;
  readonly retryPolicyHash: string;
  readonly maxAttempts: number;
}

export interface ActionAdapterReference {
  readonly adapterKey: string;
  readonly adapterVersion: string;
  readonly implementationCompatibilityId: "fake-action-adapter/v1";
  readonly adapterHash: string;
}

export interface ActionPolicyReference {
  readonly policyKey: string;
  readonly policyVersion: string;
  readonly policyHash: string;
}

export interface ActionDescriptor {
  readonly descriptorVersion: "action-descriptor/v1";
  readonly actionKey: string;
  readonly actionVersion: string;
  readonly actionHash: string;
  readonly inputSchema: ActionSchema;
  readonly inputSchemaHash: string;
  readonly outputSchema: ActionSchema;
  readonly outputSchemaHash: string;
  readonly sensitivity: ActionSensitivity;
  readonly purpose: string;
  readonly dataClasses: readonly string[];
  readonly retryPolicy: ActionRetryPolicy;
  readonly reconcileMode: ReconcileMode;
  readonly effectGuarantee: EffectGuarantee;
  readonly adapter: ActionAdapterReference;
  readonly policy: ActionPolicyReference;
  readonly businessResultCodes: readonly string[];
}

export interface ResolvedActionReference {
  readonly actionKey: string;
  readonly actionVersion: string;
  readonly actionHash: string;
  readonly adapter: ActionAdapterReference;
  readonly policy: ActionPolicyReference;
}

export interface CompiledExecuteActionStep extends CompiledStepBase {
  readonly type: "execute_action";
  readonly actionRef: ResolvedActionReference;
  readonly subjectId: string;
  readonly conversationId: string;
  readonly input: Readonly<Record<string, TypedValue>>;
  readonly transitions: Readonly<Record<"succeeded" | "business_error" | "technical_error", string>>;
  readonly completionMode: "ON_EFFECT_TERMINAL";
  readonly outcomeMappingVersion: "execute-action-terminal-v1";
  readonly outcomeMappingHash: string;
  readonly businessResultCodes: readonly string[];
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
  readonly actionDescriptors: readonly ActionDescriptor[];
  readonly stepHandlers: readonly StepHandlerManifest[];
  readonly steps: readonly CompiledStep[];
}

export type RunStatus = "RUNNING" | "WAITING_EFFECT" | "COMPLETED" | "FAILED";

export interface EffectContinuationSnapshot {
  readonly effectContinuationId: string;
  readonly awaitedLogicalEffectId: string;
  readonly expectedPayloadHash: string;
  readonly outcomeMappingVersion: "send-message-terminal-v1" | "execute-action-terminal-v1";
  readonly outcomeMappingHash: string;
  readonly state: "WAITING";
  readonly terminalOutcomeTransitions:
    | Readonly<Record<"requested" | "failed", string>>
    | Readonly<Record<"succeeded" | "business_error" | "technical_error", string>>;
  readonly businessResultCodes?: readonly string[];
}

export interface ConsumedContinuationSnapshot {
  readonly outcome: "requested" | "failed" | "succeeded" | "business_error" | "technical_error";
  readonly ledgerState: ConsumableEffectLedgerState;
  readonly logicalEffectId: string;
  readonly payloadHash: string;
  readonly businessResultCode?: string;
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

export interface SendMessageCommand {
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

export interface ExecuteActionPayload {
  readonly subjectId: string;
  readonly conversationId: string;
  readonly input: Readonly<Record<string, TypedValue>>;
  readonly purpose: string;
  readonly dataClasses: readonly string[];
}

export interface ExecuteActionCommand {
  readonly kind: "EXECUTE_ACTION";
  readonly blocking: true;
  readonly completionMode: "ON_EFFECT_TERMINAL";
  readonly logicalEffectId: string;
  readonly effectContinuationId: string;
  readonly commandOrdinal: 0;
  readonly activationOrdinal: number;
  readonly stepId: string;
  readonly actionRef: ResolvedActionReference;
  readonly retryPolicy: ActionRetryPolicy;
  readonly reconcileMode: ReconcileMode;
  readonly effectGuarantee: EffectGuarantee;
  readonly payload: ExecuteActionPayload;
  readonly payloadHash: string;
  readonly outcomeMappingVersion: "execute-action-terminal-v1";
  readonly outcomeMappingHash: string;
  readonly businessResultCodes: readonly string[];
}

export type EngineCommand = SendMessageCommand | ExecuteActionCommand;

export type ConsumableEffectLedgerState = "CONFIRMED" | "DENIED" | "FAILED_PERMANENT";
export type NonConsumableEffectLedgerState = "UNKNOWN" | "RECONCILING" | "MANUAL_REVIEW" | "NOT_APPLIED" | "CANCELLED_BEFORE_DISPATCH";

export interface EffectResolution {
  readonly effectContinuationId: string;
  readonly logicalEffectId: string;
  readonly payloadHash: string;
  readonly ledgerState: ConsumableEffectLedgerState | NonConsumableEffectLedgerState;
  readonly businessResultCode?: string;
}

export interface EngineTransition {
  readonly nextRunState: RunStateSnapshot;
  readonly commands: readonly EngineCommand[];
  readonly auditFacts: readonly AuditFact[];
  readonly errors: readonly EngineError[];
}

export type CompileResult = { readonly ok: true; readonly manifest: CompiledManifest } | { readonly ok: false; readonly errors: readonly CompileError[] };
