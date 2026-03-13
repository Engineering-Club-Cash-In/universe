import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Database, LayoutDashboard, Scale } from "lucide-react";
import { toast } from "sonner";
import {
	type JuridicoDashboardPayload,
	JuridicoDashboardEditor,
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
	updateJuridicoDashboardSnapshot: (input: {
		periodLabel: string;
		notes?: string;
		payload: JuridicoDashboardPayload;
	}) => Promise<SnapshotRecord>;
};

export const Route = createFileRoute("/juridico/dashboard-data")({
	component: RouteComponent,
});

function RouteComponent() {
	const navigate = Route.useNavigate();
	const queryClient = useQueryClient();
	const { canViewLegal, isLoading } = useJuridicoPermissions();
	const snapshotQuery = useQuery({
		queryKey: ["getJuridicoDashboardSnapshot"],
		queryFn: () => juridicoDashboardClient.getJuridicoDashboardSnapshot(),
		enabled: canViewLegal && !isLoading,
	});

	const saveMutation = useMutation({
		mutationFn: juridicoDashboardClient.updateJuridicoDashboardSnapshot,
		onSuccess: async () => {
			await queryClient.invalidateQueries({
				queryKey: ["getJuridicoDashboardSnapshot"],
			});
			toast.success("Dashboard jurídico publicado");
		},
		onError: (error: Error) => {
			toast.error(error.message || "No se pudo publicar el dashboard");
		},
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
						<Database className="h-6 w-6 text-amber-600" />
					</div>
					<div>
						<h1 className="font-bold text-3xl">Carga de Datos Jurídico</h1>
						<p className="text-muted-foreground">
							Publica el snapshot que alimenta el dashboard ejecutivo
						</p>
					</div>
				</div>
				<div className="flex gap-2">
					<Button variant="outline" asChild>
						<Link to="/juridico">
							<Scale className="mr-2 h-4 w-4" />
							Gestión jurídica
						</Link>
					</Button>
					<Button asChild>
						<Link to="/juridico/dashboard">
							<LayoutDashboard className="mr-2 h-4 w-4" />
							Ver dashboard
						</Link>
					</Button>
				</div>
			</div>

			<Card className="border-amber-200 bg-amber-50/50">
				<CardHeader>
					<CardTitle>Cómo funciona</CardTitle>
					<CardDescription>
						Aquí pegas el JSON del período. Al publicar, reemplazas la versión
						visible en `/juridico/dashboard`.
					</CardDescription>
				</CardHeader>
				<CardContent className="text-sm">
					No se mezcla con Admin y no depende de tablas del CRM. El control queda
					dentro del módulo de Jurídico.
				</CardContent>
			</Card>

			{snapshotQuery.isLoading ? (
				<Card>
					<CardHeader>
						<CardTitle>Cargando snapshot actual</CardTitle>
						<CardDescription>
							Esperando la última publicación antes de habilitar la edición.
						</CardDescription>
					</CardHeader>
				</Card>
			) : snapshotQuery.isError ? (
				<Card className="border-destructive/30">
					<CardHeader>
						<CardTitle>No se pudo cargar la publicación actual</CardTitle>
						<CardDescription>
							Se bloqueó la edición para evitar sobrescribir datos existentes con
							la plantilla.
						</CardDescription>
					</CardHeader>
					<CardContent className="text-muted-foreground text-sm">
						Recarga la página o intenta más tarde cuando el snapshot pueda
						consultarse correctamente.
					</CardContent>
				</Card>
			) : (
				<JuridicoDashboardEditor
					snapshot={snapshotQuery.data ?? null}
					isSaving={saveMutation.isPending}
					onSave={async (input) => {
						await saveMutation.mutateAsync(input);
					}}
				/>
			)}
		</div>
	);
}
