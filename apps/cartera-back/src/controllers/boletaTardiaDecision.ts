import Big from "big.js";
import z from "zod";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "../database";
import { ajuste_fecha_ideal_pago, creditos, cuotas_credito, moras_credito, pagos_credito } from "../database/db";
import { getCoveredOpenInstallment, montoBoletaSchema } from "./registerPaymentPolicy";
import { cuotasParaPendienteDeCreditos, hoyGuatemala } from "./latefee";
import { cobrarRubrosParaBoleta } from "./rubros";
import {
  cuotaConCierreDiferidoNexa, cuotasQueCalificanBoletaTardia, decidirCondonacionBoletaTardia, disponibleParaCuotas,
  pagosPendientesVigentesNexa, saldoDeCuotaParaNexa, type RazonSinCondonacion,
} from "../utils/condonacionNexaATiempo";
import { fechaCalendarioGT, ymdDeFechaCalendario } from "../utils/fechaCalendarioGT";

export type EntradaBoletaTardia = {
  credito_id: number;
  monto_boleta: number | string;
  otros?: number | null;
  abono_directo_capital?: number | null;
  fecha_boleta: string; // tal como vino; la regla la valida
};
export type CuotaCondonadaBoletaTardia = { cuota_id: number; numero_cuota: number; fecha_vencimiento: string; monto: string }; // monto con 6 decimales (ledger)
export type DecisionBoletaTardiaCalculada = {
  aplica: boolean;
  razon: RazonSinCondonacion | "credito_no_encontrado" | null; // null si aplica
  /** Vencimiento más antiguo de las cuotas condonadas (o de las que calificaban, si razón = no_queda_al_dia | no_alcanza_mora). */
  fechaVencimiento: string | null;
  fechaBoleta: string;
  fechaRegistro: string; // hoy Guatemala, YYYY-MM-DD
  diasRetraso: number | null; // fechaRegistro − fechaVencimiento
  montoCondonar: string; // "0.00" si no aplica
  moraACobrar: string; // "0.00" si no aplica
  porCuota: CuotaCondonadaBoletaTardia[]; // [] si no aplica
  /** monto_mora leído; lo usa la Tarea 6.b como montoMoraEsperado. */
  moraActiva: string | null;
};
export type DepsDecisionBoletaTardia = {
  dbi: typeof db;
  cuotasParaPendiente: typeof cuotasParaPendienteDeCreditos;
  cobrarRubros: typeof cobrarRubrosParaBoleta;
  hoy: () => Date;
};
export type VistaPreviaBoletaTardia = Omit<DecisionBoletaTardiaCalculada, "moraActiva"> & { intentoId: string };

export class EntradaBoletaTardiaInvalida extends Error {}
// Mismas reglas de monto que /newPayment (pagoSchema), para no depender del orden de validación del llamador.
const entradaSchema = z.object({
  credito_id: z.number().int().positive(),
  monto_boleta: montoBoletaSchema.refine((v) => Number.isFinite(Number(v))),
  otros: z.number().min(0).finite().nullish(),
  abono_directo_capital: z.number().min(0).finite().nullish(),
});

const DIA_MS = 86_400_000;
const diasEntre = (a: string, b: string) => Math.round((fechaCalendarioGT(a) - fechaCalendarioGT(b)) / DIA_MS);

export const depsDecisionReales = (): DepsDecisionBoletaTardia => ({
  dbi: db, cuotasParaPendiente: cuotasParaPendienteDeCreditos, cobrarRubros: cobrarRubrosParaBoleta, hoy: () => hoyGuatemala(),
});

/**
 * Solo lectura. La usan la vista previa y (Tarea 6.b) el recálculo del servidor al registrar.
 * Lanza `EntradaBoletaTardiaInvalida` ante montos negativos o no numéricos.
 * Es conservadora: una cuota vencida abierta sin ninguna fila en pagos_credito (insertPayment la
 * deja fuera por su INNER JOIN) da `no_queda_al_dia`. 6.b NO puede quitar la verificación posterior
 * (`evaluarCreditoAlDia`): es la red ante cualquier otra divergencia con insertPayment.
 */
export async function calcularDecisionBoletaTardia(
  entrada: EntradaBoletaTardia,
  deps: DepsDecisionBoletaTardia = depsDecisionReales(),
): Promise<DecisionBoletaTardiaCalculada> {
  if (!entradaSchema.safeParse(entrada).success) throw new EntradaBoletaTardiaInvalida("Entrada inválida: monto o crédito inválido");
  const { dbi } = deps;
  const hoy = deps.hoy();
  const fechaRegistro = ymdDeFechaCalendario(hoy);
  const no = (razon: DecisionBoletaTardiaCalculada["razon"], extra: Partial<DecisionBoletaTardiaCalculada> = {}): DecisionBoletaTardiaCalculada => ({
    aplica: false, razon, fechaVencimiento: null, fechaBoleta: entrada.fecha_boleta, fechaRegistro, diasRetraso: null,
    montoCondonar: "0.00", moraACobrar: "0.00", porCuota: [], moraActiva: null, ...extra,
  });

  const [credito] = await dbi
    .select({ statusCredit: creditos.statusCredit, capital: creditos.capital, cuota: creditos.cuota })
    .from(creditos).where(eq(creditos.credito_id, entrada.credito_id)).limit(1);
  if (!credito) return no("credito_no_encontrado");
  const [mora] = await dbi
    .select({ monto: moras_credito.monto_mora })
    .from(moras_credito)
    .where(and(eq(moras_credito.credito_id, entrada.credito_id), eq(moras_credito.activa, true))).limit(1);
  const moraActiva = mora?.monto ?? null;

  // Sin mora o con un estado que no devenga: la regla pura da la razón, sin más lecturas.
  if (!["ACTIVO", "MOROSO"].includes(credito.statusCredit ?? "") || !moraActiva || new Big(moraActiva).lte(0)) {
    const d = decidirCondonacionBoletaTardia({
      statusCredit: credito.statusCredit, capital: credito.capital, moraActiva, cuotasConMora: [], cuotasAbiertas: [],
      monto: 0, hoy, rubrosPendientes: 0, ajusteFechaIdeal: null, fechaBoleta: entrada.fecha_boleta, vencimientoCuotaAnterior: new Map(),
    });
    return no(d.condonar ? null : d.razon, { moraActiva });
  }

  const conMora = (await deps.cuotasParaPendiente([entrada.credito_id], dbi, hoy)).get(entrada.credito_id);
  const todas = await dbi
    .select({ cuota_id: cuotas_credito.cuota_id, numero_cuota: cuotas_credito.numero_cuota,
              fecha_vencimiento: cuotas_credito.fecha_vencimiento, pagado: cuotas_credito.pagado })
    .from(cuotas_credito).where(eq(cuotas_credito.credito_id, entrada.credito_id)).orderBy(asc(cuotas_credito.numero_cuota));
  // Mismo dedupe que insertPayment: por numero_cuota gana el mayor cuota_id.
  const porNumero = (filas: typeof todas) => {
    const m = new Map<number, (typeof todas)[number]>();
    for (const c of filas) { const p = m.get(c.numero_cuota); if (!p || c.cuota_id > p.cuota_id) m.set(c.numero_cuota, c); }
    return m;
  };
  const abiertasTodas = todas.filter((c) => c.pagado === false && c.numero_cuota >= 1); // como insertPayment: sin la cuota 0
  const unicas = [...porNumero(abiertasTodas).values()];
  const infoCuota = new Map(todas.map((c) => [c.cuota_id, { numero: c.numero_cuota, venc: ymdDeFechaCalendario(c.fecha_vencimiento) }]));
  // Vencimiento de la cuota N−1; para la cuota 1 es la cuota 0 = fecha de desembolso (null si el crédito no la tiene).
  const venceNumero = porNumero(todas);
  const vencimientoCuotaAnterior = new Map<number, string | null>();
  for (const c of conMora?.cuotas ?? []) {
    const numero = infoCuota.get(c.cuota_id)?.numero;
    const previa = numero === undefined ? undefined : venceNumero.get(numero - 1);
    vencimientoCuotaAnterior.set(c.cuota_id, previa ? ymdDeFechaCalendario(previa.fecha_vencimiento) : null);
  }

  const pagos = unicas.length === 0 ? [] : await dbi
    .select({
      cuota_id: pagos_credito.cuota_id, pago_id: pagos_credito.pago_id, validationStatus: pagos_credito.validationStatus,
      paymentFalse: pagos_credito.paymentFalse, pagado: pagos_credito.pagado, fecha_pago: pagos_credito.fecha_pago,
      abono_capital: pagos_credito.abono_capital, abono_interes: pagos_credito.abono_interes, abono_iva_12: pagos_credito.abono_iva_12,
      abono_seguro: pagos_credito.abono_seguro, abono_gps: pagos_credito.abono_gps, membresias_pago: pagos_credito.membresias_pago,
      monto_aplicado: pagos_credito.monto_aplicado,
    })
    .from(pagos_credito)
    .where(and(eq(pagos_credito.credito_id, entrada.credito_id), inArray(pagos_credito.cuota_id, unicas.map((c) => c.cuota_id))));
  const [ajuste] = await dbi
    .select({ id: ajuste_fecha_ideal_pago.id, monto_total: ajuste_fecha_ideal_pago.monto_total })
    .from(ajuste_fecha_ideal_pago)
    .where(and(eq(ajuste_fecha_ideal_pago.credito_id, entrada.credito_id), isNull(ajuste_fecha_ideal_pago.fecha_cobro))).limit(1);

  const disponible = disponibleParaCuotas({ montoBoleta: entrada.monto_boleta, otros: entrada.otros, abonoDirectoCapital: entrada.abono_directo_capital });
  // SIN la red de `cobroRubrosSeguro` (traga el error y devuelve 0): con 0 se sobrestimaría lo que llega a las cuotas.
  const rubros = await deps.cobrarRubros({ credito_id: entrada.credito_id, disponible, ejecutor: dbi });

  const cuotasConMora = (conMora?.cuotas ?? []).flatMap((c) => {
    const fv = abiertasTodas.find((a) => a.cuota_id === c.cuota_id)?.fecha_vencimiento;
    return fv ? [{ ...c, fecha_vencimiento: ymdDeFechaCalendario(fv) }] : [];
  });
  const cuotasAbiertas = unicas.map((c) => {
    const pagosCuota = pagos.filter((p) => p.cuota_id === c.cuota_id);
    return {
      cuota_id: c.cuota_id, numero_cuota: c.numero_cuota, fecha_vencimiento: ymdDeFechaCalendario(c.fecha_vencimiento),
      saldo: saldoDeCuotaParaNexa(credito.cuota, pagosCuota, hoy),
      cierreDiferido: cuotaConCierreDiferidoNexa(pagosCuota),
      pagosPendientes: pagosPendientesVigentesNexa(pagosCuota, hoy),
    };
  });
  const decision = decidirCondonacionBoletaTardia({
    statusCredit: credito.statusCredit, capital: conMora?.capital ?? credito.capital, moraActiva, cuotasConMora, cuotasAbiertas,
    monto: disponible, hoy, rubrosPendientes: rubros.total, ajusteFechaIdeal: ajuste ?? null,
    fechaBoleta: entrada.fecha_boleta, vencimientoCuotaAnterior,
  });

  // insertPayment no paga una cuota abierta sin fila en pagos_credito: si está vencida, no queda al día.
  const sinFila = unicas.some((c) => ymdDeFechaCalendario(c.fecha_vencimiento) < fechaRegistro && !pagos.some((p) => p.cuota_id === c.cuota_id));
  // Misma guarda que insertPayment (409 CUOTA_INTEGRITY): una cuota abierta cuyos pagos validados ya la cubren rechaza el pago entero; no se condona para eso.
  const cubierta = getCoveredOpenInstallment({
    montoCuota: credito.cuota ?? 0,
    cuotas: unicas.map((c) => ({ cuotaId: c.cuota_id, numeroCuota: c.numero_cuota, pagos: pagos.filter((p) => p.cuota_id === c.cuota_id) })),
  });
  const razonFinal = decision.condonar ? (sinFila || cubierta ? "no_queda_al_dia" as const : null) : decision.razon;
  if (decision.condonar && razonFinal === null) {
    const porCuota = decision.cuotas.map((c) => ({
      cuota_id: c.cuota_id, numero_cuota: infoCuota.get(c.cuota_id)!.numero,
      fecha_vencimiento: infoCuota.get(c.cuota_id)!.venc, monto: c.monto.toFixed(6),
    }));
    const fechaVencimiento = porCuota.map((c) => c.fecha_vencimiento).sort()[0]!;
    return {
      aplica: true, razon: null, fechaVencimiento, fechaBoleta: entrada.fecha_boleta, fechaRegistro,
      diasRetraso: diasEntre(fechaRegistro, fechaVencimiento), montoCondonar: decision.monto.toFixed(2),
      moraACobrar: decision.moraACobrar.toFixed(2), porCuota, moraActiva,
    };
  }
  // A tiempo pero el pago no alcanza: el recuadro gris necesita las fechas de lo que SÍ calificaba.
  if (razonFinal === "no_queda_al_dia" || razonFinal === "no_alcanza_mora") {
    const calif = cuotasQueCalificanBoletaTardia({ cuotasConMora, cuotasAbiertas, fechaBoleta: entrada.fecha_boleta, hoy, vencimientoCuotaAnterior });
    const fechaVencimiento = calif.calificadas.map((c) => ymdDeFechaCalendario(c.fecha_vencimiento)).sort()[0] ?? null;
    return no(razonFinal, { fechaVencimiento, diasRetraso: fechaVencimiento ? diasEntre(fechaRegistro, fechaVencimiento) : null, moraActiva });
  }
  return no(razonFinal, { moraActiva });
}

export async function vistaPreviaBoletaTardia(entrada: EntradaBoletaTardia, deps?: DepsDecisionBoletaTardia): Promise<VistaPreviaBoletaTardia> {
  const { moraActiva: _omitida, ...vista } = await calcularDecisionBoletaTardia(entrada, deps);
  return { ...vista, intentoId: crypto.randomUUID() };
}
