import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { useEffect } from "react";
import { toast } from "sonner";
import { MiniAgentCredentialsTable } from "@/components/admin/miniagent-credentials-table";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { authClient } from "@/lib/auth-client";
import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/crm/admin/miniagent")({
	component: RouteComponent,
});

function RouteComponent() {
	const { data: session, isPending: sessionPending } = authClient.useSession();
	const navigate = Route.useNavigate();

	const userProfile = useQuery({
		...orpc.getUserProfile.queryOptions(),
		enabled: !!session,
	});

	const usersWithCredentials = useQuery({
		...orpc.adminListUsersWithCredentials.queryOptions(),
		enabled: !!session && userProfile.data?.role === "admin",
	});

	const userRole = userProfile.data?.role;

	useEffect(() => {
		if (!session && !sessionPending) {
			navigate({ to: "/login" });
		} else if (session && userRole && userRole !== "admin") {
			navigate({ to: "/dashboard" });
			toast.error("Acceso denegado: esta sección es solo para administradores");
		}
	}, [session, sessionPending, userRole, navigate]);

	const handleRefetch = () => {
		usersWithCredentials.refetch();
	};

	if (sessionPending || userProfile.isPending) {
		return (
			<div className="flex h-[calc(100vh-4rem)] items-center justify-center">
				<Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
			</div>
		);
	}

	if (!userRole || userRole !== "admin") {
		return null;
	}

	return (
		<div className="container mx-auto p-6">
			<Card>
				<CardHeader>
					<CardTitle>Credenciales de MiniAgent</CardTitle>
					<CardDescription>
						Configura las credenciales de MiniAgent para cada vendedor
					</CardDescription>
				</CardHeader>
				<CardContent>
					{usersWithCredentials.isPending ? (
						<div className="flex justify-center py-8">
							<Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
						</div>
					) : usersWithCredentials.isError ? (
						<div className="py-8 text-center text-destructive">
							Error al cargar usuarios: {usersWithCredentials.error.message}
						</div>
					) : (
						<MiniAgentCredentialsTable
							users={usersWithCredentials.data}
							onSave={handleRefetch}
						/>
					)}
				</CardContent>
			</Card>
		</div>
	);
}
