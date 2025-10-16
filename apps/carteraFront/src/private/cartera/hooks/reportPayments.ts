/* eslint-disable @typescript-eslint/no-explicit-any */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getPagosConInversionistasService,
  pagosService,
  type AplicarPagoResponse,
  type GetPagosParams,
  type GetPagosResponse,
  type PagoDataInvestor,
} from "../services/services"; 

/**
 * 🔹 Hook que obtiene pagos con inversionistas
 * y adapta la estructura del backend al formato usado por la tabla del frontend.
 * Incluye búsqueda parcial por nombre de usuario (`usuarioNombre`).
 */
export function usePagosConInversionistas(params: GetPagosParams) {
  return useQuery<GetPagosResponse>({
    // ✅ Incluir usuarioNombre en la key para revalidar automáticamente
    queryKey: ["pagos-inversionistas", params],
    queryFn: async () => {
      // 🧩 Llamada al servicio
      const raw = await getPagosConInversionistasService(params);

      // 🔄 Adaptación del formato para el frontend
      const adaptedData: PagoDataInvestor[] = (raw.data || []).map((pago: any) => ({
        pagoId: pago.pagoId,
        montoBoleta: Number(pago.montoBoleta ?? 0),
        numeroAutorizacion: pago.numeroAutorizacion ?? null,
        fechaPago: pago.fechaPago ?? "--",

        // 🆕 Campos adicionales del pago
        mora: Number(pago.mora ?? 0),
        otros: Number(pago.otros ?? 0),
        reserva: Number(pago.reserva ?? 0),
        membresias: Number(pago.membresias ?? 0),
        observaciones: pago.observaciones ?? null,

        // 💰 Abonos del pago
        abono_interes: Number(pago.abono_interes ?? 0),
        abono_iva_12: Number(pago.abono_iva_12 ?? 0),
        abono_seguro: Number(pago.abono_seguro ?? 0),
        abono_gps: Number(pago.abono_gps ?? 0),
        abono_capital: Number(pago.abono_capital ?? 0),
        validationStatus: pago.validationStatus ?? "Pendiente",

        // 🔗 Relaciones principales
        credito: {
          creditoId: pago.credito?.creditoId ?? 0,
          numeroCreditoSifco: pago.credito?.numeroCreditoSifco ?? "--",
          capital: Number(pago.credito?.capital ?? 0),
          deudaTotal: Number(pago.credito?.deudaTotal ?? 0),
          statusCredit: pago.credito?.statusCredit ?? "--",
          porcentajeInteres: Number(pago.credito?.porcentajeInteres ?? 0),
          fechaCreacion: pago.credito?.fechaCreacion ?? "--",
        },

        cuota: pago.cuota
          ? {
              cuotaId: pago.cuota.cuotaId,
              numeroCuota: pago.cuota.numeroCuota,
              fechaVencimiento: pago.cuota.fechaVencimiento,
            }
          : null,

        usuario: {
          usuarioId: pago.usuario?.usuarioId ?? 0,
          nombre: pago.usuario?.nombre ?? "--",
          nit: pago.usuario?.nit ?? "--",
        },

        inversionistas: Array.isArray(pago.inversionistas)
          ? pago.inversionistas.map((inv: any) => ({
              inversionistaId: inv.inversionistaId,
              nombreInversionista: inv.nombreInversionista,
              emiteFactura: inv.emiteFactura ?? false,
              abonoCapital: Number(inv.abonoCapital ?? 0),
              abonoInteres: Number(inv.abonoInteres ?? 0),
              abonoIva: Number(inv.abonoIva ?? 0),
              isr: Number(inv.isr ?? 0),
              cuotaPago: inv.cuotaPago ?? null,
              montoAportado: Number(inv.montoAportado ?? 0),
              porcentajeParticipacion: Number(inv.porcentajeParticipacion ?? 0),
            }))
          : [],

        boleta: pago.boleta
          ? {
              boletaId: pago.boleta.boletaId,
              urlBoleta: pago.boleta.urlBoleta,
            }
          : null,
      }));
      console.log("Adapted Payments with Investors:", adaptedData);
      return {
        ...raw,
        data: adaptedData,
      };
    },

    placeholderData: (previousData) => previousData,
    staleTime: 1000 * 60 * 2, // ⏳ 2 min para no sobrecargar peticiones
  });
}
/**
 * 🔹 Hook para aplicar un pago al crédito y validarlo
 * Invalida automáticamente la caché de pagos con inversionistas
 */
export function useAplicarPago() {
  const queryClient = useQueryClient();

  return useMutation<AplicarPagoResponse, Error, number>({
    mutationFn: (pagoId: number) => pagosService.aplicarPago(pagoId),
    
    onSuccess: (data) => {
      // ✅ Mostrar mensaje de éxito
      alert(data.message);

      // 🔄 Invalidar la caché para refrescar la tabla
      queryClient.invalidateQueries({ 
        queryKey: ["pagos-inversionistas"] 
      });

      // 📊 Log adicional si se aplicó al crédito
      if (data.applied && data.data) {
        console.log("💰 Pago aplicado al crédito:", {
          creditoId: data.data.credito_id,
          capitalNuevo: data.data.capital_nuevo,
          deudaTotalNueva: data.data.deuda_total_nueva,
        });
      }
    },

    onError: (error) => {
      // ❌ Mostrar error
      console.error("Error al aplicar pago:", error);
      alert(error.message || "Error al aplicar el pago al crédito");
    },
  });
}