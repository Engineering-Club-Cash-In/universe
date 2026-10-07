/**
 * Workspace de cobros · capa de datos de UN caso.
 *
 * Hace las mismas queries que la Ficha 360 (`routes/cobros/$id.tsx`), con las
 * MISMAS llaves e inputs, así que abrir la ficha después del Workspace (o al
 * revés) sale de la caché. Todo lo derivado se calcula con
 * `lib/cobros/reglas-caso.ts`, la misma librería que usa la ficha: el panel de
 * contexto y el panel de gestión ven exactamente lo que vería la ficha.
 *
 * Devuelve un `CasoWorkspace` ya calculado. No tiene estado propio de la
 * pantalla (pestañas, formularios abiertos): eso es de cada panel.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import type {
	OperacionRecuperacion,
	TipoEnvioRecuperacion,
} from "server/src/lib/recuperacion-vehiculo";
import { moraDeEstado } from "@/components/cobros/asesor/fila-cartera";
import type { Bucket, Mora } from "@/components/ds/badges";
import { inicialesDe } from "@/components/ds/cards-credito";
import { authClient } from "@/lib/auth-client";
import { useBucketsCatalogo } from "@/lib/cobros/buckets-catalogo";
import type { CuotaConvenio } from "@/lib/cobros/convenio-cuotas";
import {
	type EstadoPromesaUI,
	inicioDelDiaGT,
} from "@/lib/cobros/promesa-activa";
import {
	bucketDelCaso,
	type CasoDetalle,
	type CobroDeHoy,
	type ContactoHistorialFila,
	type CuotaDisponiblePromesa,
	type CuotaHistorialFila,
	cobroDeHoy,
	cuotasDisponiblesParaPromesa,
	cuotasParaConvenio,
	type DatosLaboralesCaso,
	type DireccionesCliente,
	deudaVencidaDelCaso,
	diasMoraDelCaso,
	direccionesDelCliente,
	haySolicitudRecuperacionPendiente,
	idsPromesasParaRecalcular,
	incrementoDiarioMoraAnunciable,
	maxMesesDeConvenio,
	montoSugeridoPromesa,
	motivoBloqueoConvenio,
	motivoBloqueoEnvioRecuperacion,
	motivoBloqueoRecuperacionForzosa,
	motivoBloqueoVisitaCaso,
	operacionEnvioRecuperacion,
	type PromesaActivaCaso,
	type PropsContactoCaso,
	permisosCobros,
	promesaActivaDelCaso,
	promesasDePago,
	propsContactoDelCaso,
	type ReglasApagado,
	recuperacionPorRecibirDelCaso,
	reglasApagado,
	reglasInvestigacion,
	resumenCuotas,
	telefonosDe,
	telefonosNuevosDelCliente,
	textoReferenciasConTelefono,
} from "@/lib/cobros/reglas-caso";
import {
	leTocaAlUsuario,
	pasosPendientes,
	rechazadaReciente,
	type SiguientePaso,
} from "@/lib/inmovilizacion-siguiente-paso";
import { type client, orpc } from "@/utils/orpc";

/* ── Tipos de las queries (el cliente ORPC los infiere) ─────────────────────── */

type Respuesta<F extends (...args: never[]) => unknown> = Awaited<
	ReturnType<F>
>;

export type ReferenciasCasoDatos = Respuesta<typeof client.getReferenciasCaso>;
export type RecuperacionCaso = Respuesta<
	typeof client.getRecuperacionesVehiculoCaso
>[number];
export type VisitaCaso = Respuesta<typeof client.getVisitasCaso>[number];
export type SeguimientoFichaDatos = Respuesta<
	typeof client.getSeguimientoFicha
>;
export type ComplementosFicha = Respuesta<typeof client.getFichaComplementos>;
export type InmovilizacionesCaso = Respuesta<
	typeof client.getInmovilizacionesCaso
>;

/** Una alerta de cobros del caso (`getAlertasCaso`). */
export type AlertaCaso = {
	id: string;
	titulo: string;
	descripcion: string | null;
	cobrosTipo: string | null;
	status: string;
	createdAt: string | Date;
	repeticiones: number;
	desde: string | Date;
};

/** Alerta viva del convenio (`getAlertaConvenioDelCaso`). */
export type AlertaConvenio = {
	categoria: "vencida" | "vence_hoy" | "por_vencer" | "proxima";
	cuotas_vencidas: number;
	monto_vencido: string;
	fecha_vencimiento: string;
};

/** Una gestión del historial (`getHistorialContactos`, limit 200). */
export type GestionCaso = ContactoHistorialFila & {
	metodoContacto?: string | null;
	compromisosPago?: string | null;
	duracionLlamada?: number | null;
};

/** Una cuota del plan de pagos (`getHistorialPagos`). */
export type CuotaPlan = CuotaHistorialFila & {
	pagos?: Array<{ montoAplicado?: string | number | null }> | null;
};

/* ── El caso, listo para los paneles ────────────────────────────────────────── */

export type CasoWorkspace = {
	/** El id con el que se abrió (SIFCO o id de caso, igual que la ficha). */
	id: string;

	// ── Carga ────────────────────────────────────────────────────────────────
	/**
	 * El detalle del caso todavía no llega (primera carga), o la sesión aún no
	 * cargó: sin sesión las consultas están apagadas y `isLoading` da false.
	 */
	cargando: boolean;
	/** Falló el detalle del caso (`getDetallesCreditoCarteraBack`). */
	error: Error | null;
	/** Terminó de cargar y no hay caso con ese id. */
	noEncontrado: boolean;
	/** El bucket del motor sigue en vuelo (los bloqueos dicen «Cargando…»). */
	cargandoBucket: boolean;
	/** El historial de gestiones sigue en vuelo. */
	cargandoHistorial: boolean;
	/** Detalle crudo de cartera (lo que no esté resumido abajo). */
	detalle: CasoDetalle | null;

	// ── Identidad ────────────────────────────────────────────────────────────
	identidad: {
		/** "María José Contreras" ("Cliente sin nombre" si no viene). */
		nombre: string;
		/** "MC". */
		iniciales: string;
		/** Número de crédito SIFCO; null si el caso no tiene crédito de cartera. */
		numeroSifco: string | null;
		/** Id del caso de cobros (UUID); null = crédito sin caso todavía. */
		casoCobroId: string | null;
		/** Id numérico del crédito en cartera (Págalo lo pide). */
		carteraCreditoId: number | null;
		vehicleId: string | null;
		/** "Nissan Frontier 2021" (sin los "N/A" de un vehículo migrado). */
		vehiculo: string | null;
		placa: string | null;
		motor: string | null;
		/** Asesor de cartera que lleva el crédito. */
		asesor: string | null;
	};

	// ── Bucket y mora ────────────────────────────────────────────────────────
	bucket: {
		/** Número del motor (0–5); null fuera del funnel o sin respuesta. */
		numero: number | null;
		/** "B2". */
		prefijo: string | null;
		/** El prefijo como `Bucket` del DS (para BucketBadge), si es B0–B5. */
		badge: Bucket | null;
		/** "Gestión Activa" (catálogo dinámico). */
		etiqueta: string | null;
		/** Último bucket antes de salir del funnel (convenio). */
		previo: number | null;
		/** El bucket es B4 (recuperación del vehículo / pre jurídico). */
		enB4: boolean;
	};
	mora: {
		/** Días en mora (0 = al día). */
		dias: number;
		/** estadoMora crudo del caso (mora_30, …). */
		estado: string | null;
		/** Nivel para MoraBadge; null si no aplica. */
		nivel: Mora | null;
		/** Mora acumulada en quetzales. */
		monto: number;
		/** statusCredit EN_CONVENIO. */
		enConvenio: boolean;
		/** statusCredit EN_RECUPERACION. */
		enRecuperacion: boolean;
		/** En recuperación y ya subió a B5 (banda roja de la ficha). */
		recuperacionEnB5: boolean;
		/** «Estado del cobro»: En convenio / En mora / Al día. */
		estadoCobro: { etiqueta: string; tone: "info" | "danger" | "success" };
	};

	// ── Cuotas y saldo ───────────────────────────────────────────────────────
	cuotas: {
		pagadas: number;
		total: number;
		vencidas: number;
		/** Fecha de vencimiento de la última cuota pagada (para «Último mes pagado»). */
		ultimaPagadaVence: string | null;
		/** Próxima cuota sin pagar que no ha vencido. */
		proxima: { numeroCuota: number; fechaVencimiento: string | null } | null;
		/** Día de pago del mes (15 si no viene). */
		diaPago: number;
		cuotaMensual: number;
		/** Cuota del convenio, si hay convenio. */
		cuotaConvenio: number | null;
		/** Cuotas restantes según cartera. */
		restantes: number | null;
		/** Plan completo (sin ordenar), tal como lo da `getHistorialPagos`. */
		plan: CuotaPlan[];
		cargandoPlan: boolean;
	};
	/** Lo que hay que cobrar hoy (cuotas vencidas, mora, totales). */
	cobroHoy: CobroDeHoy;
	saldo: {
		/** Saldo total del crédito (null si cartera no lo dio). */
		deudaTotal: number | null;
		montoFinanciado: number | null;
		/** Lo vencido real (cuotas vencidas + mora). */
		deudaVencida: number;
	};

	// ── Seguimiento ──────────────────────────────────────────────────────────
	/** Promesa vigente del caso (la que el modal de promesa EDITA). */
	promesaVigente: PromesaActivaCaso | null;
	seguimiento: {
		intentosSinContacto: number;
		/** ISO del último intento sin contacto. */
		ultimoIntentoEn: string | Date | null;
		/** ISO del próximo contacto (motor de seguimiento o el del caso). */
		proximoContactoEn: string | Date | null;
		diasSinGestion: number | null;
		contactabilidad: SeguimientoFichaDatos["contactabilidad"] | null;
		/** sin_acuerdo / promesa_vigente / promesa_incumplida / convenio_vigente. */
		estadoGestion: string | null;
		/** Acción pendiente que calcula el server (tipo + fecha). */
		accionPendiente: SeguimientoFichaDatos["accionPendiente"] | null;
	};

	// ── Contacto ─────────────────────────────────────────────────────────────
	contacto: {
		telefonosPrincipales: string[];
		telefonosAlternativos: string[];
		/** Todos los teléfonos, sin repetir (principales primero). */
		telefonos: string[];
		email: string | null;
		direccion: string | null;
		/** Trabajo de la solicitud de crédito. */
		trabajo: DatosLaboralesCaso | null;
		/** Teléfonos conseguidos por referencias que aún no son del caso. */
		telefonosNuevos: ReferenciasCasoDatos["hallazgos"];
		/** "3 referencias con teléfono". */
		textoReferencias: string | null;
	};
	/** Props que comparten todos los `ContactoModal` (incluye variables de plantilla). */
	propsContacto: PropsContactoCaso;

	// ── Gestiones: lo que se puede hacer y por qué no ────────────────────────
	promesa: {
		cuotasDisponibles: CuotaDisponiblePromesa[];
		/** Monto propuesto (sin descontar pagos de visita). */
		montoSugerido: number;
		montoMora: number;
		esConvenio: boolean;
		cuotaConvenio: number | undefined;
		/** Si viene, el modal edita esta promesa en vez de crear otra. */
		promesaActiva: PromesaActivaCaso | null;
	};
	convenio: {
		habilitado: boolean;
		/** Motivo visible de por qué no (null si se puede). */
		motivoBloqueo: string | null;
		/** Cuotas elegibles para `ConvenioModal`. */
		cuotas: CuotaConvenio[];
		cuotaMensual: number;
		montoMora: number;
		maxMeses: number;
		/** El server confirma un convenio vigente que se puede deshacer. */
		puedeDeshacer: boolean;
		/** Alerta viva del convenio (cuota vencida, por vencer…). */
		alerta: AlertaConvenio | null;
		/** Tiene cuota del convenio vencida e impaga. */
		incumplido: boolean;
	};
	visita: {
		/** Por qué no se puede programar/registrar una visita nueva (null = sí). */
		bloqueo: string | null;
		direcciones: DireccionesCliente;
		deudaVencida: number;
		incrementoDiarioMora: string | null;
		/** Pasa a `VisitaDialog` (el resultado «Convenio» lo necesita). */
		convenioBloqueo: string | null;
		/** Visitas del caso (programadas y realizadas). */
		lista: VisitaCaso[];
	};
	recuperacion: {
		/** El usuario es del equipo de cobros. */
		puede: boolean;
		bloqueoForzosa: string | null;
		bloqueoVoluntaria: string | null;
		/** Qué hace el envío hoy: trasladar o solo registrar (null = no aplica). */
		operacion: (tipo: TipoEnvioRecuperacion) => OperacionRecuperacion | null;
		enB4: boolean;
		/** Hay una solicitud esperando al supervisor. */
		solicitudPendiente: RecuperacionCaso | null;
		/** Envío vigente sin recepción confirmada (para «Registrar recuperación» en B4). */
		porRecibir: RecuperacionCaso | null;
		lista: RecuperacionCaso[];
	};
	investigacion: { permitida: boolean; motivoBloqueo: string | null };
	apagado: ReglasApagado & {
		/** null mientras carga. */
		tieneGps: boolean | null;
		estadoUnidad: "activa" | "inmovilizada" | null;
		/** Trámite de apagado/reactivación que le toca a este usuario. */
		pasoPendiente: SiguientePaso | null;
	};
	pagos: {
		/** Hay crédito de cartera: se pueden generar links de Págalo. */
		puedeGenerarLinks: boolean;
	};

	// ── Usuario ──────────────────────────────────────────────────────────────
	esSupervisor: boolean;
	/** Rol del usuario (null mientras carga). */
	rol: string | null;

	// ── Listas para las pestañas ─────────────────────────────────────────────
	/**
	 * Gestiones del historial (incluye promesas y links de pago generados), de
	 * la más reciente a la más vieja. Filtre `link_pago_generado` si solo
	 * quiere gestiones del asesor.
	 */
	gestiones: GestionCaso[];
	/** Promesas de pago del historial. */
	promesas: GestionCaso[];
	/** Estado recalculado de cada promesa (gana sobre la columna DB). */
	estadosPromesa: Record<string, EstadoPromesaUI> | undefined;
	alertas: AlertaCaso[];
	referencias: ReferenciasCasoDatos | null;
	complementos: ComplementosFicha | null;

	/** Vuelve a pedir todo lo del caso (tras registrar una gestión). */
	refrescar: () => void;
};

/* ── El hook ───────────────────────────────────────────────────────────────── */

const vacio = <T>(v: T[] | null | undefined): T[] => v ?? [];

export function useCasoWorkspace(id: string): CasoWorkspace {
	const { data: session } = authClient.useSession();
	const queryClient = useQueryClient();
	const conSesion = !!session;

	const bucketsCatalogo = useBucketsCatalogo();
	const bucketActual = useQuery({
		...orpc.getBucketActualCredito.queryOptions({ input: { creditoId: id } }),
		enabled: conSesion && !!id,
	});
	const convenioConfig = useQuery({
		...orpc.getConvenioConfig.queryOptions(),
		enabled: conSesion,
		staleTime: 5 * 60 * 1000,
	});
	const casoDetails = useQuery({
		...orpc.getDetallesCreditoCarteraBack.queryOptions({
			input: { creditoId: id },
		}),
		enabled: conSesion && !!id,
	});
	const caso = (casoDetails.data as CasoDetalle | undefined) ?? null;
	const casoCobroId = caso?.id || "";
	const conCaso = conSesion && !!casoCobroId;

	const referenciasCaso = useQuery({
		...orpc.getReferenciasCaso.queryOptions({ input: { casoCobroId } }),
		enabled: conCaso,
	});
	const datosLaborales = useQuery({
		...orpc.getDatosLaboralesCaso.queryOptions({ input: { casoCobroId } }),
		enabled: conCaso,
		staleTime: 5 * 60 * 1000,
	});
	const historialContactos = useQuery({
		...orpc.getHistorialContactos.queryOptions({
			input: { casoCobroId, limit: 200 },
		}),
		enabled: conCaso,
	});
	const promesas = useMemo(
		() => promesasDePago(historialContactos.data as GestionCaso[] | undefined),
		[historialContactos.data],
	);
	const estadoPromesasPago = useQuery({
		...orpc.getEstadoPromesasPago.queryOptions({
			input: {
				numeroSifco: caso?.numeroCreditoSifco || id || "",
				promesaIds: idsPromesasParaRecalcular(promesas),
			},
		}),
		enabled:
			conSesion && promesas.length > 0 && !!(caso?.numeroCreditoSifco || id),
	});
	const alertasCaso = useQuery({
		...orpc.getAlertasCaso.queryOptions({ input: { casoCobroId } }),
		enabled: conCaso,
	});
	const historialPagos = useQuery({
		...orpc.getHistorialPagos.queryOptions({
			input: { numeroSifco: id || "" },
		}),
		enabled: conSesion && !!id,
	});
	const alertaConvenio = useQuery({
		...orpc.getAlertaConvenioDelCaso.queryOptions({ input: { casoCobroId } }),
		enabled: conCaso,
	});
	const convenioVigente = useQuery({
		...orpc.getConvenioVigenteDelCaso.queryOptions({ input: { casoCobroId } }),
		enabled: conCaso,
	});
	const recuperacionesCaso = useQuery({
		...orpc.getRecuperacionesVehiculoCaso.queryOptions({
			input: { casoCobroId },
		}),
		enabled: conCaso,
	});
	const seguimientoFicha = useQuery({
		...orpc.getSeguimientoFicha.queryOptions({
			input: {
				casoCobroId,
				enConvenio: caso?.statusCredit === "EN_CONVENIO",
			},
		}),
		enabled: conCaso,
	});
	const complementos = useQuery({
		...orpc.getFichaComplementos.queryOptions({ input: { casoCobroId } }),
		enabled: conCaso,
		staleTime: 5 * 60 * 1000,
	});
	const visitasCaso = useQuery({
		...orpc.getVisitasCaso.queryOptions({ input: { casoCobroId } }),
		enabled: conCaso,
	});
	// Misma consulta (y opciones) que la tarjeta de inmovilización y el aviso
	// de la ficha: se comparte la caché.
	const inmovilizaciones = useQuery({
		...orpc.getInmovilizacionesCaso.queryOptions({ input: { casoCobroId } }),
		staleTime: 30_000,
		refetchOnWindowFocus: false,
		enabled: conCaso,
	});
	const userProfile = useQuery(orpc.getUserProfile.queryOptions());

	const estadosPromesa = estadoPromesasPago.data as
		| Record<string, EstadoPromesaUI>
		| undefined;
	const promesaVigente = useMemo(
		() => promesaActivaDelCaso(promesas, estadosPromesa),
		[promesas, estadosPromesa],
	);

	const refrescar = () => {
		for (const key of [
			orpc.getDetallesCreditoCarteraBack.key(),
			orpc.getBucketActualCredito.key(),
			orpc.getHistorialContactos.key(),
			orpc.getHistorialContactosPaginado.key(),
			orpc.getEstadoPromesasPago.key(),
			orpc.getSeguimientoFicha.key(),
			orpc.getHistorialPagos.key(),
			orpc.getAlertasCaso.key(),
			orpc.getAlertaConvenioDelCaso.key(),
			orpc.getConvenioVigenteDelCaso.key(),
			orpc.getRecuperacionesVehiculoCaso.key(),
			orpc.getVisitasCaso.key(),
			orpc.getReferenciasCaso.key(),
			orpc.getInmovilizacionesCaso.key(),
		]) {
			queryClient.invalidateQueries({ queryKey: key });
		}
	};

	// ── Derivados (las mismas reglas que la ficha) ─────────────────────────────
	const c: CasoDetalle = caso ?? {};
	const rol = userProfile.data?.role ?? null;
	const { puedeRecuperarVehiculo, esSupervisorCobros } = permisosCobros(rol);
	const bucket = bucketDelCaso(bucketActual.data, bucketsCatalogo.data);
	const reglasCtx = {
		puedeRecuperarVehiculo,
		casoCobroId: c.id,
		numeroCreditoSifco: c.numeroCreditoSifco,
		bucketCargando: bucketActual.isPending,
		bucketNumero: bucket.numero,
		bucketPrefijo: bucket.prefijo,
	};
	const cuotas = vacio(historialPagos.data as CuotaPlan[] | undefined);
	const plan = resumenCuotas(cuotas, c.numeroCuotas, inicioDelDiaGT());
	const diasMora = diasMoraDelCaso(c);
	const enConvenio = c.statusCredit === "EN_CONVENIO";
	const enRecuperacion = c.statusCredit === "EN_RECUPERACION";
	const convenioMotivo = motivoBloqueoConvenio({
		statusCredit: c.statusCredit,
		convenioActivo: c.convenioActivo,
		bucketCargando: bucketActual.isPending,
		bucketNumero: bucket.numero,
		bucketPrefijo: bucket.prefijo,
		catalogo: bucketsCatalogo.data,
	});
	const recuperaciones = vacio(recuperacionesCaso.data);
	const solicitudPendiente = haySolicitudRecuperacionPendiente(recuperaciones);
	const deudaVencida = deudaVencidaDelCaso(c);
	const alerta =
		(alertaConvenio.data as AlertaConvenio | null | undefined) ?? null;
	const seguimiento = seguimientoFicha.data ?? null;
	const principales = telefonosDe(c.telefonoPrincipal);
	const alternativos = telefonosDe(c.telefonoAlternativo);
	const inmov = inmovilizaciones.data ?? null;
	const pasoInmovilizacion = inmov
		? (pasosPendientes({
				solicitudAbierta: inmov.solicitudAbierta,
				pendienteLlamar: !!inmov.pendienteLlamar,
				pendienteLlamarReactivacion: !!inmov.pendienteLlamarReactivacion,
				rechazadaReciente: rechazadaReciente(
					inmov.historial,
					!!inmov.solicitudAbierta,
				),
				esSupervisor: esSupervisorCobros,
			}).find((p) => leTocaAlUsuario(p, esSupervisorCobros)) ?? null)
		: null;
	const nombre = c.clienteNombre || "Cliente sin nombre";
	// Cartera rellena con "N/A" (o "-") lo que no tiene: no se muestra.
	const sinNA = (v: string | number | null | undefined) =>
		v !== null && v !== undefined && !/^\s*(-|n\/a)?\s*$/i.test(String(v))
			? String(v)
			: null;
	// Un año suelto, sin marca ni modelo, no dice nada (mismo criterio que la
	// fila de Mi Cartera).
	const marcaModelo = [sinNA(c.vehiculoMarca), sinNA(c.vehiculoModelo)].filter(
		Boolean,
	);
	const vehiculo = marcaModelo.length
		? [...marcaModelo, sinNA(c.vehiculoYear)].filter(Boolean).join(" ")
		: null;
	const montoMora = Number(c.montoEnMora || 0);
	const cuotaMensual = Number(c.cuotaMensual || 0);

	return {
		id,
		cargando: !conSesion || casoDetails.isLoading,
		error: (casoDetails.error as Error | null) ?? null,
		noEncontrado: casoDetails.isSuccess && !casoDetails.data,
		cargandoBucket: bucketActual.isPending,
		cargandoHistorial: historialContactos.isLoading,
		detalle: caso,

		identidad: {
			nombre,
			iniciales: inicialesDe(nombre),
			numeroSifco: c.numeroCreditoSifco ?? null,
			casoCobroId: c.id ?? null,
			carteraCreditoId: c.carteraCreditoId ?? null,
			vehicleId: c.vehicleId ?? null,
			vehiculo,
			placa: sinNA(c.vehiculoPlaca),
			motor: sinNA(c.vehiculoMotor),
			asesor: c.asesor?.nombre ?? null,
		},

		bucket: {
			numero: bucket.numero,
			prefijo: bucket.prefijo,
			badge:
				bucket.prefijo && /^B[0-5]$/.test(bucket.prefijo)
					? (bucket.prefijo as Bucket)
					: null,
			etiqueta: bucket.ui?.label ?? null,
			previo: bucket.previo,
			enB4: bucket.numero === 4,
		},
		mora: {
			dias: diasMora,
			estado: c.estadoMora ?? null,
			nivel: moraDeEstado(c.estadoMora),
			monto: montoMora,
			enConvenio,
			enRecuperacion,
			recuperacionEnB5:
				enRecuperacion && bucket.numero !== null && bucket.numero >= 5,
			estadoCobro: enConvenio
				? { etiqueta: "En convenio", tone: "info" }
				: diasMora > 0
					? { etiqueta: "En mora", tone: "danger" }
					: { etiqueta: "Al día", tone: "success" },
		},

		cuotas: {
			pagadas: plan.pagadas.length,
			total: plan.total,
			vencidas: c.cuotasVencidas ?? 0,
			ultimaPagadaVence: plan.ultimaPagada?.fechaVencimiento ?? null,
			proxima: plan.proxima
				? {
						numeroCuota: Number(plan.proxima.numeroCuota),
						fechaVencimiento: plan.proxima.fechaVencimiento ?? null,
					}
				: null,
			diaPago: c.diaPagoMensual || 15,
			cuotaMensual,
			cuotaConvenio: c.cuotaConvenio != null ? Number(c.cuotaConvenio) : null,
			restantes: c.cuotasRestantes ?? null,
			plan: cuotas,
			cargandoPlan: historialPagos.isLoading,
		},
		cobroHoy: cobroDeHoy(c),
		saldo: {
			deudaTotal: c.deudaTotal != null ? Number(c.deudaTotal) : null,
			montoFinanciado:
				c.montoFinanciado != null ? Number(c.montoFinanciado) : null,
			deudaVencida,
		},

		promesaVigente,
		seguimiento: {
			intentosSinContacto: seguimiento?.intentosSinContacto ?? 0,
			ultimoIntentoEn: seguimiento?.ultimoIntentoEn ?? null,
			proximoContactoEn:
				seguimiento?.proximaLlamadaEn ?? c.proximoContacto ?? null,
			diasSinGestion: seguimiento?.diasSinGestion ?? null,
			contactabilidad: seguimiento?.contactabilidad ?? null,
			estadoGestion: seguimiento?.estadoGestion ?? null,
			accionPendiente: seguimiento?.accionPendiente ?? null,
		},

		contacto: {
			telefonosPrincipales: principales,
			telefonosAlternativos: alternativos,
			telefonos: [...new Set([...principales, ...alternativos])],
			email: c.emailContacto || null,
			direccion: c.direccionContacto?.trim() || null,
			trabajo: datosLaborales.data ?? null,
			telefonosNuevos: telefonosNuevosDelCliente(
				c,
				referenciasCaso.data?.hallazgos ?? [],
			),
			textoReferencias:
				(referenciasCaso.data?.referencias.length ?? 0) > 0
					? textoReferenciasConTelefono(referenciasCaso.data?.referencias ?? [])
					: null,
		},
		propsContacto: propsContactoDelCaso(c),

		promesa: {
			cuotasDisponibles: cuotasDisponiblesParaPromesa(cuotas, c.cuotaMensual),
			montoSugerido: montoSugeridoPromesa(c),
			montoMora,
			esConvenio: c.cuotaConvenio != null,
			cuotaConvenio:
				c.cuotaConvenio != null ? Number(c.cuotaConvenio) : undefined,
			promesaActiva: promesaVigente,
		},
		convenio: {
			habilitado: convenioMotivo === null,
			motivoBloqueo: convenioMotivo,
			cuotas: cuotasParaConvenio(cuotas, c.cuotaMensual),
			cuotaMensual,
			montoMora,
			maxMeses: maxMesesDeConvenio(convenioConfig.data),
			puedeDeshacer: !!convenioVigente.data && puedeRecuperarVehiculo,
			alerta,
			incumplido: alerta?.categoria === "vencida",
		},
		visita: {
			bloqueo: motivoBloqueoVisitaCaso(reglasCtx),
			direcciones: direccionesDelCliente(
				c.direccionContacto,
				datosLaborales.data,
			),
			deudaVencida,
			incrementoDiarioMora: incrementoDiarioMoraAnunciable(c),
			convenioBloqueo: convenioMotivo,
			lista: vacio(visitasCaso.data),
		},
		recuperacion: {
			puede: puedeRecuperarVehiculo,
			bloqueoForzosa: motivoBloqueoRecuperacionForzosa(
				reglasCtx,
				solicitudPendiente,
			),
			bloqueoVoluntaria: motivoBloqueoEnvioRecuperacion(
				"entrega_voluntaria",
				reglasCtx,
			),
			operacion: (tipo) => operacionEnvioRecuperacion(tipo, bucket.numero),
			enB4: bucket.numero === 4,
			solicitudPendiente:
				recuperaciones.find((r) => r.estadoSolicitud === "pendiente") ?? null,
			porRecibir: recuperacionPorRecibirDelCaso(recuperaciones),
			lista: recuperaciones,
		},
		investigacion: reglasInvestigacion(bucket.numero, bucket.prefijo),
		apagado: {
			...reglasApagado(inmov, bucket.numero),
			tieneGps: inmov?.tieneGps ?? null,
			estadoUnidad: inmov?.estadoUnidad ?? null,
			pasoPendiente: pasoInmovilizacion,
		},
		pagos: {
			puedeGenerarLinks: !!c.numeroCreditoSifco && !!c.carteraCreditoId,
		},

		esSupervisor: esSupervisorCobros,
		rol,

		gestiones: [
			...vacio(historialContactos.data as GestionCaso[] | undefined),
		].sort(
			(a, b) =>
				new Date(b.fechaContacto ?? 0).getTime() -
				new Date(a.fechaContacto ?? 0).getTime(),
		),
		promesas,
		estadosPromesa,
		alertas: vacio(alertasCaso.data as AlertaCaso[] | undefined),
		referencias: referenciasCaso.data ?? null,
		complementos: complementos.data ?? null,

		refrescar,
	};
}
