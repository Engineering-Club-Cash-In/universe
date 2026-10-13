import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db } from "../database";
import { asesores, convenio_cuotas, convenios_pago, creditos, platform_users } from "../database/db/schema";
import { CREDITO_ASESOR_LOCK_NAMESPACE } from "../lib/buckets-job-locks";
import {
  cuotaMensualDe,
  estadoDeConvenio,
  fechasDelPlan,
  motivoReprogramacionInvalida,
  primerPagoPosteriorAlConvenio,
  primerPagoDelPlan,
} from "../lib/convenio-plan";

export class ConvenioPlanError extends Error {
  constructor(
    message: string,
    public readonly httpStatus: number,
    public readonly code: string,
  ) {
    super(message);
    this.name = "ConvenioPlanError";
  }
}

const hoyGT = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Guatemala" }).format(new Date());

/**
 * COBROS-02 M4 · plan de pagos de un convenio en CUALQUIER estado (también el
 * pendiente de aprobación, que es el que el supervisor revisa). Cada cuota vale
 * `cuota_mensual`: la tabla no guarda monto por cuota.
 */
type Lector = Pick<typeof db, "select">;

async function leerPlan(lector: Lector, convenioId: number) {
  const [convenio] = await lector.select().from(convenios_pago).where(eq(convenios_pago.convenio_id, convenioId));
  if (!convenio) throw new ConvenioPlanError("El convenio no existe.", 404, "convenio_no_existe");
  const [[credito], [creador], cuotas] = await Promise.all([
    lector
      .select({ numero_credito_sifco: creditos.numero_credito_sifco })
      .from(creditos)
      .where(eq(creditos.credito_id, convenio.credito_id)),
    convenio.created_by
      ? lector.select({ email: platform_users.email }).from(platform_users).where(eq(platform_users.id, convenio.created_by))
      : Promise.resolve([] as { email: string }[]),
    lector
      .select()
      .from(convenio_cuotas)
      .where(eq(convenio_cuotas.convenio_id, convenioId))
      .orderBy(asc(convenio_cuotas.numero_cuota)),
  ]);
  const fechaConvenio = new Date(convenio.fecha_convenio as unknown as string | Date);
  return {
    convenio_id: convenio.convenio_id,
    credito_id: convenio.credito_id,
    numero_credito_sifco: credito?.numero_credito_sifco ?? null,
    /** Correo del asesor que armó el convenio (platform_users.created_by). */
    creado_por_email: creador?.email ?? null,
    estado: estadoDeConvenio(convenio),
    monto_total_convenio: convenio.monto_total_convenio,
    numero_meses: convenio.numero_meses,
    cuota_mensual: convenio.cuota_mensual,
    fecha_convenio: fechaConvenio.toISOString(),
    primer_pago: primerPagoDelPlan(cuotas, fechaConvenio),
    cuotas: cuotas.map((c) => ({
      numero_cuota: c.numero_cuota,
      fecha_vencimiento: c.fecha_vencimiento,
      fecha_pago: c.fecha_pago ? new Date(c.fecha_pago).toISOString() : null,
      monto: convenio.cuota_mensual,
    })),
  };
}

/**
 * Convenio y cuotas salen de UNA lectura consistente (transacción de solo
 * lectura con snapshot): con sentencias sueltas, una reprogramación que se
 * confirma entre ellas devolvía el número de cuotas viejo con el primer pago
 * nuevo, o un convenio borrado sin cuotas, y el CRM guardaba ese plan que
 * nunca existió como el «original» de una contrapropuesta.
 */
export async function getPlanConvenio(convenioId: number) {
  return db.transaction((tx) => leerPlan(tx, convenioId), {
    isolationLevel: "repeatable read",
    accessMode: "read only",
  });
}

/**
 * COBROS-02 M4 · contrapropuesta aceptada: reprograma un convenio PENDIENTE de
 * aprobación (número de cuotas y fecha del primer pago). El total del convenio
 * no cambia; la cuota mensual se recalcula. Las cuotas del crédito que el
 * convenio reestructuró (`cuotas_convenio`) y los pagos asociados no se tocan.
 * Un convenio activo, completado o deshecho no se reprograma.
 */
export async function reprogramarConvenioPendiente(params: {
  convenioId: number;
  numeroMeses: number;
  primerPago: string;
  actorEmail: string;
  /**
   * Correo del asesor que debe llevar el crédito AHORA. Lo manda el CRM cuando
   * quien reprograma es el asesor que acepta una contrapropuesta: se vuelve a
   * leer acá, dentro del candado del convenio, porque el crédito pudo
   * reasignarse después de que el CRM autorizó la petición.
   */
  asesorEmail?: string;
}) {
  const motivo = motivoReprogramacionInvalida({
    meses: params.numeroMeses,
    primerPago: params.primerPago,
    hoy: hoyGT(),
  });
  if (motivo) throw new ConvenioPlanError(motivo, 400, "plan_invalido");

  await db.transaction(async (tx) => {
    // Si hay que confirmar el asesor, primero el candado del crédito (el mismo
    // que toman las reasignaciones antes de cambiar `asesor_id`) y después la
    // fila del convenio: es el orden de `anularConvenio`, así no hay interbloqueo.
    // El crédito del convenio no cambia, por eso se puede leer antes de bloquear.
    if (params.asesorEmail) {
      const [previo] = await tx
        .select({ credito_id: convenios_pago.credito_id })
        .from(convenios_pago)
        .where(eq(convenios_pago.convenio_id, params.convenioId));
      if (previo) {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(${CREDITO_ASESOR_LOCK_NAMESPACE}, ${previo.credito_id})`);
      }
    }
    // Candado de fila: una decisión concurrente espera y luego ve el plan nuevo.
    const [convenio] = await tx
      .select()
      .from(convenios_pago)
      .where(eq(convenios_pago.convenio_id, params.convenioId))
      .for("update");
    if (!convenio) throw new ConvenioPlanError("El convenio no existe.", 404, "convenio_no_existe");
    if (estadoDeConvenio(convenio) !== "pendiente") {
      throw new ConvenioPlanError(
        "Solo se puede reprogramar un convenio pendiente de aprobación.",
        409,
        "convenio_no_pendiente",
      );
    }
    if (params.asesorEmail) {
      const [dueno] = await tx
        .select({ email: asesores.emailCashIn })
        .from(creditos)
        .innerJoin(asesores, eq(asesores.asesor_id, creditos.asesor_id))
        .where(eq(creditos.credito_id, convenio.credito_id));
      if (dueno?.email?.trim().toLowerCase() !== params.asesorEmail.trim().toLowerCase()) {
        throw new ConvenioPlanError(
          "El crédito ya no lo lleva este asesor: no puede reprogramar su convenio.",
          409,
          "asesor_no_coincide",
        );
      }
    }
    // Idempotente: si el plan ya es este (una llamada anterior se aplicó pero su
    // respuesta se perdió), no se reescribe ni se anota otra vez.
    const [primera] = await tx
      .select({ fecha: convenio_cuotas.fecha_vencimiento })
      .from(convenio_cuotas)
      .where(eq(convenio_cuotas.convenio_id, params.convenioId))
      .orderBy(asc(convenio_cuotas.numero_cuota))
      .limit(1);
    if (convenio.numero_meses === params.numeroMeses && primera && String(primera.fecha).slice(0, 10) === params.primerPago) {
      return;
    }
    // Se vuelve a validar con la fecha de AHORA: la primera validación fue antes
    // de esperar los candados, y si la espera cruzó la medianoche de Guatemala un
    // primer pago "de hoy" ya sería del pasado.
    const motivoAhora = motivoReprogramacionInvalida({
      meses: params.numeroMeses,
      primerPago: params.primerPago,
      hoy: hoyGT(),
    });
    if (motivoAhora) throw new ConvenioPlanError(motivoAhora, 400, "plan_invalido");
    if (!primerPagoPosteriorAlConvenio(params.primerPago, convenio.fecha_convenio as unknown as string | Date)) {
      throw new ConvenioPlanError(
        "El primer pago debe ser posterior al día en que se firmó el convenio.",
        400,
        "plan_invalido",
      );
    }
    const total = Number(convenio.monto_total_convenio);
    const cuota = cuotaMensualDe(total, params.numeroMeses);
    const anotacion = `Plan reprogramado a ${params.numeroMeses} cuotas con primer pago el ${params.primerPago} (${params.actorEmail}, ${hoyGT()}).`;
    await tx
      .update(convenios_pago)
      .set({
        numero_meses: params.numeroMeses,
        cuota_mensual: cuota.toFixed(2),
        pagos_pendientes: params.numeroMeses,
        observaciones: convenio.observaciones ? `${convenio.observaciones}\n${anotacion}` : anotacion,
        updated_at: new Date(),
      })
      .where(
        and(
          eq(convenios_pago.convenio_id, params.convenioId),
          eq(convenios_pago.activo, false),
          eq(convenios_pago.completado, false),
          isNull(convenios_pago.anulado_at),
        ),
      );
    await tx.delete(convenio_cuotas).where(eq(convenio_cuotas.convenio_id, params.convenioId));
    await tx.insert(convenio_cuotas).values(
      fechasDelPlan(params.primerPago, params.numeroMeses).map((fecha, i) => ({
        convenio_id: params.convenioId,
        numero_cuota: i + 1,
        fecha_vencimiento: fecha,
        fecha_pago: null,
      })),
    );
  });
  return getPlanConvenio(params.convenioId);
}
