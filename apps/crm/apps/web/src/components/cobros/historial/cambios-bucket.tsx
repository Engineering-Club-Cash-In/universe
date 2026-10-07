import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowDown, ArrowUp, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { orpc } from "@/utils/orpc";
import {
	agruparPorDia,
	EncabezadoDia,
	etiquetaDia,
	ItemMovimiento,
	type MovimientoBucket,
} from "./linea-tiempo";

/**
 * «Cambios de bucket» del Historial de actividad del asesor (Figma 4063:12):
 * los créditos de ese asesor que subieron o bajaron de bucket, según el cierre
 * diario (`getDetalleCierrePorAsesor` › filas `subida`/`bajada`, lo mismo que
 * «Movimientos de bucket» de /cobros/cierre). `asesorId` del cierre es el
 * `user.id` del CRM.
 */

const textoBucket = (b: number | null) => (b == null ? "—" : `B${b}`);

export function CambiosBucketVista({
	movimientos,
	cargando,
	error,
	onReintentar,
	vista,
	hoy,
}: {
	movimientos: readonly MovimientoBucket[];
	cargando: boolean;
	error: boolean;
	onReintentar?: () => void;
	vista: "tabla" | "linea";
	hoy: string;
}) {
	if (cargando) {
		return (
			<div className="flex items-center justify-center gap-2 py-16 text-fg-secondary text-sm">
				<Loader2 className="size-4 animate-spin" />
				Cargando cambios de bucket…
			</div>
		);
	}
	if (error) {
		return (
			<EmptyState
				variant="error"
				size="sm"
				title="No se pudieron cargar los cambios de bucket"
				description="Intente de nuevo en unos segundos."
				action={
					onReintentar ? (
						<Button variant="outline" size="sm" onClick={onReintentar}>
							Reintentar
						</Button>
					) : undefined
				}
			/>
		);
	}
	if (movimientos.length === 0) {
		return (
			<EmptyState
				variant="no-data"
				size="sm"
				title="Sin cambios de bucket"
				description="Ningún crédito del asesor subió ni bajó de bucket en este rango, según el cierre diario."
			/>
		);
	}
	if (vista === "linea") {
		return (
			<div className="flex flex-col gap-3">
				{agruparPorDia(movimientos, (m) => m.fecha).map((g) => (
					<section key={g.dia} className="flex flex-col gap-2">
						<EncabezadoDia>{etiquetaDia(g.dia, hoy)}</EncabezadoDia>
						<div className="flex flex-col">
							{g.items.map((m) => (
								<ItemMovimiento key={m.id} movimiento={m} hoy={hoy} />
							))}
						</div>
					</section>
				))}
			</div>
		);
	}
	return (
		<div className="overflow-x-auto rounded-xl border border-line-subtle contain-inline-size">
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>Crédito</TableHead>
						<TableHead>Fecha</TableHead>
						<TableHead>Movimiento</TableHead>
						<TableHead>Bucket anterior</TableHead>
						<TableHead>Bucket nuevo</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{movimientos.map((m) => (
						<TableRow key={m.id}>
							<TableCell>
								{m.casoCobroId ? (
									<Link
										to="/cobros/$id"
										params={{ id: m.casoCobroId }}
										search={{ tipo: "caso" as const }}
										className="font-medium text-brand hover:underline"
									>
										{m.numeroCreditoSifco ?? "Sin SIFCO"}
									</Link>
								) : (
									(m.numeroCreditoSifco ?? "—")
								)}
							</TableCell>
							<TableCell className="text-fg-secondary">
								{etiquetaDia(m.fecha, hoy)}
							</TableCell>
							<TableCell>
								{m.tipo === "subida" ? (
									<span className="inline-flex items-center gap-1 text-danger-text">
										<ArrowUp className="size-3.5" />
										Subió
									</span>
								) : (
									<span className="inline-flex items-center gap-1 text-success-text">
										<ArrowDown className="size-3.5" />
										Bajó
									</span>
								)}
							</TableCell>
							<TableCell className="text-fg-secondary">
								{textoBucket(m.bucketAnterior)}
							</TableCell>
							<TableCell>{textoBucket(m.bucket)}</TableCell>
						</TableRow>
					))}
				</TableBody>
			</Table>
		</div>
	);
}

export function CambiosBucketAsesor({
	userId,
	desde,
	hasta,
	vista,
	hoy,
}: {
	/** `user.id` del CRM del asesor (el del cierre diario). */
	userId: string;
	desde: string;
	hasta: string;
	vista: "tabla" | "linea";
	hoy: string;
}) {
	const query = useQuery({
		...orpc.getDetalleCierrePorAsesor.queryOptions({
			input: { asesorId: userId, fechaInicio: desde, fechaFin: hasta },
		}),
		// Snapshot del job nocturno, no dato vivo (mismo criterio que /cobros/cierre).
		staleTime: 5 * 60 * 1000,
	});
	const movimientos = (query.data ?? [])
		.filter((d) => d.tipo === "subida" || d.tipo === "bajada")
		.map(
			(d): MovimientoBucket => ({
				id: String(d.id),
				tipo: d.tipo as "subida" | "bajada",
				casoCobroId: d.casoCobroId ?? null,
				numeroCreditoSifco: d.numeroCreditoSifco ?? null,
				bucketAnterior: d.bucketAnterior ?? null,
				bucket: d.bucket ?? null,
				fecha: String(d.fecha).slice(0, 10),
			}),
		);
	return (
		<CambiosBucketVista
			movimientos={movimientos}
			cargando={query.isPending}
			error={query.isError}
			onReintentar={() => void query.refetch()}
			vista={vista}
			hoy={hoy}
		/>
	);
}
