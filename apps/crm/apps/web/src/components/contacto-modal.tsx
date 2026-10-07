import { useForm } from "@tanstack/react-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import {
	CalendarIcon,
	ChevronDown,
	ExternalLink,
	Eye,
	Handshake,
	Info,
	Loader2,
	Mail,
	MessageCircle,
	MessageSquare,
	Pencil,
	Phone,
	RefreshCw,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { WhatsappPreview } from "@/components/cobros/whatsapp-preview";
import { SegmentedNav } from "@/components/ds/ubicaciones";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Checkbox } from "@/components/ui/checkbox";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
	CurrencyInput,
	normalizeForSubmit,
} from "@/components/ui/currency-input";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
	accionUsaCuerpoNoReply,
	crearUrlWhatsappManual,
	cuerpoParaValidarNoReply,
	interpolar,
	mensajeAnunciaExpectativaMora,
	mensajeAnunciaIncrementoMoraSinDato,
	mensajeAnunciaMontoAdeudado,
	mensajeEmailEditable,
	mensajePlantillaEditable,
	mensajeSmsEditable,
	mensajeTieneFechaLimiteImpuestoVencida,
	PLANTILLAS_MENSAJES,
	prepararTelefonoAsesorParaEnvio,
	sugerirPlantilla,
	type VariablesPlantilla,
} from "@/lib/cobros/plantillas-mensajes";
import { cn } from "@/lib/utils";
import { client, orpc } from "@/utils/orpc";

// CB-020: regla "rango o mora" — un checkbox de mora, un guard onSubmit del
// campo y otro del form la repetían con el mismo string literal cada vez
// (Codex, PR #1147). Centralizado para que un cambio de mensaje o condición
// no pueda desincronizarse entre las 3 copias.
const MENSAJE_RANGO_O_MORA_REQUERIDO =
	"Indique un rango de cuotas, marque que incluye mora, o ambos";

function faltaRangoOMora(
	cuotaInicio: number | null | undefined,
	cuotaFin: number | null | undefined,
	incluyeMora: boolean,
): boolean {
	return cuotaInicio == null && cuotaFin == null && !incluyeMora;
}

/**
 * CB-020 (Codex, PR #1147): el backend asume fechaProximoContacto guardada
 * como medianoche GT (ver gtDateStrToDate en
 * server/src/lib/guatemala-month-window.ts, T06:00:00Z = 00:00 GT) — la
 * gracia de +24h de evaluarPromesa depende de ese punto de partida exacto.
 * El Calendar de shadcn devolvía el Date crudo del navegador (medianoche en
 * la zona horaria LOCAL del asesor, no necesariamente GT); si algún asesor
 * corre con el reloj/timezone del sistema desalineado, la fecha guardada se
 * corría de día. Se normaliza aquí al mismo formato que usa el backend, sin
 * importar código de server (web no puede importar de apps/server).
 */
function fechaAMedianocheGT(date: Date): Date {
	const anio = date.getFullYear();
	const mes = String(date.getMonth() + 1).padStart(2, "0");
	const dia = String(date.getDate()).padStart(2, "0");
	return new Date(`${anio}-${mes}-${dia}T06:00:00.000Z`);
}

/** Resultado de la gestión (enum `estado_contacto` seleccionable del server). */
export type EstadoContacto =
	| "contactado"
	| "no_contesta"
	| "mensaje_enviado"
	| "numero_equivocado"
	| "promesa_pago"
	| "acuerdo_parcial"
	| "rechaza_pagar";

// CB-026: "sms" es un canal registrable desde que se agregó al enum
// metodo_contacto — es uno de los 3 que la gestión temprana B1 exige agotar.
export type MetodoContacto =
	| "llamada"
	| "whatsapp"
	| "sms"
	| "email"
	| "visita_domicilio"
	| "visita_trabajo"
	| "carta_notarial";

export interface ContactoModalProps {
	casoCobroId: string;
	clienteNombre: string;
	telefonoPrincipal: string;
	telefonoAlternativo?: string;
	emailCliente?: string;
	metodoInicial: MetodoContacto;
	children?: React.ReactNode;
	// Modo controlado opcional (cuando el padre maneja el estado open)
	open?: boolean;
	onOpenChange?: (open: boolean) => void;
	// CB-020: "promesa" = modal reducido — solo Detalles de la Conversación +
	// fecha prometida (obligatoria). Oculta método/estado/plantilla/envío:
	// esos ya quedan fijos (estadoContacto=promesa_pago) porque la promesa se
	// registra DESPUÉS de haber contactado al cliente por otro medio.
	variante?: "completo" | "promesa";
	// CB-020: cuotas ATRASADAS (no pagadas Y ya vencidas — no incluye cuotas
	// futuras aún no vencidas) para el selector de rango en variante "promesa".
	// $id.tsx filtra por fechaVencimiento < hoy antes de pasarlas — reusa la
	// data que ya carga vía getHistorialPagos, no duplica el fetch aquí.
	// CB-025: se enriquece con monto y fecha de cada cuota para la lista de
	// checkboxes (fila con monto + vencimiento) y el total en vivo. $id.tsx los
	// saca de la misma data de getHistorialPagos — no dispara query nueva.
	cuotasDisponibles?: Array<{
		numeroCuota: number;
		fechaVencimiento?: string | null;
		monto?: number;
	}>;
	// CB-025: mora + cuota del caso, en crudo (sin formatear), para sugerir
	// un monto en la variante "promesa". El caller ya lo tiene en memoria
	// (misma fórmula que montoAdeudado) — no dispara query nueva.
	montoSugerido?: number;
	// CB-025: mora del caso SOLA (sin cuotas), para la fila "Mora" del selector
	// y el total en vivo. En crudo.
	montoMora?: number;
	// Codex PR #1228: con convenio activo, el monto comprometido es el total del
	// convenio (montoSugerido), no la suma cuotas+mora — el selector no lo pisa.
	esConvenio?: boolean;
	/** Cuota mensual del convenio: se SUMA al total de cuotas seleccionadas. */
	cuotaConvenio?: number;
	// CB-029: promesa activa del caso (una sola). Si viene, el modal abre en modo
	// EDICIÓN: pre-carga estos valores y al guardar hace UPDATE de esta fila en
	// vez de crear otra. $id.tsx la detecta con el estado ya recalculado.
	promesaActiva?: {
		id: string;
		comentarios?: string | null;
		acuerdosAlcanzados?: string | null;
		cuotaInicio?: number | null;
		cuotaFin?: number | null;
		incluyeMora?: boolean | null;
		montoComprometido?: string | null;
		fechaProximoContacto?: string | Date | null;
		fechaAlerta?: string | Date | null;
		proximoPaso?: string | null;
	} | null;
	// CB-037/038: la promesa sale de una visita ("promesa" o "pago parcial +
	// promesa"). Se manda al server, que la anota en la visita.
	visitaId?: string;
	/**
	 * Lo que el cliente ya pagó en la visita ("pago parcial + promesa"). Es la
	 * ÚNICA variante con el monto editable: se propone lo que falta (lo
	 * seleccionado menos lo pagado) y el asesor lo ajusta si hace falta. Sin
	 * esto, el monto es lo seleccionado (cuotas + mora) y no se edita
	 * (pedido del PM, 2026-10-01).
	 */
	montoYaPagado?: number;
	// Variables para plantillas de mensaje
	fechaPago?: string;
	cuotaMensual?: string;
	placa?: string;
	marcaLineaModelo?: string;
	montoAdeudado?: string;
	cuotasAtraso?: number;
	estadoMora?: string;
	fechaInicio?: string | null;
	nombreAsesor?: string;
	telefonoAsesor?: string;
	/**
	 * Se llama con la gestión ya creada, antes de cerrar. La usa quien necesita
	 * enlazarla a algo más (p. ej. la llamada posterior a un apagado de unidad).
	 */
	onCreado?: (contacto: { id: string }) => void;
	expectativaMora?: string;
	expectativaMoraDiaria?: string;
	/** Cuánto crece por día el crédito que ya está en mora (ver VariablesPlantilla). */
	incrementoDiarioMora?: string;
	/** El techo mensual de ese crecimiento (ver VariablesPlantilla). */
	incrementoMaximoMensualMora?: string;
	aseguradora?: string;
	cabinaSeguro?: string;
	/**
	 * Workspace de cobros: se pinta dentro del panel de gestión, sin Dialog (el
	 * título lo pone el Workspace). Sin esto, el modal es exactamente el de
	 * siempre.
	 */
	embebido?: boolean;
	/** Solo con `embebido`: el botón «Cancelar» del pie. */
	onCancelar?: () => void;
	/** Restringe el select de Resultado (completo). Si queda 1, se oculta el select. */
	estadosPermitidos?: EstadoContacto[];
	/** Resultado con el que arranca el formulario (variante "completo"). */
	estadoInicial?: EstadoContacto;
	/**
	 * Notas compartidas: el Workspace mantiene UNA nota entre los 3 resultados.
	 * Si vienen, `comentarios` queda controlado por estas props.
	 */
	notas?: string;
	onNotasChange?: (v: string) => void;
	/**
	 * Datos de la gestión que el Workspace ya conoce: se muestran en la tarjeta
	 * resumen y viajan al server como stubs W1 (hoy no se guardan).
	 */
	direccion?: "saliente" | "entrante";
	participante?: {
		tipo: "titular" | "codeudor" | "referencia";
		nombre: string;
	};
	/** Preselecciona «Teléfono a contactar» (y en embebido oculta el select). */
	telefonoContactado?: string;
	/** Duración con la que arranca el campo de la llamada. */
	duracionInicialSegundos?: number;
	/**
	 * Solo con `embebido`: una acción extra del pie (p. ej. «Programar visita de
	 * campo»). Se dibuja a ancho completo, encima de la fila Cancelar/Guardar.
	 */
	accionExtraPie?: React.ReactNode;
}

/**
 * Opciones del select de Resultado (variante "completo"), en su orden.
 * `label` es la del modal (con emoji); `etiqueta`, la del modo embebido (sin
 * emoji, como el resto del Workspace).
 */
const OPCIONES_RESULTADO: Array<{
	value: EstadoContacto;
	label: string;
	etiqueta: string;
}> = [
	{ value: "contactado", label: "✅ Contactado", etiqueta: "Contactado" },
	{ value: "no_contesta", label: "❌ No contestó", etiqueta: "No contestó" },
	{
		value: "mensaje_enviado",
		label: "📤 Mensaje enviado (sin respuesta aún)",
		etiqueta: "Mensaje enviado (sin respuesta aún)",
	},
	{
		value: "numero_equivocado",
		label: "📱 Número equivocado",
		etiqueta: "Número equivocado",
	},
	{
		value: "acuerdo_parcial",
		label: "📝 Acuerdo parcial",
		etiqueta: "Acuerdo parcial",
	},
	{
		value: "rechaza_pagar",
		label: "🚫 Rechaza pagar",
		etiqueta: "Rechaza pagar",
	},
];

/** Nombre del canal sin emoji, para la tarjeta resumen del modo embebido. */
const NOMBRE_CANAL: Record<MetodoContacto, string> = {
	llamada: "Llamada",
	whatsapp: "WhatsApp",
	sms: "SMS",
	email: "Correo",
	visita_domicilio: "Visita a domicilio",
	visita_trabajo: "Visita al trabajo",
	carta_notarial: "Carta notarial",
};

const ROL_PARTICIPANTE: Record<"titular" | "codeudor" | "referencia", string> =
	{
		titular: "Titular",
		codeudor: "Codeudor",
		referencia: "Referencia",
	};

/** 84 → "01:24". */
function formatearDuracion(segundos: number | undefined): string {
	if (segundos == null || !Number.isFinite(segundos) || segundos < 0) return "";
	const m = Math.floor(segundos / 60);
	const s = Math.floor(segundos % 60);
	return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/**
 * "01:24" o "84" → 84. Vacío o inválido → undefined (el campo es opcional en
 * el server; un valor ilegible se avisa en pantalla y no se manda).
 */
function parsearDuracion(texto: string): number | undefined {
	const t = texto.trim();
	if (!t) return undefined;
	const mmss = /^(\d{1,3}):([0-5]?\d)$/.exec(t);
	if (mmss) return Number(mmss[1]) * 60 + Number(mmss[2]);
	if (/^\d+$/.test(t)) return Number(t);
	return undefined;
}

const HORA_VALIDA = /^\d{2}:\d{2}$/;

const MENSAJE_DURACION_ILEGIBLE =
	"Escriba la duración como minutos:segundos, por ejemplo 2:30.";

export function ContactoModal({
	casoCobroId,
	clienteNombre,
	telefonoPrincipal,
	telefonoAlternativo,
	emailCliente,
	metodoInicial,
	children,
	open,
	onOpenChange,
	variante = "completo",
	cuotasDisponibles = [],
	montoSugerido,
	montoMora = 0,
	esConvenio = false,
	cuotaConvenio,
	promesaActiva = null,
	visitaId,
	montoYaPagado,
	fechaPago = "",
	cuotaMensual = "",
	placa = "",
	marcaLineaModelo = "",
	montoAdeudado = "",
	cuotasAtraso = 0,
	estadoMora,
	fechaInicio,
	nombreAsesor = "",
	telefonoAsesor = "",
	onCreado,
	expectativaMora = "",
	expectativaMoraDiaria = "",
	incrementoDiarioMora = "",
	incrementoMaximoMensualMora = "",
	aseguradora = "",
	cabinaSeguro = "",
	embebido = false,
	onCancelar,
	estadosPermitidos,
	estadoInicial,
	notas,
	onNotasChange,
	direccion,
	participante,
	telefonoContactado,
	duracionInicialSegundos,
	accionExtraPie,
}: ContactoModalProps) {
	const queryClient = useQueryClient();

	const telefonos = useMemo(() => {
		const lista: string[] = [];
		// telefonoPrincipal puede traer varios números separados por coma
		if (telefonoPrincipal) {
			for (const t of telefonoPrincipal.split(",")) {
				const limpio = t.trim();
				if (limpio) lista.push(limpio);
			}
		}
		if (telefonoAlternativo) {
			for (const t of telefonoAlternativo.split(",")) {
				const limpio = t.trim();
				if (limpio && !lista.includes(limpio)) lista.push(limpio);
			}
		}
		return lista;
	}, [telefonoPrincipal, telefonoAlternativo]);

	const [internalOpen, setInternalOpen] = useState(false);
	const isControlled = open !== undefined;
	// Embebido = siempre abierto: el Workspace monta/desmonta (con `key`).
	const isOpen = embebido || (isControlled ? open : internalOpen);

	const handleOpenChange = (newOpen: boolean) => {
		if (!isControlled) {
			setInternalOpen(newOpen);
		}
		onOpenChange?.(newOpen);
	};

	const [telefonoSeleccionado, setTelefonoSeleccionado] = useState(
		() => telefonoContactado || telefonos[0] || telefonoPrincipal,
	);

	const [plantillaId, setPlantillaId] = useState<string>("");
	const [mensajeEditado, setMensajeEditado] = useState("");
	const [mensajeWhatsappEditado, setMensajeWhatsappEditado] = useState("");
	const [asuntoEditado, setAsuntoEditado] = useState("");
	// El WhatsApp arranca en vista previa (sin asteriscos a la vista);
	// "Editar mensaje" abre el textarea.
	const [editandoWhatsapp, setEditandoWhatsapp] = useState(false);

	const telefonoAsesorLimpio = telefonoAsesor.trim();

	const variables: VariablesPlantilla = useMemo(
		() => ({
			clienteNombre,
			fechaPago,
			cuotaMensual,
			placa,
			marcaLineaModelo,
			montoAdeudado,
			cuotasAtraso,
			telefonoAsesor: telefonoAsesorLimpio,
			nombreAsesor,
			expectativaMora,
			expectativaMoraDiaria,
			incrementoDiarioMora,
			incrementoMaximoMensualMora,
			// Vacíos caen al default de interpolar (Seguros Universales); con
			// datos, el modal muestra de una vez la variante correcta (p. ej. G&T).
			aseguradora: aseguradora || undefined,
			cabinaSeguro: cabinaSeguro || undefined,
		}),
		[
			clienteNombre,
			fechaPago,
			cuotaMensual,
			placa,
			marcaLineaModelo,
			montoAdeudado,
			cuotasAtraso,
			telefonoAsesorLimpio,
			nombreAsesor,
			expectativaMora,
			expectativaMoraDiaria,
			incrementoDiarioMora,
			incrementoMaximoMensualMora,
			aseguradora,
			cabinaSeguro,
		],
	);

	// Pre-seleccionar plantilla sugerida al abrir
	useEffect(() => {
		const sugerida = sugerirPlantilla(estadoMora, fechaInicio);
		setPlantillaId(sugerida);
		setEditandoWhatsapp(false);
		const plantilla = PLANTILLAS_MENSAJES.find((p) => p.id === sugerida);
		if (plantilla) {
			setMensajeEditado(interpolar(plantilla.cuerpo, variables));
			setMensajeWhatsappEditado(
				interpolar(plantilla.cuerpoWhastapp || plantilla.cuerpo, variables),
			);
			setAsuntoEditado(interpolar(plantilla.asunto, variables));
		}
	}, [estadoMora, fechaInicio, variables]);

	const handlePlantillaChange = (id: string) => {
		setPlantillaId(id);
		setEditandoWhatsapp(false);
		const plantilla = PLANTILLAS_MENSAJES.find((p) => p.id === id);
		if (plantilla) {
			setMensajeEditado(interpolar(plantilla.cuerpo, variables));
			setMensajeWhatsappEditado(
				interpolar(plantilla.cuerpoWhastapp || plantilla.cuerpo, variables),
			);
			setAsuntoEditado(interpolar(plantilla.asunto, variables));
		}
	};

	const esPromesa = variante === "promesa";
	// CB-029: modo edición de la promesa activa (una sola por caso).
	const esEdicion = esPromesa && promesaActiva != null;

	// Embebido: los mensajes salientes se pintan como «Redactar mensaje»
	// (plantilla + envío); el resto (llamada, WhatsApp entrante, visitas…) como
	// «Registrar gestión» con la tarjeta resumen.
	const esMensajeSaliente =
		(metodoInicial === "whatsapp" ||
			metodoInicial === "sms" ||
			metodoInicial === "email") &&
		direccion !== "entrante";
	const layoutRegistro = !esPromesa && !esMensajeSaliente;

	// Workspace: opciones del select de Resultado. Sin `estadosPermitidos`
	// quedan todas (el modal de siempre).
	const opcionesResultado = estadosPermitidos
		? OPCIONES_RESULTADO.filter((o) => estadosPermitidos.includes(o.value))
		: OPCIONES_RESULTADO;
	const estadoPermitido = (estado: EstadoContacto) =>
		!estadosPermitidos?.length || estadosPermitidos.includes(estado);
	// `estadoInicial` solo cuenta si `estadosPermitidos` lo admite; si no, se
	// ignora y manda el default.
	const estadoInicialValido =
		estadoInicial && estadoPermitido(estadoInicial) ? estadoInicial : undefined;
	// Default: un mensaje saliente embebido arranca en "mensaje_enviado" (un
	// envío no prueba que el cliente respondiera, y «Registrar sin enviar» con
	// el colapsable cerrado no debe contar como contacto efectivo); el resto,
	// "contactado". Si el default no está permitido (p. ej. «No hubo
	// contacto»), el primero permitido.
	const estadoPorDefecto: EstadoContacto = esMensajeSaliente
		? "mensaje_enviado"
		: "contactado";
	const estadoArranque: EstadoContacto =
		estadoInicialValido ??
		(estadoPermitido(estadoPorDefecto)
			? estadoPorDefecto
			: (estadosPermitidos?.[0] ?? estadoPorDefecto));
	// «No hubo contacto»: solo se permiten resultados sin contacto, y el
	// bloque de recontacto se titula «Programar próximo intento».
	const soloSinContacto =
		!!estadosPermitidos?.length &&
		estadosPermitidos.every(
			(e) => e === "no_contesta" || e === "numero_equivocado",
		);
	// Notas controladas por el Workspace (una sola nota entre los 3 resultados).
	const notasControladas = notas !== undefined;
	// Promesa en edición con la nota compartida: el campo arranca con los
	// comentarios GUARDADOS de la promesa y no se enlaza con la nota del
	// Workspace hasta que el asesor lo edita. Así la promesa vieja no se filtra
	// a la nota compartida (ni a otro resultado) y la nota de otro resultado no
	// pisa los comentarios guardados.
	const asesorEditoNotas = useRef(false);
	const notasEnlazadas = () => !esEdicion || asesorEditoNotas.current;
	// «¿El cliente solicitó que se le contacte nuevamente?» (solo layoutRegistro).
	// Sí = la fecha de próximo contacto de siempre + hora y medio (stubs W1).
	const [contactarDeNuevo, setContactarDeNuevo] = useState(false);
	const [horaProximoContacto, setHoraProximoContacto] = useState("");
	const [medioProximoContacto, setMedioProximoContacto] = useState<
		"llamada" | "whatsapp"
	>("llamada");
	// Texto del campo de duración embebido ("mm:ss" o segundos).
	const [duracionTexto, setDuracionTexto] = useState(() =>
		formatearDuracion(duracionInicialSegundos),
	);
	// El campo de duración solo existe en la llamada embebida.
	const duracionIlegible =
		layoutRegistro &&
		metodoInicial === "llamada" &&
		duracionTexto.trim() !== "" &&
		parsearDuracion(duracionTexto) == null;
	const aFecha = (v: string | Date | null | undefined) =>
		v ? new Date(v) : undefined;
	// D-1 respecto a la fecha prometida (ambas son medianoche GT = T06:00:00Z, así
	// que restar 24h da la medianoche GT del día anterior). Default de la alerta.
	const restarUnDiaGT = (fecha: Date) =>
		new Date(fecha.getTime() - 24 * 60 * 60 * 1000);

	// CB-025 (simplificación de la promesa): cuotas atrasadas ordenadas — base
	// del selector de pills y de los defaults "todo lo atrasado". Se memoiza
	// sobre una FIRMA estable (join de los números), no sobre `cuotasDisponibles`
	// directo: el padre lo pasa como un .map() nuevo en cada render, así que
	// depender del array pisaría la selección del asesor en cada re-render.
	const firmaCuotasAtrasadas = cuotasDisponibles
		.map((c) => c.numeroCuota)
		.join(",");
	const numerosAtrasados = useMemo(
		() =>
			firmaCuotasAtrasadas === ""
				? []
				: firmaCuotasAtrasadas
						.split(",")
						.map(Number)
						.sort((a, b) => a - b),
		[firmaCuotasAtrasadas],
	);

	// CB-025: mismas cuotas pero con monto + fecha, para la LISTA de checkboxes.
	// Firma rica (numero|monto|fecha) reconstruida dentro del memo → estable
	// aunque el padre pase un .map() nuevo cada render (mismo patrón que arriba).
	const firmaCuotasDetalle = cuotasDisponibles
		.map((c) => `${c.numeroCuota}|${c.monto ?? 0}|${c.fechaVencimiento ?? ""}`)
		.join(";");
	const cuotasOrdenadas = useMemo(
		() =>
			firmaCuotasDetalle === ""
				? []
				: firmaCuotasDetalle
						.split(";")
						.map((s) => {
							const [n, m, f] = s.split("|");
							return {
								numeroCuota: Number(n),
								monto: Number(m),
								fechaVencimiento: f || null,
							};
						})
						.sort((a, b) => a.numeroCuota - b.numeroCuota),
		[firmaCuotasDetalle],
	);
	const montoPorCuota = useMemo(() => {
		const mapa = new Map<number, number>();
		for (const c of cuotasOrdenadas) mapa.set(c.numeroCuota, c.monto);
		return mapa;
	}, [cuotasOrdenadas]);

	const form = useForm({
		defaultValues: {
			metodoContacto: metodoInicial,
			// CB-020: variante promesa fija el estado — no pasa por el selector.
			estadoContacto: (esPromesa
				? "promesa_pago"
				: estadoArranque) as EstadoContacto,
			// En edición, SIEMPRE los comentarios guardados de la promesa (ver
			// `notasEnlazadas`); si no, con notas controladas (Workspace) manda la
			// nota compartida.
			comentarios: esEdicion
				? (promesaActiva?.comentarios ?? "")
				: notasControladas
					? (notas ?? "")
					: "",
			acuerdosAlcanzados: esEdicion
				? (promesaActiva?.acuerdosAlcanzados ?? "")
				: "",
			compromisosPago: "",
			// La fecha prometida ES la fecha de próximo contacto — nunca opcional
			// en la variante promesa (por eso arranca en true).
			requiereSeguimiento: esPromesa,
			fechaProximoContacto: (esEdicion
				? aFecha(promesaActiva?.fechaProximoContacto)
				: undefined) as Date | undefined,
			// CB-029: "alerta programada". Edición: la guardada. Nueva: se pone D-1
			// al elegir la fecha prometida (ver onSelect del calendario más abajo).
			fechaAlerta: (esEdicion
				? aFecha(promesaActiva?.fechaAlerta)
				: undefined) as Date | undefined,
			duracionLlamada: duracionInicialSegundos as number | undefined,
			// CB-020: rango de cuotas + mora — solo relevantes en variante promesa.
			// CB-025 (simplificación): la promesa arranca cubriendo TODO lo
			// atrasado + mora ("va a pagar lo que debe", el caso común). El asesor
			// solo destilda lo que no aplique. En "completo" siguen vacíos. En
			// edición: el rango guardado de la promesa activa.
			cuotaInicio: (esEdicion
				? (promesaActiva?.cuotaInicio ?? undefined)
				: esPromesa
					? numerosAtrasados[0]
					: undefined) as number | undefined,
			cuotaFin: (esEdicion
				? (promesaActiva?.cuotaFin ?? undefined)
				: esPromesa
					? numerosAtrasados[numerosAtrasados.length - 1]
					: undefined) as number | undefined,
			// Con convenio la mora ya va absorbida en la cuota del convenio.
			incluyeMora: esEdicion
				? !!promesaActiva?.incluyeMora
				: esPromesa && !esConvenio,
			// CB-025: monto que el cliente prometió pagar — informativo.
			// En promesa se llena con lo que debe (cuotas + mora) y sigue a la
			// selección; solo es editable si viene de un pago parcial en una
			// visita (`montoYaPagado`). En edición: el monto guardado.
			montoComprometido: esEdicion
				? (promesaActiva?.montoComprometido ?? "")
				: esPromesa && montoSugerido != null && montoSugerido > 0
					? montoSugerido.toFixed(2)
					: "",
			// CB-025: qué hacer en el próximo contacto — texto libre, opcional.
			proximoPaso: esEdicion ? (promesaActiva?.proximoPaso ?? "") : "",
		},
		onSubmit: async ({ value }) => {
			// NO ELIMINAR sin también quitar el botón submit de canSubmit
			// (Codex, PR #1147): este guard es la defensa REAL — los
			// validators onSubmit de los campos (fechaProximoContacto,
			// incluyeMora, más abajo en el JSX) alimentan `canSubmit`, pero
			// TanStack Form corre validators onSubmit DESPUÉS de invocar este
			// handler, no antes — si algún día se asume que `canSubmit` ya
			// garantiza esto y se borra este guard pensando que es
			// redundante, reaparece el bug original: campo nunca tocado =
			// onChange nunca corrió = se guarda sin fecha/rango/mora.
			if (esPromesa && !value.fechaProximoContacto) {
				toast.error("La fecha prometida es obligatoria");
				return;
			}
			if (
				esPromesa &&
				faltaRangoOMora(value.cuotaInicio, value.cuotaFin, value.incluyeMora)
			) {
				toast.error(MENSAJE_RANGO_O_MORA_REQUERIDO);
				return;
			}
			// Workspace: con «Sí» en «¿El cliente solicitó que se le contacte
			// nuevamente?» la fecha deja de ser opcional.
			if (layoutRegistro && contactarDeNuevo && !value.fechaProximoContacto) {
				toast.error("Seleccione la fecha en la que se contactará al cliente.");
				return;
			}
			// Workspace: una duración ilegible («1:75») no se descarta en
			// silencio; bloquea el guardado hasta que el asesor la corrija.
			if (duracionIlegible) {
				toast.error(MENSAJE_DURACION_ILEGIBLE);
				return;
			}
			createContactoMutation.mutate(value);
		},
	});

	const createContactoMutation = useMutation({
		mutationFn: (data: any) =>
			client.createContactoCobros({
				casoCobroId,
				...data,
				// CB-029: en edición, UPDATE de la promesa activa (no crea otra).
				promesaContactoId: promesaActiva?.id,
				visitaId,
				// Enter dispara submit sin pasar por el onBlur del CurrencyInput
				// (que es donde normalmente se limpia un punto colgante como
				// "2500.") — se normaliza también acá, justo antes de armar el
				// payload, para no depender de que el campo haya perdido foco
				// (Codex, PR #1191, ronda 3).
				montoComprometido:
					normalizeForSubmit(data.montoComprometido) || undefined,
				proximoPaso: data.proximoPaso || undefined,
				// Stubs W1 del Workspace: el server los acepta y hoy los ignora
				// (TODO José · tarea W1). `direccion` y `participante` solo viajan
				// si el Workspace los dio; `telefonoContactado` viaja con el que dio
				// el Workspace o, en embebido por teléfono (llamada, WhatsApp, SMS),
				// con el que el asesor tenga seleccionado.
				direccion,
				participante,
				telefonoContactado:
					telefonoContactado ||
					(embebido &&
					(metodoInicial === "llamada" ||
						metodoInicial === "whatsapp" ||
						metodoInicial === "sms")
						? telefonoSeleccionado || undefined
						: undefined),
				...(layoutRegistro &&
				contactarDeNuevo &&
				data.fechaProximoContacto &&
				HORA_VALIDA.test(horaProximoContacto)
					? { horaProximoContacto }
					: {}),
				...(layoutRegistro && contactarDeNuevo && data.fechaProximoContacto
					? { medioProximoContacto }
					: {}),
			}),
		onSuccess: (contacto) => {
			toast.success(
				esEdicion
					? "Promesa actualizada correctamente"
					: "Contacto registrado correctamente",
			);
			queryClient.invalidateQueries(
				orpc.getHistorialContactos.queryOptions({ input: { casoCobroId } }),
			);
			// La lista que PINTA la ficha es la paginada: sin esto, el contacto
			// recién registrado no aparece hasta un refresh.
			queryClient.invalidateQueries(
				orpc.getHistorialContactosPaginado.queryOptions({
					input: { casoCobroId },
				}),
			);
			queryClient.invalidateQueries({
				predicate: (query) =>
					query.queryKey.some(
						(k) =>
							typeof k === "string" &&
							k.includes("getDetallesCreditoCarteraBack"),
					),
			});
			if (visitaId) {
				queryClient.invalidateQueries({ queryKey: orpc.getVisitasCaso.key() });
			}
			// CB-035: una llamada cierra la tarea B3 del caso en el servidor.
			queryClient.invalidateQueries(orpc.getMisTareasCobros.queryOptions());
			onCreado?.(contacto);
			form.reset();
			// Embebido no cierra nada: el Workspace pasa a «Gestión registrada»
			// con el `onCreado`.
			if (!embebido) handleOpenChange(false);
		},
		onError: (error: any) => {
			toast.error(error.message || "Error al registrar el contacto");
		},
	});

	/**
	 * Escribe `comentarios` y, con notas controladas, avisa al Workspace (la
	 * nota es una sola entre los 3 resultados).
	 */
	const cambiarComentarios = (valor: string) => {
		form.setFieldValue("comentarios", valor);
		if (notasEnlazadas()) onNotasChange?.(valor);
	};

	// Notas controladas: lo que el Workspace cambie afuera (otro resultado, su
	// propio editor) se refleja en el campo. En una promesa en edición, solo
	// después de que el asesor editó el campo (ver `notasEnlazadas`).
	// biome-ignore lint/correctness/useExhaustiveDependencies: `form` es estable; solo importa el valor de la nota.
	useEffect(() => {
		if (notas === undefined || !notasEnlazadas()) return;
		if (form.getFieldValue("comentarios") !== notas) {
			form.setFieldValue("comentarios", notas);
		}
	}, [notas]);

	// CB-025 (simplificación): selección de cuotas de la promesa como Set (una
	// pill por cuota). El backend guarda un RANGO contiguo (cuotaInicio..cuotaFin)
	// y evaluarPromesa verifica todo ese rango — no se toca ese modelo: la pill
	// solo maneja qué está seleccionado y se sincroniza a min..max del form.
	const [cuotasPromesa, setCuotasPromesa] = useState<Set<number>>(
		() => new Set(numerosAtrasados),
	);

	// CB-025: total en vivo = Σ montos de las cuotas seleccionadas + mora (si
	// aplica). Alimenta el pre-llenado editable de "Monto comprometido".
	const totalDeSeleccion = (seleccion: Set<number>, incluyeMora: boolean) => {
		let total = 0;
		for (const n of seleccion) total += montoPorCuota.get(n) ?? 0;
		if (incluyeMora) total += montoMora;
		return total;
	};

	/**
	 * Monto que se propone comprometer: lo seleccionado (cuotas + mora) MÁS la
	 * cuota del convenio, que es un cargo aparte del plan de regularización.
	 * Antes, con convenio el monto quedaba congelado en `montoSugerido`
	 * (= convenio + 1 cuota) y no se movía aunque el asesor marcara 3 cuotas
	 * (Codex PR #1228 lo congeló para que el selector no lo pisara; el efecto
	 * secundario era que la selección dejaba de reflejarse).
	 */
	const totalPromesaDe = (seleccion: Set<number>, incluyeMora: boolean) =>
		esConvenio
			? // Con convenio la cuota del convenio REEMPLAZA la mora (mismo criterio
				// que el card "Total a Cobrar" de la ficha, PR #1191): sumar ambas
				// inflaba el monto comprometido (Codex).
				totalDeSeleccion(seleccion, false) + (cuotaConvenio ?? 0)
			: totalDeSeleccion(seleccion, incluyeMora);

	// Pago parcial en una visita: la promesa es por lo que falta. Antes este
	// valor se calculaba en la ficha (`montoSugerido`), pero el re-sembrado al
	// abrir lo pisaba con el total completo.
	const yaPagado =
		montoYaPagado != null && montoYaPagado > 0 ? montoYaPagado : 0;
	const montoEditable = yaPagado > 0;
	const montoPromesaDe = (seleccion: Set<number>, incluyeMora: boolean) =>
		Math.max(0, totalPromesaDe(seleccion, incluyeMora) - yaPagado);

	// Al (re)abrir la promesa, re-sembrar la selección con todo lo atrasado y
	// sincronizar el rango + el monto del form (por si cambiaron las cuotas).
	// biome-ignore lint/correctness/useExhaustiveDependencies: `form`/montoPorCuota/montoMora son estables o derivan de las mismas cuotas; incluirlos re-sembraría en cada render y borraría la selección del asesor.
	useEffect(() => {
		if (!isOpen || !esPromesa) return;
		// CB-029: en EDICIÓN, re-sembrar TODOS los campos desde la promesa activa
		// (no "todo lo atrasado"). Se hace acá y no solo en defaultValues porque el
		// modal queda montado: si se reabre tras crear/editar, promesaActiva cambió
		// pero defaultValues quedó en el valor de montaje — el effect corrige.
		if (esEdicion) {
			const ini = promesaActiva?.cuotaInicio ?? null;
			const fin = promesaActiva?.cuotaFin ?? null;
			setCuotasPromesa(
				ini != null && fin != null
					? new Set(numerosAtrasados.filter((n) => n >= ini && n <= fin))
					: new Set<number>(),
			);
			form.setFieldValue("cuotaInicio", ini ?? undefined);
			form.setFieldValue("cuotaFin", fin ?? undefined);
			form.setFieldValue("incluyeMora", !!promesaActiva?.incluyeMora);
			// Siempre los comentarios guardados, sin avisar a la nota compartida
			// (la promesa vieja no se filtra a otro resultado). Si el asesor ya
			// editó el campo en el Workspace, se respeta lo que escribió.
			if (!notasControladas || !asesorEditoNotas.current) {
				form.setFieldValue("comentarios", promesaActiva?.comentarios ?? "");
			}
			form.setFieldValue(
				"acuerdosAlcanzados",
				promesaActiva?.acuerdosAlcanzados ?? "",
			);
			form.setFieldValue(
				"montoComprometido",
				promesaActiva?.montoComprometido ?? "",
			);
			form.setFieldValue(
				"fechaProximoContacto",
				aFecha(promesaActiva?.fechaProximoContacto),
			);
			form.setFieldValue("fechaAlerta", aFecha(promesaActiva?.fechaAlerta));
			form.setFieldValue("proximoPaso", promesaActiva?.proximoPaso ?? "");
			return;
		}
		const todas = new Set(numerosAtrasados);
		setCuotasPromesa(todas);
		form.setFieldValue("cuotaInicio", numerosAtrasados[0]);
		form.setFieldValue(
			"cuotaFin",
			numerosAtrasados[numerosAtrasados.length - 1],
		);
		// Con convenio la mora no entra (la absorbe la cuota del convenio).
		form.setFieldValue("incluyeMora", !esConvenio);
		form.setFieldValue(
			"montoComprometido",
			montoPromesaDe(todas, !esConvenio).toFixed(2),
		);
		// promesaActiva?.id (no el objeto, que cambia de identidad cada render):
		// re-siembra cuando la promesa activa CARGA tarde o un refetch la cambia con
		// el modal abierto — sin esto el form quedaba con defaults de promesa nueva
		// y al guardar sobrescribía la activa con datos viejos (Codex PR #1232).
	}, [isOpen, esPromesa, numerosAtrasados, promesaActiva?.id]);

	// La selección se mantiene como un RUN CONTIGUO de la lista de atrasadas
	// (Codex PR #1228): sin esto, destildar una cuota del medio dejaba un hueco
	// pero el rango guardado seguía siendo [min,max] e incluía la excluida → el
	// server la evaluaba igual. Acá seleccionar rellena huecos y destildar
	// recorta desde un extremo, así el rango nunca contiene una cuota sin marcar.
	const alternarCuotaPromesa = (numero: number) => {
		const orden = numerosAtrasados;
		const idx = orden.indexOf(numero);
		if (idx === -1) return;
		const marcados = orden
			.map((n, k) => (cuotasPromesa.has(n) ? k : -1))
			.filter((k) => k >= 0);
		let i = marcados.length ? marcados[0] : -1;
		let j = marcados.length ? marcados[marcados.length - 1] : -1;
		if (cuotasPromesa.has(numero)) {
			// Destildar: recorta desde la más vieja si es el borde inferior; si es
			// el borde superior o una intermedia, conserva [i..idx-1].
			if (idx === i) i = idx + 1;
			else j = idx - 1;
		} else if (i === -1) {
			i = idx;
			j = idx;
		} else {
			// Marcar: extiende el run para incluir idx (rellena cualquier hueco).
			i = Math.min(i, idx);
			j = Math.max(j, idx);
		}
		const siguiente =
			i < 0 || i > j ? new Set<number>() : new Set(orden.slice(i, j + 1));
		setCuotasPromesa(siguiente);
		const nums = [...siguiente].sort((a, b) => a - b);
		form.setFieldValue("cuotaInicio", nums.length ? nums[0] : undefined);
		form.setFieldValue(
			"cuotaFin",
			nums.length ? nums[nums.length - 1] : undefined,
		);
		// El monto sigue a la selección.
		form.setFieldValue(
			"montoComprometido",
			montoPromesaDe(siguiente, !!form.getFieldValue("incluyeMora")).toFixed(2),
		);
	};

	const getIconoMetodo = (metodo: string) => {
		switch (metodo) {
			case "llamada":
				return <Phone className="h-4 w-4" />;
			case "whatsapp":
				return <MessageCircle className="h-4 w-4" />;
			case "sms":
				return <MessageSquare className="h-4 w-4" />;
			case "email":
				return <Mail className="h-4 w-4" />;
			default:
				return <Phone className="h-4 w-4" />;
		}
	};

	type AccionContacto =
		| "llamada"
		| "whatsapp-link"
		| "whatsapp-api"
		| "email-link"
		| "email-api"
		| "sms-api";

	/**
	 * Tras un envío AUTOMÁTICO (WhatsApp/Email/SMS) el contacto se registra solo:
	 * antes el asesor enviaba y además tenía que darle "Registrar Contacto", y si
	 * cerraba la modal el envío quedaba sin rastro en el historial.
	 * Comentarios es obligatorio, así que si viene vacío se rellena con lo que
	 * realmente pasó (canal + plantilla usada).
	 */
	const registrarTrasEnvio = (canal: string) => {
		// Un envío saliente NO prueba que el cliente respondiera. Si el asesor no
		// tocó el Resultado, se guarda como "mensaje_enviado": `contactado`
		// contaría como respuesta en evaluarGestionTempranaB1 y un WhatsApp de
		// una vía habría dado por respondida la gestión B1 (Codex) — y
		// "no_contesta" también mentía: nadie dejó de contestar una llamada,
		// solo se mandó un mensaje. Si el asesor SÍ eligió un resultado (habló
		// por WhatsApp y le contestaron), se respeta su elección.
		// (Workspace) Un `estadoInicial` explícito (y permitido) cuenta como
		// elección, y no se fuerza un resultado que `estadosPermitidos` no admita.
		if (
			!form.getFieldMeta("estadoContacto")?.isTouched &&
			!estadoInicialValido &&
			(!estadosPermitidos || estadosPermitidos.includes("mensaje_enviado"))
		) {
			form.setFieldValue("estadoContacto", "mensaje_enviado");
		}
		const actuales = String(form.getFieldValue("comentarios") ?? "").trim();
		if (!actuales) {
			const plantilla = PLANTILLAS_MENSAJES.find((p) => p.id === plantillaId);
			cambiarComentarios(
				plantilla
					? `${canal} enviado al cliente (plantilla: ${plantilla.nombre}).`
					: `${canal} enviado al cliente.`,
			);
		}
		void form.handleSubmit();
	};

	const whatsappApiMutation = useMutation({
		mutationFn: (vars: { telefono: string; mensaje: string }) =>
			client.enviarWhatsappCobros({
				...vars,
				casoCobroId,
				plantillaId: plantillaId || undefined,
			}),
		onSuccess: (res) => {
			if (!res.success) return;
			toast.success("WhatsApp enviado — registrando el contacto...");
			registrarTrasEnvio("WhatsApp");
		},
		onError: (error: any) =>
			toast.error(error?.message || "Error al enviar el WhatsApp"),
	});

	const emailApiMutation = useMutation({
		mutationFn: (vars: {
			destinatario: string;
			asunto: string;
			mensaje: string;
		}) =>
			client.enviarEmailCobros({
				...vars,
				casoCobroId,
				plantillaId: plantillaId || undefined,
			}),
		onSuccess: (res) => {
			if (!res.success) return;
			toast.success("Email enviado — registrando el contacto...");
			registrarTrasEnvio("Email");
		},
		onError: (error: any) =>
			toast.error(error?.message || "Error al enviar el correo"),
	});

	const smsApiMutation = useMutation({
		mutationFn: (vars: { telefono: string; mensaje: string }) =>
			client.enviarSmsCobros({
				...vars,
				casoCobroId,
				plantillaId: plantillaId || undefined,
			}),
		onSuccess: (res) => {
			if (!res.success) return;
			toast.success("SMS enviado — registrando el contacto...");
			registrarTrasEnvio("SMS");
		},
		onError: (error: any) =>
			toast.error(error?.message || "Error al enviar el SMS"),
	});

	// Incluye el registro automático: si solo mirara los envíos, el botón se
	// re-habilitaba apenas respondía la API y el asesor podía volver a enviar
	// (mensaje duplicado al cliente + contacto duplicado) antes de que cerrara
	// la modal (Codex).
	const envioEnCurso =
		whatsappApiMutation.isPending ||
		emailApiMutation.isPending ||
		smsApiMutation.isPending ||
		createContactoMutation.isPending;

	const ejecutarAccion = (metodo: AccionContacto) => {
		const tel = telefonoSeleccionado || telefonoPrincipal;
		const telLimpio = tel.replace(/[^0-9]/g, "");
		const mensajeWhatsapp = mensajePlantillaEditable(
			"whatsapp",
			mensajeEditado,
			mensajeWhatsappEditado,
		);
		const mensajeSms = mensajeSmsEditable(
			metodoInicial,
			mensajeEditado,
			mensajeWhatsappEditado,
		);
		const mensajeEmail = mensajeEmailEditable(
			metodoInicial,
			mensajeEditado,
			mensajeWhatsappEditado,
		);
		const cuerpoNoReply = cuerpoParaValidarNoReply(
			metodo,
			mensajeWhatsapp,
			mensajeSms,
			mensajeEmail,
		);
		const telefonoAsesorNoReply = prepararTelefonoAsesorParaEnvio(
			cuerpoNoReply,
			telefonoAsesorLimpio,
		);
		if (accionUsaCuerpoNoReply(metodo) && !telefonoAsesorNoReply.enviar) {
			toast.error(
				"No se puede enviar esta plantilla no-reply porque el asesor no tiene teléfono registrado",
			);
			return;
		}
		// Los dos guards siguientes se evalúan sobre el mensaje REAL del canal
		// (ya interpolado y editado por el asesor), no sobre la plantilla
		// original: si el asesor borra la oración de mora o corrige la fecha del
		// impuesto en "Editar mensaje", el envío se habilita.
		//
		// Si el server no pudo calcular la expectativa (crédito sin capital o en
		// estado excluido de mora) y la oración sigue en el texto, saldría
		// "recargo por mora de Q." roto.
		if (
			accionUsaCuerpoNoReply(metodo) &&
			mensajeAnunciaExpectativaMora(cuerpoNoReply) &&
			// La oración dice los dos montos juntos: el recargo por día y su tope.
			(!expectativaMora.trim() || !expectativaMoraDiaria.trim())
		) {
			toast.error(
				'El crédito no genera mora (estado excluido o sin capital suficiente). Borre la oración del recargo en "Editar mensaje" o elija otra plantilla.',
			);
			return;
		}
		// El monto adeudado lo calcula el server desde el detalle de cartera y
		// puede venir vacío: crédito sin cuotas vencidas (p. ej. al día y el
		// asesor eligió a mano una plantilla de mora), INCOBRABLE el mismo día
		// del castigo, o el fallback por datos corruptos de cartera, que arma el
		// detalle desde el listado y no trae cuotas. Sin este guard el mensaje
		// sale con el hueco: "por un monto de Q.". Mismo criterio que el masivo,
		// que en ese caso descarta el crédito con motivo.
		if (
			accionUsaCuerpoNoReply(metodo) &&
			mensajeAnunciaMontoAdeudado(cuerpoNoReply) &&
			!montoAdeudado.trim()
		) {
			toast.error(
				'No se pudo calcular el monto adeudado de este crédito. Quite la oración del monto en "Editar mensaje" o elija otra plantilla.',
			);
			return;
		}
		// El aumento de la mora: la oración incorporada se borra sola al
		// interpolar, pero si el asesor escribió {incrementoDiarioMora} suelto y
		// cartera no mandó el dato, el mensaje sale con el hueco ("El saldo
		// aumenta Q diario"). Mismo criterio que el masivo, que en ese caso
		// descarta el crédito con motivo.
		if (
			accionUsaCuerpoNoReply(metodo) &&
			mensajeAnunciaIncrementoMoraSinDato(
				cuerpoNoReply,
				incrementoDiarioMora,
				incrementoMaximoMensualMora,
			)
		) {
			toast.error(
				'No se pudo calcular cuánto aumenta la mora de este crédito. Quite la oración del aumento en "Editar mensaje" o elija otra plantilla.',
			);
			return;
		}
		// Pasado el 31/07, el mensaje no puede seguir pidiendo el comprobante
		// "antes de la hora límite" de una fecha vencida.
		if (
			accionUsaCuerpoNoReply(metodo) &&
			mensajeTieneFechaLimiteImpuestoVencida(cuerpoNoReply)
		) {
			toast.error(
				'La fecha límite del impuesto de circulación ya venció. Cambie la fecha en "Editar mensaje" o contacte al cliente directamente.',
			);
			return;
		}
		switch (metodo) {
			case "llamada":
				window.open(`tel:${tel}`);
				break;
			case "whatsapp-link": {
				const url = crearUrlWhatsappManual(telLimpio, mensajeWhatsapp);
				window.open(url);
				break;
			}
			case "whatsapp-api":
				if (!telLimpio) {
					toast.error("No hay teléfono para enviar WhatsApp");
					return;
				}
				if (!mensajeWhatsapp.trim()) {
					toast.error("No hay mensaje para enviar");
					return;
				}
				whatsappApiMutation.mutate({
					telefono: telLimpio,
					mensaje: mensajeWhatsapp,
				});
				break;
			case "email-link": {
				const params = new URLSearchParams();
				if (asuntoEditado) params.set("subject", asuntoEditado);
				if (mensajeEmail) params.set("body", mensajeEmail);
				const query = params.toString();
				window.open(`mailto:${emailCliente || ""}${query ? `?${query}` : ""}`);
				break;
			}
			case "email-api":
				if (!emailCliente) {
					toast.error("No hay email de destino");
					return;
				}
				if (!asuntoEditado.trim()) {
					toast.error("El asunto es requerido");
					return;
				}
				if (!mensajeEmail.trim()) {
					toast.error("El mensaje es requerido");
					return;
				}
				emailApiMutation.mutate({
					destinatario: emailCliente,
					asunto: asuntoEditado,
					mensaje: mensajeEmail,
				});
				break;
			case "sms-api":
				if (!telLimpio) {
					toast.error("No hay teléfono para enviar SMS");
					return;
				}
				if (!mensajeSms.trim()) {
					toast.error("No hay mensaje para enviar");
					return;
				}
				smsApiMutation.mutate({
					telefono: telLimpio,
					mensaje: mensajeSms,
				});
				break;
		}
	};

	const mensajeEditable = mensajePlantillaEditable(
		metodoInicial,
		mensajeEditado,
		mensajeWhatsappEditado,
	);
	const handleMensajeEditableChange = (mensaje: string) => {
		if (metodoInicial === "whatsapp") {
			setMensajeWhatsappEditado(mensaje);
			return;
		}

		setMensajeEditado(mensaje);
	};

	// ── Piezas compartidas por el Dialog y el modo embebido ──────────────────
	// Son las mismas de siempre, sacadas a variables para no duplicarlas: el
	// modal las pinta igual que antes y el Workspace las acomoda a su layout.

	/** Plantilla + asunto + mensaje (WhatsApp/SMS/Email). */
	const renderPlantillas = () => (
		<div className="space-y-3">
			<div className="space-y-2">
				<Label>Mensaje sugerido</Label>
				<Select value={plantillaId} onValueChange={handlePlantillaChange}>
					<SelectTrigger>
						<SelectValue placeholder="Seleccionar plantilla..." />
					</SelectTrigger>
					<SelectContent>
						{PLANTILLAS_MENSAJES.map((p) => (
							<SelectItem key={p.id} value={p.id}>
								{p.nombre}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>

			{plantillaId && metodoInicial === "email" && (
				<div className="space-y-2">
					<Label>Asunto</Label>
					<Input
						value={asuntoEditado}
						onChange={(e) => setAsuntoEditado(e.target.value)}
					/>
				</div>
			)}

			{plantillaId && metodoInicial === "whatsapp" && (
				<div className="space-y-2">
					<div className="flex items-center justify-between gap-2">
						<Label>Mensaje</Label>
						<Button
							type="button"
							size="sm"
							variant={editandoWhatsapp ? "outline" : "default"}
							className="gap-1.5"
							onClick={() => setEditandoWhatsapp((v) => !v)}
						>
							{editandoWhatsapp ? (
								<>
									<Eye className="h-3.5 w-3.5" />
									Ver como lo verá el cliente
								</>
							) : (
								<>
									<Pencil className="h-3.5 w-3.5" />
									Editar mensaje
								</>
							)}
						</Button>
					</div>
					{editandoWhatsapp ? (
						<>
							<Textarea
								className="min-h-[150px] text-sm"
								value={mensajeEditable}
								onChange={(e) => handleMensajeEditableChange(e.target.value)}
							/>
							<p className="text-muted-foreground text-xs">
								El texto entre asteriscos (<code>*así*</code>) sale en{" "}
								<strong>negrita</strong> en WhatsApp; los asteriscos no se ven
								en el mensaje final.
							</p>
						</>
					) : (
						<>
							<WhatsappPreview mensaje={mensajeEditable} />
							<p className="text-muted-foreground text-xs">
								Así lo verá el cliente en WhatsApp.
							</p>
						</>
					)}
				</div>
			)}

			{plantillaId && metodoInicial !== "whatsapp" && (
				<div className="space-y-2">
					<Label>Mensaje (editable)</Label>
					<Textarea
						className="min-h-[150px] text-sm"
						value={mensajeEditable}
						onChange={(e) => handleMensajeEditableChange(e.target.value)}
					/>
				</div>
			)}
		</div>
	);

	/** «Teléfono a contactar», cuando hay más de un número. */
	const selectorTelefono = (
		<div className="space-y-2">
			<Label>Teléfono a contactar</Label>
			<Select
				value={telefonoSeleccionado}
				onValueChange={setTelefonoSeleccionado}
			>
				<SelectTrigger>
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					{telefonos.map((t) => (
						<SelectItem key={t} value={t}>
							{t}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
		</div>
	);

	/** Comentarios (obligatorio). En el panel se llaman «Notas de la gestión». */
	const renderComentarios = () => (
		<form.Field
			name="comentarios"
			validators={{
				onChange: ({ value }) =>
					!value ? "Escriba las notas de la gestión." : undefined,
			}}
		>
			{(field) => (
				<div className="space-y-2">
					<Label>Notas de la gestión *</Label>
					<Textarea
						placeholder={
							esPromesa
								? "Describa lo conversado, lo acordado y cualquier detalle del compromiso del cliente."
								: "Describa lo conversado en el contacto, la actitud del cliente, etc."
						}
						className="min-h-[72px]"
						value={field.state.value}
						onChange={(e) => {
							field.handleChange(e.target.value);
							// Desde aquí la nota queda enlazada con la compartida
							// (también en una promesa en edición).
							asesorEditoNotas.current = true;
							onNotasChange?.(e.target.value);
						}}
					/>
					{field.state.meta.isTouched && field.state.meta.errors.length > 0 && (
						<p className="text-danger-text text-sm">
							{field.state.meta.errors.join(", ")}
						</p>
					)}
				</div>
			)}
		</form.Field>
	);

	/** CB-025: conceptos de la promesa (cuotas + mora), total en vivo y monto. */
	const conceptosPromesa = (
		<>
			<div className="overflow-hidden rounded-lg border">
				{numerosAtrasados.length === 0 ? (
					<p className="p-3 text-muted-foreground text-sm">
						Este contrato no tiene cuotas atrasadas.
					</p>
				) : (
					<div className="max-h-[200px] divide-y overflow-y-auto">
						{cuotasOrdenadas.map((c) => {
							const activa = cuotasPromesa.has(c.numeroCuota);
							return (
								<label
									key={c.numeroCuota}
									className={cn(
										"flex min-h-[44px] cursor-pointer items-center gap-3 px-3 py-2 transition-colors",
										activa ? "bg-primary/5" : "hover:bg-muted/50",
									)}
								>
									<Checkbox
										checked={activa}
										onCheckedChange={() => alternarCuotaPromesa(c.numeroCuota)}
									/>
									<div className="flex-1">
										<p className="font-medium text-sm">
											Cuota #{c.numeroCuota}
										</p>
										{c.fechaVencimiento && (
											<p className="text-muted-foreground text-xs">
												Vence{" "}
												{format(new Date(c.fechaVencimiento), "dd MMM yyyy", {
													locale: es,
												})}
											</p>
										)}
									</div>
									<span className="font-medium text-sm tabular-nums">
										Q
										{c.monto.toLocaleString("es-GT", {
											minimumFractionDigits: 2,
											maximumFractionDigits: 2,
										})}
									</span>
								</label>
							);
						})}
					</div>
				)}

				{/* Mora como una fila más — mantiene el campo incluyeMora y sus
								    validators (regla "rango O mora"). */}
				<form.Field
					name="incluyeMora"
					validators={{
						onChangeListenTo: ["cuotaInicio", "cuotaFin"],
						onChange: ({ value, fieldApi }) => {
							const cuotaInicio = fieldApi.form.getFieldValue("cuotaInicio");
							const cuotaFin = fieldApi.form.getFieldValue("cuotaFin");
							return faltaRangoOMora(cuotaInicio, cuotaFin, value)
								? MENSAJE_RANGO_O_MORA_REQUERIDO
								: undefined;
						},
						onSubmit: ({ value, fieldApi }) => {
							const cuotaInicio = fieldApi.form.getFieldValue("cuotaInicio");
							const cuotaFin = fieldApi.form.getFieldValue("cuotaFin");
							return faltaRangoOMora(cuotaInicio, cuotaFin, value)
								? MENSAJE_RANGO_O_MORA_REQUERIDO
								: undefined;
						},
					}}
				>
					{(field) => (
						<label
							className={cn(
								"flex min-h-[44px] cursor-pointer items-center gap-3 border-t px-3 py-2 transition-colors",
								field.state.value ? "bg-primary/5" : "hover:bg-muted/50",
							)}
						>
							<Checkbox
								checked={field.state.value}
								onCheckedChange={(ch) => {
									field.handleChange(!!ch);
									form.setFieldValue(
										"montoComprometido",
										montoPromesaDe(cuotasPromesa, !!ch).toFixed(2),
									);
								}}
							/>
							<div className="flex-1">
								<p className="font-medium text-sm">Mora</p>
								<p className="text-muted-foreground text-xs">
									Interés por atraso del crédito
								</p>
							</div>
							<span className="font-medium text-sm tabular-nums">
								Q
								{montoMora.toLocaleString("es-GT", {
									minimumFractionDigits: 2,
									maximumFractionDigits: 2,
								})}
							</span>
						</label>
					)}
				</form.Field>

				{/* Total en vivo de lo seleccionado */}
				<form.Subscribe
					selector={(state) => [
						state.values.cuotaInicio,
						state.values.cuotaFin,
						state.values.incluyeMora,
						state.values.montoComprometido,
					]}
				>
					{() => {
						const seleccionado = totalDeSeleccion(
							cuotasPromesa,
							!!form.getFieldValue("incluyeMora"),
						);
						// La cuota del convenio se cobra ADEMÁS de las cuotas del crédito;
						// se muestra como línea aparte para que se entienda el total.
						const convenio = esConvenio ? (cuotaConvenio ?? 0) : 0;
						const total = seleccionado + convenio;
						return (
							<>
								{convenio > 0 && (
									<div className="flex items-center justify-between border-t px-3 py-2 text-sm">
										<span className="text-muted-foreground">
											Cuota de convenio
										</span>
										<span className="tabular-nums">
											+Q
											{convenio.toLocaleString("es-GT", {
												minimumFractionDigits: 2,
												maximumFractionDigits: 2,
											})}
										</span>
									</div>
								)}
								<div className="flex items-center justify-between border-t bg-muted/40 px-3 py-2">
									<span className="font-medium text-sm">
										{convenio > 0 ? "Total" : "Total seleccionado"}
									</span>
									<span className="font-bold text-base tabular-nums">
										Q
										{total.toLocaleString("es-GT", {
											minimumFractionDigits: 2,
											maximumFractionDigits: 2,
										})}
									</span>
								</div>
							</>
						);
					}}
				</form.Subscribe>
			</div>

			{/* Validación "rango O mora" */}
			<form.Subscribe
				selector={(state) => [
					state.values.cuotaInicio,
					state.values.cuotaFin,
					state.values.incluyeMora,
				]}
			>
				{([cuotaInicio, cuotaFin, incluyeMora]) =>
					faltaRangoOMora(
						cuotaInicio as number | null | undefined,
						cuotaFin as number | null | undefined,
						!!incluyeMora,
					) ? (
						<p className="text-muted-foreground text-sm">
							{MENSAJE_RANGO_O_MORA_REQUERIDO}.
						</p>
					) : null
				}
			</form.Subscribe>

			{/* CB-025: monto comprometido — sale de lo seleccionado (cuotas +
							    mora) y no se edita: para cambiarlo se marcan o desmarcan
							    cuotas. Solo con un pago parcial en la visita se propone lo
							    que falta y se puede ajustar. Informativo: no participa en
							    evaluarPromesa. */}
			<form.Field name="montoComprometido">
				{(field) => (
					<div className="space-y-2">
						<Label htmlFor="montoComprometido">
							{montoEditable
								? "Monto comprometido (saldo pendiente)"
								: "Monto comprometido"}
						</Label>
						<CurrencyInput
							id="montoComprometido"
							value={field.state.value}
							onChange={(value) => field.handleChange(value)}
							disabled={!montoEditable}
						/>
						<p className="text-muted-foreground text-xs">
							{montoEditable
								? `El cliente pagó Q${yaPagado.toLocaleString("es-GT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} en la visita. Se propone el saldo pendiente; puede ajustarse si el acuerdo fue otro.`
								: "Se calcula con las cuotas seleccionadas y la mora."}
						</p>
					</div>
				)}
			</form.Field>
		</>
	);

	/** Fecha prometida (promesa) o de próximo contacto (completo). */
	const renderFechaProximoContacto = (etiqueta?: string) => (
		<form.Field
			name="fechaProximoContacto"
			validators={{
				// onChange no corre si el campo nunca se toca (form
				// arranca en undefined) — sin onSubmit, un asesor que
				// nunca abre el calendario puede enviar la promesa sin
				// fecha (Codex, PR #1147): la fila queda invisible para
				// getEstadoPromesasPago (este mismo archivo filtra por
				// fechaProximoContacto antes de armar promesaIds).
				onChange: ({ value }) =>
					esPromesa && !value ? "La fecha prometida es obligatoria" : undefined,
				onSubmit: ({ value }) =>
					esPromesa && !value ? "La fecha prometida es obligatoria" : undefined,
			}}
		>
			{(field) => (
				<div className="space-y-2">
					<Label>
						{etiqueta ??
							(esPromesa
								? "Fecha en la que prometió pagar *"
								: "Fecha de próximo contacto (opcional)")}
					</Label>
					<Popover>
						<PopoverTrigger asChild>
							<Button
								type="button"
								variant="outline"
								className={cn(
									"w-full justify-start text-left font-normal",
									!field.state.value && "text-muted-foreground",
								)}
							>
								<CalendarIcon className="mr-2 h-4 w-4" />
								{field.state.value
									? format(field.state.value, "dd MMM, yyyy", {
											locale: es,
										})
									: "Seleccionar fecha"}
							</Button>
						</PopoverTrigger>
						<PopoverContent className="w-auto p-0" align="start">
							<Calendar
								mode="single"
								selected={field.state.value}
								onSelect={(date) => {
									const fecha = date ? fechaAMedianocheGT(date) : undefined;
									field.handleChange(fecha);
									// Sin checkbox: el seguimiento lo define la propia fecha.
									if (!esPromesa) {
										form.setFieldValue("requiereSeguimiento", !!fecha);
									}
									// CB-029: la alerta sigue a la fecha prometida
									// (default D-1); editable en el campo de abajo.
									if (esPromesa) {
										form.setFieldValue(
											"fechaAlerta",
											fecha ? restarUnDiaGT(fecha) : undefined,
										);
									}
								}}
								disabled={(date) =>
									date < new Date(new Date().setHours(0, 0, 0, 0))
								}
								locale={es}
							/>
						</PopoverContent>
					</Popover>
					{field.state.meta.errors.length > 0 && (
						<p className="text-danger-text text-sm">
							{field.state.meta.errors.join(", ")}
						</p>
					)}
				</div>
			)}
		</form.Field>
	);

	/** CB-029: fecha de aviso de la promesa (default D-1). */
	const campoFechaAlerta = (
		<form.Field name="fechaAlerta">
			{(field) => (
				<div className="space-y-2">
					<Label>Fecha de aviso (opcional)</Label>
					<Popover>
						<PopoverTrigger asChild>
							<Button
								type="button"
								variant="outline"
								className={cn(
									"w-full justify-start text-left font-normal",
									!field.state.value && "text-muted-foreground",
								)}
							>
								<CalendarIcon className="mr-2 h-4 w-4" />
								{field.state.value
									? format(field.state.value, "dd MMM, yyyy", {
											locale: es,
										})
									: "Por defecto, 1 día antes"}
							</Button>
						</PopoverTrigger>
						<PopoverContent className="w-auto p-0" align="start">
							<Calendar
								mode="single"
								selected={field.state.value}
								onSelect={(date) =>
									field.handleChange(
										date ? fechaAMedianocheGT(date) : undefined,
									)
								}
								disabled={(date) => {
									// Ni pasada, ni DESPUÉS de la fecha prometida: una
									// alerta post-vencimiento nunca dispararía (la promesa
									// ya sería incumplida/cumplida) — Codex PR #1232.
									const fechaPromesa = form.getFieldValue(
										"fechaProximoContacto",
									);
									return (
										date < new Date(new Date().setHours(0, 0, 0, 0)) ||
										(fechaPromesa != null && date > fechaPromesa)
									);
								}}
								locale={es}
							/>
						</PopoverContent>
					</Popover>
					<p className="text-muted-foreground text-xs">
						Ese día recibirá un recordatorio para dar seguimiento antes de que
						venza.
					</p>
				</div>
			)}
		</form.Field>
	);

	/** CB-025: próximo paso, texto libre opcional. */
	const campoProximoPaso = (
		<form.Field name="proximoPaso">
			{(field) => (
				<div className="space-y-2">
					<Label htmlFor="proximoPaso">Próximo paso (opcional)</Label>
					<Textarea
						id="proximoPaso"
						placeholder="Ej.: llamar de nuevo, enviar carta notarial, escalar a jurídico..."
						value={field.state.value}
						onChange={(e) => field.handleChange(e.target.value)}
					/>
				</div>
			)}
		</form.Field>
	);

	// El mismo diseño en el Workspace (embebido) y en el modal de la Ficha 360.
	let panel: React.ReactNode;
	{
		const usaTelefono =
			metodoInicial === "llamada" ||
			metodoInicial === "whatsapp" ||
			metodoInicial === "sms";
		const telefonoMostrado =
			telefonoContactado || telefonoSeleccionado || telefonoPrincipal;
		const mostrarSelectorTelefono =
			usaTelefono && !telefonoContactado && telefonos.length > 1;
		// Sin destino (el Workspace no pasa los datos de relleno, p. ej.
		// «00000000»): enviar o abrir WhatsApp/correo no tiene a quién ir.
		const sinDestino =
			metodoInicial === "email" ? !emailCliente?.trim() : !telefonoMostrado;
		const tipoGestion =
			direccion &&
			(metodoInicial === "llamada" ||
				metodoInicial === "whatsapp" ||
				metodoInicial === "sms" ||
				metodoInicial === "email")
				? `${NOMBRE_CANAL[metodoInicial]} ${direccion}`
				: NOMBRE_CANAL[metodoInicial];
		const nombreParticipante = participante
			? `${participante.nombre} · ${ROL_PARTICIPANTE[participante.tipo]}`
			: clienteNombre;
		// Con un solo resultado permitido, el select se oculta y el resultado
		// se lee en la tarjeta resumen.
		const resultadoUnico =
			opcionesResultado.length <= 1
				? (opcionesResultado[0] ??
					OPCIONES_RESULTADO.find((o) => o.value === estadoArranque))
				: undefined;

		/** Fila etiqueta/valor de la tarjeta resumen (estilo Figma). */
		const filaResumen = (
			etiqueta: string,
			valor: React.ReactNode,
			claseValor = "wrap-break-word",
		) => (
			<div className="flex items-start justify-between gap-3 text-sm">
				<span className="shrink-0 text-muted-foreground">{etiqueta}</span>
				<span className={cn("min-w-0 text-right font-medium", claseValor)}>
					{valor}
				</span>
			</div>
		);

		// «No hubo contacto»: el cliente no pidió nada; lo que se agenda es el
		// próximo intento (mismo No/Sí y mismos campos).
		const tituloRecontacto = soloSinContacto
			? "Programar próximo intento"
			: "¿El cliente solicitó que se le contacte nuevamente?";

		const selectResultado = (
			<form.Field name="estadoContacto">
				{(field) => (
					<div className="space-y-2">
						<Label htmlFor="estadoContactoEmbebido">Resultado</Label>
						<Select
							value={field.state.value}
							onValueChange={(value) =>
								form.setFieldValue(field.name, value as EstadoContacto)
							}
						>
							<SelectTrigger id="estadoContactoEmbebido" className="w-full">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{opcionesResultado.map((o) => (
									<SelectItem key={o.value} value={o.value}>
										{o.etiqueta}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>
				)}
			</form.Field>
		);

		const campoDuracion = (
			<form.Field name="duracionLlamada">
				{(field) => (
					<div className="space-y-1">
						<div className="flex items-center justify-between gap-3 text-sm">
							<Label
								htmlFor="duracionLlamadaEmbebido"
								className="font-normal text-muted-foreground"
							>
								Duración
							</Label>
							<Input
								id="duracionLlamadaEmbebido"
								inputMode="numeric"
								placeholder="mm:ss"
								className="h-8 w-24 text-right tabular-nums"
								value={duracionTexto}
								onChange={(e) => {
									setDuracionTexto(e.target.value);
									field.handleChange(parsearDuracion(e.target.value));
								}}
							/>
						</div>
						{duracionTexto.trim() !== "" &&
							parsearDuracion(duracionTexto) == null && (
								<p className="text-right text-danger-text text-xs">
									{MENSAJE_DURACION_ILEGIBLE}
								</p>
							)}
					</div>
				)}
			</form.Field>
		);

		let cuerpo: React.ReactNode;
		let botonPrincipal: React.ReactNode;
		let enlaceSecundario: React.ReactNode = null;

		const botonGuardar = (texto: string) => (
			<form.Subscribe selector={(state) => [state.canSubmit]}>
				{([canSubmit]) => (
					<Button
						type="submit"
						className="min-w-0 flex-1"
						disabled={!canSubmit || envioEnCurso || duracionIlegible}
					>
						{createContactoMutation.isPending ? (
							<>
								<Loader2 className="h-4 w-4 animate-spin" />
								Guardando...
							</>
						) : (
							texto
						)}
					</Button>
				)}
			</form.Subscribe>
		);

		if (esPromesa) {
			// Promesa de pago (CallPromesa): banda de compromiso + conceptos en
			// tarjeta. Mismos campos, validaciones y modo edición que el modal.
			cuerpo = (
				<>
					<div className="flex items-start gap-2 rounded-lg bg-success-subtle px-3 py-2 font-medium text-sm text-success-text">
						<Handshake className="mt-0.5 h-4 w-4 shrink-0" />
						<span className="min-w-0">
							{esEdicion
								? "Promesa de pago activa · está editando esa promesa (no se crea otra)"
								: "Compromiso aceptado · registre la promesa de pago"}
						</span>
					</div>
					<div className="space-y-4 rounded-lg border p-3">
						<div className="space-y-1">
							<p className="font-medium text-sm">Conceptos a pagar</p>
							<p className="text-muted-foreground text-xs">
								Se incluyen todas las cuotas atrasadas y la mora; desmarque lo
								que no aplique.
							</p>
						</div>
						{conceptosPromesa}
						<div className="grid @md:grid-cols-2 gap-3">
							{renderFechaProximoContacto()}
							{campoFechaAlerta}
						</div>
					</div>
					{renderComentarios()}
					{campoProximoPaso}
				</>
			);
			botonPrincipal = botonGuardar(
				esEdicion ? "Guardar promesa" : "Guardar gestión",
			);
		} else if (esMensajeSaliente) {
			// Mensaje saliente (MsgWAcompose / MsgSMScompose / MsgCorreoCompose):
			// plantilla + envío por API. Tras enviar, `registrarTrasEnvio` registra
			// el contacto y `onCreado` le avisa al Workspace («Mensaje enviado»).
			const destino =
				metodoInicial === "email"
					? emailCliente || "Sin correo registrado"
					: telefonoMostrado || "Sin teléfono registrado";
			cuerpo = (
				<>
					{/* Sin tarjeta resumen: la banda del Workspace ya dice el canal y
					    el participante. Queda solo el destino (o su selector). */}
					{mostrarSelectorTelefono ? (
						selectorTelefono
					) : (
						<div className="rounded-lg border bg-muted/40 px-3 py-2">
							{filaResumen(
								metodoInicial === "email" ? "Correo" : "Teléfono",
								destino,
								"break-all",
							)}
						</div>
					)}
					{renderComentarios()}
					<div className="space-y-3">
						<h3 className="font-semibold text-base">Redactar mensaje</h3>
						{renderPlantillas()}
					</div>
					{(metodoInicial === "whatsapp" || metodoInicial === "email") && (
						<Button
							type="button"
							variant="outline"
							size="sm"
							className="gap-1.5"
							onClick={() =>
								ejecutarAccion(
									metodoInicial === "whatsapp" ? "whatsapp-link" : "email-link",
								)
							}
							disabled={envioEnCurso || sinDestino}
						>
							<ExternalLink className="h-3.5 w-3.5" />
							{metodoInicial === "whatsapp"
								? "Abrir WhatsApp Web"
								: "Abrir cliente de correo"}
						</Button>
					)}
					<Collapsible className="rounded-lg border">
						<CollapsibleTrigger className="group flex w-full items-center justify-between gap-2 px-3 py-2 text-left font-medium text-sm">
							Resultado y próximo contacto
							<ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
						</CollapsibleTrigger>
						<CollapsibleContent className="space-y-4 border-t px-3 pt-3 pb-3">
							{opcionesResultado.length > 1 && selectResultado}
							{renderFechaProximoContacto()}
							{campoProximoPaso}
						</CollapsibleContent>
					</Collapsible>
				</>
			);
			const accionEnvio: AccionContacto =
				metodoInicial === "whatsapp"
					? "whatsapp-api"
					: metodoInicial === "email"
						? "email-api"
						: "sms-api";
			const enviando =
				whatsappApiMutation.isPending ||
				emailApiMutation.isPending ||
				smsApiMutation.isPending;
			const IconoEnvio =
				metodoInicial === "whatsapp"
					? MessageCircle
					: metodoInicial === "email"
						? Mail
						: MessageSquare;
			botonPrincipal = (
				<Button
					type="button"
					className="min-w-0 flex-1"
					onClick={() => ejecutarAccion(accionEnvio)}
					disabled={envioEnCurso || sinDestino}
				>
					{enviando ? (
						<Loader2 className="h-4 w-4 animate-spin" />
					) : (
						<IconoEnvio className="h-4 w-4" />
					)}
					{enviando
						? metodoInicial === "sms"
							? "Enviando SMS..."
							: "Enviando..."
						: metodoInicial === "whatsapp"
							? "Enviar WhatsApp"
							: metodoInicial === "email"
								? "Enviar correo"
								: "Enviar SMS"}
				</Button>
			);
			// Registrar sin pasar por la API (p. ej. se envió por WhatsApp Web).
			// Va como enlace encima de la fila de botones, para que el principal
			// no quede angosto (ni se salga en pantallas chicas).
			enlaceSecundario = (
				<form.Subscribe selector={(state) => [state.canSubmit]}>
					{([canSubmit]) => (
						<Button
							type="submit"
							variant="text"
							size="sm"
							className="self-center"
							disabled={!canSubmit || envioEnCurso}
						>
							Registrar sin enviar
						</Button>
					)}
				</form.Subscribe>
			);
		} else {
			// Registrar gestión (CallNoAcuerdo / CallNoContacto / CallReagenda /
			// EntLlamNoAcuerdo / EntWANoAcuerdo).
			cuerpo = (
				<>
					<div className="space-y-2 rounded-lg border bg-muted/40 p-3">
						{filaResumen("Tipo de gestión", tipoGestion)}
						{filaResumen("Participante de la gestión", nombreParticipante)}
						{usaTelefono &&
							telefonoMostrado &&
							filaResumen(
								"Teléfono",
								<span className="inline-flex flex-wrap items-center justify-end gap-2">
									<span className="break-all">{telefonoMostrado}</span>
									{metodoInicial === "llamada" && direccion !== "entrante" && (
										<Button
											type="button"
											variant="outline"
											size="sm"
											className="h-7 gap-1.5"
											onClick={() => ejecutarAccion("llamada")}
											disabled={envioEnCurso}
										>
											<Phone className="h-3.5 w-3.5" />
											Llamar
										</Button>
									)}
								</span>,
							)}
						{filaResumen(
							"Fecha y hora",
							`Hoy · ${format(new Date(), "HH:mm")}`,
						)}
						{metodoInicial === "llamada" && campoDuracion}
						{resultadoUnico &&
							filaResumen("Resultado", resultadoUnico.etiqueta)}
					</div>

					{!resultadoUnico && selectResultado}
					{mostrarSelectorTelefono && selectorTelefono}

					<div className="space-y-3 rounded-lg border p-3">
						<p className="flex items-start gap-2 font-medium text-sm">
							<RefreshCw className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
							{tituloRecontacto}
						</p>
						<SegmentedNav
							aria-label={tituloRecontacto}
							className="grid w-full grid-cols-2"
							opciones={[
								{ value: "no", label: "No" },
								{ value: "si", label: "Sí" },
							]}
							value={contactarDeNuevo ? "si" : "no"}
							onValueChange={(v) => {
								const si = v === "si";
								setContactarDeNuevo(si);
								if (!si) {
									// «No» = sin próximo contacto (mismo efecto que dejar
									// vacía la fecha en el modal).
									form.setFieldValue("fechaProximoContacto", undefined);
									form.setFieldValue("requiereSeguimiento", false);
									setHoraProximoContacto("");
								}
							}}
						/>
						{contactarDeNuevo ? (
							<>
								<div className="grid @md:grid-cols-2 gap-3">
									{renderFechaProximoContacto("Fecha de contacto *")}
									<div className="space-y-2">
										<Label htmlFor="horaProximoContacto">Hora</Label>
										<Input
											id="horaProximoContacto"
											type="time"
											value={horaProximoContacto}
											onChange={(e) => setHoraProximoContacto(e.target.value)}
										/>
									</div>
								</div>
								<div className="flex flex-wrap items-center justify-between gap-2">
									<Label>Medio</Label>
									<SegmentedNav
										aria-label="Medio del próximo contacto"
										opciones={[
											{
												value: "llamada",
												label: (
													<span className="inline-flex items-center gap-1.5">
														<Phone className="h-3.5 w-3.5" />
														Llamada
													</span>
												),
											},
											{
												value: "whatsapp",
												label: (
													<span className="inline-flex items-center gap-1.5">
														<MessageCircle className="h-3.5 w-3.5" />
														WhatsApp
													</span>
												),
											},
										]}
										value={medioProximoContacto}
										onValueChange={(v) =>
											setMedioProximoContacto(v as "llamada" | "whatsapp")
										}
									/>
								</div>
								<p className="flex items-start gap-2 rounded-md bg-primary/10 px-3 py-2 text-primary text-xs">
									<CalendarIcon className="mt-px h-3.5 w-3.5 shrink-0" />
									Se agendará automáticamente en su cola de trabajo.
								</p>
							</>
						) : (
							<p className="flex items-start gap-2 text-muted-foreground text-xs">
								<Info className="mt-px h-3.5 w-3.5 shrink-0" />
								Seleccione «Sí» para agendar el seguimiento en su cola de
								trabajo.
							</p>
						)}
					</div>

					{renderComentarios()}
					{campoProximoPaso}
				</>
			);
			botonPrincipal = botonGuardar("Guardar gestión");
		}

		panel = (
			<div className="@container flex min-h-0 flex-1 flex-col">
				<form
					onSubmit={(e) => {
						e.preventDefault();
						e.stopPropagation();
						form.handleSubmit();
					}}
					className="flex min-h-0 flex-1 flex-col gap-3"
				>
					<div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
						{cuerpo}
					</div>
					<div className="mt-auto flex flex-col gap-2 border-t pt-3">
						{/* Acción extra del Workspace (p. ej. «Programar visita de
						    campo»), a ancho completo. */}
						{accionExtraPie && (
							<div className="flex flex-col *:w-full">{accionExtraPie}</div>
						)}
						{enlaceSecundario}
						<div className="flex flex-wrap gap-2">
							<Button
								type="button"
								variant="outline"
								onClick={() =>
									embebido ? onCancelar?.() : handleOpenChange(false)
								}
								disabled={envioEnCurso}
							>
								Cancelar
							</Button>
							{botonPrincipal}
						</div>
					</div>
				</form>
			</div>
		);
	}
	if (embebido) return panel;

	return (
		<Dialog open={isOpen} onOpenChange={handleOpenChange}>
			{children && <DialogTrigger asChild>{children}</DialogTrigger>}
			<DialogContent className="flex max-h-[90vh] flex-col gap-0 overflow-hidden sm:max-w-2xl">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						{esPromesa ? (
							<MessageSquare className="h-4 w-4" />
						) : (
							getIconoMetodo(metodoInicial)
						)}
						{esEdicion
							? "Editar Promesa de Pago"
							: esPromesa
								? "Promesa de Pago"
								: "Registrar Contacto"}{" "}
						- {clienteNombre}
					</DialogTitle>
					<DialogDescription>
						{esEdicion
							? "Este caso ya tiene una promesa de pago activa. Está editando esa promesa (no se crea otra)."
							: esPromesa
								? "Registre lo conversado y la fecha en la que el cliente prometió pagar."
								: "Registre los detalles de la interacción con el cliente y programe el próximo seguimiento."}
					</DialogDescription>
				</DialogHeader>
				<div className="flex min-h-0 flex-1 flex-col pt-4">{panel}</div>
			</DialogContent>
		</Dialog>
	);
}
