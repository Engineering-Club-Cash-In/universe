import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	Check,
	ClipboardCopy,
	Download,
	FileText,
	Link2,
	Loader2,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	generateCreditApplicationPdf,
	generateFinancialStatementPdf,
} from "@/lib/generate-client-form-pdfs";
import { client } from "@/utils/orpc";

interface ClientFormsSectionProps {
	opportunityId: string;
}

type ClientFormData = Awaited<ReturnType<typeof client.getClientFormData>>;
type ClientFormParticipant = ClientFormData["participants"][number] & {
	canGenerateLink?: boolean;
};

export function ClientFormsSection({ opportunityId }: ClientFormsSectionProps) {
	const queryClient = useQueryClient();
	const [copiedKey, setCopiedKey] = useState<string | null>(null);
	const [confirmingKey, setConfirmingKey] = useState<{
		personType: "lead" | "coDebtor";
		personId: string;
		displayName: string;
	} | null>(null);
	const [updatedKey, setUpdatedKey] = useState<string | null>(null);

	const { data, isLoading } = useQuery({
		queryKey: ["clientFormData", opportunityId],
		queryFn: () => client.getClientFormData({ opportunityId }),
	});

	const generateMutation = useMutation({
		mutationFn: (input: {
			personType: "lead" | "coDebtor";
			personId: string;
		}) => client.generateFormToken({ opportunityId, ...input }),
		onSuccess: (_data, variables) => {
			const key = `${variables.personType}:${variables.personId}`;
			queryClient.invalidateQueries({
				queryKey: ["clientFormData", opportunityId],
			});
			setUpdatedKey(key);
			setTimeout(() => setUpdatedKey((cur) => (cur === key ? null : cur)), 4000);
			toast.success("Enlace generado exitosamente");
		},
		onError: () => {
			toast.error("Error al generar el enlace");
		},
	});

	const handleCopyLink = async (key: string, url: string) => {
		try {
			await navigator.clipboard.writeText(url);
			setCopiedKey(key);
			toast.success("Enlace copiado al portapapeles");
			setTimeout(
				() => setCopiedKey((current) => (current === key ? null : current)),
				2000,
			);
		} catch {
			toast.error("Error al copiar el enlace");
		}
	};

	if (isLoading) {
		return (
			<div className="flex items-center justify-center py-8">
				<Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
			</div>
		);
	}

	const participants: ClientFormParticipant[] = data?.participants ?? [];
	const completedCount = participants.filter(
		(participant) =>
			participant.creditApplicationExists &&
			participant.financialStatementExists,
	).length;

	return (
		<div className="space-y-6">
			<div className="flex items-center gap-2">
				<FileText className="h-5 w-5 text-muted-foreground" />
				<h3 className="font-semibold text-lg">Formularios del Cliente</h3>
				{participants.length > 0 && completedCount === participants.length ? (
					<Badge variant="default" className="bg-green-600">
						Completado
					</Badge>
				) : (
					<Badge variant="secondary">Pendiente</Badge>
				)}
			</div>

			<div className="space-y-4">
				{participants.map((participant) => {
					const key = `${participant.personType}:${participant.personId}`;
					const isGenerating =
						generateMutation.isPending &&
						generateMutation.variables?.personType === participant.personType &&
						generateMutation.variables?.personId === participant.personId;

					return (
						<div key={key} className="space-y-4 rounded-lg border p-4">
							<div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
								<div>
									<div className="flex items-center gap-2">
										<span className="font-medium">
											{participant.displayName}
										</span>
										<Badge variant="outline">{participant.roleLabel}</Badge>
									</div>
									<div className="text-muted-foreground text-sm">
										{participant.email || participant.phone || "Sin contacto"}
									</div>
								</div>
								<div className="flex items-center gap-2">
									{participant.creditApplicationExists &&
									participant.financialStatementExists ? (
										<Badge variant="default" className="bg-green-600">
											Completado
										</Badge>
									) : participant.latestToken ? (
										<Badge variant="secondary">Pendiente</Badge>
									) : (
										<Badge variant="outline">Sin enlace</Badge>
									)}
								</div>
							</div>

							<div className="space-y-3 rounded-lg border p-4">
								<div className="flex items-center gap-2 font-medium text-sm">
									<Link2 className="h-4 w-4" />
									Enlace del Formulario
								</div>

								{!participant.latestToken && participant.canGenerateLink ? (
									<Button
										onClick={() =>
											generateMutation.mutate({
												personType: participant.personType,
												personId: participant.personId,
											})
										}
										disabled={isGenerating}
									>
										{isGenerating ? (
											<>
												<Loader2 className="mr-2 h-4 w-4 animate-spin" />
												Generando...
											</>
										) : (
											"Generar Enlace"
										)}
									</Button>
								) : !participant.latestToken ? (
									<div className="text-muted-foreground text-sm">
										Registro historico sin enlace activo
									</div>
								) : (
									<div className="space-y-2">
										<div className="flex gap-2">
											<Input
												readOnly
												value={participant.latestToken.url}
												className={`font-mono text-xs transition-colors duration-500 ${updatedKey === key ? "border-green-500 bg-green-50" : ""}`}
											/>
											<Button
												variant="outline"
												size="icon"
												onClick={() =>
													handleCopyLink(key, participant.latestToken!.url)
												}
											>
												{copiedKey === key ? (
													<Check className="h-4 w-4 text-green-500" />
												) : (
													<ClipboardCopy className="h-4 w-4" />
												)}
											</Button>
											{participant.canGenerateLink && (
												<Button
													variant="outline"
													onClick={() => {
														const hasExistingData =
															participant.creditApplicationExists ||
															participant.financialStatementExists;
														if (hasExistingData) {
															setConfirmingKey({
																personType: participant.personType,
																personId: participant.personId,
																displayName: participant.displayName,
															});
														} else {
															generateMutation.mutate({
																personType: participant.personType,
																personId: participant.personId,
															});
														}
													}}
												>
													Nuevo enlace
												</Button>
											)}
										</div>
										{updatedKey === key && (
											<p className="flex items-center gap-1 text-green-600 text-xs font-medium">
												<Check className="h-3 w-3" />
												Enlace actualizado exitosamente
											</p>
										)}
										<div className="flex items-center gap-4 text-muted-foreground text-xs">
											{(() => {
												const expiresDate = participant.latestToken?.expiresAt
													? new Date(participant.latestToken.expiresAt)
													: null;
												const isValid =
													expiresDate && !Number.isNaN(expiresDate.getTime());
												const isExpired = isValid && expiresDate < new Date();
												return (
													<>
														<span>
															Expira:{" "}
															{isValid
																? expiresDate.toLocaleDateString("es-GT")
																: "Sin fecha"}
														</span>
														{isExpired && (
															<Badge variant="destructive" className="text-xs">
																Expirado
															</Badge>
														)}
													</>
												);
											})()}
											{participant.latestToken.used && (
												<Badge variant="outline" className="text-xs">
													Usado
												</Badge>
											)}
										</div>
									</div>
								)}
							</div>

							<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
								<div className="rounded-lg border p-4">
									<div className="flex items-center justify-between">
										<div className="flex items-center gap-2">
											<FileText className="h-4 w-4 text-muted-foreground" />
											<span className="font-medium text-sm">
												Solicitud de Crédito
											</span>
										</div>
										{participant.creditApplicationExists ? (
											<Badge variant="default" className="bg-green-600">
												Completado
											</Badge>
										) : (
											<Badge variant="secondary">Pendiente</Badge>
										)}
									</div>
								</div>

								<div className="rounded-lg border p-4">
									<div className="flex items-center justify-between">
										<div className="flex items-center gap-2">
											<FileText className="h-4 w-4 text-muted-foreground" />
											<span className="font-medium text-sm">
												Estado Patrimonial
											</span>
										</div>
										{participant.financialStatementExists ? (
											<Badge variant="default" className="bg-green-600">
												Completado
											</Badge>
										) : (
											<Badge variant="secondary">Pendiente</Badge>
										)}
									</div>
								</div>
							</div>

							{(participant.creditApplication ||
								participant.financialStatement) && (
								<div className="flex flex-wrap gap-3">
									{participant.creditApplication && (
										<Button
											variant="outline"
											size="sm"
											onClick={() =>
												generateCreditApplicationPdf(
													participant.creditApplication as Record<
														string,
														unknown
													>,
												)
											}
										>
											<Download className="mr-2 h-4 w-4" />
											Descargar Solicitud PDF
										</Button>
									)}
									{participant.financialStatement && (
										<Button
											variant="outline"
											size="sm"
											onClick={() =>
												generateFinancialStatementPdf(
													participant.financialStatement as Record<
														string,
														unknown
													>,
												)
											}
										>
											<Download className="mr-2 h-4 w-4" />
											Descargar Estado Patrimonial PDF
										</Button>
									)}
								</div>
							)}
						</div>
					);
				})}
			</div>

		<AlertDialog
			open={!!confirmingKey}
			onOpenChange={(open) => { if (!open) setConfirmingKey(null); }}
		>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>¿Generar nuevo enlace y borrar datos ingresados?</AlertDialogTitle>
					<AlertDialogDescription asChild>
						<div className="space-y-3 text-sm text-muted-foreground">
							<p>
								El formulario de{" "}
								<span className="font-medium text-foreground">
									{confirmingKey?.displayName}
								</span>{" "}
								ya tiene información ingresada. Al generar un nuevo enlace
								se <span className="font-medium text-destructive">eliminarán todos los datos</span> que
								el cliente había enviado y deberá volver a llenar el
								formulario completo desde cero.
							</p>
							<p>Esta acción no se puede deshacer.</p>
						</div>
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel>Cancelar</AlertDialogCancel>
					<AlertDialogAction
						className="bg-destructive hover:bg-destructive/90"
						onClick={() => {
							if (confirmingKey) {
								generateMutation.mutate({
									personType: confirmingKey.personType,
									personId: confirmingKey.personId,
								});
								setConfirmingKey(null);
							}
						}}
					>
						Sí, borrar datos y generar nuevo enlace
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	</div>
	);
}
