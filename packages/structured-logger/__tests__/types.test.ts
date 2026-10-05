import { expect, test } from 'bun:test';
import { carteraCatalog } from '../src/cartera-catalog';
import type { CountInvariantDefinition } from '../src/catalog-types';
import { createStructuredLogger } from '../src/logger';

const logger = createStructuredLogger(carteraCatalog, {
  service: 'cartera-back',
  environment: 'staging',
  sink: () => undefined,
});

type PaymentUploadPayload = {
  readonly mime_family: 'pdf';
  readonly duration_ms: number;
};
declare const validExactKeyUnion: PaymentUploadPayload | { readonly mime_family: 'image'; readonly duration_ms: number };
declare const invalidExactKeyUnion: PaymentUploadPayload | (PaymentUploadPayload & { readonly surprise: string });

const customCountCatalog = {
  schemaVersion: carteraCatalog.schemaVersion,
  commonFields: carteraCatalog.commonFields,
  fields: {
    processed_count: carteraCatalog.fields.processed_count,
    succeeded_count: carteraCatalog.fields.succeeded_count,
    failed_count: carteraCatalog.fields.failed_count,
    skipped_count: carteraCatalog.fields.skipped_count,
  },
  events: {
    'custom.counts': {
      outcomes: {
        none_declared: {
          level: 'info',
          required: [],
          optional: [],
        },
        mandatory_complete_required: {
          level: 'info',
          required: ['processed_count', 'succeeded_count', 'failed_count'],
          optional: [],
        },
        mandatory_complete_optional: {
          level: 'info',
          required: [],
          optional: ['processed_count', 'succeeded_count', 'failed_count'],
        },
        optional_part_required: {
          level: 'info',
          required: ['skipped_count'],
          optional: ['processed_count', 'succeeded_count', 'failed_count'],
        },
        optional_part_optional: {
          level: 'info',
          required: [],
          optional: ['processed_count', 'succeeded_count', 'failed_count', 'skipped_count'],
        },
        partial_mandatory_optional: {
          level: 'info',
          required: [],
          optional: ['succeeded_count'],
        },
        partial_mandatory_required: {
          level: 'info',
          required: ['succeeded_count'],
          optional: [],
        },
        optional_only: {
          level: 'info',
          required: [],
          optional: ['skipped_count'],
        },
      },
    },
  },
  providerOperations: {},
  countInvariants: [{
    total: 'processed_count',
    parts: ['succeeded_count', 'failed_count'],
    optionalParts: ['skipped_count'],
  }],
} as const;
const customCountLogger = createStructuredLogger(customCountCatalog, {
  service: 'custom-counts',
  environment: 'staging',
  sink: () => undefined,
});

const broadCountInvariants: readonly CountInvariantDefinition[] = [{
  total: 'processed_count',
  parts: ['succeeded_count', 'failed_count'],
  optionalParts: [],
}];
const broadCountCatalog = {
  schemaVersion: carteraCatalog.schemaVersion,
  commonFields: carteraCatalog.commonFields,
  fields: {
    duration_ms: carteraCatalog.fields.duration_ms,
    processed_count: carteraCatalog.fields.processed_count,
    succeeded_count: carteraCatalog.fields.succeeded_count,
    failed_count: carteraCatalog.fields.failed_count,
  },
  events: {
    'custom.broad_counts': {
      outcomes: {
        completed: {
          level: 'info',
          required: ['duration_ms'],
          optional: ['processed_count', 'succeeded_count', 'failed_count'],
        },
      },
    },
  },
  providerOperations: {},
  countInvariants: broadCountInvariants,
} as const;
const broadCountLogger = createStructuredLogger(broadCountCatalog, {
  service: 'broad-counts',
  environment: 'staging',
  sink: () => undefined,
});

const widenedTupleCountInvariants: readonly [CountInvariantDefinition] = [{
  total: 'processed_count',
  parts: ['succeeded_count', 'failed_count'],
  optionalParts: [],
}];
const widenedTupleCountCatalog = {
  schemaVersion: carteraCatalog.schemaVersion,
  commonFields: carteraCatalog.commonFields,
  fields: {
    duration_ms: carteraCatalog.fields.duration_ms,
    processed_count: carteraCatalog.fields.processed_count,
    succeeded_count: carteraCatalog.fields.succeeded_count,
    failed_count: carteraCatalog.fields.failed_count,
  },
  events: {
    'custom.widened_tuple_counts': {
      outcomes: {
        completed: {
          level: 'info',
          required: ['duration_ms'],
          optional: ['processed_count', 'succeeded_count', 'failed_count'],
        },
      },
    },
  },
  providerOperations: {},
  countInvariants: widenedTupleCountInvariants,
} as const;
const widenedTupleCountLogger = createStructuredLogger(widenedTupleCountCatalog, {
  service: 'widened-tuple-counts',
  environment: 'staging',
  sink: () => undefined,
});

const widenedReasonConstants: Readonly<Record<'reason_code', string>> = {
  reason_code: 'missing_payment_reference',
};
const widenedConstantsCatalog = {
  schemaVersion: carteraCatalog.schemaVersion,
  commonFields: carteraCatalog.commonFields,
  fields: {
    reason_code: {
      type: 'enum',
      values: ['missing_payment_reference', 'invalid_payment_state'],
    },
  },
  events: {
    'custom.widened_constants': {
      outcomes: {
        rejected: {
          level: 'warn',
          required: ['reason_code'],
          optional: [],
          constants: widenedReasonConstants,
        },
      },
    },
  },
  providerOperations: {},
  countInvariants: [],
} as const;
const widenedConstantsLogger = createStructuredLogger(widenedConstantsCatalog, {
  service: 'widened-constants',
  environment: 'staging',
  sink: () => undefined,
});

if (false) {
  widenedConstantsLogger.emit('custom.widened_constants', 'rejected', {
    reason_code: 'missing_payment_reference',
  });
  widenedConstantsLogger.emit('custom.widened_constants', 'rejected', {
    // @ts-expect-error widened constants must retain the enum field constraint
    reason_code: 'not_in_the_enum',
  });

  logger.emit('payment.upload', 'stored', validExactKeyUnion);
  // @ts-expect-error every union member must reject runtime extra fields
  logger.emit('payment.upload', 'stored', invalidExactKeyUnion);

  widenedTupleCountLogger.emit('custom.widened_tuple_counts', 'completed', {
    duration_ms: 1,
    processed_count: 1,
    succeeded_count: 1,
    failed_count: 0,
  });
  // @ts-expect-error widened tuple entries must not erase ordinary required fields
  widenedTupleCountLogger.emit('custom.widened_tuple_counts', 'completed', {});

  broadCountLogger.emit('custom.broad_counts', 'completed', {
    duration_ms: 1,
    processed_count: 1,
    succeeded_count: 1,
    failed_count: 0,
  });
  // @ts-expect-error broad invariant arrays must not erase ordinary required fields
  broadCountLogger.emit('custom.broad_counts', 'completed', {});

  // Tuple invariant type matrix: declaration coverage × requiredness.
  customCountLogger.emit('custom.counts', 'none_declared', {});

  customCountLogger.emit('custom.counts', 'mandatory_complete_required', {
    processed_count: 1, succeeded_count: 1, failed_count: 0,
  });
  // @ts-expect-error required mandatory fields cannot use the absent branch
  customCountLogger.emit('custom.counts', 'mandatory_complete_required', {});

  customCountLogger.emit('custom.counts', 'mandatory_complete_optional', {});
  customCountLogger.emit('custom.counts', 'mandatory_complete_optional', {
    processed_count: 1, succeeded_count: 1, failed_count: 0,
  });
  // @ts-expect-error present mandatory fields must be complete
  customCountLogger.emit('custom.counts', 'mandatory_complete_optional', { processed_count: 1 });

  customCountLogger.emit('custom.counts', 'optional_part_required', {
    processed_count: 2, succeeded_count: 1, failed_count: 0, skipped_count: 1,
  });
  // @ts-expect-error a required optional part cannot be omitted from the full branch
  customCountLogger.emit('custom.counts', 'optional_part_required', {
    processed_count: 1, succeeded_count: 1, failed_count: 0,
  });
  // @ts-expect-error a required optional part prevents the absent branch
  customCountLogger.emit('custom.counts', 'optional_part_required', {});

  customCountLogger.emit('custom.counts', 'optional_part_optional', {});
  customCountLogger.emit('custom.counts', 'optional_part_optional', {
    processed_count: 1, succeeded_count: 1, failed_count: 0,
  });
  customCountLogger.emit('custom.counts', 'optional_part_optional', {
    processed_count: 2, succeeded_count: 1, failed_count: 0, skipped_count: 1,
  });
  // @ts-expect-error an optional part alone activates the invariant at runtime
  customCountLogger.emit('custom.counts', 'optional_part_optional', { skipped_count: 1 });

  customCountLogger.emit('custom.counts', 'partial_mandatory_optional', {});
  // @ts-expect-error partial mandatory declarations have no full branch
  customCountLogger.emit('custom.counts', 'partial_mandatory_optional', { succeeded_count: 1 });
  // @ts-expect-error a required partial mandatory declaration has neither branch
  customCountLogger.emit('custom.counts', 'partial_mandatory_required', {});
  // @ts-expect-error a required partial mandatory declaration cannot satisfy the runtime invariant
  customCountLogger.emit('custom.counts', 'partial_mandatory_required', { succeeded_count: 1 });

  customCountLogger.emit('custom.counts', 'optional_only', {});
  // @ts-expect-error any present invariant field requires all mandatory count fields at runtime
  customCountLogger.emit('custom.counts', 'optional_only', { skipped_count: 1 });

  logger.emit('payment.upload', 'stored', { mime_family: 'pdf', duration_ms: 1 });
  logger.emit('payment.revalidation', 'completed', {
    credit_updated: true,
    installment_closed: false,
    duration_ms: 1,
  });

  logger.emit('job.execution', 'completed', {
    job_name: 'verify_sat_invoices',
    duration_ms: 1,
  });
  logger.emit('job.execution', 'completed', {
    job_name: 'verify_sat_invoices',
    duration_ms: 1,
    processed_count: 1,
    succeeded_count: 1,
    failed_count: 0,
  });
  // @ts-expect-error count invariant fields must be complete or absent
  logger.emit('job.execution', 'completed', {
    job_name: 'verify_sat_invoices',
    duration_ms: 1,
    processed_count: 1,
  });

  // @ts-expect-error required count invariant fields cannot all be absent
  logger.emit('invoice.voiding', 'completed', {
    voiding_mode: 'batch',
    provider: 'cofidi_sat',
    manual_action_required: false,
    duration_ms: 1,
  });

  logger.emit('credit.due_date', 'skipped', {
    due_date_operation: 'repair_missing_february',
    processed_count: 2,
    succeeded_count: 0,
    failed_count: 0,
    skipped_count: 2,
    duration_ms: 1,
    reason_code: 'missing_payment_reference',
  });
  // @ts-expect-error required optional-part count field cannot be absent
  logger.emit('credit.due_date', 'skipped', {
    due_date_operation: 'repair_missing_february',
    processed_count: 2,
    succeeded_count: 0,
    failed_count: 0,
    duration_ms: 1,
    reason_code: 'missing_payment_reference',
  });
  logger.emit('credit.due_date', 'completed', {
    due_date_operation: 'json_bulk_update',
    duration_ms: 1,
    processed_count: 2,
    succeeded_count: 2,
    failed_count: 0,
  });
  logger.emit('credit.due_date', 'completed', {
    due_date_operation: 'json_bulk_update',
    duration_ms: 1,
    processed_count: 2,
    succeeded_count: 1,
    failed_count: 0,
    skipped_count: 1,
  });

  // @ts-expect-error unknown event
  logger.emit('payment.unknown', 'stored', { mime_family: 'pdf', duration_ms: 1 });

  // @ts-expect-error unknown outcome
  logger.emit('payment.upload', 'completed', { mime_family: 'pdf', duration_ms: 1 });

  // @ts-expect-error invalid enum
  logger.emit('payment.upload', 'stored', { mime_family: 'video', duration_ms: 1 });

  // @ts-expect-error missing required field
  logger.emit('payment.upload', 'stored', { duration_ms: 1 });

  // @ts-expect-error extra field
  logger.emit('payment.upload', 'stored', { mime_family: 'pdf', duration_ms: 1, body: 'blocked' });

  logger.emit('invoice.voiding', 'local_state_inconsistent', {
    voiding_mode: 'batch',
    provider: 'cofidi_sat',
    processed_count: 1,
    succeeded_count: 0,
    failed_count: 1,
    manual_action_required: true,
    duration_ms: 1,
    error_code: 'persistence_failed',
  });

  logger.emit('invoice.voiding', 'local_state_inconsistent', {
    voiding_mode: 'batch',
    provider: 'cofidi_sat',
    processed_count: 1,
    succeeded_count: 0,
    failed_count: 1,
    // @ts-expect-error catalog constants must remain literal payload values
    manual_action_required: false,
    duration_ms: 1,
    error_code: 'persistence_failed',
  });
}

test('typed API compiles with the catalog-derived contract', () => {
  expect(typeof logger.emit).toBe('function');
});
