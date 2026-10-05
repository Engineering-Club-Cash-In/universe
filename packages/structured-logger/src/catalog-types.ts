export type LogLevel = 'info' | 'warn' | 'error';

export type FieldDefinition =
  | Readonly<{ type: 'boolean' }>
  | Readonly<{ type: 'enum'; values: readonly string[] }>
  | Readonly<{ type: 'integer'; min: number; max: number }>
  | Readonly<{ type: 'string'; maxLength: number; pattern: string }>
  | Readonly<{ type: 'timestamp' }>
  | Readonly<{ type: 'uuid' }>;

export interface CountInvariantDefinition {
  readonly total: string;
  readonly parts: readonly string[];
  readonly optionalParts: readonly string[];
}

export interface OutcomeDefinition {
  readonly level: LogLevel;
  readonly required: readonly string[];
  readonly optional: readonly string[];
  readonly constants?: Readonly<Record<string, string | number | boolean>>;
}

export interface EventDefinition {
  readonly outcomes: Readonly<Record<string, OutcomeDefinition>>;
}

export interface EventCatalogDefinition {
  readonly schemaVersion: number;
  readonly commonFields: Readonly<Record<string, FieldDefinition>>;
  readonly fields: Readonly<Record<string, FieldDefinition>>;
  readonly events: Readonly<Record<string, EventDefinition>>;
  readonly providerOperations: Readonly<Record<string, readonly string[]>>;
  readonly countInvariants: readonly CountInvariantDefinition[];
}
