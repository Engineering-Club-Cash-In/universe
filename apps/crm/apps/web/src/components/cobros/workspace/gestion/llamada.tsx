/**
 * Workspace · panel de gestión: pasos de la llamada y de las gestiones
 * entrantes (Figma gp/CallConQuien, gp/CallAcuerdo, gp/EntLlamAcuerdo,
 * gp/EntWAAcuerdo, gp/MsgConQuien).
 *
 *  - `ParticipantesVista`: «¿Con quién está hablando?» / «¿A quién le
 *    escribimos?». Tarjetas radio con el titular y, cuando existan, los
 *    codeudores (F2); debajo, el número si el participante tiene varios.
 *  - `ResultadoGestionVista`: banda de contexto + segmentado de resultados +
 *    el contenido del resultado elegido (opciones de acuerdo o el formulario).
 *  - `OpcionesAcuerdo`: «¿El cliente aceptó un compromiso de pago?».
 *
 * Solo presentación (sin queries).
 */
import { ChevronDown, NotebookPen } from "lucide-react";
import * as React from "react";
import { CrmPill } from "@/components/ds/cards-credito";
import { SegmentedNav } from "@/components/ds/ubicaciones";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
	type AccionGestion,
	BandaContexto,
	CabeceraPaso,
	ListaGestiones,
	PasoGestion,
} from "./piezas";

/* ── Participantes ──────────────────────────────────────────────────────────── */

export type ParticipanteGestion = {
	/** "titular" o "codeudor-<id>". */
	id: string;
	tipo: "titular" | "codeudor";
	nombre: string;
	/** "Titular", "Codeudor 1". */
	rol: string;
	iniciales: string;
	/** `invalido`: dato de relleno («00000000»), no se ofrece como destino. */
	telefonos: Array<{ numero: string; etiqueta: string; invalido?: boolean }>;
	correo?: string | null;
	/** El correo es de relleno («sin-email@example.com»). */
	correoInvalido?: boolean;
};

/** «Dato no válido»: teléfono o correo de relleno, no se usa como destino. */
function ChipDatoInvalido() {
	return (
		<CrmPill
			tone="warning"
			kind="chip"
			dot={false}
			className="px-2 py-0.5 text-[11px]"
		>
			Dato no válido
		</CrmPill>
	);
}

export type ParticipantesVistaProps = {
	titulo: string;
	descripcion?: string;
	participantes: ParticipanteGestion[];
	participanteId: string;
	onParticipante: (id: string) => void;
	/** Número elegido del participante (null = sin teléfono). */
	telefono: string | null;
	onTelefono: (numero: string) => void;
	/** false en el correo: el número no importa. */
	elegirTelefono?: boolean;
	/** Muestra el correo del participante (destinatario de un mensaje). */
	mostrarCorreo?: boolean;
	onAtras?: () => void;
	/** Botón principal del pie («Llamar al titular», «Continuar»). */
	pie: React.ReactNode;
	className?: string;
};

export function ParticipantesVista({
	titulo,
	descripcion,
	participantes,
	participanteId,
	onParticipante,
	telefono,
	onTelefono,
	elegirTelefono = true,
	mostrarCorreo = false,
	onAtras,
	pie,
	className,
}: ParticipantesVistaProps) {
	const elegido = participantes.find((p) => p.id === participanteId);
	const telefonos = elegido?.telefonos ?? [];
	return (
		<PasoGestion
			className={className}
			cabecera={
				<CabeceraPaso
					titulo={titulo}
					descripcion={descripcion}
					onAtras={onAtras}
				/>
			}
			pie={pie}
		>
			<div className="flex flex-col gap-5">
				<RadioGroup
					aria-label="Participante de la gestión"
					value={participanteId}
					onValueChange={onParticipante}
					className="gap-2.5"
				>
					{participantes.map((p) => {
						const activo = p.id === participanteId;
						const principal =
							p.telefonos.find((t) => !t.invalido) ?? p.telefonos[0];
						// Con los mosaicos de números debajo, la tarjeta no repite
						// «+N números» (R2-11).
						const conMosaicos =
							activo && elegirTelefono && p.telefonos.length > 1;
						const extra = conMosaicos ? 0 : p.telefonos.length - 1;
						const idItem = `participante-${p.id}`;
						return (
							<label
								key={p.id}
								htmlFor={idItem}
								className={cn(
									"flex min-w-0 cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 transition-colors duration-150",
									activo
										? "border-brand bg-brand-subtle"
										: "border-line-subtle bg-surface hover:bg-muted/60",
								)}
							>
								<span
									aria-hidden
									className={cn(
										"flex size-10 shrink-0 items-center justify-center rounded-full font-bold text-sm",
										activo
											? "bg-brand text-on-brand"
											: "bg-muted text-fg-secondary",
									)}
								>
									{p.iniciales}
								</span>
								<span className="flex min-w-0 flex-1 flex-col gap-0.5">
									<span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
										<span className="wrap-break-word min-w-0 font-semibold text-[15px] text-fg leading-[1.26]">
											{p.nombre}
										</span>
										<CrmPill
											tone="neutral"
											kind="chip"
											dot={false}
											className="px-2 py-0.5 text-[11px]"
										>
											{p.rol}
										</CrmPill>
									</span>
									<span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
										<span className="break-all text-fg-secondary text-xs leading-snug">
											{principal
												? [
														principal.numero,
														principal.etiqueta,
														extra > 0
															? `+${extra} ${extra === 1 ? "número" : "números"}`
															: null,
													]
														.filter(Boolean)
														.join(" · ")
												: "Sin teléfono registrado"}
										</span>
										{principal?.invalido && !conMosaicos ? (
											<ChipDatoInvalido />
										) : null}
									</span>
									{mostrarCorreo && p.correo ? (
										<span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
											<span className="break-all text-fg-secondary text-xs leading-snug">
												{p.correo}
											</span>
											{p.correoInvalido ? <ChipDatoInvalido /> : null}
										</span>
									) : null}
								</span>
								<RadioGroupItem id={idItem} value={p.id} />
							</label>
						);
					})}
				</RadioGroup>

				{elegirTelefono && telefonos.length > 1 ? (
					<div className="flex flex-col gap-2">
						<span className="font-medium text-fg text-sm">
							Número de la gestión
						</span>
						<RadioGroup
							aria-label="Número de la gestión"
							value={telefono ?? ""}
							onValueChange={onTelefono}
							className="grid @md:grid-cols-2 gap-2"
						>
							{telefonos.map((t) => {
								const idItem = `telefono-${t.numero}`;
								return (
									<label
										key={t.numero}
										htmlFor={idItem}
										className={cn(
											"flex min-w-0 items-center gap-2.5 rounded-lg border px-3 py-2.5 transition-colors",
											t.invalido
												? "cursor-not-allowed border-line-subtle opacity-70"
												: telefono === t.numero
													? "cursor-pointer border-brand bg-brand-subtle"
													: "cursor-pointer border-line-subtle hover:bg-muted/60",
										)}
									>
										<RadioGroupItem
											id={idItem}
											value={t.numero}
											disabled={t.invalido}
										/>
										<span className="flex min-w-0 flex-col gap-0.5">
											<span className="break-all font-medium text-fg text-sm tabular-nums">
												{t.numero}
											</span>
											{t.invalido ? (
												<ChipDatoInvalido />
											) : (
												<span className="text-fg-tertiary text-xs">
													{t.etiqueta}
												</span>
											)}
										</span>
									</label>
								);
							})}
						</RadioGroup>
					</div>
				) : null}
			</div>
		</PasoGestion>
	);
}

/* ── Resultado ──────────────────────────────────────────────────────────────── */

export type ResultadoGestion = "acuerdo" | "no_acuerdo" | "no_contacto";

const RESULTADOS: Array<{ value: ResultadoGestion; label: string }> = [
	{ value: "acuerdo", label: "Se llegó a un acuerdo" },
	{ value: "no_acuerdo", label: "No hubo acuerdo" },
	{ value: "no_contacto", label: "No hubo contacto" },
];

export type ResultadoGestionVistaProps = {
	/** Texto de la banda: «Llamada saliente · María José · 5555-1234». */
	banda: React.ReactNode;
	tonoBanda?: "success" | "brand" | "info";
	/** «Cambiar participante»: vuelve al paso anterior. */
	onCambiarParticipante?: () => void;
	/**
	 * «‹ Atrás · Resultado de la gestión» arriba de la banda: la salida clara
	 * del paso (sin sub-paso abierto; con sub-paso, su propio «Atrás»).
	 */
	onAtras?: () => void;
	resultados: ResultadoGestion[];
	resultado: ResultadoGestion;
	onResultado: (r: ResultadoGestion) => void;
	/** Sub-paso dentro del resultado («‹ Atrás · Registrar promesa de pago»). */
	subpaso?: { titulo: string; onAtras: () => void } | null;
	/** true: el contenido es un formulario embebido (trae su scroll y su pie). */
	formulario?: boolean;
	children: React.ReactNode;
	className?: string;
};

export function ResultadoGestionVista({
	banda,
	tonoBanda = "success",
	onCambiarParticipante,
	onAtras,
	resultados,
	resultado,
	onResultado,
	subpaso,
	formulario = false,
	children,
	className,
}: ResultadoGestionVistaProps) {
	const opciones = RESULTADOS.filter((r) => resultados.includes(r.value));
	return (
		<PasoGestion
			className={className}
			formulario={formulario}
			cabecera={
				<div className="flex flex-col gap-3 px-5 pt-4 pb-3">
					{onAtras && !subpaso ? (
						<CabeceraPaso
							className="px-0 pt-0 pb-0"
							titulo="Resultado de la gestión"
							onAtras={onAtras}
						/>
					) : null}
					<BandaContexto
						tono={tonoBanda}
						accion={
							onCambiarParticipante ? (
								<button
									type="button"
									onClick={onCambiarParticipante}
									className="cursor-pointer rounded font-semibold text-[13px] underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
								>
									Cambiar participante
								</button>
							) : null
						}
					>
						{banda}
					</BandaContexto>
					<SegmentedNav
						aria-label="Resultado de la gestión"
						value={resultado}
						onValueChange={(v) => onResultado(v as ResultadoGestion)}
						className={cn(
							"grid w-full",
							opciones.length === 3 ? "grid-cols-3" : "grid-cols-2",
							// Los textos largos parten en dos líneas en vez de desbordar.
							"[&>button]:h-auto [&>button]:min-h-8.5 [&>button]:whitespace-normal [&>button]:px-2 [&>button]:py-1.5 [&>button]:text-center [&>button]:text-[13px]",
						)}
						opciones={opciones.map((o) => ({
							value: o.value,
							label:
								o.value === "no_contacto" ? (
									<span
										className={
											resultado === o.value
												? "text-danger-text"
												: "text-danger-text/80"
										}
									>
										{o.label}
									</span>
								) : (
									o.label
								),
						}))}
					/>
					{subpaso ? (
						<CabeceraPaso
							className="px-0 pt-1 pb-0"
							titulo={subpaso.titulo}
							onAtras={subpaso.onAtras}
						/>
					) : null}
				</div>
			}
		>
			{children}
		</PasoGestion>
	);
}

/** «¿El cliente aceptó un compromiso de pago?» con sus opciones. */
export function OpcionesAcuerdo({
	opciones,
	secundaria,
	notas,
	onNotasChange,
}: {
	opciones: AccionGestion[];
	/** «Solicitar rebaja de mora» (Pronto). */
	secundaria?: AccionGestion | null;
	/** La nota compartida entre los 3 resultados (R2-13). */
	notas?: string;
	onNotasChange?: (v: string) => void;
}) {
	return (
		<div className="flex flex-col gap-3">
			<div className="flex flex-col gap-0.5">
				<h3 className="font-semibold text-base text-fg leading-[1.26]">
					¿El cliente aceptó un compromiso de pago?
				</h3>
				<p className="text-fg-secondary text-sm">
					Seleccione la opción según el resultado de la conversación.
				</p>
			</div>
			<ListaGestiones acciones={opciones} />
			{secundaria ? <ListaGestiones acciones={[secundaria]} /> : null}
			{onNotasChange ? (
				<NotasCompartidas valor={notas ?? ""} onChange={onNotasChange} />
			) : null}
		</div>
	);
}

/**
 * «Notas de la gestión · disponible en los 3 resultados» (Figma gp/CallAcuerdo):
 * colapsable con la nota que comparten los resultados. Los formularios
 * dibujan su propio campo con el mismo valor.
 */
export function NotasCompartidas({
	valor,
	onChange,
}: {
	valor: string;
	onChange: (v: string) => void;
}) {
	const [abierta, setAbierta] = React.useState(valor.trim() !== "");
	const id = React.useId();
	return (
		<section className="flex flex-col gap-2.5 rounded-xl border border-line-subtle bg-surface px-3.5 py-3">
			<button
				type="button"
				aria-expanded={abierta}
				aria-controls={id}
				onClick={() => setAbierta((v) => !v)}
				className="flex w-full min-w-0 cursor-pointer items-center gap-3 rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
			>
				<span
					aria-hidden
					className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand-subtle text-brand [&_svg]:size-4"
				>
					<NotebookPen />
				</span>
				<span className="flex min-w-0 flex-1 flex-col gap-0.5">
					<span className="font-semibold text-fg text-sm leading-[1.26]">
						Notas de la gestión
					</span>
					<span className="wrap-break-word text-fg-secondary text-xs leading-snug">
						Una sola nota · disponible en los 3 resultados
					</span>
				</span>
				<span className="flex shrink-0 items-center gap-1 font-semibold text-[13px] text-brand">
					{abierta ? "Cerrar" : "Abrir"}
					<ChevronDown
						aria-hidden
						className={cn(
							"size-4 transition-transform",
							abierta && "rotate-180",
						)}
					/>
				</span>
			</button>
			{abierta ? (
				<Textarea
					id={id}
					aria-label="Notas de la gestión"
					value={valor}
					onChange={(e) => onChange(e.target.value)}
					placeholder="Lo que conversó con el cliente. Se guarda con el resultado que registre."
					rows={3}
				/>
			) : null}
		</section>
	);
}
