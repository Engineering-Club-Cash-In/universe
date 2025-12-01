import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { authClient } from "@/lib/auth-client";
import { client, orpc } from "@/utils/orpc";

export const Route = createFileRoute("/admin/import")({
	component: RouteComponent,
});

function RouteComponent() {
	const { data: session, isPending } = authClient.useSession();
	const navigate = Route.useNavigate();

	const userProfile = useQuery(orpc.getUserProfile.queryOptions());
	const [companyId, setCompanyId] = useState<string | null>(null);

	useEffect(() => {
		if (!session && !isPending) {
			navigate({ to: "/login" });
		} else if (
			session &&
			userProfile.data !== undefined &&
			userProfile.data?.role !== "admin"
		) {
			navigate({ to: "/dashboard" });
			toast.error("Acceso denegado: se requiere rol de administrador");
		}
	}, [session, isPending, userProfile.data]);

	// Setup mutation
	const setupMutation = useMutation({
		mutationFn: () => client.setupImportacion(),
		onSuccess: (result) => {
			if (result.success) {
				setCompanyId(result.companyId);
				toast.success(
					result.created
						? `Company placeholder creada: ${result.companyId}`
						: `Company placeholder ya existe: ${result.companyId}`,
				);
			} else {
				toast.error(`Error en setup: ${result.error}`);
			}
		},
		onError: (error) => {
			toast.error(`Error en setup: ${error.message}`);
		},
	});

	// Analysis mutation
	const analysisMutation = useMutation({
		mutationFn: () => client.analizarImportacionCreditos(),
		onSuccess: (result) => {
			if (result.success) {
				toast.success(
					`Análisis completado: ${result.porImportar} créditos por importar`,
				);
			} else {
				toast.error("Error en análisis");
			}
		},
		onError: (error) => {
			toast.error(`Error en análisis: ${error.message}`);
		},
	});

	// Import mutation
	const importMutation = useMutation({
		mutationFn: (placeholderCompanyId: string) =>
			client.importarCreditosCarteraBack({ placeholderCompanyId }),
		onSuccess: (result) => {
			if (result.success) {
				toast.success(
					`Importación completada: ${result.exitosos}/${result.totalProcesados} créditos importados`,
				);
			} else {
				toast.error("Error en importación");
			}
		},
		onError: (error) => {
			toast.error(`Error en importación: ${error.message}`);
		},
	});

	// Debug mutation
	const debugMutation = useMutation({
		mutationFn: () => client.debugCreditData(),
		onSuccess: (result) => {
			if (result.success) {
				toast.success(result.message);
			}
		},
		onError: (error) => {
			toast.error(`Error en debug: ${error.message}`);
		},
	});

	if (isPending || userProfile.isPending) {
		return <div>Cargando...</div>;
	}

	if (userProfile.data?.role !== "admin") {
		return null;
	}

	const analysisResult = analysisMutation.data;
	const importResult = importMutation.data;

	return (
		<div className="container mx-auto space-y-6 p-6">
			<div>
				<h1 className="font-bold text-3xl">
					Importación de Créditos de Cartera-Back
				</h1>
				<p className="text-muted-foreground">
					Importa créditos existentes desde cartera-back al CRM
				</p>
			</div>

			{/* Setup Section */}
			<Card>
				<CardHeader>
					<CardTitle>1. Setup Inicial</CardTitle>
					<CardDescription>
						Crear company placeholder para créditos importados
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-4">
					<p className="text-muted-foreground text-sm">
						Este paso crea la empresa "Importados de Cartera-Back" que
						agrupará todos los clientes importados.
					</p>
					<Button
						onClick={() => setupMutation.mutate()}
						disabled={setupMutation.isPending}
					>
						{setupMutation.isPending ? "Ejecutando..." : "Ejecutar Setup"}
					</Button>
					{companyId && (
						<div className="rounded-md bg-green-50 p-3">
							<p className="font-medium text-green-800 text-sm">
								✓ Company ID: {companyId}
							</p>
						</div>
					)}
				</CardContent>
			</Card>

			{/* Analysis Section */}
			<Card>
				<CardHeader>
					<CardTitle>2. Análisis (Dry-Run)</CardTitle>
					<CardDescription>
						Analizar qué se importaría sin escribir en la base de datos
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-4">
					<p className="text-muted-foreground text-sm">
						Este análisis revisa todos los créditos de cartera-back y reporta
						cuántos serían importados.
					</p>
					<Button
						onClick={() => analysisMutation.mutate()}
						disabled={analysisMutation.isPending}
					>
						{analysisMutation.isPending
							? "Analizando..."
							: "Ejecutar Análisis"}
					</Button>

					{analysisResult && analysisResult.success && (
						<div className="rounded-md border p-4">
							<h3 className="mb-3 font-semibold">Resultado del Análisis</h3>
							<div className="grid grid-cols-2 gap-4 text-sm">
								<div>
									<p className="text-muted-foreground">Total Créditos</p>
									<p className="font-semibold text-lg">
										{analysisResult.totalCreditos}
									</p>
								</div>
								<div>
									<p className="text-muted-foreground">Ya Importados</p>
									<p className="font-semibold text-lg">
										{analysisResult.yaImportados}
									</p>
								</div>
								<div>
									<p className="text-muted-foreground">Por Importar</p>
									<p className="font-semibold text-green-600 text-lg">
										{analysisResult.porImportar}
									</p>
								</div>
								<div>
									<p className="text-muted-foreground">Duración Estimada</p>
									<p className="font-semibold text-lg">
										{analysisResult.estimacionDuracion}
									</p>
								</div>
							</div>

							<div className="mt-4 space-y-2">
								<p className="font-medium text-sm">Breakdown por Estado:</p>
								<div className="grid grid-cols-2 gap-2 text-sm">
									<div>
										ACTIVO: <span className="font-medium">{analysisResult.breakdown.ACTIVO}</span>
									</div>
									<div>
										MOROSO: <span className="font-medium">{analysisResult.breakdown.MOROSO}</span>
									</div>
									<div>
										CANCELADO: <span className="font-medium">{analysisResult.breakdown.CANCELADO}</span>
									</div>
									<div>
										INCOBRABLE: <span className="font-medium">{analysisResult.breakdown.INCOBRABLE}</span>
									</div>
								</div>
							</div>

							<div className="mt-4 space-y-2">
								<p className="font-medium text-sm">Entidades a Crear:</p>
								<div className="grid grid-cols-3 gap-2 text-sm">
									<div>
										Clientes:{" "}
										<span className="font-medium">
											{analysisResult.clientesNuevos}
										</span>
									</div>
									<div>
										Vehículos:{" "}
										<span className="font-medium">
											{analysisResult.vehiculosACrear}
										</span>
									</div>
									<div>
										Contratos:{" "}
										<span className="font-medium">
											{analysisResult.contratosACrear}
										</span>
									</div>
								</div>
							</div>

							{analysisResult.warnings.length > 0 && (
								<div className="mt-4">
									<p className="mb-2 font-medium text-orange-600 text-sm">
										Advertencias:
									</p>
									<ul className="list-inside list-disc space-y-1 text-sm">
										{analysisResult.warnings.slice(0, 5).map((warning, i) => (
											<li key={i} className="text-orange-700">
												{warning}
											</li>
										))}
										{analysisResult.warnings.length > 5 && (
											<li className="text-muted-foreground">
												... y {analysisResult.warnings.length - 5} más
											</li>
										)}
									</ul>
								</div>
							)}
						</div>
					)}
				</CardContent>
			</Card>

			{/* Import Section */}
			<Card>
				<CardHeader>
					<CardTitle>3. Importación</CardTitle>
					<CardDescription>
						Ejecutar la importación completa de créditos
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-4">
					<p className="text-muted-foreground text-sm">
						Este proceso creará todos los leads, clientes, vehículos,
						contratos y referencias en el CRM.
					</p>
					<div className="rounded-md border border-orange-200 bg-orange-50 p-3">
						<p className="font-medium text-orange-800 text-sm">
							⚠️ Advertencia: Esta operación puede tomar varios minutos y
							creará cientos de registros.
						</p>
					</div>
					<Button
						onClick={() => {
							if (!companyId) {
								toast.error(
									"Primero debes ejecutar el setup para obtener el Company ID",
								);
								return;
							}
							if (
								!confirm(
									`¿Estás seguro de importar ${analysisResult?.porImportar || "todos los"} créditos? Esta operación no se puede deshacer.`,
								)
							) {
								return;
							}
							importMutation.mutate(companyId);
						}}
						disabled={!companyId || importMutation.isPending}
						variant="destructive"
					>
						{importMutation.isPending
							? "Importando..."
							: "Ejecutar Importación"}
					</Button>

					{importResult && (
						<div className="rounded-md border p-4">
							<h3 className="mb-3 font-semibold">
								Resultado de la Importación
							</h3>
							<div className="grid grid-cols-2 gap-4 text-sm">
								<div>
									<p className="text-muted-foreground">Total Procesados</p>
									<p className="font-semibold text-lg">
										{importResult.totalProcesados}
									</p>
								</div>
								<div>
									<p className="text-muted-foreground">Exitosos</p>
									<p className="font-semibold text-green-600 text-lg">
										{importResult.exitosos}
									</p>
								</div>
								<div>
									<p className="text-muted-foreground">Fallidos</p>
									<p className="font-semibold text-red-600 text-lg">
										{importResult.fallidos}
									</p>
								</div>
								<div>
									<p className="text-muted-foreground">Omitidos (ya existían)</p>
									<p className="font-semibold text-lg">
										{importResult.omitidos}
									</p>
								</div>
							</div>

							<div className="mt-4 space-y-2">
								<p className="font-medium text-sm">Breakdown de Creación:</p>
								<div className="grid grid-cols-2 gap-2 text-sm">
									<div>
										Leads Creados:{" "}
										<span className="font-medium">
											{importResult.breakdown.leadsCreados}
										</span>
									</div>
									<div>
										Clientes Creados:{" "}
										<span className="font-medium">
											{importResult.breakdown.clientesCreados}
										</span>
									</div>
									<div>
										Vehículos Creados:{" "}
										<span className="font-medium">
											{importResult.breakdown.vehiculosCreados}
										</span>
									</div>
									<div>
										Contratos Creados:{" "}
										<span className="font-medium">
											{importResult.breakdown.contratosCreados}
										</span>
									</div>
								</div>
							</div>

							{importResult.errores.length > 0 && (
								<div className="mt-4">
									<p className="mb-2 font-medium text-red-600 text-sm">
										Errores:
									</p>
									<ul className="list-inside list-disc space-y-1 text-sm">
										{importResult.errores.slice(0, 10).map((error, i) => (
											<li key={i} className="text-red-700">
												{error.numeroSifco}: {error.error}
											</li>
										))}
										{importResult.errores.length > 10 && (
											<li className="text-muted-foreground">
												... y {importResult.errores.length - 10} más
											</li>
										)}
									</ul>
								</div>
							)}
						</div>
					)}
				</CardContent>
			</Card>

			{/* Debug Section */}
			<Card>
				<CardHeader>
					<CardTitle>4. Debug - Inspeccionar Datos</CardTitle>
					<CardDescription>
						Analizar estructura de datos disponibles en créditos
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-4">
					<p className="text-muted-foreground text-sm">
						Este debug compara qué datos están disponibles en el listado vs
						en el detalle de créditos. Útil para entender créditos corruptos.
					</p>
					<Button
						onClick={() => debugMutation.mutate()}
						disabled={debugMutation.isPending}
						variant="outline"
					>
						{debugMutation.isPending
							? "Ejecutando Debug..."
							: "Ejecutar Debug"}
					</Button>
					<div className="rounded-md border border-blue-200 bg-blue-50 p-3">
						<p className="font-medium text-blue-800 text-sm">
							ℹ️ Los resultados se mostrarán en los logs del servidor.
							Abre la consola donde ejecutaste `bun dev` para ver el output.
						</p>
					</div>
				</CardContent>
			</Card>
		</div>
	);
}
