import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { client, orpc, queryClient } from "@/utils/orpc";
import { EstadoConsulta, SelectorAsesor, selectClass } from "./traslados-panel";

const hoyGT = () =>
	new Date().toLocaleDateString("sv-SE", { timeZone: "America/Guatemala" });

export function CoberturasPanel() {
	const [desde, setDesde] = useState(hoyGT);
	const [hasta, setHasta] = useState(hoyGT);
	const [titular, setTitular] = useState("");
	const [suplente, setSuplente] = useState("");
	const [motivo, setMotivo] = useState<"vacaciones" | "permiso">("vacaciones");
	const [id, setId] = useState(() => crypto.randomUUID());
	const [revision, setRevision] = useState(false);
	const [cancelarId, setCancelarId] = useState<string | null>(null);
	const [rango, setRango] = useState(() => ({
		desde: hoyGT(),
		hasta: hoyGT(),
	}));
	const [filtroDesde, setFiltroDesde] = useState(hoyGT);
	const [filtroHasta, setFiltroHasta] = useState(hoyGT);
	const [guardada, setGuardada] = useState<string | null>(null);
	const asesores = useQuery(orpc.getAsesoresTraslados.queryOptions());
	const listado = useQuery(
		orpc.listarCoberturas.queryOptions({ input: rango }),
	);
	const disponibles = (asesores.data ?? []).filter(
		(a) => a.activo && a.usuarioHabilitado && a.userId,
	);
	const origen = disponibles.find((a) => String(a.asesor_id) === titular);
	const receptor = disponibles.find((a) => String(a.asesor_id) === suplente);
	const receptores = disponibles.filter(
		(a) =>
			a.asesor_id !== origen?.asesor_id &&
			!!origen?.buckets.length &&
			origen.buckets.every((b) => a.buckets.includes(b)),
	);
	const nombre = (userId: string) =>
		asesores.data?.find((a) => a.userId === userId)?.nombre ?? userId;
	const error = !origen
		? "Selecciona el titular."
		: !receptor
			? "Selecciona un suplente habilitado para los buckets del titular."
			: !desde || !hasta || desde > hasta
				? "Indica un rango de fechas válido."
				: desde < hoyGT()
					? "La cobertura debe comenzar hoy o después."
					: null;
	const refrescar = () =>
		queryClient.invalidateQueries({ queryKey: orpc.listarCoberturas.key() });
	const crear = useMutation({
		retry: false,
		mutationFn: () => {
			if (!origen?.userId || !receptor?.userId)
				throw new Error("Selecciona titular y suplente.");
			return client.crearCobertura({
				id,
				titularId: origen.userId,
				suplenteId: receptor.userId,
				motivo,
				desde,
				hasta,
			});
		},
		onSuccess: (data) => {
			setRevision(false);
			setGuardada(data.id);
			setId(crypto.randomUUID());
			void refrescar();
			toast.success("Cobertura registrada");
		},
		onError: () => setRevision(false),
	});
	const cancelar = useMutation({
		mutationFn: () => {
			if (!cancelarId)
				throw new Error("Selecciona una cobertura para cancelar.");
			return client.cancelarCobertura({ id: cancelarId });
		},
		onSuccess: () => {
			setCancelarId(null);
			void refrescar();
			toast.success("Cobertura cancelada");
		},
		onError: () => setCancelarId(null),
	});
	const cambiar = () => {
		setGuardada(null);
		setId(crypto.randomUUID());
		crear.reset();
	};
	return (
		<div className="space-y-4">
			<Card>
				<CardHeader>
					<CardTitle>Registro de coberturas temporales</CardTitle>
					<p className="text-muted-foreground text-sm">
						Vacaciones y permisos por días completos, en horario de Guatemala.
						La cartera conserva su propietario.
					</p>
					<p className="rounded-md border border-amber-300 p-3 text-sm">
						Durante el rango, tareas de agenda del titular aparecen para el
						suplente. La cartera conserva su propietario.
					</p>
				</CardHeader>
				<CardContent className="space-y-4">
					{asesores.isPending || asesores.isError ? (
						<EstadoConsulta
							error={asesores.isError}
							retry={() => void asesores.refetch()}
						/>
					) : (
						<>
							<fieldset
								disabled={crear.isPending}
								className="grid gap-4 sm:grid-cols-2"
							>
								<div className="space-y-2">
									<Label htmlFor="cobertura-titular">Titular</Label>
									<SelectorAsesor
										id="cobertura-titular"
										value={titular}
										onChange={(v) => {
											setTitular(v);
											setSuplente("");
											cambiar();
										}}
										asesores={disponibles}
									/>
								</div>
								<div className="space-y-2">
									<Label htmlFor="cobertura-suplente">Suplente</Label>
									<SelectorAsesor
										id="cobertura-suplente"
										value={suplente}
										onChange={(v) => {
											setSuplente(v);
											cambiar();
										}}
										asesores={receptores}
									/>
									{origen && !receptores.length && (
										<p className="text-muted-foreground text-sm">
											Ningún suplente habilitado cubre todos los buckets del
											titular.
										</p>
									)}
								</div>
								<div className="space-y-2">
									<Label htmlFor="cobertura-motivo">Motivo</Label>
									<select
										id="cobertura-motivo"
										className={selectClass}
										value={motivo}
										onChange={(e) => {
											setMotivo(e.target.value as typeof motivo);
											cambiar();
										}}
									>
										<option value="vacaciones">Vacaciones</option>
										<option value="permiso">Permiso</option>
									</select>
								</div>
								<div className="space-y-2">
									<Label htmlFor="cobertura-desde">
										Primer día de ausencia
									</Label>
									<Input
										id="cobertura-desde"
										type="date"
										min={hoyGT()}
										value={desde}
										onChange={(e) => {
											setDesde(e.target.value);
											cambiar();
										}}
									/>
								</div>
								<div className="space-y-2">
									<Label htmlFor="cobertura-hasta">
										Último día de ausencia (incluido)
									</Label>
									<Input
										id="cobertura-hasta"
										type="date"
										min={desde}
										value={hasta}
										onChange={(e) => {
											setHasta(e.target.value);
											cambiar();
										}}
									/>
								</div>
							</fieldset>
							{error && (
								<p className="text-muted-foreground text-sm">{error}</p>
							)}
							<Button
								disabled={!!error || crear.isPending}
								onClick={() => setRevision(true)}
							>
								Revisar cobertura
							</Button>
						</>
					)}
					{crear.error && (
						<p role="alert" className="text-destructive text-sm">
							{crear.error.message}
						</p>
					)}
					{guardada && (
						<output className="block break-all text-sm">
							Cobertura registrada: {guardada}. Agenda del suplente actualizada.
						</output>
					)}
				</CardContent>
			</Card>
			<Card>
				<CardHeader>
					<CardTitle>Coberturas registradas</CardTitle>
				</CardHeader>
				<CardContent className="space-y-4">
					<form
						className="flex flex-wrap items-end gap-3"
						onSubmit={(e) => {
							e.preventDefault();
							if (filtroDesde && filtroHasta && filtroDesde <= filtroHasta)
								setRango({ desde: filtroDesde, hasta: filtroHasta });
						}}
					>
						<div className="space-y-1">
							<Label htmlFor="cobertura-filtro-desde">Desde</Label>
							<Input
								required
								type="date"
								id="cobertura-filtro-desde"
								value={filtroDesde}
								onChange={(e) => setFiltroDesde(e.target.value)}
							/>
						</div>
						<div className="space-y-1">
							<Label htmlFor="cobertura-filtro-hasta">Hasta</Label>
							<Input
								required
								type="date"
								id="cobertura-filtro-hasta"
								min={filtroDesde}
								value={filtroHasta}
								onChange={(e) => setFiltroHasta(e.target.value)}
							/>
						</div>
						<Button
							variant="outline"
							type="submit"
							disabled={
								!filtroDesde || !filtroHasta || filtroDesde > filtroHasta
							}
						>
							Consultar
						</Button>
					</form>
					{listado.isPending || listado.isError ? (
						<EstadoConsulta
							error={listado.isError}
							retry={() => void listado.refetch()}
						/>
					) : !listado.data.length ? (
						<p className="text-sm">Sin coberturas para estas fechas.</p>
					) : (
						<div className="overflow-x-auto">
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>Titular</TableHead>
										<TableHead>Suplente</TableHead>
										<TableHead>Fechas incluidas</TableHead>
										<TableHead>Motivo</TableHead>
										<TableHead>Estado</TableHead>
										<TableHead>Acción</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{listado.data.map((c) => (
										<TableRow key={c.id}>
											<TableCell>{nombre(c.titularId)}</TableCell>
											<TableCell>{nombre(c.suplenteId)}</TableCell>
											<TableCell>
												{c.desde} → {c.hasta}
											</TableCell>
											<TableCell>
												{c.motivo === "vacaciones" ? "Vacaciones" : "Permiso"}
											</TableCell>
											<TableCell>
												{c.canceladaEn
													? "Cancelada"
													: c.hasta < hoyGT()
														? "Período finalizado"
														: "Registrada"}
											</TableCell>
											<TableCell>
												{!c.canceladaEn && c.hasta >= hoyGT() && (
													<Button
														size="sm"
														variant="outline"
														disabled={cancelar.isPending}
														onClick={() => setCancelarId(c.id)}
													>
														Cancelar
													</Button>
												)}
											</TableCell>
										</TableRow>
									))}
								</TableBody>
							</Table>
						</div>
					)}
					{cancelar.error && (
						<p role="alert" className="text-destructive text-sm">
							{cancelar.error.message}
						</p>
					)}
				</CardContent>
			</Card>
			<AlertDialog
				open={revision}
				onOpenChange={(v) => !crear.isPending && setRevision(v)}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Registrar cobertura</AlertDialogTitle>
						<AlertDialogDescription>
							{origen?.nombre} estará ausente por{" "}
							{motivo === "vacaciones" ? "vacaciones" : "permiso"} del {desde}{" "}
							al {hasta}, ambos incluidos. Suplente propuesto:{" "}
							{receptor?.nombre}. Sus tareas de agenda se mostrarán al suplente.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={crear.isPending}>
							Volver
						</AlertDialogCancel>
						<AlertDialogAction
							disabled={crear.isPending}
							onClick={(e) => {
								e.preventDefault();
								crear.mutate();
							}}
						>
							{crear.isPending ? "Registrando…" : "Registrar cobertura"}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
			<AlertDialog
				open={!!cancelarId}
				onOpenChange={(v) => !v && !cancelar.isPending && setCancelarId(null)}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Cancelar cobertura</AlertDialogTitle>
						<AlertDialogDescription>
							Se conservará el registro en el historial.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={cancelar.isPending}>
							Volver
						</AlertDialogCancel>
						<AlertDialogAction
							disabled={cancelar.isPending}
							onClick={(e) => {
								e.preventDefault();
								cancelar.mutate();
							}}
						>
							{cancelar.isPending ? "Cancelando…" : "Cancelar cobertura"}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}
