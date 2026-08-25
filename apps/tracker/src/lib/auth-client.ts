import { createAuthClient } from "better-auth/react";

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

export async function cerrarSesion() {
	await authClient.signOut();
	window.location.href = "/login";
}
