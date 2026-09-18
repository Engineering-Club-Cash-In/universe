import { ExternalLink, FileSignature, FileText } from "lucide-react";
import { esFirmaFisica } from "server/src/lib/contract-signature-mode";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
	type FirmanteDeContrato,
	firmantesEnFicha,
} from "@/lib/contract-signers-display";
import { getContractTypeLabel } from "@/lib/crm-formatters";

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
}

export interface FilaDeContrato {
	contract: ContratoDeOportunidad;
	signatories?: FirmanteDeContrato[];
}

interface OpportunityContractsCardProps {
	contracts: FilaDeContrato[] | undefined;
	isLoading?: boolean;
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
					{contracts.map(({ contract, signatories }) => {
						const firmaEnPapel = esFirmaFisica(contract.contractType);
						const firmantes = firmaEnPapel
							? []
							: firmantesEnFicha(signatories, contract);
						const estado = ESTADO[contract.status];

						return (
							<div
								key={contract.id}
								className="rounded-md border bg-background p-3"
							>
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
										<Badge
											variant="outline"
											className={`${estado.className} text-xs`}
										>
											{estado.label}
										</Badge>
										{contract.pdfLink && (
											<Button
												variant="outline"
												size="sm"
												asChild
												className="h-7"
											>
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

								{/* Quién firma. En su propia fila: antes iban pegados al PDF
								    en una sola hilera y no se distinguía qué era cada botón. */}
								{firmaEnPapel ? (
									<p className="mt-3 border-t pt-2 text-amber-700 text-xs dark:text-amber-400">
										Se firma en papel. No lleva enlace de firma.
									</p>
								) : firmantes.length > 0 ? (
									<div className="mt-3 border-t pt-2">
										<p className="mb-1.5 text-muted-foreground text-xs">
											Enlaces de firma
										</p>
										<div className="flex flex-wrap gap-1.5">
											{firmantes.map((firmante) =>
												firmante.url ? (
													<Button
														key={firmante.clave}
														variant="outline"
														size="sm"
														asChild
														className="h-7"
													>
														<a
															href={firmante.url}
															target="_blank"
															rel="noopener noreferrer"
															className="flex items-center gap-1"
															title={firmante.nombre ?? undefined}
														>
															<ExternalLink className="h-3 w-3" />
															{firmante.etiqueta}
															{firmante.estado === "signed" && " ✓"}
														</a>
													</Button>
												) : null,
											)}
										</div>
									</div>
								) : (
									<p className="mt-3 border-t pt-2 text-muted-foreground text-xs">
										Sin enlaces de firma
									</p>
								)}
							</div>
						);
					})}
				</div>
			)}
		</div>
	);
}
