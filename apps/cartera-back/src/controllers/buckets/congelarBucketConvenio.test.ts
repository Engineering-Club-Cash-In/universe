import { describe, expect, it } from "bun:test";
import {
  BUCKET_CONVENIO_AL_DIA,
  BUCKET_CONVENIO_ATRASADO,
  bucketParaCongelarEnConvenio,
  congelarBucketPorConvenio,
  tieneBucketDeConvenio,
} from "./congelarBucketConvenio";

/**
 * COBROS-02 Fase 2. Lo que cuidan estas pruebas es la regla de qué bucket se
 * congela y que el congelamiento no pueda tumbar la creación de un convenio —
 * que es una operación con plata de por medio.
 *
 * El ejecutor es un doble que solo sabe responder `execute`: acá no se prueba
 * SQL, se prueba la decisión.
 */

type Fila = Record<string, unknown>;

function ejecutorFalso(respuestas: Fila[][], registro?: string[]) {
  let i = 0;
  return {
    execute: async (consulta: unknown) => {
      if (registro) {
        const chunks = (consulta as { queryChunks?: unknown[] })?.queryChunks;
        registro.push(
          (chunks ?? [])
            .map((c) => (c as { value?: unknown[] })?.value?.join?.("") ?? "")
            .join(" "),
        );
      }
      const rows = respuestas[i] ?? [];
      i++;
      return { rows } as { rows: Fila[] };
    },
  };
}

describe("bucketParaCongelarEnConvenio", () => {
  it("usa la última fila del historial: es el bucket que tenía al firmar", async () => {
    const ej = ejecutorFalso([[{ bucket_nuevo: 3 }]]);
    expect(await bucketParaCongelarEnConvenio(1, 0, ej as never)).toBe(3);
  });

  it("respeta el bucket viejo aunque hoy esté atrasado: el convenio congela", async () => {
    const ej = ejecutorFalso([[{ bucket_nuevo: 1 }]]);
    expect(await bucketParaCongelarEnConvenio(1, 4, ej as never)).toBe(1);
  });

  it("sin historial y al día cae en la regla de re-siembra: B2", async () => {
    const ej = ejecutorFalso([[]]);
    expect(await bucketParaCongelarEnConvenio(1, 0, ej as never)).toBe(
      BUCKET_CONVENIO_AL_DIA,
    );
  });

  it("sin historial y atrasado cae en la regla de re-siembra: B4", async () => {
    const ej = ejecutorFalso([[]]);
    expect(await bucketParaCongelarEnConvenio(1, 2, ej as never)).toBe(
      BUCKET_CONVENIO_ATRASADO,
    );
  });
});

describe("tieneBucketDeConvenio", () => {
  it("es true cuando ya hay fila del régimen de convenio", async () => {
    const ej = ejecutorFalso([[{ existe: true }]]);
    expect(await tieneBucketDeConvenio(1, ej as never)).toBe(true);
  });

  it("es false cuando no la hay", async () => {
    const ej = ejecutorFalso([[{ existe: false }]]);
    expect(await tieneBucketDeConvenio(1, ej as never)).toBe(false);
  });
});

describe("congelarBucketPorConvenio", () => {
  it("no escribe dos veces: si ya está congelado, no hace nada", async () => {
    const sentencias: string[] = [];
    const ej = ejecutorFalso([[{ existe: true }]], sentencias);
    const r = await congelarBucketPorConvenio({
      credito_id: 1,
      bucket: 3,
      ejecutor: ej as never,
    });
    expect(r).toBeNull();
    // Solo la comprobación, ningún INSERT.
    expect(sentencias).toHaveLength(1);
  });

  it("escribe la fila y devuelve el bucket congelado", async () => {
    const sentencias: string[] = [];
    const ej = ejecutorFalso([[{ existe: false }], []], sentencias);
    const r = await congelarBucketPorConvenio({
      credito_id: 1,
      bucket: 3,
      convenio_id: 99,
      ejecutor: ej as never,
    });
    expect(r).toBe(3);
    expect(sentencias).toHaveLength(2);
    expect(sentencias[1]).toContain("buckets_historial");
    expect(sentencias[1]).toContain("CONGELADO");
  });

  it("NO lanza si la escritura falla: el convenio ya existe y tiene plata", async () => {
    const ej = {
      execute: async () => {
        throw new Error("boom");
      },
    };
    const r = await congelarBucketPorConvenio({
      credito_id: 1,
      bucket: 3,
      ejecutor: ej as never,
    });
    expect(r).toBeNull();
  });
});
