import {
	keepPreviousData,
	useMutation,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
	AlertTriangle,
	Ban,
	CheckCircle2,
	ChevronLeft,
	ChevronRight,
	FileCheck2,
	FileText,
	HelpCircle,
	Loader2,
	Search,
	Sparkles,
	Trash2,
	XCircle,
} from "lucide-react";
import { type ComponentType, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { ManualDocumentApprovalButton } from "@/components/credit/ManualDocumentApprovalButton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
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
import { Separator } from "@/components/ui/separator";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
	aggregateIntegrityResult,
	type IntegrityResult,
	requiresManualApproval,
} from "@/lib/document-integrity-flow";
import { uploadFileToR2WithRetry } from "@/lib/upload-to-r2";
import { client, orpc } from "@/utils/orpc";

export const Route = createFileRoute("/crm/documentacion/estados-cuenta")({
	component: RouteComponent,
	validateSearch: z
		.object({
			validationId: z.string().uuid(),
			opportunityId: z.string().uuid(),
		})
		.partial().parse,
});

function RouteComponent() {
	const search = Route.useSearch();
	return (
		<div className="container mx-auto p-6">
			<EstadosCuentaContent
				initialValidationId={search.validationId}
				initialOpportunityId={search.opportunityId}
			/>
		</div>
	);
}

const PAGE_SIZE = 25;

const RESULT_META: Record<
	IntegrityResult,
	{
		label: string;
		className: string;
		Icon: ComponentType<{ className?: string }>;
	}
> = {
	valido: {
		label: "Válido",
		className:
			"bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300",
		Icon: CheckCircle2,
	},
	observacion: {
		label: "Con observación",
		className:
			"bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
		Icon: AlertTriangle,
	},
	revision_manual: {
		label: "Revisión manual",
		className: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300",
		Icon: HelpCircle,
	},
	rechazado: {
		label: "Rechazado",
		className: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
		Icon: XCircle,
	},
	error: {
		label: "Error",
		className: "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-300",
		Icon: Ban,
	},
};

export function ResultBadge({ result }: { result: string }) {
	const meta = RESULT_META[result as IntegrityResult];
	if (!meta) return <Badge variant="outline">{result}</Badge>;
	const { Icon } = meta;
	return (
		<Badge className={meta.className}>
			<Icon className="mr-1 h-3.5 w-3.5" />
			{meta.label}
		</Badge>
	);
}

export function EstadosCuentaContent({
	initialValidationId,
	initialOpportunityId,
}: {
	initialValidationId?: string;
	initialOpportunityId?: string;
} = {}) {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const [selectedOpportunityId, setSelectedOpportunityId] = useState<
		string | null
	>(initialOpportunityId ?? null);
	const [selectedValidationId, setSelectedValidationId] = useState<
		string | null
	>(initialValidationId ?? null);
	const [newDialogOpen, setNewDialogOpen] = useState(false);
	const [newDialogOpportunityId, setNewDialogOpportunityId] = useState<
		string | undefined
	>(undefined);
	const [page, setPage] = useState(0);
	const [searchInput, setSearchInput] = useState("");
	const [search, setSearch] = useState("");
	const [requiresReviewOnly, setRequiresReviewOnly] = useState(true);
	const userProfile = useQuery(orpc.getUserProfile.queryOptions());
	const canUseValidationHistory = [
		"admin",
		"analyst",
		"sales_supervisor",
	].includes(userProfile.data?.role ?? "");
	const canViewValidationDetail =
		canUseValidationHistory || userProfile.data?.role === "sales";

	useEffect(() => {
		const timeout = setTimeout(() => {
			setSearch(searchInput.trim());
			setPage(0);
		}, 300);
		return () => clearTimeout(timeout);
	}, [searchInput]);

	const cameFromDeepLink = useRef(
		!!(initialValidationId || initialOpportunityId),
	);
	useEffect(() => {
		if (
			cameFromDeepLink.current &&
			!selectedOpportunityId &&
			!selectedValidationId &&
			!newDialogOpen
		) {
			cameFromDeepLink.current = false;
			navigate({
				to: "/crm/documentacion/estados-cuenta",
				search: {},
				replace: true,
			});
		}
	}, [navigate, newDialogOpen, selectedOpportunityId, selectedValidationId]);

	const listQuery = useQuery({
		...orpc.listDocumentIntegrityValidations.queryOptions({
			input: {
				search: search || undefined,
				requiresReviewOnly,
				limit: PAGE_SIZE,
				offset: page * PAGE_SIZE,
			},
		}),
		placeholderData: keepPreviousData,
		enabled: canUseValidationHistory,
	});
	const rows = listQuery.data ?? [];
	const detailQuery = useQuery({
		...orpc.getDocumentIntegrityValidationGroup.queryOptions({
			input: {
				opportunityId: selectedOpportunityId ?? undefined,
				validationId: selectedValidationId ?? undefined,
			},
		}),
		enabled:
			canViewValidationDetail &&
			!!(selectedOpportunityId || selectedValidationId),
	});

	return (
		<div className="space-y-6">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<div>
					<h1 className="font-bold text-2xl">Estados de cuenta</h1>
					<p className="text-muted-foreground text-sm">
						Historial de resultados automáticos y evidencia forense.
					</p>
				</div>
				{canUseValidationHistory && (
					<Dialog open={newDialogOpen} onOpenChange={setNewDialogOpen}>
						<DialogTrigger asChild>
							<Button onClick={() => setNewDialogOpportunityId(undefined)}>
								<FileCheck2 className="mr-2 h-4 w-4" />
								Nueva validación
							</Button>
						</DialogTrigger>
						{newDialogOpen && (
							<NewValidationDialog
								initialOpportunityId={newDialogOpportunityId}
								onClose={() => setNewDialogOpen(false)}
								onCreated={(opportunityId) => {
									setNewDialogOpen(false);
									setSelectedOpportunityId(opportunityId);
									setSelectedValidationId(null);
									queryClient.invalidateQueries({
										queryKey: orpc.listDocumentIntegrityValidations.key(),
									});
								}}
							/>
						)}
					</Dialog>
				)}
			</div>

			<Card>
				<CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
					<CardTitle>Validaciones</CardTitle>
					<div className="flex flex-wrap items-center gap-3">
						<label className="flex items-center gap-2 text-sm">
							<input
								type="checkbox"
								checked={requiresReviewOnly}
								onChange={(event) => {
									setRequiresReviewOnly(event.target.checked);
									setPage(0);
								}}
							/>
							Solo resultados que requieren revisión
						</label>
						<div className="relative w-full sm:w-64">
							<Search className="absolute top-2.5 left-2.5 h-4 w-4 text-muted-foreground" />
							<Input
								value={searchInput}
								onChange={(event) => setSearchInput(event.target.value)}
								placeholder="Buscar cliente, documento…"
								className="pl-8"
							/>
						</div>
					</div>
				</CardHeader>
				<CardContent>
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Fecha</TableHead>
								<TableHead>Cliente</TableHead>
								<TableHead>Oportunidad</TableHead>
								<TableHead>Documentos</TableHead>
								<TableHead>Resultado</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{listQuery.isLoading && (
								<TableRow>
									<TableCell
										colSpan={5}
										className="text-center text-muted-foreground"
									>
										Cargando…
									</TableCell>
								</TableRow>
							)}
							{listQuery.isError && (
								<TableRow>
									<TableCell
										colSpan={5}
										className="text-center text-destructive"
									>
										No se pudo cargar la bandeja.
									</TableCell>
								</TableRow>
							)}
							{!listQuery.isLoading &&
								!listQuery.isError &&
								rows.length === 0 && (
									<TableRow>
										<TableCell
											colSpan={5}
											className="text-center text-muted-foreground"
										>
											No hay validaciones para este filtro.
										</TableCell>
									</TableRow>
								)}
							{rows.map((row) => (
								<TableRow
									key={row.opportunityId}
									className="cursor-pointer hover:bg-muted/50"
									onClick={() => {
										setSelectedOpportunityId(row.opportunityId);
										setSelectedValidationId(null);
									}}
								>
									<TableCell className="whitespace-nowrap">
										{new Date(row.latestValidatedAt).toLocaleString("es-GT")}
									</TableCell>
									<TableCell>
										{[row.leadFirstName, row.leadLastName]
											.filter(Boolean)
											.join(" ") || "—"}
									</TableCell>
									<TableCell>{row.opportunityTitle}</TableCell>
									<TableCell>
										{row.documentCount} documento
										{row.documentCount === 1 ? "" : "s"}
										<span className="block text-muted-foreground text-xs">
											Ejecución {row.attemptNumber}
										</span>
									</TableCell>
									<TableCell>
										<ResultBadge result={row.aggregateResult} />
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
					<div className="flex items-center justify-between border-t pt-4">
						<span className="text-muted-foreground text-xs">
							{rows.length
								? `Mostrando ${page * PAGE_SIZE + 1}–${page * PAGE_SIZE + rows.length}`
								: ""}
						</span>
						<div className="flex gap-2">
							<Button
								variant="outline"
								size="sm"
								disabled={page === 0 || listQuery.isFetching}
								onClick={() => setPage((value) => value - 1)}
							>
								<ChevronLeft className="mr-1 h-4 w-4" />
								Anterior
							</Button>
							<Button
								variant="outline"
								size="sm"
								disabled={rows.length !== PAGE_SIZE || listQuery.isFetching}
								onClick={() => setPage((value) => value + 1)}
							>
								Siguiente
								<ChevronRight className="ml-1 h-4 w-4" />
							</Button>
						</div>
					</div>
				</CardContent>
			</Card>

			<Dialog
				open={!!(selectedOpportunityId || selectedValidationId)}
				onOpenChange={(open) => {
					if (!open) {
						setSelectedOpportunityId(null);
						setSelectedValidationId(null);
					}
				}}
			>
				<DialogContent className="max-h-[95vh] max-w-[95vw] overflow-y-auto lg:max-w-6xl">
					<DialogHeader>
						<DialogTitle>
							Detalle de la última validación documental
						</DialogTitle>
					</DialogHeader>
					{detailQuery.isLoading && (
						<p className="text-muted-foreground">Cargando…</p>
					)}
					{detailQuery.data && (
						<OpportunityValidationDetails
							group={detailQuery.data}
							initialValidationId={selectedValidationId ?? undefined}
							canCreateValidation={canUseValidationHistory}
							onCreateValidation={() => {
								const opportunityId = detailQuery.data.opportunityId;
								setSelectedOpportunityId(null);
								setSelectedValidationId(null);
								setNewDialogOpportunityId(opportunityId);
								setNewDialogOpen(true);
							}}
						/>
					)}
				</DialogContent>
			</Dialog>
		</div>
	);
}

function NewValidationDialog({
	initialOpportunityId,
	onCreated,
	onClose,
}: {
	initialOpportunityId?: string;
	onCreated: (opportunityId: string) => void;
	onClose: () => void;
}) {
	const queryClient = useQueryClient();
	const locked = !!initialOpportunityId;
	const [leadId, setLeadId] = useState<string | null>(null);
	const [opportunityId, setOpportunityId] = useState<string | null>(
		initialOpportunityId ?? null,
	);
	const [documentIds, setDocumentIds] = useState<string[]>([]);
	const [newFiles, setNewFiles] = useState<File[]>([]);
	const [leadSearch, setLeadSearch] = useState("");
	const [debouncedLeadSearch, setDebouncedLeadSearch] = useState("");
	useEffect(() => {
		const timeout = setTimeout(() => setDebouncedLeadSearch(leadSearch), 300);
		return () => clearTimeout(timeout);
	}, [leadSearch]);
	const leadsQuery = useQuery({
		...orpc.getLeads.queryOptions({
			input: { search: debouncedLeadSearch || undefined, limit: 20 },
		}),
		enabled: !locked,
	});
	const leadOptions: ComboboxOption[] = (leadsQuery.data?.data ?? []).map(
		(lead) => ({
			value: lead.id,
			label: [
				lead.firstName,
				lead.middleName,
				lead.lastName,
				lead.secondLastName,
			]
				.filter((part) => part?.trim())
				.join(" "),
		}),
	);
	const opportunitiesQuery = useQuery({
		...orpc.getOpportunities.queryOptions({ input: { leadId: leadId ?? "" } }),
		enabled: !!leadId && !locked,
	});
	const documentsQuery = useQuery({
		...orpc.getOpportunityDocuments.queryOptions({
			input: { opportunityId: opportunityId ?? "" },
		}),
		enabled: !!opportunityId,
	});
	const attemptStatusQuery = useQuery({
		...orpc.getDocumentIntegrityAttemptStatus.queryOptions({
			input: { opportunityId: opportunityId ?? "" },
		}),
		enabled: !!opportunityId,
	});
	const canValidate = attemptStatusQuery.data?.canValidate ?? false;
	const bankDocuments = (documentsQuery.data ?? []).filter(
		(document) =>
			[
				"estados_cuenta_1",
				"estados_cuenta_2",
				"estados_cuenta_3",
				"bank_statement",
			].includes(document.documentType) ||
			(document.documentType === "other" &&
				document.description?.startsWith("Estado de cuenta")),
	);
	// Documentos ya subidos y registrados dentro del intento en curso. Se llena
	// de forma incremental para poder recuperarlos si mutationFn falla antes de
	// devolver (una subida posterior falla, o validarDocumentosExistentes
	// rechaza), y así no reintentar subiendo y duplicando lo ya registrado.
	const committedUploadsRef = useRef<Array<{ file: File; documentId: string }>>(
		[],
	);
	const validationMutation = useMutation({
		mutationFn: async () => {
			committedUploadsRef.current = [];
			if (!opportunityId) throw new Error("Selecciona una oportunidad");
			if (documentIds.length + newFiles.length === 0)
				throw new Error("Selecciona al menos un documento");

			// allSettled en vez de all: si una subida falla, igual se espera a que
			// las demás terminen antes de propagar el error, para que
			// committedUploadsRef quede completo cuando onError lo lea (si no, un
			// hermano más lento registra su documento después de leído el ref y
			// ese archivo se reintentaría duplicado).
			const uploadOutcomes = await Promise.allSettled(
				newFiles.map(async (file) => {
					const { key } = await uploadFileToR2WithRetry(file, {
						resourceType: "opportunity_document",
						resourceId: opportunityId,
					});
					const document = await client.uploadOpportunityDocument({
						opportunityId,
						documentType: "bank_statement",
						file: {
							name: file.name,
							type: file.type || "application/pdf",
							size: file.size,
							key,
						},
					});
					if (!document) throw new Error(`No se pudo registrar ${file.name}`);
					committedUploadsRef.current.push({ file, documentId: document.id });
					return document.id;
				}),
			);
			const firstRejected = uploadOutcomes.find(
				(outcome): outcome is PromiseRejectedResult =>
					outcome.status === "rejected",
			);
			if (firstRejected) {
				throw firstRejected.reason instanceof Error
					? firstRejected.reason
					: new Error(String(firstRejected.reason));
			}
			const uploadedDocuments = uploadOutcomes.map(
				(outcome) => (outcome as PromiseFulfilledResult<string>).value,
			);
			const results = await client.validarDocumentosExistentes({
				opportunityDocumentIds: [...documentIds, ...uploadedDocuments],
			});
			return { opportunityId, results, uploadedDocuments };
		},
		onSuccess: ({ opportunityId, results, uploadedDocuments }) => {
			const successful = results.filter(
				(result) => result.validation && result.validation.result !== "error",
			).length;
			if (successful === 0) {
				// Los archivos ya se subieron y registraron como opportunityDocuments;
				// se mueven a documentIds para que un reintento los revalide en vez
				// de volver a subirlos y duplicar el registro.
				setDocumentIds((current) => [...current, ...uploadedDocuments]);
				setNewFiles([]);
				toast.error(
					"No se pudo validar ningún documento. Los archivos quedaron registrados; puedes reintentar la validación.",
				);
				return;
			}
			if (successful < results.length)
				toast.warning(
					`${successful} de ${results.length} documentos fueron validados`,
				);
			else
				toast.success(
					`${successful} documento${successful === 1 ? "" : "s"} validado${successful === 1 ? "" : "s"}`,
				);
			onCreated(opportunityId);
		},
		onSettled: () => {
			queryClient.invalidateQueries({
				queryKey: orpc.getOpportunityDocuments.key(),
			});
			queryClient.invalidateQueries({
				queryKey: orpc.getDocumentIntegrityAttemptStatus.key(),
			});
		},
		onError: (error) => {
			// mutationFn falló antes de devolver: adopta lo ya subido/registrado
			// para no volver a subirlo y duplicarlo en un reintento, y deja en
			// newFiles únicamente lo que de verdad no llegó a registrarse.
			const committed = committedUploadsRef.current;
			if (committed.length > 0) {
				setDocumentIds((current) => [
					...current,
					...committed.map((item) => item.documentId),
				]);
				setNewFiles((current) =>
					current.filter(
						(file) => !committed.some((item) => item.file === file),
					),
				);
			}
			toast.error(error.message);
		},
	});
	const isBusy = validationMutation.isPending;
	const selectedCount = documentIds.length + newFiles.length;

	return (
		<DialogContent className="max-w-lg">
			<DialogHeader>
				<DialogTitle>Nueva validación</DialogTitle>
				<DialogDescription>
					Selecciona o carga hasta 9 estados de cuenta de una misma oportunidad.
				</DialogDescription>
			</DialogHeader>
			<div className="space-y-4">
				{opportunityId && attemptStatusQuery.data && (
					<div className="rounded-md border bg-muted/40 p-3 text-sm">
						Validaciones utilizadas: {attemptStatusQuery.data.attemptCount}/
						{attemptStatusQuery.data.maxAttempts}
						{!canValidate && (
							<p className="mt-1 text-amber-700 text-xs">
								Esta oportunidad alcanzó el límite de validaciones documentales.
							</p>
						)}
					</div>
				)}
				{opportunityId && attemptStatusQuery.isError && (
					<div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
						<p>No se pudo consultar el cupo de validaciones documentales.</p>
						<Button
							className="mt-2"
							disabled={attemptStatusQuery.isFetching}
							onClick={() => void attemptStatusQuery.refetch()}
							size="sm"
							variant="outline"
						>
							{attemptStatusQuery.isFetching ? "Consultando…" : "Reintentar consulta"}
						</Button>
					</div>
				)}
				{locked ? (
					<div className="rounded-md border bg-muted/40 p-3 text-sm">
						Oportunidad fijada por enlace:{" "}
						<span className="font-mono">{initialOpportunityId}</span>
					</div>
				) : (
					<>
						<div className="space-y-2">
							<Label>Lead</Label>
							<Combobox
								options={leadOptions}
								value={leadId}
								onChange={(value) => {
									setLeadId(value);
									setOpportunityId(null);
									setDocumentIds([]);
									setNewFiles([]);
								}}
								onSearchChange={setLeadSearch}
								isLoading={leadsQuery.isFetching}
								placeholder="Buscar lead…"
								popOverWidth="full"
								isInModal
								disabled={isBusy}
							/>
						</div>
						<div className="space-y-2">
							<Label>Oportunidad</Label>
							<Select
								value={opportunityId ?? undefined}
								onValueChange={(value) => {
									setOpportunityId(value);
									setDocumentIds([]);
									setNewFiles([]);
								}}
								disabled={!leadId || isBusy}
							>
								<SelectTrigger>
									<SelectValue placeholder="Selecciona la oportunidad" />
								</SelectTrigger>
								<SelectContent>
									{(opportunitiesQuery.data ?? []).map((opportunity) => (
										<SelectItem key={opportunity.id} value={opportunity.id}>
											{opportunity.title}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
					</>
				)}
				<div className="space-y-2">
					<Label>Documentos existentes</Label>
					{bankDocuments.length > 0 && (
						<div className="max-h-40 space-y-1 overflow-y-auto rounded-md border p-2">
							{bankDocuments.map((document) => {
								const checked = documentIds.includes(document.id);
								return (
									<label
										key={document.id}
										className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted"
									>
										<input
											type="checkbox"
											checked={checked}
											disabled={
												!canValidate || (!checked && selectedCount >= 9)
											}
											onChange={(event) =>
												setDocumentIds((current) =>
													event.target.checked
														? [...current, document.id]
														: current.filter((id) => id !== document.id),
												)
											}
										/>
										<span className="truncate">{document.originalName}</span>
									</label>
								);
							})}
						</div>
					)}
					{opportunityId &&
						!documentsQuery.isLoading &&
						bankDocuments.length === 0 && (
							<p className="text-muted-foreground text-xs">
								La oportunidad no tiene estados de cuenta cargados.
							</p>
						)}
				</div>
				<div className="relative py-1">
					<Separator />
					<span className="absolute top-1/2 left-1/2 -translate-x-1/2 bg-background px-2 text-muted-foreground text-xs">
						o carga documentos nuevos
					</span>
				</div>
				<div className="space-y-2">
					<Label htmlFor="new-bank-statement">Archivos PDF</Label>
					<Input
						id="new-bank-statement"
						type="file"
						accept=".pdf,application/pdf"
						multiple
						disabled={!opportunityId || isBusy || !canValidate}
						onChange={(event) => {
							const selected = Array.from(event.target.files ?? []).filter(
								(file) =>
									file.type === "application/pdf" ||
									file.name.toLowerCase().endsWith(".pdf"),
							);
							const available = Math.max(0, 9 - documentIds.length);
							if (selected.length > available)
								toast.warning("Solo se pueden validar hasta 9 documentos");
							setNewFiles(selected.slice(0, available));
						}}
					/>
					{newFiles.length > 0 && (
						<div className="space-y-1">
							{newFiles.map((file, index) => (
								<div
									key={`${file.name}-${file.size}-${index}`}
									className="flex items-center justify-between rounded-md border px-2 py-1 text-sm"
								>
									<span className="flex min-w-0 items-center gap-2 truncate">
										<FileText className="h-4 w-4 shrink-0 text-red-500" />
										<span className="truncate">{file.name}</span>
									</span>
									<Button
										type="button"
										variant="ghost"
										size="icon"
										className="h-7 w-7"
										onClick={() =>
											setNewFiles((current) =>
												current.filter((_, fileIndex) => fileIndex !== index),
											)
										}
									>
										<Trash2 className="h-4 w-4" />
									</Button>
								</div>
							))}
						</div>
					)}
					<p className="text-muted-foreground text-xs">
						Los archivos quedarán guardados en la oportunidad como estados de
						cuenta.
					</p>
				</div>
			</div>
			<DialogFooter>
				<Button variant="outline" onClick={onClose} disabled={isBusy}>
					Cancelar
				</Button>
				<Button
					disabled={
						!opportunityId ||
						selectedCount === 0 ||
						isBusy ||
						!canValidate ||
						attemptStatusQuery.isLoading
					}
					onClick={() => validationMutation.mutate()}
				>
					{validationMutation.isPending ? (
						<>
							<Loader2 className="mr-2 h-4 w-4 animate-spin" />
							Validando {selectedCount} documento
							{selectedCount === 1 ? "" : "s"}…
						</>
					) : (
						`Validar ${selectedCount} documento${selectedCount === 1 ? "" : "s"}`
					)}
				</Button>
			</DialogFooter>
		</DialogContent>
	);
}

type ValidationGroup = Awaited<
	ReturnType<typeof client.getDocumentIntegrityValidationGroup>
>;
type ValidationDetails = ValidationGroup["validations"][number];
type ValidationAttempt = ValidationGroup["attempts"][number];

function getDocumentLabel(result: ValidationDetails, index: number) {
	return result.documentName ?? `Documento ${index + 1}`;
}

function getDocumentTabKey(result: ValidationDetails) {
	// El ID de la validación es el único identificador único por fila: el mismo
	// PDF subido dos veces en un lote genera validaciones distintas con el
	// mismo contentSha256, y sus pestañas colisionarían.
	return result.id;
}

function getAttemptResult(attempt: ValidationAttempt): IntegrityResult {
	if (attempt.status === "error") return "error";
	return aggregateIntegrityResult(attempt.validations);
}

function ValidationAttemptDetails({
	attempt,
	canApproveManual,
	initialValidationId,
}: {
	attempt: ValidationAttempt;
	canApproveManual: boolean;
	initialValidationId?: string;
}) {
	if (attempt.validations.length === 0) {
		return (
			<div className="rounded-md border border-destructive/30 bg-destructive/5 p-4">
				<div className="flex items-center gap-2">
					<ResultBadge result="error" />
					<p className="font-medium">La ejecución no pudo completarse</p>
				</div>
				<p className="mt-2 text-muted-foreground text-sm">
					El proceso terminó antes de generar resultados individuales por
					documento. Puede volver a validar sin consumir el cupo.
				</p>
			</div>
		);
	}

	if (attempt.validations.length === 1) {
		return (
			<ValidationDetailsView
				result={attempt.validations[0]}
				canApproveManual={canApproveManual}
			/>
		);
	}

	const initialValidation = attempt.validations.find(
		(validation) => validation.id === initialValidationId,
	);

	return (
		<Tabs
			defaultValue={getDocumentTabKey(
				initialValidation ?? attempt.validations[0],
			)}
			className="w-full"
		>
			<TabsList className="h-auto max-w-full flex-wrap justify-start">
				{attempt.validations.map((result, index) => (
					<TabsTrigger
						key={getDocumentTabKey(result)}
						value={getDocumentTabKey(result)}
					>
						{getDocumentLabel(result, index)}
						<ResultBadge result={result.autoResult} />
					</TabsTrigger>
				))}
			</TabsList>
			{attempt.validations.map((result) => (
				<TabsContent
					key={getDocumentTabKey(result)}
					value={getDocumentTabKey(result)}
					className="mt-3"
				>
					<ValidationDetailsView
						result={result}
						canApproveManual={canApproveManual}
					/>
				</TabsContent>
			))}
		</Tabs>
	);
}

function OpportunityValidationDetails({
	group,
	onCreateValidation,
	initialValidationId,
	canCreateValidation,
}: {
	group: ValidationGroup;
	onCreateValidation: () => void;
	initialValidationId?: string;
	canCreateValidation: boolean;
}) {
	const clientName = [group.leadFirstName, group.leadLastName]
		.filter(Boolean)
		.join(" ");
	const latestAttempt = group.attempts[0];
	const requestedValidationMissing =
		!!initialValidationId &&
		!!latestAttempt &&
		!latestAttempt.validations.some(
			(validation) => validation.id === initialValidationId,
		);

	return (
		<div className="space-y-4">
			<div className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-muted/30 p-3">
				<div>
					<p className="font-semibold">{group.opportunityTitle}</p>
					{clientName && (
						<p className="text-muted-foreground text-sm">{clientName}</p>
					)}
				</div>
				<div className="flex flex-wrap items-center gap-2">
					{latestAttempt && (
						<Badge variant="secondary">
							Ejecución {latestAttempt.attemptNumber}
						</Badge>
					)}
					<Badge variant="outline">
						{group.validations.length} documento
						{group.validations.length === 1 ? "" : "s"}
					</Badge>
					<Badge variant="outline">
						Cupo actual: {group.attemptCount}/{group.maxAttempts}
					</Badge>
					{canCreateValidation &&
						group.attempts.length > 0 &&
						group.canValidate && (
							<Button size="sm" onClick={onCreateValidation}>
								Nueva validación por oportunidad
							</Button>
						)}
				</div>
			</div>
			{group.reset && (
				<div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-blue-900 text-sm">
					<p className="font-medium">Cupo de validaciones reiniciado</p>
					<p className="text-xs">
						Por {group.reset.resetByName || group.reset.resetByEmail} el{" "}
						{new Date(group.reset.resetAt).toLocaleString("es-GT")}, después de
						la ejecución {group.reset.resetAfterAttemptNumber}.
					</p>
				</div>
			)}

			{requestedValidationMissing && (
				<div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-amber-900 text-sm">
					<p className="font-medium">
						El documento solicitado no pertenece a esta ejecución
					</p>
					<p className="text-xs">
						El enlace apunta a una validación que ya no es la vigente. Se
						muestra la ejecución más reciente de la oportunidad.
					</p>
				</div>
			)}

			{!latestAttempt ? (
				<div className="space-y-3 py-8 text-center">
					<p className="text-muted-foreground text-sm">
						Esta oportunidad todavía no tiene validaciones documentales.
					</p>
					{canCreateValidation && (
						<Button onClick={onCreateValidation} disabled={!group.canValidate}>
							{group.canValidate
								? "Nueva validación"
								: "Límite de validaciones alcanzado"}
						</Button>
					)}
				</div>
			) : (
				<div className="space-y-3">
					<div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border bg-muted/30 px-3 py-2 text-sm">
						<span className="font-medium">
							Ejecución {latestAttempt.attemptNumber}
						</span>
						<ResultBadge result={getAttemptResult(latestAttempt)} />
						<span className="text-muted-foreground">
							{new Date(latestAttempt.validatedAt).toLocaleString("es-GT")}
						</span>
						<span className="text-muted-foreground">
							{latestAttempt.validations.length} documento
							{latestAttempt.validations.length === 1 ? "" : "s"}
						</span>
					</div>
					<ValidationAttemptDetails
						attempt={latestAttempt}
						canApproveManual={group.canApproveManual}
						initialValidationId={initialValidationId}
					/>
				</div>
			)}
		</div>
	);
}

export function ValidationDetailsView({
	result,
	canApproveManual,
}: {
	result: ValidationDetails;
	canApproveManual: boolean;
}) {
	return (
		<div className="space-y-5">
			<div className="grid gap-5 lg:grid-cols-2">
				{result.signedUrl ? (
					<iframe
						title="Estado de cuenta"
						src={result.signedUrl}
						className="h-[65vh] w-full rounded-md border bg-muted"
					/>
				) : (
					<div className="flex h-[65vh] w-full items-center justify-center rounded-md border bg-muted p-6 text-center text-muted-foreground text-sm">
						El archivo no está disponible para previsualizar. La validación no
						llegó a guardar un documento en esta oportunidad.
					</div>
				)}
				<div className="space-y-4">
					<div className="flex flex-wrap items-center justify-between gap-2">
						<ResultBadge result={result.autoResult} />
						<span className="text-muted-foreground text-xs">
							{new Date(result.validatedAt).toLocaleString("es-GT")}
						</span>
					</div>
					<div className="grid grid-cols-2 gap-3 rounded-md border p-3 text-sm">
						<div>
							<p className="text-muted-foreground text-xs">Score automático</p>
							<p className="font-semibold">
								{result.autoResult === "rechazado" && result.autoScore === 0
									? "No aplica — rechazo directo"
									: result.autoScore}
							</p>
						</div>
						<div>
							<p className="text-muted-foreground text-xs">Origen</p>
							<p>
								{result.validationSource === "analisis_capacidad"
									? "Análisis de capacidad"
									: "Validación manual"}
							</p>
						</div>
						<div className="col-span-2">
							<p className="text-muted-foreground text-xs">Motivo</p>
							<p>{result.autoReason}</p>
						</div>
					</div>
					<div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-blue-900 text-sm dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-200">
						<p className="font-semibold">Acción recomendada</p>
						<p className="mt-1">{result.recommendedAction}</p>
					</div>
					{result.manualApproval && result.autoResult === "revision_manual" && (
						<div className="rounded-md border border-green-200 bg-green-50 p-3 text-green-900 text-sm dark:border-green-900 dark:bg-green-950/30 dark:text-green-200">
							<p className="font-semibold">Aprobado manualmente</p>
							<p className="mt-1 text-xs">
								Por{" "}
								{result.manualApproval.approvedByName ||
									result.manualApproval.approvedByEmail}{" "}
								el{" "}
								{new Date(result.manualApproval.approvedAt).toLocaleString(
									"es-GT",
								)}
							</p>
							<p className="mt-2">{result.manualApproval.reason}</p>
						</div>
					)}
					{result.manualApproval && result.autoResult === "rechazado" && (
						<div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-amber-900 text-sm dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
							<p className="font-semibold">Aprobación histórica</p>
							<p className="mt-1 text-xs">
								Esta aprobación permanece como evidencia de auditoría, pero ya
								no habilita un documento rechazado.
							</p>
							<p className="mt-2">{result.manualApproval.reason}</p>
						</div>
					)}
					{requiresManualApproval(result.autoResult) &&
						!result.manualApproval &&
						canApproveManual && (
							<ManualDocumentApprovalButton validationId={result.id} />
						)}
					{result.positiveChecks.length > 0 && (
						<div className="space-y-2">
							<h3 className="font-semibold">
								Comprobaciones favorables ({result.positiveChecks.length})
							</h3>
							<div className="space-y-2">
								{result.positiveChecks.map((check) => (
									<div
										key={check.code}
										className="flex items-start gap-2 rounded-md border border-green-200 bg-green-50 p-3 text-sm dark:border-green-900 dark:bg-green-950/30"
									>
										<CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-600" />
										<span>{check.label}</span>
									</div>
								))}
							</div>
						</div>
					)}
					<div className="space-y-2">
						<h3 className="font-semibold">
							Señales y observaciones ({result.signals.length})
						</h3>
						{result.signals.length === 0 ? (
							<p className="text-muted-foreground text-sm">
								No se detectaron señales de riesgo.
							</p>
						) : (
							<div className="max-h-72 space-y-2 overflow-y-auto">
								{result.signals.map((signal, index) => (
									<div
										key={`${signal.code}-${index}`}
										className="rounded-md border p-3 text-sm"
									>
										<div className="flex items-center gap-2">
											<span
												className={`h-2.5 w-2.5 rounded-full ${signal.severity === "alta" ? "bg-red-500" : signal.severity === "media" ? "bg-amber-500" : "bg-blue-400"}`}
											/>
											<span className="font-medium">{signal.label}</span>
											{signal.page && (
												<Badge variant="outline">Página {signal.page}</Badge>
											)}
											{signal.weight <= 0 && (
												<Badge variant="secondary">Informativo</Badge>
											)}
											{signal.source === "ia" && (
												<Badge variant="outline">
													<Sparkles className="mr-1 h-3 w-3" />
													IA
												</Badge>
											)}
										</div>
										{signal.description && (
											<p className="mt-1 text-muted-foreground">
												{signal.description}
											</p>
										)}
										{signal.evidence && (
											<div className="mt-2 flex flex-wrap gap-1">
												{Object.entries(signal.evidence).map(([key, value]) => (
													<Badge key={key} variant="secondary">
														{key === "textoDetectado" ? "Texto detectado" : key}
														: {String(value)}
													</Badge>
												))}
											</div>
										)}
									</div>
								))}
							</div>
						)}
					</div>
				</div>
			</div>
		</div>
	);
}
