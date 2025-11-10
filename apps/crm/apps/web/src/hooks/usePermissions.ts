import { useQuery } from "@tanstack/react-query";
import { authClient } from "@/lib/auth-client";
import { PERMISSIONS } from "@/lib/roles";
import { orpc } from "@/utils/orpc";

/**
 * Hook para obtener los permisos del usuario actual en el módulo de Jurídico
 *
 * @returns Objeto con los permisos del usuario (canView, canCreate, canAssign, canDelete)
 */
export function useJuridicoPermissions() {
	const { data: session, isPending } = authClient.useSession();
	const { data: userProfile } = useQuery({
		...orpc.getUserProfile.queryOptions(),
		enabled: !!session?.user?.id,
	});

	const userRole = userProfile?.role || "";

	return {
		canViewLegal: PERMISSIONS.canAccessJuridico(userRole),
		canCreateLegal: PERMISSIONS.canCreateLegalContracts(userRole),
		canAssignLegal: PERMISSIONS.canAssignLegalContracts(userRole),
		canDeleteLegal: PERMISSIONS.canDeleteLegalContracts(userRole),
		isLoading: isPending,
		userRole,
	};
}
