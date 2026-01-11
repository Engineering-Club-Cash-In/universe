// src/hooks/useBoletas.ts

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"; 
import { toast } from "sonner";
import { createBoleta, getBoletas, type CreateBoletaDTO, type GetBoletasFilters } from "../services/services";

// ============================================
// 📝 CREATE - Hook para crear boleta
// ============================================
export const useCreateBoleta = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateBoletaDTO) => createBoleta(data),
    onSuccess: (data) => {
      console.log("✅ Boleta creada exitosamente:", data);
      toast.success("Boleta creada exitosamente");
      
      // 🔥 Invalidar queries para refrescar las listas
      queryClient.invalidateQueries({ queryKey: ["boletas"] });
      queryClient.invalidateQueries({ queryKey: ["boletas-pendientes"] });
      queryClient.invalidateQueries({ queryKey: ["boletas-stats"] });
    },
    onError: (error: Error) => {
      console.error("❌ Error creando boleta:", error);
      toast.error(error.message || "Error al crear boleta");
    },
  });
};

// ============================================
// 📖 READ - Hook para listar boletas
// ============================================
export const useGetBoletas = (filters?: GetBoletasFilters) => {
  return useQuery({
    queryKey: ["boletas", filters],
    queryFn: () => getBoletas(filters),
    staleTime: 5 * 60 * 1000, // 5 minutos
    retry: 2,
  });
};

// ============================================
// 📖 READ - Hook para boletas pendientes
// ============================================
export const useGetBoletasPendientes = (inversionista_id?: number) => {
  return useQuery({
    queryKey: ["boletas-pendientes", inversionista_id],
    queryFn: () => getBoletas({ 
      estado: "PENDIENTE",
      inversionista_id 
    }),
    staleTime: 5 * 60 * 1000,
    retry: 2,
  });
};

// ============================================
// 📖 READ - Hook para boletas por inversionista
// ============================================
export const useGetBoletasByInversionista = (inversionista_id: number) => {
  return useQuery({
    queryKey: ["boletas", "inversionista", inversionista_id],
    queryFn: () => getBoletas({ inversionista_id }),
    staleTime: 5 * 60 * 1000,
    retry: 2,
    enabled: !!inversionista_id, // Solo ejecutar si hay ID
  });
};