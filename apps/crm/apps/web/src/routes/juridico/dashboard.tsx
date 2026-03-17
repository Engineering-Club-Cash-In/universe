import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Database, Scale, Settings } from "lucide-react";
import {
	type JuridicoDashboardPayload,
	JuridicoDashboardView,
} from "@/components/juridico/juridico-dashboard";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { useJuridicoPermissions } from "@/hooks/usePermissions";
import { client } from "@/utils/orpc";

type SnapshotRecord = {
	periodLabel: string;
	notes: string | null;
	payload: JuridicoDashboardPayload;
	publishedAt: string | Date;
};

const juridicoDashboardClient = client as typeof client & {
	getJuridicoDashboardSnapshot: () => Promise<SnapshotRecord | null>;
};

export const Route = createFileRoute("/juridico/dashboard")({
	component: RouteComponent,
});

function RouteComponent() {
	const navigate = Route.useNavigate();
	const { canViewLegal, isLoading } = useJuridicoPermissions();
	const snapshotQuery = useQuery({
		queryKey: ["getJuridicoDashboardSnapshot"],
		queryFn: () => juridicoDashboardClient.getJuridicoDashboardSnapshot(),
		enabled: canViewLegal && !isLoading,
	});

	if (!isLoading && !canViewLegal) {
		navigate({ to: "/dashboard" });
		return null;
	}

	return (
		<div className="container mx-auto space-y-6 py-8">
			<div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
				<div className="flex items-center gap-3">
					<div className="flex h-12 w-12 items-center justify-center rounded-lg bg-amber-100">
						<Scale className="h-6 w-6 text-amber-600" />
					</div>
					<div>
						<h1 className="font-bold text-3xl">Dashboard Jurídico</h1>
						<p className="text-muted-foreground">
							Indicadores cargados y publicados por el equipo jurídico
						</p>
					</div>
				</div>
				<div className="flex gap-2">
					<Button variant="outline" asChild>
						<Link to="/juridico">
							<Settings className="mr-2 h-4 w-4" />
							Gestión jurídica
						</Link>
					</Button>
					<Button asChild>
						<Link to="/juridico/dashboard-data">
							<Database className="mr-2 h-4 w-4" />
							Cargar datos
						</Link>
					</Button>
				</div>
			</div>

			{snapshotQuery.isLoading ? (
				<Card>
					<CardHeader>
						<CardTitle>Cargando dashboard</CardTitle>
						<CardDescription>Consultando la última versión publicada.</CardDescription>
					</CardHeader>
				</Card>
			) : snapshotQuery.isError ? (
				<Card className="border-destructive/30">
					<CardHeader>
						<CardTitle>No se pudo cargar el dashboard</CardTitle>
						<CardDescription>
							Ocurrió un error al consultar la última versión publicada.
						</CardDescription>
					</CardHeader>
					<CardContent className="text-muted-foreground text-sm">
						Intenta de nuevo más tarde o revisa la publicación desde la sección
						de carga de datos.
					</CardContent>
				</Card>
			) : (
				<JuridicoDashboardView snapshot={snapshotQuery.data ?? null} />
			)}
		</div>
	);
}
