import { beforeEach, expect, mock, test } from "bun:test";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

const dialect = new PgDialect();
let creditos: {
  credito_id: number;
  sifco: string;
  asesor_id: number;
  bucket: number | null;
  compromiso: boolean;
  especial?: boolean;
  estado?: string;
}[];
let saved: Record<string, any> | undefined;
let writes: string[];
let queries: string[];
let updateMatches: boolean;
let actorRegistrado: boolean;
let lockTimeout: boolean;
const executor = {
  async execute(statement: SQL) {
    const { sql: query, params } = dialect.sqlToQuery(statement);
    queries.push(`${query} | ${JSON.stringify(params)}`);
    if (query.includes("pg_advisory_xact_lock") && lockTimeout) {
      throw { cause: { code: "55P03" } };
    }
    if (query.includes("WITH asignaciones")) {
      writes.push(query);
      const serializadas = params.find((param) => typeof param === "string" && param.startsWith("["));
      const cantidad = JSON.parse(serializadas as string).length;
      return { rows: updateMatches
        ? [{ actualizados: cantidad, historiales: cantidad, detalles: cantidad }]
        : [{ actualizados: 0, historiales: 0, detalles: 0 }] };
    }
    // Actor registrado (CB-114): por defecto existe; `actorRegistrado = false`
    // simula un correo que no está en platform_users o está inactivo.
    if (query.includes("FROM cartera_cobros2.platform_users") || query.includes("platform_users"))
      return { rows: actorRegistrado ? [{ id: 1 }] : [] };
    if (query.includes("SELECT c.credito_id")) return { rows: creditos };
    if (query.includes("SELECT ab.bucket")) return { rows: [
      { bucket: 1, asesor_id: 10, nombre: "Origen", capacidad_base: 300 },
      { bucket: 1, asesor_id: 20, nombre: "Con carga", capacidad_base: 300 },
      { bucket: 1, asesor_id: 30, nombre: "Disponible", capacidad_base: 300 },
    ] };
    if (query.includes("SELECT * FROM")) return { rows: saved ? [saved] : [] };
    if (query.includes("INSERT INTO") && query.includes("(id, payload_hash")) {
      saved = { id: params[0], payload_hash: params[1], actor_email: params[5],
        solicitud: JSON.parse(params[6] as string), preview: JSON.parse(params[7] as string),
        vence_en: params[8], estado: "previsualizada" };
      return { rows: [] };
    }
    if (query.startsWith("UPDATE") || query.includes("INSERT INTO")) {
      writes.push(query);
      if (query.includes("SET estado = 'confirmada'") && saved) {
        saved.estado = "confirmada";
        saved.idempotency_key = params[0];
      }
      if (query.includes("SET asesor_id")) return { rows: updateMatches ? [{ credito_id: 1 }] : [] };
    }
    return { rows: [] };
  },
};
mock.module("../../database", () => ({ db: { ...executor, transaction: (fn: (tx: typeof executor) => unknown) => fn(executor) } }));
const { previsualizarTrasladoCarteraMasivo, confirmarTrasladoCarteraMasivo, solicitudTrasladoSchema } = await import("./trasladosCartera");
const entrada = { asesorOrigenId: 10, modo: "redistribucion", motivo: "Renuncia", actorEmail: "supervisor@example.com" };

beforeEach(() => {
  saved = undefined; writes = []; queries = []; updateMatches = true; actorRegistrado = true; lockTimeout = false;
  creditos = [10, 20, 20, 20, 20].map((asesor_id, i) => ({ credito_id: i + 1, sifco: `S${i + 1}`, asesor_id, bucket: 1, compromiso: i === 0 }));
});

test("preview cuenta carga real de receptores y conserva prioridad de compromiso", async () => {
  const p = await previsualizarTrasladoCarteraMasivo(entrada);
  expect(p.asignaciones[0]).toMatchObject({ asesorNuevoId: 30, prioridad: 0, numeroCreditoSifco: "S1" });
  expect(p.carga.find(c => c.asesorId === 20)?.antes).toBe(4);
  expect(p.carga.find(c => c.asesorId === 30)?.despues).toBe(1);
  expect(writes).toEqual([]);
});

test("confirmación reintentada devuelve ID original sin duplicar cambios", async () => {
  const p = await previsualizarTrasladoCarteraMasivo(entrada);
  const input = { previewId: p.previewId, idempotencyKey: crypto.randomUUID(), actorEmail: entrada.actorEmail };
  const first = await confirmarTrasladoCarteraMasivo(input);
  const count = writes.length;
  const second = await confirmarTrasladoCarteraMasivo(input);
  expect(first).toEqual({ success: true, operacionId: p.previewId, cuentas: 1 });
  expect(second).toEqual(first);
  expect(writes.length).toBe(count);
});

test("reintento con otra llave no reutiliza una operación confirmada", async () => {
  const p = await previsualizarTrasladoCarteraMasivo(entrada);
  const input = { previewId: p.previewId, idempotencyKey: crypto.randomUUID(), actorEmail: entrada.actorEmail };
  await confirmarTrasladoCarteraMasivo(input);
  await expect(confirmarTrasladoCarteraMasivo({ ...input, idempotencyKey: crypto.randomUUID() })).rejects.toThrow("otra solicitud");
});

test("cambio de carga después del preview rechaza sin escribir", async () => {
  const p = await previsualizarTrasladoCarteraMasivo(entrada);
  creditos.push({ credito_id: 6, sifco: "S6", asesor_id: 30, bucket: 1, compromiso: false });
  await expect(confirmarTrasladoCarteraMasivo({ previewId: p.previewId, idempotencyKey: crypto.randomUUID(), actorEmail: entrada.actorEmail })).rejects.toThrow("La cartera cambió");
  expect(writes).toEqual([]);
});

test("no confirma créditos activos sin bucket operativo", async () => {
  creditos = [
    { credito_id: 1, sifco: "S1", asesor_id: 10, bucket: 1, compromiso: false },
    {
      credito_id: 2,
      sifco: "S2",
      asesor_id: 10,
      bucket: null,
      compromiso: false,
      especial: false,
      estado: "EN_CONVENIO",
    },
  ];
  const p = await previsualizarTrasladoCarteraMasivo(entrada);
  expect(p.excluidos).toHaveLength(1);
  await expect(
    confirmarTrasladoCarteraMasivo({
      previewId: p.previewId,
      idempotencyKey: crypto.randomUUID(),
      actorEmail: entrada.actorEmail,
    }),
  ).rejects.toThrow(/sin bucket operativo/);
  expect(writes).toEqual([]);
});

test("confirmación espera los locks de jobs y escribe lote sin bloquear tablas ajenas", async () => {
  const p = await previsualizarTrasladoCarteraMasivo(entrada);
  await confirmarTrasladoCarteraMasivo({
    previewId: p.previewId,
    idempotencyKey: crypto.randomUUID(),
    actorEmail: entrada.actorEmail,
  });
  const lockMoras = queries.findIndex((q) => q.includes("pg_advisory_xact_lock") && q.includes("728193"));
  const lockConvenio = queries.findIndex((q) => q.includes("pg_advisory_xact_lock") && q.includes("728194"));
  const escritura = queries.findIndex((q) => q.includes("WITH asignaciones"));
  expect(lockMoras).toBeGreaterThanOrEqual(0);
  expect(lockConvenio).toBeGreaterThanOrEqual(0);
  expect(escritura).toBeGreaterThanOrEqual(0);
  expect(lockMoras).toBeLessThan(escritura);
  expect(lockConvenio).toBeLessThan(escritura);
  expect(queries.some((q) => q.includes("LOCK TABLE"))).toBe(false);
});

test("timeout al esperar job se vuelve conflicto reintentable", async () => {
  const p = await previsualizarTrasladoCarteraMasivo(entrada);
  lockTimeout = true;
  await expect(confirmarTrasladoCarteraMasivo({
    previewId: p.previewId,
    idempotencyKey: crypto.randomUUID(),
    actorEmail: entrada.actorEmail,
  })).rejects.toThrow(/operación de buckets está en curso/);
});

test("preview vencido o de otro usuario no confirma", async () => {
  const p = await previsualizarTrasladoCarteraMasivo(entrada);
  const input = { previewId: p.previewId, idempotencyKey: crypto.randomUUID(), actorEmail: entrada.actorEmail };
  await expect(confirmarTrasladoCarteraMasivo({ ...input, actorEmail: "otro@example.com" })).rejects.toThrow("este usuario");
  saved!.vence_en = new Date(0);
  await expect(confirmarTrasladoCarteraMasivo(input)).rejects.toThrow("venció");
  expect(writes).toEqual([]);
});

test("CAS que no afecta crédito revierte lote y no confirma operación", async () => {
  const p = await previsualizarTrasladoCarteraMasivo(entrada);
  updateMatches = false;
  await expect(confirmarTrasladoCarteraMasivo({ previewId: p.previewId, idempotencyKey: crypto.randomUUID(), actorEmail: entrada.actorEmail })).rejects.toThrow("propietario cambió");
  expect(writes.some(q => q.includes("SET estado = 'confirmada'"))).toBe(false);
});

test("un lote con varios créditos usa una sola escritura atómica", async () => {
  creditos = [10, 10, 20, 20, 20].map((asesor_id, i) => ({
    credito_id: i + 1, sifco: `S${i + 1}`, asesor_id, bucket: 1, compromiso: false,
  }));
  const p = await previsualizarTrasladoCarteraMasivo(entrada);
  const resultado = await confirmarTrasladoCarteraMasivo({
    previewId: p.previewId,
    idempotencyKey: crypto.randomUUID(),
    actorEmail: entrada.actorEmail,
  });
  expect(resultado.cuentas).toBe(2);
  expect(writes.filter((q) => q.includes("WITH asignaciones"))).toHaveLength(1);
});

test("contrato rechaza nivelación no implementada, IDs inválidos y destino ausente", () => {
  expect(solicitudTrasladoSchema.safeParse({ ...entrada, modo: "nivelacion" }).success).toBe(false);
  expect(solicitudTrasladoSchema.safeParse({ ...entrada, asesorOrigenId: -1 }).success).toBe(false);
	expect(solicitudTrasladoSchema.safeParse({ ...entrada, modo: "traslado_completo" }).success).toBe(false);
	expect(
		solicitudTrasladoSchema.safeParse({
			...entrada,
			modo: "destino_por_bucket",
			destinosPorBucket: { 1: 20, 2: 30 },
		}).success,
	).toBe(true);
});

// CB-114 (review): las cuentas fuera del funnel se excluían EN SILENCIO cuando
// no se mandaba `asesorDestinoEspecialId`, así que un asesor dado de baja
// seguía siendo el responsable de sus incobrables/cancelados sin avisar a nadie.
test("preview falla si hay cuentas especiales del origen sin destino especial", async () => {
  creditos = [
    { credito_id: 1, sifco: "S1", asesor_id: 10, bucket: 1, compromiso: false },
    { credito_id: 2, sifco: "S2", asesor_id: 10, bucket: null as never, compromiso: false,
      especial: true, estado: "CANCELADO" } as never,
  ];
  await expect(previsualizarTrasladoCarteraMasivo(entrada)).rejects.toThrow(
    /fuera del funnel/,
  );
});

test("preview procede cuando las cuentas especiales sí traen destino", async () => {
  creditos = [
    { credito_id: 1, sifco: "S1", asesor_id: 10, bucket: 1, compromiso: false },
    { credito_id: 2, sifco: "S2", asesor_id: 10, bucket: null as never, compromiso: false,
      especial: true, estado: "CANCELADO" } as never,
  ];
  const p = await previsualizarTrasladoCarteraMasivo({
    ...entrada,
    asesorDestinoEspecialId: 30,
  });
  expect(
    p.asignaciones.find((a) => a.numeroCreditoSifco === "S2"),
  ).toMatchObject({ asesorNuevoId: 30, bucket: null, estadoEspecial: "CANCELADO" });
});

// Sin especiales, la validación nueva no debe estorbar el camino normal.
test("preview sin cuentas especiales no exige destino especial", async () => {
  const p = await previsualizarTrasladoCarteraMasivo(entrada);
  expect(p.asignaciones.length).toBeGreaterThan(0);
});

// CB-114 (review): `actorEmail` viaja en el CUERPO (el CRM autentica con una
// credencial de servicio compartida, así que el token no identifica al
// supervisor). Es el único rastro de quién ordenó la operación y alimenta el
// usuario_id del historial: sin comprobarlo, un correo inexistente dejaba ese
// campo en NULL en silencio y la reasignación quedaba sin responsable.
test("rechaza un actor que no está en platform_users", async () => {
  actorRegistrado = false;
  await expect(previsualizarTrasladoCarteraMasivo(entrada)).rejects.toThrow(
    /no está registrado o está inactivo/,
  );
});

test("rechaza al confirmar si el actor se desactivó tras previsualizar", async () => {
  const p = await previsualizarTrasladoCarteraMasivo(entrada);
  actorRegistrado = false;
  await expect(
    confirmarTrasladoCarteraMasivo({
      previewId: p.previewId,
      idempotencyKey: crypto.randomUUID(),
      actorEmail: entrada.actorEmail,
    }),
  ).rejects.toThrow(/no está registrado o está inactivo/);
  expect(writes.some((q) => q.includes("credito_asesor_historial"))).toBe(false);
});
