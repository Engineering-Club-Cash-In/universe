/**
 * CB-036 · Referencias del cliente en la Ficha 360, armadas al leer.
 *
 * Seis fuentes, ninguna se copia ni se escribe desde cobros (salvo la primera,
 * que es de cobros):
 *
 * | Origen            | De dónde                                              |
 * | ----------------- | ----------------------------------------------------- |
 * | `cobros`          | `referencias_lead` (las carga el asesor en la ficha)  |
 * | `cofirmante`      | `co_debtors` de la oportunidad del crédito            |
 * | `conyuge`         | `credit_applications.conyuge_*` del titular           |
 * | `ventas_personal` | `credit_applications.referencias_personales`          |
 * | `ventas_familiar` | `credit_applications.referencias_crediticias`         |
 * | `emergencia`      | `credit_applications.tel_emergencia`                  |
 *
 * `referencias_crediticias` es el nombre legado de la llave: el formulario del
 * cliente la titula "Referencias Familiares" (ver generate-client-form-pdfs).
 *
 * Solo entran las solicitudes del TITULAR (`person_type = 'lead'`, o NULL en
 * las anteriores a la migración 0015); las referencias que puso cada cofirmante
 * en su propia solicitud quedan fuera por decisión de negocio.
 *
 * Todo es puro (sin DB) para poder probarlo; el router carga las filas y llama
 * a `construirReferencias`.
 */

import { normalizarTelefono } from "./bot-cobros/identificadores";

export const ORIGENES_REFERENCIA = [
	"cobros",
	"cofirmante",
	"conyuge",
	"ventas_personal",
	"ventas_familiar",
	"emergencia",
] as const;
export type OrigenReferencia = (typeof ORIGENES_REFERENCIA)[number];

/** Canales con los que se gestiona una referencia (subconjunto de metodo_contacto). */
export const METODOS_CONTACTO_REFERENCIA = [
	"llamada",
	"whatsapp",
	"sms",
	"visita_domicilio",
] as const;
export type MetodoContactoReferencia =
	(typeof METODOS_CONTACTO_REFERENCIA)[number];

/**
 * Resultado de una gestión a referencia. Catálogo PROVISIONAL, igual que el de
 * `estado_contacto` (CB-025): vive en TypeScript y la columna es `text`, así
 * que agregar o cambiar un valor no requiere migración.
 */
export const RESULTADOS_CONTACTO_REFERENCIA = [
	"dio_informacion",
	"pasara_mensaje",
	"sin_informacion",
	"no_conoce_al_cliente",
	"no_contesta",
	"numero_equivocado",
	"mensaje_enviado",
] as const;
export type ResultadoContactoReferencia =
	(typeof RESULTADOS_CONTACTO_REFERENCIA)[number];

export const TIPOS_HALLAZGO = ["telefono", "direccion", "ubicacion"] as const;
export type TipoHallazgo = (typeof TIPOS_HALLAZGO)[number];

// ---------------------------------------------------------------------------
// Entrada (filas crudas que carga el router)
// ---------------------------------------------------------------------------

export type ReferenciaLeadFila = {
	id: string;
	nombre: string;
	telefono: string;
	parentesco: string;
	notas: string | null;
};

export type SolicitudTitularFila = {
	id: string;
	referenciasPersonales: unknown;
	referenciasCrediticias: unknown;
	conyugeNombre: string | null;
	conyugeEmpresa: string | null;
	conyugeTelMovil: string | null;
	conyugeTelOficina: string | null;
	telEmergencia: string | null;
};

export type CodeudorFila = {
	id: string;
	fullName: string;
	phone: string | null;
};

export type TelefonoAgregadoFila = {
	id: string;
	referenciaKey: string;
	telefono: string;
	notas: string | null;
	registradoPor: string | null;
	createdAt: Date;
};

export type ContactoReferenciaResumenFila = {
	referenciaKey: string;
	fechaContacto: Date;
	metodoContacto: string;
	resultado: string;
	realizadoPor: string | null;
};

export type EntradaReferencias = {
	referenciasLead: ReferenciaLeadFila[];
	solicitudesTitular: SolicitudTitularFila[];
	codeudores: CodeudorFila[];
	telefonosAgregados: TelefonoAgregadoFila[];
	/** Gestiones del caso, en cualquier orden. */
	contactos: ContactoReferenciaResumenFila[];
};

// ---------------------------------------------------------------------------
// Salida
// ---------------------------------------------------------------------------

export type TelefonoReferencia = {
	telefono: string;
	/** "Móvil" / "Oficina" en el cónyuge; null en el resto. */
	etiqueta: string | null;
	/** Lleno solo en los que agregó cobros (se pueden quitar). */
	agregado: {
		id: string;
		referenciaKey: string;
		notas: string | null;
		registradoPor: string | null;
		createdAt: Date;
	} | null;
};

export type ReferenciaUnificada = {
	/** Llave con la que se registran gestiones y teléfonos nuevos. */
	key: string;
	/** Todas las llaves agrupadas en esta fila (la principal primero). */
	keys: string[];
	origen: OrigenReferencia;
	/** Todos los orígenes agrupados, sin repetir, en orden de prioridad. */
	origenes: OrigenReferencia[];
	nombre: string;
	/** Nombres distintos con los que aparece el mismo teléfono en otras fuentes. */
	otrosNombres: string[];
	/** Relación libre de ventas, "Trabaja en …" del cónyuge, etc. */
	detalle: string | null;
	notas: string | null;
	telefonos: TelefonoReferencia[];
	/** Solo las de cobros se editan y se borran; lo de ventas es de solo lectura. */
	editable: {
		referenciaLeadId: string;
		parentesco: string;
		telefono: string;
		notas: string | null;
	} | null;
	ultimoContacto: ContactoReferenciaResumenFila | null;
	totalContactos: number;
};

// ---------------------------------------------------------------------------
// Llaves
// ---------------------------------------------------------------------------

/**
 * Llaves estables por fuente. Las de ventas usan la POSICIÓN dentro del jsonb:
 * esas filas no tienen id propio. Es estable en la práctica porque la
 * solicitud se llena antes de desembolsar y no se vuelve a tocar; si alguien
 * la re-somete reordenando, lo peor que pasa es que el "último intento" y los
 * teléfonos agregados queden en otra fila — la bitácora guarda nombre y
 * teléfono copiados, así que el registro de lo que se hizo no se pierde.
 */
export const claveReferencia = {
	cobros: (referenciaLeadId: string) => `cobros:${referenciaLeadId}`,
	cofirmante: (codeudorId: string) => `cofirmante:${codeudorId}`,
	conyuge: (solicitudId: string) => `conyuge:${solicitudId}`,
	ventasPersonal: (solicitudId: string, indice: number) =>
		`ventas_personal:${solicitudId}:${indice}`,
	ventasFamiliar: (solicitudId: string, indice: number) =>
		`ventas_familiar:${solicitudId}:${indice}`,
	emergencia: (solicitudId: string) => `emergencia:${solicitudId}`,
};

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

function limpiar(valor: unknown): string {
	return typeof valor === "string" ? valor.trim() : "";
}

/**
 * Un campo de teléfono puede traer varios números: en la base conviven
 * "58446376, 22215273" y "4690-4722 / 4792-6862". Se separan para poder
 * marcar cada uno; el texto se deja como lo escribieron.
 */
export function separarTelefonos(valor: string | null | undefined): string[] {
	if (!valor) return [];
	return valor
		.split(/[,/;]/)
		.map((t) => t.trim())
		.filter((t) => /\d/.test(t));
}

/**
 * Llave para comparar teléfonos entre fuentes: los 8 dígitos guatemaltecos.
 * Lo que no normaliza (fijos viejos, basura) queda con sus dígitos crudos, así
 * dos copias idénticas igual se reconocen.
 */
export function claveTelefono(telefono: string): string | null {
	const normalizado = normalizarTelefono(telefono);
	if (normalizado) return normalizado;
	const digitos = telefono.replace(/\D/g, "");
	return digitos.length >= 7 ? digitos : null;
}

/** Filas `{nombre, relacion?, telefono}` de un jsonb de la solicitud, tolerante a basura. */
export function leerFilasReferenciasJson(
	valor: unknown,
): { indice: number; nombre: string; relacion: string; telefono: string }[] {
	if (!Array.isArray(valor)) return [];
	const filas: {
		indice: number;
		nombre: string;
		relacion: string;
		telefono: string;
	}[] = [];
	valor.forEach((item, indice) => {
		if (!item || typeof item !== "object") return;
		const fila = item as Record<string, unknown>;
		const nombre = limpiar(fila.nombre);
		const telefono = limpiar(fila.telefono);
		// El formulario tiene 3 filas fijas: las que el cliente dejó vacías
		// llegan como strings vacíos y no son una referencia.
		if (!nombre && !telefono) return;
		filas.push({ indice, nombre, relacion: limpiar(fila.relacion), telefono });
	});
	return filas;
}

// ---------------------------------------------------------------------------
// Armado
// ---------------------------------------------------------------------------

type Fuente = {
	key: string;
	origen: OrigenReferencia;
	nombre: string;
	detalle: string | null;
	notas: string | null;
	telefonos: { telefono: string; etiqueta: string | null }[];
	editable: ReferenciaUnificada["editable"];
};

/** Las fuentes en orden de prioridad (define cuál manda al agrupar). */
export function fuentesDeReferencias(entrada: EntradaReferencias): Fuente[] {
	const fuentes: Fuente[] = [];

	for (const ref of entrada.referenciasLead) {
		fuentes.push({
			key: claveReferencia.cobros(ref.id),
			origen: "cobros",
			nombre: ref.nombre.trim() || "Sin nombre",
			detalle: null,
			notas: ref.notas,
			telefonos: separarTelefonos(ref.telefono).map((telefono) => ({
				telefono,
				etiqueta: null,
			})),
			editable: {
				referenciaLeadId: ref.id,
				parentesco: ref.parentesco,
				telefono: ref.telefono,
				notas: ref.notas,
			},
		});
	}

	for (const codeudor of entrada.codeudores) {
		fuentes.push({
			key: claveReferencia.cofirmante(codeudor.id),
			origen: "cofirmante",
			nombre: codeudor.fullName.trim() || "Sin nombre",
			detalle: null,
			notas: null,
			telefonos: separarTelefonos(codeudor.phone).map((telefono) => ({
				telefono,
				etiqueta: null,
			})),
			editable: null,
		});
	}

	for (const solicitud of entrada.solicitudesTitular) {
		const nombreConyuge = limpiar(solicitud.conyugeNombre);
		const telefonosConyuge = [
			...separarTelefonos(solicitud.conyugeTelMovil).map((telefono) => ({
				telefono,
				etiqueta: "Móvil",
			})),
			...separarTelefonos(solicitud.conyugeTelOficina).map((telefono) => ({
				telefono,
				etiqueta: "Oficina",
			})),
		];
		if (nombreConyuge || telefonosConyuge.length > 0) {
			const empresa = limpiar(solicitud.conyugeEmpresa);
			fuentes.push({
				key: claveReferencia.conyuge(solicitud.id),
				origen: "conyuge",
				nombre: nombreConyuge || "Cónyuge (sin nombre)",
				detalle: empresa ? `Trabaja en ${empresa}` : null,
				notas: null,
				telefonos: telefonosConyuge,
				editable: null,
			});
		}
	}

	for (const solicitud of entrada.solicitudesTitular) {
		for (const fila of leerFilasReferenciasJson(
			solicitud.referenciasPersonales,
		)) {
			fuentes.push({
				key: claveReferencia.ventasPersonal(solicitud.id, fila.indice),
				origen: "ventas_personal",
				nombre: fila.nombre || "Sin nombre",
				detalle: fila.relacion || null,
				notas: null,
				telefonos: separarTelefonos(fila.telefono).map((telefono) => ({
					telefono,
					etiqueta: null,
				})),
				editable: null,
			});
		}
	}

	for (const solicitud of entrada.solicitudesTitular) {
		for (const fila of leerFilasReferenciasJson(
			solicitud.referenciasCrediticias,
		)) {
			fuentes.push({
				key: claveReferencia.ventasFamiliar(solicitud.id, fila.indice),
				origen: "ventas_familiar",
				nombre: fila.nombre || "Sin nombre",
				detalle: null,
				notas: null,
				telefonos: separarTelefonos(fila.telefono).map((telefono) => ({
					telefono,
					etiqueta: null,
				})),
				editable: null,
			});
		}
	}

	for (const solicitud of entrada.solicitudesTitular) {
		const telefonos = separarTelefonos(solicitud.telEmergencia);
		// Sin número no hay contacto de emergencia: el campo no trae nombre.
		if (telefonos.length === 0) continue;
		fuentes.push({
			key: claveReferencia.emergencia(solicitud.id),
			origen: "emergencia",
			nombre: "Contacto de emergencia",
			detalle: null,
			notas: null,
			telefonos: telefonos.map((telefono) => ({ telefono, etiqueta: null })),
			editable: null,
		});
	}

	return fuentes;
}

/** Nombres que se ponen cuando la fuente no trae uno: no identifican a nadie. */
const NOMBRES_DE_RELLENO = new Set([
	"Sin nombre",
	"Cónyuge (sin nombre)",
	"Contacto de emergencia",
]);

function normalizarNombre(nombre: string): string {
	return nombre
		.normalize("NFD")
		.replace(/[̀-ͯ]/g, "")
		.toLowerCase()
		.replace(/\s+/g, " ")
		.trim();
}

/**
 * Junta las fuentes en filas: si el mismo teléfono aparece en dos fuentes (el
 * cofirmante que además quedó como referencia personal, el cónyuge repetido
 * como familiar), es la misma persona y sale UNA fila con las dos etiquetas.
 *
 * La fila la encabeza la fuente de mayor prioridad (orden de
 * `fuentesDeReferencias`). Dos referencias de cobros NO se juntan entre sí:
 * cada una se edita y se borra por separado, y si una quedara escondida
 * detrás de la otra no habría cómo corregirla.
 */
export function construirReferencias(
	entrada: EntradaReferencias,
): ReferenciaUnificada[] {
	const fuentes = fuentesDeReferencias(entrada);

	const agregadosPorKey = new Map<string, TelefonoAgregadoFila[]>();
	for (const agregado of entrada.telefonosAgregados) {
		const lista = agregadosPorKey.get(agregado.referenciaKey) ?? [];
		lista.push(agregado);
		agregadosPorKey.set(agregado.referenciaKey, lista);
	}

	// Union-find por teléfono. `padre[i]` apunta al índice de la fuente que
	// encabeza el grupo; como se une siempre hacia el índice menor, la cabeza
	// es la de mayor prioridad.
	const padre = fuentes.map((_, i) => i);
	const raiz = (i: number): number => {
		let actual = i;
		while (padre[actual] !== actual) actual = padre[actual] as number;
		return actual;
	};
	const tieneCobros = fuentes.map((f) => f.origen === "cobros");
	const unir = (a: number, b: number) => {
		const ra = raiz(a);
		const rb = raiz(b);
		if (ra === rb) return;
		if (tieneCobros[ra] && tieneCobros[rb]) return;
		const [cabeza, cola] = ra < rb ? [ra, rb] : [rb, ra];
		padre[cola] = cabeza;
		tieneCobros[cabeza] = tieneCobros[cabeza] || tieneCobros[cola];
	};

	const primeraFuentePorTelefono = new Map<string, number>();
	fuentes.forEach((fuente, i) => {
		const telefonos = [
			...fuente.telefonos.map((t) => t.telefono),
			...(agregadosPorKey.get(fuente.key) ?? []).map((a) => a.telefono),
		];
		for (const telefono of telefonos) {
			const clave = claveTelefono(telefono);
			if (!clave) continue;
			const previa = primeraFuentePorTelefono.get(clave);
			if (previa === undefined) {
				primeraFuentePorTelefono.set(clave, i);
			} else {
				unir(previa, i);
			}
		}
	});

	const grupos = new Map<number, number[]>();
	fuentes.forEach((_, i) => {
		const r = raiz(i);
		const lista = grupos.get(r) ?? [];
		lista.push(i);
		grupos.set(r, lista);
	});

	const contactosPorKey = new Map<string, ContactoReferenciaResumenFila[]>();
	for (const contacto of entrada.contactos) {
		const lista = contactosPorKey.get(contacto.referenciaKey) ?? [];
		lista.push(contacto);
		contactosPorKey.set(contacto.referenciaKey, lista);
	}

	const resultado: ReferenciaUnificada[] = [];
	for (const [cabezaIdx, indices] of [...grupos.entries()].sort(
		(a, b) => a[0] - b[0],
	)) {
		const cabeza = fuentes[cabezaIdx] as Fuente;
		const miembros = indices.map((i) => fuentes[i] as Fuente);

		const telefonos: TelefonoReferencia[] = [];
		const vistos = new Set<string>();
		const agregarTelefono = (t: TelefonoReferencia) => {
			const clave = claveTelefono(t.telefono) ?? t.telefono;
			if (vistos.has(clave)) return;
			vistos.add(clave);
			telefonos.push(t);
		};
		for (const miembro of miembros) {
			for (const t of miembro.telefonos) {
				agregarTelefono({ ...t, agregado: null });
			}
		}
		for (const miembro of miembros) {
			for (const a of agregadosPorKey.get(miembro.key) ?? []) {
				agregarTelefono({
					telefono: a.telefono,
					etiqueta: null,
					agregado: {
						id: a.id,
						referenciaKey: a.referenciaKey,
						notas: a.notas,
						registradoPor: a.registradoPor,
						createdAt: a.createdAt,
					},
				});
			}
		}

		const nombreCabeza = normalizarNombre(cabeza.nombre);
		const otrosNombres: string[] = [];
		const nombresVistos = new Set([nombreCabeza]);
		for (const miembro of miembros) {
			const n = normalizarNombre(miembro.nombre);
			// Los nombres de relleno ("Sin nombre", "Contacto de emergencia") no
			// aportan: no son otra forma de llamar a la persona.
			if (NOMBRES_DE_RELLENO.has(miembro.nombre)) continue;
			if (nombresVistos.has(n)) continue;
			nombresVistos.add(n);
			otrosNombres.push(miembro.nombre);
		}

		const keys = miembros.map((m) => m.key);
		const contactos = keys
			.flatMap((k) => contactosPorKey.get(k) ?? [])
			.sort((a, b) => b.fechaContacto.getTime() - a.fechaContacto.getTime());

		resultado.push({
			key: cabeza.key,
			keys,
			origen: cabeza.origen,
			origenes: [...new Set(miembros.map((m) => m.origen))],
			nombre: cabeza.nombre,
			otrosNombres,
			detalle:
				cabeza.detalle ?? miembros.find((m) => m.detalle)?.detalle ?? null,
			notas: cabeza.notas,
			telefonos,
			editable: cabeza.editable,
			ultimoContacto: contactos[0] ?? null,
			totalContactos: contactos.length,
		});
	}

	return resultado;
}

/** La fila que contiene la llave, principal o agrupada. */
export function encontrarReferencia(
	referencias: ReferenciaUnificada[],
	key: string,
): ReferenciaUnificada | null {
	return referencias.find((r) => r.keys.includes(key)) ?? null;
}

/** ¿El teléfono es uno de los de la referencia? (compara por dígitos). */
export function referenciaTieneTelefono(
	referencia: ReferenciaUnificada,
	telefono: string,
): boolean {
	const clave = claveTelefono(telefono);
	return referencia.telefonos.some((t) =>
		clave ? claveTelefono(t.telefono) === clave : t.telefono === telefono,
	);
}

/**
 * Agrega un teléfono a la lista separada por comas de `casos_cobros`
 * (`telefono_alternativo`), sin repetir uno que ya esté en el principal o en
 * el alternativo. Devuelve null si ya estaba.
 */
export function agregarATelefonosDelCaso(
	telefonoPrincipal: string | null,
	telefonoAlternativo: string | null,
	nuevo: string,
): string | null {
	const clave = claveTelefono(nuevo);
	const existentes = [
		...separarTelefonos(telefonoPrincipal),
		...separarTelefonos(telefonoAlternativo),
	];
	const yaEsta = existentes.some((t) =>
		clave ? claveTelefono(t) === clave : t === nuevo.trim(),
	);
	if (yaEsta) return null;
	const alternativos = String(telefonoAlternativo ?? "")
		.split(",")
		.map((t) => t.trim())
		.filter(Boolean);
	return [...alternativos, nuevo.trim()].join(", ");
}
