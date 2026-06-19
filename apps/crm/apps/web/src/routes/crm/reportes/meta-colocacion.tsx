import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Target, TrendingUp, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ReportCard } from "@/components/reports/report-card";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { authClient } from "@/lib/auth-client";
import { shouldRedirectToLogin } from "@/lib/auth-session";
import { formatCurrency } from "@/lib/crm-formatters";
import { PERMISSIONS } from "@/lib/roles";
import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/crm/reportes/meta-colocacion")({
	component: RouteComponent,
});

const GUATEMALA_TZ = "America/Guatemala";

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

function nowGT(): Date {
	return new Date(
		new Intl.DateTimeFormat("en-CA", {
			timeZone: GUATEMALA_TZ,
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
		}).format(new Date()) + "T12:00:00Z",
	);
}

function coberturaColor(pct: number | null): string {
	if (pct === null) return "text-muted-foreground";
	if (pct >= 100) return "text-green-600";
	if (pct >= 75) return "text-yellow-600";
	return "text-red-600";
}

function coberturaLabel(pct: number | null): string {
	if (pct === null) return "Sin meta";
	return `${pct.toFixed(1)}%`;
}

function RouteComponent() {
	const navigate = useNavigate();
	const {
		data: session,
		isPending: sessionPending,
		error: sessionError,
	} = authClient.useSession();
	const userProfile = useQuery(orpc.getUserProfile.queryOptions());
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const userRole = (userProfile.data as any)?.role as string | undefined;
	const canAccess = userRole
		? PERMISSIONS.canAccessMetaColocacionReport(userRole)
		: false;

	const isPending =
		sessionPending || userProfile.isPending || (!session && !sessionError);

	useEffect(() => {
		if (
			shouldRedirectToLogin({
				error: sessionError,
				isPending: sessionPending,
				session,
			})
		) {
			navigate({ to: "/login" });
		} else if (session && !userProfile.isPending && !canAccess) {
			navigate({ to: "/dashboard" });
			toast.error("Acceso denegado");
		}
	}, [
		session,
		sessionError,
		sessionPending,
		userProfile.isPending,
		canAccess,
		navigate,
	]);

	if (isPending) {
		return (
			<div className="flex h-96 items-center justify-center text-muted-foreground">
				Cargando...
			</div>
		);
	}

	if (!canAccess) return null;

	return (
		<div className="container mx-auto max-w-5xl space-y-6 p-6">
			<MetaColocacionContent />
		</div>
	);
}

export function MetaColocacionContent() {
	const now = nowGT();
	const [mes, setMes] = useState<number>(now.getUTCMonth() + 1);
	const [anio, setAnio] = useState<number>(now.getUTCFullYear());

	const reportQuery = useQuery(
		orpc.getReporteMetaColocacion.queryOptions({ input: { anio, mes } }),
	);

	const data = reportQuery.data;
	const isLoading = reportQuery.isLoading;

	const anios = Array.from({ length: 5 }, (_, i) => now.getUTCFullYear() - i);

	const meta = data?.meta;
	const realMonto = data?.realMonto;
	const realCreditos = data?.realCreditos;
	const cobertura = data?.cobertura;
	const porColaborador = data?.porColaborador ?? [];

	return (
		<div className="space-y-6">
			{/* Header */}
			<div>
				<h1 className="font-bold text-2xl">Meta de Colocación</h1>
				<p className="mt-1 text-muted-foreground text-sm">
					Compara la meta mensual de colocación con lo efectivamente colocado,
					total y por colaborador.
				</p>
			</div>

			{/* Selector mes/año */}
			<div className="flex items-center gap-3">
				<Select value={String(mes)} onValueChange={(v) => setMes(Number(v))}>
					<SelectTrigger className="w-36">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{MESES.map((label, i) => (
							<SelectItem key={label} value={String(i + 1)}>
								{label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
				<Select value={String(anio)} onValueChange={(v) => setAnio(Number(v))}>
					<SelectTrigger className="w-24">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{anios.map((a) => (
							<SelectItem key={a} value={String(a)}>
								{a}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>

			{/* KPI Cards */}
			<div className="grid grid-cols-2 gap-4 md:grid-cols-4">
				<ReportCard
					title="Meta"
					value={isLoading ? "—" : formatCurrency(meta ?? 0)}
					icon={Target}
				/>
				<ReportCard
					title="Real Colocado"
					value={isLoading ? "—" : formatCurrency(realMonto ?? 0)}
					icon={TrendingUp}
				/>
				<ReportCard
					title="Cobertura"
					value={isLoading ? "—" : coberturaLabel(cobertura ?? null)}
					icon={Target}
				/>
				<ReportCard
					title="Créditos"
					value={isLoading ? "—" : String(realCreditos ?? 0)}
					icon={Users}
				/>
			</div>

			{/* Tabla por colaborador */}
			<Card>
				<CardHeader>
					<CardTitle className="text-base">Desglose por Colaborador</CardTitle>
					<CardDescription>
						Créditos y monto colocado por asesor en {MESES[mes - 1]} {anio}
					</CardDescription>
				</CardHeader>
				<CardContent>
					{isLoading ? (
						<p className="py-8 text-center text-muted-foreground text-sm">
							Cargando...
						</p>
					) : porColaborador.length === 0 ? (
						<p className="py-8 text-center text-muted-foreground text-sm">
							No hay colocaciones para este período.
						</p>
					) : (
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Colaborador</TableHead>
									<TableHead className="text-right"># Créditos</TableHead>
									<TableHead className="text-right">Monto</TableHead>
									<TableHead className="text-right">% del Total</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{porColaborador.map((row) => (
									<TableRow key={row.userId ?? row.nombre}>
										<TableCell className="font-medium">{row.nombre}</TableCell>
										<TableCell className="text-right">{row.creditos}</TableCell>
										<TableCell className="text-right">
											{formatCurrency(row.monto)}
										</TableCell>
										<TableCell className="text-right text-muted-foreground">
											{row.pctDelTotal.toFixed(1)}%
										</TableCell>
									</TableRow>
								))}
								<TableRow className="border-t-2 font-semibold">
									<TableCell>Total</TableCell>
									<TableCell className="text-right">
										{realCreditos ?? 0}
									</TableCell>
									<TableCell className="text-right">
										{formatCurrency(realMonto ?? 0)}
									</TableCell>
									<TableCell className="text-right">100%</TableCell>
								</TableRow>
							</TableBody>
						</Table>
					)}
				</CardContent>
			</Card>

			{/* Progreso vs Meta */}
			{meta && Number(meta) > 0 && (
				<Card>
					<CardHeader>
						<CardTitle className="text-base">Progreso vs Meta</CardTitle>
					</CardHeader>
					<CardContent>
						<div className="space-y-2">
							<div className="flex justify-between text-sm">
								<span className="text-muted-foreground">
									{formatCurrency(realMonto ?? 0)} de {formatCurrency(meta)}
								</span>
								<span
									className={`font-semibold ${coberturaColor(cobertura ?? null)}`}
								>
									{coberturaLabel(cobertura ?? null)}
								</span>
							</div>
							<div className="h-3 w-full overflow-hidden rounded-full bg-muted">
								<div
									className="h-full rounded-full bg-purple-500 transition-all"
									style={{
										width: `${Math.min(100, cobertura ?? 0)}%`,
									}}
								/>
							</div>
							<p className="text-muted-foreground text-xs">
								Faltante:{" "}
								{formatCurrency(
									Math.max(0, Number(meta) - Number(realMonto ?? 0)),
								)}
							</p>
						</div>
					</CardContent>
				</Card>
			)}
		</div>
	);
}
