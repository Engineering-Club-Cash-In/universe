import api from "@/Provider/interceptor";

const API_URL = import.meta.env.VITE_BACK_URL || "";

/**
 * Rubros: cobros adicionales asociados a un crédito (tarjeta de circulación,
 * calcomanía, …).
 *
 * El modelo ya NO tiene periodicidad, período, fecha de activación ni rubro
 * padre: un rubro es un cobro suelto con monto, descripción y saldo. Lo que
 * decide si el cobro se puede registrar con el crédito en mora es el TIPO
 * (`TipoRubro.obligatorio`), no el rubro.
 *
 * Permisos (el backend es la autoridad; el front solo evita el viaje):
 *  - ADMIN y ASESOR ven la lista y el historial, y pueden crear rubros.
 *  - Solo ADMIN puede usar un tipo obligatorio, crear tipos y editar montos.
 *
 * El backend responde 403 cuando un asesor intenta un tipo obligatorio y 409
 * con un `message` de negocio cuando una regla lo rechaza ("el crédito está
 * MOROSO: solo se le pueden crear rubros obligatorios"). Ese texto se muestra
 * tal cual en la UI vía `getApiErrorMessage`.
 */

export interface TipoRubro {
  tipo_id: number;
  nombre: string;
  descripcion: string | null;
  /** Un tipo obligatorio se puede cobrar aunque el crédito esté en mora. */
  obligatorio: boolean;
  activo: boolean;
}

export interface RubroCredito {
  rubro_id: number;
  credito_id: number;
  tipo_id: number;
  tipo_nombre: string;
  descripcion: string | null;
  monto_original: string;
  saldo_pendiente: string;
  abonado: string;
  activo: boolean;
  completado: boolean;
  /** Anulado ≠ pagado: los dos quedan en saldo 0, pero uno se cobró y el otro no. */
  anulado: boolean;
  created_at: string;
}

export interface EventoRubro {
  historial_id: number;
  tipo_evento: string;
  monto_anterior: string | null;
  monto_nuevo: string | null;
  saldo_anterior: string | null;
  saldo_nuevo: string | null;
  origen: string;
  motivo: string | null;
  /**
   * Autor del evento. `platform_users` no guarda nombre —solo email— y el
   * nombre vive en `asesores`, así que `usuario_nombre` suele venir null en las
   * cuentas ADMIN y el email es la identidad real. Ambos son null en los
   * eventos que no tienen autor humano.
   */
  usuario_email: string | null;
  usuario_nombre: string | null;
  created_at: string;
}

export interface CrearRubroPayload {
  credito_id: number;
  tipo_id: number;
  monto: number;
  /** Obligatoria: es lo único que distingue dos cobros del mismo tipo. */
  descripcion: string;
}

export interface EditarRubroPayload {
  monto?: number;
  descripcion?: string;
  /**
   * Obligatorio SIEMPRE, cambie o no el monto: toda edición queda en el
   * historial y sin motivo el asiento no explica nada. El front no intenta
   * adivinar si el monto cambió —comparar floats acá contra el redondeo con
   * `Big` del backend discrepaba en los sub-centavos—; simplemente lo exige.
   */
  motivo: string;
}

export interface AnularRubroPayload {
  /**
   * Obligatorio: el backend responde 400 si viene vacío o en blanco. Anular es
   * irreversible y el motivo es lo único que después explica, en el historial,
   * por qué ese cobro dejó de cobrarse.
   */
  motivo: string;
}

export interface CrearTipoRubroPayload {
  nombre: string;
  descripcion?: string;
  obligatorio: boolean;
}

export type EditarTipoRubroPayload = Partial<CrearTipoRubroPayload> & { activo?: boolean };

export const getTiposRubro = async (incluir_inactivos = false): Promise<TipoRubro[]> => {
  const { data } = await api.get(`${API_URL}/rubros/tipos`, {
    params: { incluir_inactivos },
  });
  return Array.isArray(data?.tipos) ? data.tipos : [];
};

/**
 * Devuelve el tipo creado —no `void`— porque quien lo crea desde el modal lo
 * necesita ya seleccionado al volver al formulario de "Agregar rubro", y para
 * eso hace falta el `tipo_id` que asignó la base.
 */
export const crearTipoRubro = async (
  payload: CrearTipoRubroPayload
): Promise<TipoRubro> => {
  const { data } = await api.post(`${API_URL}/rubros/tipos`, payload);
  return data.tipo;
};

export const editarTipoRubro = async (
  tipo_id: number,
  payload: EditarTipoRubroPayload
): Promise<void> => {
  await api.put(`${API_URL}/rubros/tipos/${tipo_id}`, payload);
};

/**
 * Borra un tipo de rubro DE VERDAD, pero solo si nadie lo usó todavía.
 *
 * Si el tipo ya tiene rubros el backend responde 409 con un `message` que
 * explica por qué no se puede (borrarlo se llevaría el historial de cobros de
 * esos rubros). Ante ese 409 la UI ofrece desactivarlo —
 * `editarTipoRubro(id, { activo: false })`— que lo saca del desplegable de
 * creación sin tocar lo ya cobrado.
 */
export const eliminarTipoRubro = async (tipo_id: number): Promise<void> => {
  await api.delete(`${API_URL}/rubros/tipos/${tipo_id}`);
};

export const getRubrosByCredito = async (credito_id: number): Promise<RubroCredito[]> => {
  const { data } = await api.get(`${API_URL}/rubros/credito/${credito_id}`);
  return Array.isArray(data?.rubros) ? data.rubros : [];
};

export const crearRubro = async (payload: CrearRubroPayload): Promise<void> => {
  await api.post(`${API_URL}/rubros`, payload);
};

export const editarRubro = async (
  rubro_id: number,
  payload: EditarRubroPayload
): Promise<void> => {
  await api.put(`${API_URL}/rubros/${rubro_id}`, payload);
};

/**
 * Anula un rubro creado por error. Solo ADMIN.
 *
 * Es la única salida para un rubro equivocado: no se puede borrar (se llevaría
 * el historial de cobros) ni editar a cero (la política de montos lo rechaza), y
 * mientras siga vivo el índice único impide crear el rubro correcto de ese
 * mismo tipo.
 *
 * Efecto: `saldo_pendiente = 0`, `completado = true`, `activo = false`. El
 * `monto_original` se CONSERVA y queda un evento `anulacion` con el motivo en el
 * historial: anular no borra, deja constancia.
 *
 * El backend responde 403 si quien llama no es ADMIN, 400 si el motivo viene en
 * blanco y 409 —con un `message` de negocio— si el rubro ya estaba anulado o
 * completado. Devuelve `void` y no el rubro: quien anula refresca la lista
 * completa, que es la que decide qué se ve.
 */
export const anularRubro = async (
  rubro_id: number,
  payload: AnularRubroPayload
): Promise<void> => {
  await api.post(`${API_URL}/rubros/${rubro_id}/anular`, payload);
};

export const getHistorialRubro = async (rubro_id: number): Promise<EventoRubro[]> => {
  const { data } = await api.get(`${API_URL}/rubros/${rubro_id}/historial`);
  return Array.isArray(data?.historial) ? data.historial : [];
};
