/* eslint-disable @typescript-eslint/no-explicit-any */
// src/hooks/useFacturas.ts

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { toast } from 'sonner'; // o tu librería de toast
import { anularFactura, certificarFactura, obtenerFacturaPorUUID, obtenerFacturasPorCredito, obtenerFacturasPorPago } from '../services/services';

// 🔥 Hook para certificar factura
export const useCertificarFactura = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: certificarFactura,
    onSuccess: (data) => {
      if (data.success) {
        toast.success(data.mensaje || 'Factura certificada exitosamente');
        // Invalidar cache de facturas del pago
        queryClient.invalidateQueries({ queryKey: ['facturas-pago'] });
      } else {
        toast.error(data.error || 'Error al certificar factura');
      }
    },
    onError: (error: any) => {
      toast.error(error?.response?.data?.error || 'Error al certificar factura');
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

// src/hooks/useFacturas.ts - AGREGAR este hook

// 🔥 Hook para obtener facturas de un crédito
export const useFacturasPorCredito = (creditoId: number | null) => {
  return useQuery({
    queryKey: ['facturas-credito', creditoId],
    queryFn: () => obtenerFacturasPorCredito(creditoId!),
    enabled: !!creditoId,
    staleTime: 1000 * 60 * 5 // 5 minutos
  });
};