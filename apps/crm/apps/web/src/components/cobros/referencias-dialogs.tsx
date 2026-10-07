/**
 * CB-036 · Modales de la pestaña Referencias: registrar una gestión (con la
 * información nueva que dé la referencia), agregar un teléfono a una
 * referencia, alta/edición de las referencias propias de cobros y registrar
 * un dato nuevo del cliente sin gestión de por medio.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { MapPin, Navigation, Phone, Plus, Save, Trash2 } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
	METODO_REFERENCIA_LABELS,
	METODOS_CONTACTO_REFERENCIA,
	PARENTESCO_LABELS,
	PARENTESCO_OPCIONES,
	RESULTADO_REFERENCIA_LABELS,
	RESULTADOS_CONTACTO_REFERENCIA,
	TIPO_HALLAZGO_LABELS,
	TIPOS_HALLAZGO,
} from "@/lib/cobros/referencias";
import { cn } from "@/lib/utils";
import { client, orpc } from "@/utils/orpc";

export type DatosReferencias = Awaited<
	ReturnType<typeof client.getReferenciasCaso>
>;
export type ReferenciaCaso = DatosReferencias["referencias"][number];

type Metodo = (typeof METODOS_CONTACTO_REFERENCIA)[number];
type Resultado = (typeof RESULTADOS_CONTACTO_REFERENCIA)[number];
type TipoHallazgo = (typeof TIPOS_HALLAZGO)[number];
type Parentesco = Parameters<
	typeof client.crearReferenciaCobros
>[0]["parentesco"];

type HallazgoForm = { tipo: TipoHallazgo; valor: string; enlaceMapa: string };

const PLACEHOLDER_HALLAZGO: Record<TipoHallazgo, string> = {
	telefono: "Ej.: 5555-5555",
	direccion: "Ej.: 5a. avenida 10-20 zona 1, Mixco",
	ubicacion: "Ej.: Trabaja en el taller frente al mercado de Villa Nueva",
};

function useInvalidarReferencias(casoCobroId: string) {
	const queryClient = useQueryClient();
	return () =>
		queryClient.invalidateQueries(
			orpc.getReferenciasCaso.queryOptions({ input: { casoCobroId } }),
		);
}

const ICONO_HALLAZGO: Record<TipoHallazgo, typeof Phone> = {
	telefono: Phone,
	direccion: MapPin,
	ubicacion: Navigation,
};

function CamposHallazgo({
	hallazgo,
	onChange,
	idPrefix,
}: {
	hallazgo: HallazgoForm;
	onChange: (h: HallazgoForm) => void;
	idPrefix: string;
}) {
	return (
		<div className="grid gap-3">
			{/* Radios a la vista, no un select: son tres opciones y el asesor
			    tiene que verlas sin abrir nada. */}
			<RadioGroup
				value={hallazgo.tipo}
				onValueChange={(tipo) =>
					onChange({ ...hallazgo, tipo: tipo as TipoHallazgo })
				}
				className="flex flex-wrap gap-2"
				aria-label="Tipo de dato"
			>
				{TIPOS_HALLAZGO.map((t) => {
					const Icono = ICONO_HALLAZGO[t];
					const elegido = hallazgo.tipo === t;
					return (
						<Label
							key={t}
							htmlFor={`${idPrefix}-tipo-${t}`}
							className={cn(
								"flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 font-normal text-sm transition-colors hover:bg-muted/60",
								elegido && "border-primary bg-primary/5 font-medium",
							)}
						>
							<RadioGroupItem value={t} id={`${idPrefix}-tipo-${t}`} />
							<Icono className="h-4 w-4 text-muted-foreground" />
							{TIPO_HALLAZGO_LABELS[t]}
						</Label>
					);
				})}
			</RadioGroup>
			<div className="space-y-1.5">
				<Label htmlFor={`${idPrefix}-valor`}>
					{hallazgo.tipo === "telefono"
						? "Teléfono nuevo del cliente"
						: hallazgo.tipo === "direccion"
							? "Dirección"
							: "Lugar donde se le puede encontrar"}
				</Label>
				<Input
					id={`${idPrefix}-valor`}
					value={hallazgo.valor}
					onChange={(e) => onChange({ ...hallazgo, valor: e.target.value })}
					placeholder={PLACEHOLDER_HALLAZGO[hallazgo.tipo]}
				/>
			</div>
			{hallazgo.tipo !== "telefono" && (
				<div className="space-y-1.5">
					<Label htmlFor={`${idPrefix}-mapa`}>
						Enlace de Google Maps (opcional)
					</Label>
					<Input
						id={`${idPrefix}-mapa`}
						value={hallazgo.enlaceMapa}
						onChange={(e) =>
							onChange({ ...hallazgo, enlaceMapa: e.target.value })
						}
						placeholder="https://maps.app.goo.gl/…"
					/>
				</div>
			)}
		</div>
	);
}

function hallazgosParaEnviar(hallazgos: HallazgoForm[]) {
	return hallazgos
		.filter((h) => h.valor.trim())
		.map((h) => ({
			tipo: h.tipo,
			valor: h.valor.trim(),
			enlaceMapa:
				h.tipo !== "telefono" && h.enlaceMapa.trim()
					? h.enlaceMapa.trim()
					: undefined,
		}));
}

/**
 * Workspace: los formularios se pintan dentro del panel de gestión, sin
 * Dialog (sus partes necesitan el contexto de Radix). El título lo pinta el
 * Workspace; aquí va la descripción, los campos con scroll propio y el pie.
 */
function EnvoltorioEmbebido({
	descripcion,
	children,
	pie,
}: {
	descripcion?: ReactNode;
	children: ReactNode;
	pie: ReactNode;
}) {
	return (
		<div className="@container flex min-h-0 flex-1 flex-col">
			<div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
				{descripcion && (
					<p className="text-muted-foreground text-sm">{descripcion}</p>
				)}
				{children}
			</div>
			<div className="mt-auto flex gap-2 border-line-subtle border-t pt-3">
				{pie}
			</div>
		</div>
	);
}

/** Props del contrato «embebido» del Workspace (ver SPEC del Workspace). */
type PropsEmbebido = {
	/** Workspace: se pinta dentro del panel de gestión, sin Dialog. */
	embebido?: boolean;
	/** Solo con `embebido`: el botón secundario del pie («Cancelar»). */
	onCancelar?: () => void;
};

// ---------------------------------------------------------------------------
// Registrar gestión a una referencia
// ---------------------------------------------------------------------------

/** Lo que el Workspace necesita para «Gestión registrada». */
export type ResumenGestionReferencia = {
	contactoId: string;
	referenciaKey: string;
	referenciaNombre: string;
	metodo: Metodo;
	telefono: string | null;
	resultado: Resultado;
	comentarios: string | null;
	cantidadHallazgos: number;
};

export function RegistrarGestionReferenciaDialog({
	casoCobroId,
	referencia,
	onOpenChange,
	embebido = false,
	onCancelar,
	onExito,
}: {
	casoCobroId: string;
	referencia: ReferenciaCaso | null;
	/** Obligatorio sin `embebido`. */
	onOpenChange?: (open: boolean) => void;
	/** Gestión guardada. Con `embebido` reemplaza al cierre del diálogo. */
	onExito?: (resumen: ResumenGestionReferencia) => void;
} & PropsEmbebido) {
	const invalidar = useInvalidarReferencias(casoCobroId);
	const [metodo, setMetodo] = useState<Metodo>("llamada");
	const [telefono, setTelefono] = useState("");
	const [resultado, setResultado] = useState<Resultado | "">("");
	const [comentarios, setComentarios] = useState("");
	const [hallazgos, setHallazgos] = useState<HallazgoForm[]>([]);

	// Cada vez que se abre para una referencia distinta, el formulario arranca
	// limpio con su primer teléfono (o en visita si no tiene ninguno).
	useEffect(() => {
		if (!referencia) return;
		const primero = referencia.telefonos[0]?.telefono ?? "";
		setMetodo(primero ? "llamada" : "visita_domicilio");
		setTelefono(primero);
		setResultado("");
		setComentarios("");
		setHallazgos([]);
	}, [referencia]);

	const mutation = useMutation({
		mutationFn: (
			datos: Parameters<typeof client.registrarContactoReferencia>[0],
		) => client.registrarContactoReferencia(datos),
		onSuccess: (resultadoServidor, datos) => {
			invalidar();
			toast.success("Gestión registrada");
			onExito?.({
				contactoId: resultadoServidor.id,
				referenciaKey: datos.referenciaKey,
				referenciaNombre: referencia?.nombre ?? "",
				metodo: datos.metodoContacto,
				telefono: datos.telefono ?? null,
				resultado: datos.resultado,
				comentarios: datos.comentarios ?? null,
				cantidadHallazgos: datos.hallazgos?.length ?? 0,
			});
			if (!embebido) onOpenChange?.(false);
		},
		onError: (error) => {
			toast.error(`No se pudo registrar la gestión: ${error.message}`);
		},
	});

	if (!referencia) return null;

	const esVisita = metodo === "visita_domicilio";
	const sinTelefonos = referencia.telefonos.length === 0;

	const guardar = () => {
		if (!resultado) {
			toast.error("Seleccione el resultado de la gestión");
			return;
		}
		if (!esVisita && !telefono) {
			toast.error("Seleccione el teléfono al que se contactó");
			return;
		}
		mutation.mutate({
			casoCobroId,
			referenciaKey: referencia.key,
			metodoContacto: metodo,
			telefono: esVisita ? undefined : telefono,
			resultado,
			comentarios: comentarios.trim() || undefined,
			hallazgos: hallazgosParaEnviar(hallazgos),
		});
	};

	const botonGuardar = (
		<Button
			className={embebido ? "flex-1" : undefined}
			onClick={guardar}
			disabled={mutation.isPending}
		>
			<Save className="mr-2 h-4 w-4" />
			{mutation.isPending ? "Guardando..." : "Registrar gestión"}
		</Button>
	);
	const campos = (
		<div className="grid gap-4 py-2">
			<div
				className={cn(
					"grid gap-4",
					embebido ? "@md:grid-cols-2" : "sm:grid-cols-2",
				)}
			>
				<div className="space-y-1.5">
					<Label htmlFor="gestion-metodo">Canal</Label>
					<Select value={metodo} onValueChange={(v) => setMetodo(v as Metodo)}>
						<SelectTrigger id="gestion-metodo">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{METODOS_CONTACTO_REFERENCIA.map((m) => (
								<SelectItem
									key={m}
									value={m}
									disabled={sinTelefonos && m !== "visita_domicilio"}
								>
									{METODO_REFERENCIA_LABELS[m]}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
				{!esVisita && (
					<div className="space-y-1.5">
						<Label htmlFor="gestion-telefono">Teléfono</Label>
						<Select value={telefono} onValueChange={setTelefono}>
							<SelectTrigger id="gestion-telefono">
								<SelectValue placeholder="Seleccionar número" />
							</SelectTrigger>
							<SelectContent>
								{referencia.telefonos.map((t) => (
									<SelectItem key={t.telefono} value={t.telefono}>
										{t.telefono}
										{t.etiqueta ? ` · ${t.etiqueta}` : ""}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>
				)}
			</div>
			{sinTelefonos && (
				<p className="text-muted-foreground text-xs">
					Esta referencia no tiene teléfono: solo se puede registrar una visita.
					Para llamarla, primero agregue un número.
				</p>
			)}

			<div className="space-y-1.5">
				<Label htmlFor="gestion-resultado">
					Resultado <span className="text-red-500">*</span>
				</Label>
				<Select
					value={resultado}
					onValueChange={(v) => setResultado(v as Resultado)}
				>
					<SelectTrigger id="gestion-resultado">
						<SelectValue placeholder="Seleccionar resultado" />
					</SelectTrigger>
					<SelectContent>
						{RESULTADOS_CONTACTO_REFERENCIA.map((r) => (
							<SelectItem key={r} value={r}>
								{RESULTADO_REFERENCIA_LABELS[r]}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>

			<div className="space-y-1.5">
				<Label htmlFor="gestion-comentarios">Comentarios</Label>
				<Textarea
					id="gestion-comentarios"
					value={comentarios}
					onChange={(e) => setComentarios(e.target.value)}
					placeholder="Lo que indicó la referencia, cuándo volver a llamar…"
					rows={3}
				/>
			</div>

			<div className="space-y-3 rounded-lg border border-dashed p-3">
				<div className="flex items-center justify-between gap-2">
					<div>
						<p className="font-medium text-sm">Información nueva del cliente</p>
						<p className="text-muted-foreground text-xs">
							Teléfono, dirección o lugar donde encontrarlo, si la referencia lo
							proporcionó.
						</p>
					</div>
					<Button
						type="button"
						variant="outline"
						size="sm"
						onClick={() =>
							setHallazgos((prev) => [
								...prev,
								{ tipo: "telefono", valor: "", enlaceMapa: "" },
							])
						}
					>
						<Plus className="mr-1 h-4 w-4" />
						Agregar dato
					</Button>
				</div>
				{hallazgos.map((h, i) => (
					<div
						// biome-ignore lint/suspicious/noArrayIndexKey: filas sin id propio, solo se agregan o quitan por posición
						key={i}
						className="flex items-start gap-2 rounded-md bg-muted/40 p-2"
					>
						<div className="flex-1">
							<CamposHallazgo
								idPrefix={`hallazgo-${i}`}
								hallazgo={h}
								onChange={(nuevo) =>
									setHallazgos((prev) =>
										prev.map((x, j) => (j === i ? nuevo : x)),
									)
								}
							/>
						</div>
						<Button
							type="button"
							variant="ghost"
							size="icon"
							className="text-muted-foreground"
							aria-label="Quitar dato"
							onClick={() =>
								setHallazgos((prev) => prev.filter((_, j) => j !== i))
							}
						>
							<Trash2 className="h-4 w-4" />
						</Button>
					</div>
				))}
			</div>
		</div>
	);
	const descripcion =
		"Queda en la bitácora de referencias del caso. No cuenta como contacto con el cliente.";

	if (embebido) {
		return (
			<EnvoltorioEmbebido
				descripcion={
					<>
						{/* El título del Workspace es genérico: aquí va a quién. */}
						<span className="block font-medium text-foreground">
							{referencia.nombre}
						</span>
						{descripcion}
					</>
				}
				pie={
					<>
						<Button
							variant="outline"
							onClick={onCancelar}
							disabled={mutation.isPending}
						>
							Cancelar
						</Button>
						{botonGuardar}
					</>
				}
			>
				{campos}
			</EnvoltorioEmbebido>
		);
	}

	return (
		<Dialog open={!!referencia} onOpenChange={onOpenChange}>
			<DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
				<DialogHeader>
					<DialogTitle>Registrar gestión · {referencia.nombre}</DialogTitle>
					<DialogDescription>{descripcion}</DialogDescription>
				</DialogHeader>

				{campos}

				<DialogFooter>
					<Button variant="outline" onClick={() => onOpenChange?.(false)}>
						Cancelar
					</Button>
					{botonGuardar}
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

// ---------------------------------------------------------------------------
// Agregar teléfono a una referencia (de cualquier origen)
// ---------------------------------------------------------------------------

export function AgregarTelefonoReferenciaDialog({
	casoCobroId,
	referencia,
	onOpenChange,
}: {
	casoCobroId: string;
	referencia: ReferenciaCaso | null;
	onOpenChange: (open: boolean) => void;
}) {
	const invalidar = useInvalidarReferencias(casoCobroId);
	const [telefono, setTelefono] = useState("");
	const [notas, setNotas] = useState("");

	// Arranca limpio cada vez que se abre para una referencia.
	useEffect(() => {
		if (!referencia) return;
		setTelefono("");
		setNotas("");
	}, [referencia]);

	const mutation = useMutation({
		mutationFn: (
			datos: Parameters<typeof client.agregarTelefonoReferencia>[0],
		) => client.agregarTelefonoReferencia(datos),
		onSuccess: () => {
			invalidar();
			toast.success("Teléfono agregado a la referencia");
			onOpenChange(false);
		},
		onError: (error) => {
			toast.error(`No se pudo agregar el teléfono: ${error.message}`);
		},
	});

	if (!referencia) return null;

	return (
		<Dialog open={!!referencia} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Agregar teléfono · {referencia.nombre}</DialogTitle>
					<DialogDescription>
						Se guarda en cobros. Lo que capturó ventas no se modifica.
					</DialogDescription>
				</DialogHeader>
				<div className="grid gap-4 py-2">
					<div className="space-y-1.5">
						<Label htmlFor="ref-tel-nuevo">
							Teléfono <span className="text-red-500">*</span>
						</Label>
						<Input
							id="ref-tel-nuevo"
							value={telefono}
							onChange={(e) => setTelefono(e.target.value)}
							placeholder="Ej.: 5555-5555"
						/>
					</div>
					<div className="space-y-1.5">
						<Label htmlFor="ref-tel-notas">Origen del dato (opcional)</Label>
						<Input
							id="ref-tel-notas"
							value={notas}
							onChange={(e) => setNotas(e.target.value)}
							placeholder="Ej.: Lo proporcionó la madre del cliente"
						/>
					</div>
				</div>
				<DialogFooter>
					<Button variant="outline" onClick={() => onOpenChange(false)}>
						Cancelar
					</Button>
					<Button
						disabled={mutation.isPending || !telefono.trim()}
						onClick={() =>
							mutation.mutate({
								casoCobroId,
								referenciaKey: referencia.key,
								telefono: telefono.trim(),
								notas: notas.trim() || undefined,
							})
						}
					>
						<Save className="mr-2 h-4 w-4" />
						{mutation.isPending ? "Guardando..." : "Agregar"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

// ---------------------------------------------------------------------------
// Alta / edición de referencias propias de cobros
// ---------------------------------------------------------------------------

type ReferenciaForm = {
	nombre: string;
	telefono: string;
	parentesco: string;
	notas: string;
};

const FORM_VACIO: ReferenciaForm = {
	nombre: "",
	telefono: "",
	parentesco: "",
	notas: "",
};

/** Lo que el Workspace necesita tras guardar la referencia. */
export type ResumenReferenciaCobros = {
	accion: "creada" | "actualizada";
	nombre: string;
	telefono: string;
	parentesco: string;
};

export function ReferenciaCobrosDialog({
	casoCobroId,
	open: openProp = false,
	editando,
	onOpenChange,
	embebido = false,
	onCancelar,
	onExito,
}: {
	casoCobroId: string;
	/** Obligatorio sin `embebido`; con `embebido` se ignora (siempre abierto). */
	open?: boolean;
	/** null = alta. */
	editando: ReferenciaCaso | null;
	/** Obligatorio sin `embebido`. */
	onOpenChange?: (open: boolean) => void;
	/** Referencia guardada. Con `embebido` reemplaza al cierre del diálogo. */
	onExito?: (resumen: ResumenReferenciaCobros) => void;
} & PropsEmbebido) {
	const open = embebido || openProp;
	const invalidar = useInvalidarReferencias(casoCobroId);
	const [form, setForm] = useState<ReferenciaForm>(FORM_VACIO);

	useEffect(() => {
		if (!open) return;
		setForm(
			editando?.editable
				? {
						nombre: editando.nombre,
						telefono: editando.editable.telefono,
						parentesco: editando.editable.parentesco,
						notas: editando.editable.notas ?? "",
					}
				: FORM_VACIO,
		);
	}, [open, editando]);

	const mutation = useMutation({
		mutationFn: async (datos: ReferenciaForm) => {
			const base = {
				casoCobroId,
				nombre: datos.nombre.trim(),
				telefono: datos.telefono.trim(),
				parentesco: datos.parentesco as Parentesco,
				notas: datos.notas.trim() || undefined,
			};
			if (editando?.editable) {
				return client.actualizarReferenciaCobros({
					...base,
					id: editando.editable.referenciaLeadId,
				});
			}
			return client.crearReferenciaCobros(base);
		},
		onSuccess: (_, datos) => {
			invalidar();
			toast.success(
				editando ? "Referencia actualizada" : "Referencia agregada",
			);
			onExito?.({
				accion: editando?.editable ? "actualizada" : "creada",
				nombre: datos.nombre.trim(),
				telefono: datos.telefono.trim(),
				parentesco: datos.parentesco,
			});
			if (!embebido) onOpenChange?.(false);
		},
		onError: (error) => {
			toast.error(`No se pudo guardar la referencia: ${error.message}`);
		},
	});

	const guardar = () => {
		if (!form.nombre.trim() || !form.telefono.trim() || !form.parentesco) {
			toast.error("Nombre, teléfono y parentesco son requeridos");
			return;
		}
		mutation.mutate(form);
	};

	const botonGuardar = (
		<Button
			className={embebido ? "flex-1" : undefined}
			onClick={guardar}
			disabled={mutation.isPending}
		>
			<Save className="mr-2 h-4 w-4" />
			{mutation.isPending ? "Guardando..." : "Guardar"}
		</Button>
	);
	const campos = (
		<div className="grid gap-4 py-2">
			<div className="grid grid-cols-2 gap-4">
				<div className="space-y-1.5">
					<Label htmlFor="ref-nombre">
						Nombre <span className="text-red-500">*</span>
					</Label>
					<Input
						id="ref-nombre"
						value={form.nombre}
						onChange={(e) =>
							setForm((prev) => ({ ...prev, nombre: e.target.value }))
						}
						placeholder="Ej.: María López"
					/>
				</div>
				<div className="space-y-1.5">
					<Label htmlFor="ref-telefono">
						Teléfono <span className="text-red-500">*</span>
					</Label>
					<Input
						id="ref-telefono"
						value={form.telefono}
						onChange={(e) =>
							setForm((prev) => ({ ...prev, telefono: e.target.value }))
						}
						placeholder="Ej.: 5555-5555"
					/>
				</div>
			</div>
			<div className="space-y-1.5">
				<Label htmlFor="ref-parentesco">
					Parentesco <span className="text-red-500">*</span>
				</Label>
				<Select
					value={form.parentesco}
					onValueChange={(v) => setForm((prev) => ({ ...prev, parentesco: v }))}
				>
					<SelectTrigger id="ref-parentesco">
						<SelectValue placeholder="Seleccionar parentesco" />
					</SelectTrigger>
					<SelectContent>
						{PARENTESCO_OPCIONES.map((p) => (
							<SelectItem key={p} value={p}>
								{PARENTESCO_LABELS[p]}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>
			<div className="space-y-1.5">
				<Label htmlFor="ref-notas">Notas</Label>
				<Textarea
					id="ref-notas"
					value={form.notas}
					onChange={(e) =>
						setForm((prev) => ({ ...prev, notas: e.target.value }))
					}
					placeholder="Notas adicionales sobre la referencia..."
					rows={2}
				/>
			</div>
		</div>
	);
	const descripcion =
		"Persona de contacto del cliente. Queda para todos sus créditos.";

	if (embebido) {
		return (
			<EnvoltorioEmbebido
				descripcion={descripcion}
				pie={
					<>
						<Button
							variant="outline"
							onClick={onCancelar}
							disabled={mutation.isPending}
						>
							Cancelar
						</Button>
						{botonGuardar}
					</>
				}
			>
				{campos}
			</EnvoltorioEmbebido>
		);
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>
						{editando ? "Editar referencia" : "Agregar referencia"}
					</DialogTitle>
					<DialogDescription>{descripcion}</DialogDescription>
				</DialogHeader>
				{campos}
				<DialogFooter>
					<Button variant="outline" onClick={() => onOpenChange?.(false)}>
						Cancelar
					</Button>
					{botonGuardar}
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

// ---------------------------------------------------------------------------
// Dato nuevo del cliente sin gestión a referencia
// ---------------------------------------------------------------------------

/** Lo que el Workspace necesita tras registrar el dato nuevo. */
export type ResumenHallazgoCliente = {
	tipo: TipoHallazgo;
	valor: string;
	enlaceMapa: string | null;
	notas: string | null;
};

export function RegistrarHallazgoDialog({
	casoCobroId,
	open: openProp = false,
	onOpenChange,
	embebido = false,
	onCancelar,
	onExito,
}: {
	casoCobroId: string;
	/** Obligatorio sin `embebido`; con `embebido` se ignora (siempre abierto). */
	open?: boolean;
	/** Obligatorio sin `embebido`. */
	onOpenChange?: (open: boolean) => void;
	/** Dato registrado. Con `embebido` reemplaza al cierre del diálogo. */
	onExito?: (resumen: ResumenHallazgoCliente) => void;
} & PropsEmbebido) {
	const open = embebido || openProp;
	const invalidar = useInvalidarReferencias(casoCobroId);
	const [hallazgo, setHallazgo] = useState<HallazgoForm>({
		tipo: "telefono",
		valor: "",
		enlaceMapa: "",
	});
	const [notas, setNotas] = useState("");

	useEffect(() => {
		if (!open) return;
		setHallazgo({ tipo: "telefono", valor: "", enlaceMapa: "" });
		setNotas("");
	}, [open]);

	const mutation = useMutation({
		mutationFn: (
			datos: Parameters<typeof client.registrarHallazgoCliente>[0],
		) => client.registrarHallazgoCliente(datos),
		onSuccess: (_, datos) => {
			invalidar();
			toast.success("Dato nuevo registrado");
			onExito?.({
				tipo: datos.tipo,
				valor: datos.valor,
				enlaceMapa: datos.enlaceMapa ?? null,
				notas: datos.notas ?? null,
			});
			if (!embebido) onOpenChange?.(false);
		},
		onError: (error) => {
			toast.error(`No se pudo registrar el dato: ${error.message}`);
		},
	});

	const guardar = () => {
		const [dato] = hallazgosParaEnviar([hallazgo]);
		if (!dato) {
			toast.error("Ingrese el dato nuevo");
			return;
		}
		mutation.mutate({
			casoCobroId,
			...dato,
			notas: notas.trim() || undefined,
		});
	};

	const botonGuardar = (
		<Button
			className={embebido ? "flex-1" : undefined}
			onClick={guardar}
			disabled={mutation.isPending}
		>
			<Save className="mr-2 h-4 w-4" />
			{mutation.isPending ? "Guardando..." : "Registrar"}
		</Button>
	);
	const campos = (
		<div className="grid gap-4 py-2">
			<CamposHallazgo
				idPrefix="hallazgo-suelto"
				hallazgo={hallazgo}
				onChange={setHallazgo}
			/>
			<div className="space-y-1.5">
				<Label htmlFor="hallazgo-suelto-notas">
					Origen del dato (opcional)
				</Label>
				<Input
					id="hallazgo-suelto-notas"
					value={notas}
					onChange={(e) => setNotas(e.target.value)}
					placeholder="Ej.: Lo indicó el cliente en la última llamada"
				/>
			</div>
		</div>
	);
	const descripcion =
		"Un teléfono, una dirección o un lugar donde encontrarlo. Si lo proporcionó una referencia, regístrelo desde la gestión de esa referencia.";

	if (embebido) {
		return (
			<EnvoltorioEmbebido
				descripcion={descripcion}
				pie={
					<>
						<Button
							variant="outline"
							onClick={onCancelar}
							disabled={mutation.isPending}
						>
							Cancelar
						</Button>
						{botonGuardar}
					</>
				}
			>
				{campos}
			</EnvoltorioEmbebido>
		);
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-xl">
				<DialogHeader>
					<DialogTitle>Registrar dato nuevo del cliente</DialogTitle>
					<DialogDescription>{descripcion}</DialogDescription>
				</DialogHeader>
				{campos}
				<DialogFooter>
					<Button variant="outline" onClick={() => onOpenChange?.(false)}>
						Cancelar
					</Button>
					{botonGuardar}
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
