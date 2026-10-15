/**
 * Columna "condonacionBoletaTardia" del listado de pagos (alias `p` = pagos_credito): la condonación ligada a la
 * boleta por el intento (y por crédito), con quién la aceptó. Contabilidad la ve al validar. Prefiere la viva; si
 * solo hay anulada la devuelve con `anulada: true`. NULL si el pago no es de una boleta tardía.
 * Subconsulta correlacionada: usa pagos_credito_idx_boleta_tardia_intento (0055) y, para la condonación, el índice
 * moras_condonaciones_idx_intento (0056, intento_id + credito_id, incluye anuladas).
 */
export const CONDONACION_BOLETA_TARDIA_SELECT_SQL = `(
  SELECT json_build_object('condonacionId', mc.condonacion_id, 'monto', mc.monto_condonacion::text,
    'asesor', pu.email, 'anulada', mc.anulada_at IS NOT NULL)
  FROM cartera.moras_condonaciones mc
  JOIN cartera.platform_users pu ON pu.id = mc.usuario_id
  WHERE p.boleta_tardia_intento_id IS NOT NULL
    AND mc.intento_id = p.boleta_tardia_intento_id AND mc.credito_id = p.credito_id
  ORDER BY (mc.anulada_at IS NULL) DESC, mc.condonacion_id DESC
  LIMIT 1
) AS "condonacionBoletaTardia"`;
