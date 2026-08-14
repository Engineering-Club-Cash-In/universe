import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
	AlertCircle,
	CheckCircle2,
	HelpCircle,
	Loader2,
	QrCode,
	Upload,
	XCircle,
} from "lucide-react";
import {
	type ComponentType,
	type ReactNode,
	useEffect,
	useState,
} from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
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
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { uploadFileToR2WithRetry } from "@/lib/upload-to-r2";
import { client, orpc } from "@/utils/orpc";

export const Route = createFileRoute("/crm/licencias")({
	component: LicenciasPage,
});

type VerificationResult = "valida" | "invalida" | "ilegible" | "revision_manual";

const RESULT_META: Record<
	VerificationResult,
	{ label: string; className: string; Icon: ComponentType<{ className?: string }> }
> = {
	valida: {
		label: "Válida",
		className:
			"bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300",
		Icon: CheckCircle2,
	},
	invalida: {
		label: "Inválida",
		className: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
		Icon: XCircle,
	},
	ilegible: {
		label: "Ilegible",
		className:
			"bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
		Icon: AlertCircle,
	},
	revision_manual: {
		label: "Revisión manual",
		className: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300",
		Icon: HelpCircle,
	},
};

function ResultBadge({ result }: { result: string }) {
	const meta = RESULT_META[result as VerificationResult];
	if (!meta) return <Badge variant="outline">{result}</Badge>;
	const { Icon } = meta;
	return (
		<Badge className={meta.className}>
			<Icon className="mr-1 h-3.5 w-3.5" />
			{meta.label}
		</Badge>
	);
}

function LicenciasPage() {
	const [isDialogOpen, setIsDialogOpen] = useState(false);
	const [selectedVerificationId, setSelectedVerificationId] = useState<
		string | null
	>(null);
	const queryClient = useQueryClient();

	const verificationsQuery = useQuery({
		...orpc.listLicenseVerifications.queryOptions({ input: { limit: 50 } }),
	});

	// El listado no trae rawResponse (payload completo de Tránsito) — se pide
	// aparte solo cuando se abre el detalle de una fila.
	const detailQuery = useQuery({
		...orpc.getLicenseVerificationById.queryOptions({
			input: { id: selectedVerificationId ?? "" },
		}),
		enabled: !!selectedVerificationId,
	});

	return (
		<div className="container mx-auto space-y-6 p-6">
			<div className="flex items-center justify-between">
				<div>
					<h1 className="font-bold text-3xl">Licencias</h1>
					<p className="text-muted-foreground">
						Verificación del QR del reverso de licencia contra el sitio
						oficial de Tránsito.
					</p>
				</div>
				<Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
					<DialogTrigger asChild>
						<Button>
							<QrCode className="mr-2 h-4 w-4" />
							Nueva verificación
						</Button>
					</DialogTrigger>
					{/* Montado solo mientras está abierto: si no, el estado interno
					    (lead/oportunidad/foto/resultado elegidos) sobrevive a cerrar
					    con Esc/X/clic afuera y reaparece la próxima vez que se abre. */}
					{isDialogOpen && (
						<NewVerificationDialog
							onDone={() => {
								queryClient.invalidateQueries({
									queryKey: orpc.listLicenseVerifications.key(),
								});
							}}
							onClose={() => setIsDialogOpen(false)}
						/>
					)}
				</Dialog>
			</div>

			<Card>
				<CardHeader>
					<CardTitle>Historial de verificaciones</CardTitle>
				</CardHeader>
				<CardContent>
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Fecha</TableHead>
								<TableHead>Lead / Co-deudor</TableHead>
								<TableHead>Oportunidad</TableHead>
								<TableHead>N.º Licencia</TableHead>
								<TableHead>Nombre en Tránsito</TableHead>
								<TableHead>Resultado</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{verificationsQuery.isLoading && (
								<TableRow>
									<TableCell colSpan={6} className="text-center text-muted-foreground">
										Cargando...
									</TableCell>
								</TableRow>
							)}
							{verificationsQuery.data?.length === 0 && (
								<TableRow>
									<TableCell colSpan={6} className="text-center text-muted-foreground">
										Todavía no hay verificaciones.
									</TableCell>
								</TableRow>
							)}
							{verificationsQuery.data?.map((row) => (
								<TableRow
									key={row.id}
									className="cursor-pointer hover:bg-muted/50"
									onClick={() => setSelectedVerificationId(row.id)}
								>
									<TableCell className="whitespace-nowrap text-sm">
										{new Date(row.createdAt).toLocaleString("es-GT")}
									</TableCell>
									<TableCell>{row.subjectName}</TableCell>
									<TableCell>{row.opportunityTitle ?? "—"}</TableCell>
									<TableCell>{row.licenseNumber ?? "—"}</TableCell>
									<TableCell>{row.licenseHolderName ?? "—"}</TableCell>
									<TableCell>
										<ResultBadge result={row.result} />
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</CardContent>
			</Card>

			<Dialog
				open={!!selectedVerificationId}
				onOpenChange={(open) => !open && setSelectedVerificationId(null)}
			>
				<DialogContent className="max-w-lg">
					<DialogHeader>
						<DialogTitle>Detalle de verificación</DialogTitle>
					</DialogHeader>
					{detailQuery.isLoading && (
						<p className="text-muted-foreground text-sm">Cargando...</p>
					)}
					{detailQuery.data && (
						<VerificationDetailsView
							result={detailQuery.data}
							onClose={() => setSelectedVerificationId(null)}
						/>
					)}
				</DialogContent>
			</Dialog>
		</div>
	);
}

type VerificationRow = NonNullable<
	Awaited<ReturnType<typeof client.verifyLicenseQr>>
>;
// El resultado recién creado no trae subjectName/opportunityTitle (el
// diálogo ya sabe cuáles son); el de getLicenseVerificationById sí. Se
// aceptan ambos.
type VerificationDetails = VerificationRow & {
	subjectName?: string;
	opportunityTitle?: string | null;
};

const RAW_FIELD_LABELS: Record<string, string> = {
	bloqueo: "Bloqueo",
	estadoFol: "Estado de folio",
	antiguedad: "Antigüedad",
	idCiudadano: "ID ciudadano (Tránsito)",
	tipoLicencia: "Tipo de licencia",
	estadoLicencia: "Estado de licencia",
};

function RawResponseDetails({ rawResponse }: { rawResponse: unknown }) {
	if (!rawResponse || typeof rawResponse !== "object") return null;
	// Solo los campos que no se muestran ya en otro lado del detalle
	// (numeroLicencia, nombreCiudadano, fechaVencimiento quedan afuera).
	const entries = Object.entries(rawResponse as Record<string, unknown>).filter(
		([key]) => key in RAW_FIELD_LABELS,
	);
	if (entries.length === 0) return null;

	return (
		<div className="space-y-2">
			<p className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
				Otros datos de Tránsito
			</p>
			<div className="divide-y rounded-md border">
				{entries.map(([key, value]) => (
					<div
						key={key}
						className="flex items-center justify-between gap-4 px-3 py-2 text-sm"
					>
						<span className="text-muted-foreground">
							{RAW_FIELD_LABELS[key] ?? key}
						</span>
						<span className="font-medium">{String(value)}</span>
					</div>
				))}
			</div>
		</div>
	);
}

function DetailField({ label, value }: { label: string; value: ReactNode }) {
	return (
		<div>
			<p className="text-muted-foreground text-xs">{label}</p>
			<p className="font-medium text-sm">{value}</p>
		</div>
	);
}

function NewVerificationDialog({
	onDone,
	onClose,
}: {
	onDone: () => void;
	onClose: () => void;
}) {
	const [searchInput, setSearchInput] = useState("");
	const [debouncedSearch, setDebouncedSearch] = useState("");
	const [leadId, setLeadId] = useState<string | null>(null);
	const [opportunityId, setOpportunityId] = useState<string | null>(null);
	const [file, setFile] = useState<File | null>(null);
	const [result, setResult] = useState<VerificationRow | null>(null);

	// biome-ignore lint/correctness/useExhaustiveDependencies: debounce intencional del texto de búsqueda
	useEffect(() => {
		const timeout = setTimeout(() => setDebouncedSearch(searchInput), 300);
		return () => clearTimeout(timeout);
	}, [searchInput]);

	const leadsQuery = useQuery({
		...orpc.getLeads.queryOptions({
			input: { search: debouncedSearch || undefined, limit: 20 },
		}),
	});

	const leadOptions: ComboboxOption[] = (leadsQuery.data?.data ?? []).map(
		(lead) => ({
			value: lead.id,
			label: [lead.firstName, lead.middleName, lead.lastName, lead.secondLastName]
				.filter((p) => p?.trim())
				.join(" "),
		}),
	);

	// Una licencia se verifica por cada expediente de crédito, así que hace
	// falta elegir a cuál oportunidad del lead corresponde esta verificación.
	const opportunitiesQuery = useQuery({
		...orpc.getOpportunities.queryOptions({ input: { leadId: leadId ?? "" } }),
		enabled: !!leadId,
	});
	const opportunityOptions = opportunitiesQuery.data ?? [];

	const verifyMutation = useMutation({
		mutationFn: async () => {
			if (!leadId || !opportunityId || !file) {
				throw new Error(
					"Selecciona un lead, una oportunidad y sube la foto del reverso",
				);
			}
			const { key } = await uploadFileToR2WithRetry(file, {
				resourceType: "license_verification",
				resourceId: opportunityId,
			});
			return client.verifyLicenseQr({
				leadId,
				opportunityId,
				documentKey: key,
				fileName: file.name,
				mimeType: file.type,
			});
		},
		onSuccess: (data) => {
			setResult(data);
			onDone();
		},
		onError: (error: Error) => {
			toast.error(error.message || "Error al verificar la licencia");
		},
	});

	const handleClose = () => {
		setLeadId(null);
		setOpportunityId(null);
		setFile(null);
		setResult(null);
		setSearchInput("");
		onClose();
	};

	return (
		<DialogContent className="max-w-lg">
			<DialogHeader>
				<DialogTitle>Nueva verificación de licencia</DialogTitle>
				<DialogDescription>
					Sube una foto clara del reverso de la licencia; el QR y el
					código de barras se leen automáticamente.
				</DialogDescription>
			</DialogHeader>

			{!result ? (
				<div className="space-y-4">
					<div className="space-y-2">
						<Label>Lead</Label>
						<Combobox
							options={leadOptions}
							value={leadId}
							onChange={(value) => {
								setLeadId(value);
								setOpportunityId(null);
							}}
							onSearchChange={setSearchInput}
							isLoading={leadsQuery.isFetching}
							placeholder="Buscar lead por nombre..."
							popOverWidth="full"
							isInModal
						/>
					</div>

					<div className="space-y-2">
						<Label>Oportunidad</Label>
						<Select
							value={opportunityId ?? undefined}
							onValueChange={setOpportunityId}
							disabled={!leadId || opportunitiesQuery.isLoading}
						>
							<SelectTrigger>
								<SelectValue
									placeholder={
										leadId
											? "Selecciona la oportunidad..."
											: "Primero selecciona un lead"
									}
								/>
							</SelectTrigger>
							<SelectContent>
								{opportunityOptions.map((opportunity) => (
									<SelectItem key={opportunity.id} value={opportunity.id}>
										{opportunity.title}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>

					<div className="space-y-2">
						<Label htmlFor="license-back-file">Foto del reverso de la licencia</Label>
						<input
							id="license-back-file"
							type="file"
							// HEIC (default de cámara en iPhone) no está en
							// ALLOWED_DOCUMENT_TYPES del server, y WebP no lo soporta
							// el decodificador de imágenes de zxing-wasm (stb_image) —
							// ambos se rechazarían, así que se limita a lo que sí
							// funciona. capture="environment" abre la cámara directo
							// en mobile.
							accept="image/jpeg,image/png"
							capture="environment"
							onChange={(e) => setFile(e.target.files?.[0] ?? null)}
							className="block w-full text-sm file:mr-4 file:rounded-md file:border-0 file:bg-primary file:px-4 file:py-2 file:text-primary-foreground file:text-sm"
						/>
						{file && (
							<p className="text-muted-foreground text-xs">{file.name}</p>
						)}
					</div>

					<DialogFooter>
						<Button variant="outline" onClick={handleClose}>
							Cancelar
						</Button>
						<Button
							onClick={() => verifyMutation.mutate()}
							disabled={
								!leadId || !opportunityId || !file || verifyMutation.isPending
							}
						>
							{verifyMutation.isPending ? (
								<>
									<Loader2 className="mr-2 h-4 w-4 animate-spin" />
									Verificando...
								</>
							) : (
								<>
									<Upload className="mr-2 h-4 w-4" />
									Verificar
								</>
							)}
						</Button>
					</DialogFooter>
				</div>
			) : (
				<VerificationDetailsView result={result} onClose={handleClose} />
			)}
		</DialogContent>
	);
}

function VerificationDetailsView({
	result,
	onClose,
}: {
	result: VerificationDetails;
	onClose: () => void;
}) {
	const hasClientInfo = result.subjectName || result.opportunityTitle;

	return (
		<div className="space-y-6">
			<div className="flex items-center justify-between">
				<ResultBadge result={result.result} />
				<span className="text-muted-foreground text-xs">
					{new Date(result.createdAt).toLocaleString("es-GT")}
				</span>
			</div>

			{hasClientInfo && (
				<div className="space-y-3">
					<p className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
						Cliente
					</p>
					<div className="grid grid-cols-2 gap-x-6 gap-y-3">
						{result.subjectName && (
							<DetailField label="Lead / Co-deudor" value={result.subjectName} />
						)}
						{result.opportunityTitle && (
							<DetailField label="Oportunidad" value={result.opportunityTitle} />
						)}
					</div>
				</div>
			)}

			{hasClientInfo && <Separator />}

			<div className="space-y-3">
				<p className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
					Datos de la licencia
				</p>
				<div className="grid grid-cols-2 gap-x-6 gap-y-3">
					{result.licenseHolderName && (
						<DetailField label="Nombre en Tránsito" value={result.licenseHolderName} />
					)}
					{result.licenseNumber && (
						<DetailField label="N.º de licencia" value={result.licenseNumber} />
					)}
					{result.licenseExpiresAt && (
						<DetailField label="Vencimiento" value={result.licenseExpiresAt} />
					)}
					{result.identityMatchScore != null && (
						<DetailField
							label="Similitud de nombre"
							// numeric llega como string ("100.00") — se limpian los
							// decimales sobrantes en vez de mostrar "100.00%".
							value={`${Number.parseFloat(result.identityMatchScore)}%`}
						/>
					)}
				</div>
			</div>

			<Separator />

			<div className="space-y-3">
				<p className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
					Verificación técnica
				</p>
				<div className="grid grid-cols-2 gap-x-6 gap-y-3">
					{result.cardCode && (
						<DetailField label="Código de tarjeta" value={result.cardCode} />
					)}
					{result.apiResponseCode != null && (
						<DetailField
							label="Código de respuesta Tránsito"
							value={result.apiResponseCode}
						/>
					)}
				</div>
				<div className="flex flex-wrap items-center gap-2 pt-1 text-sm">
					{result.qrRawUrl ? (
						<a
							href={result.qrRawUrl}
							target="_blank"
							rel="noreferrer"
							className="truncate text-primary underline"
						>
							{result.qrRawUrl}
						</a>
					) : (
						<span className="text-muted-foreground">QR no se pudo leer</span>
					)}
					<Badge variant={result.qrDomainValid ? "secondary" : "destructive"}>
						{result.qrDomainValid ? "Dominio oficial" : "Dominio no válido"}
					</Badge>
				</div>
			</div>

			<RawResponseDetails rawResponse={result.rawResponse} />

			{result.failureReason && (
				<>
					<Separator />
					<p className="rounded-md border border-red-200 bg-red-50 p-3 text-red-800 text-sm dark:border-red-900 dark:bg-red-900/20 dark:text-red-300">
						{result.failureReason}
					</p>
				</>
			)}

			<DialogFooter>
				<Button onClick={onClose}>Cerrar</Button>
			</DialogFooter>
		</div>
	);
}
