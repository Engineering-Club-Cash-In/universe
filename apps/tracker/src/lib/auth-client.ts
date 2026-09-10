import { createAuthClient } from "better-auth/react";
import { limpiarFiltroPeriodo } from "@/lib/filtro-periodo";

// Instancia de auth propia del tracker: ruta y cookie separadas de las del CRM.
// Estar autenticado aquí ya implica ser socio, porque el servidor rechaza
// cualquier otro rol en este endpoint.
export const authClient = createAuthClient({
	baseURL: import.meta.env.VITE_SERVER_URL || "http://localhost:3000",
	basePath: "/api/partner-auth",
	fetchOptions: {
		credentials: "include",
	},
});

// Limpia el período persistido antes de cerrar sesión: si dos socios
// comparten terminal en el predio, el siguiente en entrar nunca debe heredar
// el mes/año que dejó el anterior (mismo criterio que ya se usó para el
// caché de TanStack Query compartido entre socios).
export async function cerrarSesion(identificadorSocio: string | null = null) {
	limpiarFiltroPeriodo(identificadorSocio);
	await authClient.signOut();
	window.location.href = "/login";
}
