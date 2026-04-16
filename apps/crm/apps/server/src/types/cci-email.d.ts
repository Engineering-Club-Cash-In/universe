/**
 * Shim de tipos para @cci/email.
 *
 * El paquete importa templates JSX (react-email) cuyo tipado choca con el tsconfig
 * del server (composite: true + strict). Este shim expone solo las funciones que
 * consumimos desde el server, sin tocar las templates. Se enlaza vía `paths` en
 * tsconfig.json para que tsc lo use en lugar del source del paquete.
 */
export function sendPlainEmail(
	to: string,
	subject: string,
	html: string,
): Promise<{
	success: boolean;
	data?: { id: string } | null;
	error?: unknown;
}>;

export function sendSimpleEmail(
	to: string,
	subject: string,
	message: string,
): Promise<{
	success: boolean;
	data?: { id: string } | null;
	error?: unknown;
}>;
