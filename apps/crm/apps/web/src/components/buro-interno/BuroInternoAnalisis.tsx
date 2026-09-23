import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, RefreshCw, ShieldAlert, ShieldBan } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { orpc } from "@/utils/orpc";
import {
	CoincidenciasBuroInterno,
	SeveridadBadge,
} from "./CoincidenciasBuroInterno";

/**
 * Coincidencias de la solicitud (titular, codeudores y referencias) con el
 * buró interno. Es informativo: no bloquea la aprobación.
 */
export function BuroInternoAnalisis({
	opportunityId,
}: {
	opportunityId: string;
}) {
	const evaluacion = useQuery(
		orpc.getBuroInternoOportunidad.queryOptions({ input: { opportunityId } }),
	);

	const coincidencias = evaluacion.data?.coincidencias ?? [];
	const evaluados = evaluacion.data?.evaluados;
	const peor = coincidencias[0]?.severidad;

	const resumenEvaluados = evaluados
		? [
				"titular",
				evaluados.codeudor > 0 &&
					`${evaluados.codeudor} ${evaluados.codeudor === 1 ? "codeudor" : "codeudores"}`,
				evaluados.referencia > 0 &&
					`${evaluados.referencia} ${evaluados.referencia === 1 ? "referencia" : "referencias"}`,
			]
				.filter(Boolean)
				.join(", ")
		: null;

	return (
		<Card className={coincidencias.length > 0 ? "border-red-300" : undefined}>
			<CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
				<div className="space-y-1">
					<CardTitle className="flex items-center gap-2">
						{coincidencias.length > 0 ? (
							<ShieldAlert className="h-5 w-5 text-red-600" />
						) : (
							<ShieldBan className="h-5 w-5 text-muted-foreground" />
						)}
						Buró interno
						{peor && <SeveridadBadge severidad={peor} />}
					</CardTitle>
					<CardDescription>
						Personas que cobros marcó como mal pagadoras.
						{resumenEvaluados && ` Se revisó: ${resumenEvaluados}.`} No bloquea
						la aprobación.
					</CardDescription>
				</div>
				<Button
					variant="ghost"
					size="icon"
					title="Volver a revisar"
					disabled={evaluacion.isFetching}
					onClick={() => evaluacion.refetch()}
				>
					<RefreshCw
						className={`h-4 w-4 ${evaluacion.isFetching ? "animate-spin" : ""}`}
					/>
				</Button>
			</CardHeader>
			<CardContent>
				{evaluacion.isLoading ? (
					<Skeleton className="h-16 w-full" />
				) : evaluacion.isError ? (
					<p className="text-red-700 text-sm">
						No se pudo revisar el buró interno: {evaluacion.error.message}
					</p>
				) : coincidencias.length === 0 ? (
					<p className="flex items-center gap-2 text-green-700 text-sm">
						<CheckCircle2 className="h-4 w-4" />
						Sin coincidencias.
					</p>
				) : (
					<CoincidenciasBuroInterno coincidencias={coincidencias} />
				)}
			</CardContent>
		</Card>
	);
}
