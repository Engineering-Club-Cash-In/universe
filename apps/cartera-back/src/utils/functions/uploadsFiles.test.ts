import { describe, expect, test } from 'bun:test';
import { createCarteraStructuredLogger } from '../structuredLogger';
import { uploadFileController } from './uploadsFiles';

describe('uploadFileController', () => {
  test('preserves the 400 response when no Blob is provided', async () => {
    const set = { status: 200 };
    const result = await uploadFileController({ body: {}, set });

    expect(set.status).toBe(400);
    expect(result).toEqual({ error: 'No file uploaded' });
  });

  test('preserves the 500 response when reading the Blob fails before S3', async () => {
    const set = { status: 200 };
    const lines: string[] = [];
    const structuredLogger = createCarteraStructuredLogger({
      environment: 'local',
      sink: (line) => lines.push(line),
    });
    const file = new Blob(['synthetic']);
    Object.defineProperty(file, 'arrayBuffer', {
      value: () => Promise.reject(new Error('synthetic read failure')),
    });

    const result = await uploadFileController({ body: { file }, set, structuredLogger });

    expect(set.status).toBe(500);
    expect(result).toEqual({ error: 'Error uploading file' });
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toEqual(expect.objectContaining({
      event: 'payment.upload',
      outcome: 'failed',
      level: 'error',
      mime_family: 'other',
      error_code: 'parse_failed',
    }));
    expect(lines[0]).not.toContain('synthetic read failure');
  });

  test('emits dependency and terminal events when R2 rejects the upload', async () => {
    const set = { status: 200 };
    const lines: string[] = [];
    const structuredLogger = createCarteraStructuredLogger({
      environment: 'local',
      sink: (line) => lines.push(line),
    });
    const storage = {
      send: async () => {
        throw new Error('synthetic provider secret');
      },
    };
    const file = new Blob(['synthetic'], { type: 'image/png' });
    const result = await uploadFileController({ body: { file }, set, structuredLogger, storage });

    expect(set.status).toBe(500);
    expect(result).toEqual({ error: 'Error uploading file' });
    expect(lines.map((line) => JSON.parse(line))).toEqual([
      expect.objectContaining({
        event: 'integration.request',
        outcome: 'failed',
        provider: 'cloudflare_r2',
        operation: 'put_upload',
        error_code: 'unknown',
      }),
      expect.objectContaining({
        event: 'payment.upload',
        outcome: 'failed',
        mime_family: 'image',
        error_code: 'persistence_failed',
      }),
    ]);
    expect(lines.join('\n')).not.toContain('synthetic provider secret');
  });
});
