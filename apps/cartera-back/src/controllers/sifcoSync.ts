import { sifcoDb } from "../database/sifco";
import {
  clientes,
  prestamos,
  recargos,
  estado_cuenta_transacciones,
  estado_cuenta_detalles,
  plan_pagos,
  plan_pagos_otros,
} from "../database/sifco/schema";
import {
  consultarClientesPorEmail,
  consultarPrestamosPorCliente,
  consultarPrestamoDetalle,
  consultarRecargosLibres,
  consultarEstadoCuentaPrestamo,
} from "../services/sifcoIntegrations";
import { eq, sql } from "drizzle-orm";
import { writeFileSync } from "fs";
import { join } from "path";

interface SyncExito {
  codigoCliente: string;
  nombre: string;
  prestamos: {
    preNumero: string;
    detalle: boolean;
    recargos: number;
    transacciones: number;
    detallesTransaccion: number;
    cuotasPlanPago: number;
    otrosCargos: number;
  }[];
  timestamp: string;
}

interface SyncError {
  codigoCliente: string;
  nombre: string;
  preNumero?: string;
  paso: string;
  error: string;
  stack?: string;
  timestamp: string;
}

/**
 * Sincroniza TODOS los clientes de SIFCO.
 * Genera dos archivos JSON: éxitos y errores.
 */
export async function syncTodosLosClientes() {
  const exitos: SyncExito[] = [];
  const errores: SyncError[] = [];
  const outputDir = join(process.cwd(), "src", "scripts");

  console.log("🚀 Iniciando sincronización masiva de SIFCO...");

  // Paso 1: Traer todos los clientes
  const clientesResp = await consultarClientesPorEmail();
  if (!clientesResp?.Clientes?.length) {
    throw new Error("No se pudo obtener la lista de clientes de SIFCO");
  }

  const totalClientes = clientesResp.Clientes.length;
  console.log(`📋 ${totalClientes} clientes encontrados en SIFCO`);

  // Paso 2: Iterar cada cliente
  for (let i = 0; i < totalClientes; i++) {
    const cliente = clientesResp.Clientes[i];
    const progreso = `[${i + 1}/${totalClientes}]`;

    try {
      console.log(`${progreso} Procesando: ${cliente.CodigoCliente} - ${cliente.NombreCompleto}`);
      const resultado = await syncClienteCompleto(cliente);

      exitos.push({
        codigoCliente: cliente.CodigoCliente,
        nombre: cliente.NombreCompleto,
        prestamos: resultado.prestamosDetalle,
        timestamp: new Date().toISOString(),
      });

      console.log(`${progreso} ✅ ${cliente.NombreCompleto} - ${resultado.prestamosDetalle.length} préstamo(s)`);
    } catch (error: any) {
      errores.push({
        codigoCliente: cliente.CodigoCliente,
        nombre: cliente.NombreCompleto,
        paso: "syncClienteCompleto",
        error: error.message,
        stack: error.stack,
        timestamp: new Date().toISOString(),
      });

      console.error(`${progreso} ❌ ${cliente.NombreCompleto}: ${error.message}`);
    }

    // Guardar archivos cada 50 clientes (por si se cae)
    if ((i + 1) % 50 === 0 || i === totalClientes - 1) {
      writeFileSync(join(outputDir, "sifco-sync-success.json"), JSON.stringify(exitos, null, 2));
      writeFileSync(join(outputDir, "sifco-sync-errors.json"), JSON.stringify(errores, null, 2));
    }
  }

  // Guardar archivos finales
  writeFileSync(join(outputDir, "sifco-sync-success.json"), JSON.stringify(exitos, null, 2));
  writeFileSync(join(outputDir, "sifco-sync-errors.json"), JSON.stringify(errores, null, 2));

  const resumen = {
    totalClientes,
    exitosos: exitos.length,
    fallidos: errores.length,
    archivos: {
      exitos: "src/scripts/sifco-sync-success.json",
      errores: "src/scripts/sifco-sync-errors.json",
    },
  };

  console.log(`\n🏁 Sincronización finalizada:`, resumen);
  return resumen;
}

/**
 * Sincroniza un cliente completo desde SIFCO:
 * 1. Inserta el cliente
 * 2. Trae sus préstamos
 * 3. Por cada préstamo: detalle, recargos, estado de cuenta
 */
export async function syncClienteCompleto(clienteSifco: {
  CodigoCliente: string;
  NombreCompleto: string;
  CodigoReferencia: string;
  DireccionEMailPrincipal: string;
  DireccionEMailSecundario: string;
  ExcluirDeMensajesDeCorreo: number;
}) {
  const pasos: string[] = [];
  const prestamosDetalle: SyncExito["prestamos"] = [];
  const codigoCliente = clienteSifco.CodigoCliente;

  // ── Paso 1: Guardar cliente ──
  await sifcoDb
    .insert(clientes)
    .values({
      codigo_cliente: clienteSifco.CodigoCliente,
      nombre_completo: clienteSifco.NombreCompleto,
      codigo_referencia: clienteSifco.CodigoReferencia,
      email_principal: clienteSifco.DireccionEMailPrincipal,
      email_secundario: clienteSifco.DireccionEMailSecundario,
      excluir_correos: clienteSifco.ExcluirDeMensajesDeCorreo,
    })
    .onConflictDoUpdate({
      target: clientes.codigo_cliente,
      set: {
        nombre_completo: clienteSifco.NombreCompleto,
        codigo_referencia: clienteSifco.CodigoReferencia,
        email_principal: clienteSifco.DireccionEMailPrincipal,
        email_secundario: clienteSifco.DireccionEMailSecundario,
        excluir_correos: clienteSifco.ExcluirDeMensajesDeCorreo,
        updated_at: new Date(),
      },
    });

  pasos.push(`Cliente ${codigoCliente} - ${clienteSifco.NombreCompleto} sincronizado`);

  // ── Paso 2: Traer préstamos del cliente ──
  const prestamosResp = await consultarPrestamosPorCliente(Number(codigoCliente));
  if (!prestamosResp?.Prestamos?.length) {
    return { pasos, prestamosDetalle, mensaje: "Cliente sincronizado pero no tiene préstamos" };
  }

  pasos.push(`${prestamosResp.Prestamos.length} préstamo(s) encontrado(s)`);

  // ── Paso 3: Por cada préstamo, traer detalle + recargos + estado de cuenta ──
  for (const p of prestamosResp.Prestamos) {
    const preNumero = p.NumeroPrestamo;

    // 3a. Detalle del préstamo
    const detalle = await consultarPrestamoDetalle(preNumero);
    if (!detalle) {
      pasos.push(`Préstamo ${preNumero}: no se pudo obtener detalle, saltando`);
      continue;
    }

    await sifcoDb
      .insert(prestamos)
      .values({
        pre_numero: detalle.PreNumero,
        pre_correlativo: detalle.PreCorrelativo,
        pre_nombre: detalle.PreNombre,
        pre_cli_cod: detalle.PreCliCod,
        pre_cli_nom: detalle.PreCliNom,
        pre_cli_promotor: detalle.PreCliPromotor,
        pre_prd_cod: detalle.PrePrdCod,
        pre_prd_nombre: detalle.PrePrdNombre,
        pre_prd_tipo: detalle.PrePrdTipo,
        pre_mon_original: detalle.PreMonOriginal,
        pre_mon_total: detalle.PreMonTotal,
        pre_sal_capital: detalle.PreSalCapital,
        pre_cap_atrasado: detalle.PreCapAtrasado,
        pre_val_cuota: detalle.PreValCuota,
        pre_tasa_base: detalle.PreTasaBase,
        pre_base_mora: detalle.PreBaseMora,
        pre_int_mes: detalle.PreIntMes,
        pre_int_acumulado: detalle.PreIntAcumulado,
        pre_int_vencido: detalle.PreIntVencido,
        pre_int_mora: detalle.PreIntMora,
        pre_int_anticipado: detalle.PreIntAnticipado,
        pre_int_devengado: detalle.PreIntDevengado,
        pre_plazo: detalle.PrePlazo,
        pre_num_cuotas: detalle.PreNumCuotas,
        pre_fac_plazo: detalle.PreFacPlazo,
        pre_periodo_frecuencia: detalle.PrePeriodoFrecuencia,
        pre_dia_pago: detalle.PreDiaPago,
        pre_fec_aprobacion: detalle.PreFecAprobacion,
        pre_fec_concesion: detalle.PreFecConcesion,
        pre_fec_vencimiento: detalle.PreFecVencimiento,
        pre_fec_1_cap: detalle.PreFec1Cap,
        pre_fec_1_int: detalle.PreFec1Int,
        pre_fec_p_cap: detalle.PreFecPCap,
        pre_fec_p_int: detalle.PreFecPInt,
        pre_fec_u_cap: detalle.PreFecUCap,
        pre_fec_u_int: detalle.PreFecUInt,
        pre_moneda_cod: detalle.PreMonedaCod,
        pre_moneda_nombre: detalle.PreMonedaNombre,
        pre_moneda_simbolo: detalle.PreMonedaSimbolo,
        ap_est_cod: detalle.ApEstCod,
        ap_est_des: detalle.ApEstDes,
        pre_estado: detalle.PreEstado,
        pre_anulado: detalle.PreAnulado,
        pre_gar_cod: detalle.PreGarCod,
        pre_gar_des: detalle.PreGarDes,
        ap_cac_cod: detalle.ApCaCCod,
        ap_cac_des: detalle.ApCaCDes,
        pre_numero_refinanciamiento: detalle.PreNumeroRefinanciamiento,
        pre_tipo_credito: detalle.PreTipoCredito,
        pre_referencia: detalle.PreReferencia,
        pre_ref_externo: detalle.PreRefExterno,
        pre_comentario: detalle.PreComentario,
        pre_division_destino: detalle.PreDivisionDestino,
        pre_division_origen: detalle.PreDivisionOrigen,
        pre_division_es_originado: detalle.PreDivisionEsOriginado,
        pre_division_es_originador: detalle.PreDivisionEsOriginador,
      })
      .onConflictDoUpdate({
        target: prestamos.pre_numero,
        set: {
          pre_sal_capital: detalle.PreSalCapital,
          pre_cap_atrasado: detalle.PreCapAtrasado,
          pre_int_mes: detalle.PreIntMes,
          pre_int_acumulado: detalle.PreIntAcumulado,
          pre_int_vencido: detalle.PreIntVencido,
          pre_int_mora: detalle.PreIntMora,
          pre_int_anticipado: detalle.PreIntAnticipado,
          pre_int_devengado: detalle.PreIntDevengado,
          ap_est_cod: detalle.ApEstCod,
          ap_est_des: detalle.ApEstDes,
          pre_estado: detalle.PreEstado,
          ap_cac_cod: detalle.ApCaCCod,
          ap_cac_des: detalle.ApCaCDes,
          pre_fec_p_cap: detalle.PreFecPCap,
          pre_fec_p_int: detalle.PreFecPInt,
          pre_fec_u_cap: detalle.PreFecUCap,
          pre_fec_u_int: detalle.PreFecUInt,
          updated_at: new Date(),
        },
      });

    pasos.push(`Préstamo ${preNumero}: detalle sincronizado`);

    // 3b. Recargos libres (batch insert)
    await sifcoDb.delete(recargos).where(eq(recargos.pre_numero, preNumero));

    const recargosResp = await consultarRecargosLibres(preNumero);
    if (recargosResp?.ConsultaResultados?.length) {
      await sifcoDb.insert(recargos).values(
        recargosResp.ConsultaResultados.map((r) => ({
          pre_numero: preNumero,
          nombre_prestamo: r.NombreDePrestamo,
          codigo_saldo: r.CodigoDeSaldo,
          descripcion_codigo_saldo: r.DescripcionCodigoDeSaldo,
          valor_saldo: r.ValorDeSaldo,
          fecha_proximo_pago: r.FechaProximoPago,
          fecha_ultimo_pago: r.FechaUltimoPago,
          valor_recargo_usuario: r.ValorRecargoDefinidoPorUsuario,
          usuario_actualizo: r.UsuarioQueActualizoElRecargo,
          fecha_actualizacion: r.FechaActualizacionDeRecargo,
          cuenta_acreditacion: r.CuentaAcreditacionRecargoLibre,
          nombre_cuenta_acreditacion: r.NombreCuentaAcreditacionRecargoLibre,
        }))
      );
      pasos.push(`Préstamo ${preNumero}: ${recargosResp.ConsultaResultados.length} recargo(s) sincronizado(s)`);
    } else {
      pasos.push(`Préstamo ${preNumero}: sin recargos`);
    }

    // 3c. Estado de cuenta (transacciones + plan de pagos)
    const estadoCuenta = await consultarEstadoCuentaPrestamo(preNumero);
    if (!estadoCuenta?.ConsultaResultado) {
      pasos.push(`Préstamo ${preNumero}: sin estado de cuenta`);
      continue;
    }

    // Limpiar datos anteriores (hijos primero, luego padres)
    await sifcoDb.execute(
      sql`DELETE FROM sifco.estado_cuenta_detalles WHERE transaccion_id IN (SELECT id FROM sifco.estado_cuenta_transacciones WHERE pre_numero = ${preNumero})`
    );
    await sifcoDb.delete(estado_cuenta_transacciones).where(eq(estado_cuenta_transacciones.pre_numero, preNumero));

    await sifcoDb.execute(
      sql`DELETE FROM sifco.plan_pagos_otros WHERE plan_pago_id IN (SELECT id FROM sifco.plan_pagos WHERE pre_numero = ${preNumero})`
    );
    await sifcoDb.delete(plan_pagos).where(eq(plan_pagos.pre_numero, preNumero));

    // Batch insert transacciones
    const transacciones = estadoCuenta.ConsultaResultado.EstadoCuenta_Transacciones || [];
    if (transacciones.length) {
      const BATCH_SIZE = 500;
      for (let i = 0; i < transacciones.length; i += BATCH_SIZE) {
        const batch = transacciones.slice(i, i + BATCH_SIZE);
        const insertedTrx = await sifcoDb
          .insert(estado_cuenta_transacciones)
          .values(
            batch.map((trx) => ({
              pre_numero: preNumero,
              numero_movimiento: trx.CrMoNuMov,
              usuario_cod: trx.CrMoUsuCod,
              trx_cod: trx.CrMoTrxCod,
              trx_descripcion: trx.CrMoTrxDes,
              fecha_transaccion: trx.CrMoFeTrx,
              hora_transaccion: trx.CrMoHoTrx,
              fecha_valor: trx.CrMoFeVal,
              estado: trx.CrMoEstado,
              forma_pago: trx.CrMoFoPa,
              capital_desembolsado: trx.CapitalDesembolsado,
              capital_pagado: trx.CapitalPagado,
              interes: trx.Interes,
              interes_moratorio: trx.InteresMoratorio,
              otros: trx.Otros,
              saldo_capital: trx.SaldoCapital,
              referencia: trx.CrMoReferencia,
              num_documento: trx.CrMoNumDoc,
              factura_serie: trx.CrMoFacturaSerie,
              factura_correlativo: trx.CrMoFacturaCorrelativo,
            }))
          )
          .returning({ id: estado_cuenta_transacciones.id });

        // Batch insert detalles de este batch de transacciones
        const allDetalles: { transaccion_id: string; codigo_saldo: number; descripcion_saldo: string; valor: string }[] = [];
        batch.forEach((trx, idx) => {
          if (trx.EstadoCuenta_Detalles?.length) {
            for (const det of trx.EstadoCuenta_Detalles) {
              allDetalles.push({
                transaccion_id: insertedTrx[idx].id,
                codigo_saldo: det.CrMoDeSalCod,
                descripcion_saldo: det.ApSalDes,
                valor: det.CrMoDeValor,
              });
            }
          }
        });

        if (allDetalles.length) {
          await sifcoDb.insert(estado_cuenta_detalles).values(allDetalles);
        }
      }
    }

    pasos.push(`Préstamo ${preNumero}: ${transacciones.length} transacción(es) sincronizada(s)`);

    // Batch insert plan de pagos
    const cuotas = estadoCuenta.ConsultaResultado.PlanPagos_Cuotas || [];
    if (cuotas.length) {
      const insertedPPs = await sifcoDb
        .insert(plan_pagos)
        .values(
          cuotas.map((cuota) => ({
            pre_numero: preNumero,
            fecha: cuota.Fecha,
            capital_numero_cuota: cuota.CapitalNumeroCuota,
            capital_monto: cuota.CapitalMonto,
            capital_abonado: cuota.CapitalAbonado,
            capital_atrasado: cuota.CapitaAtrasado,
            capital_pagado: cuota.CapitalPagado,
            capital_saldo: cuota.CapitalSaldo,
            capital_estado: cuota.CapitalEstado,
            capital_movimiento: cuota.CapitalMovimiento,
            capital_mora_monto: cuota.CapitalMoraMonto,
            capital_mora_valor_pagado: cuota.CapitalMoraValorPagado,
            capital_mora_pagada: cuota.CapitalMoraPagada,
            capital_mora_saldo: cuota.CapitalMoraSaldo,
            capital_mora_dias: cuota.CapitalMoraDias,
            interes_numero_cuota: cuota.InteresNumeroCuota,
            interes_monto: cuota.InteresMonto,
            interes_abonado: cuota.InteresAbonado,
            interes_atrasado: cuota.InteresAtrasado,
            interes_pagado: cuota.InteresPagado,
            interes_saldo: cuota.InteresSaldo,
            interes_estado: cuota.InteresEstado,
            interes_movimiento: cuota.InteresMovimiento,
            interes_mora_monto: cuota.InteresMoraMonto,
            interes_mora_valor_pagado: cuota.InteresMoraValorPagado,
            interes_mora_pagada: cuota.InteresMoraPagada,
            interes_mora_saldo: cuota.InteresMoraSaldo,
            interes_mora_dias: cuota.InteresMoraDias,
            otros_monto: cuota.OtrosMonto,
            prestamo: cuota.Prestamo,
          }))
        )
        .returning({ id: plan_pagos.id });

      // Batch insert otros cargos
      const allOtros: { plan_pago_id: string; numero_cuota: number; monto: string; abonado: string; atrasado: string; pagado: string; saldo: number; saldo_descripcion: string }[] = [];
      cuotas.forEach((cuota, idx) => {
        if (cuota.Otros?.length) {
          for (const otro of cuota.Otros) {
            allOtros.push({
              plan_pago_id: insertedPPs[idx].id,
              numero_cuota: otro.NumeroCuota,
              monto: otro.Monto,
              abonado: otro.Abonado,
              atrasado: otro.Atrasado,
              pagado: otro.Pagado,
              saldo: otro.Saldo,
              saldo_descripcion: otro.SaldoDescripcion,
            });
          }
        }
      });

      if (allOtros.length) {
        await sifcoDb.insert(plan_pagos_otros).values(allOtros);
      }
    }

    pasos.push(`Préstamo ${preNumero}: ${cuotas.length} cuota(s) del plan de pagos sincronizada(s)`);

    prestamosDetalle.push({
      preNumero,
      detalle: true,
      recargos: recargosResp?.ConsultaResultados?.length || 0,
      transacciones: transacciones.length,
      detallesTransaccion: transacciones.reduce((acc, trx) => acc + (trx.EstadoCuenta_Detalles?.length || 0), 0),
      cuotasPlanPago: cuotas.length,
      otrosCargos: cuotas.reduce((acc, c) => acc + (c.Otros?.length || 0), 0),
    });
  }

  return { pasos, prestamosDetalle, mensaje: "Sincronización completa" };
}
