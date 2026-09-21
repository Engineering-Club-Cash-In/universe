import { useMutation } from "@tanstack/react-query";
import {
	CheckCircle2,
	Clock,
	Copy,
	ExternalLink,
	Eye,
	FileSignature,
	FileText,
	Loader2,
	RefreshCw,
	TriangleAlert,
} from "lucide-react";
import { useState } from "react";
import { esFirmaFisica } from "server/src/lib/contract-signature-mode";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
	type FirmanteDeContrato,
	firmantesEnFicha,
} from "@/lib/contract-signers-display";
import { getContractTypeLabel } from "@/lib/crm-formatters";
import { client } from "@/utils/orpc";
import { ReenviarWhatsappDialog } from "./ReenviarWhatsappDialog";
import { RegenerarEnlacesDialog } from "./RegenerarEnlacesDialog";

/**
 * La card de "Contratos Legales" que aparece en el detalle de una oportunidad.
 *
 * Vive acá porque se muestra en dos lados (el modal de detalle de CRM y el de
 * oportunidades) y estaba duplicada: cada copia se fue quedando con una versión
 * distinta de los enlaces de firma.
 */

interface ContratoDeOportunidad {
	id: string;
	contractName: string;
	contractType: string;
	status: "pending" | "signed" | "cancelled";
	pdfLink?: string | null;
	opportunityId?: string | null;
	clientSigningLink: string | null;
	representativeSigningLink: string | null;
	additionalSigningLinks: string[] | null;
	/** Cuándo se consultó por última vez a WeeTrust cómo va la firma. */
	signingStatusCheckedAt?: Date | string | null;
	/** Enlace de observador: ver el documento y su avance sin poder firmar. */
	observerUrl?: string | null;
	/** `documenso` cuando WeeTrust falló y se usó el fallback. */
	signingProvider?: string | null;
}

export interface FilaDeContrato {
	contract: ContratoDeOportunidad;
	signatories?: FirmanteDeContrato[];
}

interface OpportunityContractsCardProps {
	contracts: FilaDeContrato[] | undefined;
	isLoading?: boolean;
	/**
	 * Si quien mira puede regenerar enlaces. Es de análisis: ventas y
	 * contabilidad ven la card pero no ese botón.
	 */
	puedeRegenerar?: boolean;
	/** Se llama cuando cambia el estado, para refrescar la lista. */
	onUpdate?: () => void;
}

const ESTADO = {
	pending: {
		label: "Pendiente",
		className:
			"border-yellow-500/50 bg-yellow-500/15 text-yellow-700 dark:text-yellow-400",
	},
	signed: {
		label: "Firmado",
		className:
			"border-green-500/50 bg-green-500/15 text-green-700 dark:text-green-400",
	},
	cancelled: {
		label: "Cancelado",
		className: "border-red-500/50 bg-red-500/15 text-red-700 dark:text-red-400",
	},
} as const;

export function OpportunityContractsCard({
	contracts,
	isLoading = false,
	puedeRegenerar = false,
	onUpdate,
}: OpportunityContractsCardProps) {
	return (
		<div className="space-y-3 rounded-lg border bg-muted/30 p-4">
			<div className="flex items-center gap-2">
				<FileSignature className="h-5 w-5 text-muted-foreground" />
				<Label className="font-semibold text-muted-foreground text-sm">
					Contratos Legales
				</Label>
				{contracts && contracts.length > 0 && (
					<span className="text-muted-foreground text-xs">
						{contracts.length}
					</span>
				)}
			</div>

			{isLoading ? (
				<p className="text-muted-foreground text-sm">Cargando contratos...</p>
			) : !contracts || contracts.length === 0 ? (
				<p className="text-muted-foreground text-sm">
					No hay contratos asociados a esta oportunidad
				</p>
			) : (
				<div className="space-y-2">
					{contracts.map((fila) => (
						<ContratoFila
							key={fila.contract.id}
							fila={fila}
							puedeRegenerar={puedeRegenerar}
							onUpdate={onUpdate}
						/>
					))}
				</div>
			)}
		</div>
	);
}

/**
 * Un contrato de la lista, con el estado de cada firmante y las acciones.
 *
 * Es un componente aparte porque cada contrato tiene sus propias consultas en
 * vuelo: refrescar el estado de uno no tiene por qué poner a girar los botones
 * de los demás.
 */
function ContratoFila({
	fila,
	puedeRegenerar: tienePermiso,
	onUpdate,
}: {
	fila: FilaDeContrato;
	puedeRegenerar: boolean;
	onUpdate?: () => void;
}) {
	const { contract, signatories } = fila;
	const firmaEnPapel = esFirmaFisica(contract.contractType);
	const firmantes = firmaEnPapel ? [] : firmantesEnFicha(signatories, contract);
	const estado = ESTADO[contract.status];
	const hayVencidos = firmantes.some((f) => f.vencido);
	const todosFirmaron =
		firmantes.length > 0 && firmantes.every((f) => f.estado === "signed");
	const alguienFirmo = firmantes.some((f) => f.estado === "signed");

	// Regenerar aparece una vez que alguien firmó, incluso si ya firmaron todos:
	// es el caso en que la firma existe pero no sirve (por ejemplo, una
	// identificación que no era la del cliente). También si algún enlace venció,
	// que si no dejaría a esa persona sin forma de firmar.
	// Los que cayeron al fallback de Documenso no tienen documento en WeeTrust:
	// consultar o regenerar sólo devolvería un error.
	const enWeeTrust = contract.signingProvider !== "documenso";
	// Un anulado ya fue reemplazado por otro: reemitirlo lo resucitaría.
	const puedeRegenerar =
		tienePermiso &&
		enWeeTrust &&
		contract.status !== "cancelled" &&
		(alguienFirmo || hayVencidos);

	const actualizarEstado = useMutation({
		mutationFn: () =>
			client.getContractSigningStatus({ contractId: contract.id }),
		onSuccess: (data) => {
			const firmados = data.signatories.filter((f) => f.isSigned).length;
			toast.success(
				`${firmados} de ${data.signatories.length} firmaron (${data.status})`,
			);
			onUpdate?.();
		},
		onError: (error: Error) => toast.error(error.message),
	});

	const [preguntarReenvio, setPreguntarReenvio] = useState(false);

	const [regenerando, setRegenerando] = useState(false);

	const ocupado = actualizarEstado.isPending;

	return (
		<div className="rounded-md border bg-background p-3">
			{/* Encabezado: qué contrato es y cómo va */}
			<div className="flex items-start justify-between gap-3">
				<div className="min-w-0">
					<p className="truncate font-medium text-sm">
						{contract.contractName}
					</p>
					<p className="truncate text-muted-foreground text-xs">
						{getContractTypeLabel(contract.contractType)}
					</p>
				</div>
				<div className="flex shrink-0 items-center gap-2">
					<Badge variant="outline" className={`${estado.className} text-xs`}>
						{estado.label}
					</Badge>
					{/* El de observador es el link que importa acá: muestra el documento
					    y cómo va la firma, y es el único que se puede abrir sin quedar
					    firmando en nombre de alguien. */}
					{contract.observerUrl && (
						<Button
							variant="outline"
							size="sm"
							asChild
							className="h-7 text-purple-600 hover:text-purple-700 dark:text-purple-400 dark:hover:text-purple-300"
						>
							<a
								href={contract.observerUrl}
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
					{contract.pdfLink && (
						<Button variant="outline" size="sm" asChild className="h-7">
							<a
								href={contract.pdfLink}
								target="_blank"
								rel="noopener noreferrer"
								className="flex items-center gap-1"
							>
								<FileText className="h-3 w-3" />
								PDF
							</a>
						</Button>
					)}
				</div>
			</div>

			{firmaEnPapel ? (
				<p className="mt-3 border-t pt-2 text-amber-700 text-xs dark:text-amber-400">
					Se firma en papel. No lleva enlace de firma.
				</p>
			) : (
				<div className="mt-3 space-y-2 border-t pt-2">
					{/* Una fila por firmante: el estado es de cada link, no del
					    contrato. Puede haber uno firmado y otro con el link vencido. */}
					{firmantes.length > 0 ? (
						<div className="space-y-1">
							{firmantes.map((firmante) => (
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
													? "Link vencido"
													: "Pendiente"}
										</span>
										{/* Copiar va primero: casi siempre el link se le pasa a
										    alguien, y abrirlo desde acá te deja firmando en su
										    nombre. */}
										{firmante.url && firmante.estado !== "signed" && (
											<>
												<Button
													variant="ghost"
													size="sm"
													className="ml-1 h-6 w-6 p-0"
													title={`Copiar el enlace de ${firmante.etiqueta}`}
													onClick={() => {
														navigator.clipboard.writeText(
															firmante.url as string,
														);
														toast.success(
															`Enlace de ${firmante.etiqueta} copiado`,
														);
													}}
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
							))}
						</div>
					) : (
						<p className="text-muted-foreground text-xs">
							Sin enlaces de firma
						</p>
					)}

					{/* Acciones discretas: se usan de vez en cuando y no tienen por qué
					    competir con los firmantes, que es lo que se viene a mirar. */}
					<div className="flex flex-wrap items-center gap-1">
						{/* Con todo firmado no hay nada que actualizar ni que regenerar:
						    el documento está cerrado. Acá sólo se regeneran enlaces del
						    MISMO documento; reemplazarlo por otro es de jurídico y vive
						    en su ficha. */}
						{enWeeTrust && !todosFirmaron && (
							<Button
								variant="ghost"
								size="sm"
								className="h-6 px-1.5 text-muted-foreground text-xs hover:text-foreground"
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
						)}

						{puedeRegenerar && (
							<Button
								variant="ghost"
								size="sm"
								className={
									hayVencidos
										? "h-6 px-1.5 text-amber-600 text-xs dark:text-amber-400"
										: "h-6 px-1.5 text-muted-foreground text-xs hover:text-foreground"
								}
								disabled={ocupado}
								onClick={() => setRegenerando(true)}
								title="Vuelve a emitir el mismo documento con enlaces nuevos para todos. Los anteriores dejan de servir."
							>
								<RefreshCw className="mr-1 h-3 w-3" />
								{hayVencidos ? "Regenerar (hay vencidos)" : "Regenerar enlaces"}
							</Button>
						)}
					</div>
				</div>
			)}

			<RegenerarEnlacesDialog
				contractId={contract.id}
				contractName={contract.contractName}
				hayFirmas={alguienFirmo}
				open={regenerando}
				onOpenChange={setRegenerando}
				onRegenerado={() => {
					onUpdate?.();
					setPreguntarReenvio(true);
				}}
			/>

			<ReenviarWhatsappDialog
				opportunityId={contract.opportunityId ?? null}
				open={preguntarReenvio}
				onOpenChange={setPreguntarReenvio}
			/>
		</div>
	);
}
