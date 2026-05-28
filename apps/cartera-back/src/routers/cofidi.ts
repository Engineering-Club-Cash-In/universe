// src/controllers/dte.controller.ts

import { Elysia, t } from "elysia";
import jwt from "jsonwebtoken";
import { authMiddleware } from "./midleware";
import { SATClientService } from "../cofidi/satClientService";
import { DTEService } from "../cofidi/dteService";
import { generarHTMLFacturaPro } from "../cofidi/functions";
import { db } from "../database";
import {
  compras_credito_inversionista,
  credit_cancelations,
  creditos,
  creditos_inversionistas,
  creditos_inversionistas_espejo,
  cuotas_credito,
  facturas_electronicas,
  inversionistas,
  pagos_credito,
  pagos_credito_inversionistas,
  usuarios,
} from "../database/db";
import { eq, desc, and, sql, gte, lte, inArray } from "drizzle-orm";
import ExcelJS from "exceljs";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { NITSoapClient } from "../cofidi/nitGenerator";
import type { DTERequest } from "../cofidi/types";
import {
  SAT_CONFIG,
  CLUB_CASHIN_CONFIG,
  COFIDI_CONFIG,
  getInversionistaFacturadorConfig,
  SE_PRESTA_CONFIG,
  SE_PRESTA_SAT_CONFIG,
  AMJK_CONFIG,
  AMJK_SAT_CONFIG,
  CREACION_IMAGEN_CONFIG,
  CREACION_IMAGEN_SAT_CONFIG,
  GRUPO_BATRO_CONFIG,
  GRUPO_BATRO_SAT_CONFIG,
  AUTOCASH_CONFIG,
  AUTOCASH_SAT_CONFIG,
} from "../utils/functions/const";

// 🔥 Mapa de emisores disponibles para facturar
const EMISORES_CONFIG = {
  CUBE: { config: CLUB_CASHIN_CONFIG, satConfig: SAT_CONFIG },
  SE_PRESTA: { config: SE_PRESTA_CONFIG, satConfig: SE_PRESTA_SAT_CONFIG },
  AMJK: { config: AMJK_CONFIG, satConfig: AMJK_SAT_CONFIG },
  CREACION_IMAGEN: { config: CREACION_IMAGEN_CONFIG, satConfig: CREACION_IMAGEN_SAT_CONFIG },
  GRUPO_BATRO: { config: GRUPO_BATRO_CONFIG, satConfig: GRUPO_BATRO_SAT_CONFIG },
  AUTOCASH: { config: AUTOCASH_CONFIG, satConfig: AUTOCASH_SAT_CONFIG },
} as const;

type EmisorKey = keyof typeof EMISORES_CONFIG;
type FacturadorConfig = Pick<DTERequest, "emisor" | "tipoDocumento" | "codigoMoneda" | "frases">;
type FacturarGenericoItem = {
  monto: number;
  rubro: string;
};

// 🔥 Mapa inverso: NIT emisor → config (para anulación automática)
const EMISOR_POR_NIT: Record<string, { config: typeof CLUB_CASHIN_CONFIG; satConfig: typeof SAT_CONFIG }> = {};
for (const [, value] of Object.entries(EMISORES_CONFIG)) {
  EMISOR_POR_NIT[value.config.emisor.nit] = value as any;
}

const JWT_SECRET = process.env.JWT_SECRET || "supersecreto";

function generarIdInternoRandom(): string {
  return Math.floor(10000000 + Math.random() * 90000000).toString();
}


export const dteController = new Elysia({ prefix: "/api/dte" })
  .use(authMiddleware)

  // 🔥 POST - Certificar DTE
  // ========================================================================
  // FLUJO GENERAL DE /facturar-pago-completo
  // ------------------------------------------------------------------------
  //  0️⃣  PRE-VALIDACIÓN: verifica que el pago NO tenga ya facturas ACTIVAS
  //  1️⃣  OBTENER DATOS DEL PAGO  (incluye cuotas_atrasadas para cancelaciones)
  //  2️⃣  OBTENER INVERSIONISTAS + CALCULAR PARTICIPACIÓN POR CADA UNO
  //        - Pago normal   → base = monto_aportado
  //        - Pago "reset"  → base = cuota_inversionista (mayor: se le restan
  //                          seguro+membresía+gps por cuota)
  //  3️⃣  CONSTRUIR RECEPTOR  (NIT, consulta SAT, dirección)
  //  4️⃣  FACTURA DE MORA                (si mora > 0)
  //  5️⃣  FACTURA DE OTROS SERVICIOS     (seguro + gps + membresía en 1 factura)
  //  5.5️⃣ FACTURA DE OTROS              (garantía/traspaso/extras en 1 factura)
  //  6️⃣  FACTURAS DE INTERESES         (1 por cada inversionista no-Cube + 1 para Cube por residuo)
  //  7️⃣  RESPUESTA FINAL
  // ========================================================================
.post(
  "/facturar-pago-completo",
  async ({ body, set }) => {
    try {
      const { pago_id, created_by } = body;

      // ============================================
      // 0️⃣ PRE-VALIDACIÓN: ¿ya existen facturas ACTIVAS para este pago?
      //    - Si sí → aborta (no permitir doble facturación)
      // ============================================
const facturasExistentes = await db
  .select({
    factura_id: facturas_electronicas.factura_id,
    status: facturas_electronicas.status,
    tipo_documento: facturas_electronicas.tipo_documento,
    serie: facturas_electronicas.serie,
    numero: facturas_electronicas.numero,
    uuid: facturas_electronicas.uuid,
  })
  .from(facturas_electronicas)
  .where(
    and(
      eq(facturas_electronicas.pago_id, pago_id),
      eq(facturas_electronicas.status, "ACTIVA") // 👈 Solo ACTIVAS
    )
  );

if (facturasExistentes.length > 0) {
  console.log("⚠️ Este pago ya tiene facturas activas:", facturasExistentes);
  set.status = 400;
  return {
    success: false,
    message: "Este pago ya tiene facturas electrónicas activas. No se puede volver a facturar.",
    facturasExistentes: facturasExistentes.map(f => ({
      id: f.factura_id,
      tipo: f.tipo_documento,
      serie: f.serie,
      numero: f.numero,
      uuid: f.uuid,
      status: f.status
    }))
  };
}

      console.log("🔥 ========== FACTURANDO PAGO COMPLETO ==========");
      console.log(`📝 Pago ID: ${pago_id} | Usuario: ${created_by || "N/A"}`);

      // ============================================
      // 1️⃣ OBTENER DATOS COMPLETOS DEL PAGO
      //    - JOIN pagos_credito + creditos + usuarios + credit_cancelations
      //    - credit_cancelations es LEFT JOIN: solo trae data si el crédito
      //      está cancelado (necesario para dividir por cuotas_atrasadas)
      //    - Valida que el status del pago sea "validated" | "reset" | "capital"
      // ============================================
      const [pagoData] = await db
        .select({
          pago_id: pagos_credito.pago_id,
          credito_id: pagos_credito.credito_id,
          cuota_id: pagos_credito.cuota_id,
          monto_boleta: pagos_credito.monto_boleta,
          fecha_pago: pagos_credito.fecha_pago,
          fecha_vencimiento: pagos_credito.fecha_vencimiento,
          validationStatus: pagos_credito.validationStatus,

          abono_seguro: pagos_credito.abono_seguro,
          abono_gps: pagos_credito.abono_gps,
          membresias_pago: pagos_credito.membresias_pago,
          mora: pagos_credito.mora,
          otros: pagos_credito.otros,

          abono_interes: pagos_credito.abono_interes,
          abono_iva_12: pagos_credito.abono_iva_12,

          capital_credito: creditos.capital,
          bandera_reinversion: creditos.bandera_reinversion,

          usuario_id: usuarios.usuario_id,
          nombre: usuarios.nombre,
          nit: usuarios.nit,
          direccion: usuarios.direccion,
          municipio: usuarios.municipio,
          departamento: usuarios.departamento,
          codigo_postal: usuarios.codigo_postal,
          pais: usuarios.pais,

          cuotas_atrasadas: credit_cancelations.cuotas_atrasadas,
        })
        .from(pagos_credito)
        .innerJoin(
          creditos,
          eq(pagos_credito.credito_id, creditos.credito_id)
        )
        .innerJoin(usuarios, eq(creditos.usuario_id, usuarios.usuario_id))
        .leftJoin(
          credit_cancelations,
          eq(credit_cancelations.credit_id, creditos.credito_id)
        )
        .where(eq(pagos_credito.pago_id, pago_id));

      if (!pagoData) {
        set.status = 404;
        return { success: false, error: "Pago no encontrado" };
      }

      if (
        pagoData.validationStatus !== "validated" &&
        pagoData.validationStatus !== "reset" &&
        pagoData.validationStatus !== "capital"
      ) {
        set.status = 400;
        console.error(
          `❌ Pago no validado - Status: ${pagoData.validationStatus}`
        );
        return {
          success: false,
          error: "El pago debe estar validado antes de facturar",
          current_status: pagoData.validationStatus,
          pago_id: pago_id,
        };
      }

      console.log(`✅ Pago VALIDADO - Cliente: ${pagoData.nombre}`);

      // ============================================
      // 2️⃣ OBTENER INVERSIONISTAS DEL CRÉDITO + CALCULAR PARTICIPACIÓN
      //    a) SELECT de todos los inversionistas del crédito (con LEFT JOIN al espejo
      //       para saber si su status es pendiente_reinversion / pendiente_compra_cartera)
      //    b) Calcular la BASE de reparto según el tipo de pago:
      //         - validated/capital → base = monto_aportado
      //         - reset (cancelación) → base = cuota_inversionista,
      //           restando seguro+membresía+gps por cuota al MAYOR
      //           (el mayor es quien tiene la cuota_inversionista más alta,
      //            porque al crear el crédito se le sumaron esos cargos)
      //    c) participacion_real = base / SUM(base)
      //    d) interes_proporcional = (abono_interes + abono_iva_12) × participacion_real
      // ============================================
      const BigJs = (await import("big.js")).default;
      BigJs.DP = 20;
      BigJs.RM = BigJs.roundHalfUp;

      const inversionistasDelCredito = await db
        .select({
          inversionista_id: inversionistas.inversionista_id,
          nombre: inversionistas.nombre,
          emite_factura: inversionistas.emite_factura,
          porcentaje_participacion: creditos_inversionistas.porcentaje_participacion_inversionista,
          porcentaje_cash_in: creditos_inversionistas.porcentaje_cash_in,
          cuota_inversionista: creditos_inversionistas.cuota_inversionista,
          monto_aportado: creditos_inversionistas.monto_aportado,
          monto_inversionista: creditos_inversionistas.monto_inversionista,
          iva_inversionista: creditos_inversionistas.iva_inversionista,
          status_espejo: creditos_inversionistas_espejo.status,
          monto_aportado_espejo: creditos_inversionistas_espejo.monto_aportado,
          fecha_inicio_participacion_espejo: creditos_inversionistas_espejo.fecha_inicio_participacion,
        })
        .from(creditos_inversionistas)
        .innerJoin(
          inversionistas,
          eq(
            creditos_inversionistas.inversionista_id,
            inversionistas.inversionista_id
          )
        )
        .leftJoin(
          creditos_inversionistas_espejo,
          and(
            eq(
              creditos_inversionistas_espejo.credito_id,
              creditos_inversionistas.credito_id
            ),
            eq(
              creditos_inversionistas_espejo.inversionista_id,
              creditos_inversionistas.inversionista_id
            )
          )
        )
        .where(eq(creditos_inversionistas.credito_id, pagoData.credito_id!));

      // ============================================
      // 🆕 NUEVO FLUJO: Detectar operaciones pendientes de facturar
      //
      // ¿Qué busca este query?
      //   Filas en `compras_credito_inversionista` (operaciones de compra de
      //   cartera o reinversión) que pertenezcan a este crédito y que tengan
      //   `pendiente_facturar = true`.
      //
      //   Esa flag se marca en `true` cuando se acepta una compra/reinversión
      //   y todavía NO se ha facturado el primer pago bajo la nueva
      //   distribución de inversionistas. Mientras la flag siga en `true`,
      //   este endpoint usa el FLUJO PRORRATEADO para repartir el interés
      //   entre "antes" (vieja distribución) y "después" (nueva distribución).
      //
      // Ejemplo:
      //   El 15 de mayo Juan compró el 50% del crédito que era 100% de CUBE.
      //   Se crea la fila:
      //     compras_credito_inversionista {
      //       credito_id: 123, inversionista_id: Juan,
      //       monto_aportado: 5000, tipo_operacion: "compra_cartera",
      //       pendiente_facturar: true
      //     }
      //   El próximo pago del crédito (ej. cuota de mayo) entra a este nuevo
      //   flujo y se reparte el interés prorrateado por día del mes:
      //     • Días 1-15  → CUBE tenía 100% del crédito
      //     • Días 16-30 → CUBE 50% + Juan 50%
      //   Si la cuota queda PAGADA al final → la flag pasa a `false` y los
      //   siguientes pagos ya usan el flujo normal (sin prorrateo).
      // ============================================
      const operacionesPendientesFacturar = await db
        .select({
          id: compras_credito_inversionista.id,
          credito_id: compras_credito_inversionista.credito_id,
          inversionista_id: compras_credito_inversionista.inversionista_id,
          monto_aportado: compras_credito_inversionista.monto_aportado,
          tipo_operacion: compras_credito_inversionista.tipo_operacion,
          tipo_reinversion: compras_credito_inversionista.tipo_reinversion,
          status: compras_credito_inversionista.status,
          fecha: compras_credito_inversionista.fecha,
          fecha_completada: compras_credito_inversionista.fecha_completada,
        })
        .from(compras_credito_inversionista)
        .where(
          and(
            eq(compras_credito_inversionista.credito_id, pagoData.credito_id!),
            eq(compras_credito_inversionista.pendiente_facturar, true)
          )
        );

      const tieneOperacionesPendientesFacturar = operacionesPendientesFacturar.length > 0;

      if (tieneOperacionesPendientesFacturar) {
        console.log(
          `\n🆕 NUEVO FLUJO DETECTADO: crédito ${pagoData.credito_id} tiene ${operacionesPendientesFacturar.length} operación(es) pendiente(s) de facturar`
        );
        for (const op of operacionesPendientesFacturar) {
          console.log(
            `   📋 op id=${op.id} | inv=${op.inversionista_id} | tipo=${op.tipo_operacion}${op.tipo_reinversion ? `/${op.tipo_reinversion}` : ""} | monto=Q${op.monto_aportado} | status=${op.status}`
          );
        }
      }

      // 🔥 VALIDACIÓN: porcentaje_participacion + porcentaje_cash_in debe sumar 100% por inversionista.
      //    Si no suma 100, el remanente NO se factura a nadie (cashInAcumulado solo captura pct_cash_in,
      //    y totalInteresesNoCube resta el interes_proporcional completo del residuo CUBE).
      //    Tolerancia de 0.01% por redondeos al crear el crédito.
      const inversionistasMalConfigurados = inversionistasDelCredito
        .map((inv) => {
          const pctInv = new BigJs(inv.porcentaje_participacion || "0");
          const pctCashIn = new BigJs(inv.porcentaje_cash_in || "0");
          const suma = pctInv.plus(pctCashIn);
          return { inv, pctInv, pctCashIn, suma };
        })
        .filter(({ suma }) => suma.minus(100).abs().gt("0.01"));

      if (inversionistasMalConfigurados.length > 0) {
        set.status = 400;
        const detalle = inversionistasMalConfigurados.map(({ inv, pctInv, pctCashIn, suma }) => ({
          inversionista_id: inv.inversionista_id,
          inversionista: inv.nombre,
          pct_participacion: pctInv.toString(),
          pct_cash_in: pctCashIn.toString(),
          suma: suma.toString(),
          diferencia_vs_100: suma.minus(100).toString(),
        }));
        console.error(`❌ Inversionistas con porcentajes que no suman 100%:`, detalle);
        return {
          success: false,
          error: "Configuración inválida: porcentaje_participacion + porcentaje_cash_in debe sumar 100% por inversionista",
          detalle,
          sugerencia: "Revise creditos_inversionistas para este crédito y ajuste los porcentajes antes de facturar",
          pago_id,
          credito_id: pagoData.credito_id,
        };
      }

      // 🔥 Calcular participación real
      // - Cancelación (validationStatus = "reset"): cuota_inversionista / suma_total_cuotas,
      //   restando seguro + membresía + GPS por cuota al inversionista MAYOR
      //   (ese inversionista trae esos cargos sumados en su cuota_inversionista al crear el crédito)
      // - Resto: monto_aportado / suma_total_aportes
      const esCancelacion = pagoData.validationStatus === "reset";

      const totalInteresesConIva = new BigJs(pagoData.abono_interes || "0")
        .plus(new BigJs(pagoData.abono_iva_12 || "0"));

      // 🔥 En cancelación: identificar al MAYOR (máxima cuota_inversionista)
      //    y calcular los cargos por cuota (seguro/membresía/gps) dividiendo entre cuotas_atrasadas
      let mayorInversionistaId: number | null = null;
      let cargosPorCuota = new BigJs(0);

      if (esCancelacion) {
        const n = new BigJs(pagoData.cuotas_atrasadas || 1);
        const nSafe = n.gt(0) ? n : new BigJs(1);

        const seguroPorCuota = new BigJs(pagoData.abono_seguro || "0").div(nSafe);
        const membresiaPorCuota = new BigJs(pagoData.membresias_pago || "0").div(nSafe);
        const gpsPorCuota = new BigJs(pagoData.abono_gps || "0").div(nSafe);
        cargosPorCuota = seguroPorCuota.plus(membresiaPorCuota).plus(gpsPorCuota);

        const mayor = inversionistasDelCredito.reduce((max, inv) => {
          const cuotaInv = new BigJs(inv.cuota_inversionista || "0");
          return cuotaInv.gt(new BigJs(max.cuota_inversionista || "0")) ? inv : max;
        }, inversionistasDelCredito[0]);
        mayorInversionistaId = mayor?.inversionista_id ?? null;

        console.log(`   🏆 Mayor (cancelación): inv ${mayorInversionistaId} | cuotas_atrasadas=${nSafe.toFixed(0)} | cargosPorCuota=Q${cargosPorCuota.toFixed(2)} (seguro Q${seguroPorCuota.toFixed(2)} + membresía Q${membresiaPorCuota.toFixed(2)} + gps Q${gpsPorCuota.toFixed(2)})`);
      }

      const getBaseInv = (inv: typeof inversionistasDelCredito[number]) => {
        if (!esCancelacion) return new BigJs(inv.monto_aportado || "0");
        const cuota = new BigJs(inv.cuota_inversionista || "0");
        if (inv.inversionista_id !== mayorInversionistaId) return cuota;

        // 🔥 VALIDACIÓN: si cargosPorCuota > cuota, la base saldría negativa
        // (participación negativa rompe el reparto). Se ajusta a 0 y se avisa.
        const base = cuota.minus(cargosPorCuota);
        if (base.lt(0)) {
          console.warn(`⚠️  Base negativa para inversionista mayor "${inv.nombre}" (id ${inv.inversionista_id}): cuota Q${cuota.toFixed(2)} - cargosPorCuota Q${cargosPorCuota.toFixed(2)} = Q${base.toFixed(2)}. Se ajusta a 0 — revise cuotas_atrasadas vs cuota_inversionista del crédito ${pagoData.credito_id}.`);
          return new BigJs(0);
        }
        return base;
      };

      const totalBase = inversionistasDelCredito.reduce(
        (sum, inv) => sum.plus(getBaseInv(inv)),
        new BigJs(0)
      );

      console.log(`   💰 Suma total ${esCancelacion ? "cuotas inversionistas limpias (cancelación)" : "aportes inversionistas"}: Q${totalBase.toFixed(2)}`);
      console.log(`   💰 Total intereses + IVA del pago: Q${totalInteresesConIva.toFixed(2)}`);

      const inversionistasDelPago = inversionistasDelCredito.map((inv) => {
        const base = getBaseInv(inv);
        const participacion = totalBase.gt(0)
          ? base.div(totalBase)
          : new BigJs(0);
        const interesProporcional = totalInteresesConIva.times(participacion).round(2).toString();

        const etiqueta = esCancelacion
          ? (inv.inversionista_id === mayorInversionistaId ? "cuota limpia (mayor)" : "cuota")
          : "aportó";
        console.log(`   📊 ${inv.nombre}: ${etiqueta} Q${base.toFixed(2)} / Q${totalBase.toFixed(2)} = ${participacion.times(100).toFixed(2)}% → interés Q${interesProporcional}`);

        return {
          ...inv,
          participacion_real: participacion.toString(),
          interes_proporcional: interesProporcional,
        };
      });

      console.log(
        `📊 ${inversionistasDelPago.length} inversionistas encontrados para crédito ${pagoData.credito_id}`
      );

      // ============================================
      // 3️⃣ CONSTRUIR RECEPTOR (cliente al que se le factura)
      //    - Normalizar país a ISO (SAT no acepta "GUATEMALA", requiere "GT")
      //    - Extraer NITs (pueden venir separados por "/")
      //    - Si no hay NIT → falla (NO usa "CF" por política)
      //    - Consultar nombre oficial en SAT vía COFIDI (con fallback al del sistema)
      // ============================================
      // 🔥 Normalizar país a código ISO (GT) - SAT no acepta "GUATEMALA"
      const normalizarPais = (pais: string | null | undefined): string => {
        if (!pais) return "GT";
        const paisUpper = pais.trim().toUpperCase();
        if (paisUpper === "GUATEMALA" || paisUpper === "GTM") return "GT";
        return pais;
      };

      // 🔥 Extraer todos los NITs disponibles (separados por /)
      const nitsDisponibles = pagoData.nit
        ? pagoData.nit.split('/').map((n: string) => n.trim().replace(/-/g, '')).filter((n: string) => n.length > 0)
        : [];

      // 🔥 Si el cliente NO tiene NIT registrado → FALLAR (NO usar "CF")
      if (nitsDisponibles.length === 0) {
        set.status = 400;
        console.error(`❌ Cliente sin NIT registrado - Pago ID: ${pago_id}`);
        return {
          success: false,
          error: `El cliente "${pagoData.nombre}" no tiene NIT registrado. No se puede facturar sin un NIT válido.`,
          pago_id: pago_id,
        };
      }

      const nitReceptor = nitsDisponibles[0];

      // 🔥 Consultar nombre del receptor en SAT via COFIDI
      let nombreReceptor = pagoData.nombre
        ? pagoData.nombre.split('/')[0].trim()
        : "CONSUMIDOR FINAL";

      if (nitReceptor && nitReceptor !== "CF") {
        try {
          const nitClient = new NITSoapClient(COFIDI_CONFIG.endpointUrl);
          const resultadoNit = await nitClient.consultarNIT({
            nit: nitReceptor,
            entity: COFIDI_CONFIG.entity,
            requestor: COFIDI_CONFIG.requestor,
          });

          if (resultadoNit.success && resultadoNit.nombre) {
            nombreReceptor = resultadoNit.nombre;
            console.log(`✅ NIT receptor encontrado en SAT: ${nombreReceptor}`);
          } else {
            console.log(`⚠️ NIT no encontrado en SAT, usando nombre del sistema: ${nombreReceptor}`);
          }
        } catch (nitError) {
          console.error("❌ Error consultando NIT del receptor:", nitError);
        }
      }

      const receptor = {
        idReceptor: nitReceptor,
        nombreReceptor: nombreReceptor,
        direccion: pagoData.direccion
          ? {
              direccion: pagoData.direccion,
              codigoPostal: pagoData.codigo_postal || "01001",
              municipio: pagoData.municipio || "Guatemala",
              departamento: pagoData.departamento || "Guatemala",
              pais: normalizarPais(pagoData.pais),
            }
          : undefined,
      };

      const facturasGeneradas = [];
      const Big = (await import("big.js")).default;
      Big.DP = 20;
      Big.RM = Big.roundHalfUp;

      // 🔍 DEBUG: Ver qué valores tiene el pago
      console.log("\n🔍 ========== DEBUG VALORES DEL PAGO ==========");
      console.log(`   📦 mora: "${pagoData.mora}" (tipo: ${typeof pagoData.mora})`);
      console.log(`   📦 abono_seguro: "${pagoData.abono_seguro}" (tipo: ${typeof pagoData.abono_seguro})`);
      console.log(`   📦 abono_gps: "${pagoData.abono_gps}" (tipo: ${typeof pagoData.abono_gps})`);
      console.log(`   📦 membresias_pago: "${pagoData.membresias_pago}" (tipo: ${typeof pagoData.membresias_pago})`);
      console.log(`   📦 abono_interes: "${pagoData.abono_interes}"`);
      console.log(`   📦 abono_iva_12: "${pagoData.abono_iva_12}"`);
      console.log("===============================================\n");

      // ============================================
      // 🔥 HELPER: calcularIvaExacto
      //    - Recibe un total con IVA incluido
      //    - Devuelve { precioUnitario, precio, montoGravable, montoImpuesto, total }
      //    - Ajusta la base si hay diferencia de centavos para que base+IVA = total
      // ============================================
      const calcularIvaExacto = (totalConIva: number) => {
        const Big = require("big.js");
        Big.DP = 20;
        Big.RM = Big.roundHalfUp;

        const total = new Big(totalConIva);
        
        // Calcular base (precio / 1.12)
        const montoGravable = total.div("1.12").round(2, Big.roundHalfUp);
        
        // Calcular IVA desde la base (base * 0.12)
        const montoImpuesto = montoGravable.times("0.12").round(2, Big.roundHalfUp);
        
        // Verificar que base + IVA = total
        const totalCalculado = montoGravable.plus(montoImpuesto);
        const diferencia = total.minus(totalCalculado);
        
        let montoGravableFinal = montoGravable;
        
        // Si hay diferencia de centavos, ajustar la base
        if (!diferencia.eq(0)) {
          console.log(`   ⚠️ Ajustando base por diferencia: Q${diferencia.toFixed(2)}`);
          montoGravableFinal = montoGravable.plus(diferencia);
        }

        return {
          precioUnitario: parseFloat(total.toFixed(2)),
          precio: parseFloat(total.toFixed(2)),
          montoGravable: parseFloat(montoGravableFinal.toFixed(2)),
          montoImpuesto: parseFloat(montoImpuesto.toFixed(2)),
          total: parseFloat(total.toFixed(2)),
        };
      };

      // ============================================
      // 4️⃣ FACTURA DE MORA (INDEPENDIENTE)
      //    - Se emite SOLO si pagoData.mora > 0
      //    - 1 solo ítem: "CARGO POR SERVICIOS MORATORIOS"
      //    - Si falla, no interrumpe el flujo (registra el error y sigue)
      // ============================================
      if (pagoData.mora && parseFloat(pagoData.mora) > 0) {
        console.log("\n⚠️ Generando factura de MORA...");

        const calcMora = calcularIvaExacto(parseFloat(pagoData.mora));

        console.log(`   📦 MORA: Q${calcMora.total}`);
        console.log(`      Precio: Q${calcMora.precioUnitario}`);
        console.log(`      Base: Q${calcMora.montoGravable}`);
        console.log(`      IVA: Q${calcMora.montoImpuesto}`);

        const itemsMora = [
          {
            numeroLinea: 1,
            bienOServicio: "B",
            cantidad: 1,
            unidadMedida: "UND",
            descripcion: "CARGO POR SERVICIOS MORATORIOS",
            precioUnitario: calcMora.precioUnitario,
            precio: calcMora.precio,
            descuento: 0,
            impuestos: [
              {
                nombreCorto: "IVA",
                codigoUnidadGravable: 1,
                montoGravable: calcMora.montoGravable,
                montoImpuesto: calcMora.montoImpuesto,
              },
            ],
            total: calcMora.total,
          },
        ];

        const fechaVencimiento = pagoData.fecha_vencimiento
          ? new Date(pagoData.fecha_vencimiento).toISOString().split("T")[0]
          : pagoData.fecha_pago
            ? new Date(pagoData.fecha_pago).toISOString().split("T")[0]
            : new Date().toISOString().split("T")[0];

        const complementosMora = [
          {
            tipo: "cambiario",
            abonos: [
              {
                numeroAbono: 1,
                fechaVencimiento: fechaVencimiento,
                montoAbono: calcMora.total,
              },
            ],
          },
        ];

        try {
          const facturaMora = await certificarFacturaHelper({
            pago_id,
            receptor,
            items: itemsMora,
            complementos: complementosMora,
            created_by,
            nitsFallback: nitsDisponibles.slice(1),
          });

          facturasGeneradas.push({
            tipo: "MORA",
            ...facturaMora,
          });

          console.log(`   ✅ Factura mora: ${facturaMora.serie}-${facturaMora.numero}`);
        } catch (error: any) {
          console.error(`   ❌ Error factura mora:`, error.message);

          // 🔥 Ya no retorna - agrega el error y continúa con las demás facturas
          facturasGeneradas.push({
            tipo: "ERROR",
            concepto: "MORA",
            error: error.message,
          });
        }
      }

      // ============================================
      // 5️⃣ FACTURA DE OTROS SERVICIOS (INDEPENDIENTE)
      //    - Agrupa SEGURO + GPS + MEMBRESÍA en UNA sola factura con N ítems
      //    - Solo se genera si al menos uno de los 3 es > 0
      //    - Cada ítem se describe como "GASTOS VARIOS"
      //    - El monto ya viene × cuotas_atrasadas (se calculó en resetCredit)
      // ============================================
      const tieneOtrosServicios =
        (pagoData.abono_seguro && parseFloat(pagoData.abono_seguro) > 0) ||
        (pagoData.abono_gps && parseFloat(pagoData.abono_gps) > 0) ||
        (pagoData.membresias_pago && parseFloat(pagoData.membresias_pago) > 0);

      if (tieneOtrosServicios) {
        console.log("\n💼 Generando factura de OTROS SERVICIOS...");

        const itemsOtrosServicios = [];
        let numeroLinea = 1;
        let totalOtrosServicios = new Big(0);

        // 🔥 SEGURO
        if (pagoData.abono_seguro && parseFloat(pagoData.abono_seguro) > 0) {
          const calc = calcularIvaExacto(parseFloat(pagoData.abono_seguro));

          console.log(`   📦 SEGURO: Q${calc.total}`);
          console.log(`      Precio: Q${calc.precioUnitario}`);
          console.log(`      Base: Q${calc.montoGravable}`);
          console.log(`      IVA: Q${calc.montoImpuesto}`);

          itemsOtrosServicios.push({
            numeroLinea: numeroLinea++,
            bienOServicio: "B",
            cantidad: 1,
            unidadMedida: "UND",
            descripcion: "GASTOS VARIOS",
            precioUnitario: calc.precioUnitario,
            precio: calc.precio,
            descuento: 0,
            impuestos: [
              {
                nombreCorto: "IVA",
                codigoUnidadGravable: 1,
                montoGravable: calc.montoGravable,
                montoImpuesto: calc.montoImpuesto,
              },
            ],
            total: calc.total,
          });

          totalOtrosServicios = totalOtrosServicios.plus(calc.total);
        }

        // 🔥 GPS
        if (pagoData.abono_gps && parseFloat(pagoData.abono_gps) > 0) {
          const calc = calcularIvaExacto(parseFloat(pagoData.abono_gps));

          console.log(
            `   📦 GPS: Q${calc.total} (Precio: Q${calc.precioUnitario}, Base: Q${calc.montoGravable}, IVA: Q${calc.montoImpuesto})`
          );

          itemsOtrosServicios.push({
            numeroLinea: numeroLinea++,
            bienOServicio: "B",
            cantidad: 1,
            unidadMedida: "UND",
            descripcion: "GASTOS VARIOS",
            precioUnitario: calc.precioUnitario,
            precio: calc.precio,
            descuento: 0,
            impuestos: [
              {
                nombreCorto: "IVA",
                codigoUnidadGravable: 1,
                montoGravable: calc.montoGravable,
                montoImpuesto: calc.montoImpuesto,
              },
            ],
            total: calc.total,
          });

          totalOtrosServicios = totalOtrosServicios.plus(calc.total);
        }

        // 🔥 MEMBRESÍA
        if (pagoData.membresias_pago && parseFloat(pagoData.membresias_pago) > 0) {
          const calc = calcularIvaExacto(parseFloat(pagoData.membresias_pago));

          console.log(
            `   📦 MEMBRESÍA: Q${calc.total} (Precio: Q${calc.precioUnitario}, Base: Q${calc.montoGravable}, IVA: Q${calc.montoImpuesto})`
          );

          itemsOtrosServicios.push({
            numeroLinea: numeroLinea++,
            bienOServicio: "B",
            cantidad: 1,
            unidadMedida: "UND",
            descripcion: "GASTOS VARIOS",
            precioUnitario: calc.precioUnitario,
            precio: calc.precio,
            descuento: 0,
            impuestos: [
              {
                nombreCorto: "IVA",
                codigoUnidadGravable: 1,
                montoGravable: calc.montoGravable,
                montoImpuesto: calc.montoImpuesto,
              },
            ],
            total: calc.total,
          });

          totalOtrosServicios = totalOtrosServicios.plus(calc.total);
        }

        const fechaVencimiento = pagoData.fecha_vencimiento
          ? new Date(pagoData.fecha_vencimiento).toISOString().split("T")[0]
          : pagoData.fecha_pago
            ? new Date(pagoData.fecha_pago).toISOString().split("T")[0]
            : new Date().toISOString().split("T")[0];

        const complementosOtrosServicios = [
          {
            tipo: "cambiario",
            abonos: [
              {
                numeroAbono: 1,
                fechaVencimiento: fechaVencimiento,
                montoAbono: parseFloat(totalOtrosServicios.toFixed(2)),
              },
            ],
          },
        ];

        console.log(`   💰 Total otros servicios: Q${totalOtrosServicios.toFixed(2)}`);

        try {
          const facturaOtrosServicios = await certificarFacturaHelper({
            pago_id,
            receptor,
            items: itemsOtrosServicios,
            complementos: complementosOtrosServicios,
            created_by,
            nitsFallback: nitsDisponibles.slice(1),
          });

          facturasGeneradas.push({
            tipo: "OTROS_SERVICIOS",
            ...facturaOtrosServicios,
          });

          console.log(
            `   ✅ Factura otros servicios: ${facturaOtrosServicios.serie}-${facturaOtrosServicios.numero}`
          );
        } catch (error: any) {
          console.error(`   ❌ Error factura otros servicios:`, error.message);

          // 🔥 Ya no retorna - agrega el error y continúa con las demás facturas
          facturasGeneradas.push({
            tipo: "ERROR",
            concepto: "OTROS_SERVICIOS",
            error: error.message,
          });
        }
      }

      // ============================================
      // 5.5️⃣ FACTURA DE OTROS (INDEPENDIENTE)
      //    - Campo pagoData.otros: garantía + traspaso + extras
      //      (llega ya sumado desde resetCredit → otrosCancelacion)
      //    - 1 solo ítem: "GASTOS VARIOS"
      // ============================================
      if (pagoData.otros && parseFloat(pagoData.otros) > 0) {
        console.log("\n💼 Generando factura de OTROS...");

        const calcOtros = calcularIvaExacto(parseFloat(pagoData.otros));

        console.log(`   📦 OTROS: Q${calcOtros.total}`);
        console.log(`      Precio: Q${calcOtros.precioUnitario}`);
        console.log(`      Base: Q${calcOtros.montoGravable}`);
        console.log(`      IVA: Q${calcOtros.montoImpuesto}`);

        const itemsOtros = [
          {
            numeroLinea: 1,
            bienOServicio: "B",
            cantidad: 1,
            unidadMedida: "UND",
            descripcion: "GASTOS VARIOS",
            precioUnitario: calcOtros.precioUnitario,
            precio: calcOtros.precio,
            descuento: 0,
            impuestos: [
              {
                nombreCorto: "IVA",
                codigoUnidadGravable: 1,
                montoGravable: calcOtros.montoGravable,
                montoImpuesto: calcOtros.montoImpuesto,
              },
            ],
            total: calcOtros.total,
          },
        ];

        const fechaVencimientoOtros = pagoData.fecha_vencimiento
          ? new Date(pagoData.fecha_vencimiento).toISOString().split("T")[0]
          : pagoData.fecha_pago
            ? new Date(pagoData.fecha_pago).toISOString().split("T")[0]
            : new Date().toISOString().split("T")[0];

        const complementosOtros = [
          {
            tipo: "cambiario",
            abonos: [
              {
                numeroAbono: 1,
                fechaVencimiento: fechaVencimientoOtros,
                montoAbono: calcOtros.total,
              },
            ],
          },
        ];

        try {
          const facturaOtros = await certificarFacturaHelper({
            pago_id,
            receptor,
            items: itemsOtros,
            complementos: complementosOtros,
            created_by,
            nitsFallback: nitsDisponibles.slice(1),
          });

          facturasGeneradas.push({
            tipo: "OTROS",
            ...facturaOtros,
          });

          console.log(`   ✅ Factura otros: ${facturaOtros.serie}-${facturaOtros.numero}`);
        } catch (error: any) {
          console.error(`   ❌ Error factura otros:`, error.message);

          facturasGeneradas.push({
            tipo: "ERROR",
            concepto: "OTROS",
            error: error.message,
          });
        }
      }

      // ============================================
      // 6️⃣ FACTURAS DE INTERESES
      //    🚪 Guardia: si el pago NO trae intereses → saltamos ambos flujos.
      //       (No tiene sentido entrar al flujo nuevo NI al viejo si no hay
      //        nada que repartir. Mora, otros y otros servicios siguen normal
      //        más arriba — ese bloque está fuera de este switch.)
      //
      //    🆕 Branching cuando SÍ hay intereses:
      //       • Tiene compra/reinversión pendiente_facturar=true → flujo nuevo (prorrateado)
      //       • No → flujo actual (residuo CUBE + reparto por aporte)
      // ============================================
      const hayInteresEnPago = new Big(pagoData.abono_interes || "0").gt(0);

      if (!hayInteresEnPago) {
        console.log("\n⏭️  NO hay intereses en este pago - Saltando facturas de intereses (ambos flujos)");
      } else if (tieneOperacionesPendientesFacturar) {
        // ============================================
        // 🆕 NUEVO FLUJO DE INTERESES — PRORRATEO POR FECHA DE COMPRA/REINVERSIÓN
        //
        //    Divide el interés del pago en DOS ventanas dentro del mes:
        //      • parte1: cómo estaba el crédito ANTES de la(s) compra(s)
        //                fracción = día_corte / días_del_mes
        //      • parte2: cómo está el crédito AHORA (después de la(s) compra(s))
        //                fracción = (días_del_mes − día_corte) / días_del_mes
        //
        //    En cada ventana se aplica el MISMO algoritmo del flujo actual:
        //      reparto por monto_aportado → split parteInv/parteCashIn → CUBE por residuo.
        //
        //    Al final se suman las dos ventanas por inversionista y se emite
        //    UNA factura por cada inv (más una para CUBE con residuo+cashIn de ambas).
        //
        //    Reconstrucción del "antes" por inversionista:
        //      • Inv comprador (entró/reinvirtió): monto_antes = monto_espejo − monto_aportado_en_compra
        //        (si era nuevo y antes tenía 0, el clamp lo deja en 0)
        //      • CUBE: monto_antes = monto_espejo + suma_total_comprado
        //        (CUBE soltó esas porciones al vender/redirigir)
        //      • Resto: monto_antes = monto_espejo (no cambió)
        // ============================================
        console.log("\n🆕 ========== NUEVO FLUJO DE INTERESES (PRORRATEO) ==========");

        // ============================================
        // 🗓️ DETERMINAR FECHA DE CORTE
        //
        // ¿Qué es la "fecha de corte"?
        //   Es el día del mes en que la compra/reinversión fue aceptada.
        //   Marca el punto donde la distribución de inversionistas cambió:
        //     • Antes de esa fecha → vieja distribución (más CUBE)
        //     • Desde esa fecha    → nueva distribución (con el comprador)
        //
        // Regla de negocio:
        //   Por crédito siempre habrá EXACTAMENTE 1 fila pendiente_facturar
        //   (1 sola compra/reinversión pendiente de cerrar el ciclo).
        //   Por eso usamos `operacionesPendientesFacturar[0]` directo.
        //
        // Defensa contra estado inconsistente:
        //   Si por error llegaran >1 → procesamos la primera y avisamos en consola.
        //   No abortamos para no bloquear la facturación del pago.
        // ============================================
        if (operacionesPendientesFacturar.length > 1) {
          // Caso anómalo: avisar y seguir con la primera.
          console.warn(`⚠️ Se esperaba 1 fila pendiente_facturar pero llegaron ${operacionesPendientesFacturar.length}. Procesando la primera.`);
        }

        // La operación pendiente que vamos a procesar (la única, salvo anomalía).
        const operacionPendiente = operacionesPendientesFacturar[0];

        // Buscamos al inversionista comprador dentro de la lista de inversionistas
        // del crédito para sacar su `fecha_inicio_participacion` del espejo.
        // (Esa columna vive en creditos_inversionistas_espejo y se llenó al
        //  aceptar la compra/reinversión.)
        const invCompradorEspejo = inversionistasDelPago.find(
          (i) => i.inversionista_id === operacionPendiente.inversionista_id
        );

        // La fecha que vamos a usar como punto de corte del mes.
        // Tipo: string ISO "YYYY-MM-DD" (porque la columna en BD es `date`).
        const fechaCorteRaw = invCompradorEspejo?.fecha_inicio_participacion_espejo;

        // ─────────────────────────────────────────────────────────────────
        // GUARDIA: ¿Qué pasa si NO encontramos fecha de inicio en el espejo?
        // ─────────────────────────────────────────────────────────────────
        // Casos posibles que pueden dejar `fechaCorteRaw` en null/undefined:
        //   1. El espejo nunca se creó para ese inversionista (bug histórico).
        //   2. El LEFT JOIN del SELECT inicial no encontró fila (inv huérfano).
        //   3. La columna está NULL por una migración mal hecha.
        //
        // Como SIN fecha NO podemos calcular el prorrateo (no sabemos cuándo
        // cortar el mes), abortamos el flujo nuevo de intereses para ESTE pago
        // y registramos el error en facturasGeneradas para que aparezca en el
        // response. La cuota se podrá facturar manualmente después.
        //
        // OJO: mora, otros servicios y otros SÍ se siguen emitiendo aunque
        // este bloque falle, porque están fuera de este if.
        if (!fechaCorteRaw) {
          console.error(`❌ Nuevo flujo: inv ${operacionPendiente.inversionista_id} no tiene fecha_inicio_participacion en el espejo`);
          facturasGeneradas.push({
            tipo: "ERROR",
            concepto: "INTERESES_NUEVO_FLUJO",
            error: `Inversionista ${operacionPendiente.inversionista_id} no tiene fecha_inicio_participacion en el espejo`,
          });
        } else {
          // ─────────────────────────────────────────────────────────────────
          // CÁLCULO DE FRACCIONES TEMPORALES
          // ─────────────────────────────────────────────────────────────────
          // Convertimos la fecha (string "2026-06-15") a Date para sacar el día.
          const fechaCorte = new Date(fechaCorteRaw as unknown as string);

          // `diaCorte` = qué día del mes fue la compra. Ej: 15 para el 15 de junio.
          const diaCorte = fechaCorte.getDate();

          // `ultimoDiaMes` = cuántos días tiene el mes de la fecha de corte.
          //   Truco JS: día 0 del mes siguiente = último día del mes actual.
          //   Ej: new Date(2026, 6, 0).getDate() → 30 (último día de junio).
          const ultimoDiaMes = new Date(fechaCorte.getFullYear(), fechaCorte.getMonth() + 1, 0).getDate();

          // Fracción de mes ANTES del corte: días vigentes con la vieja distribución.
          //   Ej: corte día 15 de 30 → fraccionAntes = 15/30 = 0.5 (50%)
          const fraccionAntes = new Big(diaCorte).div(ultimoDiaMes);

          // Fracción de mes DESPUÉS del corte: el resto del mes con la nueva.
          //   Ej: 1 − 0.5 = 0.5 (50%)
          const fraccionDespues = new Big(1).minus(fraccionAntes);

          console.log(`   🗓️  Fecha corte: ${fechaCorte.toISOString().split("T")[0]} | día ${diaCorte}/${ultimoDiaMes}`);
          console.log(`   📊 Fracción ANTES: ${fraccionAntes.times(100).toFixed(2)}% | Fracción DESPUÉS: ${fraccionDespues.times(100).toFixed(2)}%`);

          // ─────────────────────────────────────────────────────────────────
          // 💰 COMPRADOR Y MONTO APORTADO
          // ─────────────────────────────────────────────────────────────────
          // ID del inversionista que entró/aumentó su posición en el crédito.
          const idComprador = operacionPendiente.inversionista_id;

          // Monto que el comprador aportó en ESTA operación de compra/reinversión.
          //   Ej: si Juan compró Q5,000 de cartera → montoComprado = Q5,000.
          //   OJO: NO es el monto total que Juan tiene ahora en el crédito.
          //        Eso lo vamos a leer del espejo más adelante (monto_aportado_espejo).
          const montoComprado = new Big(operacionPendiente.monto_aportado);
          console.log(`   🛒 Comprador: inv ${idComprador} | monto Q${montoComprado.toFixed(2)}`);

          // ─────────────────────────────────────────────────────────────────
          // 🆔 DETECTAR A CUBE EN LA LISTA DE INVERSIONISTAS
          // ─────────────────────────────────────────────────────────────────
          // CUBE es especial: se trata por RESIDUO (se le da lo que sobra después
          // de repartir entre los demás, más las comisiones de cash-in).
          // Lo identificamos por nombre — heurística que conviene reemplazar
          // por un flag o ID fijo más adelante (deuda técnica documentada).
          const invCube = inversionistasDelPago.find((i) =>
            i.nombre.trim().toUpperCase().includes("CUBE INVESTMENTS")
          );

          // ID de CUBE para comparar después (puede ser null si CUBE no participa).
          const cubeId = invCube?.inversionista_id ?? null;

          // ─────────────────────────────────────────────────────────────────
          // 🔍 RECONSTRUIR LAS BASES "ANTES" Y "DESPUÉS" DEL CRÉDITO
          // ─────────────────────────────────────────────────────────────────
          // "Base" = el monto que cada inversionista aportó al crédito.
          // Esta base es la que usamos para repartir el interés proporcionalmente.
          //
          // "DESPUÉS" es la foto ACTUAL del espejo (cómo está hoy el crédito).
          // "ANTES" es la foto que tenía el crédito ANTES de la compra/reinversión.
          //
          // Para reconstruir el "antes" hay 3 casos por inversionista:
          //   1. Es CUBE → antes tenía MÁS (lo que el comprador le quitó al
          //      comprar). Fórmula: monto_espejo + montoComprado.
          //   2. Es el comprador → antes tenía MENOS (le restamos lo que aportó
          //      en esta compra). Fórmula: monto_espejo − montoComprado.
          //      Si era inv NUEVO (no estaba antes) → su monto era 0,
          //      por eso hacemos clamp en 0 si la resta da negativo.
          //   3. Cualquier otro → su monto no cambió, queda igual al espejo.
          //
          // Ejemplo numérico:
          //   Espejo actual: CUBE Q5,000 | Juan Q5,000 (Juan compró el 50%)
          //   montoComprado = Q5,000
          //   construirBaseAntes(CUBE) = 5000 + 5000 = 10000 (todo era de CUBE)
          //   construirBaseAntes(Juan) = 5000 - 5000 =     0 (Juan era nuevo)
          //   construirBaseDespues(CUBE) = 5000
          //   construirBaseDespues(Juan) = 5000

          const construirBaseAntes = (inv: typeof inversionistasDelPago[number]) => {
            // Monto actual del inversionista según el espejo (foto del crédito hoy).
            // Si el espejo está vacío para este inv, asumimos 0.
            const montoEspejo = new Big(inv.monto_aportado_espejo || "0");

            // CASO 1: CUBE recupera lo que le compraron (antes era suyo).
            if (inv.inversionista_id === cubeId) {
              return montoEspejo.plus(montoComprado);
            }

            // CASO 2: El comprador — antes tenía espejo menos lo que aportó.
            if (inv.inversionista_id === idComprador) {
              const antes = montoEspejo.minus(montoComprado);
              // Si la resta da negativo significa que era un inv totalmente nuevo
              // (no tenía nada antes) → su monto antes era 0.
              return antes.lt(0) ? new Big(0) : antes;
            }

            // CASO 3: Inversionista que no se vio afectado → su monto no cambia.
            return montoEspejo;
          };

          // El "después" es directo: lo que dice el espejo hoy. No hay magia.
          const construirBaseDespues = (inv: typeof inversionistasDelPago[number]) =>
            new Big(inv.monto_aportado_espejo || "0");

          // ─────────────────────────────────────────────────────────────────
          // 🧮 HELPER `calcularReparto`
          //
          // Replica EXACTAMENTE el algoritmo del flujo actual de intereses,
          // pero parametrizado por `fraccion` (porción del mes que aplica).
          //
          // Inputs:
          //   • getBase(inv) → función que devuelve el monto del inv en la
          //     foto correspondiente (antes o después).
          //   • fraccion → Big con la porción del mes (ej. 0.5 = medio mes).
          //   • etiqueta → solo para logs, "ANTES" o "DESPUÉS".
          //
          // Output:
          //   • parteInvPorId: Map<id_inv, Big> con la plata a facturar a cada
          //     inversionista (no incluye CUBE).
          //   • totalCubeParcial: Big con la plata que CUBE se lleva en esta
          //     ventana (residuo + cash_in acumulado de los demás).
          //
          // El interés total se reparte así:
          //   1. interesParcial = totalInteresesConIva × fraccion
          //   2. Por cada inv (no-CUBE):
          //        participacion = base_inv / suma_bases
          //        interesProporcional = interesParcial × participacion
          //        parteInv  = interesProporcional × pct_participacion
          //        parteCashIn = interesProporcional × pct_cash_in
          //   3. CUBE recibe lo que sobra (residuo) + todas las parteCashIn.
          // ─────────────────────────────────────────────────────────────────
          const calcularReparto = (
            getBase: (inv: typeof inversionistasDelPago[number]) => any,
            fraccion: any,
            etiqueta: string
          ) => {
            console.log(`\n   🧮 Reparto [${etiqueta}] (fracción ${fraccion.times(100).toFixed(2)}%)`);

            // Porción del interés total que aplica a esta ventana temporal.
            //   Ej: si fraccion=0.5 y interés total=Q1000 → interesParcial=Q500
            const interesParcial = totalInteresesConIva.times(fraccion);

            // Construimos array de {inv, base} para no recalcular getBase varias veces.
            const bases = inversionistasDelPago.map((inv) => ({ inv, base: getBase(inv) }));

            // Suma de todas las bases — denominador para las participaciones.
            const sumaBases = bases.reduce((s, b) => s.plus(b.base), new Big(0));

            console.log(`      💰 Interés parcial: Q${interesParcial.toFixed(2)} | Suma bases: Q${sumaBases.toFixed(2)}`);

            // Resultado parcial: cuánto se factura a cada inv (sin contar CUBE).
            const parteInvPorId = new Map<number, any>();

            // Acumulador: comisiones cash_in que se le sumarán a CUBE al final.
            let cashInAcumLocal = new Big(0);

            // Acumulador: lo que les tocó a los no-CUBE. Sirve para calcular el
            // residuo de CUBE como: interesParcial − totalNoCubeLocal.
            let totalNoCubeLocal = new Big(0);

            // Loop por cada inversionista del crédito.
            for (const { inv, base } of bases) {
              // CUBE se trata aparte (por residuo) al final del bloque.
              if (inv.inversionista_id === cubeId) continue;

              // % de participación de este inv en el reparto (0 si no hay bases).
              const participacion = sumaBases.gt(0) ? base.div(sumaBases) : new Big(0);

              // Plata bruta que le tocaría a este inv en esta ventana.
              const interesProporcional = interesParcial.times(participacion);

              // ─────────────────────────────────────────────────────────
              // ¿Hay que REDIRIGIR este interés a CUBE en vez de pagarle al inv?
              // ─────────────────────────────────────────────────────────
              // Esto pasa cuando el crédito tiene bandera_reinversion=true Y
              // el inv tiene status "pendiente_reinversion" o "pendiente_compra_cartera"
              // en el espejo. Significa que su plata está retenida para una próxima
              // operación, así que CUBE absorbe el interés en su lugar.
              //
              // OJO: al hacer `continue`, este interesProporcional NO suma a
              // totalNoCubeLocal, por lo que CUBE lo recibe AUTOMÁTICAMENTE
              // como parte del residuo (interesParcial − totalNoCubeLocal).
              const redirigirACube =
                pagoData.bandera_reinversion === true &&
                (inv.status_espejo === "pendiente_reinversion" ||
                  inv.status_espejo === "pendiente_compra_cartera");

              if (redirigirACube) {
                console.log(`      🔁 ${inv.nombre} → REDIRIGIDO A CUBE (Q${interesProporcional.toFixed(2)})`);
                continue;
              }

              // El inv sí recibe su interés → contamos hacia el total no-CUBE.
              totalNoCubeLocal = totalNoCubeLocal.plus(interesProporcional);

              // El interesProporcional se divide en 2 partes:
              //   • parteInversionista = lo que se le factura DIRECTO al inv.
              //   • parteCashIn        = comisión que va a CUBE (cash-in).
              const pctInversion = new Big(inv.porcentaje_participacion || "0").div(100);
              const pctCashIn = new Big(inv.porcentaje_cash_in || "0").div(100);
              const parteInversionista = interesProporcional.times(pctInversion);
              const parteCashIn = interesProporcional.times(pctCashIn);

              // Sumar la comisión cash_in al acumulador (se va a CUBE al final).
              cashInAcumLocal = cashInAcumLocal.plus(parteCashIn);

              // Guardar/acumular la parte del inv en el Map de resultados.
              // (Usamos plus para soportar inv que aparezcan más de una vez,
              //  aunque normalmente no debería pasar.)
              parteInvPorId.set(
                inv.inversionista_id,
                (parteInvPorId.get(inv.inversionista_id) ?? new Big(0)).plus(parteInversionista)
              );

              console.log(`      📊 ${inv.nombre}: base Q${base.toFixed(2)} (${participacion.times(100).toFixed(2)}%) → inv Q${parteInversionista.toFixed(2)} | cashIn Q${parteCashIn.toFixed(2)}`);
            }

            // CUBE por RESIDUO: todo lo que NO se repartió a los demás.
            // Esto asegura que la suma SIEMPRE cuadre con el total (no se pierde plata).
            const cubePropio = interesParcial.minus(totalNoCubeLocal);

            // Total para CUBE = su residuo propio + comisiones cash_in acumuladas.
            const totalCubeParcial = cubePropio.plus(cashInAcumLocal);

            console.log(`      💵 CUBE [${etiqueta}]: residuo Q${cubePropio.toFixed(2)} + cashIn Q${cashInAcumLocal.toFixed(2)} = Q${totalCubeParcial.toFixed(2)}`);

            return { parteInvPorId, totalCubeParcial };
          };

          // Llamamos al helper DOS veces:
          //   • Una con la foto del crédito "antes" de la compra.
          //   • Otra con la foto "después" (actual).
          // Cada llamada devuelve sus propios montos por inversionista y para CUBE.
          const repartoAntes = calcularReparto(construirBaseAntes, fraccionAntes, "ANTES");
          const repartoDespues = calcularReparto(construirBaseDespues, fraccionDespues, "DESPUÉS");

          // ─────────────────────────────────────────────────────────────────
          // 🧾 SUMAR PARTE_ANTES + PARTE_DESPUÉS Y FACTURAR
          //
          // Por cada inversionista emitimos UNA factura con:
          //   total = parteAntes + parteDespues
          //
          // Ejemplo: Juan
          //   parteAntes   = Q0    (era nuevo, no tenía base antes)
          //   parteDespues = Q175  (50% del crédito × 50% del mes × 70% pct_part)
          //   total        = Q175  → se factura Q175 a Juan
          // ─────────────────────────────────────────────────────────────────
          console.log("\n   🧾 Sumando parte1 + parte2 y emitiendo facturas...");

          // Total que va a CUBE = lo de las DOS ventanas sumado.
          const totalCubeFinal = repartoAntes.totalCubeParcial.plus(repartoDespues.totalCubeParcial);

          // Set con todos los IDs de inversionistas que aparecieron en cualquier
          // ventana (algunos podrían tener parte solo en una de las dos).
          const idsInv = new Set<number>([
            ...repartoAntes.parteInvPorId.keys(),
            ...repartoDespues.parteInvPorId.keys(),
          ]);

          // Fecha de vencimiento para el complemento cambiario de la factura.
          // Cascada: usa fecha_vencimiento del pago, sino fecha_pago, sino HOY.
          const fechaVencimientoNF = pagoData.fecha_vencimiento
            ? new Date(pagoData.fecha_vencimiento).toISOString().split("T")[0]
            : pagoData.fecha_pago
              ? new Date(pagoData.fecha_pago).toISOString().split("T")[0]
              : new Date().toISOString().split("T")[0];

          // Loop por cada inversionista que tiene plata para facturar.
          for (const invId of idsInv) {
            // Buscar los datos completos del inv en la lista del pago
            // (nombre, emite_factura, etc.).
            const inv = inversionistasDelPago.find((i) => i.inversionista_id === invId);
            if (!inv) continue; // Defensa: no debería pasar, pero por si acaso.

            // Las dos partes que se SUMAN para obtener el monto a facturar.
            const parteAntes = repartoAntes.parteInvPorId.get(invId) ?? new Big(0);
            const parteDespues = repartoDespues.parteInvPorId.get(invId) ?? new Big(0);

            // Total a facturar al inversionista, redondeado a 2 decimales.
            const totalInv = parteAntes.plus(parteDespues).round(2);

            // Si por redondeo o porque no le tocaba nada da Q0 → no facturamos.
            if (totalInv.lte(0)) {
              console.log(`      ⏭️  ${inv.nombre}: total Q0`);
              continue;
            }

            // ¿Este inversionista tiene config para facturar bajo su propia razón social?
            //   Ej: SE_PRESTA, AMJK, AUTOCASH, etc. tienen su propio NIT facturador.
            const inversionistaConfig = getInversionistaFacturadorConfig(inv.nombre);

            // Si el inv emite SU PROPIA factura (fuera del sistema) Y no tenemos
            // config local para emitírsela nosotros → lo saltamos.
            // (Él se factura solo. Su parte queda como deuda informativa.)
            if (inv.emite_factura && !inversionistaConfig) {
              console.log(`      ⏭️  ${inv.nombre}: emite su propia factura`);
              continue;
            }

            const calc = calcularIvaExacto(parseFloat(totalInv.toFixed(2)));
            console.log(`      💼 Factura ${inv.nombre}: Q${totalInv.toFixed(2)} (antes Q${parteAntes.toFixed(2)} + después Q${parteDespues.toFixed(2)})`);

            const itemsInv = [
              {
                numeroLinea: 1,
                bienOServicio: "B",
                cantidad: 1,
                unidadMedida: "UND",
                descripcion: "CARGO POR SERVICIOS",
                precioUnitario: calc.precioUnitario,
                precio: calc.precio,
                descuento: 0,
                impuestos: [
                  {
                    nombreCorto: "IVA",
                    codigoUnidadGravable: 1,
                    montoGravable: calc.montoGravable,
                    montoImpuesto: calc.montoImpuesto,
                  },
                ],
                total: calc.total,
              },
            ];

            const complementosInv = [
              {
                tipo: "cambiario",
                abonos: [
                  { numeroAbono: 1, fechaVencimiento: fechaVencimientoNF, montoAbono: calc.total },
                ],
              },
            ];

            try {
              const facturaInv = await certificarFacturaHelper({
                pago_id,
                receptor,
                items: itemsInv,
                complementos: complementosInv,
                created_by,
                customConfig: inversionistaConfig?.config,
                customSatConfig: inversionistaConfig?.satConfig,
                nitsFallback: nitsDisponibles.slice(1),
              });

              facturasGeneradas.push({
                tipo: "INTERESES",
                inversionista: inv.nombre,
                inversionista_id: inv.inversionista_id,
                emisor: inversionistaConfig?.config.emisor.nombreEmisor || "CUBE INVESTMENTS",
                flujo: "NUEVO_PRORRATEADO",
                parte_antes: parteAntes.toFixed(2),
                parte_despues: parteDespues.toFixed(2),
                ...facturaInv,
              });

              console.log(`      ✅ ${facturaInv.serie}-${facturaInv.numero}`);
            } catch (error: any) {
              console.error(`      ❌ Error: ${error.message}`);
              facturasGeneradas.push({
                tipo: "ERROR",
                inversionista: inv.nombre,
                flujo: "NUEVO_PRORRATEADO",
                error: error.message,
              });
            }
          }

          // ─────────────────────────────────────────────────────────────────
          // 🧾 FACTURA CUBE — UNA SOLA factura con la suma de las 2 ventanas
          //
          // CUBE total = residuoAntes + cashInAntes + residuoDespues + cashInDespues
          //
          // Ejemplo (continuando el caso de Juan):
          //   CUBE antes = Q500 (todo el "antes" era de CUBE)
          //   CUBE después = Q250 (su 50%) + Q75 (cashIn de Juan) = Q325
          //   CUBE total = 500 + 325 = Q825
          //
          // Si totalCubeFinal es 0 o negativo no facturamos (caso raro pero defensivo).
          // ─────────────────────────────────────────────────────────────────
          if (totalCubeFinal.gt(0)) {
            // Redondeo a 2 decimales antes de calcular IVA.
            const totalCubeRounded = totalCubeFinal.round(2);
            console.log(`\n      💼 Factura CUBE: Q${totalCubeRounded.toFixed(2)} (antes Q${repartoAntes.totalCubeParcial.toFixed(2)} + después Q${repartoDespues.totalCubeParcial.toFixed(2)})`);
            const calcCube = calcularIvaExacto(parseFloat(totalCubeRounded.toFixed(2)));

            const itemsCube = [
              {
                numeroLinea: 1,
                bienOServicio: "B",
                cantidad: 1,
                unidadMedida: "UND",
                descripcion: "CARGO POR SERVICIOS",
                precioUnitario: calcCube.precioUnitario,
                precio: calcCube.precio,
                descuento: 0,
                impuestos: [
                  {
                    nombreCorto: "IVA",
                    codigoUnidadGravable: 1,
                    montoGravable: calcCube.montoGravable,
                    montoImpuesto: calcCube.montoImpuesto,
                  },
                ],
                total: calcCube.total,
              },
            ];

            const complementosCube = [
              {
                tipo: "cambiario",
                abonos: [
                  { numeroAbono: 1, fechaVencimiento: fechaVencimientoNF, montoAbono: calcCube.total },
                ],
              },
            ];

            try {
              const facturaCube = await certificarFacturaHelper({
                pago_id,
                receptor,
                items: itemsCube,
                complementos: complementosCube,
                created_by,
                nitsFallback: nitsDisponibles.slice(1),
              });

              facturasGeneradas.push({
                tipo: "INTERESES_CUBE",
                descripcion: "CARGO POR SERVICIOS (CUBE + CASH_IN)",
                flujo: "NUEVO_PRORRATEADO",
                parte_antes: repartoAntes.totalCubeParcial.toFixed(2),
                parte_despues: repartoDespues.totalCubeParcial.toFixed(2),
                ...facturaCube,
              });

              console.log(`      ✅ ${facturaCube.serie}-${facturaCube.numero} (CUBE)`);
            } catch (error: any) {
              console.error(`      ❌ Error factura CUBE: ${error.message}`);
              facturasGeneradas.push({
                tipo: "ERROR",
                inversionista: "CUBE",
                flujo: "NUEVO_PRORRATEADO",
                error: error.message,
              });
            }
          }

          // ============================================
          // 🔚 CIERRE DEL CICLO: marcar pendiente_facturar = false
          //
          // ¿Para qué?
          //   Cuando el pago COMPLETA la cuota (cliente terminó de pagar lo que
          //   le tocaba ese mes) Y todas las facturas del flujo nuevo salieron
          //   bien → ya cumplió su propósito el flujo prorrateado para esta
          //   operación de compra/reinversión. Marcamos la(s) fila(s) como
          //   `pendiente_facturar=false` para que el SIGUIENTE pago use el
          //   flujo normal (sin prorrateo, porque ya no hay corte que respetar).
          //
          // ¿Cuándo NO marcar?
          //   • Si la cuota no está pagada → todavía pueden entrar más pagos
          //     ese mes; conviene esperar a cerrarla.
          //   • Si HUBO errores en alguna factura del flujo nuevo → no cerramos
          //     el ciclo hasta que se regularice (manualmente o reintentando).
          //
          // Si ambas pasan → UPDATE en compras_credito_inversionista.
          // El UPDATE va en try/catch para no romper el response si BD falla.
          // ============================================

          // PASO 1: contar errores del flujo nuevo en lo que ya pusimos en
          // facturasGeneradas durante esta ejecución. Cualquier error con
          // flujo "NUEVO_PRORRATEADO" o concepto "INTERESES_NUEVO_FLUJO" cuenta.
          const erroresFlujoNuevo = facturasGeneradas.filter(
            (f: any) =>
              f.tipo === "ERROR" &&
              (f.flujo === "NUEVO_PRORRATEADO" || f.concepto === "INTERESES_NUEVO_FLUJO")
          );
          const huboErroresNuevoFlujo = erroresFlujoNuevo.length > 0;

          // PASO 2: consultar si la cuota está pagada.
          //   `pagado=true` en cuotas_credito significa que el cliente terminó
          //   de pagar esa cuota (la suma de pagos cubrió el monto requerido).
          //   Si no hay cuota_id en el pago (raro), asumimos NO pagada.
          let cuotaPagada = false;
          if (pagoData.cuota_id) {
            const [cuotaInfo] = await db
              .select({ pagado: cuotas_credito.pagado })
              .from(cuotas_credito)
              .where(eq(cuotas_credito.cuota_id, pagoData.cuota_id));
            cuotaPagada = cuotaInfo?.pagado === true;
          }

          // PASO 3: decidir qué hacer según las dos condiciones.
          if (!cuotaPagada) {
            // Cuota aún no se completa → próximo pago vuelve a entrar al flujo nuevo.
            console.log(`\n   ⏸️  Cuota ${pagoData.cuota_id ?? "?"} NO está pagada todavía → se mantiene pendiente_facturar=true`);
          } else if (huboErroresNuevoFlujo) {
            // Hubo problemas al facturar → NO cerrar el ciclo, alguien debe revisar.
            console.log(`\n   ⏸️  Hubo ${erroresFlujoNuevo.length} error(es) en el flujo nuevo → se mantiene pendiente_facturar=true`);
          } else {
            // Caso feliz: cerrar el ciclo. Hacemos UPDATE en BD.
            const idsParaMarcar = operacionesPendientesFacturar.map((o) => o.id);
            console.log(`\n   ✅ Cuota pagada + sin errores → marcando ${idsParaMarcar.length} fila(s) como pendiente_facturar=false`);
            try {
              await db
                .update(compras_credito_inversionista)
                .set({ pendiente_facturar: false, updated_at: new Date() })
                .where(inArray(compras_credito_inversionista.id, idsParaMarcar));
              console.log(`   ✅ Filas actualizadas: ${idsParaMarcar.join(", ")}`);
            } catch (updateError: any) {
              // Si el UPDATE falla, la facturación YA pasó (las facturas existen en SAT).
              // No reventamos el response — solo registramos el error para que sea
              // visible en la respuesta y se pueda corregir manualmente en BD.
              console.error(`   ❌ Error marcando pendiente_facturar=false:`, updateError.message);
              facturasGeneradas.push({
                tipo: "ERROR",
                concepto: "MARCAR_PENDIENTE_FACTURAR",
                flujo: "NUEVO_PRORRATEADO",
                error: updateError.message,
              });
            }
          }
        }
      } else {
      // ============================================
      // 6️⃣ FLUJO ACTUAL — FACTURAS DE INTERESES (1 por inversionista + 1 para CUBE)
      //    Estrategia:
      //      PASO 1: loop por cada inversionista (saltando CUBE)
      //              - Si bandera_reinversion=true y status_espejo pendiente → redirigir a CUBE
      //              - Separar interes_proporcional en parteInversionista + parteCashIn
      //              - Acumular parteCashIn en cashInAcumulado (para sumárselo a CUBE al final)
      //              - Si el inversionista emite su propia factura y no hay config → skip
      //              - Si no, facturar la parteInversionista con su emisor correspondiente
      //      PASO 2: CUBE se calcula por RESIDUO:
      //              cubePropio = total_pago − suma_intereses_no_cube
      //              totalCube  = cubePropio + cashInAcumulado
      //      PASO 3: 1 factura para CUBE con totalCube
      // ============================================
      // 🚪 Entramos aquí solo si hayInteresEnPago=true (garantizado arriba),
      //    así que el check de `totalInteresesPago > 0` ya no se necesita.
      const totalInteresesPago = new Big(pagoData.abono_interes || "0");
      const totalIvaPago = new Big(pagoData.abono_iva_12 || "0");
      const totalInteresesConIvaPago = totalInteresesPago.plus(totalIvaPago);

      console.log(
        `\n💰 Procesando INTERESES (Total con IVA: Q${totalInteresesConIvaPago.toFixed(2)})`
      );

        let cashInAcumulado = new Big(0);
        let totalInteresesNoCube = new Big(0);

        // -------- PASO 1: Facturas individuales para inversionistas NO-CUBE --------
        for (const inv of inversionistasDelPago) {
          console.log(`\n   🔍 Procesando: "${inv.nombre}" (emite_factura: ${inv.emite_factura})`);

          const esCube = inv.nombre
            .trim()
            .toUpperCase()
            .includes("CUBE INVESTMENTS");

          // 🔥 SI ES CUBE → se acumula al final
          if (esCube) {
            console.log(`   ⏭️  ${inv.nombre} - Es CUBE (se suma al final)`);
            continue;
          }

          const interesProporcional = new Big(inv.interes_proporcional || "0");

          // 🔥 REDIRIGIR A CUBE: si bandera_reinversion del crédito activa
          // y status del espejo = pendiente_reinversion o pendiente_compra_cartera
          const redirigirACube =
            pagoData.bandera_reinversion === true &&
            (inv.status_espejo === "pendiente_reinversion" ||
              inv.status_espejo === "pendiente_compra_cartera");

          if (redirigirACube) {
            console.log(
              `   🔁 ${inv.nombre} → REDIRIGIDO A CUBE (bandera_reinversion=true, status_espejo=${inv.status_espejo}) | Q${interesProporcional.toFixed(2)}`
            );
            // NO sumar a totalInteresesNoCube ni a cashInAcumulado:
            // CUBE absorbe todo (parteInversionista + parteCashIn) por RESIDUO.
            continue;
          }

          totalInteresesNoCube = totalInteresesNoCube.plus(interesProporcional);
          if (interesProporcional.lte(0)) {
            console.log(`   ⏭️  ${inv.nombre} - Sin intereses`);
            continue;
          }

          // 🔥 Separar parte del inversionista y parte cash_in
          const pctInversion = new Big(inv.porcentaje_participacion || "0").div(100);
          const pctCashIn = new Big(inv.porcentaje_cash_in || "0").div(100);

          const parteInversionista = interesProporcional.times(pctInversion).round(2);
          const parteCashIn = interesProporcional.times(pctCashIn).round(2);

          console.log(`   📊 Interés proporcional: Q${interesProporcional.toFixed(2)}`);
          console.log(`      → Parte inversionista (${inv.porcentaje_participacion}%): Q${parteInversionista.toFixed(2)}`);
          console.log(`      → Parte cash_in (${inv.porcentaje_cash_in}%): Q${parteCashIn.toFixed(2)}`);

          // 🔥 Acumular cash_in para Cube
          cashInAcumulado = cashInAcumulado.plus(parteCashIn);

          // 🔥 DETECTAR CONFIG DEL INVERSIONISTA
          const inversionistaConfig = getInversionistaFacturadorConfig(inv.nombre);
          console.log(`   🔍 Match con facturador: ${inversionistaConfig ? inversionistaConfig.config.emisor.nombreEmisor : 'NO MATCH'}`);

          // 🔥 SI EMITE FACTURA Y NO tiene config → NO generamos (ellos emiten)
          if (inv.emite_factura && !inversionistaConfig) {
            console.log(`   ⏭️  ${inv.nombre} - Emite su propia factura`);
            continue;
          }

          // 🔥 Facturar la parte del inversionista
          if (parteInversionista.lte(0)) {
            console.log(`   ⏭️  ${inv.nombre} - Parte inversionista es 0`);
            continue;
          }

          const calc = calcularIvaExacto(parseFloat(parteInversionista.toFixed(2)));
          console.log(`   💼 Factura ${inv.nombre}: Q${parteInversionista.toFixed(2)} (Base: Q${calc.montoGravable}, IVA: Q${calc.montoImpuesto})`);

          const itemsIntereses = [
            {
              numeroLinea: 1,
              bienOServicio: "B",
              cantidad: 1,
              unidadMedida: "UND",
              descripcion: "CARGO POR SERVICIOS",
              precioUnitario: calc.precioUnitario,
              precio: calc.precio,
              descuento: 0,
              impuestos: [
                {
                  nombreCorto: "IVA",
                  codigoUnidadGravable: 1,
                  montoGravable: calc.montoGravable,
                  montoImpuesto: calc.montoImpuesto,
                },
              ],
              total: calc.total,
            },
          ];

          const fechaVencimiento = pagoData.fecha_vencimiento
            ? new Date(pagoData.fecha_vencimiento).toISOString().split("T")[0]
            : pagoData.fecha_pago
              ? new Date(pagoData.fecha_pago).toISOString().split("T")[0]
              : new Date().toISOString().split("T")[0];

          const complementosInteres = [
            {
              tipo: "cambiario",
              abonos: [
                {
                  numeroAbono: 1,
                  fechaVencimiento: fechaVencimiento,
                  montoAbono: calc.total,
                },
              ],
            },
          ];

          try {
            const facturaIntereses = await certificarFacturaHelper({
              pago_id,
              receptor,
              items: itemsIntereses,
              complementos: complementosInteres,
              created_by,
              customConfig: inversionistaConfig?.config,
              customSatConfig: inversionistaConfig?.satConfig,
              nitsFallback: nitsDisponibles.slice(1),
            });

            facturasGeneradas.push({
              tipo: "INTERESES",
              inversionista: inv.nombre,
              inversionista_id: inv.inversionista_id,
              emisor: inversionistaConfig?.config.emisor.nombreEmisor || "CUBE INVESTMENTS",
              ...facturaIntereses,
            });

            console.log(
              `      ✅ ${facturaIntereses.serie}-${facturaIntereses.numero} (Emisor: ${inversionistaConfig?.config.emisor.nombreEmisor || "CUBE"})`
            );
          } catch (error: any) {
            console.error(`      ❌ Error: ${error.message}`);
            facturasGeneradas.push({
              tipo: "ERROR",
              inversionista: inv.nombre,
              error: error.message,
            });
          }
        }

        // -------- PASO 2: Calcular parte de CUBE como RESIDUO (total - lo que les tocó a los demás) --------
        const cubePropio = totalInteresesConIvaPago.minus(totalInteresesNoCube);
        console.log(`\n   📊 CUBE propio (residuo): Q${cubePropio.toFixed(2)} (total Q${totalInteresesConIvaPago.toFixed(2)} - otros Q${totalInteresesNoCube.toFixed(2)})`);

        const totalCube = cubePropio.plus(cashInAcumulado);

        console.log(`   📊 Cash-in acumulado de otros: Q${cashInAcumulado.toFixed(2)}`);
        console.log(`   💵 Total CUBE: Q${totalCube.toFixed(2)} (residuo + cash_in)`);

        // -------- PASO 3: Generar 1 factura para CUBE con (residuo + cash_in acumulado) --------
        if (totalCube.gt(0)) {
          console.log(`   💼 Generando factura CUBE...`);

          const calcCube = calcularIvaExacto(parseFloat(totalCube.toFixed(2)));

          const itemsCube = [
            {
              numeroLinea: 1,
              bienOServicio: "B",
              cantidad: 1,
              unidadMedida: "UND",
              descripcion: "CARGO POR SERVICIOS",
              precioUnitario: calcCube.precioUnitario,
              precio: calcCube.precio,
              descuento: 0,
              impuestos: [
                {
                  nombreCorto: "IVA",
                  codigoUnidadGravable: 1,
                  montoGravable: calcCube.montoGravable,
                  montoImpuesto: calcCube.montoImpuesto,
                },
              ],
              total: calcCube.total,
            },
          ];

          const fechaVencimiento = pagoData.fecha_vencimiento
            ? new Date(pagoData.fecha_vencimiento).toISOString().split("T")[0]
            : pagoData.fecha_pago
              ? new Date(pagoData.fecha_pago).toISOString().split("T")[0]
              : new Date().toISOString().split("T")[0];

          const complementosCube = [
            {
              tipo: "cambiario",
              abonos: [
                {
                  numeroAbono: 1,
                  fechaVencimiento: fechaVencimiento,
                  montoAbono: calcCube.total,
                },
              ],
            },
          ];

          try {
            const facturaCube = await certificarFacturaHelper({
              pago_id,
              receptor,
              items: itemsCube,
              complementos: complementosCube,
              created_by,
              nitsFallback: nitsDisponibles.slice(1),
            });

            facturasGeneradas.push({
              tipo: "INTERESES_CUBE",
              descripcion: "CARGO POR SERVICIOS (CUBE + CASH_IN)",
              ...facturaCube,
            });

            console.log(
              `      ✅ ${facturaCube.serie}-${facturaCube.numero} (CUBE)`
            );
          } catch (error: any) {
            console.error(`      ❌ Error factura CUBE: ${error.message}`);
            facturasGeneradas.push({
              tipo: "ERROR",
              inversionista: "CUBE",
              error: error.message,
            });
          }
        }
      } // 🔚 cierre del else (flujo actual de intereses)

      // ============================================
      // 7️⃣ RESPUESTA FINAL
      //    - Separa facturasGeneradas en exitosas vs con error
      //    - Si ninguna se generó → responde 500
      //    - Si al menos 1 se generó → responde 200 con el detalle
      // ============================================
      console.log("\n🎉 Facturación completada");

      const facturasExitosas = facturasGeneradas.filter(
        (f) => f.tipo !== "ERROR"
      );
      const facturasConError = facturasGeneradas.filter(
        (f) => f.tipo === "ERROR"
      );

      console.log(
        `✅ Exitosas: ${facturasExitosas.length} | ❌ Errores: ${facturasConError.length}`
      );

      if (facturasExitosas.length === 0) {
        set.status = 500;
        return {
          success: false,
          error: "No se pudo generar ninguna factura",
          errores: facturasConError,
        };
      }

      return {
        success: true,
        data: {
          pago_id,
          cliente: {
            nombre: pagoData.nombre,
            nit: pagoData.nit,
          },
          total_facturas: facturasExitosas.length,
          facturas: facturasExitosas,
          errores: facturasConError.length > 0 ? facturasConError : undefined,
        },
        mensaje:
          facturasConError.length > 0
            ? `${facturasExitosas.length} factura(s) generada(s) exitosamente, ${facturasConError.length} con errores`
            : `${facturasExitosas.length} factura(s) generada(s) exitosamente`,
      };
    } catch (error) {
      console.error("❌ Error facturando pago completo:", error);
      set.status = 500;
      return {
        success: false,
        error: (error as Error).message,
        stack: (error as Error).stack,
      };
    }
  },
  {
    body: t.Object({
      pago_id: t.Number(),
      created_by: t.Optional(t.Number()),
    }),
  }
)
  // 🔥 GET - Obtener por UUID

  // 🔥 GET - Obtener por UUID (COFIDI + BD)
  .get(
    "/obtener/:uuid",
    async ({ params }) => {
      try {
        const { uuid } = params;

        console.log("📥 Obteniendo DTE con UUID:", uuid);

        // 1️⃣ BUSCAR EN BASE DE DATOS
        const [facturaBD] = await db
          .select()
          .from(facturas_electronicas)
          .where(eq(facturas_electronicas.uuid, uuid));

        if (!facturaBD) {
          return {
            success: false,
            mensaje: "Factura no encontrada en base de datos",
          };
        }

        console.log("✅ Factura encontrada en BD:", facturaBD.factura_id);

        // 2️⃣ OBTENER DE COFIDI
        const satClient = new SATClientService(
          {
            requestor: SAT_CONFIG.requestor,
            user: SAT_CONFIG.user,
            userName: SAT_CONFIG.userName,
            entity: SAT_CONFIG.entity,
          },
          SAT_CONFIG.endpointUrl
        );

        const resultado = await satClient.obtenerPorUUID(uuid);

        if (!resultado.encontrado) {
          return {
            success: false,
            mensaje: resultado.mensaje,
            facturaBD, // 👈 Devolvemos lo de BD aunque no esté en COFIDI
          };
        }

        const xmlCertificado = satClient.decodificarXMLCertificado(
          resultado.xmlCertificado!
        );

        // 3️⃣ COMBINAR DATOS DE COFIDI + BD
        return {
          success: true,
          data: {
            // Datos de la BD
            factura_id: facturaBD.factura_id,
            serie: facturaBD.serie,
            pago_id: facturaBD.pago_id,
            numero: facturaBD.numero,
            uuid: facturaBD.uuid,
            tipo_documento: facturaBD.tipo_documento,
            monto_total: facturaBD.monto_total,
            monto_iva: facturaBD.monto_iva,
            pdf_url: facturaBD.pdf_url,
            receptor_nit: facturaBD.receptor_nit,
            receptor_nombre: facturaBD.receptor_nombre,
            fecha_emision: facturaBD.fecha_emision,
            fecha_certificacion: facturaBD.fecha_certificacion,
            status: facturaBD.status,
            fecha_anulacion: facturaBD.fecha_anulacion,
            motivo_anulacion: facturaBD.motivo_anulacion,
            created_at: facturaBD.created_at,

            // XML de COFIDI
            xmlCertificado,
          },
          mensaje: "Factura obtenida exitosamente",
        };
      } catch (error) {
        console.error("❌ Error:", error);
        return {
          success: false,
          error: (error as Error).message,
        };
      }
    },
    {
      params: t.Object({
        uuid: t.String(),
      }),
    }
  )
.post('/anular', async ({ body, set }) => {
  try {
    const { uuid, motivo, userId } = body;

    console.log('🚫 ========== INICIANDO ANULACIÓN DE FACTURA ==========');
    console.log('📝 UUID:', uuid);
    console.log('📝 Motivo:', motivo);
    console.log('👤 Usuario ID:', userId);

    // ============================================
    // 1️⃣ BUSCAR FACTURA COMPLETA CON JOINS
    // ============================================
    const [facturaCompleta] = await db
      .select({
        // Datos de la factura
        factura_id: facturas_electronicas.factura_id,
        factura_uuid: facturas_electronicas.uuid,
        factura_serie: facturas_electronicas.serie,
        factura_numero: facturas_electronicas.numero,
        factura_status: facturas_electronicas.status,
        factura_fecha_emision: facturas_electronicas.fecha_emision,
        factura_fecha_certificacion: facturas_electronicas.fecha_certificacion,
        factura_monto_total: facturas_electronicas.monto_total,
        factura_receptor_nit: facturas_electronicas.receptor_nit,
        factura_receptor_nombre: facturas_electronicas.receptor_nombre,
        factura_fecha_anulacion: facturas_electronicas.fecha_anulacion,
        factura_motivo_anulacion: facturas_electronicas.motivo_anulacion,
        factura_tipo_documento: facturas_electronicas.tipo_documento,
        
        // Datos del pago
        pago_id: pagos_credito.pago_id,
        pago_fecha: pagos_credito.fecha_pago,
        pago_monto_boleta: pagos_credito.monto_boleta,
        
        // Datos del crédito
        credito_id: creditos.credito_id,
        credito_numero_sifco: creditos.numero_credito_sifco,
        
        // Datos del usuario (receptor)
        usuario_id: usuarios.usuario_id,
        usuario_nombre: usuarios.nombre,
        usuario_nit: usuarios.nit,
        usuario_direccion: usuarios.direccion,
        usuario_municipio: usuarios.municipio,
        usuario_departamento: usuarios.departamento,
      })
      .from(facturas_electronicas)
      .leftJoin(
        pagos_credito,
        eq(facturas_electronicas.pago_id, pagos_credito.pago_id)
      )
      .leftJoin(
        creditos,
        eq(pagos_credito.credito_id, creditos.credito_id)
      )
      .leftJoin(
        usuarios,
        eq(creditos.usuario_id, usuarios.usuario_id)
      )
      .where(eq(facturas_electronicas.uuid, uuid));

    // ============================================
    // 2️⃣ VALIDACIONES PREVIAS
    // ============================================
    
    // 🔥 VALIDACIÓN: Factura no encontrada
    if (!facturaCompleta) {
      set.status = 404;
      return {
        success: false,
        mensaje: 'No se encontró la factura electrónica',
        error: 'FACTURA_NO_ENCONTRADA',
        detalle: `No existe una factura con el UUID: ${uuid}`,
        sugerencia: 'Verifique que el UUID sea correcto'
      };
    }

    // 🔥 VALIDACIÓN: Factura ya anulada
    if (facturaCompleta.factura_status === 'ANULADA') {
      set.status = 409;
      return {
        success: false,
        mensaje: 'Esta factura ya fue anulada previamente',
        error: 'FACTURA_YA_ANULADA',
        detalle: {
          fecha_anulacion: facturaCompleta.factura_fecha_anulacion,
          motivo_anterior: facturaCompleta.factura_motivo_anulacion,
          serie: facturaCompleta.factura_serie,
          numero: facturaCompleta.factura_numero
        },
        sugerencia: 'No es posible anular una factura que ya está anulada'
      };
    }

    // 🔥 VALIDACIÓN: Verificar período válido para anular
    const fechaCertificacion = facturaCompleta.factura_fecha_certificacion 
      ? new Date(facturaCompleta.factura_fecha_certificacion)
      : new Date(facturaCompleta.factura_fecha_emision);
    
    const hoy = new Date();
    const mesFactura = fechaCertificacion.getMonth();
    const anioFactura = fechaCertificacion.getFullYear();
    const mesActual = hoy.getMonth();
    const anioActual = hoy.getFullYear();

    // SAT Guatemala permite anular hasta el 10 del mes siguiente (aproximado)
    // Para ser seguros, solo permitimos anular facturas del mes actual
    const esMismoPeriodo = (anioFactura === anioActual && mesFactura === mesActual);

    if (!esMismoPeriodo) {
      const nombresMeses = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 
                           'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
      
      set.status = 422;
      return {
        success: false,
        mensaje: 'No se puede anular esta factura: el período de declaración de IVA ya cerró',
        error: 'PERIODO_DECLARACION_CERRADO',
        detalle: {
          factura_del_periodo: `${nombresMeses[mesFactura]} ${anioFactura}`,
          periodo_actual: `${nombresMeses[mesActual]} ${anioActual}`,
          fecha_factura: fechaCertificacion.toISOString().split('T')[0],
          restriccion_sat: 'Solo se pueden anular facturas del período actual de IVA'
        },
        sugerencia: 'Para corregir facturas de períodos cerrados, debe emitir una Nota de Crédito en lugar de anular'
      };
    }

    console.log('✅ Factura encontrada y validada');
    console.log('📋 Detalles:', {
      serie: facturaCompleta.factura_serie,
      numero: facturaCompleta.factura_numero,
      tipo: facturaCompleta.factura_tipo_documento,
      cliente: facturaCompleta.usuario_nombre,
      monto: facturaCompleta.factura_monto_total
    });

    // ============================================
    // 3️⃣ PREPARAR FECHAS PARA XML
    // ============================================
    
    // 🔥 FORMATO SIN MILISEGUNDOS (como SAT lo espera)
    const formatearFechaSAT = (fecha: Date): string => {
      const year = fecha.getFullYear();
  const month = String(fecha.getMonth() + 1).padStart(2, '0');
  const day = String(fecha.getDate()).padStart(2, '0');
  const hours = String(fecha.getHours()).padStart(2, '0');
  const minutes = String(fecha.getMinutes()).padStart(2, '0');
  const seconds = String(fecha.getSeconds()).padStart(2, '0');
  
  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`;
    };

    const fechaEmisionRaw = facturaCompleta.factura_fecha_certificacion || facturaCompleta.factura_fecha_emision;
    const fechaEmisionDate = new Date(fechaEmisionRaw);
    const fechaEmisionDocumento = formatearFechaSAT(fechaEmisionDate);
    const fechaHoraAnulacion = formatearFechaSAT(new Date());

    console.log('🔍 ========== FECHAS PREPARADAS ==========');
    console.log('📅 Fecha emisión original (BD):', fechaEmisionRaw);
    console.log('📅 Fecha emisión formateada (XML):', fechaEmisionDocumento);
    console.log('📅 Fecha/hora anulación (XML):', fechaHoraAnulacion);
    console.log('📋 Tipo documento:', facturaCompleta.factura_tipo_documento);

    // ============================================
    // 6️⃣ ANULAR EN COFIDI/SAT (detectar emisor automáticamente)
    // ============================================
    console.log('📡 Intentando anulación con cada emisor...');

    const emisoresParaIntentar = Object.entries(EMISORES_CONFIG);
    let resultado: any = null;
    let emisorUsado = "";
    let xmlAnulacion = "";

    for (const [emisorKey, emisorConf] of emisoresParaIntentar) {
      const nitEmisor = emisorConf.config.emisor.nit;

      // Reconstruir XML con el NIT del emisor correcto
      const xmlAnulacionEmisor = `<?xml version="1.0" encoding="UTF-8"?>
<dte:GTAnulacionDocumento xmlns:dte="http://www.sat.gob.gt/dte/fel/0.1.0" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" Version="0.1" xsi:schemaLocation="http://www.sat.gob.gt/dte/fel/0.1.0 GT_AnulacionDocumento-0.1.0.xsd">
  <dte:SAT>
    <dte:AnulacionDTE ID="DatosCertificados">
      <dte:DatosGenerales
        ID="DatosAnulacion"
        NumeroDocumentoAAnular="${facturaCompleta.factura_uuid}"
        NITEmisor="${nitEmisor}"
        IDReceptor="${facturaCompleta.factura_receptor_nit || 'CF'}"
        FechaEmisionDocumentoAnular="${fechaEmisionDocumento}"
        FechaHoraAnulacion="${fechaHoraAnulacion}"
        MotivoAnulacion="${motivo}"/>
    </dte:AnulacionDTE>
  </dte:SAT>
</dte:GTAnulacionDocumento>`;

      const xmlBase64Emisor = Buffer.from(xmlAnulacionEmisor, 'utf-8').toString('base64');
      xmlAnulacion = xmlAnulacionEmisor;

      const satClient = new SATClientService(
        {
          requestor: emisorConf.satConfig.requestor,
          user: emisorConf.satConfig.user || emisorConf.satConfig.requestor,
          userName: emisorConf.satConfig.userName,
          entity: nitEmisor
        },
        emisorConf.satConfig.endpointUrl
      );

      console.log(`   🔄 Intentando con ${emisorKey} (NIT: ${nitEmisor})...`);

      try {
        resultado = await satClient.anularDocumento(uuid, xmlBase64Emisor);
        if (resultado.anulado) {
          emisorUsado = emisorKey;
          console.log(`   ✅ Anulado exitosamente con ${emisorKey}`);
          break;
        }
        console.log(`   ❌ ${emisorKey}: ${resultado.descripcion || 'No anulado'}`);
      } catch (e) {
        console.log(`   ❌ ${emisorKey}: Error - ${(e as Error).message}`);
      }
    }

    // 🔥 VALIDACIÓN: Error en COFIDI
    if (!resultado || !resultado.anulado) {
      console.error('❌ COFIDI rechazó la anulación');
      console.error('📋 Respuesta:', resultado);
      
      set.status = 422;
      
      // Identificar tipos de error comunes
      const descripcionError = resultado.descripcion || resultado.mensaje || '';
      let mensajeUsuario = 'Error al procesar la anulación en el sistema SAT';
      let codigoError = 'COFIDI_ERROR';
      let sugerencia = 'Contacte al administrador del sistema';

      // 🔥 Error de período cerrado
      if (descripcionError.includes('excede el plazo') || 
          descripcionError.includes('período de la declaración') ||
          descripcionError.includes('vencimiento')) {
        mensajeUsuario = 'No se puede anular: el período de declaración de IVA ya cerró';
        codigoError = 'PERIODO_IVA_CERRADO';
        sugerencia = 'Debe emitir una Nota de Crédito en lugar de anular la factura';
      }
      
      // 🔥 Error de documento no encontrado
      else if (descripcionError.includes('no existe') || 
               descripcionError.includes('not found') ||
               descripcionError.includes('No se encontró')) {
        mensajeUsuario = 'La factura no fue encontrada en el sistema SAT';
        codigoError = 'FACTURA_NO_EXISTE_SAT';
        sugerencia = 'Verifique que la factura haya sido certificada correctamente';
      }
      
      // 🔥 Error de documento ya anulado
      else if (descripcionError.includes('ya anulado') || 
               descripcionError.includes('already voided') ||
               descripcionError.includes('ANULADA')) {
        mensajeUsuario = 'Esta factura ya fue anulada anteriormente en SAT';
        codigoError = 'YA_ANULADA_EN_SAT';
        sugerencia = 'Sincronice el estado de la factura con la base de datos';
      }
      
      // 🔥 Error de fecha
      else if (descripcionError.includes('fecha') || descripcionError.includes('date')) {
        mensajeUsuario = 'Error en el formato de fecha de la anulación';
        codigoError = 'ERROR_FORMATO_FECHA';
        sugerencia = 'Verifique que la fecha de emisión de la factura sea correcta';
      }

      return {
        success: false,
        mensaje: mensajeUsuario,
        error: codigoError,
        detalle: {
          descripcion_cofidi: resultado.descripcion,
          mensaje_original: resultado.mensaje,
          processor: resultado.processor,
          factura: {
            uuid: uuid,
            serie: facturaCompleta.factura_serie,
            numero: facturaCompleta.factura_numero,
            fecha_emision_usada: fechaEmisionDocumento
          },
          debug_info: process.env.NODE_ENV === 'development' ? {
            fecha_emision_bd: facturaCompleta.factura_fecha_emision,
            fecha_certificacion_bd: facturaCompleta.factura_fecha_certificacion,
            fecha_usada_xml: fechaEmisionDocumento,
            xml_enviado: xmlAnulacion
          } : undefined
        },
        sugerencia
      };
    }

    console.log('✅ Factura anulada exitosamente en COFIDI/SAT');
    console.log('📋 Respuesta COFIDI:', {
      descripcion: resultado.descripcion,
      processor: resultado.processor
    });

    // ============================================
    // 7️⃣ ACTUALIZAR EN BASE DE DATOS
    // ============================================
    try {
      const [facturaAnulada] = await db
        .update(facturas_electronicas)
        .set({
          status: "ANULADA",
          fecha_anulacion: new Date(),
          motivo_anulacion: motivo,
          anulada_por: userId
        })
        .where(eq(facturas_electronicas.uuid, uuid))
        .returning();

      console.log('✅ Estado de factura actualizado en base de datos');

      // ============================================
      // 8️⃣ RESPUESTA EXITOSA
      // ============================================
      set.status = 200;
      return {
        success: true,
        mensaje: `Factura ${facturaCompleta.factura_serie}-${facturaCompleta.factura_numero} anulada exitosamente`,
        data: {
          // Datos de COFIDI/SAT
          confirmacion_sat: {
            descripcion: resultado.descripcion,
            processor: resultado.processor,
            fecha_anulacion: fechaHoraAnulacion
          },
          
          // Datos de la factura anulada
          factura: {
            factura_id: facturaAnulada.factura_id,
            serie: facturaAnulada.serie,
            numero: facturaAnulada.numero,
            uuid: facturaAnulada.uuid,
            status: facturaAnulada.status,
            monto_total: facturaAnulada.monto_total,
            fecha_anulacion: facturaAnulada.fecha_anulacion,
            motivo_anulacion: facturaAnulada.motivo_anulacion,
            anulada_por: facturaAnulada.anulada_por
          },

          // Datos relacionados
          relaciones: {
            pago_id: facturaCompleta.pago_id,
            credito_id: facturaCompleta.credito_id,
            credito_numero: facturaCompleta.credito_numero_sifco,
            cliente: {
              id: facturaCompleta.usuario_id,
              nombre: facturaCompleta.usuario_nombre,
              nit: facturaCompleta.usuario_nit
            }
          }
        }
      };

    } catch (dbError: any) {
      console.error('❌ Error al actualizar base de datos');
      console.error('⚠️ IMPORTANTE: La factura SÍ fue anulada en SAT/COFIDI');
      console.error('Error:', dbError);
      
      set.status = 500;
      
      // Error de foreign key (userId inválido)
      if (dbError.message?.includes('foreign key constraint') || 
          dbError.code === '23503') {
        return {
          success: false,
          mensaje: 'Error al actualizar la base de datos: usuario no válido',
          error: 'USUARIO_INVALIDO',
          advertencia: '⚠️ IMPORTANTE: La factura SÍ fue anulada en SAT, pero no se actualizó la base de datos',
          detalle: {
            uuid: uuid,
            problema: `El usuario con ID ${userId} no existe en el sistema`,
            estado_sat: 'ANULADA ✅',
            estado_bd: 'PENDIENTE DE ACTUALIZAR ⚠️'
          },
          accion_requerida: 'Verifique que el ID de usuario sea correcto y contacte al administrador para sincronizar el estado'
        };
      }

      // Error genérico de BD
      return {
        success: false,
        mensaje: 'Error al actualizar la base de datos',
        error: 'ERROR_BASE_DATOS',
        advertencia: '⚠️ IMPORTANTE: La factura SÍ fue anulada en SAT, pero no se actualizó la base de datos',
        detalle: {
          uuid: uuid,
          error_tecnico: dbError.message,
          estado_sat: 'ANULADA ✅',
          estado_bd: 'PENDIENTE DE ACTUALIZAR ⚠️'
        },
        accion_requerida: 'Contacte al administrador del sistema para sincronizar el estado de la factura'
      };
    }

  } catch (error: any) {
    console.error('❌ Error crítico en proceso de anulación:', error);
    
    set.status = 500;

    // Error de conexión a BD
    if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
      return {
        success: false,
        mensaje: 'No se pudo conectar con la base de datos',
        error: 'ERROR_CONEXION_BD',
        detalle: 'El servidor de base de datos no está disponible',
        sugerencia: 'Verifique la conexión a internet o contacte al administrador'
      };
    }

    // Error de conexión a COFIDI
    if (error.code === 'ENOTFOUND' || error.code === 'ECONNRESET') {
      return {
        success: false,
        mensaje: 'No se pudo conectar con el servicio de certificación SAT',
        error: 'ERROR_CONEXION_COFIDI',
        detalle: 'El servicio de COFIDI no está disponible en este momento',
        sugerencia: 'Intente nuevamente en unos minutos o contacte al administrador'
      };
    }

    // Error de timeout
    if (error.code === 'ETIMEDOUT' || error.message?.includes('timeout')) {
      return {
        success: false,
        mensaje: 'La solicitud excedió el tiempo de espera',
        error: 'TIMEOUT',
        detalle: 'El servicio tardó demasiado en responder',
        sugerencia: 'Verifique el estado de la factura antes de intentar nuevamente'
      };
    }

    // Error genérico
    return {
      success: false,
      mensaje: 'Error inesperado al procesar la anulación',
      error: 'ERROR_INTERNO',
      detalle: {
        mensaje_tecnico: error.message,
        tipo_error: error.name || 'Error desconocido',
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
      },
      sugerencia: 'Contacte al administrador del sistema con los detalles del error'
    };
  }
}, {
  body: t.Object({
    uuid: t.String(),
    motivo: t.String(),
    userId: t.Number()
  })
})
  // 🔥 BONUS - GET todas las facturas de un crédito
  .get(
    "/credito/:pagoId",
    async ({ params }) => {
      try {
        const { pagoId } = params;

        console.log("📋 Obteniendo facturas del pago:", pagoId);

        const facturas = await db
          .select()
          .from(facturas_electronicas)
          .where(eq(facturas_electronicas.pago_id, parseInt(pagoId)))
          .orderBy(facturas_electronicas.fecha_emision);

        return {
          success: true,
          data: {
            total_facturas: facturas.length,
            facturas_activas: facturas.filter((f) => f.status === "ACTIVA")
              .length,
            facturas_anuladas: facturas.filter((f) => f.status === "ANULADA")
              .length,
            monto_total_activo: facturas
              .filter((f) => f.status === "ACTIVA")
              .reduce((sum, f) => sum + parseFloat(f.monto_total as string), 0),
            facturas,
          },
          mensaje: `${facturas.length} facturas encontradas`,
        };
      } catch (error) {
        console.error("❌ Error:", error);
        return {
          success: false,
          error: (error as Error).message,
        };
      }
    },
    {
      params: t.Object({
        pagoId: t.String(),
      }),
    }
  )
  // src/controllers/dte.controller.ts - AGREGAR este endpoint

  .get(
    "getFacturas/:creditoId/facturas",
    async ({ params }) => {
      try {
        const { creditoId } = params;

        console.log("📋 Obteniendo facturas del crédito:", creditoId);

        // 1️⃣ JOIN con pagos_credito para obtener facturas del crédito
        const facturas = await db
          .select({
            // Datos de la factura
            factura_id: facturas_electronicas.factura_id,
            pago_id: facturas_electronicas.pago_id,
            serie: facturas_electronicas.serie,
            numero: facturas_electronicas.numero,
            uuid: facturas_electronicas.uuid,
            tipo_documento: facturas_electronicas.tipo_documento,
            monto_total: facturas_electronicas.monto_total,
            monto_iva: facturas_electronicas.monto_iva,
            pdf_url: facturas_electronicas.pdf_url,
            receptor_nit: facturas_electronicas.receptor_nit,
            receptor_nombre: facturas_electronicas.receptor_nombre,
            fecha_emision: facturas_electronicas.fecha_emision,
            fecha_certificacion: facturas_electronicas.fecha_certificacion,
            status: facturas_electronicas.status,
            fecha_anulacion: facturas_electronicas.fecha_anulacion,
            motivo_anulacion: facturas_electronicas.motivo_anulacion,
            created_at: facturas_electronicas.created_at,

            // Datos del pago relacionado
            pago_fecha: pagos_credito.fecha_pago,
            pago_monto_boleta: pagos_credito.monto_boleta,
            pago_mes_pagado: pagos_credito.mes_pagado,
          })
          .from(facturas_electronicas)
          .innerJoin(
            pagos_credito,
            eq(facturas_electronicas.pago_id, pagos_credito.pago_id)
          )
          .where(eq(pagos_credito.credito_id, parseInt(creditoId)))
          .orderBy(desc(facturas_electronicas.fecha_emision));

        // 2️⃣ Calcular estadísticas
        const totalFacturas = facturas.length;
        const facturasActivas = facturas.filter(
          (f) => f.status === "ACTIVA"
        ).length;
        const facturasAnuladas = facturas.filter(
          (f) => f.status === "ANULADA"
        ).length;
        const montoTotalActivo = facturas
          .filter((f) => f.status === "ACTIVA")
          .reduce((sum, f) => sum + parseFloat(f.monto_total as string), 0);

        return {
          success: true,
          data: {
            credito_id: parseInt(creditoId),
            total_facturas: totalFacturas,
            facturas_activas: facturasActivas,
            facturas_anuladas: facturasAnuladas,
            monto_total_activo: montoTotalActivo,
            facturas,
          },
          mensaje: `${totalFacturas} facturas encontradas para el crédito`,
        };
      } catch (error) {
        console.error("❌ Error:", error);
        return {
          success: false,
          error: (error as Error).message,
        };
      }
    },
    {
      params: t.Object({
        creditoId: t.String(),
      }),
    }
  )

  // 🔥 POST - Consultar NIT
  // 🔥 POST - Consultar NIT
  .post(
    "/consultarNit",
    async ({ body }) => {
      // 👈 Usar kebab-case para consistencia
      try {
        const { nit } = body;

        console.log("🔍 Consultando NIT en COFIDI:", nit);

        // Validar formato de NIT (básico)
        if (!nit || nit.length < 5) {
          return {
            success: false,
            mensaje: "NIT inválido",
          };
        }

        // Crear cliente SOAP
        const nitClient = new NITSoapClient(COFIDI_CONFIG.endpointUrl);

        // Consultar NIT
        const resultado = await nitClient.consultarNIT({
          nit: nit,
          entity: COFIDI_CONFIG.entity,
          requestor: COFIDI_CONFIG.requestor,
        });

        if (resultado.success && resultado.nombre) {
          return {
            success: true,
            data: {
              nit: nit,
              nombre: resultado.nombre,
            },
            mensaje: "NIT consultado exitosamente",
          };
        } else {
          return {
            success: false,
            mensaje: resultado.error || "NIT no encontrado en el registro",
            data: {
              nit: nit,
              nombre: null,
            },
          };
        }
      } catch (error) {
        console.error("❌ Error al consultar NIT:", error);
        return {
          success: false,
          mensaje: "Error al consultar NIT",
          error: (error as Error).message,
        };
      }
    },
    {
      body: t.Object({
        nit: t.String(),
      }),
    }
  )
  // 🧪 ENDPOINT DE PRUEBA - Certificar con valores conocidos que funcionan
  .post(
    "/test-certificacion",
    async ({ body, set }) => {
      try {
        console.log("🧪 ========== TEST DE CERTIFICACIÓN ==========");
        console.log("📝 Usando valores EXACTOS del JSON que funciona");

        // ============================================
        // 🔥 VALORES EXACTOS DEL JSON QUE FUNCIONÓ
        // ============================================
        const itemsTest = [
          {
            numeroLinea: 1,
            bienOServicio: "B",
            cantidad: 1,
            unidadMedida: "UND",
            descripcion: "Producto a crédito",
            precioUnitario: 5000.0,
            precio: 5000.0,
            descuento: 0,
            impuestos: [
              {
                nombreCorto: "IVA",
                codigoUnidadGravable: 1,
                montoGravable: 4464.29,
                montoImpuesto: 535.71,
              },
            ],
            total: 5000.0,
          },
        ];

        const receptorTest = {
          idReceptor: "800000001026",
          nombreReceptor: "CLIENTE DE PRUEBA SA",
        };

        const complementosTest = [
          {
            tipo: "cambiario",
            abonos: [
              {
                numeroAbono: 1,
                fechaVencimiento: "2025-01-16",
                montoAbono: 1000.0,
              },
              {
                numeroAbono: 2,
                fechaVencimiento: "2025-02-16",
                montoAbono: 1000.0,
              },
              {
                numeroAbono: 3,
                fechaVencimiento: "2025-03-16",
                montoAbono: 1000.0,
              },
              {
                numeroAbono: 4,
                fechaVencimiento: "2025-04-16",
                montoAbono: 1000.0,
              },
              {
                numeroAbono: 5,
                fechaVencimiento: "2025-05-16",
                montoAbono: 1000.0,
              },
            ],
          },
        ];

        console.log("✅ Items configurados:", itemsTest.length);
        console.log("✅ Total de abonos:", complementosTest[0].abonos.length);
        console.log("✅ Gran Total:", itemsTest[0].total);

        // ============================================
        // 📤 CERTIFICAR
        // ============================================
        try {
          const resultado = await certificarFacturaHelper({
            pago_id: 999999, // ID de prueba
            receptor: receptorTest,
            items: itemsTest,
            complementos: complementosTest,
            created_by: body.created_by || 1,
          });

          console.log("🎉 ========== CERTIFICACIÓN EXITOSA ==========");
          console.log(`✅ Serie: ${resultado.serie}`);
          console.log(`✅ Número: ${resultado.numero}`);
          console.log(`✅ UUID: ${resultado.uuid}`);
          console.log(`✅ Total: Q${resultado.monto_total}`);

          return {
            success: true,
            mensaje: "¡Certificación de prueba EXITOSA! 🎉",
            data: {
              factura_id: resultado.factura_id,
              serie: resultado.serie,
              numero: resultado.numero,
              uuid: resultado.uuid,
              monto_total: resultado.monto_total,
              monto_iva: resultado.monto_iva,
              pdfUrl: resultado.pdfUrl,
              receptor: resultado.receptor,
            },
          };
        } catch (certError: any) {
          console.error("❌ ========== CERTIFICACIÓN FALLÓ ==========");
          console.error("Error:", certError.message);

          set.status = 500;
          return {
            success: false,
            mensaje: "Certificación de prueba FALLÓ",
            error: certError.message,
            detalles: {
              nota: "Si este test falla, el problema está en la configuración de COFIDI para este NIT",
              items_enviados: itemsTest,
              receptor_enviado: receptorTest,
              complementos_enviados: complementosTest,
            },
          };
        }
      } catch (error) {
        console.error("❌ Error en test de certificación:", error);
        set.status = 500;
        return {
          success: false,
          error: (error as Error).message,
          stack: (error as Error).stack,
        };
      }
    },
    {
      body: t.Object({
        created_by: t.Optional(t.Number()),
      }),
    }
  )
  // 🔥 GET - Obtener pago con TODAS sus facturas
  .get(
    "/pago-completo/:pagoId",
    async ({ params, set }) => {
      try {
        const { pagoId } = params;

        console.log("📋 ========== OBTENIENDO PAGO COMPLETO ==========");
        console.log(`📝 Pago ID: ${pagoId}`);

        // ============================================
        // 1️⃣ OBTENER DATOS DEL PAGO
        // ============================================
        const [pagoData] = await db
          .select({
            // Datos del pago
            pago_id: pagos_credito.pago_id,
            credito_id: pagos_credito.credito_id,
            monto_boleta: pagos_credito.monto_boleta,
            fecha_pago: pagos_credito.fecha_pago,
            fecha_vencimiento: pagos_credito.fecha_vencimiento,
            mes_pagado: pagos_credito.mes_pagado,
            validationStatus: pagos_credito.validationStatus,

            // Montos
            abono_capital: pagos_credito.abono_capital,
            abono_seguro: pagos_credito.abono_seguro,
            abono_gps: pagos_credito.abono_gps,
            membresias_pago: pagos_credito.membresias_pago,
            mora: pagos_credito.mora,
            abono_interes: pagos_credito.abono_interes,
            abono_iva_12: pagos_credito.abono_iva_12,

            // Datos del cliente
            usuario_id: usuarios.usuario_id,
            nombre_cliente: usuarios.nombre,
            nit_cliente: usuarios.nit,
            direccion_cliente: usuarios.direccion,

            // Datos del crédito
          })
          .from(pagos_credito)
          .innerJoin(
            creditos,
            eq(pagos_credito.credito_id, creditos.credito_id)
          )
          .innerJoin(usuarios, eq(creditos.usuario_id, usuarios.usuario_id))
          .where(eq(pagos_credito.pago_id, parseInt(pagoId)));

        if (!pagoData) {
          set.status = 404;
          return {
            success: false,
            error: "Pago no encontrado",
          };
        }

        console.log(`✅ Pago encontrado - Cliente: ${pagoData.nombre_cliente}`);

        // ============================================
        // 2️⃣ OBTENER FACTURAS DEL PAGO
        // ============================================
        const facturas = await db
          .select({
            factura_id: facturas_electronicas.factura_id,
            serie: facturas_electronicas.serie,
            numero: facturas_electronicas.numero,
            uuid: facturas_electronicas.uuid,
            tipo_documento: facturas_electronicas.tipo_documento,
            monto_total: facturas_electronicas.monto_total,
            monto_iva: facturas_electronicas.monto_iva,
            pdf_url: facturas_electronicas.pdf_url,
            receptor_nit: facturas_electronicas.receptor_nit,
            receptor_nombre: facturas_electronicas.receptor_nombre,
            fecha_emision: facturas_electronicas.fecha_emision,
            fecha_certificacion: facturas_electronicas.fecha_certificacion,
            status: facturas_electronicas.status,
            fecha_anulacion: facturas_electronicas.fecha_anulacion,
            motivo_anulacion: facturas_electronicas.motivo_anulacion,
            created_at: facturas_electronicas.created_at,
          })
          .from(facturas_electronicas)
          .where(and(
            eq(facturas_electronicas.pago_id, parseInt(pagoId)),
            eq(facturas_electronicas.status, "ACTIVA")
          ))
          .orderBy(desc(facturas_electronicas.fecha_emision));

        console.log(`📄 ${facturas.length} facturas encontradas`);

        // ============================================
        // 3️⃣ CALCULAR ESTADÍSTICAS
        // ============================================
        const facturasActivas = facturas.filter((f) => f.status === "ACTIVA");
        const facturasAnuladas = facturas.filter((f) => f.status === "ANULADA");

        const montoTotalFacturado = facturasActivas.reduce(
          (sum, f) => sum + parseFloat(f.monto_total as string),
          0
        );

        const montoIvaFacturado = facturasActivas.reduce(
          (sum, f) => sum + parseFloat(f.monto_iva as string),
          0
        );

        // ============================================
        // 4️⃣ RESPUESTA COMPLETA
        // ============================================
        return {
          success: true,
          data: {
            // 📝 INFORMACIÓN DEL PAGO
            pago: {
              pago_id: pagoData.pago_id,
              credito_id: pagoData.credito_id,
              mes_pagado: pagoData.mes_pagado,
              fecha_pago: pagoData.fecha_pago,
              fecha_vencimiento: pagoData.fecha_vencimiento,
              monto_boleta: pagoData.monto_boleta,
              validationStatus: pagoData.validationStatus,

              // Desglose de montos
              desglose: {
                abono_capital: pagoData.abono_capital,
                abono_seguro: pagoData.abono_seguro,
                abono_gps: pagoData.abono_gps,
                membresias_pago: pagoData.membresias_pago,
                mora: pagoData.mora,
                abono_interes: pagoData.abono_interes,
                abono_iva_12: pagoData.abono_iva_12,
              },
            },

            // 👤 INFORMACIÓN DEL CLIENTE
            cliente: {
              usuario_id: pagoData.usuario_id,
              nombre: pagoData.nombre_cliente,
              nit: pagoData.nit_cliente,
              direccion: pagoData.direccion_cliente,
            },

            // 💳 INFORMACIÓN DEL CRÉDITO
            credito: {
              credito_id: pagoData.credito_id,
            },

            // 📄 FACTURAS (LO IMPORTANTE 🔥)
            facturas: {
              total: facturas.length,
              activas: facturasActivas.length,
              anuladas: facturasAnuladas.length,

              estadisticas: {
                monto_total_facturado: montoTotalFacturado.toFixed(2),
                monto_iva_facturado: montoIvaFacturado.toFixed(2),
              },

              listado: facturas.map((f) => ({
                factura_id: f.factura_id,
                serie: f.serie,
                numero: f.numero,
                uuid: f.uuid,
                tipo_documento: f.tipo_documento,
                monto_total: f.monto_total,
                monto_iva: f.monto_iva,
                pdf_url: f.pdf_url,
                receptor_nit: f.receptor_nit,
                receptor_nombre: f.receptor_nombre,
                status: f.status,
                fecha_emision: f.fecha_emision,
                fecha_certificacion: f.fecha_certificacion,
                fecha_anulacion: f.fecha_anulacion,
                motivo_anulacion: f.motivo_anulacion,
                created_at: f.created_at,

                // 🔗 Links útiles
                link_pdf: f.pdf_url,
                link_fel: `https://portal.cofidiguatemala.com/factura/getdte?getinvoice=${f.uuid}`,
              })),
            },
          },
          mensaje: `Pago ${pagoId} con ${facturas.length} factura(s) - ${facturasActivas.length} activas, ${facturasAnuladas.length} anuladas`,
        };
      } catch (error) {
        console.error("❌ Error obteniendo pago completo:", error);
        set.status = 500;
        return {
          success: false,
          error: (error as Error).message,
        };
      }
    },
    {
      params: t.Object({
        pagoId: t.String(),
      }),
    }
  )

  // ============================================
  // 🔥 POST - Facturar Genérico (sin pago asociado)
  // ============================================
  .post(
    "/facturar-generico",
    async ({ body, set, request }) => {
      try {
        const { nit, items: itemsInput, created_by: bodyCreatedBy, emisor, credito_nuevo} = body;

        // Si no viene created_by en el body, extraerlo del token
        let created_by = bodyCreatedBy;
        if (!created_by) {
          const authHeader = request.headers.get("Authorization");
          if (authHeader && authHeader.startsWith("Bearer ")) {
            try {
              const token = authHeader.replace("Bearer ", "").trim();
              const decoded = jwt.verify(token, JWT_SECRET) as { id: number };
              created_by = decoded.id;
              console.log(`🔐 Usuario extraído del token: ${created_by}`);
            } catch (tokenError) {
              console.error("⚠️ Error decodificando token:", tokenError);
            }
          }
        }

        console.log("🔥 ========== FACTURANDO GENÉRICO ==========");

        // 🔥 Obtener configuración del emisor
        const emisorKey = emisor.toUpperCase() as keyof typeof EMISORES_CONFIG;
        const emisorConfig = EMISORES_CONFIG[emisorKey];

        console.log(`📝 NIT: ${nit} | Items: ${itemsInput.length} | Usuario: ${created_by || "N/A"}`);
        console.log(`🏢 Emisor: ${emisorKey} (${emisorConfig.config.emisor.nombreEmisor})`);

        // ============================================
        // 1️⃣ VALIDAR NIT Y CONSULTAR EN COFIDI
        // ============================================
        const nitNormalizado = (nit || "").trim().replace(/-/g, "").toUpperCase();

        if (!nitNormalizado || nitNormalizado === "CF") {
          set.status = 400;
          return {
            success: false,
            error: "NIT requerido. No se permite facturar a Consumidor Final (CF) en facturas genéricas.",
          };
        }

        const nitClient = new NITSoapClient(COFIDI_CONFIG.endpointUrl);
        const resultadoNit = await nitClient.consultarNIT({
          nit: nitNormalizado,
          entity: COFIDI_CONFIG.entity,
          requestor: COFIDI_CONFIG.requestor,
        });

        if (!resultadoNit.success || !resultadoNit.nombre) {
          set.status = 400;
          return {
            success: false,
            error: `NIT "${nitNormalizado}" no encontrado en SAT. No se puede facturar.`,
          };
        }

        const nombreReceptor = resultadoNit.nombre;
        console.log(`✅ NIT validado en SAT: ${nombreReceptor}`);

        // ============================================
        // 2️⃣ CONSTRUIR RECEPTOR
        // ============================================
        const receptor = {
          idReceptor: nitNormalizado,
          nombreReceptor,
        };

        console.log(`👤 Receptor: ${receptor.nombreReceptor} (${receptor.idReceptor})`);

        // ============================================
        // 3️⃣ CONSTRUIR ITEMS CON IVA CALCULADO
        // ============================================
        const Big = (await import("big.js")).default;
        Big.DP = 20;
        Big.RM = Big.roundHalfUp;

        const calcularIvaExacto = (totalConIva: number) => {
          const total = new Big(totalConIva);
          const montoGravable = total.div("1.12").round(2, Big.roundHalfUp);
          const montoImpuesto = montoGravable.times("0.12").round(2, Big.roundHalfUp);
          const totalCalculado = montoGravable.plus(montoImpuesto);
          const diferencia = total.minus(totalCalculado);

          let montoGravableFinal = montoGravable;
          if (!diferencia.eq(0)) {
            montoGravableFinal = montoGravable.plus(diferencia);
          }

          return {
            precioUnitario: parseFloat(total.toFixed(2)),
            precio: parseFloat(total.toFixed(2)),
            montoGravable: parseFloat(montoGravableFinal.toFixed(2)),
            montoImpuesto: parseFloat(montoImpuesto.toFixed(2)),
            total: parseFloat(total.toFixed(2)),
          };
        };

        let totalFactura = new Big(0);
        const itemsFactura = itemsInput.map((item: FacturarGenericoItem, index: number) => {
          const calc = calcularIvaExacto(item.monto);
          totalFactura = totalFactura.plus(calc.total);

          console.log(`   📦 Item ${index + 1}: ${item.rubro} - Q${calc.total}`);

          return {
            numeroLinea: index + 1,
            bienOServicio: "B",
            cantidad: 1,
            unidadMedida: "UND",
            descripcion: item.rubro,
            precioUnitario: calc.precioUnitario,
            precio: calc.precio,
            descuento: 0,
            impuestos: [
              {
                nombreCorto: "IVA",
                codigoUnidadGravable: 1,
                montoGravable: calc.montoGravable,
                montoImpuesto: calc.montoImpuesto,
              },
            ],
            total: calc.total,
          };
        });

        console.log(`💰 Total factura: Q${totalFactura.toFixed(2)}`);

        // ============================================
        // 4️⃣ CONSTRUIR COMPLEMENTOS (1 ABONO, FECHA HOY)
        // ============================================
        const fechaHoy = new Date().toISOString().split("T")[0];

        const complementos = [
          {
            tipo: "cambiario",
            abonos: [
              {
                numeroAbono: 1,
                fechaVencimiento: fechaHoy,
                montoAbono: parseFloat(totalFactura.toFixed(2)),
              },
            ],
          },
        ];

        // ============================================
        // 5️⃣ CERTIFICAR FACTURA (con emisor seleccionado)
        // ============================================
        const resultado = await certificarFacturaHelper({
          pago_id: null,
          receptor,
          items: itemsFactura,
          complementos,
          created_by,
          customConfig: emisorKey !== "CUBE" ? emisorConfig.config : undefined,
          customSatConfig: emisorKey !== "CUBE" ? emisorConfig.satConfig : undefined,
          usarFechaActual: credito_nuevo,
        });

        console.log("🎉 ========== FACTURA GENÉRICA GENERADA ==========");
        console.log(`✅ Serie: ${resultado.serie}-${resultado.numero}`);
        console.log(`✅ UUID: ${resultado.uuid}`);

        return {
          success: true,
          data: {
            factura_id: resultado.factura_id,
            serie: resultado.serie,
            numero: resultado.numero,
            uuid: resultado.uuid,
            monto_total: resultado.monto_total,
            monto_iva: resultado.monto_iva,
            pdf_url: resultado.pdfUrl,
            receptor: resultado.receptor,
            items_facturados: itemsInput.length,
            emisor: {
              key: emisorKey,
              nombre: emisorConfig.config.emisor.nombreEmisor,
              nit: emisorConfig.config.emisor.nit,
            },
          },
          mensaje: `Factura ${resultado.serie}-${resultado.numero} generada exitosamente por ${emisorConfig.config.emisor.nombreEmisor}`,
        };

      } catch (error) {
        console.error("❌ Error facturando genérico:", error);
        set.status = 500;
        return {
          success: false,
          error: (error as Error).message,
          stack: (error as Error).stack,
        };
      }
    },
    {
      body: t.Object({
        nit: t.String(),
        items: t.Array(
          t.Object({
            monto: t.Number(),
            rubro: t.String(),
          })
        ),
        created_by: t.Optional(t.Number()),
        emisor: t.Union([
          t.Literal("CUBE"),
          t.Literal("SE_PRESTA"),
          t.Literal("AMJK"),
          t.Literal("CREACION_IMAGEN"),
          t.Literal("GRUPO_BATRO"),
          t.Literal("AUTOCASH"),
        ]),
        credito_nuevo: t.Optional(t.Boolean({ default: false })),
      }),
    }
  )

  // ============================================
  // 🔥 GET - Obtener facturas por usuario o NIT
  // ============================================
  .get(
    "/facturas-genericas",
    async ({ query, set }) => {
      try {
        const { created_by, nit, fecha_inicio, fecha_fin, excel, tipo, page = "1", limit = "10" } = query;
        const isExcel = excel === "true";

        // Paginación (solo si no es Excel)
        const pageNum = Math.max(1, parseInt(page));
        const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
        const offset = (pageNum - 1) * limitNum;

        console.log("📋 ========== BUSCANDO FACTURAS ==========");
        console.log(`👤 Usuario: ${created_by || "N/A"} | 🏷️ NIT: ${nit || "N/A"}`);
        console.log(`📅 Desde: ${fecha_inicio || "N/A"} | Hasta: ${fecha_fin || "N/A"}`);
        console.log(`📊 Excel: ${isExcel} | 📄 Página: ${pageNum} | Límite: ${limitNum}`);

        // Construir condiciones dinámicamente
        const conditions = [eq(facturas_electronicas.status, "ACTIVA")];

        if (created_by) {
          conditions.push(eq(facturas_electronicas.created_by, parseInt(created_by)));
        }

        if (nit) {
          conditions.push(eq(facturas_electronicas.receptor_nit, nit));
        }

        if (fecha_inicio) {
          conditions.push(gte(facturas_electronicas.fecha_emision, new Date(fecha_inicio)));
        }

        if (fecha_fin) {
          const fin = new Date(fecha_fin);
          fin.setHours(23, 59, 59, 999);
          conditions.push(lte(facturas_electronicas.fecha_emision, fin));
        }

        if (tipo === "pago") {
          conditions.push(sql`${facturas_electronicas.pago_id} IS NOT NULL`);
        } else if (tipo === "credito_nuevo") {
          conditions.push(sql`${facturas_electronicas.pago_id} IS NULL`);
        }

        // Contar total de registros
        const [{ count: totalCount }] = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(facturas_electronicas)
          .where(and(...conditions));

        // Obtener facturas (sin paginación si es Excel)
        const baseQuery = db
          .select({
            factura_id: facturas_electronicas.factura_id,
            pago_id: facturas_electronicas.pago_id,
            serie: facturas_electronicas.serie,
            numero: facturas_electronicas.numero,
            uuid: facturas_electronicas.uuid,
            tipo_documento: facturas_electronicas.tipo_documento,
            monto_total: facturas_electronicas.monto_total,
            monto_iva: facturas_electronicas.monto_iva,
            pdf_url: facturas_electronicas.pdf_url,
            receptor_nit: facturas_electronicas.receptor_nit,
            receptor_nombre: facturas_electronicas.receptor_nombre,
            fecha_emision: facturas_electronicas.fecha_emision,
            fecha_certificacion: facturas_electronicas.fecha_certificacion,
            status: facturas_electronicas.status,
            emisor_nit: facturas_electronicas.emisor_nit,
            emisor_nombre: facturas_electronicas.emisor_nombre,
            created_by: facturas_electronicas.created_by,
            created_at: facturas_electronicas.created_at,
          })
          .from(facturas_electronicas)
          .where(and(...conditions))
          .orderBy(desc(facturas_electronicas.fecha_emision));

        const facturas = isExcel
          ? await baseQuery
          : await baseQuery.limit(limitNum).offset(offset);

        console.log(`✅ ${facturas.length} facturas ${isExcel ? "para Excel" : `en página ${pageNum}`}`);

        // ============================================
        // 📊 GENERAR EXCEL
        // ============================================
        if (isExcel) {
          const workbook = new ExcelJS.Workbook();
          const sheet = workbook.addWorksheet("Facturas");

          // Logo
          const logoUrl = process.env.LOGO_URL || "";
          if (logoUrl) {
            try {
              const logoResponse = await fetch(logoUrl);
              const logoBuffer = Buffer.from(await logoResponse.arrayBuffer());
              const logoImage = workbook.addImage({
                base64: `data:image/png;base64,${logoBuffer.toString("base64")}`,
                extension: "png",
              });
              sheet.addImage(logoImage, {
                tl: { col: 0, row: 0 },
                ext: { width: 180, height: 50 },
              });
            } catch (e) {
              console.log("⚠️ No se pudo cargar el logo:", e);
            }
          }

          // Espacio para el logo
          sheet.addRow([]);
          sheet.addRow([]);
          sheet.addRow([]);

          // Título
          const rangoFechas = fecha_inicio && fecha_fin
            ? `Del ${fecha_inicio} al ${fecha_fin}`
            : fecha_inicio
            ? `Desde ${fecha_inicio}`
            : fecha_fin
            ? `Hasta ${fecha_fin}`
            : "Todas las fechas";

          const titleRow = sheet.addRow(["REPORTE DE FACTURAS ELECTRÓNICAS"]);
          titleRow.font = { bold: true, size: 14, color: { argb: "FF1A3C7A" } };
          sheet.mergeCells(titleRow.number, 1, titleRow.number, 15);
          titleRow.alignment = { horizontal: "center" };

          const subtitleRow = sheet.addRow([`${rangoFechas} | ${facturas.length} facturas | NIT: ${nit || "Todos"}`]);
          subtitleRow.font = { size: 10, color: { argb: "FF666666" } };
          sheet.mergeCells(subtitleRow.number, 1, subtitleRow.number, 15);
          subtitleRow.alignment = { horizontal: "center" };

          sheet.addRow([]);

          // Headers
          const headers = [
            "No.", "NIT Emisor", "Emisor", "Serie", "Número", "UUID", "Tipo Doc.",
            "NIT Receptor", "Nombre Receptor", "Subtotal",
            "IVA (12%)", "Total", "Tipo", "Fecha Emisión", "Fecha Certificación",
          ];

          const headerRow = sheet.addRow(headers);
          headerRow.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 10 };
          headerRow.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "FF1A3C7A" },
          };
          headerRow.alignment = { horizontal: "center", vertical: "middle" };
          headerRow.height = 25;

          // Data
          let totalMonto = 0;
          let totalIva = 0;

          facturas.forEach((f, index) => {
            const montoTotal = parseFloat(f.monto_total as string);
            const montoIva = parseFloat(f.monto_iva as string);
            const subtotal = montoTotal - montoIva;
            totalMonto += montoTotal;
            totalIva += montoIva;

            const row = sheet.addRow([
              index + 1,
              f.emisor_nit || "N/A",
              f.emisor_nombre || "N/A",
              f.serie,
              f.numero,
              f.uuid,
              f.tipo_documento,
              f.receptor_nit,
              f.receptor_nombre,
              subtotal,
              montoIva,
              montoTotal,
              f.pago_id ? "Pago de cuota" : "Crédito nuevo",
              f.fecha_emision ? new Date(f.fecha_emision).toLocaleDateString("es-GT", { timeZone: "America/Guatemala" }) : "",
              f.fecha_certificacion ? new Date(f.fecha_certificacion).toLocaleDateString("es-GT", { timeZone: "America/Guatemala" }) : "",
            ]);

            if (index % 2 === 0) {
              row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF5F7FA" } };
            }
            row.getCell(10).numFmt = "Q#,##0.00";
            row.getCell(11).numFmt = "Q#,##0.00";
            row.getCell(12).numFmt = "Q#,##0.00";
          });

          // Totales
          sheet.addRow([]);
          const totalsRow = sheet.addRow([
            "", "", "", "", "", "", "", "", "TOTALES:",
            totalMonto - totalIva, totalIva, totalMonto, "", "", "",
          ]);
          totalsRow.font = { bold: true, size: 11 };
          totalsRow.getCell(9).alignment = { horizontal: "right" };
          totalsRow.getCell(10).numFmt = "Q#,##0.00";
          totalsRow.getCell(11).numFmt = "Q#,##0.00";
          totalsRow.getCell(12).numFmt = "Q#,##0.00";
          totalsRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8EDF5" } };

          // Auto-width
          sheet.columns.forEach((col) => {
            let maxLength = 12;
            col.eachCell?.({ includeEmpty: true }, (cell) => {
              const len = cell.value ? cell.value.toString().length : 0;
              if (len > maxLength) maxLength = len;
            });
            col.width = Math.min(maxLength + 2, 40);
          });

          // Freeze header + bordes
          sheet.views = [{ state: "frozen", ySplit: 7 }];
          const dataStart = 7;
          const dataEnd = dataStart + facturas.length;
          for (let r = dataStart; r <= dataEnd; r++) {
            const row = sheet.getRow(r);
            for (let c = 1; c <= 15; c++) {
              row.getCell(c).border = {
                top: { style: "thin", color: { argb: "FFD0D5DD" } },
                bottom: { style: "thin", color: { argb: "FFD0D5DD" } },
                left: { style: "thin", color: { argb: "FFD0D5DD" } },
                right: { style: "thin", color: { argb: "FFD0D5DD" } },
              };
            }
          }

          // Subir a R2
          const buffer = await workbook.xlsx.writeBuffer();
          const filename = `reportes/facturas_${Date.now()}.xlsx`;

          const s3 = new S3Client({
            endpoint: process.env.BUCKET_REPORTS_URL,
            region: "auto",
            credentials: {
              accessKeyId: process.env.R2_ACCESS_KEY_ID as string,
              secretAccessKey: process.env.R2_SECRET_ACCESS_KEY as string,
            },
          });

          await s3.send(
            new PutObjectCommand({
              Bucket: process.env.BUCKET_REPORTS,
              Key: filename,
              Body: Buffer.from(buffer),
              ContentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            })
          );

          const publicUrl = `${process.env.URL_PUBLIC_R2_REPORTS}/${filename}`;
          console.log(`📊 Excel generado: ${publicUrl}`);

          return {
            success: true,
            mensaje: `Excel generado con ${facturas.length} facturas`,
            url: publicUrl,
            total_facturas: facturas.length,
            monto_total: totalMonto.toFixed(2),
          };
        }

        // ============================================
        // 📄 RESPUESTA NORMAL (JSON paginado)
        // ============================================
        const montoTotalPagina = facturas.reduce(
          (sum, f) => sum + parseFloat(f.monto_total as string),
          0
        );

        const totalPages = Math.ceil(totalCount / limitNum);

        return {
          success: true,
          data: {
            pagination: {
              total_items: totalCount,
              total_pages: totalPages,
              current_page: pageNum,
              per_page: limitNum,
              has_next: pageNum < totalPages,
              has_prev: pageNum > 1,
            },
            monto_total_pagina: montoTotalPagina.toFixed(2),
            filtros: {
              created_by: created_by || null,
              nit: nit || null,
              fecha_inicio: fecha_inicio || null,
              fecha_fin: fecha_fin || null,
              tipo: tipo || null,
            },
            facturas: facturas.map((f) => ({
              ...f,
              tipo: f.pago_id ? "Pago de cuota" : "Crédito nuevo",
              link_pdf: f.pdf_url,
            })),
          },
          mensaje: `Página ${pageNum} de ${totalPages} (${totalCount} factura(s) total)`,
        };

      } catch (error) {
        console.error("❌ Error buscando facturas:", error);
        set.status = 500;
        return {
          success: false,
          error: (error as Error).message,
        };
      }
    },
    {
      query: t.Object({
        created_by: t.Optional(t.String()),
        nit: t.Optional(t.String()),
        fecha_inicio: t.Optional(t.String()),
        fecha_fin: t.Optional(t.String()),
        excel: t.Optional(t.String()),
        tipo: t.Optional(t.String()),
        page: t.Optional(t.String()),
        limit: t.Optional(t.String()),
      }),
    }
  )

;

// ============================================
// 🔥 FUNCIÓN HELPER PARA CERTIFICAR FACTURA
// ============================================
async function certificarFacturaHelper({
  pago_id,
  receptor,
  items,
  complementos,
  created_by,
  customConfig,
  customSatConfig,
  usarFechaActual = false,
  nitsFallback = [],
}: {
  pago_id?: number | null;
  receptor: any;
  items: any[];
  complementos: any[];
  created_by?: number;
  customConfig?: FacturadorConfig;
  customSatConfig?: {
    requestor: string;
    user: string;
    userName: string;
    endpointUrl: string;
    nit?: string;
    entity?: string;
  };
  usarFechaActual?: boolean;
  nitsFallback?: string[];
}) {
  try {
    console.log(`\n📄 ========== CERTIFICANDO FACTURA ==========`);

    // 🔥 Usar config personalizada o default (CUBE)
    const emisorConfig = customConfig || CLUB_CASHIN_CONFIG;
    const satConfig = customSatConfig || SAT_CONFIG;

    // ============================================
    // 1️⃣ AUTO-GENERAR CAMPOS
    // ============================================
    const idInterno = generarIdInternoRandom();
const fechaGuatemala = new Date();
fechaGuatemala.setUTCHours(fechaGuatemala.getUTCHours() - 6);

// Si estamos en los primeros 5 días del mes, usar último día del mes anterior (a menos que usarFechaActual sea true)
let fechaEmision = fechaGuatemala;
if (!usarFechaActual && fechaGuatemala.getUTCDate() <= 5) {
  fechaEmision = new Date(Date.UTC(fechaGuatemala.getUTCFullYear(), fechaGuatemala.getUTCMonth(), 0, 23, 59, 59));
}
const fechaHoraEmision = fechaEmision.toISOString().substring(0, 19);


    // ============================================
    // 2️⃣ CONSTRUIR REQUEST COMPLETO
    // ============================================
    const requestCompleto = {
      pago_id,
      created_by,
      idInterno,
      fechaHoraEmision,

      // 👇 USAR CONSTANTES DE CONFIGURACIÓN (personalizada o default)
      tipoDocumento: emisorConfig.tipoDocumento,
      codigoMoneda: emisorConfig.codigoMoneda,
      emisor: emisorConfig.emisor,
      frases: emisorConfig.frases,

      receptor,
      items,
      complementos,
    };

    console.log(`   📦 Items: ${items.length}`);
    console.log(`   📝 ID Interno: ${idInterno}`);
    console.log(`   🏢 Emisor NIT: ${emisorConfig.emisor.nit}`);
    console.log(`   🏢 Emisor: ${emisorConfig.emisor.nombreEmisor}`);

    // ============================================
    // 3️⃣ CERTIFICAR EN SAT
    // ============================================
    const satClient = new SATClientService(
      {
        requestor: satConfig.requestor,
        user: satConfig.user,
        userName: satConfig.userName,
        entity: emisorConfig.emisor.nit,
      },
      satConfig.endpointUrl
    );

    const dteService = new DTEService(satClient);

    let resultado;
    try {
      resultado = await dteService.generarYCertificarDTE(
        requestCompleto,
        idInterno
      );
      console.log(
        `   ✅ Certificado en SAT: ${resultado.serie}-${resultado.numero}`
      );
    } catch (certError: any) {
      console.error(`   ❌ Error en certificación SAT:`, certError);

      // 🔥 MEJORAR MENSAJES DE ERROR
      const errorMessage =
        certError.message || "Error desconocido en certificación";

      if (errorMessage.includes("Cuenta no se encuentra activa")) {
        throw new Error(
          `La cuenta del emisor (NIT: ${CLUB_CASHIN_CONFIG.emisor.nit}) no está activa en COFIDI. ` +
            `Por favor contacte a COFIDI para activar la cuenta antes de generar facturas.`
        );
      }

      if (errorMessage.includes("Error encontrado en usuario")) {
        throw new Error(
          `Las credenciales de certificación no son válidas. ` +
            `Verifique con COFIDI que el usuario '${SAT_CONFIG.user}' tenga permisos activos.`
        );
      }

      if (errorMessage.includes("NIT del Receptor es inválido") || errorMessage.includes("1014")) {
        // 🔥 Si hay NITs alternativos, intentar con el siguiente
        if (nitsFallback.length > 0) {
          const siguienteNit = nitsFallback[0];
          const restantesFallback = nitsFallback.slice(1);
          console.log(`   🔄 NIT "${receptor.idReceptor}" inválido, reintentando con: "${siguienteNit}"`);
          return certificarFacturaHelper({
            pago_id,
            receptor: { ...receptor, idReceptor: siguienteNit },
            items,
            complementos,
            created_by,
            customConfig,
            customSatConfig,
            usarFechaActual,
            nitsFallback: restantesFallback,
          });
        }

        // 🔥 Sin más NITs alternativos → FALLAR (NO caer en "CF")
        throw new Error(
          `NIT del receptor inválido. NIT enviado: "${receptor.idReceptor}" para "${receptor.nombreReceptor}". ` +
            `Respuesta COFIDI: ${errorMessage}`
        );
      }

      if (errorMessage.includes("Certificación falló")) {
        throw new Error(
          `Error al certificar con SAT: ${errorMessage}. ` +
            `Contacte al administrador del sistema o a COFIDI para resolver este problema.`
        );
      }

      // Error genérico
      throw new Error(`Error en certificación SAT: ${errorMessage}`);
    }

    // ============================================
    // 4️⃣ PARSEAR XML CERTIFICADO
    // ============================================
    const { XMLParser } = await import("fast-xml-parser");
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
    });
    const xmlParsed = parser.parse(resultado.xmlCertificado);

    const dte = xmlParsed["dte:GTDocumento"]["dte:SAT"]["dte:DTE"];
    const datosEmision = dte["dte:DatosEmision"];
    const certificacion = dte["dte:Certificacion"];

    const datosGenerales = datosEmision["dte:DatosGenerales"];
    const emisor = datosEmision["dte:Emisor"];
    const receptorXML = datosEmision["dte:Receptor"];
    const itemsXML = Array.isArray(datosEmision["dte:Items"]["dte:Item"])
      ? datosEmision["dte:Items"]["dte:Item"]
      : [datosEmision["dte:Items"]["dte:Item"]];
    const totales = datosEmision["dte:Totales"];

    const complementosXML = datosEmision["dte:Complementos"];
    let abonos: any[] = [];
    if (complementosXML) {
      const complemento = complementosXML["dte:Complemento"];
      const abonosData =
        complemento?.["cfc:AbonosFacturaCambiaria"]?.["cfc:Abono"];
      if (abonosData) {
        abonos = Array.isArray(abonosData) ? abonosData : [abonosData];
      }
    }

    // ============================================
    // 🔥 FUNCIÓN HELPER: Convertir fecha de SAT a hora de Guatemala
    // ============================================
    const convertirAGuatemala = (fechaSAT: string): Date => {
      // SAT devuelve formato: "2026-01-22T04:44:55" (en UTC)
      // Necesitamos convertir a Guatemala (GMT-6)
      
      let fecha = new Date(fechaSAT);
      
      // Si la fecha no tiene zona horaria explícita, JavaScript la interpreta como UTC
      // Entonces restamos 6 horas para obtener hora de Guatemala
      fecha.setHours(fecha.getHours() - 6);
      
      console.log(`   🔄 Conversión: ${fechaSAT} (SAT) -> ${fecha.toISOString()} (Guatemala GMT-6)`);
      
      return fecha;
    };

    // ============================================
    // 5️⃣ GENERAR HTML DEL PDF
    // ============================================
    const logoUrl =
      process.env.LOGO_URL ||
      "https://pub-8081c8d6e5e743f9adfc9e0db92e5a88.r2.dev/reports/logo-cashin.png";

    const html = generarHTMLFacturaPro(
      {
        tipo: datosGenerales["@_Tipo"],
        serie: certificacion["dte:NumeroAutorizacion"]["@_Serie"],
        numero: certificacion["dte:NumeroAutorizacion"]["@_Numero"],
        uuid: certificacion["dte:NumeroAutorizacion"]["#text"],
        fechaEmision: datosGenerales["@_FechaHoraEmision"],
        fechaCertificacion: certificacion["dte:FechaHoraCertificacion"],

        emisor: {
          nit: emisor["@_NITEmisor"],
          nombre: emisor["@_NombreEmisor"],
          nombreComercial: emisor["@_NombreComercial"],
          direccion: emisor["dte:DireccionEmisor"],
        },

        receptor: {
          nit: receptorXML["@_IDReceptor"],
          nombre: receptorXML["@_NombreReceptor"],
          direccion: receptorXML["dte:DireccionReceptor"]?.["dte:Direccion"],
        },

        items: itemsXML.map((item: any) => ({
          numeroLinea: item["@_NumeroLinea"],
          cantidad: item["dte:Cantidad"],
          unidad: item["dte:UnidadMedida"],
          descripcion: item["dte:Descripcion"],
          precioUnitario: parseFloat(item["dte:PrecioUnitario"]),
          total: parseFloat(item["dte:Total"]),
        })),

        totales: {
          iva: parseFloat(
            totales["dte:TotalImpuestos"]["dte:TotalImpuesto"][
              "@_TotalMontoImpuesto"
            ]
          ),
          granTotal: parseFloat(totales["dte:GranTotal"]),
        },

        // 🔥 Si no hay pago_id (factura genérica), no mostrar plan de pagos
        abonos: pago_id ? abonos.map((abono: any) => ({
          numero: abono["cfc:NumeroAbono"],
          fechaVencimiento: abono["cfc:FechaVencimiento"],
          monto: parseFloat(abono["cfc:MontoAbono"]),
        })) : [],

        certificador: {
          nit: certificacion["dte:NITCertificador"],
          nombre: certificacion["dte:NombreCertificador"],
        },
      },
      logoUrl
    );

    // ============================================
    // 6️⃣ GENERAR PDF CON PUPPETEER
    // ============================================
    console.log(`   🎨 Generando PDF...`);

    const puppeteer = await import("puppeteer");
    const browser = await puppeteer.default.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
      ],
    });

    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });

    const pdfBuffer = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: {
        top: "20px",
        bottom: "20px",
        left: "20px",
        right: "20px",
      },
    });

    await browser.close();

    console.log(`   ✅ PDF generado`);

    // ============================================
    // 7️⃣ SUBIR PDF A R2 (CLOUDFLARE)
    // ============================================
    const { S3Client, PutObjectCommand } = await import("@aws-sdk/client-s3");

    const filename = `factura_${resultado.serie}_${resultado.numero}.pdf`;

    const s3 = new S3Client({
      endpoint: process.env.BUCKET_REPORTS_URL,
      region: "auto",
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID as string,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY as string,
      },
    });

    await s3.send(
      new PutObjectCommand({
        Bucket: process.env.BUCKET_REPORTS,
        Key: filename,
        Body: pdfBuffer,
        ContentType: "application/pdf",
      })
    );

    const pdfUrl = `${process.env.URL_PUBLIC_R2_REPORTS}/${filename}`;

    console.log(`   ✅ PDF subido a R2: ${filename}`);

    // ============================================
    // 8️⃣ GUARDAR EN BASE DE DATOS (🔥 CON CONVERSIÓN A GUATEMALA)
    // ============================================
    console.log('🔍 ========== FECHAS DE SAT (ANTES DE CONVERSIÓN) ==========');
    console.log('📅 Fecha emisión (SAT):', datosGenerales["@_FechaHoraEmision"]);
    console.log('📅 Fecha certificación (SAT):', certificacion["dte:FechaHoraCertificacion"]);

    const [facturaGuardada] = await db
      .insert(facturas_electronicas)
      .values({
        pago_id: pago_id ?? null,
        serie: resultado.serie,
        numero: resultado.numero.toString(),
        uuid: resultado.uuid,
        tipo_documento: datosGenerales["@_Tipo"],
        monto_total: parseFloat(totales["dte:GranTotal"]).toString(),
        monto_iva: parseFloat(
          totales["dte:TotalImpuestos"]["dte:TotalImpuesto"][
            "@_TotalMontoImpuesto"
          ]
        ).toString(),
        pdf_url: pdfUrl,
        emisor_nit: emisorConfig.emisor.nit,
        emisor_nombre: emisorConfig.emisor.nombreEmisor,
        receptor_nit: receptorXML["@_IDReceptor"],
        receptor_nombre: receptorXML["@_NombreReceptor"],

        // 🔥 CONVERTIR A HORA DE GUATEMALA ANTES DE GUARDAR
        fecha_emision: new Date(datosGenerales["@_FechaHoraEmision"]),
        fecha_certificacion: convertirAGuatemala(certificacion["dte:FechaHoraCertificacion"]),

        status: "ACTIVA",
        created_by: created_by || null,
      })
      .returning();

    console.log(`   ✅ Factura guardada en BD - ID: ${facturaGuardada.factura_id}`);
    console.log('📅 Fecha certificación guardada (Guatemala):', facturaGuardada.fecha_certificacion);

    // ============================================
    // 9️⃣ RETORNAR RESULTADO
    // ============================================
    return {
      factura_id: facturaGuardada.factura_id,
      idInterno: idInterno,
      serie: resultado.serie,
      numero: resultado.numero,
      uuid: resultado.uuid,
      xmlCertificado: resultado.xmlCertificado,
      fechaEmision: fechaHoraEmision,
      pdfUrl: pdfUrl,
      pdfFilename: filename,
      monto_total: parseFloat(totales["dte:GranTotal"]),
      monto_iva: parseFloat(
        totales["dte:TotalImpuestos"]["dte:TotalImpuesto"][
          "@_TotalMontoImpuesto"
        ]
      ),
      receptor: {
        nombre: receptorXML["@_NombreReceptor"],
        nit: receptorXML["@_IDReceptor"],
      },
    };
  } catch (error) {
    console.error(`❌ Error certificando factura:`, error);
    throw error;
  }
}
