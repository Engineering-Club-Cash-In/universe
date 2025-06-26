// src/hooks/usePagosByMesAnio.ts
import { useState, useEffect } from "react";
import { getPagosByMesAnio, type PagoCredito } from "../services/services";
 

export function usePagosByMesAnio(mes: number, anio: number, page: number, perPage: number) {
  const [pagos, setPagos] = useState<PagoCredito[]>([]);
  const [loading, setLoading] = useState(false);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

  useEffect(() => {
    if (!mes || !anio) return;
    setLoading(true);
    getPagosByMesAnio({ mes, anio, page, perPage })
      .then((res) => {
        setPagos(res.data || []);
        setTotalPages(res.totalPages || 1);
        setTotalCount(res.totalCount || 0);
      })
      .finally(() => setLoading(false));
  }, [mes, anio, page, perPage]);
const meses = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"
];
  return { pagos, loading, totalPages, totalCount,meses };
}
