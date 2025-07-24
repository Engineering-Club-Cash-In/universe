import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { authClient } from "@/lib/auth-client";
import { orpc } from "@/utils/orpc";

import { ModeToggle } from "./mode-toggle";
import {
	NavigationMenu,
	NavigationMenuContent,
	NavigationMenuItem,
	NavigationMenuLink,
	NavigationMenuList,
	NavigationMenuTrigger,
} from "./ui/navigation-menu";
import UserMenu from "./user-menu";

export default function Header() {
	const { data: session } = authClient.useSession();
	const userProfile = useQuery({
		...orpc.getUserProfile.queryOptions(),
		enabled: !!session,
	});

	const userRole = userProfile.data?.role;

	return (
		<div className="border-b">
			<div className="flex h-16 items-center px-6">
				<div className="flex items-center space-x-6">
					<div className="font-bold text-xl">
						<Link to="/" className="hover:text-primary">
							Club Cash In CRM
						</Link>
					</div>

					<NavigationMenu>
						<NavigationMenuList>
							{!session && (
								<NavigationMenuItem>
									<Link to="/">
										<NavigationMenuLink className="group inline-flex h-9 w-max items-center justify-center rounded-md bg-background px-4 py-2 font-medium text-sm transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground focus:outline-none disabled:pointer-events-none disabled:opacity-50">
											Inicio
										</NavigationMenuLink>
									</Link>
								</NavigationMenuItem>
							)}

							{session && (
								<NavigationMenuItem>
									<Link to="/dashboard">
										<NavigationMenuLink className="group inline-flex h-9 w-max items-center justify-center rounded-md bg-background px-4 py-2 font-medium text-sm transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground focus:outline-none disabled:pointer-events-none disabled:opacity-50">
											Tablero
										</NavigationMenuLink>
									</Link>
								</NavigationMenuItem>
							)}

							{/* CRM Navigation for both admin and sales */}
							{session && userRole && ["admin", "sales"].includes(userRole) && (
								<>
									<NavigationMenuItem>
										<Link to="/crm/leads">
											<NavigationMenuLink className="group inline-flex h-9 w-max items-center justify-center rounded-md bg-background px-4 py-2 font-medium text-sm transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground focus:outline-none disabled:pointer-events-none disabled:opacity-50">
												Prospectos
											</NavigationMenuLink>
										</Link>
									</NavigationMenuItem>
									<NavigationMenuItem>
										<Link to="/crm/opportunities">
											<NavigationMenuLink className="group inline-flex h-9 w-max items-center justify-center rounded-md bg-background px-4 py-2 font-medium text-sm transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground focus:outline-none disabled:pointer-events-none disabled:opacity-50">
												Oportunidades
											</NavigationMenuLink>
										</Link>
									</NavigationMenuItem>
									<NavigationMenuItem>
										<Link to="/crm/clients">
											<NavigationMenuLink className="group inline-flex h-9 w-max items-center justify-center rounded-md bg-background px-4 py-2 font-medium text-sm transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground focus:outline-none disabled:pointer-events-none disabled:opacity-50">
												Clientes
											</NavigationMenuLink>
										</Link>
									</NavigationMenuItem>
									<NavigationMenuItem>
										<Link to="/crm/companies">
											<NavigationMenuLink className="group inline-flex h-9 w-max items-center justify-center rounded-md bg-background px-4 py-2 font-medium text-sm transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground focus:outline-none disabled:pointer-events-none disabled:opacity-50">
												Empresas
											</NavigationMenuLink>
										</Link>
									</NavigationMenuItem>
								</>
							)}

							{/* Analyst Navigation */}
							{session && userRole && ["admin", "analyst"].includes(userRole) && (
								<NavigationMenuItem>
									<Link to="/crm/analysis">
										<NavigationMenuLink className="group inline-flex h-9 w-max items-center justify-center rounded-md bg-background px-4 py-2 font-medium text-sm transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground focus:outline-none disabled:pointer-events-none disabled:opacity-50">
											Análisis
										</NavigationMenuLink>
									</Link>
								</NavigationMenuItem>
							)}

							{session && userRole === "admin" && (
								<>
									<NavigationMenuItem>
										<Link to="/admin/users">
											<NavigationMenuLink className="group inline-flex h-9 w-max items-center justify-center rounded-md bg-background px-4 py-2 font-medium text-sm transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground focus:outline-none disabled:pointer-events-none disabled:opacity-50">
												Usuarios
											</NavigationMenuLink>
										</Link>
									</NavigationMenuItem>
									<NavigationMenuItem>
										<Link to="/admin/settings">
											<NavigationMenuLink className="group inline-flex h-9 w-max items-center justify-center rounded-md bg-background px-4 py-2 font-medium text-sm transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground focus:outline-none disabled:pointer-events-none disabled:opacity-50">
												Configuración
											</NavigationMenuLink>
										</Link>
									</NavigationMenuItem>
									<NavigationMenuItem>
										<Link to="/admin/reports">
											<NavigationMenuLink className="group inline-flex h-9 w-max items-center justify-center rounded-md bg-background px-4 py-2 font-medium text-sm transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground focus:outline-none disabled:pointer-events-none disabled:opacity-50">
												Reportes
											</NavigationMenuLink>
										</Link>
									</NavigationMenuItem>
								</>
							)}
						</NavigationMenuList>
					</NavigationMenu>
				</div>

				<div className="ml-auto flex items-center space-x-4">
					<ModeToggle />
					<UserMenu />
				</div>
			</div>
		</div>
	);
}
