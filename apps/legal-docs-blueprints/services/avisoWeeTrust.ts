/**
 * Lo que trae un aviso (webhook) de WeeTrust: qué pasó y en qué documento.
 *
 * WeeTrust manda `{ type, Document: { documentID, ... }, addedOn }`, con
 * `Document` en mayúscula (developer.weetrust.mx, "Guía rápida" de webhooks).
 * El receptor leía `document` en minúscula o `documentID` suelto, así que el
 * aviso real llegaba sin documento y se rechazaba. Se aceptan las tres formas.
 *
 * El cuerpo puede llegar como texto si WeeTrust no manda `Content-Type: json`.
 */
export function leerAvisoDeWeeTrust(body: unknown): {
	tipo: string;
	documentID: string | undefined;
	claves: string[];
} {
	let payload: unknown = body;
	if (typeof payload === "string") {
		try {
			payload = JSON.parse(payload);
		} catch {
			payload = {};
		}
	}
	const p = (payload && typeof payload === "object" ? payload : {}) as Record<
		string,
		unknown
	>;

	const documento = (p.Document ?? p.document) as
		| Record<string, unknown>
		| undefined;
	const documentID = [p.documentID, documento?.documentID, documento?._id].find(
		(v): v is string => typeof v === "string" && v.length > 0,
	);
	const tipo = [p.type, p.event].find(
		(v): v is string => typeof v === "string" && v.length > 0,
	);

	return { tipo: tipo ?? "unknown", documentID, claves: Object.keys(p) };
}
