import { useCallback, useEffect, useState } from "react";
import { usePersistedState } from "./usePersistedState";
import { getPendingDevolucion, type DevolucionCreditoItem } from "../services/services";

const PAGE_SIZE = 10;

/**
 * Carga + paginación + búsqueda de una lista de créditos de devolución
 * ("Bandeja" o "Historial" en DevolucionCube.tsx), parametrizada por el
 * `status` que se le pasa al backend (BANDEJA_DEVOLUCION / HISTORIAL).
 *
 * Extraído de DevolucionCube.tsx: el componente tenía esta misma lógica
 * duplicada palabra por palabra una vez por tab (load/loadHistorial,
 * onBuscar/onBuscarHistorial, clearFilters/clearHistorialFilters...), con el
 * riesgo de que un fix a un bug (p. ej. el manejo de errores, o el estado
 * inicial de `loading`) se aplicara a una copia y se olvidara en la otra.
 *
 * `storageKeyPrefix` distingue la persistencia de sessionStorage entre tabs
 * (mismo patrón que ya usaban page/search/searchInput por separado): cada
 * instancia de este hook —una por tab— necesita su propia página y búsqueda,
 * para que cambiar de tab no resetee filtros que el operador no tocó.
 */
export function useDevolucionListado(status: string, storageKeyPrefix: string, activoAlMontar: boolean) {
  const [page, setPage] = usePersistedState<number>(`${storageKeyPrefix}/page`, 1);
  const [searchInput, setSearchInput] = usePersistedState<string>(`${storageKeyPrefix}/searchInput`, "");
  const [search, setSearch] = usePersistedState<string>(`${storageKeyPrefix}/search`, "");

  const [items, setItems] = useState<DevolucionCreditoItem[]>([]);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  // Si este listado ya es el tab activo al montar el componente, arranca en
  // loading para no mostrar "No hay créditos..." un instante antes de que el
  // primer fetch traiga los datos reales.
  const [loading, setLoading] = useState(activoAlMontar);
  const [error, setError] = useState<string | null>(null);

  const hasActiveFilters = searchInput !== "" || search !== "";

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const res = await getPendingDevolucion(page, PAGE_SIZE, status, search);

      const credits = res?.data?.credits ?? [];
      const pagination = res?.data?.pagination;

      setItems(Array.isArray(credits) ? credits : []);
      setTotal(pagination?.total ?? 0);
      setTotalPages(pagination?.totalPages ?? 1);
    } catch (e: unknown) {
      const candidate =
        typeof e === "object" && e !== null && "response" in e
          ? (e as { response?: { data?: { message?: string } } }).response?.data?.message
          : undefined;
      const msg =
        typeof candidate === "string" && candidate.trim() !== ""
          ? candidate
          : "Error cargando créditos";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [page, search, status]);

  const onBuscar = useCallback(() => {
    setPage(1);
    setSearch(searchInput.trim());
  }, [searchInput, setPage, setSearch]);

  const clearFilters = useCallback(() => {
    setSearchInput("");
    setSearch("");
    setPage(1);
  }, [setSearchInput, setSearch, setPage]);

  return {
    items,
    loading,
    error,
    page,
    setPage,
    totalPages,
    total,
    search,
    searchInput,
    setSearchInput,
    hasActiveFilters,
    load,
    onBuscar,
    clearFilters,
  };
}
