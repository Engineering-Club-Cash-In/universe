import type { EngineCommand, SendMessagePayload } from "./types";

export class RecordingEffectSink {
  private readonly recorded: EngineCommand[] = [];

  record(commands: readonly EngineCommand[]): readonly EngineCommand[] {
    const cloned = commands.map((command) => cloneCommand(command));
    this.recorded.push(...cloned);
    return cloned.map((command) => cloneCommand(command));
  }

  entries(): readonly EngineCommand[] {
    return this.recorded.map((command) => cloneCommand(command));
  }

  clear(): void {
    this.recorded.length = 0;
  }
}

function cloneCommand(command: EngineCommand): EngineCommand {
  return {
    kind: command.kind,
    blocking: command.blocking,
    completionMode: command.completionMode,
    logicalEffectId: command.logicalEffectId,
    effectContinuationId: command.effectContinuationId,
    commandOrdinal: command.commandOrdinal,
    activationOrdinal: command.activationOrdinal,
    stepId: command.stepId,
    payload: clonePayload(command.payload),
    payloadHash: command.payloadHash,
    outcomeMappingVersion: command.outcomeMappingVersion,
    outcomeMappingHash: command.outcomeMappingHash,
  };
}

function clonePayload(payload: SendMessagePayload): SendMessagePayload {
  return { contentVersionId: payload.contentVersionId, text: payload.text };
}
