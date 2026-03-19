import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
	ArrowRight,
	Banknote,
	CreditCard,
	Landmark,
	Mail,
	Search,
	Shield,
	Users,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";
import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/inversiones/liquidaciones/")({
	component: LiquidacionesInversionistas,
});

function LiquidacionesInversionistas() {
	const { data: session } = authClient.useSession();
	const [search, setSearch] = useState("");

	const investorsQuery = useQuery({
		...orpc.getInversionistas.queryOptions({
			input: { page: 1, perPage: 100 },
		}),
		enabled: !!session,
	})

	const investors = investorsQuery.data?.inversionistas ?? [];

	const filtered = useMemo(() => {
		if (!search.trim()) return investors;
		const q = search.toLowerCase();
		return investors.filter((inv) => inv.nombre.toLowerCase().includes(q));
	}, [investors, search]);

	return (
		<div className="flex h-full flex-col">
			{/* Header */}
			<div className="shrink-0 border-b bg-background px-6 py-4">
				<div className="flex items-center justify-between">
					<div className="flex items-center gap-3">
						<Landmark className="h-6 w-6 text-primary" />
						<div>
							<h1 className="font-bold text-xl">
								Liquidaciones Inversionistas
							</h1>
							<p className="text-muted-foreground text-sm">
								Selecciona un inversionista para ver sus liquidaciones
							</p>
						</div>
					</div>
				</div>

				<div className="mt-4 flex items-center gap-4">
					<div className="relative max-w-md flex-1">
						<Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
						<Input
							placeholder="Buscar inversionista..."
							value={search}
							onChange={(e) => setSearch(e.target.value)}
							className="pl-9"
						/>
					</div>
					<div className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2">
						<Users className="h-4 w-4 text-muted-foreground" />
						<div>
							<p className="font-semibold text-sm">{investors.length}</p>
							<p className="text-muted-foreground text-xs">Inversionistas</p>
						</div>
					</div>
				</div>
			</div>

			{/* Content */}
			<div className="flex-1 overflow-y-auto p-6">
				{investorsQuery.isLoading && (
					<div className="flex h-64 items-center justify-center">
						<div className="text-center text-muted-foreground">
							<div className="mx-auto mb-2 h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
							<p className="text-sm">Cargando inversionistas...</p>
						</div>
					</div>
				)}

				{investorsQuery.isError && (
					<div className="flex h-64 items-center justify-center">
						<div className="text-center text-muted-foreground">
							<p className="font-medium text-destructive text-sm">
								Error al cargar los inversionistas
							</p>
							<Button
								variant="outline"
								size="sm"
								className="mt-2"
								onClick={() => investorsQuery.refetch()}
							>
								Reintentar
							</Button>
						</div>
					</div>
				)}

				{!investorsQuery.isLoading &&
					!investorsQuery.isError &&
					filtered.length === 0 && (
						<div className="flex h-64 items-center justify-center">
							<p className="text-muted-foreground text-sm">
								{search
									? "No se encontraron inversionistas con ese nombre."
									: "No hay inversionistas registrados."}
							</p>
						</div>
					)}

				{!investorsQuery.isLoading &&
					!investorsQuery.isError &&
					filtered.length > 0 && (
						<div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
							{filtered.map((inv) => (
								<Link
									key={inv.inversionistaId}
									to="/inversiones/liquidaciones/$inversionistaId"
									params={{ inversionistaId: String(inv.inversionistaId) }}
									className="group rounded-xl border bg-card p-4 shadow-sm transition-all hover:border-primary/30 hover:shadow-md"
								>
									{/* Nombre + arrow */}
									<div className="flex items-center justify-between gap-2">
										<div className="flex items-center gap-3">
											<div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
												<Users className="h-5 w-5" />
											</div>
											<div className="min-w-0">
												<h3 className="truncate font-semibold text-sm">
													{inv.nombre}
												</h3>
												{inv.dpi && (
													<p className="flex items-center gap-1 text-muted-foreground text-xs">
														<Shield className="h-3 w-3" />
														{inv.dpi}
													</p>
												)}
											</div>
										</div>
										<ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
									</div>

									{/* Info rows */}
									<div className="mt-3 space-y-1.5 border-t pt-3">
										{inv.email && (
											<div className="flex items-center gap-2 text-muted-foreground text-xs">
												<Mail className="h-3.5 w-3.5 shrink-0" />
												<span className="truncate">{inv.email}</span>
											</div>
										)}
										{inv.banco && (
											<div className="flex items-center gap-2 text-muted-foreground text-xs">
												<Landmark className="h-3.5 w-3.5 shrink-0" />
												<span className="truncate">
													{inv.banco} · {inv.tipoCuenta}
												</span>
											</div>
										)}
										{inv.numeroCuenta && (
											<div className="flex items-center gap-2 text-muted-foreground text-xs">
												<CreditCard className="h-3.5 w-3.5 shrink-0" />
												<span className="font-mono">{inv.numeroCuenta}</span>
											</div>
										)}
									</div>

									{/* Badges */}
									<div className="mt-3 flex flex-wrap gap-1.5">
										<Badge
											variant="outline"
											className="border-emerald-300 bg-emerald-50 text-[10px] text-emerald-700 dark:border-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
										>
											<Banknote className="mr-1 h-3 w-3" />
											{inv.moneda === "dolares" ? "USD" : "GTQ"}
										</Badge>
										{inv.emiteFactura && (
											<Badge
												variant="outline"
												className="border-blue-300 bg-blue-50 text-[10px] text-blue-700 dark:border-blue-700 dark:bg-blue-950 dark:text-blue-300"
											>
												Factura
											</Badge>
										)}
										{inv.reinversion && (
											<Badge
												variant="outline"
												className="border-purple-300 bg-purple-50 text-[10px] text-purple-700 dark:border-purple-700 dark:bg-purple-950 dark:text-purple-300"
											>
												Reinversión
											</Badge>
										)}
									</div>
								</Link>
							))}
						</div>
					)}
			</div>
		</div>
	)
}
