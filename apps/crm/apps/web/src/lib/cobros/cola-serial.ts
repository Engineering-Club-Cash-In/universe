/**
 * Cola de tareas asíncronas que corren de a una, en el orden en que entraron.
 *
 * La usa el autoguardado de teléfonos de la Ficha 360 (CB-036): cada guardado
 * manda las dos listas completas de teléfonos, así que dos en vuelo podían
 * llegar al servidor al revés y el viejo pisar al nuevo (Codex, PR #1751).
 *
 * - Una tarea que falla no frena a las siguientes: su error le llega a quien
 *   la encoló (por la promesa que devuelve `encolar`), no a la cola.
 * - `esperar()` resuelve cuando termina todo lo encolado hasta ese momento,
 *   haya salido bien o mal. Nunca rechaza.
 */
export function crearColaSerial() {
	let cola: Promise<unknown> = Promise.resolve();
	return {
		encolar<T>(tarea: () => Promise<T>): Promise<T> {
			const siguiente = cola.then(tarea);
			cola = siguiente.catch(() => undefined);
			return siguiente;
		},
		esperar(): Promise<void> {
			return cola.then(() => undefined);
		},
	};
}

export type ColaSerial = ReturnType<typeof crearColaSerial>;
