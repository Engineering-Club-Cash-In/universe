import { useForm } from "@tanstack/react-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import {
	CalendarIcon,
	Loader2,
	Mail,
	MessageCircle,
	MessageSquare,
	Phone,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Checkbox } from "@/components/ui/checkbox";
import {
	CurrencyInput,
	normalizeForSubmit,
} from "@/components/ui/currency-input";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
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
	mensajeEmailEditable,
	mensajePlantillaEditable,
	mensajeSmsEditable,
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
	"Indica un rango de cuotas, marca que incluye mora, o ambos";

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

interface ContactoModalProps {
	casoCobroId: string;
	clienteNombre: string;
	telefonoPrincipal: string;
	telefonoAlternativo?: string;
	emailCliente?: string;
	// CB-026: "sms" es un canal registrable desde que se agregó al enum
	// metodo_contacto — es uno de los 3 que la gestión temprana B1 exige agotar.
	metodoInicial:
		| "llamada"
		| "whatsapp"
		| "sms"
		| "email"
		| "visita_domicilio"
		| "carta_notarial";
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
}

/** Etiqueta del canal — el método ya no se elige dentro de la modal. */
const CANAL_LABEL: Record<string, string> = {
	llamada: "📞 Llamada",
	whatsapp: "💬 WhatsApp",
	sms: "📱 SMS",
	email: "📧 Email",
	visita_domicilio: "🏠 Visita a domicilio",
	carta_notarial: "📋 Carta notarial",
};

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
	const isOpen = isControlled ? open : internalOpen;

	const handleOpenChange = (newOpen: boolean) => {
		if (!isControlled) {
			setInternalOpen(newOpen);
		}
		onOpenChange?.(newOpen);
	};

	const [telefonoSeleccionado, setTelefonoSeleccionado] = useState(
		() => telefonos[0] || telefonoPrincipal,
	);

	const [plantillaId, setPlantillaId] = useState<string>("");
	const [mensajeEditado, setMensajeEditado] = useState("");
	const [mensajeWhatsappEditado, setMensajeWhatsappEditado] = useState("");
	const [asuntoEditado, setAsuntoEditado] = useState("");

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
		],
	);

	// Pre-seleccionar plantilla sugerida al abrir
	useEffect(() => {
		const sugerida = sugerirPlantilla(estadoMora, fechaInicio);
		setPlantillaId(sugerida);
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
			estadoContacto: (esPromesa ? "promesa_pago" : "contactado") as
				| "contactado"
				| "no_contesta"
				| "numero_equivocado"
				| "promesa_pago"
				| "acuerdo_parcial"
				| "rechaza_pagar",
			comentarios: esEdicion ? (promesaActiva?.comentarios ?? "") : "",
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
			duracionLlamada: undefined as number | undefined,
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
			// CB-025: monto que el cliente prometió pagar — informativo, opcional.
			// En promesa se pre-llena con lo que debe (cuota + mora) para que el
			// asesor no lo teclee; sigue editable. En edición: el monto guardado.
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
				// Enter dispara submit sin pasar por el onBlur del CurrencyInput
				// (que es donde normalmente se limpia un punto colgante como
				// "2500.") — se normaliza también acá, justo antes de armar el
				// payload, para no depender de que el campo haya perdido foco
				// (Codex, PR #1191, ronda 3).
				montoComprometido:
					normalizeForSubmit(data.montoComprometido) || undefined,
				proximoPaso: data.proximoPaso || undefined,
			}),
		onSuccess: () => {
			toast.success(
				esEdicion
					? "Promesa actualizada correctamente"
					: "Contacto registrado correctamente",
			);
			queryClient.invalidateQueries(
				orpc.getHistorialContactos.queryOptions({ input: { casoCobroId } }),
			);
			queryClient.invalidateQueries({
				predicate: (query) =>
					query.queryKey.some(
						(k) =>
							typeof k === "string" &&
							k.includes("getDetallesCreditoCarteraBack"),
					),
			});
			form.reset();
			handleOpenChange(false);
		},
		onError: (error: any) => {
			toast.error(error.message || "Error al registrar el contacto");
		},
	});

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
	const montoPromesaDe = (seleccion: Set<number>, incluyeMora: boolean) =>
		esConvenio
			? // Con convenio la cuota del convenio REEMPLAZA la mora (mismo criterio
				// que el card "Total a Cobrar" de la ficha, PR #1191): sumar ambas
				// inflaba el monto comprometido (Codex).
				totalDeSeleccion(seleccion, false) + (cuotaConvenio ?? 0)
			: totalDeSeleccion(seleccion, incluyeMora);

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
			form.setFieldValue("comentarios", promesaActiva?.comentarios ?? "");
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
		// El monto sigue a la selección (editable).
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
		// tocó el Resultado, se guarda como "no_contesta": `contactado` cuenta
		// como respuesta en evaluarGestionTempranaB1 y un WhatsApp de una vía
		// habría dado por respondida la gestión B1, apagando la alerta de los
		// canales que faltaban (Codex). Si el asesor SÍ eligió un resultado
		// (habló por WhatsApp y le contestaron), se respeta su elección.
		if (!form.getFieldMeta("estadoContacto")?.isTouched) {
			form.setFieldValue("estadoContacto", "no_contesta");
		}
		const actuales = String(form.getFieldValue("comentarios") ?? "").trim();
		if (!actuales) {
			const plantilla = PLANTILLAS_MENSAJES.find((p) => p.id === plantillaId);
			form.setFieldValue(
				"comentarios",
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
			toast.error(error?.message || "Error enviando WhatsApp"),
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
			toast.error(error?.message || "Error enviando email"),
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
			toast.error(error?.message || "Error enviando SMS"),
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

	// SMS también necesita la plantilla: antes solo se llegaba a SMS desde la
	// modal de WhatsApp/Email (ya con el mensaje cargado) y reusaba ese texto.
	// Con SMS como canal propio, sin esto el selector no aparecía y se enviaba
	// un mensaje VACÍO.
	const mostrarPlantillas =
		metodoInicial === "whatsapp" ||
		metodoInicial === "email" ||
		metodoInicial === "sms";
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

	return (
		<Dialog open={isOpen} onOpenChange={handleOpenChange}>
			{children && <DialogTrigger asChild>{children}</DialogTrigger>}
			<DialogContent className="max-h-[90vh] min-w-3xl max-w-4xl overflow-y-auto">
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
							? "Este caso ya tiene una promesa activa. Estás editándola (no se crea otra)."
							: esPromesa
								? "Registra lo hablado y la fecha en la que el cliente prometió pagar."
								: "Registra los detalles de la interacción con el cliente y programa el próximo seguimiento."}
					</DialogDescription>
				</DialogHeader>

				<form
					onSubmit={(e) => {
						e.preventDefault();
						e.stopPropagation();
						form.handleSubmit();
					}}
					className="space-y-4"
				>
					{/* Sección: Información del Contacto — oculta en variante "promesa":
					    el método/estado/plantilla/envío no aplican, la promesa se
					    registra sobre un contacto que ya ocurrió por otro medio. */}
					{!esPromesa && (
						<div className="space-y-3">
							<h3 className="font-semibold text-base">
								Información del Contacto
							</h3>

							{/* El canal lo define el botón que abrió la modal (Llamada / WhatsApp /
							    Email): antes era un Select y se podía cambiar acá adentro, así que
							    "Registrar Llamada" terminaba guardando un WhatsApp. Ahora es fijo. */}
							<div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2">
								<span className="text-muted-foreground text-xs">Canal</span>
								<span className="font-medium text-sm">
									{CANAL_LABEL[metodoInicial] ?? metodoInicial}
								</span>
							</div>

							{/* Selector de plantilla para WhatsApp y Email */}
							{mostrarPlantillas && (
								<div className="space-y-3 rounded-md border p-3">
									<div className="space-y-2">
										<Label>Plantilla de mensaje</Label>
										<Select
											value={plantillaId}
											onValueChange={handlePlantillaChange}
										>
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

									{plantillaId && (
										<div className="space-y-2">
											<Label>Mensaje (editable)</Label>
											<Textarea
												className="min-h-[150px] text-sm"
												value={mensajeEditable}
												onChange={(e) =>
													handleMensajeEditableChange(e.target.value)
												}
											/>
										</div>
									)}
								</div>
							)}

							{/* Selector de teléfono cuando hay múltiples */}
							{telefonos.length > 1 && (
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
							)}

							{/* Solo la acción del canal por el que se abrió la modal. Antes se
							    mostraban los 4 (Llamar / WhatsApp / Email / SMS) sin importar el
							    botón que la abrió, así que la modal parecía un menú de canales en
							    vez del registro de UNA gestión. */}
							<div className="flex flex-wrap items-center gap-2">
								{metodoInicial === "llamada" && (
									<Button
										type="button"
										variant="outline"
										size="sm"
										onClick={() => ejecutarAccion("llamada")}
										disabled={envioEnCurso}
										className="flex items-center gap-2"
									>
										<Phone className="h-4 w-4" />
										Llamar {telefonos.length <= 1 ? telefonos[0] || "" : ""}
									</Button>
								)}

								{metodoInicial === "whatsapp" && (
									<>
										<Button
											type="button"
											size="sm"
											onClick={() => ejecutarAccion("whatsapp-api")}
											disabled={envioEnCurso}
											className="flex items-center gap-2"
										>
											{whatsappApiMutation.isPending ? (
												<Loader2 className="h-4 w-4 animate-spin" />
											) : (
												<MessageCircle className="h-4 w-4" />
											)}
											{whatsappApiMutation.isPending
												? "Enviando..."
												: "Enviar WhatsApp"}
										</Button>
										<Button
											type="button"
											variant="ghost"
											size="sm"
											onClick={() => ejecutarAccion("whatsapp-link")}
											disabled={envioEnCurso}
											className="text-muted-foreground text-xs"
										>
											Abrir WhatsApp Web
										</Button>
									</>
								)}

								{metodoInicial === "email" && (
									<>
										<Button
											type="button"
											size="sm"
											onClick={() => ejecutarAccion("email-api")}
											disabled={envioEnCurso}
											className="flex items-center gap-2"
										>
											{emailApiMutation.isPending ? (
												<Loader2 className="h-4 w-4 animate-spin" />
											) : (
												<Mail className="h-4 w-4" />
											)}
											{emailApiMutation.isPending
												? "Enviando..."
												: "Enviar correo"}
										</Button>
										<Button
											type="button"
											variant="ghost"
											size="sm"
											onClick={() => ejecutarAccion("email-link")}
											disabled={envioEnCurso}
											className="text-muted-foreground text-xs"
										>
											Abrir cliente de correo
										</Button>
									</>
								)}

								{metodoInicial === "sms" && (
									<Button
										type="button"
										size="sm"
										onClick={() => ejecutarAccion("sms-api")}
										disabled={envioEnCurso}
										className="flex items-center gap-2"
									>
										{smsApiMutation.isPending ? (
											<Loader2 className="h-4 w-4 animate-spin" />
										) : (
											<MessageSquare className="h-4 w-4" />
										)}
										{smsApiMutation.isPending
											? "Enviando SMS..."
											: "Enviar SMS"}
									</Button>
								)}
							</div>

							<form.Field name="metodoContacto">
								{(metodoField) =>
									metodoField.state.value === "llamada" && (
										<form.Field name="duracionLlamada">
											{(field) => (
												<div className="space-y-2">
													<Label>Duración de la Llamada (segundos)</Label>
													<Input
														type="number"
														placeholder="Ej: 180"
														value={field.state.value}
														onChange={(e) =>
															field.handleChange(Number(e.target.value))
														}
													/>
												</div>
											)}
										</form.Field>
									)
								}
							</form.Field>
						</div>
					)}

					{/* Sección: Detalles de la Conversación */}
					<div className="space-y-3">
						<h3 className="font-semibold text-base">
							Detalles de la Conversación
						</h3>

						<form.Field
							name="comentarios"
							validators={{
								onChange: ({ value }) =>
									!value ? "Los comentarios son requeridos" : undefined,
							}}
						>
							{(field) => (
								<div className="space-y-2">
									<Label>Comentarios *</Label>
									<Textarea
										placeholder={
											esPromesa
												? "Describe qué se habló, qué acordó y cualquier detalle del compromiso del cliente."
												: "Describe qué se habló en el contacto, la actitud del cliente, etc."
										}
										className="min-h-[72px]"
										value={field.state.value}
										onChange={(e) => field.handleChange(e.target.value)}
									/>
									{field.state.meta.isTouched &&
										field.state.meta.errors.length > 0 && (
											<p className="text-red-500 text-sm">
												{field.state.meta.errors.join(", ")}
											</p>
										)}
								</div>
							)}
						</form.Field>

						{/* Resultado del contacto — discreto y al final: el 95% de las veces
						    es "Contactado" (default) y el asesor no debería detenerse acá. Los
						    otros estados siguen disponibles porque Gestión Temprana B1 los usa
						    para distinguir intento de contacto efectivo. */}
						{!esPromesa && (
							<form.Field name="estadoContacto">
								{(field) => (
									<div className="flex flex-wrap items-center gap-2">
										<Label className="text-muted-foreground text-xs">
											Resultado
										</Label>
										<Select
											onValueChange={(value) =>
												form.setFieldValue(
													field.name,
													value as typeof field.state.value,
												)
											}
											defaultValue={field.state.value}
										>
											<SelectTrigger className="h-8 w-56 text-sm">
												<SelectValue />
											</SelectTrigger>
											<SelectContent>
												<SelectItem value="contactado">
													✅ Contactado
												</SelectItem>
												<SelectItem value="no_contesta">
													❌ No contestó
												</SelectItem>
												<SelectItem value="numero_equivocado">
													📱 Número equivocado
												</SelectItem>
												<SelectItem value="acuerdo_parcial">
													📝 Acuerdo parcial
												</SelectItem>
												<SelectItem value="rechaza_pagar">
													🚫 Rechaza pagar
												</SelectItem>
											</SelectContent>
										</Select>
									</div>
								)}
							</form.Field>
						)}
					</div>

					{/* CB-025: "¿Qué prometió pagar?" — SOLO en promesa. Lista de checkboxes
					    (fila por cuota atrasada + fila de Mora) con monto y vencimiento, y el
					    total en vivo. Guía ui-ux-pro-max: multi-select = checkbox column (#91),
					    no comunicar selección solo con color (#37), touch target >=44px (#22).
					    La selección se guarda como rango cuotaInicio..cuotaFin (ver
					    alternarCuotaPromesa); Mora es independiente. */}
					{esPromesa && (
						<div className="space-y-3">
							<h3 className="font-semibold text-base">¿Qué prometió pagar?</h3>
							<p className="text-muted-foreground text-sm">
								Arranca con todo lo atrasado + mora; destilda lo que no aplique.
							</p>

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
														onCheckedChange={() =>
															alternarCuotaPromesa(c.numeroCuota)
														}
													/>
													<div className="flex-1">
														<p className="font-medium text-sm">
															Cuota #{c.numeroCuota}
														</p>
														{c.fechaVencimiento && (
															<p className="text-muted-foreground text-xs">
																Vence{" "}
																{format(
																	new Date(c.fechaVencimiento),
																	"dd MMM yyyy",
																	{
																		locale: es,
																	},
																)}
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
											const cuotaInicio =
												fieldApi.form.getFieldValue("cuotaInicio");
											const cuotaFin = fieldApi.form.getFieldValue("cuotaFin");
											return faltaRangoOMora(cuotaInicio, cuotaFin, value)
												? MENSAJE_RANGO_O_MORA_REQUERIDO
												: undefined;
										},
										onSubmit: ({ value, fieldApi }) => {
											const cuotaInicio =
												fieldApi.form.getFieldValue("cuotaInicio");
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
												field.state.value
													? "bg-primary/5"
													: "hover:bg-muted/50",
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

							{/* CB-025: monto comprometido — se autollena con el total seleccionado
							    (cuota + mora) y queda editable. Informativo: no participa en
							    evaluarPromesa. */}
							<form.Field name="montoComprometido">
								{(field) => (
									<div className="space-y-2">
										<Label htmlFor="montoComprometido">
											Monto comprometido (editable)
										</Label>
										<CurrencyInput
											id="montoComprometido"
											value={field.state.value}
											onChange={(value) => field.handleChange(value)}
										/>
									</div>
								)}
							</form.Field>
						</div>
					)}

					{/* Sección: Próximo Seguimiento — en variante "promesa" la fecha ES
					    la fecha prometida y es obligatoria: no hay checkbox que la
					    haga opcional (requiereSeguimiento arranca en true y no se
					    puede desmarcar). */}
					<div className="space-y-3">
						<h3 className="font-semibold text-base">
							{esPromesa ? "Fecha Prometida" : "Próximo Seguimiento"}
						</h3>

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
									esPromesa && !value
										? "La fecha prometida es obligatoria"
										: undefined,
								onSubmit: ({ value }) =>
									esPromesa && !value
										? "La fecha prometida es obligatoria"
										: undefined,
							}}
						>
							{(field) => (
								<div className="space-y-2">
									<Label>
										{esPromesa
											? "Fecha en la que prometió pagar *"
											: "Fecha de próximo contacto (opcional)"}
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
													const fecha = date
														? fechaAMedianocheGT(date)
														: undefined;
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
										<p className="text-red-500 text-sm">
											{field.state.meta.errors.join(", ")}
										</p>
									)}
								</div>
							)}
						</form.Field>

						{/* CB-029: "alerta programada" — SOLO en promesa. Default D-1 (se
						    setea al elegir la fecha prometida); editable. El job diario
						    avisa al asesor ese día antes de que la promesa venza. */}
						{esPromesa && (
							<form.Field name="fechaAlerta">
								{(field) => (
									<div className="space-y-2">
										<Label>Avisarme el (opcional)</Label>
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
															date <
																new Date(new Date().setHours(0, 0, 0, 0)) ||
															(fechaPromesa != null && date > fechaPromesa)
														);
													}}
													locale={es}
												/>
											</PopoverContent>
										</Popover>
										<p className="text-muted-foreground text-xs">
											Te recordamos ese día para darle seguimiento antes de que
											venza.
										</p>
									</div>
								)}
							</form.Field>
						)}

						{/* CB-025: qué hacer, no cuándo (la fecha de arriba). Texto libre,
						    opcional, en ambas variantes — el AC del ticket aplica a
						    cualquier gestión, no solo a promesas. */}
						<form.Field name="proximoPaso">
							{(field) => (
								<div className="space-y-2">
									<Label htmlFor="proximoPaso">
										¿Cuál es el próximo paso? (opcional)
									</Label>
									<Textarea
										id="proximoPaso"
										placeholder="Ej. Llamar de nuevo, enviar carta notarial, escalar a jurídico..."
										value={field.state.value}
										onChange={(e) => field.handleChange(e.target.value)}
									/>
								</div>
							)}
						</form.Field>
					</div>

					<DialogFooter>
						<DialogClose asChild>
							<Button
								type="button"
								variant="outline"
								disabled={createContactoMutation.isPending}
							>
								Cancelar
							</Button>
						</DialogClose>
						<form.Subscribe
							selector={(state) => [state.canSubmit, state.isSubmitting]}
						>
							{([canSubmit, _isSubmitting]) => (
								<Button
									type="submit"
									disabled={!canSubmit || createContactoMutation.isPending}
								>
									{createContactoMutation.isPending
										? "Guardando..."
										: esEdicion
											? "Guardar Promesa"
											: esPromesa
												? "Registrar Promesa"
												: "Registrar Contacto"}
								</Button>
							)}
						</form.Subscribe>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
