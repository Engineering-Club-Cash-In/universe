/**
 * CB-036 · Modales de la pestaña Referencias: registrar una gestión (con la
 * información nueva que dé la referencia), agregar un teléfono a una
 * referencia, alta/edición de las referencias propias de cobros y registrar
 * un dato nuevo del cliente sin gestión de por medio.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { MapPin, Navigation, Phone, Plus, Save, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
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
	telefono: "Ej: 5555-5555",
	direccion: "Ej: 5a. avenida 10-20 zona 1, Mixco",
	ubicacion: "Ej: Trabaja en el taller frente al mercado de Villa Nueva",
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
							: "Dónde se le puede encontrar"}
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

// ---------------------------------------------------------------------------
// Registrar gestión a una referencia
// ---------------------------------------------------------------------------

export function RegistrarGestionReferenciaDialog({
	casoCobroId,
	referencia,
	onOpenChange,
}: {
	casoCobroId: string;
	referencia: ReferenciaCaso | null;
	onOpenChange: (open: boolean) => void;
}) {
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
		onSuccess: () => {
			invalidar();
			toast.success("Gestión registrada");
			onOpenChange(false);
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
			toast.error("Elegí el resultado de la gestión");
			return;
		}
		if (!esVisita && !telefono) {
			toast.error("Elegí a qué teléfono se contactó");
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

	return (
		<Dialog open={!!referencia} onOpenChange={onOpenChange}>
			<DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
				<DialogHeader>
					<DialogTitle>Registrar gestión · {referencia.nombre}</DialogTitle>
					<DialogDescription>
						Queda en la bitácora de referencias del caso. No cuenta como
						contacto con el cliente.
					</DialogDescription>
				</DialogHeader>

				<div className="grid gap-4 py-2">
					<div className="grid gap-4 sm:grid-cols-2">
						<div className="space-y-1.5">
							<Label htmlFor="gestion-metodo">Canal</Label>
							<Select
								value={metodo}
								onValueChange={(v) => setMetodo(v as Metodo)}
							>
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
										<SelectValue placeholder="Elegí el número" />
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
							Esta referencia no tiene teléfono: solo se puede registrar una
							visita. Para llamarla, agregale un número primero.
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
								<SelectValue placeholder="¿Qué pasó?" />
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
							placeholder="Qué dijo, cuándo volver a llamar…"
							rows={3}
						/>
					</div>

					<div className="space-y-3 rounded-lg border border-dashed p-3">
						<div className="flex items-center justify-between gap-2">
							<div>
								<p className="font-medium text-sm">
									Información nueva del cliente
								</p>
								<p className="text-muted-foreground text-xs">
									Teléfono, dirección o dónde encontrarlo, si la referencia lo
									dio.
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

				<DialogFooter>
					<Button variant="outline" onClick={() => onOpenChange(false)}>
						Cancelar
					</Button>
					<Button onClick={guardar} disabled={mutation.isPending}>
						<Save className="mr-2 h-4 w-4" />
						{mutation.isPending ? "Guardando..." : "Registrar gestión"}
					</Button>
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
							placeholder="Ej: 5555-5555"
						/>
					</div>
					<div className="space-y-1.5">
						<Label htmlFor="ref-tel-notas">De dónde salió (opcional)</Label>
						<Input
							id="ref-tel-notas"
							value={notas}
							onChange={(e) => setNotas(e.target.value)}
							placeholder="Ej: Lo dio la mamá del cliente"
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

export function ReferenciaCobrosDialog({
	casoCobroId,
	open,
	editando,
	onOpenChange,
}: {
	casoCobroId: string;
	open: boolean;
	/** null = alta. */
	editando: ReferenciaCaso | null;
	onOpenChange: (open: boolean) => void;
}) {
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
		onSuccess: () => {
			invalidar();
			toast.success(
				editando ? "Referencia actualizada" : "Referencia agregada",
			);
			onOpenChange(false);
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

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>
						{editando ? "Editar referencia" : "Agregar referencia"}
					</DialogTitle>
					<DialogDescription>
						Persona de contacto del cliente. Queda para todos sus créditos.
					</DialogDescription>
				</DialogHeader>
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
								placeholder="Ej: María López"
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
								placeholder="Ej: 5555-5555"
							/>
						</div>
					</div>
					<div className="space-y-1.5">
						<Label htmlFor="ref-parentesco">
							Parentesco <span className="text-red-500">*</span>
						</Label>
						<Select
							value={form.parentesco}
							onValueChange={(v) =>
								setForm((prev) => ({ ...prev, parentesco: v }))
							}
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
				<DialogFooter>
					<Button variant="outline" onClick={() => onOpenChange(false)}>
						Cancelar
					</Button>
					<Button onClick={guardar} disabled={mutation.isPending}>
						<Save className="mr-2 h-4 w-4" />
						{mutation.isPending ? "Guardando..." : "Guardar"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

// ---------------------------------------------------------------------------
// Dato nuevo del cliente sin gestión a referencia
// ---------------------------------------------------------------------------

export function RegistrarHallazgoDialog({
	casoCobroId,
	open,
	onOpenChange,
}: {
	casoCobroId: string;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
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
		onSuccess: () => {
			invalidar();
			toast.success("Dato nuevo registrado");
			onOpenChange(false);
		},
		onError: (error) => {
			toast.error(`No se pudo registrar el dato: ${error.message}`);
		},
	});

	const guardar = () => {
		const [dato] = hallazgosParaEnviar([hallazgo]);
		if (!dato) {
			toast.error("Escribí el dato nuevo");
			return;
		}
		mutation.mutate({
			casoCobroId,
			...dato,
			notas: notas.trim() || undefined,
		});
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-xl">
				<DialogHeader>
					<DialogTitle>Registrar dato nuevo del cliente</DialogTitle>
					<DialogDescription>
						Un teléfono, una dirección o dónde encontrarlo. Si salió de una
						referencia, mejor registralo desde su gestión.
					</DialogDescription>
				</DialogHeader>
				<div className="grid gap-4 py-2">
					<CamposHallazgo
						idPrefix="hallazgo-suelto"
						hallazgo={hallazgo}
						onChange={setHallazgo}
					/>
					<div className="space-y-1.5">
						<Label htmlFor="hallazgo-suelto-notas">
							De dónde salió (opcional)
						</Label>
						<Input
							id="hallazgo-suelto-notas"
							value={notas}
							onChange={(e) => setNotas(e.target.value)}
							placeholder="Ej: Lo dijo el cliente en la última llamada"
						/>
					</div>
				</div>
				<DialogFooter>
					<Button variant="outline" onClick={() => onOpenChange(false)}>
						Cancelar
					</Button>
					<Button onClick={guardar} disabled={mutation.isPending}>
						<Save className="mr-2 h-4 w-4" />
						{mutation.isPending ? "Guardando..." : "Registrar"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
