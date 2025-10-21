import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
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
import { PERMISSIONS } from "server/src/types/roles";
import { Loader2 } from "lucide-react";

export const Route = createFileRoute("/crm/whatsapp")({
	component: RouteComponent,
});

function RouteComponent() {
	const { data: session, isPending } = authClient.useSession();
	const navigate = Route.useNavigate();
	const [iframeLoading, setIframeLoading] = useState(true);

	const userProfile = useQuery({
		...orpc.getUserProfile.queryOptions(),
		enabled: !!session,
	});

	const userRole = userProfile.data?.role;

	useEffect(() => {
		if (!session && !isPending) {
			navigate({ to: "/login" });
		} else if (session && userRole && !PERMISSIONS.canAccessWhatsApp(userRole)) {
			navigate({ to: "/dashboard" });
			toast.error(
				"Acceso denegado: esta sección es solo para ventas y administradores",
			);
		}
	}, [session, isPending, userRole, navigate]);

	const handleIframeLoad = () => {
		setIframeLoading(false);
	};

	if (isPending || userProfile.isPending) {
		return (
			<div className="flex h-[calc(100vh-4rem)] items-center justify-center">
				<Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
			</div>
		);
	}

	if (!userRole || !PERMISSIONS.canAccessWhatsApp(userRole)) {
		return null;
	}

	return (
		<div className="container mx-auto h-[calc(100vh-4rem)] p-6">
			<Card className="h-full flex flex-col">
				<CardHeader>
					<CardTitle>Chat de WhatsApp - MiniAgent</CardTitle>
					<CardDescription>
						Gestiona conversaciones de WhatsApp con clientes y prospectos
					</CardDescription>
				</CardHeader>
				<CardContent className="flex-1 p-0 relative">
					{iframeLoading && (
						<div className="absolute inset-0 flex items-center justify-center bg-background/80 backdrop-blur-sm z-10">
							<div className="flex flex-col items-center gap-2">
								<Loader2 className="h-8 w-8 animate-spin text-primary" />
								<p className="text-muted-foreground text-sm">
									Cargando MiniAgent...
								</p>
							</div>
						</div>
					)}

					<iframe
						src="https://miniagent.wittysuite.com/chat"
						className="h-full w-full border-0 rounded-b-lg"
						title="MiniAgent WhatsApp"
						allow="microphone; camera; clipboard-read; clipboard-write"
						onLoad={handleIframeLoad}
					/>
				</CardContent>
			</Card>
		</div>
	);
}
