import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
	Bell,
	CheckCircle,
	Clock,
	Download,
	Eye,
	FileUp,
	Info,
	Loader2,
	Send,
	Upload,
	XCircle,
} from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { authClient } from "@/lib/auth-client";
import { getRoleLabel, ROLES } from "@/lib/roles";
import { client, orpc, queryClient } from "@/utils/orpc";

export const Route = createFileRoute("/notifications")({
	component: NotificationsPage,
});

type NotificationStatus =
	| "pending"
	| "read"
	| "in_progress"
	| "resolved"
	| "dismissed";

const STATUS_CONFIG: Record<
	NotificationStatus,
	{ label: string; color: string; icon: typeof Bell }
> = {
	pending: {
		label: "Pendiente",
		color: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
		icon: Clock,
	},
	read: {
		label: "Leída",
		color: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
		icon: Eye,
	},
	in_progress: {
		label: "En proceso",
		color: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400",
		icon: Loader2,
	},
	resolved: {
		label: "Resuelta",
		color: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
		icon: CheckCircle,
	},
	dismissed: {
		label: "Descartada",
		color: "bg-gray-100 text-gray-800 dark:bg-gray-800/30 dark:text-gray-400",
		icon: XCircle,
	},
};

const TYPE_CONFIG: Record<string, { label: string; icon: typeof Bell }> = {
	aviso: { label: "Aviso", icon: Info },
	action_upload_files: { label: "Subir archivos", icon: FileUp },
	action_required: { label: "Acción requerida", icon: Bell },
	reminder: { label: "Recordatorio", icon: Clock },
	system: { label: "Sistema", icon: Bell },
};

function NotificationsPage() {
	const { data: session, isPending: isSessionPending } =
		authClient.useSession();
	const userProfile = useQuery({
		...orpc.getUserProfile.queryOptions(),
		enabled: !!session,
	});

	const userRole = userProfile.data?.role;
	const isAdmin = userRole === ROLES.ADMIN;
	const isSalesSupervisor = userRole === ROLES.SALES_SUPERVISOR;

	const [statusFilter, setStatusFilter] = useState<string>("all");

	// Admin: todas las notificaciones
	const allNotifications = useQuery({
		...orpc.getAllNotifications.queryOptions(),
		enabled: !!session && isAdmin,
	});

	// Supervisor de ventas: notificaciones de su rol + analyst + juridico
	const supervisorNotifications = useQuery({
		...orpc.getNotificationsByRoles.queryOptions({
			input: {
				roles: ["sales_supervisor", "analyst", "juridico"],
			},
		}),
		enabled: !!session && isSalesSupervisor,
	});

	// Otros roles: por rol (no admin, no supervisor)
	const byRoleNotifications = useQuery({
		...orpc.getNotificationsByRole.queryOptions(),
		enabled: !!session && !isAdmin && !isSalesSupervisor && !!userRole,
	});

	// No admin: asignadas directamente
	const byAssignNotifications = useQuery({
		...orpc.getNotificationsByAssign.queryOptions(),
		enabled: !!session && !isAdmin,
	});

	// Mutation para cambiar status
	const changeStatus = useMutation({
		mutationFn: async ({
			notificationId,
			status,
		}: {
			notificationId: string;
			status: NotificationStatus;
		}) => {
			return await client.changeNotificationStatus({ notificationId, status });
		},
		onSuccess: () => {
			toast.success("Estado actualizado");
			queryClient.invalidateQueries(orpc.getAllNotifications.queryOptions());
			queryClient.invalidateQueries(orpc.getNotificationsByRole.queryOptions());
			queryClient.invalidateQueries(
				orpc.getNotificationsByRoles.queryOptions({
					input: { roles: ["sales_supervisor", "analyst", "juridico"] },
				}),
			);
			queryClient.invalidateQueries(
				orpc.getNotificationsByAssign.queryOptions(),
			);
			queryClient.invalidateQueries(
				orpc.getUnreadNotificationCount.queryOptions(),
			);
		},
		onError: (error: Error) => {
			toast.error(error.message);
		},
	});

	// Combinar notificaciones (deduplicar por id)
	const notifications = useMemo(() => {
		if (isAdmin) {
			return allNotifications.data ?? [];
		}

		const byRole = isSalesSupervisor
			? (supervisorNotifications.data ?? [])
			: (byRoleNotifications.data ?? []);
		const byAssign = byAssignNotifications.data ?? [];
		const map = new Map<string, (typeof byRole)[number]>();
		for (const n of byRole) map.set(n.id, n);
		for (const n of byAssign) map.set(n.id, n);
		return Array.from(map.values()).sort(
			(a, b) =>
				new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
		);
	}, [
		isAdmin,
		isSalesSupervisor,
		allNotifications.data,
		supervisorNotifications.data,
		byRoleNotifications.data,
		byAssignNotifications.data,
	]);

	// Filtro por status
	const filtered = useMemo(() => {
		if (statusFilter === "all") return notifications;
		return notifications.filter((n) => n.status === statusFilter);
	}, [notifications, statusFilter]);

	const isLoading =
		isSessionPending ||
		userProfile.isPending ||
		(isAdmin
			? allNotifications.isLoading
			: isSalesSupervisor
				? supervisorNotifications.isLoading
				: byRoleNotifications.isLoading);

	if (isLoading) {
		return (
			<div className="flex min-h-[50vh] items-center justify-center">
				<Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
			</div>
		);
	}

	if (!session) {
		return null;
	}

	// Contadores
	const pendingCount = notifications.filter(
		(n) => n.status === "pending",
	).length;
	const inProgressCount = notifications.filter(
		(n) => n.status === "in_progress",
	).length;
	const resolvedCount = notifications.filter(
		(n) => n.status === "resolved",
	).length;

	return (
		<div className="container mx-auto space-y-6 p-6">
			{/* Header */}
			<div>
				<h1 className="font-bold text-3xl">Notificaciones</h1>
				<p className="text-muted-foreground">
					{isAdmin
						? "Todas las notificaciones del sistema"
						: "Tus notificaciones pendientes y asignadas"}
				</p>
			</div>

			{/* Stats */}
			<div className="flex items-center gap-6">
				<div className="flex items-center gap-2">
					<div className="flex h-6 w-6 items-center justify-center rounded-full bg-yellow-100 dark:bg-yellow-900/30">
						<Clock className="h-3 w-3 text-yellow-600 dark:text-yellow-400" />
					</div>
					<span className="font-semibold text-sm">{pendingCount}</span>
					<span className="text-muted-foreground text-xs">pendientes</span>
				</div>
				<div className="h-4 w-px bg-border" />
				<div className="flex items-center gap-2">
					<div className="flex h-6 w-6 items-center justify-center rounded-full bg-purple-100 dark:bg-purple-900/30">
						<Loader2 className="h-3 w-3 text-purple-600 dark:text-purple-400" />
					</div>
					<span className="font-semibold text-sm">{inProgressCount}</span>
					<span className="text-muted-foreground text-xs">en proceso</span>
				</div>
				<div className="h-4 w-px bg-border" />
				<div className="flex items-center gap-2">
					<div className="flex h-6 w-6 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/30">
						<CheckCircle className="h-3 w-3 text-green-600 dark:text-green-400" />
					</div>
					<span className="font-semibold text-sm">{resolvedCount}</span>
					<span className="text-muted-foreground text-xs">resueltas</span>
				</div>
			</div>

			{/* Filtro */}
			<div className="flex items-center gap-4">
				<Select value={statusFilter} onValueChange={setStatusFilter}>
					<SelectTrigger className="w-[200px]">
						<SelectValue placeholder="Filtrar por estado" />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="all">Todos</SelectItem>
						<SelectItem value="pending">Pendientes</SelectItem>
						<SelectItem value="read">Leídas</SelectItem>
						<SelectItem value="in_progress">En proceso</SelectItem>
						<SelectItem value="resolved">Resueltas</SelectItem>
						<SelectItem value="dismissed">Descartadas</SelectItem>
					</SelectContent>
				</Select>
				<span className="text-muted-foreground text-sm">
					{filtered.length} notificación{filtered.length !== 1 ? "es" : ""}
				</span>
			</div>

			{/* Lista de notificaciones */}
			{filtered.length === 0 ? (
				<Card>
					<CardContent className="flex flex-col items-center justify-center py-12">
						<Bell className="mb-4 h-12 w-12 text-muted-foreground/50" />
						<p className="font-medium text-lg text-muted-foreground">
							No hay notificaciones
						</p>
					</CardContent>
				</Card>
			) : (
				<div className="space-y-3">
					{filtered.map((notification) => (
						<NotificationCard
							key={notification.id}
							notification={notification}
							onChangeStatus={(status) =>
								changeStatus.mutate({
									notificationId: notification.id,
									status,
								})
							}
							isChanging={changeStatus.isPending}
						/>
					))}
				</div>
			)}
		</div>
	);
}

function NotificationCard({
	notification,
	onChangeStatus,
	isChanging,
}: {
	notification: {
		id: string;
		titulo: string;
		descripcion: string | null;
		status: string;
		type: string;
		createdByName: string | null;
		createdByRole: string;
		assignedToRole: string;
		assignedTo: string | null;
		createdAt: Date;
	};
	onChangeStatus: (status: NotificationStatus) => void;
	isChanging: boolean;
}) {
	const [uploadOpen, setUploadOpen] = useState(false);

	const statusInfo =
		STATUS_CONFIG[notification.status as NotificationStatus] ??
		STATUS_CONFIG.pending;
	const typeInfo = TYPE_CONFIG[notification.type] ?? TYPE_CONFIG.aviso;
	const TypeIcon = typeInfo.icon;
	const isPending = notification.status === "pending";
	const isRead = notification.status === "read";
	const isInProgress = notification.status === "in_progress";
	const isAviso = notification.type === "aviso";
	const isUploadType = notification.type === "action_upload_files";
	const isResolved = notification.status === "resolved";
	const isDismissed = notification.status === "dismissed";

	// Para action_upload_files: consultar documentos para saber si puede resolver
	const docsQuery = useQuery({
		...orpc.getNotificationDocuments.queryOptions({
			input: { notificationId: notification.id },
		}),
		enabled: isUploadType,
	});

	const hasDocuments = (docsQuery.data?.length ?? 0) > 0;

	return (
		<>
			<div
				className={`rounded-lg border p-4 transition-colors ${
					isPending
						? "border-yellow-200 bg-yellow-50/40 dark:border-yellow-900/50 dark:bg-yellow-950/20"
						: "border-border bg-card"
				}`}
			>
				{/* Fila superior: icono + titulo + badges */}
				<div className="flex items-start justify-between gap-3">
					<div className="flex items-start gap-3 min-w-0">
						<div
							className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
								isPending
									? "bg-yellow-100 dark:bg-yellow-900/40"
									: "bg-muted"
							}`}
						>
							<TypeIcon
								className={`h-4 w-4 ${
									isPending
										? "text-yellow-600 dark:text-yellow-400"
										: "text-muted-foreground"
								}`}
							/>
						</div>
						<div className="min-w-0">
							<p
								className={`text-sm leading-snug ${
									isPending ? "font-semibold" : "font-medium"
								}`}
							>
								{notification.titulo}
							</p>
							{notification.descripcion && (
								<p className="mt-0.5 text-muted-foreground text-xs leading-relaxed">
									{notification.descripcion}
								</p>
							)}
						</div>
					</div>
					<div className="flex shrink-0 items-center gap-1.5">
						<Badge
							variant="outline"
							className={`text-[11px] ${statusInfo.color}`}
						>
							{statusInfo.label}
						</Badge>
						<Badge variant="secondary" className="text-[11px]">
							{typeInfo.label}
						</Badge>
					</div>
				</div>

				{/* Documentos subidos (solo para action_upload_files) */}
				{isUploadType && hasDocuments && (
					<div className="mt-2 ml-11 flex flex-wrap gap-2">
						{docsQuery.data?.map((doc) => (
							<a
								key={doc.id}
								href={doc.url}
								target="_blank"
								rel="noopener noreferrer"
								className="inline-flex items-center gap-1 rounded-md border bg-muted/50 px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
							>
								<Download className="h-3 w-3" />
								{doc.originalName}
							</a>
						))}
					</div>
				)}

				{/* Fila inferior: meta + acciones */}
				<div className="mt-3 flex items-center justify-between gap-4">
					<div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground text-xs">
						{/* Enviado por */}
						<span className="inline-flex items-center gap-1">
							<Send className="h-3 w-3" />
							{notification.createdByName ?? "Sistema"}
							<span className="text-muted-foreground/60">
								({getRoleLabel(notification.createdByRole)})
							</span>
						</span>

						<span className="text-muted-foreground/30">|</span>

						{/* Para rol */}
						<span>
							Para{" "}
							<span className="font-medium text-foreground">
								{getRoleLabel(notification.assignedToRole)}
							</span>
						</span>

						{notification.assignedTo && (
							<>
								<span className="text-muted-foreground/30">|</span>
								<span>Asignación directa</span>
							</>
						)}

						<span className="text-muted-foreground/30">|</span>

						{/* Fecha */}
						<span>
							{new Date(notification.createdAt).toLocaleDateString("es-GT", {
								day: "2-digit",
								month: "short",
								year: "numeric",
								hour: "2-digit",
								minute: "2-digit",
							})}
						</span>
					</div>

					{/* Acciones */}
					<div className="flex shrink-0 items-center gap-1.5">
						{isAviso ? (
							<>
								{isPending && (
									<Button
										size="sm"
										variant="outline"
										className="h-7 text-xs"
										onClick={() => onChangeStatus("read")}
										disabled={isChanging}
									>
										<Eye className="mr-1 h-3 w-3" />
										Leída
									</Button>
								)}
								{(isPending || isRead) && (
									<Button
										size="sm"
										variant="ghost"
										className="h-7 text-xs text-muted-foreground"
										onClick={() => onChangeStatus("dismissed")}
										disabled={isChanging}
									>
										<XCircle className="mr-1 h-3 w-3" />
										Descartar
									</Button>
								)}
							</>
						) : isUploadType ? (
							<>
								{/* Botón para abrir modal de subida */}
								{!isResolved && !isDismissed && (
									<Button
										size="sm"
										variant="outline"
										className="h-7 text-xs"
										onClick={() => setUploadOpen(true)}
									>
										<Upload className="mr-1 h-3 w-3" />
										Subir archivos
									</Button>
								)}
								{isPending && (
									<Button
										size="sm"
										variant="outline"
										className="h-7 text-xs"
										onClick={() => onChangeStatus("read")}
										disabled={isChanging}
									>
										<Eye className="mr-1 h-3 w-3" />
										Leída
									</Button>
								)}
								{/* Resolver solo si hay documentos */}
								{hasDocuments && !isResolved && !isDismissed && (
									<Button
										size="sm"
										className="h-7 text-xs"
										onClick={() => onChangeStatus("resolved")}
										disabled={isChanging}
									>
										<CheckCircle className="mr-1 h-3 w-3" />
										Resolver
									</Button>
								)}
								{(isPending || isRead) && (
									<Button
										size="sm"
										variant="ghost"
										className="h-7 text-xs text-muted-foreground"
										onClick={() => onChangeStatus("dismissed")}
										disabled={isChanging}
									>
										<XCircle className="mr-1 h-3 w-3" />
										Descartar
									</Button>
								)}
							</>
						) : (
							<>
								{isPending && (
									<>
										<Button
											size="sm"
											variant="outline"
											className="h-7 text-xs"
											onClick={() => onChangeStatus("read")}
											disabled={isChanging}
										>
											<Eye className="mr-1 h-3 w-3" />
											Leída
										</Button>
										<Button
											size="sm"
											className="h-7 text-xs"
											onClick={() => onChangeStatus("resolved")}
											disabled={isChanging}
										>
											<CheckCircle className="mr-1 h-3 w-3" />
											Resolver
										</Button>
									</>
								)}
								{isRead && (
									<>
										<Button
											size="sm"
											variant="outline"
											className="h-7 text-xs"
											onClick={() => onChangeStatus("in_progress")}
											disabled={isChanging}
										>
											<Loader2 className="mr-1 h-3 w-3" />
											En proceso
										</Button>
										<Button
											size="sm"
											className="h-7 text-xs"
											onClick={() => onChangeStatus("resolved")}
											disabled={isChanging}
										>
											<CheckCircle className="mr-1 h-3 w-3" />
											Resolver
										</Button>
									</>
								)}
								{isInProgress && (
									<Button
										size="sm"
										className="h-7 text-xs"
										onClick={() => onChangeStatus("resolved")}
										disabled={isChanging}
									>
										<CheckCircle className="mr-1 h-3 w-3" />
										Resolver
									</Button>
								)}
								{(isPending || isRead) && (
									<Button
										size="sm"
										variant="ghost"
										className="h-7 text-xs text-muted-foreground"
										onClick={() => onChangeStatus("dismissed")}
										disabled={isChanging}
									>
										<XCircle className="mr-1 h-3 w-3" />
										Descartar
									</Button>
								)}
							</>
						)}
					</div>
				</div>
			</div>

			{/* Modal de subida de archivos */}
			{isUploadType && (
				<UploadDocumentsDialog
					notificationId={notification.id}
					open={uploadOpen}
					onOpenChange={setUploadOpen}
				/>
			)}
		</>
	);
}

function UploadDocumentsDialog({
	notificationId,
	open,
	onOpenChange,
}: {
	notificationId: string;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const fileInputRef = useRef<HTMLInputElement>(null);
	const [uploading, setUploading] = useState(false);

	const docsQuery = useQuery({
		...orpc.getNotificationDocuments.queryOptions({
			input: { notificationId },
		}),
		enabled: open,
	});

	const uploadMutation = useMutation({
		mutationFn: async (file: File) => {
			const data = await new Promise<string>((resolve, reject) => {
				const reader = new FileReader();
				reader.onload = () => {
					const base64 = (reader.result as string).split(",")[1];
					resolve(base64);
				};
				reader.onerror = reject;
				reader.readAsDataURL(file);
			});

			return await client.addDocumentToNotification({
				notificationId,
				file: {
					name: file.name,
					type: file.type,
					size: file.size,
					data,
				},
			});
		},
		onSuccess: () => {
			toast.success("Documento subido");
			queryClient.invalidateQueries(
				orpc.getNotificationDocuments.queryOptions({
					input: { notificationId },
				}),
			);
		},
		onError: (error: Error) => {
			toast.error(error.message);
		},
	});

	const handleFileSelect = useCallback(
		async (e: React.ChangeEvent<HTMLInputElement>) => {
			const files = e.target.files;
			if (!files?.length) return;

			setUploading(true);
			for (const file of Array.from(files)) {
				await uploadMutation.mutateAsync(file);
			}
			setUploading(false);

			// Reset input
			if (fileInputRef.current) {
				fileInputRef.current.value = "";
			}
		},
		[uploadMutation],
	);

	const docs = docsQuery.data ?? [];

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>Subir documentos</DialogTitle>
					<DialogDescription>
						Sube los archivos necesarios para completar esta notificación.
					</DialogDescription>
				</DialogHeader>

				{/* Lista de documentos subidos */}
				{docs.length > 0 && (
					<div className="space-y-2">
						<p className="text-muted-foreground text-xs font-medium">
							Documentos subidos ({docs.length})
						</p>
						<div className="space-y-1.5">
							{docs.map((doc) => (
								<div
									key={doc.id}
									className="flex items-center justify-between rounded-md border bg-muted/30 px-3 py-2"
								>
									<div className="flex items-center gap-2 min-w-0">
										<FileUp className="h-4 w-4 shrink-0 text-muted-foreground" />
										<span className="truncate text-sm">
											{doc.originalName}
										</span>
										<span className="shrink-0 text-muted-foreground text-xs">
											({(doc.size / 1024).toFixed(0)} KB)
										</span>
									</div>
									<a
										href={doc.url}
										target="_blank"
										rel="noopener noreferrer"
										className="shrink-0"
									>
										<Button size="sm" variant="ghost" className="h-7 text-xs">
											<Download className="h-3 w-3" />
										</Button>
									</a>
								</div>
							))}
						</div>
					</div>
				)}

				{/* Zona de subida */}
				<div
					className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-muted-foreground/25 p-6 transition-colors hover:border-muted-foreground/50"
					onClick={() => fileInputRef.current?.click()}
				>
					{uploading ? (
						<Loader2 className="mb-2 h-8 w-8 animate-spin text-muted-foreground" />
					) : (
						<Upload className="mb-2 h-8 w-8 text-muted-foreground/50" />
					)}
					<p className="text-sm text-muted-foreground">
						{uploading
							? "Subiendo..."
							: "Haz clic para seleccionar archivos"}
					</p>
					<p className="mt-1 text-[11px] text-muted-foreground/60">
						PDF, imágenes, Word o Excel (máx. 10 MB)
					</p>
					<input
						ref={fileInputRef}
						type="file"
						multiple
						accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx"
						className="hidden"
						onChange={handleFileSelect}
						disabled={uploading}
					/>
				</div>

				<DialogFooter>
					<Button variant="outline" onClick={() => onOpenChange(false)}>
						Cerrar
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
