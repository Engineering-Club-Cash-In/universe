import { createFileRoute } from "@tanstack/react-router";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LicenciasContent } from "./licencias";

export const Route = createFileRoute("/crm/documentacion/")({
	component: RouteComponent,
});

function RouteComponent() {
	return (
		<div className="container mx-auto space-y-6 p-6">
			<div>
				<h1 className="font-bold text-3xl tracking-tight">Documentación</h1>
				<p className="mt-1 text-muted-foreground">
					Verificación de documentos electrónicos
				</p>
			</div>

			<Tabs defaultValue="licencias" className="space-y-6">
				<TabsList>
					<TabsTrigger value="licencias">Licencias</TabsTrigger>
				</TabsList>

				<TabsContent value="licencias" className="space-y-6">
					<LicenciasContent />
				</TabsContent>
			</Tabs>
		</div>
	);
}
