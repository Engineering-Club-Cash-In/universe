import { type Advisor, getAdvisors, createAdvisor, updateAdvisor } from "../services/services";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

// ========== Hook ==========
export const useAdvisors = () => {
  const queryClient = useQueryClient();

  // Cargar asesores
  const { data: advisors = [], isLoading: loading } = useQuery<Advisor[]>({
    queryKey: ["advisors"],
    queryFn: getAdvisors,
  });

  // Crear asesor
  const addAdvisorMutation = useMutation({
    mutationFn: (advisor: Partial<Advisor> & { password?: string }) =>
      createAdvisor(advisor),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["advisors"] }); // 🔄 Refetch automático
    },
  });

  // Editar asesor
  const editAdvisorMutation = useMutation({
    mutationFn: ({ id, advisor }: { id: number; advisor: Partial<Advisor> & { password?: string } }) =>
      updateAdvisor(id, advisor),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["advisors"] }); // 🔄 Refetch automático
    },
  });

  // Métodos que vas a usar en tu componente
  const addAdvisor = async (advisor: Partial<Advisor> & { password?: string }) => {
    return addAdvisorMutation.mutateAsync(advisor);
  };

  const editAdvisor = async (id: number, advisor: Partial<Advisor> & { password?: string }) => {
    return editAdvisorMutation.mutateAsync({ id, advisor });
  };

  return {
    advisors,
    loading,
    addAdvisor,
    editAdvisor,
  };
};
