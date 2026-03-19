import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import {
	Banknote,
	CheckCircle,
	Download,
	FileText,
	Loader2,
	Send,
	Trash2,
	Upload,
} from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PERMISSIONS } from "@/lib/roles";
import { uploadFileToR2WithRetry } from "@/lib/upload-to-r2";
import { client, orpc } from "@/utils/orpc";

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB

type DisbursementDoc = Awaited<
	ReturnType<typeof client.getDisbursementForOpportunity>
>["documents"][number];

type CreditCheck = Awaited<
	ReturnType<typeof client.getChecksByOpportunity>
>[number];

interface DisbursementViewProps {
	opportunityId: string;
	opportunityTitle: string;
	assignedUserId?: string;
	userRole?: string | null;
	quotation?: {
		amountToFinance: string;
		totalFinanced: string;
	} | null;
}

export function DisbursementView({
	opportunityId,
	opportunityTitle,
	assignedUserId,
	userRole,
	quotation,
}: DisbursementViewProps) {
	const queryClient = useQueryClient();
	const fileInputRef = useRef<HTMLInputElement>(null);
	const [uploadingDisbursement, setUploadingDisbursement] = useState(false);

	const isAccounting =
		userRole != null && PERMISSIONS.canAccessAccounting(userRole);

	const amountToFinance = quotation ? Number(quotation.amountToFinance) : 0;
	const totalFinanced = quotation ? Number(quotation.totalFinanced) : 0;
	const gastos = totalFinanced - amountToFinance;

	// Query for disbursement info (accounting documents)
	const disbursementQuery = useQuery({
		...orpc.getDisbursementForOpportunity.queryOptions({
			input: { opportunityId },
		}),
		queryKey: ["getDisbursementForOpportunity", opportunityId],
	});

	// Query for checks associated with the opportunity
	const checksQuery = useQuery({
		queryKey: ["getChecksByOpportunity", opportunityId],
		queryFn: () => client.getChecksByOpportunity({ opportunityId }),
	});

	const uploadDisbursementMutation = useMutation({
		mutationFn: async (file: File) => {
			const notificationId = disbursementQuery.data?.notificationId;
			if (!notificationId) throw new Error("No hay notificacion de desembolso");

			const { key } = await uploadFileToR2WithRetry(file, {
				resourceType: "notification_document",
				resourceId: notificationId,
			});

			return await client.addDocumentToNotification({
				notificationId,
				file: {
					name: file.name,
					type: file.type,
					size: file.size,
					key,
				},
			});
		},
		onSuccess: () => {
			toast.success("Documento de desembolso subido");
			queryClient.invalidateQueries({
				queryKey: ["getDisbursementForOpportunity", opportunityId],
			});
		},
		onError: (error: Error) => {
			toast.error(error.message);
		},
	});

	const deleteDisbursementDocMutation = useMutation({
		mutationFn: async (documentId: string) => {
			return await client.deleteNotificationDocument({ documentId });
		},
		onSuccess: () => {
			toast.success("Documento eliminado");
			queryClient.invalidateQueries({
				queryKey: ["getDisbursementForOpportunity", opportunityId],
			});
		},
		onError: (error: Error) => {
			toast.error(error.message);
		},
	});

	const notifySalesMutation = useMutation({
		mutationFn: async () => {
			return await client.notifyDisbursementCompleted({
				opportunityId,
			});
		},
		onSuccess: () => {
			toast.success("Notificación enviada al asesor de ventas");
		},
		onError: (error: Error) => {
			toast.error(error.message);
		},
	});

	const handleDisbursementFileSelect = useCallback(
		async (e: React.ChangeEvent<HTMLInputElement>) => {
			const files = e.target.files;
			if (!files?.length) return;

			setUploadingDisbursement(true);
			try {
				for (const file of Array.from(files)) {
					if (file.size > MAX_FILE_SIZE) {
						toast.error(`${file.name} excede el límite de 20MB`);
						continue;
					}
					try {
						await uploadDisbursementMutation.mutateAsync(file);
					} catch {
						toast.error(`Error subiendo ${file.name}`);
					}
				}
			} finally {
				setUploadingDisbursement(false);
				if (fileInputRef.current) {
					fileInputRef.current.value = "";
				}
			}
		},
		[uploadDisbursementMutation],
	);

	const hasDocuments =
		disbursementQuery.data && disbursementQuery.data.documents.length > 0;

	return (
		<div className="space-y-6">
			{/* Financial summary - only for admin/accounting */}
			{isAccounting && quotation && (
				<div className="grid grid-cols-2 gap-4">
					<div className="rounded-lg border bg-muted/30 p-4">
						<span className="text-muted-foreground text-xs">
							Monto a desembolsar
						</span>
						<p className="font-bold text-2xl text-green-600">
							Q{amountToFinance.toLocaleString()}
						</p>
					</div>
					<div className="rounded-lg border bg-muted/30 p-4">
						<span className="text-muted-foreground text-xs">Gastos</span>
						<p className="font-bold text-2xl text-orange-600">
							Q{gastos.toLocaleString()}
						</p>
					</div>
				</div>
			)}

			{/* Disbursement documents */}
			<div className="space-y-3">
				<div className="flex items-center gap-2">
					<FileText className="h-5 w-5 text-muted-foreground" />
					<h3 className="font-semibold text-lg">Boletas de desembolso</h3>
				</div>

				{disbursementQuery.isLoading ? (
					<p className="text-muted-foreground text-sm">
						Cargando documentos...
					</p>
				) : hasDocuments ? (
					<div className="space-y-2">
						{disbursementQuery.data!.documents.map((doc: DisbursementDoc) => (
							<div
								key={doc.id}
								className="flex flex-col gap-3 sm:flex-row sm:items-center justify-between rounded-md border bg-background px-4 py-3"
							>
								<div className="flex min-w-0 flex-1 items-center gap-3">
									<FileText className="h-5 w-5 shrink-0 text-muted-foreground" />
									<div className="min-w-0 flex-1">
										<p className="font-medium text-sm break-all whitespace-normal">
											{doc.originalName}
										</p>
										<p className="text-muted-foreground text-xs">
											{(doc.size / 1024).toFixed(0)} KB
										</p>
									</div>
								</div>
								<div className="flex shrink-0 items-center gap-1">
									<a href={doc.url} target="_blank" rel="noopener noreferrer">
										<Button size="sm" variant="outline" className="h-8">
											<Download className="mr-1 h-3 w-3" />
											Descargar
										</Button>
									</a>
									{isAccounting && (
										<Button
											size="sm"
											variant="ghost"
											className="h-8 text-destructive hover:text-destructive"
											disabled={deleteDisbursementDocMutation.isPending}
											onClick={() =>
												deleteDisbursementDocMutation.mutate(doc.id)
											}
										>
											<Trash2 className="h-4 w-4" />
										</Button>
									)}
								</div>
							</div>
						))}
					</div>
				) : (
					<div className="rounded-lg border border-dashed p-6 text-center">
						<FileText className="mx-auto mb-2 h-8 w-8 text-muted-foreground/50" />
						<p className="text-muted-foreground text-sm">
							No hay documentos de desembolso
						</p>
					</div>
				)}

				{/* Upload area - only for accounting */}
				{isAccounting && disbursementQuery.data?.notificationId && (
					<div
						className="flex cursor-pointer items-center justify-center gap-2 rounded-md border-2 border-muted-foreground/25 border-dashed px-4 py-2.5 transition-colors hover:border-muted-foreground/50"
						role="button"
						tabIndex={0}
						onClick={() => fileInputRef.current?.click()}
						onKeyDown={(e) => {
							if (e.key === "Enter" || e.key === " ") {
								e.preventDefault();
								fileInputRef.current?.click();
							}
						}}
					>
						{uploadingDisbursement ? (
							<Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
						) : (
							<Upload className="h-4 w-4 text-muted-foreground/50" />
						)}
						<span className="text-muted-foreground text-sm">
							{uploadingDisbursement ? "Subiendo..." : "Subir boletas"}
						</span>
						<span className="text-[11px] text-muted-foreground/60">
							(PDF, imágenes, Word, Excel)
						</span>
						<input
							ref={fileInputRef}
							type="file"
							multiple
							accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx"
							className="hidden"
							onChange={handleDisbursementFileSelect}
							disabled={uploadingDisbursement}
						/>
					</div>
				)}

				{/* Notify sales button */}
				{isAccounting && hasDocuments && (
					<Button
						variant="outline"
						className="w-full gap-2"
						disabled={notifySalesMutation.isPending}
						onClick={() => notifySalesMutation.mutate()}
					>
						{notifySalesMutation.isPending ? (
							<Loader2 className="h-4 w-4 animate-spin" />
						) : (
							<Send className="h-4 w-4" />
						)}
						Notificar a ventas que el desembolso fue completado
					</Button>
				)}

				{!disbursementQuery.data?.notificationId &&
					!disbursementQuery.isLoading && (
						<p className="text-muted-foreground text-sm">
							No hay notificación de desembolso para esta oportunidad.
						</p>
					)}
			</div>

			{/* Checks section */}
			<div className="space-y-3">
				<div className="flex items-center gap-2">
					<Banknote className="h-5 w-5 text-muted-foreground" />
					<h3 className="font-semibold text-lg">Cheques / Transferencias</h3>
				</div>

				{checksQuery.isLoading ? (
					<p className="text-muted-foreground text-sm">Cargando cheques...</p>
				) : checksQuery.data && checksQuery.data.length > 0 ? (
					<div className="space-y-3">
						{checksQuery.data.map((check: CreditCheck) => (
							<div
								key={check.id}
								className="rounded-lg border bg-background p-5"
							>
								<div className="flex items-start justify-between gap-4">
									<div className="space-y-2">
										<div className="flex items-center gap-3">
											<Badge variant="outline" className="text-sm">
												{check.transferType}
											</Badge>
											<span className="font-semibold text-base">
												{check.concept}
											</span>
										</div>
										<div className="grid grid-cols-2 gap-x-6 gap-y-2">
											<div>
												<span className="text-muted-foreground text-xs">
													Emisor
												</span>
												<p className="font-medium text-sm">
													{check.issuer}
													{check.issuerBank && (
														<span className="font-normal text-muted-foreground">
															{" "}
															({check.issuerBank})
														</span>
													)}
												</p>
											</div>
											<div>
												<span className="text-muted-foreground text-xs">
													Beneficiario
												</span>
												<p className="font-medium text-sm">
													{check.beneficiary}
													{check.beneficiaryBank && (
														<span className="font-normal text-muted-foreground">
															{" "}
															({check.beneficiaryBank})
														</span>
													)}
												</p>
											</div>
											{check.accountNumber && (
												<div>
													<span className="text-muted-foreground text-xs">
														Cuenta
													</span>
													<p className="font-medium text-sm">
														{check.accountNumber}{" "}
														<span className="font-normal text-muted-foreground">
															({check.accountType})
														</span>
													</p>
												</div>
											)}
											<div>
												<span className="text-muted-foreground text-xs">
													Fecha
												</span>
												<p className="font-medium text-sm">
													{format(new Date(check.checkDate), "dd/MM/yyyy", {
														locale: es,
													})}
												</p>
											</div>
										</div>
									</div>
									<div className="shrink-0 text-right">
										<span className="text-muted-foreground text-xs">Monto</span>
										<p className="font-bold text-green-600 text-xl">
											{check.currency} {Number(check.amount).toLocaleString()}
										</p>
									</div>
								</div>
							</div>
						))}
					</div>
				) : (
					<div className="rounded-lg border border-dashed p-6 text-center">
						<Banknote className="mx-auto mb-2 h-8 w-8 text-muted-foreground/50" />
						<p className="text-muted-foreground text-sm">
							No hay cheques registrados para esta oportunidad
						</p>
					</div>
				)}
			</div>
		</div>
	);
}
