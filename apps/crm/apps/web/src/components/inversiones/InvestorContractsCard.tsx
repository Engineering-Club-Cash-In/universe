import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	CheckCircle2,
	ChevronDown,
	Clock,
	Copy,
	ExternalLink,
	Eye,
	FileSignature,
	FileText,
	Landmark,
	Loader2,
	RefreshCw,
	RotateCcw,
	TriangleAlert,
} from "lucide-react";
import { useState } from "react";
import type { MOTIVOS_DE_ANULACION } from "server/src/lib/contratos-anulacion";
import { toast } from "sonner";
import { RegenerarEnlacesDialog } from "@/components/contracts/RegenerarEnlacesDialog";
import {
	EtiquetaSubidoAMano,
	RevisarSubidoAMano,
} from "@/components/contracts/SubidoAMano";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	ETIQUETAS_DE_INVERSIONES,
	estaAnulado,
	type FirmanteDeContrato,
	firmantesEnFicha,
} from "@/lib/contract-signers-display";
import { client, orpc } from "@/utils/orpc";

interface ContratoDeInversionista {
	id: string;
	contractName: string;
	contractType: string;
	status: "pending" | "signed" | "cancelled";
	/** Cuándo se emitió: es lo que distingue una compra de la siguiente. */
	generatedAt?: Date | string | null;
	observerUrl?: string | null;
	clientSigningLink: string | null;
	representativeSigningLink: string | null;
	additionalSigningLinks: string[] | null;
	signingStatusCheckedAt?: Date | string | null;
	/** URL firmada del PDF. Vence: se pide en cada consulta. */
	pdfUrl?: string | null;
	/** Si lo que sirve `pdfUrl` es el documento firmado o el borrador. */
	pdfFirmado?: boolean;
	/** La respuesta del generador. De acá sale si lo subieron a mano. */
	apiResponse?: unknown;
	/** De qué compra salió. Es lo que agrupa la ficha. */
	bateria?: {
		id: string;
		acceptedAt: Date | string;
		montoTotal: string;
	} | null;
	cancellationReason?: string | null;
	replacedByContractId?: string | null;
	firmantes?: FirmanteDeContrato[];
}

const ESTADO: Record<string, { label: string; className: string }> = {
	pending: {
		label: "En firma",
		className: "border-blue-200 text-blue-700 dark:text-blue-400",
	},
	signed: {
		label: "Firmado",
		className: "border-green-200 text-green-700 dark:text-green-400",
	},
	cancelled: {
		label: "Anulado",
		className: "border-muted text-muted-foreground",
	},
};

/**
 * La fecha de emisión, corta.
 *
 * Va en cada fila porque el inversionista hace varias compras de cartera con
 * los meses y cada una emite los mismos contratos: sin esto la ficha muestra
 * tres "Contrato de Participación" iguales y no se sabe cuál es de cuál.
 */
function emitidoEl(fecha: Date | string | null | undefined): string | null {
	if (!fecha) return null;
	const d = fecha instanceof Date ? fecha : new Date(fecha);
	if (Number.isNaN(d.getTime())) return null;
	return d.toLocaleDateString("es-GT", {
		day: "2-digit",
		month: "short",
		year: "numeric",
	});
}

function copiar(url: string, etiqueta: string) {
	navigator.clipboard.writeText(url);
	toast.success(`${etiqueta} copiado`);
}

/** Un contrato, con quién firma y qué se puede hacer con él. */
function FilaDeContrato({
	contrato,
	onCambio,
}: {
	contrato: ContratoDeInversionista;
	onCambio: () => void;
}) {
	const [regenerando, setRegenerando] = useState(false);

	const estado = ESTADO[contrato.status] ?? ESTADO.pending;
	const inactivo = estaAnulado(contrato);
	const firmantes = firmantesEnFicha(
		contrato.firmantes,
		contrato,
		ETIQUETAS_DE_INVERSIONES,
	);

	const actualizarEstado = useMutation({
		mutationFn: () =>
			client.getInvestorContractSigningStatus({ contractId: contrato.id }),
		onSuccess: (estadoDeFirma) => {
			const firmados = estadoDeFirma.signatories.filter(
				(f) => f.isSigned,
			).length;
			toast.success(
				`${firmados} de ${estadoDeFirma.signatories.length} firmaron`,
			);
			onCambio();
		},
		onError: (error: Error) => toast.error(error.message),
	});

	const ocupado = actualizarEstado.isPending;

	const alguienFirmo = firmantes.some((f) => f.estado === "signed");
	const hayVencidos = firmantes.some((f) => f.vencido);
	const puedeRegenerar = alguienFirmo || hayVencidos;

	return (
		<div className="rounded-md border bg-background p-2.5">
			{/* Encabezado: qué contrato es, cómo va y el enlace de seguimiento */}
			<div className="flex flex-wrap items-start justify-between gap-2">
				<div className="min-w-0 flex-1">
					<p className="truncate font-medium text-sm">
						{contrato.contractName}
					</p>
					{emitidoEl(contrato.generatedAt) && (
						<p className="truncate text-[11px] text-muted-foreground">
							{emitidoEl(contrato.generatedAt)}
						</p>
					)}
				</div>
				<div className="flex flex-wrap items-center justify-end gap-1">
					<EtiquetaSubidoAMano apiResponse={contrato.apiResponse} />
					<Badge variant="outline" className={`${estado.className} text-xs`}>
						{estado.label}
					</Badge>
					{/* El documento, sin entrar a WeeTrust. Mientras se firma es el
					    borrador que se emitió; cuando terminan de firmar es el firmado,
					    que se baja una sola vez y queda guardado. */}
					{contrato.pdfUrl && (
						<Button variant="outline" size="sm" asChild className="h-6 px-2 text-xs">
							<a
								href={contrato.pdfUrl}
								target="_blank"
								rel="noopener noreferrer"
								className="flex items-center gap-1"
								title={
									contrato.pdfFirmado
										? "Abrir el PDF con las firmas"
										: "Abrir el PDF del contrato, todavía sin firmas"
								}
							>
								<FileText className="h-3 w-3" />
								{contrato.pdfFirmado ? "PDF firmado" : "PDF"}
							</a>
						</Button>
					)}
					{/* El de observador es el único que se puede pasar sin riesgo:
					    muestra el documento y cómo va la firma, sin dejar firmar. */}
					{contrato.observerUrl && !inactivo && (
						<Button
							variant="outline"
							size="sm"
							asChild
							className="h-6 px-2 text-[11px] text-muted-foreground hover:bg-violet-50 hover:text-violet-700 dark:hover:bg-violet-950/40 dark:hover:text-violet-300"
						>
							<a
								href={contrato.observerUrl}
								target="_blank"
								rel="noopener noreferrer"
								className="flex items-center gap-1"
								title="Ver el documento y cómo va la firma (no permite firmar)"
							>
								<Eye className="h-3 w-3" />
								Seguimiento
							</a>
						</Button>
					)}
				</div>
			</div>

			{/* Mientras falta firmar, el subido a mano pide un vistazo: después ya no
			    hay nada que corregir. */}
			{contrato.status !== "signed" && !inactivo && (
				<div className="mt-3">
					<RevisarSubidoAMano
						apiResponse={contrato.apiResponse}
						observerUrl={contrato.observerUrl}
					/>
				</div>
			)}

			{/* Una fila por firmante: el estado es de cada enlace, no del contrato */}
			<div className="mt-2 space-y-0.5 border-t pt-1.5">
				{firmantes.length === 0 ? (
					<p className="text-muted-foreground text-xs">
						Sin firmantes guardados.
					</p>
				) : (
					firmantes.map((firmante) => (
						<div
							key={firmante.clave}
							className="flex items-center justify-between gap-2"
						>
							<div className="flex min-w-0 items-center gap-1.5">
								{firmante.estado === "signed" ? (
									<CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-green-600 dark:text-green-400" />
								) : firmante.vencido ? (
									<TriangleAlert className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
								) : (
									<Clock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
								)}
								<span className="shrink-0 font-medium text-xs">
									{firmante.etiqueta}
								</span>
								{firmante.nombre && (
									<span className="truncate text-muted-foreground text-xs">
										{firmante.nombre}
									</span>
								)}
							</div>

							<div className="flex shrink-0 items-center gap-0.5">
								<span
									className={
										firmante.estado === "signed"
											? "text-green-600 text-xs dark:text-green-400"
											: firmante.vencido
												? "text-amber-600 text-xs dark:text-amber-400"
												: "text-muted-foreground text-xs"
									}
								>
									{firmante.estado === "signed"
										? "Firmado"
										: firmante.vencido
											? "Enlace vencido"
											: "Pendiente"}
								</span>
								{/* Copiar va primero: el enlace casi siempre se le pasa a
								    alguien, y abrirlo desde acá deja firmando en su nombre. */}
								{firmante.url && firmante.estado !== "signed" && !inactivo && (
									<>
										<Button
											variant="ghost"
											size="sm"
											className="ml-1 h-6 w-6 p-0"
											title={`Copiar el enlace de ${firmante.etiqueta}`}
											onClick={() =>
												copiar(
													firmante.url as string,
													`Enlace de ${firmante.etiqueta}`,
												)
											}
										>
											<Copy className="h-3 w-3" />
										</Button>
										<Button
											variant="ghost"
											size="sm"
											asChild
											className="h-6 w-6 p-0"
										>
											<a
												href={firmante.url}
												target="_blank"
												rel="noopener noreferrer"
												title={`Abrir el enlace de ${firmante.etiqueta}`}
											>
												<ExternalLink className="h-3 w-3" />
											</a>
										</Button>
									</>
								)}
							</div>
						</div>
					))
				)}
			</div>

			{/* Acciones */}
			{!inactivo && (
				<div className="mt-2 flex flex-wrap items-center gap-1 border-t pt-1.5">
					<Button
						variant="ghost"
						size="sm"
						className="h-6 text-[11px]"
						disabled={ocupado}
						onClick={() => actualizarEstado.mutate()}
					>
						{actualizarEstado.isPending ? (
							<Loader2 className="mr-1 h-3 w-3 animate-spin" />
						) : (
							<RefreshCw className="mr-1 h-3 w-3" />
						)}
						Actualizar estado
					</Button>

					{/* Con la misma regla que en ventas: aparece una vez que alguien
					    firmó —incluso si firmaron todos, que es el caso en que la firma
					    existe pero no sirve— o si algún enlace venció, que si no
					    dejaría a esa persona sin forma de firmar. Antes de eso no hay
					    nada que renovar y el botón sólo sirve para tirar abajo los
					    enlaces que acaban de salir. */}
					{puedeRegenerar && (
						<Button
							variant="ghost"
							size="sm"
							className="h-6 text-[11px]"
							disabled={ocupado}
							onClick={() => setRegenerando(true)}
						>
							<RotateCcw className="mr-1 h-3 w-3" />
							Regenerar enlaces
						</Button>
					)}

					{contrato.signingStatusCheckedAt && (
						<span className="ml-auto text-muted-foreground text-xs">
							Revisado{" "}
							{new Date(contrato.signingStatusCheckedAt).toLocaleString(
								"es-GT",
								{
									dateStyle: "short",
									timeStyle: "short",
								},
							)}
						</span>
					)}
				</div>
			)}

			<RegenerarEnlacesDialog
				contractId={contrato.id}
				contractName={contrato.contractName}
				hayFirmas={firmantes.some((f) => f.estado === "signed")}
				open={regenerando}
				onOpenChange={setRegenerando}
				onRegenerado={onCambio}
				regenerar={(motivo: keyof typeof MOTIVOS_DE_ANULACION) =>
					client.refreshInvestorContractSigningLinks({
						contractId: contrato.id,
						motivo,
					})
				}
			/>
		</div>
	);
}

/** Cómo se lee una compra: la fecha en que se aceptó y lo que puso. */
function tituloDeLaCompra(bateria: ContratoDeInversionista["bateria"]): string {
	if (!bateria) return "Sin compra asociada";
	const fecha = new Date(bateria.acceptedAt).toLocaleDateString("es-GT", {
		day: "2-digit",
		month: "short",
		year: "numeric",
	});
	const monto = new Intl.NumberFormat("es-GT", {
		style: "currency",
		currency: "GTQ",
	}).format(Number(bateria.montoTotal));
	return `Compra del ${fecha} · ${monto}`;
}

/**
 * Los contratos agrupados por la compra que los originó, de la más nueva a la
 * más vieja.
 *
 * Un inversionista que compra cartera tres veces termina con los mismos
 * contratos repetidos: sin agrupar, la ficha es una lista de nombres iguales.
 */
function porCompra(contratos: ContratoDeInversionista[]) {
	const grupos = new Map<string, ContratoDeInversionista[]>();
	for (const contrato of contratos) {
		const clave = contrato.bateria?.id ?? "sin-bateria";
		grupos.set(clave, [...(grupos.get(clave) ?? []), contrato]);
	}

	return [...grupos.values()].sort((a, b) => {
		const fechaA = a[0]?.bateria?.acceptedAt;
		const fechaB = b[0]?.bateria?.acceptedAt;
		if (!fechaA) return 1;
		if (!fechaB) return -1;
		return new Date(fechaB).getTime() - new Date(fechaA).getTime();
	});
}

/**
 * Los contratos de inversión de una persona, con sus enlaces de firma.
 *
 * Los emite jurídico, pero quien los usa es inversiones: de acá salen el enlace
 * de observador y el de cada firmante.
 */
export function InvestorContractsCard({
	inversionistaId,
}: {
	inversionistaId: number;
}) {
	const queryClient = useQueryClient();
	const [verAnulados, setVerAnulados] = useState(false);

	const contratosQuery = useQuery(
		orpc.listInvestorContracts.queryOptions({
			input: { investorId: inversionistaId },
		}),
	);

	const refrescar = () =>
		queryClient.invalidateQueries({
			predicate: (query) =>
				JSON.stringify(query.queryKey).includes("listInvestorContracts"),
		});

	const contratos = (contratosQuery.data ?? []) as ContratoDeInversionista[];
	const vigentes = contratos.filter((c) => !estaAnulado(c));
	const anulados = contratos.filter((c) => estaAnulado(c));

	return (
		<Card>
			<CardHeader className="pb-3">
				<div className="flex items-start justify-between gap-3">
					<div>
						<CardTitle className="flex items-center gap-2 text-base">
							<FileSignature className="h-4 w-4" />
							Contratos
						</CardTitle>
						<CardDescription>
							Los emite jurídico; acá están sus enlaces de firma
						</CardDescription>
					</div>
					<Button
						variant="outline"
						size="icon"
						className="h-8 w-8"
						onClick={() => contratosQuery.refetch()}
						disabled={contratosQuery.isFetching}
						title="Volver a cargar"
					>
						<RefreshCw
							className={`h-4 w-4 ${contratosQuery.isFetching ? "animate-spin" : ""}`}
						/>
					</Button>
				</div>
			</CardHeader>

			<CardContent className="space-y-4">
				{contratosQuery.isLoading ? (
					<div className="flex items-center gap-2 py-6 text-muted-foreground text-sm">
						<Loader2 className="h-4 w-4 animate-spin" />
						Cargando contratos...
					</div>
				) : contratos.length === 0 ? (
					<p className="py-6 text-center text-muted-foreground text-sm">
						Sin contratos emitidos
					</p>
				) : (
					<>
						{porCompra(vigentes).map((grupo) => (
							<div
								key={grupo[0]?.bateria?.id ?? "sin-bateria"}
								className="rounded-lg border bg-muted/40 p-2.5"
							>
								<div className="mb-2 flex items-center gap-2">
									<Landmark className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
									<p className="font-medium text-foreground/80 text-xs">
										{tituloDeLaCompra(grupo[0]?.bateria)}
									</p>
									<Badge
										variant="secondary"
										className="h-5 px-1.5 text-[11px]"
									>
										{grupo.length}
									</Badge>
								</div>

								{/* En rejilla: a lo ancho, una fila por contrato hacía una
								    pantalla larguísima con seis documentos. */}
								<div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
									{grupo.map((contrato) => (
										<FilaDeContrato
											key={contrato.id}
											contrato={contrato}
											onCambio={refrescar}
										/>
									))}
								</div>
							</div>
						))}

						{anulados.length > 0 && (
							<div className="pt-1">
								<Button
									variant="ghost"
									size="sm"
									className="h-7 text-muted-foreground text-xs"
									onClick={() => setVerAnulados((v) => !v)}
								>
									<ChevronDown
										className={`mr-1 h-3 w-3 transition-transform ${verAnulados ? "rotate-180" : ""}`}
									/>
									{verAnulados ? "Ocultar" : "Ver"} anulados ({anulados.length})
								</Button>

								{verAnulados && (
									<div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
										{anulados.map((contrato) => (
											<FilaDeContrato
												key={contrato.id}
												contrato={contrato}
												onCambio={refrescar}
											/>
										))}
									</div>
								)}
							</div>
						)}
					</>
				)}
			</CardContent>
		</Card>
	);
}
