import { orpc } from "@/utils/orpc";

// Una sola definición de la consulta de mi perfil: el menú del avatar y la
// página de perfil comparten la misma key de caché y deben compartir opciones.
// Un socio sin agencias activas recibe 403: cada pantalla muestra su propio
// aviso, así que no se repite el toast ni se reintenta cada minuto.
export const opcionesMiPerfil = () => ({
	...orpc.getMiPerfil.queryOptions({ input: {} }),
	refetchInterval: false as const,
	meta: { sinAvisoDeAcceso: true },
});
