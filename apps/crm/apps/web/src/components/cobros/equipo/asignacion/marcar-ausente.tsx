import { useMutation, useQuery } from "@tanstack/react-query";
import { Info, TriangleAlert } from "lucide-react";
import { type ReactNode, useEffect, useId, useState } from "react";
import { CampoFecha } from "@/components/cobros/campo-fecha";
import { hoyGT } from "@/components/cobros/coberturas-panel";
import { CrmAvatar, inicialesDe } from "@/components/ds/cards-credito";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogTitle,
	dialogTitleClassName,
} from "@/components/ui/dialog";
import { FieldMessage } from "@/components/ui/field-message";
import { Label } from "@/components/ui/label";
import { PopoverPortalContext } from "@/components/ui/popover";
import { RadioGroup } from "@/components/ui/radio-group";
import { cn } from "@/lib/utils";
import { client, orpc, orpcAparte, queryClient } from "@/utils/orpc";
import { etiquetaNivel, fechaCorta, nivelAsesor } from "../estado-asesor";
import {
	ExitoModal,
	Flecha,
	ListaReparto,
	NotaModal,
	plural,
	TarjetaOpcion,
} from "./piezas-modal";
import {
	type AsesorTraslado,
	EstadoConsulta,
	SelectorAsesor,
} from "./selector-asesor";

/**
 * «Marcar ausente» — Figma «09 · Disponibilidad y redistribución»: «Marcar
 * ausente» (3359:4251 Vacaciones y 3367:4244 Permiso/Incidente),
 * «Redistribución de cartera» (3360:4254) y «Cartera redistribuida»
 * (3360:4312). Tres pasos:
 *
 *   1. formulario → asesor, motivo (Vacaciones · Permiso · Incidente) y UNA
 *      pregunta: «¿Qué pasa con su cartera mientras no está?».
 *        - «Un compañero atiende su agenda» = cobertura con suplente
 *          (`crearCobertura`, CB-114): fechas cerradas (días completos, desde
 *          hoy), el suplente debe atender todos los buckets del asesor y ve sus
 *          tareas de agenda; la cartera NO cambia de dueño. Se registra
 *          directo desde este paso.
 *        - «Repartir su cartera entre el equipo» = ausencia indefinida (M5):
 *          empieza al confirmar, sin fecha de regreso; la cartera se reparte
 *          según la capacidad de cada asesor (`previsualizarRepartoAusencia`) y
 *          el asesor sale del pool hasta que se le reactive. «Incidente» solo
 *          existe en este modo.
 *   2. revision (solo al repartir) → la lista «antes → después +N»; se
 *      confirma con `marcarAusenteIndefinido` (vista previa de 10 minutos).
 *   3. exito → «Cartera redistribuida» o «Ausencia registrada».
 *
 * Idempotencia: `crypto.randomUUID()` por solicitud; cualquier cambio del
 * formulario genera otra clave y descarta el reparto calculado.
 */

export type MotivoAusencia = "vacaciones" | "permiso" | "incidente";
export type ModoAusencia = "suplente" | "equipo";

/** Reparto previsualizado, ya resumido por asesor receptor. */
export type RepartoAusencia = {
	/** Créditos que se reparten. */
	cuentas: number;
	/** Créditos sin bucket (cancelados, caídos, en convenio…) que se quedan con el asesor. */
	conservadas: number;
	/** Créditos sin un destino válido (ningún otro asesor atiende su bucket): no se puede confirmar. */
	bloqueadas: number;
	/** Hasta cuándo vale la previsualización (ISO). */
	venceEn: string;
	receptores: {
		asesorId: number;
		nombre: string;
		antes: number;
		despues: number;
	}[];
};

export type MarcarAusenteVistaProps = {
	paso: "formulario" | "revision" | "exito";
	cargando: boolean;
	errorCarga: boolean;
	onReintentar: () => void;
	/** Asesores que pueden ausentarse (activos, con usuario del CRM habilitado). */
	titulares: AsesorTraslado[];
	titular: string;
	onTitular: (asesorId: string) => void;
	/** Datos del asesor elegido (encabezado del Figma). */
	titularInfo: {
		nombre: string;
		buckets: number[];
		creditos: number | null;
	} | null;
	/** El asesor pedido no puede ausentarse (sin usuario del CRM habilitado). */
	avisoTitular: string | null;
	suplente: string;
	onSuplente: (asesorId: string) => void;
	suplentes: AsesorTraslado[];
	nombreSuplente: string | null;
	motivo: MotivoAusencia;
	onMotivo: (motivo: MotivoAusencia) => void;
	/** Qué pasa con la cartera: un suplente atiende la agenda o se reparte al equipo. */
	modo: ModoAusencia;
	onModo: (modo: ModoAusencia) => void;
	/** Reparto previsualizado (paso «revision»). */
	reparto: RepartoAusencia | null;
	/** La previsualización ya venció: hay que recalcular el reparto. */
	previewVencida: boolean;
	onRecalcular: () => void;
	desde: string;
	hasta: string;
	onDesde: (fecha: string) => void;
	onHasta: (fecha: string) => void;
	hoy: string;
	/** Validación del formulario (null = se puede continuar). */
	error: string | null;
	errorServidor: string | null;
	pendiente: boolean;
	onCancelar: () => void;
	/** Paso 1: registra la cobertura (suplente) o calcula el reparto (equipo). */
	onContinuar: () => void;
	onVolver: () => void;
	onConfirmar: () => void;
	/** Reparto confirmado (paso «exito» del modo equipo). */
	resultado: { cuentas: number; receptores: number } | null;
	onListo: () => void;
};

const MOTIVOS: { valor: MotivoAusencia; etiqueta: string }[] = [
	{ valor: "vacaciones", etiqueta: "Vacaciones" },
	{ valor: "permiso", etiqueta: "Permiso" },
	{ valor: "incidente", etiqueta: "Incidente" },
];

const MOTIVO_TEXTO: Record<MotivoAusencia, string> = {
	vacaciones: "vacaciones",
	permiso: "permiso",
	incidente: "un incidente",
};

function Seccion({
	children,
	htmlFor,
}: {
	children: ReactNode;
	htmlFor?: string;
}) {
	return htmlFor ? (
		<Label htmlFor={htmlFor} className="font-semibold text-[13px] text-fg">
			<span>{children}</span>
		</Label>
	) : (
		<p className="font-semibold text-[13px] text-fg leading-[1.26]">
			{children}
		</p>
	);
}

/* ── Paso 1 · Motivo, fechas y qué pasa con la cartera ────────────────── */

function PasoAusencia(p: MarcarAusenteVistaProps) {
	const uid = useId();
	const id = (sufijo: string) => `ausente${uid}${sufijo}`;
	const equipo = p.modo === "equipo";
	const incidente = p.motivo === "incidente";
	const nombre = p.titularInfo?.nombre ?? null;
	const creditos = p.titularInfo?.creditos ?? null;
	const cartera =
		creditos !== null
			? `Su cartera de ${plural(creditos, "crédito", "créditos")}`
			: "Su cartera";

	return (
		<>
			{/* Asesor que se ausenta */}
			{p.titularInfo ? (
				<div className="flex items-center gap-3">
					<CrmAvatar iniciales={inicialesDe(p.titularInfo.nombre)} />
					<div className="min-w-0 flex-1">
						<p className="truncate font-semibold text-fg text-sm">
							{p.titularInfo.nombre}
						</p>
						<p className="text-fg-secondary text-xs">
							{etiquetaNivel(nivelAsesor(p.titularInfo.buckets))}
							{creditos !== null
								? ` · ${plural(creditos, "crédito asignado", "créditos asignados")}`
								: ""}
						</p>
					</div>
					<Button
						variant="text"
						size="sm"
						disabled={p.pendiente}
						onClick={() => p.onTitular("")}
					>
						Cambiar
					</Button>
				</div>
			) : (
				<div className="flex flex-col gap-2">
					<Seccion htmlFor={id("-titular")}>Asesor que se ausenta</Seccion>
					<SelectorAsesor
						id={id("-titular")}
						value={p.titular}
						onChange={p.onTitular}
						asesores={p.titulares}
					/>
				</div>
			)}
			{p.avisoTitular ? (
				<FieldMessage role="alert" variant="warning">
					{p.avisoTitular}
				</FieldMessage>
			) : null}

			{/* Motivo */}
			<fieldset className="flex flex-col gap-2" disabled={p.pendiente}>
				<legend className="mb-2 font-semibold text-[13px] text-fg leading-[1.26]">
					Motivo
				</legend>
				<div className="grid grid-cols-3 gap-2">
					{MOTIVOS.map((m) => (
						<Button
							key={m.valor}
							type="button"
							variant={p.motivo === m.valor ? "default" : "outline"}
							aria-pressed={p.motivo === m.valor}
							className="px-2"
							onClick={() => p.onMotivo(m.valor)}
						>
							{m.etiqueta}
						</Button>
					))}
				</div>
			</fieldset>

			{/* La única pregunta sobre la cartera */}
			<fieldset className="flex flex-col gap-2" disabled={p.pendiente}>
				<legend className="mb-2 font-semibold text-[13px] text-fg leading-[1.26]">
					¿Qué pasa con su cartera mientras no está?
				</legend>
				<RadioGroup
					value={p.modo}
					onValueChange={(v) => p.onModo(v as ModoAusencia)}
					aria-label="Qué pasa con su cartera mientras no está"
					className="gap-2"
				>
					<TarjetaOpcion
						id={id("-modo-suplente")}
						valor="suplente"
						titulo="Un compañero atiende su agenda"
						detalle="La cartera sigue siendo suya. Usted fija las fechas y, al terminar, la agenda vuelve sola."
						nota={
							incidente
								? "No aplica a un incidente: no tiene fecha de regreso."
								: undefined
						}
						disabled={incidente}
						activo={!equipo}
					/>
					<TarjetaOpcion
						id={id("-modo-equipo")}
						valor="equipo"
						titulo="Repartir su cartera entre el equipo hasta que regrese"
						detalle="Se reparte según la capacidad de cada asesor y no recibe créditos nuevos hasta que usted lo reactive."
						activo={equipo}
					/>
				</RadioGroup>
			</fieldset>

			{/* Fechas, hora y suplente según la opción */}
			{equipo ? (
				<NotaModal
					tono="warning"
					icono={<TriangleAlert />}
					titulo="Desde hoy · Fin: indefinido"
				>
					La ausencia empieza al confirmar. Cuando regrese, use «Reactivar» en
					su tarjeta y se le devuelve su cartera.
				</NotaModal>
			) : (
				<>
					<div className="grid gap-3 sm:grid-cols-2">
						<div className="flex flex-col gap-1.5">
							<Label htmlFor={id("-desde")}>Desde</Label>
							<CampoFecha
								id={id("-desde")}
								min={p.hoy}
								value={p.desde}
								disabled={p.pendiente}
								onChange={p.onDesde}
							/>
						</div>
						<div className="flex flex-col gap-1.5">
							<Label htmlFor={id("-hasta")}>Hasta (incluido)</Label>
							<CampoFecha
								id={id("-hasta")}
								min={p.desde}
								value={p.hasta}
								disabled={p.pendiente}
								onChange={p.onHasta}
							/>
						</div>
					</div>
					<div className="flex flex-col gap-2">
						<Seccion htmlFor={id("-suplente")}>
							Compañero que atiende su agenda
						</Seccion>
						<SelectorAsesor
							id={id("-suplente")}
							value={p.suplente}
							onChange={p.onSuplente}
							asesores={p.suplentes}
							disabled={!p.titularInfo || p.pendiente}
						/>
						{p.titularInfo && !p.suplentes.length ? (
							<FieldMessage variant="warning">
								Ningún compañero activo atiende todos sus buckets. Puede
								repartir su cartera entre el equipo.
							</FieldMessage>
						) : (
							<p className="text-fg-tertiary text-xs leading-[1.35]">
								Solo aparecen quienes atienden todos sus buckets.
							</p>
						)}
					</div>
				</>
			)}

			{/* Qué va a pasar (caja azul del Figma) */}
			<NotaModal tono="info" icono={<Info />}>
				{equipo ? (
					<>
						{cartera} se repartirá entre el equipo hasta que usted lo reactive.
						Antes de confirmar verá cómo queda el reparto.
					</>
				) : nombre && p.nombreSuplente && p.desde && p.hasta ? (
					<>
						Del {fechaCorta(p.desde)} al {fechaCorta(p.hasta)},{" "}
						{p.nombreSuplente} verá las tareas de agenda de {nombre}. {cartera}{" "}
						no cambia de dueño.
					</>
				) : (
					<>
						Durante la ausencia, el compañero ve sus tareas de agenda. {cartera}{" "}
						no cambia de dueño. Son días completos, en horario de Guatemala.
					</>
				)}
			</NotaModal>

			{p.error ? <FieldMessage variant="help">{p.error}</FieldMessage> : null}
			{p.errorServidor ? (
				<FieldMessage role="alert">{p.errorServidor}</FieldMessage>
			) : null}

			<div className="grid grid-cols-2 gap-3">
				<Button
					variant="secondary"
					disabled={p.pendiente}
					onClick={p.onCancelar}
				>
					Cancelar
				</Button>
				<Button
					loading={p.pendiente}
					disabled={!!p.error || p.pendiente}
					onClick={p.onContinuar}
				>
					{p.pendiente
						? equipo
							? "Calculando reparto…"
							: "Registrando…"
						: equipo
							? "Continuar"
							: "Registrar ausencia"}
				</Button>
			</div>
		</>
	);
}

/* ── Paso 2 · Redistribución de cartera (solo al repartir) ────────────── */

function PasoReparto(
	p: MarcarAusenteVistaProps & { reparto: RepartoAusencia },
) {
	const { reparto } = p;
	const nombre = p.titularInfo?.nombre ?? "el asesor";
	const vencida = p.previewVencida;
	const bloqueada = !vencida && reparto.bloqueadas > 0;
	return (
		<>
			<p className="-mt-3 text-fg-secondary text-sm leading-[1.3]">
				Cartera de {nombre} · {plural(reparto.cuentas, "crédito", "créditos")}{" "}
				<Flecha />
				<span className="sr-only">entre</span>{" "}
				{plural(reparto.receptores.length, "asesor", "asesores")}
			</p>

			<NotaModal tono="info" icono={<Info />}>
				Se reparte según la capacidad de cada asesor. Si hace falta, después
				puede reasignar créditos a mano.
			</NotaModal>

			{reparto.bloqueadas > 0 ? (
				<NotaModal
					tono="danger"
					role="alert"
					icono={<TriangleAlert />}
					titulo={`No se puede confirmar: ${plural(reparto.bloqueadas, "crédito no tiene quién lo reciba", "créditos no tienen quién los reciba")}`}
				>
					Ningún otro asesor activo atiende su bucket. Agregue a alguien a ese
					bucket y vuelva a calcular el reparto.
				</NotaModal>
			) : null}

			{reparto.receptores.length ? (
				<ListaReparto
					filas={reparto.receptores.map((r) => ({
						clave: r.asesorId,
						nombre: r.nombre,
						antes: r.antes,
						despues: r.despues,
					}))}
				/>
			) : (
				<p className="text-fg-secondary text-sm leading-[1.4]">
					No tiene créditos en cobranza para repartir: solo quedará ausente y
					dejará de recibir créditos nuevos.
				</p>
			)}

			{reparto.conservadas > 0 ? (
				<NotaModal tono="neutral">
					{plural(
						reparto.conservadas,
						"crédito sin bucket",
						"créditos sin bucket",
					)}{" "}
					(cancelados, caídos o en convenio){" "}
					{reparto.conservadas === 1 ? "se queda" : "se quedan"} a nombre de{" "}
					{nombre}: no entran en el reparto.
				</NotaModal>
			) : null}

			{vencida ? (
				<FieldMessage role="alert" variant="warning">
					Este reparto se calculó hace más de 10 minutos y ya no vale.
					Recalcúlelo para confirmar la ausencia.
				</FieldMessage>
			) : p.errorServidor ? (
				<FieldMessage role="alert">{p.errorServidor}</FieldMessage>
			) : null}

			<div className="grid grid-cols-2 gap-3">
				<Button variant="secondary" disabled={p.pendiente} onClick={p.onVolver}>
					Atrás
				</Button>
				<Button
					loading={p.pendiente}
					disabled={bloqueada}
					onClick={vencida ? p.onRecalcular : p.onConfirmar}
				>
					{p.pendiente
						? vencida
							? "Calculando…"
							: "Confirmando…"
						: vencida
							? "Recalcular reparto"
							: p.errorServidor
								? "Reintentar"
								: "Confirmar redistribución"}
				</Button>
			</div>
		</>
	);
}

/* ── Paso 3 · Éxito ───────────────────────────────────────────────────── */

function PasoExito(p: MarcarAusenteVistaProps) {
	const nombre = p.titularInfo?.nombre ?? "El asesor";
	if (p.modo === "equipo") {
		const r = p.resultado;
		return (
			<ExitoModal
				titulo="Cartera redistribuida"
				onListo={p.onListo}
				nota="Cuando regrese, use «Reactivar» en su tarjeta para devolverle su cartera."
			>
				{nombre} quedó ausente por {MOTIVO_TEXTO[p.motivo]} desde hoy, sin fecha
				de regreso.{" "}
				{r && r.cuentas > 0
					? `Sus ${plural(r.cuentas, "crédito se repartió", "créditos se repartieron")} entre ${plural(r.receptores, "asesor", "asesores")}.`
					: "No tenía créditos en cobranza para repartir y ya no recibe créditos nuevos."}
			</ExitoModal>
		);
	}
	return (
		<ExitoModal
			titulo="Ausencia registrada"
			onListo={p.onListo}
			nota="Queda en el historial de coberturas. Si regresa antes, use «Reactivar» en su tarjeta."
		>
			{nombre} estará ausente por {MOTIVO_TEXTO[p.motivo]} del{" "}
			{fechaCorta(p.desde)} al {fechaCorta(p.hasta)}.{" "}
			{p.nombreSuplente ?? "El suplente"} atiende su agenda; sus créditos siguen
			siendo suyos.
		</ExitoModal>
	);
}

/* ── Vista ──────────────────────────────────────────────────────────── */

/** Contenido del modal (sin el Dialog: así el showcase lo pinta en línea). */
export function MarcarAusenteVista(p: MarcarAusenteVistaProps) {
	if (p.paso === "exito") return <PasoExito {...p} />;
	const reparto =
		p.paso === "revision" && p.modo === "equipo" ? p.reparto : null;
	return (
		<div className="flex min-w-0 flex-col gap-5">
			<h2 className={cn(dialogTitleClassName, "pr-10")}>
				{reparto ? "Redistribución de cartera" : "Marcar ausente"}
			</h2>
			{p.cargando || p.errorCarga ? (
				<EstadoConsulta error={p.errorCarga} retry={p.onReintentar} />
			) : reparto ? (
				<PasoReparto {...p} reparto={reparto} />
			) : (
				<PasoAusencia {...p} />
			)}
		</div>
	);
}

/**
 * Contenedor del modal: catálogo `getAsesoresTraslados`, créditos del asesor
 * (`getCargaPorAsesorBucket`), ausencias vigentes (`listarAusencias`),
 * `crearCobertura` y el reparto de M5. Mismas validaciones de siempre.
 */
export function MarcarAusenteDialog({
	abierto,
	asesorInicial,
	onCerrar,
	onRegistrada,
}: {
	abierto: boolean;
	/** `asesor_id` de cartera ya elegido (`?accion=ausente&asesor=`). */
	asesorInicial?: number;
	onCerrar: () => void;
	/** Rango de la cobertura recién registrada (para mostrarla en el historial). */
	onRegistrada: (rango: { desde: string; hasta: string }) => void;
}) {
	// El calendario de las fechas se monta en la caja del modal (no corrido ni
	// cortado por el scroll; ver PopoverPortalContext).
	const [caja, setCaja] = useState<HTMLDivElement | null>(null);
	return (
		<Dialog open={abierto} onOpenChange={(v) => !v && onCerrar()}>
			<DialogContent
				ref={setCaja}
				className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-120"
			>
				<DialogTitle className="sr-only">Marcar ausente</DialogTitle>
				<DialogDescription className="sr-only">
					Registre la ausencia de un asesor y qué pasa con su cartera mientras
					no está.
				</DialogDescription>
				<PopoverPortalContext.Provider value={caja}>
					{abierto ? (
						<FormularioAusencia
							// Reinicia el formulario si cambia el asesor pedido por la URL.
							key={asesorInicial ?? "sin-asesor"}
							asesorInicial={asesorInicial}
							onCerrar={onCerrar}
							onRegistrada={onRegistrada}
						/>
					) : null}
				</PopoverPortalContext.Provider>
			</DialogContent>
		</Dialog>
	);
}

function FormularioAusencia({
	asesorInicial,
	onCerrar,
	onRegistrada,
}: {
	asesorInicial?: number;
	onCerrar: () => void;
	onRegistrada: (rango: { desde: string; hasta: string }) => void;
}) {
	const [titular, setTitular] = useState(
		asesorInicial ? String(asesorInicial) : "",
	);
	const [suplente, setSuplente] = useState("");
	const [motivo, setMotivo] = useState<MotivoAusencia>("vacaciones");
	const [desde, setDesde] = useState(hoyGT);
	const [hasta, setHasta] = useState(hoyGT);
	const [id, setId] = useState(() => crypto.randomUUID());
	const [paso, setPaso] =
		useState<MarcarAusenteVistaProps["paso"]>("formulario");
	const [modo, setModo] = useState<ModoAusencia>("suplente");
	const [preview, setPreview] = useState<{
		previewId: string;
		reparto: RepartoAusencia;
	} | null>(null);
	const [vencida, setVencida] = useState(false);
	const [resultado, setResultado] = useState<{
		cuentas: number;
		receptores: number;
	} | null>(null);

	const asesores = useQuery(orpc.getAsesoresTraslados.queryOptions());
	// Quien ya tiene una ausencia indefinida no se puede marcar de nuevo.
	const ausencias = useQuery(
		orpcAparte.listarAusencias.queryOptions({ input: { soloVigentes: true } }),
	);
	const ausentes = new Set((ausencias.data ?? []).map((x) => x.asesorId));
	const titularNumero = /^\d+$/.test(titular) ? Number(titular) : null;
	const cargaTitular = useQuery({
		...orpc.getCargaPorAsesorBucket.queryOptions({
			input: { asesorId: titularNumero ?? undefined },
		}),
		enabled: titularNumero !== null,
	});

	const disponibles = (asesores.data ?? []).filter(
		(a) =>
			a.activo && a.usuarioHabilitado && a.userId && !ausentes.has(a.asesor_id),
	);
	const origen = disponibles.find((a) => String(a.asesor_id) === titular);
	const receptor = disponibles.find((a) => String(a.asesor_id) === suplente);
	const receptores = disponibles.filter(
		(a) =>
			a.asesor_id !== origen?.asesor_id &&
			!!origen?.buckets.length &&
			origen.buckets.every((b) => a.buckets.includes(b)),
	);
	const pedido = asesorInicial
		? asesores.data?.find((a) => a.asesor_id === asesorInicial)
		: undefined;
	const avisoTitular =
		pedido && titular === String(asesorInicial) && !origen
			? ausentes.has(pedido.asesor_id)
				? `${pedido.nombre} ya está ausente: reactívelo antes de volver a marcarlo.`
				: `${pedido.nombre} no está activo o no tiene un usuario del CRM habilitado: no se puede registrar su ausencia.`
			: null;

	const error = !origen
		? "Seleccione al asesor que se ausenta."
		: modo === "equipo"
			? null
			: !receptor
				? "Seleccione al compañero que atenderá su agenda."
				: !desde || !hasta || desde > hasta
					? "Indique un rango de fechas válido."
					: desde < hoyGT()
						? "La ausencia debe comenzar hoy o después."
						: null;

	const previsualizar = useMutation({
		...orpcAparte.previsualizarRepartoAusencia.mutationOptions(),
		retry: false,
		onSuccess: (data) => {
			// Un asesor receptor aparece una vez por bucket: se suma por asesor.
			const porAsesor = new Map<
				number,
				{ asesorId: number; nombre: string; antes: number; despues: number }
			>();
			for (const c of data.carga) {
				const fila = porAsesor.get(c.asesorId) ?? {
					asesorId: c.asesorId,
					nombre: c.nombre,
					antes: 0,
					despues: 0,
				};
				fila.antes += c.antes;
				fila.despues += c.despues;
				porAsesor.set(c.asesorId, fila);
			}
			setPreview({
				previewId: data.previewId,
				reparto: {
					cuentas: data.asignaciones.length,
					conservadas: data.excluidos.length,
					bloqueadas: data.bloqueos.length,
					venceEn: data.venceEn,
					receptores: [...porAsesor.values()]
						.filter((r) => r.despues > r.antes)
						.sort((a, b) => b.despues - b.antes - (a.despues - a.antes)),
				},
			});
			setPaso("revision");
		},
	});
	// La previsualización vale 10 minutos: pasado ese instante (o si el servidor
	// responde que venció) ya no se ofrece confirmarla sino recalcular el reparto.
	const venceEn = preview?.reparto.venceEn;
	useEffect(() => {
		setVencida(false);
		if (!venceEn) return;
		const falta = new Date(venceEn).getTime() - Date.now();
		if (falta <= 0) {
			setVencida(true);
			return;
		}
		const t = setTimeout(() => setVencida(true), falta);
		return () => clearTimeout(t);
	}, [venceEn]);
	const confirmarEquipo = useMutation({
		...orpcAparte.marcarAusenteIndefinido.mutationOptions(),
		retry: false,
		onError: (e) => {
			if (/venci/i.test(e.message)) setVencida(true);
		},
		onSuccess: (data) => {
			void queryClient.invalidateQueries({
				queryKey: orpcAparte.listarAusencias.key(),
			});
			void queryClient.invalidateQueries({
				queryKey: orpc.getCargaPorAsesorBucket.key(),
			});
			// Cartera le apaga el pool al repartirle la cartera.
			void queryClient.invalidateQueries({
				queryKey: orpc.getAsesoresTraslados.key(),
			});
			setResultado({
				cuentas: data?.cuentasRepartidas ?? preview?.reparto.cuentas ?? 0,
				receptores: preview?.reparto.receptores.length ?? 0,
			});
			// Sin `onRegistrada`: esa señal lleva al historial de coberturas, donde
			// una ausencia indefinida no aparece.
			setPaso("exito");
		},
		// Un fallo (incluso ambiguo: timeout o 5xx) deja la revisión abierta: el
		// reintento reenvía la MISMA confirmación (mismo `id` y `previewId`), que es
		// la que el servidor sabe reconciliar. Una previsualización nueva la
		// rechazaría porque la ausencia ya quedó pendiente.
	});

	const crear = useMutation({
		retry: false,
		mutationFn: () => {
			if (!origen?.userId || !receptor?.userId)
				throw new Error("Seleccione al asesor y al compañero que lo cubre.");
			if (motivo === "incidente")
				throw new Error("El incidente se registra repartiendo la cartera.");
			return client.crearCobertura({
				id,
				titularId: origen.userId,
				suplenteId: receptor.userId,
				motivo,
				desde,
				hasta,
			});
		},
		onSuccess: () => {
			void queryClient.invalidateQueries({
				queryKey: orpc.listarCoberturas.key(),
			});
			onRegistrada({ desde, hasta });
			setPaso("exito");
		},
		onError: () => setPaso("formulario"),
	});
	// Cualquier cambio invalida lo calculado: nueva clave de idempotencia.
	const cambiar = () => {
		setId(crypto.randomUUID());
		crear.reset();
		previsualizar.reset();
		confirmarEquipo.reset();
		setPreview(null);
	};

	const creditos = cargaTitular.data
		? (cargaTitular.data.porAsesor
				.find((a) => a.asesor_id === titularNumero)
				?.porBucket.reduce((t, d) => t + d.cuentas, 0) ?? 0)
		: null;

	return (
		<MarcarAusenteVista
			paso={paso}
			cargando={asesores.isPending || ausencias.isPending}
			// Sin las ausencias no se sabe a quién ya no se puede marcar: es error.
			errorCarga={asesores.isError || ausencias.isError}
			onReintentar={() => {
				void asesores.refetch();
				void ausencias.refetch();
			}}
			titulares={disponibles}
			titular={titular}
			onTitular={(v) => {
				setTitular(v);
				setSuplente("");
				cambiar();
			}}
			titularInfo={
				origen
					? { nombre: origen.nombre, buckets: origen.buckets, creditos }
					: null
			}
			avisoTitular={avisoTitular}
			suplente={suplente}
			onSuplente={(v) => {
				setSuplente(v);
				cambiar();
			}}
			suplentes={receptores}
			nombreSuplente={receptor?.nombre ?? null}
			motivo={motivo}
			onMotivo={(m) => {
				setMotivo(m);
				// «Incidente» no tiene fechas ni suplente: solo se reparte al equipo.
				if (m === "incidente") setModo("equipo");
				cambiar();
			}}
			modo={modo}
			onModo={(m) => {
				setModo(m);
				cambiar();
			}}
			reparto={preview?.reparto ?? null}
			previewVencida={vencida}
			onRecalcular={() => {
				// Reparto nuevo = confirmación nueva (otro `id`).
				setId(crypto.randomUUID());
				confirmarEquipo.reset();
				if (origen)
					previsualizar.mutate({ asesorId: origen.asesor_id, motivo });
			}}
			desde={desde}
			hasta={hasta}
			onDesde={(v) => {
				setDesde(v);
				cambiar();
			}}
			onHasta={(v) => {
				setHasta(v);
				cambiar();
			}}
			hoy={hoyGT()}
			error={error}
			errorServidor={
				(crear.error ?? previsualizar.error ?? confirmarEquipo.error)
					?.message ?? null
			}
			pendiente={
				crear.isPending || previsualizar.isPending || confirmarEquipo.isPending
			}
			onCancelar={onCerrar}
			onContinuar={() => {
				// Con suplente se registra directo: el resumen azul ya dice qué pasa.
				if (modo !== "equipo") return crear.mutate();
				if (origen)
					previsualizar.mutate({ asesorId: origen.asesor_id, motivo });
			}}
			onVolver={() => {
				// Volver invalida el reparto (puede vencer): se pide uno nuevo.
				cambiar();
				setPaso("formulario");
			}}
			onConfirmar={() => {
				if (origen && preview)
					confirmarEquipo.mutate({
						id,
						asesorId: origen.asesor_id,
						motivo,
						previewId: preview.previewId,
					});
			}}
			resultado={resultado}
			onListo={onCerrar}
		/>
	);
}
