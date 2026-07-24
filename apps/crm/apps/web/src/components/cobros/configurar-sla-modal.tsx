import { useMutation } from "@tanstack/react-query";
import { AlertCircle, Clock, Loader2, Save } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
	type BucketsCatalogoQueryData,
	bucketDeEstado,
	estiloBucket,
} from "@/lib/cobros/buckets-catalogo";
import { client, orpc, queryClient } from "@/utils/orpc";

interface ConfigurarSlaModalProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	catalogo: BucketsCatalogoQueryData | undefined;
}

const BUCKETS_CONFIG = [
	{ numero: 1, key: "mora_30", labelDefault: "Alerta Temprana", defaultSla: 3 },
	{ numero: 2, key: "mora_60", labelDefault: "Gestión Activa", defaultSla: 3 },
	{ numero: 3, key: "mora_90", labelDefault: "Rescate", defaultSla: 2 },
	{
		numero: 4,
		key: "mora_120",
		labelDefault: "Última Instancia / Pre Jurídico",
		defaultSla: 2,
	},
	{ numero: 5, key: "mora_120_plus", labelDefault: "Jurídico", defaultSla: 1 },
] as const;

export function ConfigurarSlaModal({
	open,
	onOpenChange,
	catalogo,
}: ConfigurarSlaModalProps) {
	const [values, setValues] = useState<Record<number, number>>({
		1: 3,
		2: 3,
		3: 2,
		4: 2,
		5: 1,
	});

	// Cargar valores actuales desde el catálogo dinámico si está disponible
	useEffect(() => {
		if (catalogo && open) {
			const initial: Record<number, number> = {};
			for (const item of BUCKETS_CONFIG) {
				const ui = bucketDeEstado(item.key, catalogo);
				const catItem = catalogo.find(
					(c) => c.prefijo === `B${item.numero}` || c.label === ui.label,
				);
				initial[item.numero] = catItem?.diasSla ?? item.defaultSla;
			}
			setValues(initial);
		}
	}, [catalogo, open]);

	const updateMutation = useMutation({
		mutationFn: async () => {
			const configuraciones = BUCKETS_CONFIG.map((b) => ({
				bucket: b.numero,
				diasSla: Number(values[b.numero]) || b.defaultSla,
			}));
			return client.actualizarDiasSlaBuckets({ configuraciones });
		},
		onSuccess: () => {
			toast.success("Días de SLA actualizados correctamente");
			queryClient.invalidateQueries({
				queryKey: orpc.getColaDia.key(),
			});
			queryClient.invalidateQueries({
				queryKey: orpc.getBucketsCatalogo.key(),
			});
			onOpenChange(false);
		},
		onError: (err: Error) => {
			toast.error(err.message || "Error al actualizar la configuración de SLA");
		},
	});

	const handleChange = (numero: number, valStr: string) => {
		const num = parseInt(valStr, 10);
		setValues((prev) => ({
			...prev,
			[numero]: Number.isNaN(num) ? 0 : num,
		}));
	};

	const invalidBucket = BUCKETS_CONFIG.find((b) => {
		const val = values[b.numero];
		return typeof val !== "number" || val < 1 || val > 30;
	});

	const catalogoListo = catalogo !== undefined;
	const isValid = !invalidBucket && catalogoListo;

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-[520px]">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2 text-xl font-bold">
						<Clock className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
						Configurar Días de SLA por Bucket
					</DialogTitle>
					<DialogDescription>
						Define los días de plazo (entre 1 y 30 días) para contactar a un cliente según su bucket de mora.
					</DialogDescription>
				</DialogHeader>

				<div className="py-3 space-y-3">
					{BUCKETS_CONFIG.map((b) => {
						const ui = bucketDeEstado(b.key, catalogo);
						const val = values[b.numero];
						const isError = typeof val !== "number" || val < 1 || val > 30;

						return (
							<div
								key={b.numero}
								className={`p-3 rounded-lg border transition-colors ${
									isError
										? "border-red-300 bg-red-50/40 dark:border-red-900/60 dark:bg-red-950/20"
										: "bg-card hover:bg-slate-50 dark:hover:bg-slate-900/50"
								}`}
							>
								<div className="flex items-center justify-between">
									<div className="flex items-center gap-3">
										<Badge
											variant="outline"
											className="font-bold text-xs px-2.5 py-0.5"
											style={estiloBucket(ui.colorHex)}
										>
											B{b.numero}
										</Badge>
										<div>
											<p className="font-semibold text-sm text-foreground">
												{ui.label || b.labelDefault}
											</p>
											<p className="text-xs text-muted-foreground">
												Días hábiles / calendario desde ingreso
											</p>
										</div>
									</div>

									<div className="flex flex-col items-end gap-1">
										<div className="flex items-center gap-2">
											<Input
												type="number"
												min={1}
												max={30}
												value={val === 0 ? "" : val}
												onChange={(e) => handleChange(b.numero, e.target.value)}
												className={`w-20 text-center font-medium ${
													isError ? "border-red-500 focus-visible:ring-red-500 text-red-600 font-bold" : ""
												}`}
											/>
											<span className="text-xs text-muted-foreground w-8">
												días
											</span>
										</div>
									</div>
								</div>
								{isError && (
									<p className="text-[11px] text-red-600 dark:text-red-400 font-medium text-right mt-1">
										⚠️ El valor debe ser de 1 a 30 días
									</p>
								)}
							</div>
						);
					})}

					{!isValid && (
						<div className="flex items-center gap-2 p-3 rounded-md bg-red-50 text-red-800 dark:bg-red-950/40 dark:text-red-300 text-xs border border-red-200 dark:border-red-800">
							<AlertCircle className="h-4 w-4 shrink-0 text-red-600 dark:text-red-400" />
							<span>
								No es posible guardar: El plazo de SLA para el bucket <strong>B{invalidBucket?.numero}</strong> debe estar en el rango de <strong>1 a 30 días</strong>.
							</span>
						</div>
					)}
				</div>

				<DialogFooter className="gap-2 sm:gap-0">
					<Button
						variant="outline"
						onClick={() => onOpenChange(false)}
						disabled={updateMutation.isPending}
					>
						Cancelar
					</Button>
					<Button
						onClick={() => updateMutation.mutate()}
						disabled={!isValid || updateMutation.isPending}
						title={
							!catalogoListo
								? "Esperando a que cargue el catálogo de buckets..."
								: !isValid
									? "Debes ingresar valores entre 1 y 30 días para todos los buckets"
									: ""
						}
						className="gap-2 bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-50"
					>
						{updateMutation.isPending || !catalogoListo ? (
							<Loader2 className="h-4 w-4 animate-spin" />
						) : (
							<Save className="h-4 w-4" />
						)}
						Guardar Cambios
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
