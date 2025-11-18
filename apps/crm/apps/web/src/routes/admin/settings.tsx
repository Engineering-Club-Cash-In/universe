import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { toast } from "sonner";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { authClient } from "@/lib/auth-client";
import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/admin/settings")({
	component: RouteComponent,
});

function RouteComponent() {
	const { data: session, isPending } = authClient.useSession();
	const navigate = Route.useNavigate();

	const userProfile = useQuery(orpc.getUserProfile.queryOptions());

	useEffect(() => {
		if (!session && !isPending) {
			navigate({ to: "/login" });
		} else if (session && userProfile.data?.role !== "admin") {
			navigate({ to: "/dashboard" });
			toast.error("Acceso denegado: se requiere rol de administrador");
		}
	}, [session, isPending, userProfile.data?.role]);

	if (isPending || userProfile.isPending) {
		return <div>Cargando...</div>;
	}

	if (userProfile.data?.role !== "admin") {
		return null;
	}

	return (
		<div className="container mx-auto space-y-6 p-6">
			<div>
				<h1 className="font-bold text-3xl">Configuración del sistema</h1>
				<p className="text-muted-foreground">
					Configurar los ajustes y preferencias de todo el sistema
				</p>
			</div>

			<Card>
				<CardHeader>
					<CardTitle>Configuración</CardTitle>
					<CardDescription>
						Opciones de configuración del sistema
					</CardDescription>
				</CardHeader>
				<CardContent>
					<p className="text-muted-foreground">
						El panel de configuración estará disponible próximamente...
					</p>
				</CardContent>
			</Card>
		</div>
	);
}
