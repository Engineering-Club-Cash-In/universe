import { Link } from "@tanstack/react-router";
import { ModeToggle } from "./mode-toggle";
import UserMenu from "./user-menu";
import { authClient } from "@/lib/auth-client";

export default function Header() {
	const { data: session } = authClient.useSession();
	
	const baseLinks = [
		{ to: "/", label: "Inicio" },
		{ to: "/dashboard", label: "Dashboard" },
	] as const;

	const adminLinks = (session?.user.role === "super_admin" || session?.user.role === "manager") ? [
		{ to: "/admin", label: "Administración" },
	] : [];

	const links = [...baseLinks, ...adminLinks];

	return (
		<div>
			<div className="flex flex-row items-center justify-between px-2 py-1">
				<nav className="flex gap-4 text-lg">
					{links.map(({ to, label }) => {
						return (
							<Link key={to} to={to}>
								{label}
							</Link>
						);
					})}
				</nav>
				<div className="flex items-center gap-2">
					<ModeToggle />
					<UserMenu />
				</div>
			</div>
			<hr />
		</div>
	);
}
