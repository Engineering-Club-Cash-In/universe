import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Ban, CheckCircle2, Loader2, User } from "lucide-react";
import { useMemo, useState } from "react";
import {
	type CategoriaDeInversion,
	CONTRATOS_DE_INVERSION,
} from "server/src/lib/contratos-inversiones";
import { toast } from "sonner";
import {
	type CRMData,
	DynamicContractWizard,
} from "@/components/contracts/DynamicContractWizard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useJuridicoPermissions } from "@/hooks/usePermissions";
import { client, orpc } from "@/utils/orpc";

export const Route = createFileRoute("/juridico/inversionista/$batchId")({
	component: RouteComponent,
});

const CATEGORIAS: Array<{ valor: CategoriaDeInversion; etiqueta: string }> = [
	{ valor: "individual", etiqueta: "Inversionista individual" },
	{ valor: "sociedad", etiqueta: "Sociedad" },
];

function quetzales(monto: string | number) {
	return new Intl.NumberFormat("es-GT", {
		style: "currency",
		currency: "GTQ",
	}).format(Number(monto));
}

function RouteComponent() {
	const { batchId } = Route.useParams();
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const { canViewLegal, isLoading: cargandoPermisos } =
		useJuridicoPermissions();

	const [categoria, setCategoria] =
		useState<CategoriaDeInversion>("individual");
	const [dpi, setDpi] = useState("");
	const [dpiTocado, setDpiTocado] = useState(false);
	const [motivoDescarte, setMotivoDescarte] = useState("");

	const bateriaQuery = useQuery({
		...orpc.getInvestorContractBatch.queryOptions({ input: { batchId } }),
		enabled: canViewLegal,
	});

	const contractTypesQuery = useQuery({
		queryKey: ["getContractTypes"],
		queryFn: () => client.getContractTypes(),
		enabled: canViewLegal,
	});

	const bateria = bateriaQuery.data;

	// El DPI sale de cartera, pero jurídico puede corregirlo: en una sociedad el
	// que firma es su representante, y de él cartera no guarda el DPI.
	const dpiEnUso = dpiTocado ? dpi : (bateria?.investorDpi ?? "");

	/**
	 * Sólo los contratos de inversión con layout auditado, de la categoría
	 * elegida. El nombre de cada uno lo pone el generador; acá sólo se filtra.
	 */
	const documentTypes = useMemo(() => {
		const deLaCategoria = new Set(
			CONTRATOS_DE_INVERSION.filter((c) => c.categoria === categoria).map(
				(c) => c.tipo,
			),
		);
		return (contractTypesQuery.data?.data ?? []).filter((tipo) =>
			deLaCategoria.has(tipo.enum),
		);
	}, [categoria, contractTypesQuery.data]);

	const crmData: CRMData = useMemo(
		() => ({
			cliente: {
				nombreCompleto: bateria?.investorName,
				dpi: dpiEnUso,
				correo: bateria?.investorEmail ?? undefined,
			},
			// Inversiones no tiene vehículo ni crédito: los campos que el template
			// pida se llenan a mano, que es como se vienen haciendo hoy.
			vehiculo: {},
			credito: {},
			coDebtors: [],
		}),
		[bateria, dpiEnUso],
	);

	const cerrarMutation = useMutation({
		...orpc.closeInvestorContractBatch.mutationOptions(),
		onSuccess: (_, variables) => {
			toast.success(
				variables.resultado === "completada"
					? "Batería marcada como completada"
					: "Batería descartada",
			);
			queryClient.invalidateQueries({
				predicate: (query) =>
					JSON.stringify(query.queryKey).includes("InvestorContractBatch"),
			});
			navigate({ to: "/juridico" });
		},
		onError: (error: Error) => toast.error(error.message),
	});

	const generar = async (data: {
		contracts: Array<{
			contractType: string;
			data: Record<string, string>;
			options: {
				gender: "male" | "female";
				generatePdf: boolean;
				isPlural?: boolean;
				filenamePrefix: string;
			};
		}>;
	}) => {
		const nombrePorTipo = new Map(
			documentTypes.map((tipo) => [tipo.enum, tipo.label]),
		);

		const resultado = await client.generateInvestorContracts({
			batchId,
			contracts: data.contracts.map((contrato) => ({
				contractType: contrato.contractType,
				contractName:
					nombrePorTipo.get(contrato.contractType) ?? contrato.contractType,
				data: contrato.data,
				gender: contrato.options.gender,
			})),
		});

		if (resultado.success) {
			toast.success("Contratos emitidos y enlazados al inversionista");
		} else {
			toast.warning("Algunos contratos no se pudieron emitir");
		}

		queryClient.invalidateQueries({
			predicate: (query) =>
				JSON.stringify(query.queryKey).includes("InvestorContract"),
		});

		return resultado;
	};

	const traerCampos = async (
		dpiConsultado: string,
		documentNames: string[],
	) => {
		const limpio = dpiConsultado.replace(/\D/g, "");
		// El catálogo de campos se pide por DPI. Cartera no siempre lo tiene (y en
		// una sociedad el que firma es su representante), así que se avisa acá en
		// vez de dejar que el error venga del validador.
		if (limpio.length !== 13) {
			throw new Error(
				"Hace falta el DPI de quien firma, con sus 13 dígitos. Corregilo arriba.",
			);
		}

		return client.getDocumentsByDpi({ dpi: limpio, documentNames });
	};

	if (cargandoPermisos || bateriaQuery.isLoading) {
		return (
			<div className="flex h-64 items-center justify-center">
				<Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
			</div>
		);
	}

	if (!canViewLegal) {
		return (
			<div className="p-6">
				<p className="text-muted-foreground">
					No tenés acceso a los contratos de jurídico.
				</p>
			</div>
		);
	}

	if (!bateria) {
		return (
			<div className="p-6">
				<p className="text-muted-foreground">Esa batería no existe.</p>
			</div>
		);
	}

	const cerrada =
		bateria.status === "completada" || bateria.status === "descartada";

	return (
		<div className="space-y-4 p-4 md:p-6">
			<div className="flex items-center gap-3">
				<Button
					variant="ghost"
					size="icon"
					onClick={() => navigate({ to: "/juridico" })}
				>
					<ArrowLeft className="h-4 w-4" />
				</Button>
				<div>
					<h1 className="font-semibold text-xl">{bateria.investorName}</h1>
					<p className="text-muted-foreground text-sm">
						Contratos de inversión · compra aceptada el{" "}
						{new Date(bateria.acceptedAt).toLocaleDateString("es-GT")}
					</p>
				</div>
				<Badge variant={cerrada ? "secondary" : "default"} className="ml-auto">
					{bateria.status.replace("_", " ")}
				</Badge>
			</div>

			<Card>
				<CardHeader>
					<CardTitle className="flex items-center gap-2 text-base">
						<User className="h-4 w-4" />
						Datos del inversionista
					</CardTitle>
					<CardDescription>
						Son los que cartera tenía cuando se aceptó la compra.
					</CardDescription>
				</CardHeader>
				<CardContent className="grid gap-4 md:grid-cols-2">
					<div className="space-y-1">
						<Label className="text-muted-foreground text-xs">Correo</Label>
						<p className="text-sm">
							{bateria.investorEmail ?? (
								<span className="text-destructive">
									Sin correo: no se le pueden mandar enlaces de firma
								</span>
							)}
						</p>
					</div>
					<div className="space-y-1">
						<Label className="text-muted-foreground text-xs">
							Monto de la compra
						</Label>
						<p className="text-sm">{quetzales(bateria.montoTotal)}</p>
					</div>
					<div className="space-y-1">
						<Label className="text-muted-foreground text-xs">Modalidad</Label>
						<p className="text-sm">
							{bateria.modalidad ?? "—"} · {bateria.facturacion ?? "—"}
						</p>
					</div>
					<div className="space-y-1">
						<Label className="text-muted-foreground text-xs" htmlFor="dpi">
							DPI de quien firma
						</Label>
						<Input
							id="dpi"
							value={dpiEnUso}
							onChange={(e) => {
								setDpiTocado(true);
								setDpi(e.target.value);
							}}
							placeholder="13 dígitos"
						/>
					</div>
					<div className="space-y-1 md:col-span-2">
						<Label className="text-muted-foreground text-xs">
							Créditos de la compra ({bateria.creditos.length})
						</Label>
						<ul className="space-y-1 text-sm">
							{bateria.creditos.map((credito) => (
								<li key={credito.creditoId} className="flex justify-between">
									<span>
										{credito.numeroCreditoSifco} · {credito.clienteNombre}
									</span>
									<span className="text-muted-foreground">
										{quetzales(credito.monto)}
									</span>
								</li>
							))}
						</ul>
					</div>
				</CardContent>
			</Card>

			{cerrada ? (
				<Card>
					<CardContent className="p-6 text-muted-foreground text-sm">
						Esta batería está {bateria.status}
						{bateria.discardReason ? `: ${bateria.discardReason}` : "."} No
						admite contratos nuevos.
					</CardContent>
				</Card>
			) : (
				<Card>
					<CardHeader>
						<CardTitle className="text-base">Emitir contratos</CardTitle>
						<CardDescription>
							Elegí la categoría y después los contratos que se van a hacer. Los
							campos se llenan acá mismo; los enlaces de firma salen solos y
							quedan en la ficha del inversionista.
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						<div className="flex gap-2">
							{CATEGORIAS.map((opcion) => (
								<Button
									key={opcion.valor}
									variant={categoria === opcion.valor ? "default" : "outline"}
									size="sm"
									onClick={() => setCategoria(opcion.valor)}
								>
									{opcion.etiqueta}
								</Button>
							))}
						</div>

						{contractTypesQuery.isLoading ? (
							<div className="flex items-center gap-2 text-muted-foreground text-sm">
								<Loader2 className="h-4 w-4 animate-spin" />
								Cargando contratos disponibles...
							</div>
						) : (
							<DynamicContractWizard
								documentTypes={documentTypes}
								crmData={crmData}
								onGetDocumentsByDpi={traerCampos}
								onGenerate={generar}
								onBack={() => navigate({ to: "/juridico" })}
							/>
						)}
					</CardContent>
				</Card>
			)}

			{!cerrada && (
				<Card>
					<CardHeader>
						<CardTitle className="text-base">Cerrar la batería</CardTitle>
						<CardDescription>
							Cuando la papelería quedó hecha, o cuando no había que hacerla.
						</CardDescription>
					</CardHeader>
					<CardContent className="flex flex-col gap-3 md:flex-row md:items-end">
						<Button
							onClick={() =>
								cerrarMutation.mutate({ batchId, resultado: "completada" })
							}
							disabled={cerrarMutation.isPending}
						>
							<CheckCircle2 className="mr-2 h-4 w-4" />
							Marcar como completada
						</Button>
						<div className="flex flex-1 items-end gap-2">
							<div className="flex-1 space-y-1">
								<Label
									className="text-muted-foreground text-xs"
									htmlFor="motivo"
								>
									Motivo, si se descarta
								</Label>
								<Input
									id="motivo"
									value={motivoDescarte}
									onChange={(e) => setMotivoDescarte(e.target.value)}
									placeholder="Por qué no hay que hacer estos contratos"
								/>
							</div>
							<Button
								variant="outline"
								onClick={() =>
									cerrarMutation.mutate({
										batchId,
										resultado: "descartada",
										motivo: motivoDescarte,
									})
								}
								disabled={
									cerrarMutation.isPending || motivoDescarte.trim().length < 3
								}
							>
								<Ban className="mr-2 h-4 w-4" />
								Descartar
							</Button>
						</div>
					</CardContent>
				</Card>
			)}
		</div>
	);
}
