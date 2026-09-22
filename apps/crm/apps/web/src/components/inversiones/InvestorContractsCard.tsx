import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	Check,
	ChevronDown,
	Copy,
	Eye,
	FileSignature,
	Loader2,
	Mail,
	RefreshCw,
	RotateCcw,
} from "lucide-react";
import { useState } from "react";
import { MOTIVOS_DE_ANULACION } from "server/src/lib/contratos-anulacion";
import { toast } from "sonner";
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
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	ETIQUETAS_DE_INVERSIONES,
	estaAnulado,
	firmantesEnFicha,
} from "@/lib/contract-signers-display";
import { client, orpc } from "@/utils/orpc";

interface InvestorContractsCardProps {
	inversionistaId: number;
}

function copiar(texto: string, etiqueta: string) {
	navigator.clipboard.writeText(texto);
	toast.success(`${etiqueta} copiado`);
}

const ESTADO_DEL_CONTRATO: Record<
	string,
	{ texto: string; variante: "default" | "secondary" | "outline" }
> = {
	pending: { texto: "En firma", variante: "outline" },
	signed: { texto: "Firmado", variante: "default" },
	cancelled: { texto: "Anulado", variante: "secondary" },
};

/**
 * Los contratos de inversión de una persona, con sus enlaces de firma.
 *
 * Los emite jurídico, pero quien los usa es inversiones: de acá salen el enlace
 * de observador —el único que se puede mandar sin riesgo, porque muestra el
 * documento sin dejar firmar— y el de cada firmante.
 */
export function InvestorContractsCard({
	inversionistaId,
}: InvestorContractsCardProps) {
	const queryClient = useQueryClient();
	const [verAnulados, setVerAnulados] = useState(false);
	const [motivos, setMotivos] = useState<Record<string, string>>({});

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

	const estadoMutation = useMutation({
		mutationFn: (contractId: string) =>
			client.getInvestorContractSigningStatus({ contractId }),
		onSuccess: () => {
			toast.success("Estado actualizado");
			refrescar();
		},
		onError: (error: Error) => toast.error(error.message),
	});

	const correoMutation = useMutation({
		mutationFn: (contractId: string) =>
			client.resendInvestorContractSigningEmails({ contractId }),
		onSuccess: () => toast.success("Invitación reenviada"),
		onError: (error: Error) => toast.error(error.message),
	});

	const regenerarMutation = useMutation({
		mutationFn: ({
			contractId,
			motivo,
		}: {
			contractId: string;
			motivo: string;
		}) =>
			client.refreshInvestorContractSigningLinks({
				contractId,
				motivo: motivo as keyof typeof MOTIVOS_DE_ANULACION,
			}),
		onSuccess: (data) => {
			toast.success(data.message);
			refrescar();
		},
		onError: (error: Error) => toast.error(error.message),
	});

	const contratos = contratosQuery.data ?? [];
	const vigentes = contratos.filter((c) => !estaAnulado(c));
	const anulados = contratos.filter((c) => estaAnulado(c));

	return (
		<Card>
			<CardHeader>
				<div className="flex items-center justify-between">
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
						onClick={() => contratosQuery.refetch()}
						disabled={contratosQuery.isFetching}
					>
						<RefreshCw
							className={`h-4 w-4 ${contratosQuery.isFetching ? "animate-spin" : ""}`}
						/>
					</Button>
				</div>
			</CardHeader>

			<CardContent className="space-y-3">
				{contratosQuery.isLoading ? (
					<div className="flex items-center gap-2 text-muted-foreground text-sm">
						<Loader2 className="h-4 w-4 animate-spin" />
						Cargando contratos...
					</div>
				) : contratos.length === 0 ? (
					<p className="py-6 text-center text-muted-foreground text-sm">
						Sin contratos emitidos
					</p>
				) : (
					<>
						{vigentes.map((contrato) => {
							const firmantes = firmantesEnFicha(
								contrato.firmantes,
								contrato,
								ETIQUETAS_DE_INVERSIONES,
							);
							const estado =
								ESTADO_DEL_CONTRATO[contrato.status] ??
								ESTADO_DEL_CONTRATO.pending;

							return (
								<div
									key={contrato.id}
									className="space-y-3 rounded-lg border p-3"
								>
									<div className="flex flex-wrap items-center gap-2">
										<span className="font-medium text-sm">
											{contrato.contractName}
										</span>
										<Badge variant={estado.variante}>{estado.texto}</Badge>
										{contrato.signingStatusCheckedAt && (
											<span className="text-muted-foreground text-xs">
												revisado{" "}
												{new Date(
													contrato.signingStatusCheckedAt,
												).toLocaleString("es-GT")}
											</span>
										)}
									</div>

									{contrato.observerUrl && (
										<div className="flex items-center gap-2">
											<Eye className="h-3.5 w-3.5 text-muted-foreground" />
											<span className="text-muted-foreground text-xs">
												Observador (mira, no firma)
											</span>
											<Button
												variant="ghost"
												size="sm"
												onClick={() =>
													copiar(
														contrato.observerUrl as string,
														"Enlace de observador",
													)
												}
											>
												<Copy className="mr-1 h-3 w-3" />
												Copiar
											</Button>
										</div>
									)}

									<div className="space-y-1">
										{firmantes.map((firmante) => (
											<div
												key={firmante.clave}
												className="flex flex-wrap items-center gap-2 text-sm"
											>
												<span className="w-36 shrink-0 text-muted-foreground text-xs">
													{firmante.etiqueta}
												</span>
												<span className="truncate">
													{firmante.nombre ?? "—"}
												</span>
												{firmante.estado === "signed" ? (
													<Badge variant="default" className="gap-1">
														<Check className="h-3 w-3" />
														Firmó
													</Badge>
												) : firmante.vencido ? (
													<Badge variant="secondary">Enlace vencido</Badge>
												) : (
													<Badge variant="outline">Pendiente</Badge>
												)}
												{firmante.url && firmante.estado !== "signed" && (
													<Button
														variant="ghost"
														size="sm"
														onClick={() =>
															copiar(
																firmante.url as string,
																`Enlace de ${firmante.etiqueta}`,
															)
														}
													>
														<Copy className="mr-1 h-3 w-3" />
														Copiar enlace
													</Button>
												)}
											</div>
										))}
									</div>

									<div className="flex flex-wrap items-center gap-2 border-t pt-2">
										<Button
											variant="outline"
											size="sm"
											onClick={() => estadoMutation.mutate(contrato.id)}
											disabled={estadoMutation.isPending}
										>
											<RefreshCw className="mr-1 h-3 w-3" />
											Actualizar estado
										</Button>
										<Button
											variant="outline"
											size="sm"
											onClick={() => correoMutation.mutate(contrato.id)}
											disabled={
												correoMutation.isPending || contrato.status === "signed"
											}
										>
											<Mail className="mr-1 h-3 w-3" />
											Reenviar correo
										</Button>

										<div className="ml-auto flex items-center gap-2">
											<Select
												value={motivos[contrato.id] ?? ""}
												onValueChange={(valor) =>
													setMotivos((previos) => ({
														...previos,
														[contrato.id]: valor,
													}))
												}
											>
												<SelectTrigger className="h-8 w-56">
													<SelectValue placeholder="Motivo para regenerar" />
												</SelectTrigger>
												<SelectContent>
													{Object.entries(MOTIVOS_DE_ANULACION).map(
														([valor, etiqueta]) => (
															<SelectItem key={valor} value={valor}>
																{etiqueta}
															</SelectItem>
														),
													)}
												</SelectContent>
											</Select>
											<Button
												variant="outline"
												size="sm"
												onClick={() =>
													regenerarMutation.mutate({
														contractId: contrato.id,
														motivo: motivos[contrato.id],
													})
												}
												disabled={
													regenerarMutation.isPending || !motivos[contrato.id]
												}
											>
												<RotateCcw className="mr-1 h-3 w-3" />
												Regenerar enlaces
											</Button>
										</div>
									</div>
								</div>
							);
						})}

						{anulados.length > 0 && (
							<div className="pt-2">
								<Button
									variant="ghost"
									size="sm"
									onClick={() => setVerAnulados((v) => !v)}
								>
									<ChevronDown
										className={`mr-1 h-3 w-3 transition-transform ${verAnulados ? "rotate-180" : ""}`}
									/>
									{verAnulados ? "Ocultar" : "Ver"} anulados ({anulados.length})
								</Button>

								{verAnulados && (
									<div className="mt-2 space-y-2">
										{anulados.map((contrato) => (
											<div
												key={contrato.id}
												className="rounded-lg border border-dashed p-3 text-muted-foreground text-sm"
											>
												<div className="flex items-center gap-2">
													<span>{contrato.contractName}</span>
													<Badge variant="secondary">Anulado</Badge>
												</div>
												{contrato.cancellationReason && (
													<p className="text-xs">
														{contrato.cancellationReason}
													</p>
												)}
											</div>
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
