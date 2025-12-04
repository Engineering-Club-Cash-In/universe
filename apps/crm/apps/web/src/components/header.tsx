import { useQuery } from "@tanstack/react-query";
import { Link, useRouterState } from "@tanstack/react-router";
import {
	Banknote,
	BarChart3,
	Briefcase,
	Building2,
	Calculator,
	Car,
	ChevronDown,
	Database,
	FileText,
	Gavel,
	Key,
	LayoutDashboard,
	MessageSquare,
	Scale,
	Settings,
	TrendingUp,
	UserCircle,
	Users,
} from "lucide-react";
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
				<div className="flex items-center gap-8">
					{/* Logo */}
					<Link
						to="/"
						className="flex items-center gap-2 transition-opacity hover:opacity-80"
					>
						<div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
							<TrendingUp className="h-5 w-5" />
						</div>
						<span className="hidden font-bold text-lg sm:inline-block">
							CCI CRM
						</span>
					</Link>

					{/* Navigation */}
					<nav className="flex items-center gap-1">
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
										variant={
											isActive("/crm") || isActive("/vehicles")
												? "secondary"
												: "ghost"
										}
										size="sm"
										className="gap-1"
									>
										<Briefcase className="h-4 w-4" />
										CRM
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
										<Link to="/crm/clients" className="cursor-pointer">
											<Users className="mr-2 h-4 w-4" />
											Clientes
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
									<DropdownMenuSeparator />
									{userRole && PERMISSIONS.canAccessWhatsApp(userRole) && (
										<DropdownMenuItem asChild>
											<Link to="/crm/whatsapp" className="cursor-pointer">
												<MessageSquare className="mr-2 h-4 w-4" />
												WhatsApp
											</Link>
										</DropdownMenuItem>
									)}
									<DropdownMenuSeparator />
									<DropdownMenuItem asChild>
										<Link to="/vehicles" className="cursor-pointer">
											<Car className="mr-2 h-4 w-4" />
											Vehículos
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

						{/* Cobros */}
						{session && userRole && PERMISSIONS.canAccessCobros(userRole) && (
							<Button
								variant={isActive("/cobros") ? "secondary" : "ghost"}
								size="sm"
								asChild
							>
								<Link to="/cobros">
									<Banknote className="mr-2 h-4 w-4" />
									Cobros
								</Link>
							</Button>
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
							<Button
								variant={isActive("/juridico") ? "secondary" : "ghost"}
								size="sm"
								asChild
							>
								<Link to="/juridico">
									<Scale className="mr-2 h-4 w-4" />
									Jurídico
								</Link>
							</Button>
						)}

						{/* Admin Dropdown */}
						{session && userRole && PERMISSIONS.canAccessAdmin(userRole) && (
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
									<DropdownMenuItem asChild>
										<Link to="/admin/users" className="cursor-pointer">
											<Users className="mr-2 h-4 w-4" />
											Usuarios
										</Link>
									</DropdownMenuItem>
									<DropdownMenuItem asChild>
										<Link to="/admin/import" className="cursor-pointer">
											<Database className="mr-2 h-4 w-4" />
											Importación
										</Link>
									</DropdownMenuItem>
									<DropdownMenuItem asChild>
										<Link to="/crm/admin/miniagent" className="cursor-pointer">
											<Key className="mr-2 h-4 w-4" />
											MiniAgent
										</Link>
									</DropdownMenuItem>
									<DropdownMenuItem asChild>
										<Link to="/admin/settings" className="cursor-pointer">
											<Settings className="mr-2 h-4 w-4" />
											Configuración
										</Link>
									</DropdownMenuItem>
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
					<ModeToggle />
					<UserMenu />
				</div>
			</div>
		</div>
	);
}
