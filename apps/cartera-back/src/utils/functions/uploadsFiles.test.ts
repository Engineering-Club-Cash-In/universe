import { describe, expect, test } from 'bun:test';
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
    const file = new Blob(['synthetic']);
    Object.defineProperty(file, 'arrayBuffer', {
      value: () => Promise.reject(new Error('synthetic read failure')),
    });

    const result = await uploadFileController({ body: { file }, set });

    expect(set.status).toBe(500);
    expect(result).toEqual({ error: 'Error uploading file' });
  });
});
