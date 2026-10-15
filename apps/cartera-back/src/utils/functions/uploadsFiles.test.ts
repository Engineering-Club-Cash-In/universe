import { describe, expect, test } from 'bun:test';
import { createCarteraStructuredLogger } from '../structuredLogger';
import { uploadFileController } from './uploadsFiles';
import { erroresUrlBoletasDelBucket } from '../../controllers/registerPaymentPolicy';

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

describe('uploadFileController: la llave que genera cumple la regla del bucket (Codex r4 #2)', () => {
  const subir = async (name: string, type: string) => {
    const set = { status: 200 };
    const storage = { send: async () => ({}) };
    const res = (await uploadFileController({ body: { file: new File(['x'], name, { type }) }, set, storage })) as { filename: string };
    return res.filename;
  };

  test('nombre con puntos y espacios + image/jpeg: la llave cumple LLAVE_BOLETA y termina en .jpg', async () => {
    const llave = await subir('Boleta 13.10.2026 (1)', 'image/jpeg');
    expect(erroresUrlBoletasDelBucket([llave], 'https://r2.example/')).toEqual([]);
    expect(llave.endsWith('.jpg')).toBe(true);
  });

  test('una extensión buena se conserva tal cual', async () => {
    const llave = await subir('recibo.PDF', 'application/pdf');
    expect(llave.endsWith('.PDF')).toBe(true);
    expect(erroresUrlBoletasDelBucket([llave], 'https://r2.example/')).toEqual([]);
  });

  test('nombre que termina en punto + application/pdf: .pdf', async () => {
    const llave = await subir('x.', 'application/pdf');
    expect(llave.endsWith('.pdf')).toBe(true);
    expect(erroresUrlBoletasDelBucket([llave], 'https://r2.example/')).toEqual([]);
  });

  test('extensión rara y sin tipo: la llave queda en el uuid solo', async () => {
    const llave = await subir('a.jpg_large', '');
    expect(llave).not.toContain('.');
    expect(erroresUrlBoletasDelBucket([llave], 'https://r2.example/')).toEqual([]);
  });
});
