import api from "@/Provider/interceptor";

const API_URL = import.meta.env.VITE_BACK_URL || "";

// El snapshot trae ~60 columnas numéricas (strings de numeric) + fecha/anio/mes/semana.
export interface SnapshotDiario {
  id: number;
  fecha: string;
  anio: number;
  mes: number;
  semana: number;
  bloqueado?: boolean;
  bloqueado_por?: number | null;
  bloqueado_at?: string | null;
  [k: string]: any;
}

export interface GastoAdministrativo {
  id: number;
  fecha: string;
  concepto: string;
  monto: string;
}

export interface IngresoCarro {
  id: number;
  fecha: string;
  concepto: string;
  monto: string;
}

export interface MetaFacturacion {
  id: number;
  anio: number;
  mes: number;
  meta_mensual: string;
  meta_semanal: string;
  meta_diaria: string;
  deuda_mensual: string | null;
  deuda_semanal: string | null;
  deuda_diaria: string | null;
}

// ───────────── Snapshot diario ─────────────
export const getSnapshotsDiarios = async (
  fechaInicio?: string,
  fechaFin?: string
): Promise<{ success: boolean; data: SnapshotDiario[]; totales: Record<string, number> }> => {
  const { data } = await api.get(`${API_URL}/api/facturacion-snapshot`, {
    params: { fechaInicio, fechaFin },
  });
  return data;
};

export const descargarExcelFacturacion = async (
  fechaInicio: string,
  fechaFin: string
): Promise<Blob> => {
  const res = await api.get(`${API_URL}/api/facturacion-snapshot/excel`, {
    params: { fechaInicio, fechaFin },
    responseType: "blob",
  });
  return res.data as Blob;
};

export const generarSnapshotDiario = async (fecha: string) => {
  const { data } = await api.post(`${API_URL}/api/facturacion-snapshot/generar`, {
    fecha,
  });
  return data;
};

// Solo actualiza carros + administrativos del día (no recalcula montos importados).
export const aplicarManualesDia = async (fecha: string) => {
  const { data } = await api.post(`${API_URL}/api/facturacion-snapshot/aplicar-manuales-dia`, {
    fecha,
  });
  return data;
};

// Solo actualiza las columnas de meta del mes (no recalcula montos importados).
export const aplicarMetaMes = async (anio: number, mes: number) => {
  const { data } = await api.post(`${API_URL}/api/facturacion-snapshot/aplicar-meta-mes`, {
    anio,
    mes,
  });
  return data;
};

// ───────────── Gastos administrativos ─────────────
export const getGastosAdministrativos = async (
  fechaInicio?: string,
  fechaFin?: string
): Promise<{ success: boolean; data: GastoAdministrativo[] }> => {
  const { data } = await api.get(`${API_URL}/api/gastos-administrativos`, {
    params: { fechaInicio, fechaFin },
  });
  return data;
};

export const crearGastoAdministrativo = async (body: {
  fecha: string;
  concepto: string;
  monto: number | string;
}) => {
  const { data } = await api.post(`${API_URL}/api/gastos-administrativos`, body);
  return data;
};

export const eliminarGastoAdministrativo = async (id: number) => {
  const { data } = await api.delete(`${API_URL}/api/gastos-administrativos/${id}`);
  return data;
};

// ───────────── Ingresos por carros ─────────────
export const getIngresosCarros = async (
  fechaInicio?: string,
  fechaFin?: string
): Promise<{ success: boolean; data: IngresoCarro[] }> => {
  const { data } = await api.get(`${API_URL}/api/ingresos-carros`, {
    params: { fechaInicio, fechaFin },
  });
  return data;
};

export const crearIngresoCarro = async (body: {
  fecha: string;
  concepto: string;
  monto: number | string;
}) => {
  const { data } = await api.post(`${API_URL}/api/ingresos-carros`, body);
  return data;
};

export const eliminarIngresoCarro = async (id: number) => {
  const { data } = await api.delete(`${API_URL}/api/ingresos-carros/${id}`);
  return data;
};

// ───────────── Metas de facturación ─────────────
export const getMetasFacturacion = async (
  anio?: number,
  mes?: number
): Promise<{ success: boolean; data: MetaFacturacion[] }> => {
  const { data } = await api.get(`${API_URL}/api/metas-facturacion`, {
    params: { anio, mes },
  });
  return data;
};

export const upsertMetaFacturacion = async (body: {
  anio: number;
  mes: number;
  meta_mensual?: number | string;
  meta_semanal?: number | string;
  meta_diaria?: number | string;
  deuda_mensual?: number | string | null;
  deuda_semanal?: number | string | null;
  deuda_diaria?: number | string | null;
}) => {
  const { data } = await api.post(`${API_URL}/api/metas-facturacion`, body);
  return data;
};

// ───────────── Edición manual de celdas (lock por fila) ─────────────
export const guardarCeldasSnapshot = async (
  cambios: { fecha: string; valores: Record<string, string | number> }[]
) => {
  const { data } = await api.put(`${API_URL}/api/facturacion-snapshot/celdas`, {
    cambios,
  });
  return data;
};

export const desbloquearDiaSnapshot = async (fecha: string) => {
  const { data } = await api.post(
    `${API_URL}/api/facturacion-snapshot/desbloquear-dia`,
    { fecha }
  );
  return data;
};

export interface AuditoriaSnapshot {
  id: number;
  fecha: string;
  columna: string;
  valor_anterior: string | null;
  valor_nuevo: string | null;
  accion: "edit" | "lock" | "unlock";
  usuario_id: number | null;
  usuario_email: string | null;
  created_at: string;
}

export const getAuditoriaSnapshot = async (params?: {
  fechaInicio?: string;
  fechaFin?: string;
  limit?: number;
}): Promise<{ success: boolean; data: AuditoriaSnapshot[] }> => {
  const { data } = await api.get(
    `${API_URL}/api/facturacion-snapshot/auditoria`,
    { params }
  );
  return data;
};
