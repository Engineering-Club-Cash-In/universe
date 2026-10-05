import { carteraCatalog } from '../src/cartera-catalog';
import { createStructuredLogger } from '../src/logger';
import type { EventPayload } from '../src/logger';

const logger = createStructuredLogger(carteraCatalog, {
  service: 'cartera-back',
  environment: 'staging',
  sink: () => undefined,
});

type JobExecutionCompletedPayload = EventPayload<typeof carteraCatalog, 'job.execution', 'completed'>;
type BaseJobExecutionPayload = {
  readonly job_name: 'verify_sat_invoices';
  readonly duration_ms: number;
};
type FullJobExecutionCounts = BaseJobExecutionPayload & {
  readonly processed_count: number;
  readonly succeeded_count: number;
  readonly failed_count: number;
};
type InvalidJobExecutionCounts = BaseJobExecutionPayload & {
  readonly processed_count: undefined;
};
declare const invalidUnionPayload: BaseJobExecutionPayload | InvalidJobExecutionCounts;
declare const validUnionPayload: BaseJobExecutionPayload | FullJobExecutionCounts;
type PaymentUploadPayload = {
  readonly mime_family: 'pdf';
  readonly duration_ms: number;
};
declare const validExactKeyUnion: PaymentUploadPayload | { readonly mime_family: 'image'; readonly duration_ms: number };
declare const invalidExactKeyUnion: PaymentUploadPayload | (PaymentUploadPayload & { readonly surprise: string });

const broadMalformedPayload: JobExecutionCompletedPayload = {
  job_name: 'verify_sat_invoices',
  duration_ms: 1,
  processed_count: undefined,
};

if (false) {
  logger.emit('payment.upload', 'stored', validExactKeyUnion);
  // @ts-expect-error every union member must reject runtime extra fields
  logger.emit('payment.upload', 'stored', invalidExactKeyUnion);

  // @ts-expect-error every union member must satisfy own-key validation
  logger.emit('job.execution', 'completed', invalidUnionPayload);
  logger.emit('job.execution', 'completed', validUnionPayload);

  // @ts-expect-error a broad EventPayload must not bypass own-key validation
  logger.emit('job.execution', 'completed', broadMalformedPayload);

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

  // @ts-expect-error an own undefined count field is present at runtime
  logger.emit('job.execution', 'completed', {
    job_name: 'verify_sat_invoices',
    duration_ms: 1,
    processed_count: undefined,
  });

  // @ts-expect-error present count invariant fields must be complete
  logger.emit('job.execution', 'completed', {
    job_name: 'verify_sat_invoices',
    duration_ms: 1,
    processed_count: 1,
  });
}
