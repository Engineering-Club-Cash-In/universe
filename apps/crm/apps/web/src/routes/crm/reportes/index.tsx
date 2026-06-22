import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { toast } from "sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { authClient } from "@/lib/auth-client";
import { shouldRedirectToLogin } from "@/lib/auth-session";
import { PERMISSIONS } from "@/lib/roles";
import { orpc } from "@/utils/orpc";
import { MetaColocacionContent } from "./meta-colocacion";
import { PorcentajeEfectividadContent } from "./porcentaje-efectividad";
import { TiempoCierreContent } from "./tiempo-cierre";

export const Route = createFileRoute("/crm/reportes/")({
	component: RouteComponent,
});

function RouteComponent() {
	const {
		data: session,
		error: sessionError,
		isPending: sessionPending,
	} = authClient.useSession();
	const navigate = useNavigate();

	const userProfile = useQuery(orpc.getUserProfile.queryOptions());
	const userRole = userProfile.data?.role;
	const canTiempo = userRole
		? PERMISSIONS.canAccessTiempoCierreReport(userRole)
		: false;
	const canEfectividad = userRole
		? PERMISSIONS.canAccessPorcentajeEfectividadReport(userRole)
		: false;
	const canMeta = userRole
		? PERMISSIONS.canAccessMetaColocacionReport(userRole)
		: false;
	const canAny = canTiempo || canEfectividad || canMeta;
	const isPending = sessionPending || userProfile.isPending;

	useEffect(() => {
		if (
			shouldRedirectToLogin({
				error: sessionError,
				isPending: sessionPending,
				session,
			})
		) {
			navigate({ to: "/login" });
		} else if (session && !userProfile.isPending && !canAny) {
			navigate({ to: "/dashboard" });
			toast.error("Acceso denegado");
		}
	}, [
		session,
		sessionError,
		sessionPending,
		userProfile.isPending,
		canAny,
		navigate,
	]);

	if (isPending) {
		return (
			<div className="flex h-96 items-center justify-center text-muted-foreground">
				Cargando...
			</div>
		);
	}

	if (!canAny) return null;

	const defaultTab = canTiempo
		? "tiempo"
		: canEfectividad
			? "efectividad"
			: "meta";

	return (
		<div className="container mx-auto space-y-6 p-6">
			<div>
				<h1 className="font-bold text-3xl tracking-tight">Reportes</h1>
				<p className="mt-1 text-muted-foreground">
					Reportes de ventas: tiempo de cierre, efectividad y meta de
					colocación.
				</p>
			</div>

			<Tabs defaultValue={defaultTab} className="space-y-6">
				<TabsList>
					{canTiempo && (
						<TabsTrigger value="tiempo">Tiempo Cierre Crédito</TabsTrigger>
					)}
					{canEfectividad && (
						<TabsTrigger value="efectividad">
							Porcentaje Efectividad
						</TabsTrigger>
					)}
					{canMeta && <TabsTrigger value="meta">Meta Colocación</TabsTrigger>}
				</TabsList>

				{canTiempo && (
					<TabsContent value="tiempo" className="space-y-6">
						<TiempoCierreContent />
					</TabsContent>
				)}
				{canEfectividad && (
					<TabsContent value="efectividad" className="space-y-6">
						<PorcentajeEfectividadContent />
					</TabsContent>
				)}
				{canMeta && (
					<TabsContent value="meta" className="space-y-6">
						<MetaColocacionContent />
					</TabsContent>
				)}
			</Tabs>
		</div>
	);
}
