// Locks de sesión que serializan cada job de buckets. Cualquier escritor que
// dependa de dueño/bucket leído previamente debe tomarlos también antes de
// modificar `creditos.asesor_id`.
export const PROCESAR_MORAS_LOCK_KEY = 728193;
export const BUCKETS_CONVENIO_LOCK_KEY = 728194;
// Namespace del segundo componente de pg_advisory_lock(namespace, credito_id).
// Todos los escritores de creditos.asesor_id lo usan para serializar una
// edición individual con un traslado masivo del mismo crédito.
export const CREDITO_ASESOR_LOCK_NAMESPACE = 728195;
