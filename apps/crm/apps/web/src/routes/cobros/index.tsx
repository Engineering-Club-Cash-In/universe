import { createFileRoute } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { DashboardAsesor } from "@/components/cobros/asesor/dashboard-asesor";
import { DashboardSupervisor } from "@/components/cobros/supervision/dashboard-supervisor";
import { authClient } from "@/lib/auth-client";
import { PERMISSIONS, ROLES } from "@/lib/roles";

export const Route = createFileRoute("/cobros/")({
	component: RouteComponent,
});

/**
 * El asesor (rol `cobros`) ve su Dashboard (rediseño Figma, unifica "Mi día");
 * supervisión y admin ven el Dashboard del supervisor (Figma «Supervisor ›
 * Dashboard · Supervisor»). Este envoltorio solo lee la sesión, así cada
 * pantalla mantiene sus propios hooks.
 *
 * Del Dashboard de Cobros anterior, la tabla de casos pasó a la Cartera general
 * (`/cobros/cartera`), que tiene los mismos filtros. Sus KPIs, promesas, metas
 * de mora, embudo y seguimientos se quitaron a pedido del usuario.
 */
function RouteComponent() {
	const { data: session, isPending } = authClient.useSession();
	const userRole = session?.user.role;
	if (isPending && !session) {
		return (
			<div className="flex min-h-[50vh] items-center justify-center">
				<Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
			</div>
		);
	}
	if (userRole === ROLES.COBROS && !PERMISSIONS.canAssignCobros(userRole)) {
		return <DashboardAsesor />;
	}
	return <DashboardSupervisor />;
}
