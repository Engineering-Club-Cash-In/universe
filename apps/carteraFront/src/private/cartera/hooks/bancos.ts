import { useState, useEffect, useCallback } from 'react'; 
import { toast } from 'sonner';
import { bancoService, type Banco, type CreateBancoDto, type UpdateBancoDto } from '../services/services';

export function useBancos() {
  const [bancos, setBancos] = useState<Banco[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 📋 Cargar todos los bancos
  const loadBancos = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await bancoService.getAll();
      setBancos(data);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Error al cargar bancos';
      setError(errorMessage);
      toast.error(errorMessage);
    } finally {
      setLoading(false);
    }
  }, []);

  // ✨ Crear banco
  const createBanco = async (bancoData: CreateBancoDto): Promise<Banco | null> => {
    try {
      const nuevoBanco = await bancoService.create(bancoData);
      setBancos(prev => [...prev, nuevoBanco]);
      toast.success('Banco creado exitosamente');
      return nuevoBanco;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Error al crear banco';
      toast.error(errorMessage);
      return null;
    }
  };

  // ✏️ Actualizar banco
  const updateBanco = async (id: number, bancoData: UpdateBancoDto): Promise<Banco | null> => {
    try {
      const bancoActualizado = await bancoService.update(id, bancoData);
      setBancos(prev => 
        prev.map(banco => banco.banco_id === id ? bancoActualizado : banco)
      );
      toast.success('Banco actualizado exitosamente');
      return bancoActualizado;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Error al actualizar banco';
      toast.error(errorMessage);
      return null;
    }
  };

  // 🗑️ Eliminar banco
  const deleteBanco = async (id: number): Promise<boolean> => {
    try {
      await bancoService.delete(id);
      setBancos(prev => prev.filter(banco => banco.banco_id !== id));
      toast.success('Banco eliminado exitosamente');
      return true;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Error al eliminar banco';
      toast.error(errorMessage);
      return false;
    }
  };

  // 🔍 Obtener banco por ID (del estado local)
  const getBancoById = useCallback((id: number): Banco | undefined => {
    return bancos.find(banco => banco.banco_id === id);
  }, [bancos]);

  // Cargar bancos al montar el hook
  useEffect(() => {
    loadBancos();
  }, [loadBancos]);

  return {
    bancos,
    loading,
    error,
    loadBancos,
    createBanco,
    updateBanco,
    deleteBanco,
    getBancoById,
  };
}