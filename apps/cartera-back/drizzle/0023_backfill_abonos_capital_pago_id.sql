-- Sincroniza los abonos históricos con el pago que los creó — los que se puede.
--
-- La migración 0019 dejó `pago_id` en NULL para todo lo anterior, porque el
-- modelo viejo acumulaba: una fila por par (crédito, inversionista) mezclaba N
-- pagos y no había forma de saber cuál era cuál.
--
-- Pero hay un subconjunto donde SÍ se puede, sin ambigüedad: los créditos que
-- tienen UN SOLO pago de abono directo a capital. Ahí la fila solo puede venir
-- de ese pago. No hay nada que adivinar.
--
-- Por qué importa: sin `pago_id`, revertir uno de esos pagos entra por la rama de
-- "este pago no generó abonos" y sigue como si nada, dejando el abono vivo para
-- que se pague en una liquidación. Con el `pago_id` puesto, el reverso lo
-- encuentra y lo borra (o lo frena, si ya está comprometido).
--
-- Alcance real medido contra prod (34 abonos CAPITAL abiertos):
--   * 19 (13 créditos) → 1 solo pago capital  → SE LLENAN acá
--   *  4 ( 3 créditos) → 2-3 pagos capital    → la fila es una mezcla, imposible
--   * 11 (11 créditos) → 0 pagos capital      → el pago ya no existe (reversePayment
--                                               borra los parciales). Son los
--                                               huérfanos que este PR viene a
--                                               evitar hacia adelante.
--
-- Solo se tocan los ABIERTOS (`liquidado = false`): los ya liquidados están
-- cerrados, el reverso los frena igual por `liquidado`, y llenarlos podría chocar
-- con el índice único de 0022.
--
-- Verificado antes de correr: llena exactamente 19 filas y 0 pares
-- (pago_id, inversionista_id) colisionan con el índice único.

UPDATE "cartera"."abonos_capital" a
   SET "pago_id" = sub.pago_id,
       "updated_at" = NOW()
  FROM (
    SELECT p."credito_id", MIN(p."pago_id") AS pago_id
      FROM "cartera"."pagos_credito" p
     WHERE p."validation_status" IN ('capital', 'capital_validated')
     GROUP BY p."credito_id"
    HAVING COUNT(*) = 1
  ) sub
 WHERE a."credito_id" = sub.credito_id
   AND a."tipo" = 'CAPITAL'
   AND a."liquidado" = false
   AND a."pago_id" IS NULL;
