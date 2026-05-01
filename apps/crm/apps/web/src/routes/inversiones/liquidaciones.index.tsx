import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
	ArrowRight,
	Banknote,
	CreditCard,
	Landmark,
	Loader2,
	Mail,
	Plus,
	Search,
	Shield,
	Users,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { InvestorStatusBadge } from "@/components/investments/InvestorStatusBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { CurrencyInput } from "@/components/ui/currency-input";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { authClient } from "@/lib/auth-client";
import { PERMISSIONS } from "@/lib/roles";
import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/inversiones/liquidaciones/")({
	component: LiquidacionesInversionistas,
});

function LiquidacionesInversionistas() {
	const { data: session } = authClient.useSession();
	const userRole = (session?.user as any)?.role ?? "";
	const isManager = PERMISSIONS.canValidateInvestmentFunds(userRole);
	const [search, setSearch] = useState("");

	// Modal crear inversionista
	const [crearOpen, setCrearOpen] = useState(false);
	const [formNombre, setFormNombre] = useState("");
	const [formDpi, setFormDpi] = useState("");
	const [formEmail, setFormEmail] = useState("");
	const [formBanco, setFormBanco] = useState("");
	const [formTipoCuenta, setFormTipoCuenta] = useState("");
	const [formNumeroCuenta, setFormNumeroCuenta] = useState("");
	const [formMoneda, setFormMoneda] = useState("quetzales");
	const [formEmiteFactura, setFormEmiteFactura] = useState(false);
	const [formTipoReinversion, setFormTipoReinversion] = useState("sin_reinversion");
	const [formMontoReinversion, setFormMontoReinversion] = useState("");
	// Compra de cartera opcional
	const [hacerCompra, setHacerCompra] = useState(false);
	const [formMontoCompra, setFormMontoCompra] = useState("");
	const [formPctInversion, setFormPctInversion] = useState("70");
	const [formPctCashIn, setFormPctCashIn] = useState("30");
	const [formFechaCompra, setFormFechaCompra] = useState(
		new Date().toISOString().split("T")[0],
	);

	const queryClient = useQueryClient();

	const resetForm = () => {
		setFormNombre("");
		setFormDpi("");
		setFormEmail("");
		setFormBanco("");
		setFormTipoCuenta("");
		setFormNumeroCuenta("");
		setFormMoneda("quetzales");
		setFormEmiteFactura(false);
		setFormTipoReinversion("sin_reinversion");
		setFormMontoReinversion("");
		setHacerCompra(false);
		setFormMontoCompra("");
		setFormPctInversion("70");
		setFormPctCashIn("30");
		setFormFechaCompra(new Date().toISOString().split("T")[0]);
	};

	const crearMutation = useMutation({
		...orpc.crearInversionista.mutationOptions(),
		onSuccess: async (data: any) => {
			const msg = data.compraCartera
				? "Inversionista creado y compra de cartera registrada"
				: "Inversionista creado correctamente";
			toast.success(msg);
			setCrearOpen(false);
			resetForm();
			await queryClient.invalidateQueries({
				predicate: (query) =>
					JSON.stringify(query.queryKey).includes("getInversionistas"),
			});
		},
		onError: (err: any) => {
			toast.error(err?.message ?? "Error al crear inversionista");
		},
	});

	const investorsQuery = useQuery({
		...orpc.getInversionistas.queryOptions({
			input: { page: 1, perPage: 100 },
		}),
		enabled: !!session,
	})

	const bancosQuery = useQuery({
		...orpc.getBancosCartera.queryOptions({ input: undefined as never }),
		enabled: crearOpen,
	});
	const bancos = (bancosQuery.data as any) ?? [];

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
					<div className="ml-auto flex items-center gap-3">
						<div className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2">
							<Users className="h-4 w-4 text-muted-foreground" />
							<span className="font-semibold text-sm">
								{investors.length} Inversionistas
							</span>
						</div>
						<Button
							size="sm"
							className="gap-2"
							onClick={() => setCrearOpen(true)}
						>
							<Plus className="h-4 w-4" />
							Crear Inversionista
						</Button>
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
										{inv.tipoReinversion && inv.tipoReinversion !== "sin_reinversion" && (
											<Badge
												variant="outline"
												className="border-purple-300 bg-purple-50 text-[10px] text-purple-700 dark:border-purple-700 dark:bg-purple-950 dark:text-purple-300"
											>
												{{
													reinversion_capital: "Reinversión Capital",
													reinversion_interes: "Reinversión Interés",
													reinversion_total: "Reinversión Total",
													reinversion_variable: "Reinversión Variable",
													reinversion_combinada: "Reinversión Combinada",
												}[inv.tipoReinversion as string] ?? "Reinversión"}
											</Badge>
										)}
										<InvestorStatusBadge
											status={(inv as any).status}
											size="sm"
										/>
									</div>
								</Link>
							))}
						</div>
					)}
			</div>

			{/* Modal Crear Inversionista */}
			<Dialog
				open={crearOpen}
				onOpenChange={(open) => {
					setCrearOpen(open);
					if (!open) resetForm();
				}}
			>
				<DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
					<DialogHeader>
						<DialogTitle>Crear Inversionista</DialogTitle>
						<DialogDescription>
							Completa los datos del nuevo inversionista
						</DialogDescription>
					</DialogHeader>

					<div className="space-y-4 py-2">
						{/* Nombre */}
						<div className="space-y-1.5">
							<Label htmlFor="inv-nombre">Nombre *</Label>
							<Input
								id="inv-nombre"
								value={formNombre}
								onChange={(e) => setFormNombre(e.target.value)}
								placeholder="Nombre completo"
							/>
						</div>

						{/* DPI + Email */}
						<div className="grid grid-cols-2 gap-3">
							<div className="space-y-1.5">
								<Label htmlFor="inv-dpi">DPI</Label>
								<Input
									id="inv-dpi"
									value={formDpi}
									onChange={(e) => setFormDpi(e.target.value)}
									placeholder="Número de DPI"
								/>
							</div>
							<div className="space-y-1.5">
								<Label htmlFor="inv-email">Email</Label>
								<Input
									id="inv-email"
									type="email"
									value={formEmail}
									onChange={(e) => setFormEmail(e.target.value)}
									placeholder="correo@ejemplo.com"
								/>
							</div>
						</div>

						{/* Banco + Tipo cuenta */}
						<div className="grid grid-cols-2 gap-3">
							<div className="space-y-1.5">
								<Label htmlFor="inv-banco">Banco</Label>
								<Select
									value={formBanco}
									onValueChange={setFormBanco}
								>
									<SelectTrigger id="inv-banco">
										<SelectValue placeholder="Seleccionar banco..." />
									</SelectTrigger>
									<SelectContent>
										{bancos.map((b: any) => (
											<SelectItem
												key={b.banco_id}
												value={String(b.banco_id)}
											>
												{b.nombre}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
							<div className="space-y-1.5">
								<Label htmlFor="inv-tipo-cuenta">Tipo de cuenta</Label>
								<Select
									value={formTipoCuenta}
									onValueChange={setFormTipoCuenta}
								>
									<SelectTrigger id="inv-tipo-cuenta">
										<SelectValue placeholder="Seleccionar..." />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="AHORRO Q">Ahorro Q</SelectItem>
										<SelectItem value="AHORRO $">Ahorro $</SelectItem>
										<SelectItem value="MONETARIA Q">Monetaria Q</SelectItem>
										<SelectItem value="MONETARIA $">Monetaria $</SelectItem>
									</SelectContent>
								</Select>
							</div>
						</div>

						{/* Número cuenta */}
						<div className="space-y-1.5">
							<Label htmlFor="inv-numero-cuenta">Número de cuenta</Label>
							<Input
								id="inv-numero-cuenta"
								value={formNumeroCuenta}
								onChange={(e) => setFormNumeroCuenta(e.target.value)}
								placeholder="Número de cuenta bancaria"
							/>
						</div>

						{/* Moneda + Factura */}
						<div className="grid grid-cols-2 gap-3">
							<div className="space-y-1.5">
								<Label htmlFor="inv-moneda">Moneda</Label>
								<Select value={formMoneda} onValueChange={setFormMoneda}>
									<SelectTrigger id="inv-moneda">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="quetzales">Quetzales (GTQ)</SelectItem>
										<SelectItem value="dolares">Dólares (USD)</SelectItem>
									</SelectContent>
								</Select>
							</div>
							<div className="flex items-end pb-2">
								<div className="flex items-center gap-2">
									<Checkbox
										id="inv-factura"
										checked={formEmiteFactura}
										onCheckedChange={(v) => setFormEmiteFactura(v === true)}
									/>
									<Label htmlFor="inv-factura">Emite factura</Label>
								</div>
							</div>
						</div>

						{/* Reinversión */}
						<div className="grid grid-cols-2 gap-3">
							<div className="space-y-1.5">
								<Label htmlFor="inv-reinversion">Modelo de Inversión</Label>
								<Select
									value={formTipoReinversion}
									onValueChange={setFormTipoReinversion}
								>
									<SelectTrigger id="inv-reinversion">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="sin_reinversion">
											Tradicional
										</SelectItem>
										<SelectItem value="reinversion_capital">Reinversión Capital</SelectItem>
										<SelectItem value="reinversion_total">Interés Compuesto</SelectItem>
									</SelectContent>
								</Select>
							</div>
							{formTipoReinversion === "reinversion_variable" && (
								<div className="space-y-1.5">
									<Label htmlFor="inv-monto-reinversion">
										Monto reinversión
									</Label>
									<Input
										id="inv-monto-reinversion"
										type="number"
										min="0"
										step="0.01"
										value={formMontoReinversion}
										onChange={(e) => setFormMontoReinversion(e.target.value)}
										placeholder="0.00"
									/>
								</div>
							)}
						</div>

						{/* Separador — Compra de cartera */}
						<div className="rounded-lg border bg-muted/50 p-4 space-y-3">
							<div className="flex items-center gap-2">
								<Checkbox
									id="inv-compra"
									checked={hacerCompra}
									onCheckedChange={(v) => setHacerCompra(v === true)}
								/>
								<Label htmlFor="inv-compra" className="font-semibold">
									Hacer compra de cartera
								</Label>
							</div>

							{hacerCompra && (
								<div className="space-y-3">
									<div className="grid grid-cols-2 gap-3">
										<div className="space-y-1.5">
											<Label htmlFor="inv-monto-compra">Monto aportado *</Label>
											<CurrencyInput
												id="inv-monto-compra"
												value={formMontoCompra}
												onChange={setFormMontoCompra}
											/>
										</div>
										<div className="space-y-1.5">
											<Label htmlFor="inv-fecha-compra">
												Fecha participación
											</Label>
											<Input
												id="inv-fecha-compra"
												type="date"
												value={formFechaCompra}
												onChange={(e) => setFormFechaCompra(e.target.value)}
											/>
										</div>
									</div>
									<div className="grid grid-cols-2 gap-3">
										<div className="space-y-1.5">
											<Label htmlFor="inv-pct-inv">% Inversiónista</Label>
											<Input
												id="inv-pct-inv"
												type="number"
												min="0"
												max="100"
												value={formPctInversion}
												onChange={(e) => {
													const val = e.target.value;
													setFormPctInversion(val);
													const num = Number(val);
													if (!Number.isNaN(num)) {
														setFormPctCashIn(String(100 - num));
													}
												}}
											/>
										</div>
										<div className="space-y-1.5">
											<Label htmlFor="inv-pct-cci">% CCI</Label>
											<Input
												id="inv-pct-cci"
												type="number"
												min="0"
												max="100"
												value={formPctCashIn}
												onChange={(e) => {
													const val = e.target.value;
													setFormPctCashIn(val);
													const num = Number(val);
													if (!Number.isNaN(num)) {
														setFormPctInversion(String(100 - num));
													}
												}}
											/>
										</div>
									</div>
								</div>
							)}
						</div>
					</div>

					<DialogFooter className="gap-2 sm:justify-between">
						<Button
							variant="outline"
							onClick={() => {
								setCrearOpen(false);
								resetForm();
							}}
						>
							Cancelar
						</Button>
						<Button
							disabled={
								crearMutation.isPending ||
								!formNombre.trim() ||
								(hacerCompra &&
									(!formMontoCompra || Number(formMontoCompra) <= 0))
							}
							onClick={() => {
								crearMutation.mutate({
									nombre: formNombre.trim(),
									dpi: formDpi.trim() || undefined,
									email: formEmail.trim() || undefined,
									banco: formBanco ? Number(formBanco) : null,
									tipoCuenta: formTipoCuenta || undefined,
									numeroCuenta: formNumeroCuenta.trim() || undefined,
									moneda: formMoneda as "quetzales" | "dolares",
									emiteFactura: formEmiteFactura,
									tipoReinversion: formTipoReinversion,
									montoReinversion: formMontoReinversion
										? Number(formMontoReinversion)
										: undefined,
									hacerCompraCartera: hacerCompra,
									montoCompraCartera: hacerCompra
										? Number(formMontoCompra)
										: undefined,
									porcentajeInversion: hacerCompra
										? Number(formPctInversion)
										: undefined,
									porcentajeCashIn: hacerCompra
										? Number(formPctCashIn)
										: undefined,
									fechaInicioParticipacion: hacerCompra
										? formFechaCompra || undefined
										: undefined,
								});
							}}
						>
							{crearMutation.isPending ? (
								<>
									<Loader2 className="mr-2 h-4 w-4 animate-spin" />
									Creando...
								</>
							) : hacerCompra ? (
								"Crear y Comprar Cartera"
							) : (
								"Crear Inversionista"
							)}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	)
}
