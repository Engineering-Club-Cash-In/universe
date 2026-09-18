import { useMutation } from "@tanstack/react-query";
import {
	CheckCircle2,
	Clock,
	ExternalLink,
	FileSignature,
	FileText,
	Loader2,
	RefreshCw,
	TriangleAlert,
} from "lucide-react";
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
	clientSigningLink: string | null;
	representativeSigningLink: string | null;
	additionalSigningLinks: string[] | null;
	/** Cuándo se consultó por última vez a WeeTrust cómo va la firma. */
	signingStatusCheckedAt?: Date | string | null;
}

export interface FilaDeContrato {
	contract: ContratoDeOportunidad;
	signatories?: FirmanteDeContrato[];
}

interface OpportunityContractsCardProps {
	contracts: FilaDeContrato[] | undefined;
	isLoading?: boolean;
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
	onUpdate,
}: {
	fila: FilaDeContrato;
	onUpdate?: () => void;
}) {
	const { contract, signatories } = fila;
	const firmaEnPapel = esFirmaFisica(contract.contractType);
	const firmantes = firmaEnPapel ? [] : firmantesEnFicha(signatories, contract);
	const estado = ESTADO[contract.status];
	const hayVencidos = firmantes.some((f) => f.vencido);

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

	const regenerarEnlaces = useMutation({
		mutationFn: () =>
			client.refreshContractSigningLinks({ contractId: contract.id }),
		onSuccess: (data) => {
			toast.success(data.message);
			onUpdate?.();
		},
		onError: (error: Error) => toast.error(error.message),
	});

	const ocupado = actualizarEstado.isPending || regenerarEnlaces.isPending;

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

									<div className="flex shrink-0 items-center gap-1">
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
										{firmante.url && firmante.estado !== "signed" && (
											<Button
												variant="ghost"
												size="sm"
												asChild
												className="h-6 px-2"
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

					<div className="flex flex-wrap items-center gap-2">
						<Button
							variant="outline"
							size="sm"
							className="h-7"
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

						{firmantes.length > 0 && (
							<Button
								variant="outline"
								size="sm"
								className="h-7"
								disabled={ocupado}
								onClick={() => regenerarEnlaces.mutate()}
								title="Emite enlaces nuevos para quienes aún no firman. Los anteriores dejan de servir; quien ya firmó no se toca."
							>
								{regenerarEnlaces.isPending ? (
									<Loader2 className="mr-1 h-3 w-3 animate-spin" />
								) : (
									<RefreshCw className="mr-1 h-3 w-3" />
								)}
								Regenerar enlaces
							</Button>
						)}

						{hayVencidos && (
							<span className="text-amber-600 text-xs dark:text-amber-400">
								Hay enlaces vencidos: regeneralos para que puedan firmar.
							</span>
						)}
					</div>
				</div>
			)}
		</div>
	);
}
