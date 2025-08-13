// src/hooks/usePagosByMesAnio.ts
import { useState, useEffect } from "react";
import { getPagosByMesAnio, type PagoResumen, type PagosPorMesAnioResponse } from "../services/services";

export function usePagosByMesAnio(mes: number, anio: number, page: number, perPage: number) {
  const [pagos, setPagos] = useState<PagoResumen[]>([]);
  const [loading, setLoading] = useState(false);
  const [totalPages, setTotalPages] = useState(1);
  const [totalItems, setTotalItems] = useState(0);

  useEffect(() => {
    if (!mes || !anio) return;
    setLoading(true);
    console.log()
    getPagosByMesAnio({ mes, anio, page, perPage })
      .then((res: PagosPorMesAnioResponse) => {
        console.log(res);
        setPagos(res.data || []);
        console.log("Pagos:", res.data);
        setTotalPages(res.totalPages || 1);
 
        setTotalItems(res.totalItems || 0);
      })
      .finally(() => setLoading(false));
  }, [mes, anio, page, perPage]);

  const meses = [
    "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
    "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"
  ];

  return { pagos, loading, totalPages, totalItems, meses };
}
