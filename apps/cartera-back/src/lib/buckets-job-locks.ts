// Locks de sesión que serializan cada job de buckets. Cualquier escritor que
// dependa de dueño/bucket leído previamente debe tomarlos también antes de
// modificar `creditos.asesor_id`.
export const PROCESAR_MORAS_LOCK_KEY = 728193;
export const BUCKETS_CONVENIO_LOCK_KEY = 728194;
