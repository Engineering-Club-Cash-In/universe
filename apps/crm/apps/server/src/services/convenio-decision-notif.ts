// CB-033 — Notificaciones de la aprobación de convenios.
//
// Cobertura: SOLO decisiones tomadas desde el CRM. Una decisión desde
// carteraFront queda auditada en cartera (convenio_decisiones) pero no pasa
// por acá — no existe canal de cartera hacia el CRM, y agregar uno (job de
// reconciliación o webhook) fue decisión explícita de negocio: no se hace en
// CB-033. Ver docs/features/cobros-02/06-ficha-360.md §3.5.
//
// Entrega no garantizada: el aviso se inserta DESPUÉS de que cartera
// commiteó la decisión. Si el CRM cae en esa ventana, o el INSERT falla, la
// decisión queda firme y el aviso nunca existe — el índice único evita
// duplicados, no garantiza entrega. Por eso todo acá es best-effort: un
// fallo de notificación NUNCA se reporta como fallo de la decisión (mismo
// criterio que el etiquetado del caso en crearConvenioDesdeFicha).

import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import { notifications } from "../db/schema/notifications";
import { obtenerSupervisoresCobros } from "./cobros-notif-helpers";

/**
 * Roles válidos para `created_by_role` — el enum de la columna, no `string`:
 * la UI de notificaciones lo renderiza y un valor fuera del enum rompería el
 * INSERT en runtime en vez de en compilación.
 */
type RolNotificacion = (typeof notifications.createdByRole.enumValues)[number];

const Q = (n: number) =>
	`Q${n.toLocaleString("es-GT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Al crear un convenio: avisa a TODOS los cobros_supervisor. Se llama al
 * final de `crearConvenioDesdeFicha`, en su propio try/catch best-effort —
 * este helper no lanza por diseño (ver el catch interno).
 */
export async function notificarConvenioPendienteAprobacion(params: {
	casoCobroId: string;
	convenioId: number;
	/** Nombre de la persona, no el número de crédito (ver `numeroCreditoSifco`). */
	clienteNombre?: string;
	numeroCreditoSifco?: string;
	montoTotal: number;
	creadoPorUserId: string;
	/** Rol real de quien creó el convenio: la UI lo muestra junto al nombre. */
	creadoPorRole?: RolNotificacion;
}): Promise<void> {
	try {
		const supervisores = await obtenerSupervisoresCobros();
		if (supervisores.length === 0) return;

		const titulo = "Convenio pendiente de aprobación";
		// El SIFCO va aparte del nombre: identifica el crédito sin reemplazar a
		// la persona, que es lo que el supervisor reconoce de un vistazo.
		const quien = params.clienteNombre?.trim()
			? params.numeroCreditoSifco
				? `${params.clienteNombre.trim()} (crédito ${params.numeroCreditoSifco})`
				: params.clienteNombre.trim()
			: params.numeroCreditoSifco
				? `El crédito ${params.numeroCreditoSifco}`
				: "Un cliente";
		// "esperando aprobación del supervisor", no "tu aprobación": aunque el
		// aviso se asigna a los supervisores, `getAlertasCaso` lo trae POR CASO
		// sin filtrar destinatario, así que también lo lee el asesor en la
		// Ficha 360 — y decidir está reservado a supervisores/admin.
		const descripcion = `${quien} tiene un convenio de pago por ${Q(params.montoTotal)} esperando aprobación del supervisor.`;

		await db.insert(notifications).values(
			supervisores.map((supervisorId) => ({
				titulo,
				descripcion,
				type: "action_required" as const,
				status: "pending" as const,
				cobrosTipo: "convenio_pendiente_aprobacion" as const,
				relatedEntityType: "collection_case" as const,
				relatedEntityId: params.casoCobroId,
				// Identifica el convenio concreto: al decidir, solo se cierran
				// los avisos de ESTE, no los de otro convenio del mismo caso.
				convenioId: params.convenioId,
				redirectPage: "cobros_detail" as const,
				// La UI muestra el NOMBRE de `createdBy` (join) pegado a
				// `createdByRole`, así que los dos tienen que describir a la
				// misma persona. Acá es el asesor que creó el convenio: este
				// aviso lo dispara su acción, no un job de sistema — usar el
				// usuario de sistema dejaba su nombre etiquetado con el rol del
				// asesor.
				createdBy: params.creadoPorUserId,
				createdByRole: params.creadoPorRole ?? ("cobros" as const),
				assignedToRole: "cobros_supervisor" as const,
				assignedTo: supervisorId,
			})),
		);

		// Carrera real: el convenio existe en cartera desde antes de este
		// INSERT, y su cola de pendientes no depende del CRM. Un supervisor
		// puede decidirlo en esa ventana (que incluye el etiquetado del caso
		// en crearConvenioDesdeFicha); `resolverPendientesDeAprobacion`
		// correría primero, no encontraría filas, y acá se insertarían avisos
		// `pending` de un convenio YA decidido.
		//
		// No se coordina con un lock ni se consulta cartera —sería una llamada
		// HTTP extra en un camino best-effort—: basta releer después de
		// insertar, usando como señal el aviso `convenio_resuelto` que deja la
		// decisión. Si ya ocurrió, estas filas nacen obsoletas y se cierran acá
		// mismo (ver el límite declarado en `reconciliarSiYaSeDecidio`).
		await reconciliarSiYaSeDecidio(params.convenioId);
	} catch (error) {
		console.warn(
			"[notificarConvenioPendienteAprobacion] No se pudo notificar (best-effort):",
			error instanceof Error ? error.message : error,
		);
	}
}

/**
 * Estados NO terminales de una notificación. Un aviso en cualquiera de ellos
 * sigue visible y accionable: solo `resolved` y `dismissed` lo sacan de
 * circulación.
 *
 * Filtrar solo por `pending` no alcanza — abrir la notificación la pasa a
 * `read` (y "marcar todas como leídas" mueve varias de golpe), y el usuario
 * puede ponerla en `in_progress` a mano. Esas copias seguían mostrándose
 * como acción requerida sobre un convenio ya decidido.
 */
const ESTADOS_ABIERTOS = ["pending", "read", "in_progress"] as const;

/**
 * Cierra los avisos `convenio_pendiente_aprobacion` DE ESE CONVENIO: una vez
 * que alguien decidió, el resto de supervisores seguía viendo una acción
 * requerida sobre algo que ya no está pendiente (el contador se guía por
 * `status` y la lista no filtra por él, ver routers/notifications.ts).
 *
 * Se acota por `convenio_id`, no por caso: el rechazo borra el convenio y
 * cartera permite crear uno nuevo para el mismo crédito, así que un caso
 * puede tener avisos de dos convenios distintos. Un reintento idempotente de
 * la decisión vieja devuelve el `convenioId` ORIGINAL — filtrando por caso
 * habría cerrado también los avisos del convenio nuevo, que sí sigue
 * pendiente.
 *
 * Se resuelven todos los de ese convenio, incluido el de quien decidió: su
 * pendiente tampoco tiene sentido ya.
 *
 * Best-effort igual que el resto: la decisión ya está commiteada en cartera
 * y es irreversible desde acá, así que un fallo acá no puede hacerla fallar.
 */
export async function resolverPendientesDeAprobacion(convenioId: number) {
	await db
		.update(notifications)
		.set({ status: "resolved", resolvedAt: new Date(), updatedAt: new Date() })
		.where(
			and(
				eq(notifications.cobrosTipo, "convenio_pendiente_aprobacion"),
				eq(notifications.convenioId, convenioId),
				inArray(notifications.status, [...ESTADOS_ABIERTOS]),
			),
		);
}

/**
 * Cierra los avisos que acaban de nacer obsoletos porque el convenio se
 * decidió mientras se insertaban (ver la carrera descrita en el caller).
 *
 * La señal es el aviso `convenio_resuelto` de ese convenio — el que va al
 * asesor. No se inventa ninguna marca interna: guardarla en `notifications`
 * se intentó dos veces y se filtró por una consulta distinta cada vez
 * (`getAlertasCaso` la mostraba en la Ficha 360; con `assigned_to` NULL
 * pasaba a ser una notificación POR ROL visible para todos los supervisores),
 * y una tabla propia es demasiado para lo que cubre.
 *
 * **Límite conocido**: si la decisión ocurre en esa ventana Y el asesor no se
 * pudo enlazar por correo, no hay aviso y por lo tanto no hay señal, así que
 * los avisos quedan abiertos. Requiere las dos cosas a la vez —una carrera de
 * milisegundos y un correo sin correspondencia en `user` (0 de 97 usuarios
 * hoy)— y el desenlace es un aviso de más: al abrirlo, cartera responde
 * `convenio_no_pendiente`. Ver 06-ficha-360.md §3.5.
 *
 * No sirve mirar filas `resolved` de `convenio_pendiente_aprobacion`: el
 * cleanup solo las produce si había avisos abiertos, y esta carrera es justo
 * cuando la decisión llega ANTES de que el aviso exista. Verificado contra la
 * DB: con esa señal, el aviso tardío queda huérfano.
 *
 * Una decisión posterior a esta comprobación no es problema — la cierra su
 * propio `resolverPendientesDeAprobacion`, que corre después.
 */
async function reconciliarSiYaSeDecidio(convenioId: number) {
	const [yaDecidido] = await db
		.select({ id: notifications.id })
		.from(notifications)
		.where(
			and(
				eq(notifications.cobrosTipo, "convenio_resuelto"),
				eq(notifications.convenioId, convenioId),
			),
		)
		.limit(1);
	if (!yaDecidido) return;
	await resolverPendientesDeAprobacion(convenioId);
}

/**
 * Al resolver (aprobar/rechazar): cierra los pendientes de aprobación y avisa
 * al asesor. `decisionId` es el de cartera (`convenio_decisiones.decision_id`)
 * — en una respuesta idempotente es el de la decisión ORIGINAL, así que un
 * reintento tras un timeout no genera un aviso nuevo: el INSERT con ON
 * CONFLICT lo descarta.
 *
 * El aviso va al asesor que lleva el crédito AHORA, no al que creó el
 * convenio: si el crédito se reasignó entremedio, quien tiene que enterarse
 * del resultado es quien va a gestionarlo.
 */
export async function notificarConvenioResuelto(params: {
	casoCobroId: string;
	convenioId: number;
	asesorUserId: string | null;
	decisionId: number;
	decision: "aprobado" | "rechazado";
	motivo?: string | null;
	creadoPorUserId: string;
	/**
	 * Rol real de quien decidió. `cobrosSupervisorProcedure` admite ADMIN
	 * además de COBROS_SUPERVISOR, y la UI de notificaciones muestra este rol
	 * junto al nombre del creador: fijarlo a "cobros_supervisor" atribuía mal
	 * la acción cuando decide un admin.
	 */
	creadoPorRole?: RolNotificacion;
}): Promise<void> {
	// La señal de "este convenio ya se decidió" —la que lee
	// `reconciliarSiYaSeDecidio`— es una fila `convenio_resuelto` con
	// `convenio_id`. Sale de uno de dos lugares, nunca de los dos:
	//   · con asesor: el aviso real que se inserta más abajo;
	//   · sin asesor: esta marca interna, que es un no-op si hay asesor.
	// No pueden convivir: el índice único es (convenio_decision_id,
	// assigned_to) y, cuando el decisor resulta ser el mismo asesor, la marca
	// ganaría el ON CONFLICT y el aviso real se perdería en silencio.
	// El cierre va DESPUÉS de que la señal esté escrita, en los dos caminos:
	// si cerrara antes, un aviso de pendiente que llegue tarde no encontraría
	// la señal y quedaría huérfano. Se cierra aunque no haya asesor a quien
	// avisar — son cosas independientes.
	const cerrarPendientes = async () => {
		try {
			await resolverPendientesDeAprobacion(params.convenioId);
		} catch (error) {
			console.warn(
				"[notificarConvenioResuelto] No se pudieron resolver los pendientes de aprobación (best-effort):",
				error instanceof Error ? error.message : error,
			);
		}
	};

	if (!params.asesorUserId) {
		// sin asesor enlazado por correo, no hay a quién avisar
		await cerrarPendientes();
		return;
	}
	try {
		const titulo =
			params.decision === "aprobado"
				? "Convenio aprobado"
				: "Convenio rechazado";
		const descripcion =
			params.decision === "aprobado"
				? "El supervisor aprobó el convenio de pago."
				: `El supervisor rechazó el convenio de pago. Motivo: ${params.motivo ?? "sin especificar"}.`;

		// La dedup es la restricción, no una consulta previa: un SELECT antes
		// del INSERT no protege bajo concurrencia (dos reintentos simultáneos
		// lo pasan ambos). Se confía en el ON CONFLICT del índice único
		// uq_notifications_convenio_decision — Drizzle no expone
		// onConflictDoNothing con `where` parcial de forma portable acá, así
		// que se usa SQL crudo para el ON CONFLICT calificado al índice.
		await db.execute(sql`
			INSERT INTO notifications (
				id, titulo, descripcion, status, type, created_by, created_by_role,
				assigned_to_role, assigned_to, related_entity_type, related_entity_id,
				redirect_page, cobros_tipo, convenio_decision_id, convenio_id,
				created_at, updated_at
			) VALUES (
				gen_random_uuid(), ${titulo}, ${descripcion}, 'pending', 'aviso',
				${params.creadoPorUserId}, ${params.creadoPorRole ?? "cobros_supervisor"}, 'cobros', ${params.asesorUserId},
				'collection_case', ${params.casoCobroId}, 'cobros_detail', 'convenio_resuelto',
				${params.decisionId}, ${params.convenioId}, now(), now()
			)
			ON CONFLICT (convenio_decision_id, assigned_to) WHERE convenio_decision_id IS NOT NULL
			DO NOTHING
		`);
	} catch (error) {
		console.warn(
			"[notificarConvenioResuelto] No se pudo notificar (best-effort):",
			error instanceof Error ? error.message : error,
		);
	}

	await cerrarPendientes();
}
