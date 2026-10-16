const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const RUTA_CASO = new RegExp(`^/caso/${UUID}$`, "i");
// Los usuarios usan el id de better-auth (texto alfanumérico), no un uuid.
const RUTA_USUARIO = /^\/usuarios\/[A-Za-z0-9_-]{16,64}$/;
const RUTAS_FIJAS = new Set(["/", "/perfil", "/usuarios"]);

export function rutaDeRetorno(
	redirect: string | undefined,
	origin = window.location.origin,
) {
	if (!redirect) return "/";

	try {
		const destino = new URL(redirect, origin);
		const permitida =
			RUTAS_FIJAS.has(destino.pathname) ||
			RUTA_CASO.test(destino.pathname) ||
			RUTA_USUARIO.test(destino.pathname);
		if (destino.origin !== origin || !permitida) {
			return "/";
		}

		return `${destino.pathname}${destino.search}${destino.hash}`;
	} catch {
		return "/";
	}
}
