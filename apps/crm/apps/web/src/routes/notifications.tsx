import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
	Bell,
	CheckCircle,
	Clock,
	Eye,
	FileUp,
	Info,
	Loader2,
	XCircle,
} from "lucide-react";
import { useMemo, useState } from "react";
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
		color: "bg-yellow-100 text-yellow-800",
		icon: Clock,
	},
	read: { label: "Leída", color: "bg-blue-100 text-blue-800", icon: Eye },
	in_progress: {
		label: "En proceso",
		color: "bg-purple-100 text-purple-800",
		icon: Loader2,
	},
	resolved: {
		label: "Resuelta",
		color: "bg-green-100 text-green-800",
		icon: CheckCircle,
	},
	dismissed: {
		label: "Descartada",
		color: "bg-gray-100 text-gray-800",
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

	const [statusFilter, setStatusFilter] = useState<string>("all");

	// Admin: todas las notificaciones
	const allNotifications = useQuery({
		...orpc.getAllNotifications.queryOptions(),
		enabled: !!session && isAdmin,
	});

	// Otros roles: por rol
	const byRoleNotifications = useQuery({
		...orpc.getNotificationsByRole.queryOptions(),
		enabled: !!session && !isAdmin && !!userRole,
	});

	// Otros roles: asignadas directamente
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
			queryClient.invalidateQueries({ queryKey: ["getAllNotifications"] });
			queryClient.invalidateQueries({ queryKey: ["getNotificationsByRole"] });
			queryClient.invalidateQueries({ queryKey: ["getNotificationsByAssign"] });
		},
		onError: (error: Error) => {
			toast.error(error.message);
		},
	});

	// Combinar notificaciones para roles no-admin (deduplicar por id)
	const notifications = useMemo(() => {
		if (isAdmin) {
			return allNotifications.data ?? [];
		}

		const byRole = byRoleNotifications.data ?? [];
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
		allNotifications.data,
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
		(isAdmin ? allNotifications.isLoading : byRoleNotifications.isLoading);

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
			<div className="grid gap-4 md:grid-cols-3">
				<Card>
					<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
						<CardTitle className="font-medium text-sm">Pendientes</CardTitle>
						<Clock className="h-4 w-4 text-yellow-500" />
					</CardHeader>
					<CardContent>
						<div className="font-bold text-2xl">{pendingCount}</div>
					</CardContent>
				</Card>
				<Card>
					<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
						<CardTitle className="font-medium text-sm">En proceso</CardTitle>
						<Loader2 className="h-4 w-4 text-purple-500" />
					</CardHeader>
					<CardContent>
						<div className="font-bold text-2xl">{inProgressCount}</div>
					</CardContent>
				</Card>
				<Card>
					<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
						<CardTitle className="font-medium text-sm">Resueltas</CardTitle>
						<CheckCircle className="h-4 w-4 text-green-500" />
					</CardHeader>
					<CardContent>
						<div className="font-bold text-2xl">{resolvedCount}</div>
					</CardContent>
				</Card>
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
					{filtered.map((notification) => {
						const statusInfo =
							STATUS_CONFIG[notification.status as NotificationStatus] ??
							STATUS_CONFIG.pending;
						const typeInfo =
							TYPE_CONFIG[notification.type] ?? TYPE_CONFIG.aviso;
						const StatusIcon = statusInfo.icon;
						const TypeIcon = typeInfo.icon;

						return (
							<Card
								key={notification.id}
								className={
									notification.status === "pending"
										? "border-yellow-200 bg-yellow-50/30 dark:border-yellow-900 dark:bg-yellow-950/20"
										: ""
								}
							>
								<CardHeader className="pb-3">
									<div className="flex items-start justify-between gap-4">
										<div className="flex items-start gap-3">
											<TypeIcon className="mt-0.5 h-5 w-5 text-muted-foreground" />
											<div className="space-y-1">
												<CardTitle className="text-base">
													{notification.titulo}
												</CardTitle>
												{notification.descripcion && (
													<CardDescription>
														{notification.descripcion}
													</CardDescription>
												)}
											</div>
										</div>
										<div className="flex shrink-0 items-center gap-2">
											<Badge variant="outline" className={statusInfo.color}>
												<StatusIcon className="mr-1 h-3 w-3" />
												{statusInfo.label}
											</Badge>
											<Badge variant="secondary">{typeInfo.label}</Badge>
										</div>
									</div>
								</CardHeader>
								<CardContent>
									<div className="flex items-center justify-between">
										{/* Meta info */}
										<div className="flex flex-wrap items-center gap-3 text-muted-foreground text-sm">
											<span>
												Para:{" "}
												<span className="font-medium text-foreground">
													{getRoleLabel(notification.assignedToRole)}
												</span>
											</span>
											{notification.assignedTo && (
												<span>
													Asignado a:{" "}
													<span className="font-medium text-foreground">
														usuario específico
													</span>
												</span>
											)}
											<span>
												{new Date(notification.createdAt).toLocaleDateString(
													"es-GT",
													{
														day: "2-digit",
														month: "short",
														year: "numeric",
														hour: "2-digit",
														minute: "2-digit",
													},
												)}
											</span>
										</div>

										{/* Acciones */}
										<div className="flex items-center gap-2">
											{notification.status === "pending" && (
												<>
													<Button
														size="sm"
														variant="outline"
														onClick={() =>
															changeStatus.mutate({
																notificationId: notification.id,
																status: "read",
															})
														}
														disabled={changeStatus.isPending}
													>
														<Eye className="mr-1 h-3 w-3" />
														Marcar leída
													</Button>
													<Button
														size="sm"
														variant="default"
														onClick={() =>
															changeStatus.mutate({
																notificationId: notification.id,
																status: "resolved",
															})
														}
														disabled={changeStatus.isPending}
													>
														<CheckCircle className="mr-1 h-3 w-3" />
														Resolver
													</Button>
												</>
											)}
											{notification.status === "read" && (
												<>
													<Button
														size="sm"
														variant="outline"
														onClick={() =>
															changeStatus.mutate({
																notificationId: notification.id,
																status: "in_progress",
															})
														}
														disabled={changeStatus.isPending}
													>
														<Loader2 className="mr-1 h-3 w-3" />
														En proceso
													</Button>
													<Button
														size="sm"
														variant="default"
														onClick={() =>
															changeStatus.mutate({
																notificationId: notification.id,
																status: "resolved",
															})
														}
														disabled={changeStatus.isPending}
													>
														<CheckCircle className="mr-1 h-3 w-3" />
														Resolver
													</Button>
												</>
											)}
											{notification.status === "in_progress" && (
												<Button
													size="sm"
													variant="default"
													onClick={() =>
														changeStatus.mutate({
															notificationId: notification.id,
															status: "resolved",
														})
													}
													disabled={changeStatus.isPending}
												>
													<CheckCircle className="mr-1 h-3 w-3" />
													Resolver
												</Button>
											)}
											{(notification.status === "pending" ||
												notification.status === "read") && (
												<Button
													size="sm"
													variant="ghost"
													onClick={() =>
														changeStatus.mutate({
															notificationId: notification.id,
															status: "dismissed",
														})
													}
													disabled={changeStatus.isPending}
												>
													<XCircle className="mr-1 h-3 w-3" />
													Descartar
												</Button>
											)}
										</div>
									</div>
								</CardContent>
							</Card>
						);
					})}
				</div>
			)}
		</div>
	);
}
