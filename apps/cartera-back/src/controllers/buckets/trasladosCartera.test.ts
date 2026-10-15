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
let quedanCreditosEnOrigen: boolean;
/** `asesores.activo` del origen que lee la pausa del pool (ausencia o baja). */
let origenActivo = true;
const executor = {
  async execute(statement: SQL) {
    const { sql: query, params } = dialect.sqlToQuery(statement);
    queries.push(`${query} | ${JSON.stringify(params)}`);
    if (query.includes("´")) throw new Error("SQL contiene carácter inválido");
    if (query.includes("pg_advisory_xact_lock") && lockTimeout) {
      throw { cause: { code: "55P03" } };
    }
    if (query.includes("SELECT activo FROM")) return { rows: [{ activo: origenActivo }] };
    if (query.includes("WITH asignaciones")) {
      writes.push(query);
      const serializadas = params.find((param) => typeof param === "string" && param.startsWith("["));
      const cantidad = JSON.parse(serializadas as string).length;
      return { rows: updateMatches
        ? [{ actualizados: cantidad, historiales: cantidad, detalles: cantidad, restantes_origen: quedanCreditosEnOrigen ? 1 : 0 }]
        : [{ actualizados: 0, historiales: 0, detalles: 0, restantes_origen: 0 }] };
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
  saved = undefined; writes = []; queries = []; updateMatches = true; actorRegistrado = true; lockTimeout = false; quedanCreditosEnOrigen = false; origenActivo = true;
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
  const lockCreditos = queries.findIndex((q) => q.includes("pg_advisory_xact_lock") && q.includes("728195"));
  const lockFilasMora = queries.findIndex((q) => q.includes("FOR UPDATE OF m"));
  const lockFilasCredito = queries.findIndex((q) => q.includes("FOR UPDATE OF c"));
  const lockDestinos = queries.findIndex((q) => q.includes("FOR SHARE OF a, pool"));
  const escritura = queries.findIndex((q) => q.includes("WITH asignaciones"));
  expect(lockMoras).toBeGreaterThanOrEqual(0);
  expect(lockConvenio).toBeGreaterThanOrEqual(0);
  expect(escritura).toBeGreaterThanOrEqual(0);
  expect(lockMoras).toBeLessThan(escritura);
  expect(lockConvenio).toBeLessThan(escritura);
  expect(lockCreditos).toBeGreaterThan(lockConvenio);
  expect(lockCreditos).toBeLessThan(escritura);
  // Merge con develop: regla de candados del módulo de mora, `creditos`
  // antes que `moras_credito` (ver latefee.ts).
  expect(lockFilasCredito).toBeGreaterThan(lockCreditos);
  expect(lockFilasCredito).toBeLessThan(lockFilasMora);
  expect(lockFilasMora).toBeLessThan(escritura);
  expect(lockDestinos).toBeGreaterThan(lockCreditos);
  expect(lockDestinos).toBeLessThan(escritura);
  expect(queries.slice(lockCreditos + 1).some((q) => q.includes("SELECT c.credito_id"))).toBe(true);
  expect(writes[0]).toContain("estado_anterior text, compromiso_anterior boolean");
  expect(writes[0]).toContain("promesas_pago_espejo p");
  expect(writes[0]).toContain("IS NOT DISTINCT FROM a.compromiso_anterior");
  expect(writes[0]).toContain("restantes_origen AS");
  expect(writes[0]).toContain('c."statusCredit" IS NOT DISTINCT FROM a.estado_anterior');
  expect(writes[0]).toContain("LEFT JOIN cartera_cobros2.moras_credito m");
  expect(writes[0]).toContain("m.cuotas_atrasadas");
  expect(writes[0]).toContain("IS NOT DISTINCT FROM a.bucket");
  expect(writes[0]).toContain("FROM cartera_cobros2.asesores destino");
  expect(writes[0]).toContain("cartera_cobros2.asesor_bucket pool");
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

test("rechaza confirmación si entra un crédito nuevo al asesor origen", async () => {
  const p = await previsualizarTrasladoCarteraMasivo(entrada);
  quedanCreditosEnOrigen = true;
  await expect(confirmarTrasladoCarteraMasivo({
    previewId: p.previewId,
    idempotencyKey: crypto.randomUUID(),
    actorEmail: entrada.actorEmail,
  })).rejects.toThrow("propietario cambió");
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

test("reintento idempotente conserva éxito aunque actor se desactive después", async () => {
  const p = await previsualizarTrasladoCarteraMasivo(entrada);
  const input = {
    previewId: p.previewId,
    idempotencyKey: crypto.randomUUID(),
    actorEmail: entrada.actorEmail,
  };
  const primero = await confirmarTrasladoCarteraMasivo(input);
  actorRegistrado = false;
  await expect(confirmarTrasladoCarteraMasivo(input)).resolves.toEqual(primero);
});

// COBROS-02 · Baja de asesor: el reparto, la pausa del pool y la desactivación
// son UNA transacción; la previsualización y la confirmación tienen que coincidir.
const baja = { ...entrada, motivo: "Baja de asesor: Renuncia voluntaria", pausarPoolOrigen: true, desactivarOrigen: true };

test("contrato de la baja: exige pausar el pool y no conserva cuentas", () => {
  expect(solicitudTrasladoSchema.safeParse(baja).success).toBe(true);
  expect(solicitudTrasladoSchema.safeParse({ ...baja, pausarPoolOrigen: false }).success).toBe(false);
  expect(solicitudTrasladoSchema.safeParse({ ...baja, mantenerEspeciales: true }).success).toBe(false);
});

test("confirmar la baja reparte y desactiva al asesor en la misma operación", async () => {
  const p = await previsualizarTrasladoCarteraMasivo(baja);
  const input = { previewId: p.previewId, idempotencyKey: crypto.randomUUID(), actorEmail: baja.actorEmail, asesorOrigenId: 10, pausarPoolOrigen: true, desactivarOrigen: true };
  const r = await confirmarTrasladoCarteraMasivo(input);
  expect(r).toMatchObject({ success: true, cuentas: 1, desactivado: true });
  const desactiva = queries.findIndex((q) => q.includes("SET activo = false, activo_para_creditos = false"));
  const reparto = queries.findIndex((q) => q.includes("WITH asignaciones"));
  expect(reparto).toBeGreaterThan(-1);
  // Primero se mueve la cartera (y se comprueba que no le queda nada), luego se desactiva.
  expect(desactiva).toBeGreaterThan(reparto);
  expect(queries.some((q) => q.includes("platform_users SET is_active = false") && q.includes("'ASESOR'"))).toBe(true);
  expect(queries.some((q) => q.includes("SET solicitud = solicitud ||") && q.includes("desactivado"))).toBe(true);
  // Reintento con la misma clave: mismo resultado, sin escribir de nuevo.
  const escrituras = writes.length;
  await expect(confirmarTrasladoCarteraMasivo(input)).resolves.toEqual(r);
  expect(writes.length).toBe(escrituras);
});

test("una baja no se confirma como traslado normal ni al revés", async () => {
  const pBaja = await previsualizarTrasladoCarteraMasivo(baja);
  await expect(
    confirmarTrasladoCarteraMasivo({ previewId: pBaja.previewId, idempotencyKey: crypto.randomUUID(), actorEmail: baja.actorEmail }),
  ).rejects.toThrow(/Dar de baja/);
  const pNormal = await previsualizarTrasladoCarteraMasivo(entrada);
  await expect(
    confirmarTrasladoCarteraMasivo({ previewId: pNormal.previewId, idempotencyKey: crypto.randomUUID(), actorEmail: entrada.actorEmail, desactivarOrigen: true }),
  ).rejects.toThrow(/no incluye la baja/);
  expect(writes).toEqual([]);
});

test("un asesor sin cartera también se puede dar de baja", async () => {
  creditos = [20, 20, 30].map((asesor_id, i) => ({ credito_id: i + 1, sifco: `S${i + 1}`, asesor_id, bucket: 1, compromiso: false }));
  const p = await previsualizarTrasladoCarteraMasivo(baja);
  expect(p.asignaciones).toEqual([]);
  await expect(
    confirmarTrasladoCarteraMasivo({ previewId: p.previewId, idempotencyKey: crypto.randomUUID(), actorEmail: baja.actorEmail, desactivarOrigen: true }),
  ).resolves.toMatchObject({ cuentas: 0, desactivado: true });
});

test("la baja de un asesor ya desactivado se rechaza sin repartir", async () => {
  const p = await previsualizarTrasladoCarteraMasivo(baja);
  origenActivo = false;
  await expect(
    confirmarTrasladoCarteraMasivo({ previewId: p.previewId, idempotencyKey: crypto.randomUUID(), actorEmail: baja.actorEmail, desactivarOrigen: true }),
  ).rejects.toThrow(/ya está dado de baja/);
  expect(writes.some((q) => q.includes("WITH asignaciones"))).toBe(false);
});
