/**
 * Workspace de cobros · panel derecho, «Gestión».
 *
 * Todas las gestiones del caso como un flujo dentro del mismo panel, sin
 * modales encima (Figma «CRM Ventas» › Workspace, gp/*): inicio → acción →
 * formulario → «Gestión registrada» → «Siguiente caso». Los formularios son
 * los del sistema en modo `embebido` (mismos campos, validaciones y
 * procedimientos que en la Ficha 360).
 *
 * Máquina de estados (`Paso`):
 *  - inicio: contexto (visita programada, rescate, última gestión) y «Otras
 *    gestiones»; el primer grupo es «Contacto» (Llamada, Mensaje, entrantes).
 *  - participante: «¿Con quién está hablando?» (llamada saliente o entrante,
 *    WhatsApp entrante). Saliente: «Llamar» abre `tel:` y pasa al resultado.
 *  - resultado: banda + segmentado (acuerdo / sin acuerdo / sin contacto).
 *    «Acuerdo» lista las opciones y cada una abre su formulario (subpaso).
 *  - destinatario → mensaje (WhatsApp / SMS / Correo) → enviado.
 *  - directa: un formulario abierto desde el inicio (o encadenado).
 *  - referencia: la gestión a una referencia de «Contactar referencias».
 *  - visita-registrada: el resultado de la visita y los siguientes pasos.
 *  - registrada: «Gestión registrada» con el resumen.
 *
 * La nota de la gestión es UNA sola, la guarda este panel y la comparten los
 * resultados (ContactoModal dibuja el campo; aquí solo se mantiene el valor).
 */
import { useQuery } from "@tanstack/react-query";
import {
	HandCoins,
	Handshake,
	Loader2,
	PackageCheck,
	Phone,
	Receipt,
} from "lucide-react";
import * as React from "react";
import { metodoContactoDeVisita } from "server/src/lib/visitas-cobros";
import { toast } from "sonner";
import {
	AccionPendienteCelda,
	fechaLarga,
} from "@/components/cobros/asesor/fila-cartera";
import { ConvenioModal } from "@/components/cobros/convenio-modal";
import { SolicitarInmovilizacionModal } from "@/components/cobros/inmovilizacion-solicitar-modal";
import { InvestigacionRedesDialog } from "@/components/cobros/investigacion-redes-dialog";
import { PagaloLinkDialog } from "@/components/cobros/pagalo-link-dialog";
import { ConfirmarRecepcionDelCaso } from "@/components/cobros/recuperacion-vehiculo-card";
import { RecuperacionVehiculoDialog } from "@/components/cobros/recuperacion-vehiculo-dialog";
import {
	type ReferenciaCaso,
	RegistrarGestionReferenciaDialog,
} from "@/components/cobros/referencias-dialogs";
import { RegistrarPagoForm } from "@/components/cobros/registrar-pago-form";
import { SeguimientoRecurrenteModal } from "@/components/cobros/seguimiento-recurrente-modal";
import {
	VisitaDialog,
	type VisitaProgramadaParaCompletar,
	type VisitaRegistrada,
} from "@/components/cobros/visita-dialog";
import {
	ContactoModal,
	type EstadoContacto,
} from "@/components/contacto-modal";
import { inicialesDe } from "@/components/ds/cards-credito";
import { SegmentedNav } from "@/components/ds/ubicaciones";
import { Button } from "@/components/ui/button";
import { urlWhatsapp } from "@/lib/cobros/referencias";
import { hrefTelefono, montoSugeridoPromesa } from "@/lib/cobros/reglas-caso";
import { cn } from "@/lib/utils";
import { client, orpc } from "@/utils/orpc";
import {
	type AccionDirecta,
	accionEntrega,
	accionJuridico,
	accionRecuperacion,
	grupoCampo,
	gruposDelInicio,
	nivelDelCaso,
	type OpcionAcuerdo,
	opcionesDeAcuerdo,
	recuperacionVisible,
	tituloAccion,
	tituloOpcionAcuerdo,
} from "./gestion/acciones";
import {
	correoDeRelleno,
	telefonoDeRelleno,
	telefonosValidos,
} from "./gestion/contacto-valido";
import { DeshacerConvenioForm } from "./gestion/deshacer-convenio";
import { InicioGestionVista } from "./gestion/inicio";
import {
	OpcionesAcuerdo,
	type ParticipanteGestion,
	ParticipantesVista,
	type ResultadoGestion,
	ResultadoGestionVista,
} from "./gestion/llamada";
import {
	type AccionGestion,
	BandaContexto,
	CabeceraPaso,
	etiquetaResultado,
	ListaGestiones,
	PasoGestion,
} from "./gestion/piezas";
import {
	GestionRegistradaVista,
	MensajeEnviadoVista,
	type ResumenRegistrada,
} from "./gestion/registrada";
import {
	type ContactoRegistrado,
	resumenApagado,
	resumenContacto,
	resumenConvenio,
	resumenConvenioDeshecho,
	resumenInvestigacion,
	resumenLinksPagalo,
	resumenPago,
	resumenRecepcion,
	resumenRecuperacion,
	resumenReferencia,
	resumenSeguimiento,
	resumenVisitaProgramada,
	resumenVisitaRegistrada,
} from "./gestion/resumenes";
import {
	type VisitaPendiente,
	VisitaProgramadaTarjeta,
	visitaProgramadaPendiente,
} from "./gestion/visita-programada";
import { ReferenciasGestion } from "./referencias-gestion";
import type { CasoWorkspace } from "./use-caso-workspace";

/* ── Estado del flujo ──────────────────────────────────────────────────────── */

type CanalGestion = {
	metodo: "llamada" | "whatsapp" | "sms" | "email";
	direccion: "saliente" | "entrante";
};
type CanalMensaje = "whatsapp" | "sms" | "email";

type Paso =
	| { t: "inicio" }
	| { t: "participante"; canal: CanalGestion }
	| {
			t: "resultado";
			canal: CanalGestion;
			resultado: ResultadoGestion;
			opcion: OpcionAcuerdo | null;
	  }
	| { t: "destinatario" }
	| { t: "mensaje"; canal: CanalMensaje }
	| { t: "enviado"; canal: CanalMensaje }
	| {
			t: "directa";
			accion: AccionDirecta;
			/** A dónde lleva «Atrás» / «Cancelar». */
			volver: Paso;
			/** Encadenado desde una visita registrada (promesa, entrega). */
			visita?: VisitaRegistrada;
			modoVisita?: "registrar" | "programar";
			/** Completar una visita programada (R3-7). */
			programada?: VisitaProgramadaParaCompletar;
	  }
	| { t: "referencia"; referencia: ReferenciaCaso; volver: Paso }
	| { t: "visita-registrada"; visita: VisitaRegistrada }
	| {
			t: "registrada";
			resumen: ResumenRegistrada;
			/** B3+ sin acuerdo o sin contacto: ofrecer las acciones de rescate. */
			rescate?: boolean;
	  };

/**
 * ¿Hay algo a medias que se perdería? (guardián del modal, R3-14). Elegir el
 * participante, mirar la lista de referencias o el resultado sin una opción
 * abierta no cuentan; un formulario abierto sí (con «No hubo acuerdo» / «No
 * hubo contacto» el formulario ya está abierto).
 */
function pasoEnCurso(p: Paso): boolean {
	switch (p.t) {
		case "inicio":
		case "participante":
		case "destinatario":
		case "enviado":
		case "visita-registrada":
		case "registrada":
			return false;
		case "resultado":
			return p.resultado !== "acuerdo" || p.opcion !== null;
		case "directa":
			return p.accion !== "referencias";
		default:
			return true;
	}
}

const NOMBRE_METODO: Record<CanalGestion["metodo"], string> = {
	llamada: "Llamada",
	whatsapp: "WhatsApp",
	sms: "SMS",
	email: "Correo",
};

const CANALES_MENSAJE: Array<{ value: CanalMensaje; label: string }> = [
	{ value: "whatsapp", label: "WhatsApp" },
	{ value: "sms", label: "SMS" },
	{ value: "email", label: "Correo" },
];

const ESTADOS_SIN_ACUERDO: EstadoContacto[] = [
	"contactado",
	"rechaza_pagar",
	"acuerdo_parcial",
];
const ESTADOS_SIN_CONTACTO: EstadoContacto[] = [
	"no_contesta",
	"numero_equivocado",
];

function clavePaso(p: Paso): string {
	switch (p.t) {
		case "resultado":
			return `resultado-${p.canal.metodo}-${p.canal.direccion}`;
		case "directa":
			return `directa-${p.accion}-${p.visita?.visitaId ?? ""}-${p.programada?.id ?? ""}`;
		case "referencia":
			return `referencia-${p.referencia.key}`;
		default:
			return p.t;
	}
}

/* ── Participantes del caso ────────────────────────────────────────────────── */

function participantesDelCaso(caso: CasoWorkspace): ParticipanteGestion[] {
	const principales = caso.contacto.telefonosPrincipales;
	const titular: ParticipanteGestion = {
		id: "titular",
		tipo: "titular",
		nombre: caso.identidad.nombre,
		rol: "Titular",
		iniciales: caso.identidad.iniciales,
		telefonos: caso.contacto.telefonos.map((numero) => ({
			numero,
			etiqueta: principales.includes(numero) ? "Principal" : "Alternativo",
			invalido: telefonoDeRelleno(numero),
		})),
		correo: caso.contacto.email,
		correoInvalido:
			!!caso.contacto.email && correoDeRelleno(caso.contacto.email),
	};
	// Codeudores: TODO(José) · tarea F2 (hoy `codeudores` llega null).
	const codeudores: ParticipanteGestion[] = (
		caso.complementos?.codeudores ?? []
	).map((c) => {
		const telefonos = [
			{ numero: c.telefonoPrincipal, etiqueta: "Principal" },
			{ numero: c.celularAlterno, etiqueta: "Celular" },
			{ numero: c.telefonoCasa, etiqueta: "Casa" },
		]
			.filter((t): t is { numero: string; etiqueta: string } => !!t.numero)
			.map((t) => ({ ...t, invalido: telefonoDeRelleno(t.numero) }));
		return {
			id: `codeudor-${c.id}`,
			tipo: "codeudor",
			nombre: c.nombre,
			rol: c.rol,
			iniciales: inicialesDe(c.nombre),
			telefonos,
			correo: c.correo,
			correoInvalido: !!c.correo && correoDeRelleno(c.correo),
		};
	});
	return [titular, ...codeudores];
}

/* ── Panel ─────────────────────────────────────────────────────────────────── */

export function GestionPanel({
	caso,
	onSiguienteCaso,
	onEnCursoChange,
	className,
}: {
	caso: CasoWorkspace;
	/** undefined = no hay siguiente caso en la lista. */
	onSiguienteCaso?: () => void;
	/** true mientras hay un flujo a medias (lo usa el guardián del modal). */
	onEnCursoChange?: (enCurso: boolean) => void;
	/**
	 * Abre la Ficha 360 (cierra el modal). Hoy no se usa aquí: «Abrir Ficha
	 * 360» vive abajo del panel izquierdo (R2-9).
	 */
	onAbrirFicha?: () => void;
	className?: string;
}) {
	const [paso, setPaso] = React.useState<Paso>({ t: "inicio" });
	const [participanteId, setParticipanteId] = React.useState("titular");
	const [telefonoElegido, setTelefonoElegido] = React.useState<string | null>(
		null,
	);
	const [notas, setNotas] = React.useState("");

	// Una nota escrita también es trabajo a medias.
	const enCurso = pasoEnCurso(paso) || notas.trim() !== "";
	React.useEffect(() => {
		onEnCursoChange?.(enCurso);
		// Al desmontar (cambio de caso), el guardián no debe quedar armado.
		return () => onEnCursoChange?.(false);
	}, [enCurso, onEnCursoChange]);

	const participantes = participantesDelCaso(caso);
	const participante =
		participantes.find((p) => p.id === participanteId) ?? participantes[0];
	// Los datos de relleno («00000000») no se ofrecen como destino.
	const telefono =
		telefonoElegido ??
		participante.telefonos.find((t) => !t.invalido)?.numero ??
		null;
	const textoParticipante = `${participante.nombre} · ${participante.rol}`;
	const participanteContacto = {
		tipo: participante.tipo,
		nombre: participante.nombre,
	} as const;

	const casoCobroId = caso.identidad.casoCobroId;

	// Los formularios de contacto reciben solo destinos válidos: sin los
	// teléfonos ni el correo de relleno, nada se envía a un destino falso.
	const propsContacto = {
		...caso.propsContacto,
		telefonoPrincipal: telefonosValidos(caso.propsContacto.telefonoPrincipal),
		telefonoAlternativo:
			telefonosValidos(caso.propsContacto.telefonoAlternativo) || undefined,
		emailCliente: correoDeRelleno(caso.propsContacto.emailCliente)
			? ""
			: caso.propsContacto.emailCliente,
	};

	// CB-041 (R3-2): misma consulta y opciones que `useCasoWorkspace` (y que la
	// tarjeta de la ficha), así sale de la caché. Da el id del apagado o de la
	// reactivación a la que falta enlazarle la llamada.
	const inmovilizaciones = useQuery({
		...orpc.getInmovilizacionesCaso.queryOptions({
			input: { casoCobroId: casoCobroId ?? "" },
		}),
		staleTime: 30_000,
		refetchOnWindowFocus: false,
		enabled: !!casoCobroId,
	});

	/**
	 * La llamada recién registrada queda enlazada al apagado o a la
	 * reactivación que esperaba la llamada, igual que
	 * `enlazarLlamadaInmovilizacion` de la ficha. La gestión ya se guardó: si
	 * el enlace falla se avisa y el aviso de la ficha sigue ahí.
	 */
	const enlazarLlamada = async (contactoId: string) => {
		const pendiente = caso.apagado.pasoPendiente;
		if (pendiente?.pasoActual !== "llamada") return;
		const datos = inmovilizaciones.data;
		const inmovilizacion =
			pendiente.accion === "apagado"
				? datos?.pendienteLlamar
				: datos?.pendienteLlamarReactivacion;
		if (!inmovilizacion) return;
		const entrada = { inmovilizacionId: inmovilizacion.id, contactoId };
		try {
			if (pendiente.accion === "apagado") {
				await client.registrarLlamadaApagado(entrada);
			} else {
				await client.registrarLlamadaReactivacion(entrada);
			}
			toast.success(
				`Llamada enlazada ${pendiente.accion === "apagado" ? "al apagado" : "a la reactivación"}.`,
			);
		} catch (error) {
			toast.error(
				(error as { message?: string })?.message ??
					"La gestión se guardó, pero no se pudo enlazar a la inmovilización.",
			);
		} finally {
			caso.refrescar();
		}
	};

	const irInicio = () => {
		setNotas("");
		setPaso({ t: "inicio" });
	};
	/** Guardado: refresca el caso (panel izquierdo) y muestra el resumen. */
	const registrar = (resumen: ResumenRegistrada, rescate = false) => {
		caso.refrescar();
		setNotas("");
		setPaso({ t: "registrada", resumen, rescate });
	};
	const elegirParticipante = (id: string) => {
		setParticipanteId(id);
		setTelefonoElegido(null);
	};

	let contenido: React.ReactNode;

	if (caso.cargando) {
		contenido = (
			<div className="flex flex-1 items-center justify-center gap-2 text-fg-secondary text-sm">
				<Loader2 aria-hidden className="size-4 animate-spin" />
				Cargando el caso…
			</div>
		);
	} else if (caso.error && !caso.detalle) {
		// Solo sin datos: si falla un refetch, el formulario a medias sigue.
		contenido = (
			<div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
				<p className="text-fg-secondary text-sm">
					No se pudo cargar el caso. {caso.error.message}
				</p>
				<Button
					type="button"
					variant="secondary"
					size="sm"
					onClick={caso.refrescar}
				>
					Reintentar
				</Button>
			</div>
		);
	} else if (!casoCobroId) {
		contenido = <InicioGestionVista sinCaso grupos={[]} />;
	} else {
		contenido = (
			<React.Fragment key={clavePaso(paso)}>
				{renderPaso(casoCobroId)}
			</React.Fragment>
		);
	}

	function renderPaso(casoCobroId: string): React.ReactNode {
		switch (paso.t) {
			case "inicio":
				return renderInicio();
			case "participante":
				return renderParticipante(paso.canal);
			case "resultado":
				return renderResultado(casoCobroId, paso);
			case "destinatario":
				return (
					<ParticipantesVista
						titulo="¿A quién le escribimos?"
						descripcion="Seleccione el destinatario del mensaje."
						mostrarCorreo
						participantes={participantes}
						participanteId={participante.id}
						onParticipante={elegirParticipante}
						telefono={telefono}
						onTelefono={setTelefonoElegido}
						onAtras={irInicio}
						pie={
							<Button
								type="button"
								className="w-full"
								onClick={() => setPaso({ t: "mensaje", canal: "whatsapp" })}
							>
								Continuar
							</Button>
						}
					/>
				);
			case "mensaje":
				return renderMensaje(paso.canal);
			case "enviado":
				return (
					<MensajeEnviadoVista
						canal={paso.canal}
						abrir={enlaceAbrir(paso.canal)}
						destinatario={[
							participante.nombre,
							paso.canal === "email" ? caso.contacto.email : telefono,
						]
							.filter(Boolean)
							.join(" · ")}
						onRegistrarResultado={() =>
							setPaso({
								t: "resultado",
								// La respuesta del cliente entra por el mismo canal.
								canal: { metodo: paso.canal, direccion: "entrante" },
								resultado: "acuerdo",
								opcion: null,
							})
						}
						onSiguienteCaso={onSiguienteCaso}
						onVolverInicio={irInicio}
					/>
				);
			case "directa":
				return renderDirecta(casoCobroId, paso);
			case "referencia":
				return (
					<PasoGestion
						formulario
						cabecera={
							<CabeceraPaso
								titulo="Registrar gestión con la referencia"
								onAtras={() => setPaso(paso.volver)}
							/>
						}
					>
						<RegistrarGestionReferenciaDialog
							casoCobroId={casoCobroId}
							referencia={paso.referencia}
							embebido
							onCancelar={() => setPaso(paso.volver)}
							onExito={(r) => registrar(resumenReferencia(r))}
						/>
					</PasoGestion>
				);
			case "visita-registrada":
				return renderVisitaRegistrada(paso.visita);
			case "registrada": {
				// B3+ sin acuerdo o sin contacto: el grupo de campo del inicio,
				// como «Siguiente paso» de la visita (R2-22).
				const aqui = paso;
				const campo = paso.rescate
					? grupoCampo(caso, (a) =>
							setPaso({ t: "directa", accion: a, volver: aqui }),
						)
					: null;
				return (
					<GestionRegistradaVista
						resumen={paso.resumen}
						onSiguienteCaso={onSiguienteCaso}
						onVolverInicio={irInicio}
					>
						{campo ? (
							<ListaGestiones
								titulo="Acciones de rescate · seleccione según el caso"
								acciones={campo.acciones}
							/>
						) : null}
					</GestionRegistradaVista>
				);
			}
		}
	}

	/* ── Inicio ─────────────────────────────────────────────────────────── */

	function abrirDirecta(accion: AccionDirecta) {
		setPaso({ t: "directa", accion, volver: { t: "inicio" } });
	}

	/** «Visita programada» / «En visita de campo hoy» (R3-7, R2-27). */
	function tarjetaVisita(v: VisitaPendiente) {
		const accesos: AccionGestion[] = [];
		if (v.hoy) {
			accesos.push({
				id: "convenio",
				icono: Handshake,
				titulo: "Convenio de pago",
				motivoBloqueo: caso.convenio.motivoBloqueo,
				onClick: () => abrirDirecta("convenio"),
			});
			if (recuperacionVisible(caso)) {
				accesos.push(
					accionRecuperacion(caso, () => abrirDirecta("recuperacion")),
					accionEntrega(caso, () => abrirDirecta("entrega")),
				);
			}
			if (nivelDelCaso(caso) >= 3) accesos.push(accionJuridico());
		}
		return (
			<VisitaProgramadaTarjeta
				visita={v}
				accesos={accesos}
				onRegistrar={() =>
					setPaso({
						t: "directa",
						accion: "visita",
						programada: v.programada,
						volver: { t: "inicio" },
					})
				}
			/>
		);
	}

	function renderInicio() {
		const ultima = caso.gestiones.find(
			(g) => g.estadoContacto !== "link_pago_generado",
		);
		const intentos = caso.seguimiento.intentosSinContacto;
		const accion = caso.seguimiento.accionPendiente;
		// Completar una programada es del equipo de cobros (como la tarjeta
		// «Visitas» de la ficha, `puedeGestionar`).
		const visita = caso.recuperacion.puede
			? visitaProgramadaPendiente(caso.visita.lista)
			: null;
		return (
			<InicioGestionVista
				visita={visita ? tarjetaVisita(visita) : null}
				rescate={
					caso.bucket.numero === 3
						? {
								titulo: "Rescate · última oportunidad de acuerdo antes de B4",
								detalle:
									"Inicie el contacto para presentar la última propuesta estructurada de pago.",
							}
						: null
				}
				ultimaGestion={
					ultima
						? {
								resultado: etiquetaResultado(ultima.estadoContacto),
								detalle: [
									ultima.fechaContacto
										? fechaLarga(ultima.fechaContacto)
										: null,
									intentos > 0
										? `${intentos} ${intentos === 1 ? "intento" : "intentos"} sin contacto`
										: null,
								]
									.filter(Boolean)
									.join(" · "),
								por: [
									ultima.metodoContacto
										? NOMBRE_METODO[
												ultima.metodoContacto as CanalGestion["metodo"]
											]
										: null,
									ultima.realizadoPor ? `por ${ultima.realizadoPor}` : null,
								]
									.filter(Boolean)
									.join(" · "),
							}
						: null
				}
				pendiente={
					accion ? (
						<AccionPendienteCelda
							accion={
								accion as React.ComponentProps<
									typeof AccionPendienteCelda
								>["accion"]
							}
						/>
					) : null
				}
				grupos={gruposDelInicio(caso, abrirDirecta, (tipo) => {
					switch (tipo) {
						case "llamada":
							setPaso({
								t: "participante",
								canal: { metodo: "llamada", direccion: "saliente" },
							});
							break;
						case "mensaje":
							setPaso({ t: "destinatario" });
							break;
						case "llamada-entrante":
							setPaso({
								t: "participante",
								canal: { metodo: "llamada", direccion: "entrante" },
							});
							break;
						case "whatsapp-entrante":
							setPaso({
								t: "participante",
								canal: { metodo: "whatsapp", direccion: "entrante" },
							});
							break;
					}
				})}
			/>
		);
	}

	/* ── Llamada / entrantes ─────────────────────────────────────────────── */

	function irResultado(canal: CanalGestion) {
		setPaso({ t: "resultado", canal, resultado: "acuerdo", opcion: null });
	}

	function renderParticipante(canal: CanalGestion) {
		const saliente =
			canal.metodo === "llamada" && canal.direccion === "saliente";
		const destino =
			participante.tipo === "titular" ? "al titular" : "al codeudor";
		return (
			<ParticipantesVista
				titulo="¿Con quién está hablando?"
				descripcion={
					saliente
						? "Seleccione el participante con el que registrará esta gestión. Puede cambiarlo durante la llamada."
						: "Seleccione el participante que se comunicó."
				}
				participantes={participantes}
				participanteId={participante.id}
				onParticipante={elegirParticipante}
				telefono={telefono}
				onTelefono={setTelefonoElegido}
				onAtras={irInicio}
				pie={
					saliente && telefono ? (
						<div className="grid grid-cols-[auto_1fr] gap-2.5">
							<Button
								type="button"
								variant="secondary"
								onClick={() => irResultado(canal)}
							>
								Continuar sin marcar
							</Button>
							<Button asChild>
								<a
									href={hrefTelefono(telefono)}
									onClick={() => irResultado(canal)}
								>
									<Phone aria-hidden />
									Llamar {destino}
								</a>
							</Button>
						</div>
					) : (
						<Button
							type="button"
							className="w-full"
							onClick={() => irResultado(canal)}
						>
							Continuar
						</Button>
					)
				}
			/>
		);
	}

	function bandaDe(canal: CanalGestion): string {
		if (canal.metodo === "llamada") {
			return canal.direccion === "saliente"
				? ["Llamada saliente", participante.nombre, telefono]
						.filter(Boolean)
						.join(" · ")
				: `Llamada entrante · ${participante.nombre}`;
		}
		if (canal.metodo === "whatsapp") {
			return `WhatsApp · atendiendo al cliente · ${participante.nombre}`;
		}
		return `${NOMBRE_METODO[canal.metodo]} · respuesta del cliente · ${participante.nombre}`;
	}

	function renderResultado(
		casoCobroId: string,
		p: Extract<Paso, { t: "resultado" }>,
	) {
		const { canal, resultado, opcion } = p;
		const resultados: ResultadoGestion[] =
			canal.metodo === "llamada" && canal.direccion === "saliente"
				? ["acuerdo", "no_acuerdo", "no_contacto"]
				: ["acuerdo", "no_acuerdo"];
		const tipoGestion = `${NOMBRE_METODO[canal.metodo]} ${canal.direccion}`;
		const telefonoContacto =
			canal.metodo === "email" ? undefined : (telefono ?? undefined);
		const alSubpaso = (o: OpcionAcuerdo | null) => setPaso({ ...p, opcion: o });
		const volverParticipante = () => setPaso({ t: "participante", canal });

		let formulario = false;
		let cuerpo: React.ReactNode;

		if (resultado === "acuerdo" && !opcion) {
			const { opciones, secundaria } = opcionesDeAcuerdo(caso, alSubpaso);
			cuerpo = (
				<OpcionesAcuerdo
					opciones={opciones}
					secundaria={secundaria}
					notas={notas}
					onNotasChange={setNotas}
				/>
			);
		} else if (resultado === "acuerdo" && opcion) {
			formulario = true;
			const cancelar = () => alSubpaso(null);
			switch (opcion) {
				case "promesa":
					cuerpo = (
						<ContactoModal
							{...propsContacto}
							metodoInicial={canal.metodo}
							variante="promesa"
							embebido
							onCancelar={cancelar}
							cuotasDisponibles={caso.promesa.cuotasDisponibles}
							montoSugerido={caso.promesa.montoSugerido}
							montoMora={caso.promesa.montoMora}
							esConvenio={caso.promesa.esConvenio}
							cuotaConvenio={caso.promesa.cuotaConvenio}
							promesaActiva={caso.promesa.promesaActiva}
							notas={notas}
							onNotasChange={setNotas}
							direccion={canal.direccion}
							participante={participanteContacto}
							telefonoContactado={telefonoContacto}
							onCreado={(c) => {
								registrar(
									resumenContacto(c as ContactoRegistrado, {
										tipoGestion,
										participante: textoParticipante,
										promesa: true,
										edicion: !!caso.promesa.promesaActiva,
									}),
								);
								if (canal.metodo === "llamada") void enlazarLlamada(c.id);
							}}
						/>
					);
					break;
				case "pago":
					cuerpo = renderPagalo(casoCobroId, cancelar);
					break;
				case "comprobante":
					cuerpo = renderComprobante(cancelar, textoParticipante);
					break;
				case "convenio":
					cuerpo = renderConvenio(casoCobroId, cancelar);
					break;
				case "entrega":
					cuerpo = renderRecuperacion(
						casoCobroId,
						"entrega_voluntaria",
						cancelar,
					);
					break;
			}
		} else {
			formulario = true;
			const visitaPermitida = !caso.visita.bloqueo && nivelDelCaso(caso) >= 2;
			cuerpo = (
				<ContactoModal
					key={`${resultado}-${canal.metodo}-${canal.direccion}`}
					{...propsContacto}
					metodoInicial={canal.metodo}
					embebido
					// «Cancelar» abandona la gestión: vuelve al inicio.
					onCancelar={irInicio}
					estadosPermitidos={
						resultado === "no_contacto"
							? ESTADOS_SIN_CONTACTO
							: ESTADOS_SIN_ACUERDO
					}
					notas={notas}
					onNotasChange={setNotas}
					direccion={canal.direccion}
					participante={participanteContacto}
					telefonoContactado={telefonoContacto}
					accionExtraPie={
						visitaPermitida ? (
							<Button
								type="button"
								variant="secondary"
								className="w-full"
								onClick={() =>
									setPaso({
										t: "directa",
										accion: "visita",
										modoVisita: "programar",
										volver: p,
									})
								}
							>
								Programar visita de campo
							</Button>
						) : undefined
					}
					onCreado={(c) => {
						registrar(
							resumenContacto(c as ContactoRegistrado, {
								tipoGestion,
								participante: textoParticipante,
							}),
							// B3 en adelante: ofrecer las acciones de rescate (R2-22).
							nivelDelCaso(caso) >= 3,
						);
						if (canal.metodo === "llamada") void enlazarLlamada(c.id);
					}}
				/>
			);
		}

		return (
			<ResultadoGestionVista
				banda={bandaDe(canal)}
				tonoBanda={canal.metodo === "llamada" ? "success" : "brand"}
				onCambiarParticipante={volverParticipante}
				onAtras={volverParticipante}
				resultados={resultados}
				resultado={resultado}
				onResultado={(r) => setPaso({ ...p, resultado: r, opcion: null })}
				subpaso={
					resultado === "acuerdo" && opcion
						? {
								titulo: tituloOpcionAcuerdo(opcion, caso),
								onAtras: () => alSubpaso(null),
							}
						: null
				}
				formulario={formulario}
			>
				{cuerpo}
			</ResultadoGestionVista>
		);
	}

	/* ── Mensaje ─────────────────────────────────────────────────────────── */

	function renderMensaje(canal: CanalMensaje) {
		const cambiarDestinatario = () => setPaso({ t: "destinatario" });
		// Sin CabeceraPaso (R2-17): la banda lleva «Cambiar destinatario».
		return (
			<PasoGestion
				formulario
				cabecera={
					<div className="flex flex-col gap-3 px-5 pt-4 pb-3">
						<BandaContexto
							tono="brand"
							accion={
								<button
									type="button"
									onClick={cambiarDestinatario}
									className="cursor-pointer rounded font-semibold text-[13px] underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
								>
									Cambiar destinatario
								</button>
							}
						>
							Nueva gestión · mensaje a {participante.nombre}
						</BandaContexto>
						<SegmentedNav
							aria-label="Canal del mensaje"
							value={canal}
							onValueChange={(v) =>
								setPaso({ t: "mensaje", canal: v as CanalMensaje })
							}
							className="grid w-full grid-cols-3"
							opciones={CANALES_MENSAJE}
						/>
					</div>
				}
			>
				<ContactoModal
					key={canal}
					{...propsContacto}
					metodoInicial={canal}
					embebido
					// «Cancelar» abandona el mensaje: vuelve al inicio.
					onCancelar={irInicio}
					// «Registrar sin enviar» con el colapsable cerrado guarda
					// «Mensaje enviado», no «Contactado» (R3-4).
					estadoInicial="mensaje_enviado"
					notas={notas}
					onNotasChange={setNotas}
					direccion="saliente"
					participante={participanteContacto}
					telefonoContactado={
						canal === "email" ? undefined : (telefono ?? undefined)
					}
					onCreado={(c) => {
						const contacto = c as ContactoRegistrado;
						if (
							!contacto.estadoContacto ||
							contacto.estadoContacto === "mensaje_enviado"
						) {
							caso.refrescar();
							setNotas("");
							setPaso({ t: "enviado", canal });
							return;
						}
						registrar(
							resumenContacto(contacto, {
								tipoGestion: `${NOMBRE_METODO[canal]} saliente`,
								participante: textoParticipante,
							}),
						);
					}}
				/>
			</PasoGestion>
		);
	}

	/** «Abrir WhatsApp» / «Abrir correo» de «Mensaje enviado»: solo abre. */
	function enlaceAbrir(
		canal: CanalMensaje,
	): { href: string; etiqueta: string } | null {
		if (canal === "whatsapp" && telefono && !telefonoDeRelleno(telefono)) {
			return { href: urlWhatsapp(telefono), etiqueta: "Abrir WhatsApp" };
		}
		const correo = participante.correo;
		if (canal === "email" && correo && !correoDeRelleno(correo)) {
			return { href: `mailto:${correo}`, etiqueta: "Abrir correo" };
		}
		return null;
	}

	/* ── Formularios directos ─────────────────────────────────────────────── */

	function renderPagalo(casoCobroId: string, cancelar: () => void) {
		if (!caso.identidad.numeroSifco || !caso.identidad.carteraCreditoId) {
			return (
				<SinDatos texto="Este caso no tiene un crédito de cartera para generar links de pago." />
			);
		}
		return (
			<PagaloLinkDialog
				casoCobroId={casoCobroId}
				numeroSifco={caso.identidad.numeroSifco}
				creditoId={caso.identidad.carteraCreditoId}
				mostrarTrigger={false}
				embebido
				onCancelar={cancelar}
				onExito={(r) => registrar(resumenLinksPagalo(r))}
			/>
		);
	}

	function renderComprobante(cancelar: () => void, participanteTexto?: string) {
		// `embebido`: trae su resumen, su cuerpo con scroll y su pie fijo.
		return (
			<div className="flex min-h-0 flex-1 flex-col">
				<RegistrarPagoForm
					embebido
					creditoId={caso.id}
					onVolver={cancelar}
					onExito={(r) => registrar(resumenPago(r, participanteTexto))}
				/>
			</div>
		);
	}

	function renderConvenio(casoCobroId: string, cancelar: () => void) {
		if (!caso.convenio.habilitado) {
			return (
				<SinDatos
					texto={
						caso.convenio.motivoBloqueo ??
						"El convenio de pago no está disponible para este caso."
					}
				/>
			);
		}
		return (
			<ConvenioModal
				open
				onOpenChange={() => {}}
				casoCobroId={casoCobroId}
				clienteNombre={caso.identidad.nombre}
				cuotas={caso.convenio.cuotas}
				cuotaMensual={caso.convenio.cuotaMensual}
				montoMora={caso.convenio.montoMora}
				maxMeses={caso.convenio.maxMeses}
				embebido
				onCancelar={cancelar}
				onCreado={(r) => registrar(resumenConvenio(r))}
			/>
		);
	}

	function renderRecuperacion(
		casoCobroId: string,
		tipo: "tomado" | "entrega_voluntaria",
		cancelar: () => void,
		visita?: VisitaRegistrada,
	) {
		const bloqueo =
			tipo === "tomado"
				? caso.recuperacion.bloqueoForzosa
				: caso.recuperacion.bloqueoVoluntaria;
		const operacion = caso.recuperacion.operacion(tipo);
		if (bloqueo || !operacion) {
			return (
				<SinDatos
					texto={bloqueo ?? "No está disponible en el bucket actual del caso."}
				/>
			);
		}
		return (
			<RecuperacionVehiculoDialog
				tipo={tipo}
				operacion={operacion}
				casoCobroId={casoCobroId}
				vehicleId={caso.identidad.vehicleId}
				desdeVisita={
					visita
						? {
								visitaId: visita.visitaId,
								lugar: visita.direccion,
								fecha: visita.fechaVisita,
							}
						: undefined
				}
				embebido
				onCancelar={cancelar}
				onExito={(r) => registrar(resumenRecuperacion(r))}
			/>
		);
	}

	function renderDirecta(
		casoCobroId: string,
		p: Extract<Paso, { t: "directa" }>,
	) {
		const volver = () => setPaso(p.volver);
		let titulo = tituloAccion(p.accion, caso);
		if (p.accion === "visita" && p.modoVisita === "programar") {
			titulo = "Programar visita";
		}
		if (p.accion === "visita" && p.programada) {
			titulo = "Registrar resultado de la visita";
		}
		let cuerpo: React.ReactNode;
		let formulario = true;

		switch (p.accion) {
			case "promesa": {
				const v = p.visita;
				cuerpo = (
					<ContactoModal
						{...propsContacto}
						metodoInicial={v ? metodoContactoDeVisita(v.tipo) : "llamada"}
						variante="promesa"
						embebido
						onCancelar={volver}
						visitaId={v?.visitaId}
						montoYaPagado={v?.montoRecibido ?? undefined}
						cuotasDisponibles={caso.promesa.cuotasDisponibles}
						montoSugerido={
							v && caso.detalle
								? montoSugeridoPromesa(caso.detalle, v.montoRecibido ?? 0)
								: caso.promesa.montoSugerido
						}
						montoMora={caso.promesa.montoMora}
						esConvenio={caso.promesa.esConvenio}
						cuotaConvenio={caso.promesa.cuotaConvenio}
						promesaActiva={caso.promesa.promesaActiva}
						notas={notas}
						onNotasChange={setNotas}
						onCreado={(c) =>
							registrar(
								resumenContacto(c as ContactoRegistrado, {
									tipoGestion: v ? "Visita" : "Promesa de pago",
									participante: `${caso.identidad.nombre} · Titular`,
									promesa: true,
									edicion: !!caso.promesa.promesaActiva,
								}),
							)
						}
					/>
				);
				break;
			}
			case "link":
				cuerpo = renderPagalo(casoCobroId, volver);
				break;
			case "comprobante":
				cuerpo = renderComprobante(volver);
				break;
			case "convenio":
				cuerpo = renderConvenio(casoCobroId, volver);
				break;
			case "referencias":
				formulario = false;
				cuerpo = (
					<ReferenciasGestionPaso
						casoCobroId={casoCobroId}
						onRegistrar={(referencia) =>
							setPaso({ t: "referencia", referencia, volver: p })
						}
					/>
				);
				break;
			case "visita":
				// Completar una programada no depende del bloqueo de visitas
				// nuevas (igual que la tarjeta «Visitas» de la ficha).
				if (caso.visita.bloqueo && !p.programada) {
					cuerpo = <SinDatos texto={caso.visita.bloqueo} />;
					break;
				}
				cuerpo = (
					<VisitaDialog
						casoCobroId={casoCobroId}
						tipoInicial={p.programada?.tipo ?? "residencia"}
						modoInicial={p.programada ? "registrar" : p.modoVisita}
						programada={p.programada ?? null}
						direcciones={caso.visita.direcciones}
						deudaVencida={caso.visita.deudaVencida}
						incrementoDiarioMora={caso.visita.incrementoDiarioMora}
						convenioBloqueo={caso.visita.convenioBloqueo}
						bucketNumero={caso.bucket.numero}
						vehicleId={caso.identidad.vehicleId}
						embebido
						onCancelar={volver}
						onProgramada={(r) => registrar(resumenVisitaProgramada(r))}
						onRegistrada={(r) => {
							caso.refrescar();
							setNotas("");
							setPaso({ t: "visita-registrada", visita: r });
						}}
					/>
				);
				break;
			case "investigacion":
				cuerpo = (
					<InvestigacionRedesDialog
						casoCobroId={casoCobroId}
						embebido
						onCancelar={volver}
						onExito={(r) => registrar(resumenInvestigacion(r))}
					/>
				);
				break;
			case "apagado":
				cuerpo = (
					<SolicitarInmovilizacionModal
						accion="apagado"
						casoCobroId={casoCobroId}
						onSolicitado={() => {}}
						embebido
						onCancelar={volver}
						onExito={(r) => registrar(resumenApagado(r))}
					/>
				);
				break;
			case "recuperacion":
				cuerpo = renderRecuperacion(casoCobroId, "tomado", volver);
				break;
			case "entrega":
				cuerpo = renderRecuperacion(
					casoCobroId,
					"entrega_voluntaria",
					volver,
					p.visita,
				);
				break;
			case "recepcion":
				cuerpo = (
					<ConfirmarRecepcionDelCaso
						casoCobroId={casoCobroId}
						embebido
						onCancelar={volver}
						onExito={(r) => registrar(resumenRecepcion(r))}
					/>
				);
				break;
			case "deshacer-convenio":
				cuerpo = caso.convenio.puedeDeshacer ? (
					<DeshacerConvenioForm
						casoCobroId={casoCobroId}
						onCancelar={volver}
						onExito={(r) => registrar(resumenConvenioDeshecho(r))}
					/>
				) : (
					<SinDatos texto="Este caso no tiene un convenio vigente que se pueda deshacer." />
				);
				break;
			case "carta-notarial":
				cuerpo = (
					<ContactoModal
						{...propsContacto}
						metodoInicial="carta_notarial"
						embebido
						onCancelar={volver}
						notas={notas}
						onNotasChange={setNotas}
						onCreado={(c) =>
							registrar(
								resumenContacto(c as ContactoRegistrado, {
									tipoGestion: "Carta notarial",
									participante: `${caso.identidad.nombre} · Titular`,
								}),
							)
						}
					/>
				);
				break;
			case "seguimiento":
				cuerpo = (
					<SeguimientoRecurrenteModal
						casoCobroId={casoCobroId}
						embebido
						onCancelar={volver}
						onExito={(r) => registrar(resumenSeguimiento(r))}
					/>
				);
				break;
		}

		return (
			<PasoGestion
				formulario={formulario}
				cabecera={<CabeceraPaso titulo={titulo} onAtras={volver} />}
			>
				{cuerpo}
			</PasoGestion>
		);
	}

	/* ── Visita registrada: lo que sigue ──────────────────────────────────── */

	function renderVisitaRegistrada(r: VisitaRegistrada) {
		const aqui: Paso = { t: "visita-registrada", visita: r };
		const siguientes: AccionGestion[] = [];
		if (r.siguientes.pago) {
			siguientes.push({
				id: "comprobante",
				icono: Receipt,
				titulo: "Registrar comprobante de pago",
				subtitulo: "El cliente pagó durante la visita",
				tono: "success",
				onClick: () =>
					setPaso({ t: "directa", accion: "comprobante", volver: aqui }),
			});
		}
		if (r.siguientes.promesa) {
			siguientes.push({
				id: "promesa",
				icono: HandCoins,
				titulo: "Registrar promesa de pago",
				subtitulo: "Vinculada a esta visita",
				tono: "success",
				onClick: () =>
					setPaso({ t: "directa", accion: "promesa", volver: aqui, visita: r }),
			});
		}
		if (r.siguientes.convenio) {
			siguientes.push({
				id: "convenio",
				icono: Handshake,
				titulo: "Convenio de pago",
				subtitulo: "Registrar el convenio acordado en la visita",
				tono: "success",
				motivoBloqueo: caso.convenio.motivoBloqueo,
				onClick: () =>
					setPaso({ t: "directa", accion: "convenio", volver: aqui }),
			});
		}
		if (r.siguientes.entrega) {
			siguientes.push({
				id: "entrega",
				icono: PackageCheck,
				titulo: "Entrega voluntaria",
				subtitulo: "Con el lugar y la fecha de la visita",
				tono: "warning",
				motivoBloqueo: caso.recuperacion.bloqueoVoluntaria,
				onClick: () =>
					setPaso({ t: "directa", accion: "entrega", volver: aqui, visita: r }),
			});
		}
		return (
			<GestionRegistradaVista
				resumen={resumenVisitaRegistrada(r)}
				onSiguienteCaso={onSiguienteCaso}
				onVolverInicio={irInicio}
			>
				{siguientes.length > 0 ? (
					<ListaGestiones titulo="Siguiente paso" acciones={siguientes} />
				) : null}
			</GestionRegistradaVista>
		);
	}

	return (
		<section
			aria-label="Gestión"
			className={cn(
				"@container flex h-full min-h-0 min-w-0 flex-col bg-surface",
				className,
			)}
		>
			{contenido}
		</section>
	);
}

/* ── Piezas locales ─────────────────────────────────────────────────────────── */

function SinDatos({ texto }: { texto: string }) {
	return (
		<p className="wrap-break-word rounded-lg bg-muted px-4 py-3 text-fg-secondary text-sm">
			{texto}
		</p>
	);
}

/** «Contactar referencias»: la lista (su texto de ayuda va en la lista, R2-26). */
function ReferenciasGestionPaso({
	casoCobroId,
	onRegistrar,
}: {
	casoCobroId: string;
	onRegistrar: (referencia: ReferenciaCaso) => void;
}) {
	return (
		<ReferenciasGestion
			casoCobroId={casoCobroId}
			onRegistrarGestion={onRegistrar}
		/>
	);
}
