import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Shield, User } from "lucide-react";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { authClient } from "@/lib/auth-client";
import { getRoleColor, getRoleLabel } from "@/lib/roles";
import { orpc } from "@/utils/orpc";
import { Avatar, AvatarFallback, AvatarImage } from "./ui/avatar";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Skeleton } from "./ui/skeleton";

export default function UserMenu() {
	const { data: session, isPending } = authClient.useSession();
	const userProfile = useQuery({
		...orpc.getUserProfile.queryOptions(),
		enabled: !!session,
	});

	if (isPending) {
		return <Skeleton className="h-9 w-24" />;
	}

	if (!session) {
		return (
			<Button variant="outline" asChild>
				<Link to="/login">Iniciar Sesión</Link>
			</Button>
		);
	}

	const userRole = userProfile.data?.role;

	const getInitials = (name: string) => {
		return name
			.split(" ")
			.map((n) => n[0])
			.join("")
			.toUpperCase()
			.slice(0, 2);
	};

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button variant="outline" size="sm">
					Mi Perfil
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent className="w-72 bg-card p-4">
				<div className="flex flex-col items-center space-y-4">
					<Avatar className="h-16 w-16">
						<AvatarImage
							src={session.user.image || ""}
							alt={session.user.name || ""}
						/>
						<AvatarFallback className="font-medium text-lg">
							{getInitials(session.user.name || "U")}
						</AvatarFallback>
					</Avatar>

					<h3 className="text-center font-medium text-lg">
						{session.user.name}
					</h3>

					<p className="text-center text-muted-foreground text-sm">
						{session.user.email}
					</p>

					{userRole && (
						<Badge className={getRoleColor(userRole)}>
							{userRole === "admin" ? (
								<Shield className="mr-1 h-3 w-3" />
							) : (
								<User className="mr-1 h-3 w-3" />
							)}
							{getRoleLabel(userRole)}
						</Badge>
					)}

					<Button
						variant="outline"
						className="w-full"
						onClick={() => {
							authClient.signOut();
						}}
					>
						Cerrar Sesión
					</Button>
				</div>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
