import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
	Ban,
	ExternalLink,
	FileSignature,
	FileText,
	Loader2,
	RefreshCw,
} from "lucide-react";
import { useState } from "react";
import type { MOTIVOS_DE_ANULACION } from "server/src/lib/contratos-anulacion";
import { AnularContratoDialog } from "@/components/contracts/AnularContratoDialog";
import { EtiquetaSubidoAMano } from "@/components/contracts/SubidoAMano";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { estaAnulado } from "@/lib/contract-signers-display";
import { client, orpc } from "@/utils/orpc";

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
 * Los contratos que la batería ya tiene, con lo que jurídico todavía puede
 * hacerles.
 *
 * Es lo que hace falta al volver a una batería de otro día: los resultados del
 * wizard son de la sesión en la que se emitieron, y sin esto un contrato con un
 * error emitido ayer no tenía desde dónde corregirse.
 *
 * Mientras falte alguna firma se puede reemplazar y anular. Firmado por todos
 * no aparece ninguna acción: WeeTrust no deja borrar un documento completo, y
 * la batería ya salió de la lista de jurídico.
 */
export function ContratosDeLaBateria({
	batchId,
	onReemplazar,
}: {
	batchId: string;
	/** Abre la subida con ese tipo ya elegido, que es lo que reemplaza. */
	onReemplazar: (contractType: string) => void;
}) {
	const queryClient = useQueryClient();
	const [anulando, setAnulando] = useState<{
		id: string;
		nombre: string;
		hayFirmas: boolean;
	} | null>(null);

	const contratosQuery = useQuery(
		orpc.listInvestorContracts.queryOptions({ input: { batchId } }),
	);

	const refrescar = () =>
		queryClient.invalidateQueries({
			predicate: (query) =>
				JSON.stringify(query.queryKey).includes("InvestorContract"),
		});

	const contratos = contratosQuery.data ?? [];
	const vigentes = contratos.filter((c) => !estaAnulado(c));
	const anulados = contratos.filter((c) => estaAnulado(c));

	if (contratosQuery.isLoading) {
		return (
			<Card>
				<CardContent className="flex items-center gap-2 p-6 text-muted-foreground text-sm">
					<Loader2 className="h-4 w-4 animate-spin" />
					Cargando los contratos de la batería...
				</CardContent>
			</Card>
		);
	}

	if (contratos.length === 0) return null;

	return (
		<Card>
			<CardHeader className="pb-3">
				<CardTitle className="flex items-center gap-2 text-base">
					<FileSignature className="h-4 w-4" />
					Contratos de esta batería
				</CardTitle>
				<CardDescription>
					Mientras falte firmar se pueden corregir. Los enlaces de cada
					firmante están en la ficha del inversionista.
				</CardDescription>
			</CardHeader>

			<CardContent className="space-y-2">
				{[...vigentes, ...anulados].map((contrato) => {
					const estado = ESTADO[contrato.status] ?? ESTADO.pending;
					const inactivo = estaAnulado(contrato);
					const firmado = contrato.status === "signed";

					return (
						<div
							key={contrato.id}
							className={`flex flex-wrap items-center gap-2 rounded-md border p-3 ${
								inactivo ? "opacity-60" : ""
							}`}
						>
							<div className="min-w-0 flex-1">
								<p className="truncate font-medium text-sm">
									{contrato.contractName}
								</p>
								{inactivo && contrato.cancellationReason && (
									<p className="truncate text-muted-foreground text-xs">
										{contrato.cancellationReason}
									</p>
								)}
							</div>

							<EtiquetaSubidoAMano apiResponse={contrato.apiResponse} />
							<Badge variant="outline" className={`${estado.className} text-xs`}>
								{estado.label}
							</Badge>

							{contrato.pdfUrl && (
								<Button variant="outline" size="sm" asChild className="h-7">
									<a
										href={contrato.pdfUrl}
										target="_blank"
										rel="noopener noreferrer"
										className="flex items-center gap-1"
									>
										<FileText className="h-3 w-3" />
										PDF
										<ExternalLink className="h-3 w-3" />
									</a>
								</Button>
							)}

							{/* Un documento firmado por todos ya no se toca: allá no se puede
							    borrar y acá no habría qué corregir. */}
							{!inactivo && !firmado && (
								<>
									<Button
										variant="ghost"
										size="sm"
										className="h-7 text-xs"
										onClick={() => onReemplazar(contrato.contractType)}
									>
										<RefreshCw className="mr-1 h-3 w-3" />
										Reemplazar
									</Button>
									<Button
										variant="ghost"
										size="sm"
										className="h-7 text-destructive text-xs hover:text-destructive"
										onClick={() =>
											setAnulando({
												id: contrato.id,
												nombre: contrato.contractName,
												hayFirmas: (contrato.firmantes ?? []).some(
													(f) => f.status === "signed",
												),
											})
										}
									>
										<Ban className="mr-1 h-3 w-3" />
										Anular
									</Button>
								</>
							)}
						</div>
					);
				})}
			</CardContent>

			{anulando && (
				<AnularContratoDialog
					contractId={anulando.id}
					contractName={anulando.nombre}
					hayFirmas={anulando.hayFirmas}
					open
					onOpenChange={(abierto) => {
						if (!abierto) setAnulando(null);
					}}
					anular={(motivo: keyof typeof MOTIVOS_DE_ANULACION) =>
						client.cancelInvestorContract({
							contractId: anulando.id,
							motivo,
						})
					}
					onAnulado={() => {
						setAnulando(null);
						refrescar();
					}}
				/>
			)}
		</Card>
	);
}
