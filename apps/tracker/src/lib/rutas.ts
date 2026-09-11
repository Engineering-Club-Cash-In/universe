const RUTA_CASO =
	/^\/caso\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function rutaDeRetorno(
	redirect: string | undefined,
	origin = window.location.origin,
) {
	if (!redirect) return "/";

	try {
		const destino = new URL(redirect, origin);
		const esRutaCaso = RUTA_CASO.test(destino.pathname);
		if (
			destino.origin !== origin ||
			(destino.pathname !== "/" && !esRutaCaso)
		) {
			return "/";
		}

		return `${destino.pathname}${destino.search}${destino.hash}`;
	} catch {
		return "/";
	}
}
