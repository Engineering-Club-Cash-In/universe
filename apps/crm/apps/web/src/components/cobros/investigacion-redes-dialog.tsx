/**
 * CB-039 · Formulario para registrar una investigación en redes sociales:
 * qué fuente se consultó, qué se encontró, cuándo, y las capturas que lo
 * respaldan.
 *
 * Las reglas son las MISMAS del servidor
 * (server/src/lib/investigaciones-redes-cobros): el botón se habilita con lo
 * mismo que el servidor va a aceptar. Es una bitácora: lo guardado no se
 * edita, así que el formulario avisa antes.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FileText, Loader2, RotateCw, Upload, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
	CLAVES_FUENTE_INVESTIGACION,
	CLAVES_RESULTADO_INVESTIGACION,
	erroresRegistroInvestigacion,
	FUENTES_INVESTIGACION,
	type FuenteInvestigacion,
	MAX_EVIDENCIAS_INVESTIGACION,
	MIN_CARACTERES_HALLAZGOS,
	RESULTADOS_INVESTIGACION,
	type RegistrarInvestigacionInput,
	type ResultadoInvestigacion,
	registrarInvestigacionSchema,
} from "server/src/lib/investigaciones-redes-cobros";
import { toast } from "sonner";
import {
	ahoraRedondeado,
	FechaHoraPicker,
} from "@/components/fecha-hora-picker";
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
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
	comprimirFoto,
	conLimite,
	LIMITE_PUT_MS,
} from "@/lib/subida-evidencia";
import { uploadFileToR2WithRetry } from "@/lib/upload-to-r2";
import { cn } from "@/lib/utils";
import { client, orpc } from "@/utils/orpc";

type Archivo = {
	id: string;
	nombre: string;
	/** Vista previa solo para imágenes; un PDF muestra un ícono. */
	preview: string | null;
	estado: "subiendo" | "lista" | "error";
	key?: string;
	error?: string;
};

interface InvestigacionRedesDialogProps {
	open: boolean;
	onOpenChange: (abierto: boolean) => void;
	casoCobroId: string;
}

export function InvestigacionRedesDialog(props: InvestigacionRedesDialogProps) {
	// El formulario se remonta en cada apertura: arranca limpio sin tener que
	// resetear campo por campo.
	return (
		<Dialog open={props.open} onOpenChange={props.onOpenChange}>
			{props.open && <Formulario {...props} />}
		</Dialog>
	);
}

function Formulario({
	onOpenChange,
	casoCobroId,
}: InvestigacionRedesDialogProps) {
	const queryClient = useQueryClient();
	const [fuente, setFuente] = useState<FuenteInvestigacion | "">("");
	const [fuenteOtra, setFuenteOtra] = useState("");
	const [enlacePerfil, setEnlacePerfil] = useState("");
	const [resultado, setResultado] = useState<ResultadoInvestigacion | null>(
		null,
	);
	const [hallazgos, setHallazgos] = useState("");
	const [fecha, setFecha] = useState<Date | undefined>(ahoraRedondeado);
	const [archivos, setArchivos] = useState<Archivo[]>([]);
	const inputArchivos = useRef<HTMLInputElement>(null);

	// Las vistas previas son URLs del navegador: se liberan al cerrar.
	const archivosEstado = useRef(archivos);
	archivosEstado.current = archivos;
	useEffect(
		() => () => {
			for (const a of archivosEstado.current) {
				if (a.preview) URL.revokeObjectURL(a.preview);
			}
		},
		[],
	);

	// El archivo original, para poder reintentarlo, y el intento vigente: si
	// una subida vieja contesta tarde, no pisa a la nueva.
	const originalesRef = useRef(new Map<string, File>());
	const intentosRef = useRef(new Map<string, number>());

	const subir = async (id: string) => {
		const original = originalesRef.current.get(id);
		if (!original) return;
		const intento = (intentosRef.current.get(id) ?? 0) + 1;
		intentosRef.current.set(id, intento);
		const vigente = () => intentosRef.current.get(id) === intento;
		setArchivos((a) =>
			a.map((x) =>
				x.id === id ? { ...x, estado: "subiendo", error: undefined } : x,
			),
		);
		try {
			const { archivo, key } = await conLimite(async () => {
				const archivo = await comprimirFoto(original);
				const { key } = await uploadFileToR2WithRetry(
					archivo,
					{
						resourceType: "cobros_investigacion_evidencia",
						resourceId: casoCobroId,
					},
					{ timeoutMs: LIMITE_PUT_MS },
				);
				return { archivo, key };
			});
			if (!vigente()) return;
			setArchivos((a) =>
				a.map((x) =>
					x.id === id
						? { ...x, estado: "lista", key, nombre: archivo.name }
						: x,
				),
			);
		} catch (e) {
			if (!vigente()) return;
			setArchivos((a) =>
				a.map((x) =>
					x.id === id
						? {
								...x,
								estado: "error",
								error:
									e instanceof Error
										? e.message
										: "No se pudo subir el archivo",
							}
						: x,
				),
			);
		}
	};

	const agregar = (lista: FileList | null) => {
		if (!lista || lista.length === 0) return;
		const libres = MAX_EVIDENCIAS_INVESTIGACION - archivos.length;
		const elegidos = Array.from(lista).slice(0, Math.max(0, libres));
		if (lista.length > elegidos.length) {
			toast.warning(
				`Hasta ${MAX_EVIDENCIAS_INVESTIGACION} archivos por investigación.`,
			);
		}
		const nuevos = elegidos.map((original) => {
			const id = crypto.randomUUID();
			originalesRef.current.set(id, original);
			return {
				id,
				nombre: original.name || "captura",
				preview: original.type.startsWith("image/")
					? URL.createObjectURL(original)
					: null,
				estado: "subiendo" as const,
			};
		});
		setArchivos((a) => [...a, ...nuevos]);
		// En paralelo: uno que se traba no frena a los demás.
		for (const n of nuevos) void subir(n.id);
	};

	const quitar = (id: string) => {
		originalesRef.current.delete(id);
		intentosRef.current.delete(id);
		setArchivos((a) => {
			const archivo = a.find((x) => x.id === id);
			if (archivo?.preview) URL.revokeObjectURL(archivo.preview);
			return a.filter((x) => x.id !== id);
		});
	};

	const payload: RegistrarInvestigacionInput = {
		casoCobroId,
		fuente: (fuente || "otra") as FuenteInvestigacion,
		fuenteOtra: fuente === "otra" ? fuenteOtra : undefined,
		enlacePerfil,
		resultado: (resultado ?? "con_hallazgos") as ResultadoInvestigacion,
		hallazgos,
		fechaInvestigacion: fecha ?? new Date(Number.NaN),
		evidencias: archivos
			.filter((a) => a.estado === "lista" && a.key)
			.map((a) => ({ key: a.key as string, nombreArchivo: a.nombre })),
	};

	// El primer problema basta: el asesor lo resuelve y aparece el siguiente.
	const faltante = (() => {
		if (!fuente) return "Seleccione la fuente consultada.";
		if (!resultado) return "Indique si se encontró información.";
		if (!fecha) return "Falta la fecha de la investigación.";
		if (hallazgos.trim().length < MIN_CARACTERES_HALLAZGOS)
			return resultado === "sin_hallazgos"
				? `Describa la búsqueda realizada (mínimo ${MIN_CARACTERES_HALLAZGOS} caracteres).`
				: `Describa los hallazgos (mínimo ${MIN_CARACTERES_HALLAZGOS} caracteres).`;
		if (archivos.some((a) => a.estado === "subiendo"))
			return "Espere a que terminen de subir los archivos.";
		if (archivos.some((a) => a.estado === "error"))
			return "Un archivo no se pudo subir: reinténtelo o quítelo.";
		const p = registrarInvestigacionSchema.safeParse(payload);
		if (!p.success)
			return p.error.issues[0]?.message ?? "Revise el formulario.";
		return erroresRegistroInvestigacion(p.data);
	})();

	const registrar = useMutation({
		mutationFn: () =>
			client.registrarInvestigacionRedes(
				registrarInvestigacionSchema.parse(payload),
			),
		onSuccess: () => {
			toast.success("Investigación registrada.");
			queryClient.invalidateQueries({
				queryKey: orpc.getInvestigacionesRedesCaso.key(),
			});
			onOpenChange(false);
		},
		onError: (e: Error) =>
			toast.error(e.message || "No se pudo registrar la investigación"),
	});

	const subiendo = archivos.some((a) => a.estado === "subiendo");
	const [intentoEnviar, setIntentoEnviar] = useState(false);
	const enviar = () => {
		setIntentoEnviar(true);
		if (faltante || registrar.isPending) return;
		registrar.mutate();
	};

	return (
		<DialogContent className="flex max-h-[90vh] w-full max-w-2xl flex-col gap-0 p-0">
			<DialogHeader className="border-b px-4 pt-4 pb-3 text-left sm:px-6">
				<DialogTitle className="pr-8">
					Registrar investigación en redes sociales
				</DialogTitle>
				<DialogDescription>
					Información encontrada sobre el cliente, con las capturas que la
					respaldan.
				</DialogDescription>
			</DialogHeader>

			<div className="flex-1 space-y-5 overflow-y-auto px-4 py-4 sm:px-6">
				<p className="rounded-md bg-amber-50 p-3 text-amber-900 text-sm dark:bg-amber-950/40 dark:text-amber-200">
					Solo información pública. No use cuentas falsas, no pida contraseñas
					ni contacte al cliente por esta vía. El registro queda con su nombre y
					la fecha, y no se puede editar ni borrar.
				</p>

				<section className="grid gap-3 sm:grid-cols-2">
					<div className="space-y-1.5">
						<Label htmlFor="inv-fuente">Fuente consultada</Label>
						<Select
							value={fuente}
							onValueChange={(v) => {
								setFuente(v as FuenteInvestigacion);
								if (v !== "otra") setFuenteOtra("");
							}}
						>
							<SelectTrigger id="inv-fuente">
								<SelectValue placeholder="Seleccionar fuente" />
							</SelectTrigger>
							<SelectContent>
								{CLAVES_FUENTE_INVESTIGACION.map((clave) => (
									<SelectItem key={clave} value={clave}>
										{FUENTES_INVESTIGACION[clave]}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>
					{fuente === "otra" && (
						<div className="space-y-1.5">
							<Label htmlFor="inv-fuente-otra">Nombre de la fuente</Label>
							<Input
								id="inv-fuente-otra"
								value={fuenteOtra}
								maxLength={100}
								onChange={(e) => setFuenteOtra(e.target.value)}
								placeholder="Ej.: Threads"
							/>
						</div>
					)}
					<div
						className={cn(
							"space-y-1.5",
							fuente === "otra" ? "sm:col-span-2" : "",
						)}
					>
						<Label htmlFor="inv-enlace">Enlace del perfil (opcional)</Label>
						<Input
							id="inv-enlace"
							value={enlacePerfil}
							maxLength={500}
							onChange={(e) => setEnlacePerfil(e.target.value)}
							placeholder="https://"
							inputMode="url"
						/>
					</div>
				</section>

				<section className="space-y-2">
					<Label>Resultado de la investigación</Label>
					<div className="grid grid-cols-2 gap-2">
						{CLAVES_RESULTADO_INVESTIGACION.map((clave) => (
							<button
								key={clave}
								type="button"
								onClick={() => setResultado(clave)}
								className={cn(
									"h-11 rounded-md border px-3 font-medium text-sm transition-colors",
									resultado === clave
										? "border-primary bg-primary/10"
										: "text-muted-foreground hover:bg-muted",
								)}
							>
								{RESULTADOS_INVESTIGACION[clave]}
							</button>
						))}
					</div>
				</section>

				<section className="space-y-1.5">
					<Label htmlFor="inv-hallazgos">
						{resultado === "sin_hallazgos"
							? "Búsqueda realizada"
							: "Hallazgos relevantes"}
					</Label>
					<Textarea
						id="inv-hallazgos"
						value={hallazgos}
						maxLength={4000}
						rows={5}
						onChange={(e) => setHallazgos(e.target.value)}
						placeholder={
							resultado === "sin_hallazgos"
								? "Ej.: búsqueda por nombre y por teléfono, sin perfiles públicos."
								: "Ej.: perfil público con fotos del vehículo y del lugar de trabajo."
						}
					/>
				</section>

				<section className="space-y-1.5">
					<Label htmlFor="inv-fecha">Fecha y hora de la investigación</Label>
					<FechaHoraPicker
						id="inv-fecha"
						value={fecha}
						onChange={setFecha}
						deshabilitar={(dia) => dia > new Date()}
					/>
				</section>

				<section className="space-y-2">
					<Label>Evidencia (opcional)</Label>
					<p className="text-muted-foreground text-xs">
						Capturas de pantalla (JPG, PNG, WebP) o un PDF. Hasta{" "}
						{MAX_EVIDENCIAS_INVESTIGACION} archivos.
					</p>
					<Button
						type="button"
						variant="outline"
						className="h-11"
						disabled={archivos.length >= MAX_EVIDENCIAS_INVESTIGACION}
						onClick={() => inputArchivos.current?.click()}
					>
						<Upload className="mr-2 h-4 w-4" />
						Agregar archivos
					</Button>
					<input
						ref={inputArchivos}
						type="file"
						accept="image/jpeg,image/png,image/webp,application/pdf"
						multiple
						className="hidden"
						onChange={(e) => {
							agregar(e.target.files);
							e.target.value = "";
						}}
					/>
					{archivos.length > 0 && (
						<div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
							{archivos.map((a) => (
								<div
									key={a.id}
									className="relative aspect-square overflow-hidden rounded-md border bg-muted"
								>
									{a.preview ? (
										<img
											src={a.preview}
											alt={a.nombre}
											className={cn(
												"h-full w-full object-cover",
												a.estado !== "lista" && "opacity-50",
											)}
										/>
									) : (
										<div
											className={cn(
												"flex h-full w-full flex-col items-center justify-center gap-1 p-1 text-center",
												a.estado !== "lista" && "opacity-50",
											)}
										>
											<FileText className="h-6 w-6" />
											<span className="line-clamp-2 break-all text-[11px]">
												{a.nombre}
											</span>
										</div>
									)}
									{a.estado === "subiendo" && (
										<Loader2 className="absolute inset-0 m-auto h-5 w-5 animate-spin" />
									)}
									{a.estado === "error" && (
										<button
											type="button"
											title={a.error}
											className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-1 bg-destructive/90 px-1 py-1 text-[11px] text-white"
											onClick={() => void subir(a.id)}
										>
											<RotateCw className="h-3 w-3" />
											Error al subir · Reintentar
										</button>
									)}
									<button
										type="button"
										aria-label={`Quitar ${a.nombre}`}
										className="absolute top-1 right-1 rounded-full bg-background/90 p-1 shadow"
										onClick={() => quitar(a.id)}
									>
										<X className="h-3.5 w-3.5" />
									</button>
								</div>
							))}
						</div>
					)}
				</section>
			</div>

			<DialogFooter className="flex-col gap-2 border-t px-4 py-3 sm:flex-col sm:px-6">
				{(intentoEnviar || subiendo) && faltante && (
					<p className="text-destructive text-sm">{faltante}</p>
				)}
				<div className="flex justify-end gap-2">
					<Button
						type="button"
						variant="outline"
						onClick={() => onOpenChange(false)}
						disabled={registrar.isPending}
					>
						Cancelar
					</Button>
					<Button
						type="button"
						onClick={enviar}
						disabled={registrar.isPending || subiendo}
					>
						{registrar.isPending && (
							<Loader2 className="mr-2 h-4 w-4 animate-spin" />
						)}
						Guardar investigación
					</Button>
				</div>
			</DialogFooter>
		</DialogContent>
	);
}
