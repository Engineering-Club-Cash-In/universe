import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
	Banknote,
	BarChart3,
	Bell,
	Briefcase,
	Building2,
	Calculator,
	CalendarClock,
	Car,
	ChevronDown,
	ClipboardList,
	Database,
	FileText,
	Gauge,
	Gavel,
	Landmark,
	Layers,
	LayoutDashboard,
	Menu,
	MessageSquare,
	Scale,
	Settings,
	Target,
	TrendingUp,
	UserCircle,
	UserCog,
	Users,
} from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { logo } from "@/assets";
import { authClient } from "@/lib/auth-client";
import { PERMISSIONS } from "@/lib/roles";
import { orpc } from "@/utils/orpc";

import { ModeToggle } from "./mode-toggle";
import { Button } from "./ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import {
	Sheet,
	SheetContent,
	SheetHeader,
	SheetTitle,
	SheetTrigger,
} from "./ui/sheet";
import UserMenu from "./user-menu";

export default function Header() {
	const { data: session } = authClient.useSession();
	const userProfile = useQuery({
		...orpc.getUserProfile.queryOptions(),
		enabled: !!session,
	});
	const router = useRouterState();
	const currentPath = router.location.pathname;

	const userRole = userProfile.data?.role;

	const isActive = (path: string) => currentPath.startsWith(path);

	return (
		<div className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
			<div className="flex h-16 items-center px-6">
				<div className="flex items-center gap-3 md:gap-8">
					{/* Mobile menu (hamburguesa) */}
					<MobileNav session={!!session} userRole={userRole} />

					{/* Logo */}
					<Link
						to="/"
						className="flex items-center gap-2 transition-opacity hover:opacity-80"
					>
						<img src={logo} alt="CCI Logo" className="h-9 w-auto" />
						<span className="hidden font-bold text-lg sm:inline-block">
							CCI CRM
						</span>
					</Link>

					{/* Navigation (desktop) */}
					<nav className="hidden items-center gap-1 md:flex">
						{!session && (
							<Button variant="ghost" size="sm" asChild>
								<Link to="/">
									<LayoutDashboard className="mr-2 h-4 w-4" />
									Inicio
								</Link>
							</Button>
						)}

						{session && (
							<Button
								variant={isActive("/dashboard") ? "secondary" : "ghost"}
								size="sm"
								asChild
							>
								<Link to="/dashboard">
									<LayoutDashboard className="mr-2 h-4 w-4" />
									Tablero
								</Link>
							</Button>
						)}

						{/* CRM Dropdown */}
						{session && userRole && PERMISSIONS.canAccessCRM(userRole) && (
							<DropdownMenu>
								<DropdownMenuTrigger asChild>
									<Button
										variant={isActive("/crm") ? "secondary" : "ghost"}
										size="sm"
										className="gap-1"
									>
										<Briefcase className="h-4 w-4" />
										Ventas
										<ChevronDown className="h-3 w-3 opacity-50" />
									</Button>
								</DropdownMenuTrigger>
								<DropdownMenuContent align="start" className="w-56">
									<DropdownMenuItem asChild>
										<Link to="/crm/leads" className="cursor-pointer">
											<UserCircle className="mr-2 h-4 w-4" />
											Prospectos
										</Link>
									</DropdownMenuItem>
									<DropdownMenuItem asChild>
										<Link to="/crm/opportunities" className="cursor-pointer">
											<TrendingUp className="mr-2 h-4 w-4" />
											Oportunidades
										</Link>
									</DropdownMenuItem>

									<DropdownMenuItem asChild>
										<Link to="/crm/companies" className="cursor-pointer">
											<Building2 className="mr-2 h-4 w-4" />
											Empresas
										</Link>
									</DropdownMenuItem>
									<DropdownMenuItem asChild>
										<Link to="/crm/vendors" className="cursor-pointer">
											<UserCircle className="mr-2 h-4 w-4" />
											Vendedores
										</Link>
									</DropdownMenuItem>
									<DropdownMenuSeparator />
									<DropdownMenuItem asChild>
										<Link to="/crm/quoter" className="cursor-pointer">
											<Calculator className="mr-2 h-4 w-4" />
											Cotizador
										</Link>
									</DropdownMenuItem>
									{userRole && PERMISSIONS.canAccessWhatsApp(userRole) && (
										<>
											<DropdownMenuSeparator />
											<DropdownMenuItem asChild>
												<Link to="/crm/whatsapp" className="cursor-pointer">
													<MessageSquare className="mr-2 h-4 w-4" />
													WhatsApp
												</Link>
											</DropdownMenuItem>
										</>
									)}
									{userRole &&
										(PERMISSIONS.canAccessTiempoCierreReport(userRole) ||
											PERMISSIONS.canAccessPorcentajeEfectividadReport(
												userRole,
											) ||
											PERMISSIONS.canAccessMetaColocacionReport(userRole)) && (
											<>
												<DropdownMenuSeparator />
												<DropdownMenuItem asChild>
													<Link to="/crm/reportes" className="cursor-pointer">
														<FileText className="mr-2 h-4 w-4" />
														Reportes
													</Link>
												</DropdownMenuItem>
											</>
										)}
								</DropdownMenuContent>
							</DropdownMenu>
						)}

						{/* Clientes */}
						{session && userRole && PERMISSIONS.canAccessClients(userRole) && (
							<Button
								variant={isActive("/crm/clients") ? "secondary" : "ghost"}
								size="sm"
								asChild
							>
								<Link to="/crm/clients">
									<Users className="mr-2 h-4 w-4" />
									Clientes
								</Link>
							</Button>
						)}

						{/* Vehículos */}
						{session && userRole && PERMISSIONS.canAccessVehicles(userRole) && (
							<DropdownMenu>
								<DropdownMenuTrigger asChild>
									<Button
										variant={isActive("/vehicles") ? "secondary" : "ghost"}
										size="sm"
										className="gap-1"
									>
										<Car className="h-4 w-4" />
										Vehículos
										<ChevronDown className="h-3 w-3 opacity-50" />
									</Button>
								</DropdownMenuTrigger>
								<DropdownMenuContent align="start" className="w-48">
									<DropdownMenuItem asChild>
										<Link
											to="/vehicles"
											search={{
												vehicleId: undefined,
												inspectionId: undefined,
												tab: undefined,
											}}
											className="cursor-pointer"
										>
											<Car className="mr-2 h-4 w-4" />
											Inventario
										</Link>
									</DropdownMenuItem>
									<DropdownMenuItem asChild>
										<Link
											to="/vehicles/auction-vehicles"
											className="cursor-pointer"
										>
											<Gavel className="mr-2 h-4 w-4" />
											Carros en Remate
										</Link>
									</DropdownMenuItem>
								</DropdownMenuContent>
							</DropdownMenu>
						)}

						{/* Cobros Dropdown */}
						{session && userRole && PERMISSIONS.canAccessCobros(userRole) && (
							<DropdownMenu>
								<DropdownMenuTrigger asChild>
									<Button
										variant={isActive("/cobros") ? "secondary" : "ghost"}
										size="sm"
										className="gap-1"
									>
										<Banknote className="h-4 w-4" />
										Cobros
										<ChevronDown className="h-3 w-3 opacity-50" />
									</Button>
								</DropdownMenuTrigger>
								<DropdownMenuContent align="start" className="w-48">
									<DropdownMenuItem asChild>
										<Link to="/cobros" className="cursor-pointer">
											<Banknote className="mr-2 h-4 w-4" />
											Dashboard
										</Link>
									</DropdownMenuItem>
									<DropdownMenuItem asChild>
										<Link to="/cobros/agenda" className="cursor-pointer">
											<CalendarClock className="mr-2 h-4 w-4" />
											Agenda del día
										</Link>
									</DropdownMenuItem>
									<DropdownMenuItem asChild>
										<Link to="/cobros/cola" className="cursor-pointer">
											<ClipboardList className="mr-2 h-4 w-4" />
											Cola del día
										</Link>
									</DropdownMenuItem>
									{PERMISSIONS.canAssignCobros(userRole) && (
										<DropdownMenuItem asChild>
											<Link to="/cobros/metas" className="cursor-pointer">
												<Target className="mr-2 h-4 w-4" />
												Metas de Mora
											</Link>
										</DropdownMenuItem>
									)}
									{PERMISSIONS.canAssignCobros(userRole) && (
										<DropdownMenuItem asChild>
											<Link to="/cobros/buckets" className="cursor-pointer">
												<Layers className="mr-2 h-4 w-4" />
												Historial de Buckets
											</Link>
										</DropdownMenuItem>
									)}
									{PERMISSIONS.canAssignCobros(userRole) && (
										<DropdownMenuItem asChild>
											<Link
												to="/cobros/reasignaciones"
												className="cursor-pointer"
											>
												<UserCog className="mr-2 h-4 w-4" />
												Reasignar Cuentas
											</Link>
										</DropdownMenuItem>
									)}
									{PERMISSIONS.canAssignCobros(userRole) && (
										<DropdownMenuItem asChild>
											<Link to="/cobros/carga" className="cursor-pointer">
												<Gauge className="mr-2 h-4 w-4" />
												Carga de Cuentas
											</Link>
										</DropdownMenuItem>
									)}
									{PERMISSIONS.canAssignCobros(userRole) && (
										<>
											<DropdownMenuSeparator />
											<DropdownMenuItem asChild>
												<Link to="/cobros/reportes" className="cursor-pointer">
													<BarChart3 className="mr-2 h-4 w-4" />
													Reportes
												</Link>
											</DropdownMenuItem>
										</>
									)}
								</DropdownMenuContent>
							</DropdownMenu>
						)}

						{/* Análisis */}
						{session && userRole && PERMISSIONS.canAccessAnalysis(userRole) && (
							<Button
								variant={isActive("/crm/analysis") ? "secondary" : "ghost"}
								size="sm"
								asChild
							>
								<Link to="/crm/analysis">
									<BarChart3 className="mr-2 h-4 w-4" />
									Análisis
								</Link>
							</Button>
						)}

						{/* Jurídico */}
						{session && userRole && PERMISSIONS.canAccessJuridico(userRole) && (
							<DropdownMenu>
								<DropdownMenuTrigger asChild>
									<Button
										variant={isActive("/juridico") ? "secondary" : "ghost"}
										size="sm"
										className="gap-1"
									>
										<Scale className="h-4 w-4" />
										Jurídico
										<ChevronDown className="h-3 w-3 opacity-50" />
									</Button>
								</DropdownMenuTrigger>
								<DropdownMenuContent align="start" className="w-56">
									<DropdownMenuItem asChild>
										<Link to="/juridico" className="cursor-pointer">
											<Scale className="mr-2 h-4 w-4" />
											Gestión jurídica
										</Link>
									</DropdownMenuItem>
									<DropdownMenuItem asChild>
										<Link to="/juridico/dashboard" className="cursor-pointer">
											<LayoutDashboard className="mr-2 h-4 w-4" />
											Dashboard
										</Link>
									</DropdownMenuItem>
									<DropdownMenuItem asChild>
										<Link
											to="/juridico/dashboard-data"
											className="cursor-pointer"
										>
											<Database className="mr-2 h-4 w-4" />
											Carga de datos
										</Link>
									</DropdownMenuItem>
								</DropdownMenuContent>
							</DropdownMenu>
						)}

						{/* Inversiones */}
						{session &&
							userRole &&
							PERMISSIONS.canAccessInvestments(userRole) && (
								<DropdownMenu>
									<DropdownMenuTrigger asChild>
										<Button
											variant={isActive("/inversiones") ? "secondary" : "ghost"}
											size="sm"
											className="gap-1"
										>
											<TrendingUp className="h-4 w-4" />
											Inversiones
											<ChevronDown className="h-3 w-3 opacity-50" />
										</Button>
									</DropdownMenuTrigger>
									<DropdownMenuContent align="start" className="w-56">
										<DropdownMenuItem asChild>
											<Link to="/inversiones" className="cursor-pointer">
												<Target className="mr-2 h-4 w-4" />
												Leads
											</Link>
										</DropdownMenuItem>
										<DropdownMenuItem asChild>
											<Link
												to="/inversiones/liquidaciones"
												className="cursor-pointer"
											>
												<Landmark className="mr-2 h-4 w-4" />
												Inversionistas
											</Link>
										</DropdownMenuItem>
									</DropdownMenuContent>
								</DropdownMenu>
							)}

						{/* Contabilidad Dropdown */}
						{session &&
							userRole &&
							PERMISSIONS.canAccessAccounting(userRole) && (
								<DropdownMenu>
									<DropdownMenuTrigger asChild>
										<Button
											variant={isActive("/accounting") ? "secondary" : "ghost"}
											size="sm"
											className="gap-1"
										>
											<Calculator className="h-4 w-4" />
											Contabilidad
											<ChevronDown className="h-3 w-3 opacity-50" />
										</Button>
									</DropdownMenuTrigger>
									<DropdownMenuContent align="start" className="w-56">
										<DropdownMenuItem asChild>
											<Link
												to="/accounting/pay-investors"
												className="cursor-pointer"
											>
												<Banknote className="mr-2 h-4 w-4" />
												Pagar Inversionistas
											</Link>
										</DropdownMenuItem>
									</DropdownMenuContent>
								</DropdownMenu>
							)}

						{/* Admin Dropdown */}
						{session &&
							userRole &&
							(PERMISSIONS.canAccessAdmin(userRole) ||
								PERMISSIONS.canAccessClosedCreditsReport(userRole)) && (
								<DropdownMenu>
									<DropdownMenuTrigger asChild>
										<Button
											variant={isActive("/admin") ? "secondary" : "ghost"}
											size="sm"
											className="gap-1"
										>
											<Settings className="h-4 w-4" />
											Admin
											<ChevronDown className="h-3 w-3 opacity-50" />
										</Button>
									</DropdownMenuTrigger>
									<DropdownMenuContent align="start" className="w-48">
										{PERMISSIONS.canAccessAdmin(userRole) && (
											<>
												<DropdownMenuItem asChild>
													<Link to="/admin/users" className="cursor-pointer">
														<Users className="mr-2 h-4 w-4" />
														Usuarios
													</Link>
												</DropdownMenuItem>
												{/* "Importación", "MiniAgent" y "Configuración"
												    ocultos a propósito. Las rutas y páginas
												    (/admin/import, /crm/admin/miniagent,
												    /admin/settings) se conservan por si se quieren
												    reutilizar; para volver a mostrarlas, reañadir
												    aquí sus DropdownMenuItem. */}
											</>
										)}
										<DropdownMenuItem asChild>
											<Link to="/admin/reports" className="cursor-pointer">
												<FileText className="mr-2 h-4 w-4" />
												Reportes
											</Link>
										</DropdownMenuItem>
									</DropdownMenuContent>
								</DropdownMenu>
							)}
					</nav>
				</div>

				{/* Right side */}
				<div className="ml-auto flex items-center gap-2">
					{session && <NotificationBell />}
					<ModeToggle />
					<UserMenu />
				</div>
			</div>
		</div>
	);
}

const MOBILE_LINK_CLASS =
	"flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors hover:bg-accent [&_svg]:h-4 [&_svg]:w-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground";

function MobileSection({
	label,
	children,
}: {
	label: string;
	children: ReactNode;
}) {
	return (
		<div className="mt-2 flex flex-col">
			<p className="px-3 pt-2 pb-1 font-medium text-muted-foreground text-xs uppercase tracking-wider">
				{label}
			</p>
			{children}
		</div>
	);
}

// Menú de navegación para mobile (hamburguesa + drawer). Mismas opciones y
// permisos que el nav de escritorio, en lista vertical. Se cierra solo al navegar.
function MobileNav({
	session,
	userRole,
}: {
	session: boolean;
	userRole: string | undefined;
}) {
	const [open, setOpen] = useState(false);
	const router = useRouterState();
	const pathname = router.location.pathname;

	// biome-ignore lint/correctness/useExhaustiveDependencies: cerrar el drawer cuando cambia la ruta
	useEffect(() => {
		setOpen(false);
	}, [pathname]);

	const ventasReports =
		!!userRole &&
		(PERMISSIONS.canAccessTiempoCierreReport(userRole) ||
			PERMISSIONS.canAccessPorcentajeEfectividadReport(userRole) ||
			PERMISSIONS.canAccessMetaColocacionReport(userRole));

	return (
		<div className="md:hidden">
			<Sheet open={open} onOpenChange={setOpen}>
				<SheetTrigger asChild>
					<Button variant="ghost" size="icon" aria-label="Abrir menú">
						<Menu className="h-5 w-5" />
					</Button>
				</SheetTrigger>
				<SheetContent
					side="left"
					className="flex h-dvh max-h-dvh w-72 flex-col gap-0 overflow-hidden p-0"
				>
					<SheetHeader className="shrink-0 border-b">
						<SheetTitle>Menú</SheetTitle>
					</SheetHeader>
					<nav className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto overscroll-contain p-3">
						{!session && (
							<Link to="/" className={MOBILE_LINK_CLASS}>
								<LayoutDashboard />
								Inicio
							</Link>
						)}

						{session && (
							<>
								<Link to="/dashboard" className={MOBILE_LINK_CLASS}>
									<LayoutDashboard />
									Tablero
								</Link>

								{userRole && PERMISSIONS.canAccessCRM(userRole) && (
									<MobileSection label="Ventas">
										<Link to="/crm/leads" className={MOBILE_LINK_CLASS}>
											<UserCircle />
											Prospectos
										</Link>
										<Link to="/crm/opportunities" className={MOBILE_LINK_CLASS}>
											<TrendingUp />
											Oportunidades
										</Link>
										<Link to="/crm/companies" className={MOBILE_LINK_CLASS}>
											<Building2 />
											Empresas
										</Link>
										<Link to="/crm/vendors" className={MOBILE_LINK_CLASS}>
											<UserCircle />
											Vendedores
										</Link>
										<Link to="/crm/quoter" className={MOBILE_LINK_CLASS}>
											<Calculator />
											Cotizador
										</Link>
										{PERMISSIONS.canAccessWhatsApp(userRole) && (
											<Link to="/crm/whatsapp" className={MOBILE_LINK_CLASS}>
												<MessageSquare />
												WhatsApp
											</Link>
										)}
										{ventasReports && (
											<Link to="/crm/reportes" className={MOBILE_LINK_CLASS}>
												<FileText />
												Reportes
											</Link>
										)}
									</MobileSection>
								)}

								{userRole && PERMISSIONS.canAccessClients(userRole) && (
									<Link to="/crm/clients" className={MOBILE_LINK_CLASS}>
										<Users />
										Clientes
									</Link>
								)}

								{userRole && PERMISSIONS.canAccessVehicles(userRole) && (
									<MobileSection label="Vehículos">
										<Link
											to="/vehicles"
											search={{
												vehicleId: undefined,
												inspectionId: undefined,
												tab: undefined,
											}}
											className={MOBILE_LINK_CLASS}
										>
											<Car />
											Inventario
										</Link>
										<Link
											to="/vehicles/auction-vehicles"
											className={MOBILE_LINK_CLASS}
										>
											<Gavel />
											Carros en Remate
										</Link>
									</MobileSection>
								)}

								{userRole && PERMISSIONS.canAccessCobros(userRole) && (
									<MobileSection label="Cobros">
										<Link to="/cobros" className={MOBILE_LINK_CLASS}>
											<Banknote />
											Dashboard
										</Link>
										<Link to="/cobros/agenda" className={MOBILE_LINK_CLASS}>
											<CalendarClock />
											Agenda del día
										</Link>
										<Link to="/cobros/cola" className={MOBILE_LINK_CLASS}>
											<ClipboardList />
											Cola del día
										</Link>
										{PERMISSIONS.canAssignCobros(userRole) && (
											<Link to="/cobros/metas" className={MOBILE_LINK_CLASS}>
												<Target />
												Metas de Mora
											</Link>
										)}
										{PERMISSIONS.canAssignCobros(userRole) && (
											<Link to="/cobros/buckets" className={MOBILE_LINK_CLASS}>
												<Layers />
												Historial de Buckets
											</Link>
										)}
										{PERMISSIONS.canAssignCobros(userRole) && (
											<Link
												to="/cobros/reasignaciones"
												className={MOBILE_LINK_CLASS}
											>
												<UserCog />
												Reasignar Cuentas
											</Link>
										)}
										{PERMISSIONS.canAssignCobros(userRole) && (
											<Link to="/cobros/carga" className={MOBILE_LINK_CLASS}>
												<Gauge />
												Carga de Cuentas
											</Link>
										)}
										{PERMISSIONS.canAssignCobros(userRole) && (
											<Link to="/cobros/reportes" className={MOBILE_LINK_CLASS}>
												<BarChart3 />
												Reportes
											</Link>
										)}
									</MobileSection>
								)}

								{userRole && PERMISSIONS.canAccessAnalysis(userRole) && (
									<Link to="/crm/analysis" className={MOBILE_LINK_CLASS}>
										<BarChart3 />
										Análisis
									</Link>
								)}

								{userRole && PERMISSIONS.canAccessJuridico(userRole) && (
									<MobileSection label="Jurídico">
										<Link to="/juridico" className={MOBILE_LINK_CLASS}>
											<Scale />
											Gestión jurídica
										</Link>
										<Link
											to="/juridico/dashboard"
											className={MOBILE_LINK_CLASS}
										>
											<LayoutDashboard />
											Dashboard
										</Link>
										<Link
											to="/juridico/dashboard-data"
											className={MOBILE_LINK_CLASS}
										>
											<Database />
											Carga de datos
										</Link>
									</MobileSection>
								)}

								{userRole && PERMISSIONS.canAccessInvestments(userRole) && (
									<MobileSection label="Inversiones">
										<Link to="/inversiones" className={MOBILE_LINK_CLASS}>
											<Target />
											Leads
										</Link>
										<Link
											to="/inversiones/liquidaciones"
											className={MOBILE_LINK_CLASS}
										>
											<Landmark />
											Inversionistas
										</Link>
									</MobileSection>
								)}

								{userRole && PERMISSIONS.canAccessAccounting(userRole) && (
									<MobileSection label="Contabilidad">
										<Link
											to="/accounting/pay-investors"
											className={MOBILE_LINK_CLASS}
										>
											<Banknote />
											Pagar Inversionistas
										</Link>
									</MobileSection>
								)}

								{userRole &&
									(PERMISSIONS.canAccessAdmin(userRole) ||
										PERMISSIONS.canAccessClosedCreditsReport(userRole)) && (
										<MobileSection label="Admin">
											{PERMISSIONS.canAccessAdmin(userRole) && (
												<Link to="/admin/users" className={MOBILE_LINK_CLASS}>
													<Users />
													Usuarios
												</Link>
											)}
											<Link to="/admin/reports" className={MOBILE_LINK_CLASS}>
												<FileText />
												Reportes
											</Link>
										</MobileSection>
									)}
							</>
						)}
					</nav>
				</SheetContent>
			</Sheet>
		</div>
	);
}

function NotificationBell() {
	const navigate = useNavigate();
	const { data } = useQuery({
		...orpc.getUnreadNotificationCount.queryOptions(),
		refetchInterval: (query) => {
			const count = query.state.data?.count ?? 0;
			return count > 0 ? false : 40000;
		},
	});

	const count = data?.count ?? 0;

	return (
		<Button
			variant="ghost"
			size="icon"
			className="relative"
			onClick={() => navigate({ to: "/notifications" })}
		>
			<Bell className="h-5 w-5" />
			{count > 0 && (
				<span className="absolute -top-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 font-bold text-[10px] text-white">
					{count > 99 ? "99+" : count}
				</span>
			)}
		</Button>
	);
}
