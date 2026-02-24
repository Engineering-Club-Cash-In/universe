import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Loader2, Save, Target } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { authClient } from "@/lib/auth-client";
import { PERMISSIONS } from "@/lib/roles";
import { client, orpc, queryClient } from "@/utils/orpc";

export const Route = createFileRoute("/cobros/metas")({
	component: MetasMoraPage,
});

const CATEGORIAS = [
	"mora_total",
	"mora_30",
	"mora_60",
	"mora_90",
	"mora_120",
] as const;

const CATEGORIA_LABELS: Record<string, string> = {
	mora_total: "Mora Total",
	mora_30: "Mora 30",
	mora_60: "Mora 60",
	mora_90: "Mora 90",
	mora_120: "Mora 120+",
};

const MESES = [
	"Enero",
	"Febrero",
	"Marzo",
	"Abril",
	"Mayo",
	"Junio",
	"Julio",
	"Agosto",
	"Septiembre",
	"Octubre",
	"Noviembre",
	"Diciembre",
];

type MetaValues = Record<string, Record<string, string>>;

function MetasMoraPage() {
	const { data: session } = authClient.useSession();
	const userRole = session?.user?.role;
	const currentYear = new Date().getFullYear();
	const [anio, setAnio] = useState(currentYear);
	const [editValues, setEditValues] = useState<MetaValues>({});
	const [hasChanges, setHasChanges] = useState(false);

	const metasQuery = useQuery({
		...orpc.getMetasMoraAnual.queryOptions({
			input: { anio },
		}),
		enabled: !!session,
	});

	// Inicializar valores editables cuando los datos cargan
	useEffect(() => {
		if (metasQuery.data) {
			const values: MetaValues = {};
			for (let mes = 1; mes <= 12; mes++) {
				values[mes] = {};
				for (const cat of CATEGORIAS) {
					const meta = metasQuery.data.find(
						(m) => m.mes === mes && m.categoria === cat,
					);
					values[mes][cat] = meta?.valorObjetivo ?? "";
				}
			}
			setEditValues(values);
			setHasChanges(false);
		}
	}, [metasQuery.data]);

	const upsertMutation = useMutation({
		mutationFn: async () => {
			const promises = [];
			for (let mes = 1; mes <= 12; mes++) {
				const metas = CATEGORIAS.filter(
					(cat) =>
						editValues[mes]?.[cat] !== undefined && editValues[mes][cat] !== "",
				).map((cat) => ({
					categoria: cat,
					valorObjetivo: editValues[mes][cat],
				}));

				if (metas.length > 0) {
					promises.push(client.upsertMetasMora({ mes, anio, metas }));
				}
			}
			return Promise.all(promises);
		},
		onSuccess: () => {
			toast.success("Metas guardadas exitosamente");
			queryClient.invalidateQueries(
				orpc.getMetasMoraAnual.queryOptions({ input: { anio } }),
			);
			setHasChanges(false);
		},
		onError: (error: Error) => {
			toast.error(error.message);
		},
	});

	if (!userRole || !PERMISSIONS.canAssignCobros(userRole)) {
		return (
			<div className="flex min-h-screen items-center justify-center">
				<div className="text-center">
					<h1 className="mb-4 font-bold text-2xl text-gray-800">
						Acceso Denegado
					</h1>
					<p className="text-gray-600">
						Solo supervisores y administradores pueden gestionar metas.
					</p>
				</div>
			</div>
		);
	}

	return (
		<div className="container mx-auto space-y-6 p-6">
			<div className="flex items-center justify-between">
				<div>
					<h1 className="font-bold text-3xl">Metas de Mora</h1>
					<p className="text-muted-foreground">
						Porcentajes objetivo mensuales por categoría de mora
					</p>
				</div>
				<div className="flex items-center gap-3">
					<Select
						value={anio.toString()}
						onValueChange={(v) => setAnio(Number(v))}
					>
						<SelectTrigger className="w-[120px]">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{[currentYear - 1, currentYear, currentYear + 1].map((y) => (
								<SelectItem key={y} value={y.toString()}>
									{y}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					<Button
						onClick={() => upsertMutation.mutate()}
						disabled={upsertMutation.isPending || !hasChanges}
					>
						{upsertMutation.isPending ? (
							<Loader2 className="mr-2 h-4 w-4 animate-spin" />
						) : (
							<Save className="mr-2 h-4 w-4" />
						)}
						Guardar cambios
					</Button>
				</div>
			</div>

			<Card>
				<CardHeader>
					<CardTitle className="flex items-center gap-2">
						<Target className="h-5 w-5" />
						Metas {anio}
					</CardTitle>
					<CardDescription>
						Ingresa los porcentajes objetivo para cada mes y categoría. Los
						valores representan el % máximo de mora permitido.
					</CardDescription>
				</CardHeader>
				<CardContent>
					{metasQuery.isLoading ? (
						<div className="flex items-center justify-center py-12">
							<Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
						</div>
					) : (
						<div className="overflow-x-auto">
							<table className="w-full text-sm">
								<thead>
									<tr className="border-b">
										<th className="px-3 py-2 text-left font-medium text-muted-foreground">
											Mes
										</th>
										{CATEGORIAS.map((cat) => (
											<th
												key={cat}
												className="px-3 py-2 text-center font-medium text-muted-foreground"
											>
												{CATEGORIA_LABELS[cat]}
											</th>
										))}
									</tr>
								</thead>
								<tbody>
									{MESES.map((mesLabel, idx) => {
										const mes = idx + 1;
										return (
											<tr
												key={mes}
												className="border-b last:border-0 hover:bg-muted/50"
											>
												<td className="px-3 py-2 font-medium">{mesLabel}</td>
												{CATEGORIAS.map((cat) => (
													<td key={cat} className="px-3 py-2">
														<div className="flex items-center justify-center">
															<Input
																type="number"
																step="0.01"
																min="0"
																max="100"
																className="h-8 w-24 text-center text-sm"
																value={editValues[mes]?.[cat] ?? ""}
																onChange={(e) => {
																	setEditValues((prev) => ({
																		...prev,
																		[mes]: {
																			...prev[mes],
																			[cat]: e.target.value,
																		},
																	}));
																	setHasChanges(true);
																}}
																placeholder="—"
															/>
															<span className="ml-1 text-muted-foreground text-xs">
																%
															</span>
														</div>
													</td>
												))}
											</tr>
										);
									})}
								</tbody>
							</table>
						</div>
					)}
				</CardContent>
			</Card>
		</div>
	);
}
