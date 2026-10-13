import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
	ChevronDown,
	CircleAlert,
	CircleCheck,
	ExternalLink,
	FileText,
	Loader2,
	Stamp,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
	CARTAS_PODER,
	type CamposCartaPoder,
	camposVacios,
	type EstadoCivil,
	edadAl,
	type TipoCartaPoder,
	vencimientoPorDefecto,
} from "server/src/lib/carta-poder";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import {
	Command,
	CommandGroup,
	CommandItem,
	CommandList,
} from "@/components/ui/command";
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
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import { DatePicker } from "@/components/ui/react-datepicker";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { useJuridicoPermissions } from "@/hooks/usePermissions";
import { client, orpc } from "@/utils/orpc";

/** El estado civil sin elegir, en el Select (que no admite un valor vacío). */
const SIN_DATO = "sin_dato";

type Representante = (typeof CARTAS_PODER)[number]["representante"];

/** Lo que salió de generar una de las cartas elegidas. */
type CartaGenerada = {
	tipo: TipoCartaPoder;
	nombre: string;
	documentLink?: string;
	error?: string;
};

export const Route = createFileRoute("/juridico/carta-poder")({
	component: RouteComponent,
});

/** La fecha de hoy en la compu de quien llena, como la guarda el formulario. */
function hoy(): string {
	return aTexto(new Date());
}

function aTexto(fecha: Date): string {
	return `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, "0")}-${String(fecha.getDate()).padStart(2, "0")}`;
}

function aFecha(texto: string): Date | undefined {
	const [anio, mes, dia] = texto.split("-").map(Number);
	return anio && mes && dia ? new Date(anio, mes - 1, dia) : undefined;
}

const ESTADOS_CIVILES: Record<EstadoCivil, string> = {
	single: "Soltero(a)",
	married: "Casado(a)",
	divorced: "Divorciado(a)",
	widowed: "Viudo(a)",
};

type CampoDeTexto = {
	[K in keyof CamposCartaPoder]: CamposCartaPoder[K] extends string
		? string extends CamposCartaPoder[K]
			? K
			: never
		: never;
}[keyof CamposCartaPoder];

const CAMPOS_DEL_VEHICULO: Array<{ campo: CampoDeTexto; etiqueta: string }> = [
	{ campo: "tipoVehiculo", etiqueta: "Tipo" },
	{ campo: "marcaVehiculo", etiqueta: "Marca" },
	{ campo: "colorVehiculo", etiqueta: "Color" },
	{ campo: "usoVehiculo", etiqueta: "Uso" },
	{ campo: "chasisVehiculo", etiqueta: "Chasis" },
	{ campo: "motorVehiculo", etiqueta: "Motor" },
	{ campo: "serieVehiculo", etiqueta: "Serie" },
	{ campo: "lineaVehiculo", etiqueta: "Línea o estilo" },
	{ campo: "modeloVehiculo", etiqueta: "Modelo (año)" },
	{ campo: "cm3Vehiculo", etiqueta: "Centímetros cúbicos" },
	{ campo: "asientosVehiculo", etiqueta: "Asientos" },
	{ campo: "cilindrosVehiculo", etiqueta: "Cilindros" },
	{ campo: "iscvVehiculo", etiqueta: "Código ISCV" },
];

function RouteComponent() {
	const navigate = Route.useNavigate();
	const { canViewLegal, isLoading } = useJuridicoPermissions();

	// Del mismo cliente se sacan varias cartas a la vez (una por empresa y
	// representante), así que se eligen varias.
	const [tipos, setTipos] = useState<TipoCartaPoder[]>([CARTAS_PODER[0].tipo]);
	// La edad de cada representante: va en sus cartas, y las dos de Don Alex
	// llevan la misma.
	const [edades, setEdades] = useState<Partial<Record<Representante, string>>>(
		{},
	);
	const [campos, setCampos] = useState<CamposCartaPoder>(() =>
		camposVacios(hoy()),
	);
	const [creditoElegido, setCreditoElegido] = useState<{
		opportunityId: string;
		resumen: string;
	} | null>(null);
	const [generadas, setGeneradas] = useState<CartaGenerada[] | null>(null);
	// Cuántas veces cambió el formulario. Generar tarda, y el formulario sigue
	// habilitado: si cambia mientras tanto, los PDF que vuelven son de los
	// datos viejos y no se muestran.
	const versionRef = useRef(0);
	const descartarCarta = () => {
		versionRef.current += 1;
		setGeneradas(null);
	};
	// Al terminar se avisa con un modal: con un botón al pie de la página
	// nadie se daba cuenta de que la carta ya estaba lista.
	const [avisoListo, setAvisoListo] = useState(false);

	const [busqueda, setBusqueda] = useState("");
	const [busquedaDiferida, setBusquedaDiferida] = useState("");
	useEffect(() => {
		const timeout = setTimeout(() => setBusquedaDiferida(busqueda.trim()), 300);
		return () => clearTimeout(timeout);
	}, [busqueda]);

	const creditosQuery = useQuery({
		...orpc.buscarCreditosCartaPoder.queryOptions({
			input: { texto: busquedaDiferida },
		}),
		enabled: canViewLegal && busquedaDiferida.length >= 2,
	});
	const creditos = creditosQuery.data ?? [];
	const opciones: ComboboxOption[] = creditos.map((c) => ({
		value: c.opportunityId,
		label: [c.nombre, c.credito && `Crédito ${c.credito}`, c.vehiculo]
			.filter(Boolean)
			.join(" · "),
	}));

	// El crédito cuyos datos se están esperando. "Empezar de cero" lo suelta: si
	// la respuesta llega después, ya no es del formulario y no se aplica.
	const creditoPedidoRef = useRef<string | null>(null);
	// La fecha de nacimiento del crédito cargado: la edad de la carta es a la
	// fecha de firma, y se recalcula si la mueven, salvo que la hayan escrito
	// a mano.
	const fechaNacimientoRef = useRef("");
	const edadEditadaRef = useRef(false);
	const cargarDatos = useMutation({
		mutationFn: (opportunityId: string) =>
			client.datosCartaPoder({
				opportunityId,
				hoy: hoy(),
				fechaFirma: campos.fechaFirma || undefined,
			}),
		onSuccess: ({ fechaNacimiento, ...datos }, opportunityId) => {
			if (creditoPedidoRef.current !== opportunityId) return;
			fechaNacimientoRef.current = fechaNacimiento;
			edadEditadaRef.current = false;
			// La carta (fechas, país, edad del representante) es de quien llena,
			// no del crédito: cambiar de crédito no la borra.
			setCampos((actual) => ({
				...datos,
				// La edad que vino es a la fecha de firma con que se pidió: si la
				// movieron mientras cargaba, se recalcula a la de ahora.
				edad:
					fechaNacimiento && actual.fechaFirma
						? String(edadAl(fechaNacimiento, actual.fechaFirma) ?? datos.edad)
						: datos.edad,
				paisDestino: actual.paisDestino,
				fechaFirma: actual.fechaFirma,
				fechaVencimiento: actual.fechaVencimiento,
				edadRepresentante: actual.edadRepresentante,
			}));
			descartarCarta();
		},
		onError: (error: Error, opportunityId) => {
			// Si era el crédito pedido, el formulario tiene los datos del anterior
			// y el resumen dice el nuevo: se suelta todo, para no generar la carta
			// de una persona con los datos de otra.
			if (creditoPedidoRef.current === opportunityId) empezarDeCero();
			toast.error(
				error.message
					? `${error.message}. Elegí el crédito de nuevo.`
					: "No se pudieron traer los datos del crédito. Elegí el crédito de nuevo.",
			);
		},
	});

	const generar = useMutation({
		mutationFn: async () => {
			const version = versionRef.current;
			const elegidas = CARTAS_PODER.filter((c) => tipos.includes(c.tipo));
			// Todas en un solo pedido: el generador las arma una tras otra, y si
			// una falla, las demás vuelven igual.
			const { cartas } = await client.generarCartasPoder({
				cartas: elegidas.map((c) => ({
					tipo: c.tipo,
					edadRepresentante: edades[c.representante] ?? "",
				})),
				campos,
			});
			const resultado: CartaGenerada[] = cartas.map((c) => ({
				...c,
				nombre: CARTAS_PODER.find((d) => d.tipo === c.tipo)?.nombre ?? c.tipo,
			}));
			return { resultado, version };
		},
		onSuccess: ({ resultado, version }) => {
			if (version !== versionRef.current) {
				toast.info(
					"Cambiaste la carta mientras se generaba: generala de nuevo con los datos de ahora.",
				);
				return;
			}
			if (resultado.every((c) => c.error)) {
				toast.error(resultado[0]?.error || "No se pudo generar la carta poder");
				return;
			}
			setGeneradas(resultado);
			setAvisoListo(true);
		},
		onError: (error: Error) => {
			toast.error(error.message || "No se pudo generar la carta poder");
		},
	});

	if (!isLoading && !canViewLegal) {
		navigate({ to: "/dashboard" });
		return null;
	}

	const cartas = CARTAS_PODER.filter((c) => tipos.includes(c.tipo));
	// Una edad por representante, aunque firme dos de las elegidas.
	const representantes = [...new Set(cartas.map((c) => c.representante))];

	const alternarCarta = (tipo: TipoCartaPoder) => {
		setTipos((actuales) =>
			actuales.includes(tipo)
				? actuales.filter((t) => t !== tipo)
				: [...actuales, tipo],
		);
		descartarCarta();
	};

	const cambiar = <K extends keyof CamposCartaPoder>(
		campo: K,
		valor: CamposCartaPoder[K],
	) => {
		if (campo === "edad") edadEditadaRef.current = true;
		setCampos((actual) => ({ ...actual, [campo]: valor }));
		descartarCarta();
	};

	const empezarDeCero = () => {
		creditoPedidoRef.current = null;
		fechaNacimientoRef.current = "";
		edadEditadaRef.current = false;
		setCreditoElegido(null);
		setCampos((actual) => ({
			...camposVacios(actual.fechaFirma),
			paisDestino: actual.paisDestino,
			fechaVencimiento: actual.fechaVencimiento,
			edadRepresentante: actual.edadRepresentante,
		}));
		descartarCarta();
	};

	const texto = (campo: CampoDeTexto, etiqueta: string, placeholder = "") => (
		<div className="space-y-2">
			<Label htmlFor={`carta-${campo}`}>{etiqueta}</Label>
			<Input
				id={`carta-${campo}`}
				value={campos[campo]}
				placeholder={placeholder}
				onChange={(e) => cambiar(campo, e.target.value)}
				// Mientras llegan los datos del crédito: al llegar pisan el
				// formulario, y lo que se escribiera en ese rato se perdería.
				disabled={cargarDatos.isPending}
			/>
		</div>
	);

	return (
		<div className="container mx-auto space-y-6 py-8">
			<div className="flex items-center gap-3">
				<div className="flex h-12 w-12 items-center justify-center rounded-lg bg-amber-100">
					<Stamp className="h-6 w-6 text-amber-600" />
				</div>
				<div>
					<h1 className="font-bold text-3xl">Carta poder</h1>
					<p className="text-muted-foreground">
						Se imprime y se firma ante notario. Lo que deje vacío sale con un
						guion.
					</p>
				</div>
			</div>

			<Card>
				<CardHeader>
					<CardTitle>Crédito</CardTitle>
					<CardDescription>
						Busque por nombre del cliente, DPI o número de crédito para llenar
						con lo que tiene el CRM. Si no aparece, escriba los datos a mano.
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-3">
					<Combobox
						options={opciones}
						value={creditoElegido?.opportunityId ?? null}
						onChange={(opportunityId) => {
							// Volver a tocar el elegido lo suelta ("" ): es empezar de cero,
							// no pedir los datos de un crédito vacío.
							if (!opportunityId) {
								empezarDeCero();
								return;
							}
							const opcion = opciones.find((o) => o.value === opportunityId);
							setCreditoElegido({
								opportunityId,
								resumen: opcion?.label ?? "",
							});
							creditoPedidoRef.current = opportunityId;
							// Lo que se esté generando es del crédito anterior.
							descartarCarta();
							cargarDatos.mutate(opportunityId);
						}}
						onSearchChange={setBusqueda}
						isLoading={creditosQuery.isFetching}
						placeholder="Buscar crédito…"
						width="full"
						popOverWidth="full"
						disabled={cargarDatos.isPending}
					/>
					{creditoElegido && (
						<div className="flex flex-col gap-2 rounded-md border bg-muted/40 p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
							<span className="flex items-center gap-2">
								{cargarDatos.isPending && (
									<Loader2 className="h-4 w-4 animate-spin" />
								)}
								{creditoElegido.resumen}
							</span>
							<Button variant="ghost" size="sm" onClick={empezarDeCero}>
								Empezar de cero
							</Button>
						</div>
					)}
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Carta</CardTitle>
					<CardDescription>
						Quién la otorga, cuándo se firma y a qué país se viaja.
					</CardDescription>
				</CardHeader>
				<CardContent className="grid gap-4 md:grid-cols-2">
					<div className="space-y-2">
						<Label htmlFor="carta-tipo">Empresa y representante</Label>
						<Popover>
							<PopoverTrigger asChild>
								<Button
									id="carta-tipo"
									variant="outline"
									className="w-full justify-between font-normal"
								>
									<span
										className={
											cartas.length
												? "truncate"
												: "truncate text-muted-foreground"
										}
									>
										{cartas.length
											? cartas.map((c) => c.nombre).join(", ")
											: "Elija una o varias cartas"}
									</span>
									<ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
								</Button>
							</PopoverTrigger>
							<PopoverContent
								className="w-(--radix-popover-trigger-width) p-0"
								align="start"
							>
								<Command>
									<CommandList>
										<CommandGroup>
											{CARTAS_PODER.map((c) => (
												<CommandItem
													key={c.tipo}
													onSelect={() => alternarCarta(c.tipo)}
												>
													<Checkbox
														checked={tipos.includes(c.tipo)}
														className="mr-2"
													/>
													{c.nombre}
												</CommandItem>
											))}
										</CommandGroup>
									</CommandList>
								</Command>
							</PopoverContent>
						</Popover>
						{cartas.length === 0 && (
							<p className="text-muted-foreground text-sm">
								Elija al menos una para poder generar.
							</p>
						)}
					</div>
					{representantes.map((representante) => (
						<div key={representante} className="space-y-2">
							<Label htmlFor={`carta-edad-${representante}`}>
								Edad de {representante}
							</Label>
							<Input
								id={`carta-edad-${representante}`}
								value={edades[representante] ?? ""}
								placeholder="En número, ej. 42"
								onChange={(e) => {
									setEdades((actuales) => ({
										...actuales,
										[representante]: e.target.value,
									}));
									descartarCarta();
								}}
							/>
						</div>
					))}
					<div className="space-y-2">
						<Label>Fecha de firma</Label>
						<DatePicker
							date={aFecha(campos.fechaFirma)}
							onDateChange={(fecha) => {
								const fechaFirma = fecha ? aTexto(fecha) : "";
								// La edad del cliente es a la fecha de firma.
								const edad =
									fechaFirma &&
									fechaNacimientoRef.current &&
									!edadEditadaRef.current
										? edadAl(fechaNacimientoRef.current, fechaFirma)
										: null;
								// Vence al año: se recalcula al mover la firma.
								setCampos((actual) => ({
									...actual,
									fechaFirma,
									fechaVencimiento: fechaFirma
										? vencimientoPorDefecto(fechaFirma)
										: actual.fechaVencimiento,
									...(edad !== null ? { edad: String(edad) } : {}),
								}));
								descartarCarta();
							}}
						/>
					</div>
					<div className="space-y-2">
						<Label>Vence</Label>
						<DatePicker
							date={aFecha(campos.fechaVencimiento)}
							onDateChange={(fecha) =>
								cambiar("fechaVencimiento", fecha ? aTexto(fecha) : "")
							}
						/>
					</div>
					{texto("paisDestino", "País al que viaja", "Ej. El Salvador")}
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Cliente</CardTitle>
					<CardDescription>
						El nombre sale en mayúsculas; edad y DPI se pasan a letras.
					</CardDescription>
				</CardHeader>
				<CardContent className="grid gap-4 md:grid-cols-2">
					<div className="space-y-2">
						<Label htmlFor="carta-genero">Género</Label>
						<Select
							value={campos.genero}
							disabled={cargarDatos.isPending}
							onValueChange={(valor) =>
								cambiar("genero", valor as CamposCartaPoder["genero"])
							}
						>
							<SelectTrigger id="carta-genero" className="w-full">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="male">Hombre</SelectItem>
								<SelectItem value="female">Mujer</SelectItem>
							</SelectContent>
						</Select>
					</div>
					{texto("nombreCompleto", "Nombre completo")}
					{texto("edad", "Edad", "En número, ej. 35")}
					<div className="space-y-2">
						<Label htmlFor="carta-estado-civil">Estado civil</Label>
						<Select
							// El Select no admite un valor vacío: "Sin dato" lo representa,
							// para poder quitar uno que vino mal del CRM.
							value={campos.estadoCivil || SIN_DATO}
							disabled={cargarDatos.isPending}
							onValueChange={(valor) =>
								cambiar(
									"estadoCivil",
									valor === SIN_DATO ? "" : (valor as EstadoCivil),
								)
							}
						>
							<SelectTrigger id="carta-estado-civil" className="w-full">
								<SelectValue placeholder="Sin dato" />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value={SIN_DATO}>Sin dato</SelectItem>
								{(Object.keys(ESTADOS_CIVILES) as EstadoCivil[]).map((e) => (
									<SelectItem key={e} value={e}>
										{ESTADOS_CIVILES[e]}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>
					{texto("profesion", "Profesión u oficio")}
					{texto("nacionalidad", "Nacionalidad", "Ej. guatemalteco")}
					{texto("dpi", "DPI", "13 dígitos")}
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Vehículo</CardTitle>
					<CardDescription>
						Como aparece en la tarjeta de circulación.
					</CardDescription>
				</CardHeader>
				<CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
					{CAMPOS_DEL_VEHICULO.map(({ campo, etiqueta }) => (
						<div key={campo}>{texto(campo, etiqueta)}</div>
					))}
				</CardContent>
			</Card>

			<div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-end">
				{generadas && (
					<Button variant="outline" onClick={() => setAvisoListo(true)}>
						<ExternalLink className="mr-2 h-4 w-4" />
						{generadas.length === 1 ? "Ver la carta" : "Ver las cartas"}
					</Button>
				)}
				<Button
					onClick={() => generar.mutate()}
					// Sin ninguna carta elegida no hay qué generar.
					disabled={
						generar.isPending || cargarDatos.isPending || cartas.length === 0
					}
				>
					{generar.isPending ? (
						<Loader2 className="mr-2 h-4 w-4 animate-spin" />
					) : (
						<FileText className="mr-2 h-4 w-4" />
					)}
					{generar.isPending
						? "Generando…"
						: cartas.length > 1
							? `Generar ${cartas.length} PDF`
							: "Generar PDF"}
				</Button>
			</div>

			<Dialog open={avisoListo} onOpenChange={setAvisoListo}>
				<DialogContent>
					<DialogHeader className="items-center text-center sm:text-center">
						<div className="mb-2 flex h-14 w-14 items-center justify-center rounded-full bg-green-100">
							<CircleCheck className="h-8 w-8 text-green-600" />
						</div>
						<DialogTitle>
							{generadas?.length === 1
								? "La carta poder está lista"
								: "Las cartas poder están listas"}
						</DialogTitle>
						<DialogDescription>
							{campos.nombreCompleto.trim() &&
								`${generadas?.length === 1 ? "La" : "Las"} de ${campos.nombreCompleto.trim()}. `}
							{generadas?.length === 1 ? "El PDF" : "Cada PDF"} se abre en otra
							pestaña, desde ahí lo descarga o lo imprime para firmarlo ante
							notario.
						</DialogDescription>
					</DialogHeader>
					<ul className="divide-y rounded-md border">
						{generadas?.map((c) => (
							<li
								key={c.tipo}
								className="flex items-center justify-between gap-3 p-3 text-sm"
							>
								<div className="min-w-0">
									<p className="font-medium">{c.nombre}</p>
									{c.error && (
										<p className="flex items-center gap-1 text-destructive">
											<CircleAlert className="h-4 w-4 shrink-0" />
											{c.error}
										</p>
									)}
								</div>
								{c.documentLink && (
									<Button asChild size="sm">
										<a
											href={c.documentLink}
											target="_blank"
											rel="noopener noreferrer"
										>
											<ExternalLink className="mr-2 h-4 w-4" />
											Abrir PDF
										</a>
									</Button>
								)}
							</li>
						))}
					</ul>
					{generadas?.some((c) => c.error) && (
						<p className="text-muted-foreground text-sm">
							Las que no salieron se pueden generar de nuevo: deje marcadas solo
							esas y vuelva a generar.
						</p>
					)}
					<DialogFooter className="sm:justify-center">
						<Button variant="outline" onClick={() => setAvisoListo(false)}>
							Cerrar
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
}
