/* eslint-disable @typescript-eslint/no-explicit-any */
// src/hooks/useFacturas.ts

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { toast } from 'sonner'; // o tu librería de toast
import { 
  anularFactura, 
  facturarPagoCompleto, 
  obtenerFacturaPorUUID, 
  obtenerFacturasPorCredito, 
  obtenerFacturasPorPago,
  getPagoCompleto // ← 🔥 NUEVO
} from '../services/services';

export const useFacturarPagoCompleto = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: facturarPagoCompleto,
    onSuccess: (data) => {
      if (data.success && data.data) {
        const totalFacturas = data.data.total_facturas;
        const cliente = data.data.cliente.nombre;
        
        toast.success(
          `✅ ${totalFacturas} factura(s) generada(s) para ${cliente}`,
          {
            duration: 5000,
          }
        );
        
        // Invalidar cache relevante
        queryClient.invalidateQueries({ queryKey: ['facturas-pago'] });
        queryClient.invalidateQueries({ queryKey: ['pago-completo'] }); // ← 🔥 NUEVO
        queryClient.invalidateQueries({ queryKey: ['pagos'] });
        queryClient.invalidateQueries({ queryKey: ['facturas-electronicas'] });
      } else {
        toast.error(data.error || 'Error al generar facturas');
      }
    },
    onError: (error: any) => {
      const errorMsg = error?.response?.data?.error 
        || error?.message 
        || 'Error al generar facturas';
      
      toast.error(errorMsg);
      
      // Log para debugging
      console.error('Error facturando pago completo:', error);
    }
  });
};

// 🔥 Hook para obtener factura por UUID
export const useObtenerFactura = (uuid: string | null) => {
  return useQuery({
    queryKey: ['factura', uuid],
    queryFn: () => obtenerFacturaPorUUID(uuid!),
    enabled: !!uuid,
    staleTime: 1000 * 60 * 5 // 5 minutos
  });
};

// 🔥 Hook para anular factura
export const useAnularFactura = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: anularFactura,
    onSuccess: (data) => {
      if (data.success) {
        toast.success(data.mensaje || 'Factura anulada exitosamente');
        // Invalidar cache
        queryClient.invalidateQueries({ queryKey: ['facturas-pago'] });
        queryClient.invalidateQueries({ queryKey: ['pago-completo'] }); // ← 🔥 NUEVO
        queryClient.invalidateQueries({ queryKey: ['factura'] });
      } else {
        toast.error(data.mensaje || 'Error al anular factura');
      }
    },
    onError: (error: any) => {
      toast.error(error?.response?.data?.error || 'Error al anular factura');
    }
  });
};

// 🔥 Hook para obtener facturas de un pago
export const useFacturasPorPago = (pagoId: number | null) => {
  return useQuery({
    queryKey: ['facturas-pago', pagoId],
    queryFn: () => obtenerFacturasPorPago(pagoId!),
    enabled: !!pagoId,
    staleTime: 1000 * 60 * 5 // 5 minutos
  });
};

// 🔥 Hook para obtener facturas de un crédito
export const useFacturasPorCredito = (creditoId: number | null) => {
  return useQuery({
    queryKey: ['facturas-credito', creditoId],
    queryFn: () => obtenerFacturasPorCredito(creditoId!),
    enabled: !!creditoId,
    staleTime: 1000 * 60 * 5 // 5 minutos
  });
};

// 🔥 🔥 🔥 NUEVO - Hook para obtener pago completo con todas sus facturas
export const usePagoCompleto = (pagoId: number | null) => {
  return useQuery({
    queryKey: ['pago-completo', pagoId],
    queryFn: () => getPagoCompleto(pagoId!),
    enabled: !!pagoId,
    staleTime: 1000 * 60 * 5 // 5 minutos
  });
};