/**
 * CB-039 · Investigación en redes sociales en la Ficha 360.
 *
 *  · `getInvestigacionesRedesCaso`  — el historial de investigaciones del caso.
 *  · `registrarInvestigacionRedes`  — una investigación nueva, con sus capturas.
 *
 * Archivo aparte de cobros.ts por TS7056 (el tipo inferido del router grande
 * ya está en el límite); se monta como router propio en index.ts.
 *
 * Autorización: la de toda la ficha (`assertAccesoCasoCobro`, que pregunta a
 * cartera quién lleva el crédito). Registrar solo en los buckets de
 * `BUCKETS_INVESTIGACION`, con el bucket leído de cartera sin cache y fallando
 * cerrado. Leer el historial no mira el bucket. Es una bitácora: no hay
 * editar ni borrar; si algo estaba mal, se registra otra entrada.
 */

import { ORPCError } from "@orpc/server";
import { desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { user } from "../db/schema/auth";
import { casosCobros } from "../db/schema/cobros";
import {
	investigacionesRedesCobros,
	investigacionesRedesCobrosEvidencias,
} from "../db/schema/investigaciones-redes-cobros";
import {
	erroresRegistroInvestigacion,
	investigacionPermitidaEnBucket,
	MIME_EVIDENCIA_INVESTIGACION,
	motivoBloqueoInvestigacion,
	type RegistrarInvestigacion,
	registrarInvestigacionSchema,
} from "../lib/investigaciones-redes-cobros";
import { cobrosProcedure } from "../lib/orpc";
import {
	buildUploadPrefix,
	getFileUrl,
	MAX_FILE_SIZE,
	verifyUploadedDocumentInR2,
} from "../lib/storage";
import { bucketActualEstricto } from "../services/visitas-cobros";
import { assertAccesoCasoCobro } from "./cobros";

type ContextoProcedure = { userId: string; userRole: string };

const TOPE_PAGINA = 100;

/** Acceso a la ficha + el SIFCO del caso (null si no tiene crédito de cartera). */
async function casoConAcceso(
	casoCobroId: string,
	context: ContextoProcedure,
): Promise<{ numeroSifco: string | null }> {
	await assertAccesoCasoCobro(casoCobroId, context.userId, context.userRole);
	const [caso] = await db
		.select({ numeroSifco: casosCobros.numeroCreditoSifco })
		.from(casosCobros)
		.where(eq(casosCobros.id, casoCobroId))
		.limit(1);
	return { numeroSifco: caso?.numeroSifco?.trim() || null };
}

/** Una investigación NUEVA exige crédito de cartera en un bucket permitido. */
async function exigirBucketDeInvestigacion(
	numeroSifco: string | null,
): Promise<number> {
	if (!numeroSifco) {
		throw new ORPCError("BAD_REQUEST", {
			message: "El caso no tiene crédito de cartera asociado.",
		});
	}
	const bucket = await bucketActualEstricto(numeroSifco);
	const bloqueo = motivoBloqueoInvestigacion(bucket);
	if (bloqueo || bucket === null) {
		throw new ORPCError("BAD_REQUEST", {
			message: bloqueo ?? "El crédito no tiene bucket.",
		});
	}
	return bucket;
}

type EvidenciaVerificada = {
	key: string;
	nombreArchivo: string;
	mimeType: string;
	tamanoBytes: number;
};

/**
 * Cada archivo tiene que existir en R2, bajo la carpeta de ESTE caso, ser de un
 * tipo permitido y no estar ya en otra investigación. La carpeta la fija la
 * URL firmada que pidió el navegador (`cobros_investigacion_evidencia` +
 * caso), así que una key de otro caso o de otro módulo no pasa.
 */
async function verificarEvidencias(
	casoCobroId: string,
	evidencias: RegistrarInvestigacion["evidencias"],
): Promise<EvidenciaVerificada[]> {
	if (evidencias.length === 0) return [];
	const prefijo = buildUploadPrefix(
		"cobros_investigacion_evidencia",
		casoCobroId,
	);
	const verificadas: EvidenciaVerificada[] = [];
	for (const e of evidencias) {
		const r = await verifyUploadedDocumentInR2({
			key: e.key,
			expectedPrefix: prefijo,
			filename: e.nombreArchivo,
			maxSizeBytes: MAX_FILE_SIZE,
		});
		if (
			!(MIME_EVIDENCIA_INVESTIGACION as readonly string[]).includes(r.mimeType)
		) {
			throw new ORPCError("BAD_REQUEST", {
				message: `«${e.nombreArchivo}» no es una captura (JPG, PNG, WebP) ni un PDF.`,
			});
		}
		verificadas.push({
			key: r.key,
			nombreArchivo: e.nombreArchivo,
			mimeType: r.mimeType,
			tamanoBytes: r.size,
		});
	}

	const usadas = await db
		.select({ key: investigacionesRedesCobrosEvidencias.r2Key })
		.from(investigacionesRedesCobrosEvidencias)
		.where(
			inArray(
				investigacionesRedesCobrosEvidencias.r2Key,
				verificadas.map((e) => e.key),
			),
		)
		.limit(1);
	if (usadas.length > 0) {
		throw new ORPCError("BAD_REQUEST", {
			message: "Uno de los archivos ya está en otra investigación.",
		});
	}
	return verificadas;
}

export const investigacionesRedesCobrosRouter = {
	getInvestigacionesRedesCaso: cobrosProcedure
		.input(
			z.object({
				casoCobroId: z.string().uuid(),
				limite: z.number().int().min(1).max(TOPE_PAGINA).default(20),
			}),
		)
		.handler(async ({ input, context }) => {
			const { numeroSifco } = await casoConAcceso(input.casoCobroId, context);

			// Una de más para saber si hay más sin contar toda la tabla.
			const filas = await db
				.select({
					id: investigacionesRedesCobros.id,
					fuente: investigacionesRedesCobros.fuente,
					fuenteOtra: investigacionesRedesCobros.fuenteOtra,
					enlacePerfil: investigacionesRedesCobros.enlacePerfil,
					resultado: investigacionesRedesCobros.resultado,
					hallazgos: investigacionesRedesCobros.hallazgos,
					fechaInvestigacion: investigacionesRedesCobros.fechaInvestigacion,
					bucketSnapshot: investigacionesRedesCobros.bucketSnapshot,
					registradaPorId: investigacionesRedesCobros.registradaPor,
					registradaPor: user.name,
					createdAt: investigacionesRedesCobros.createdAt,
				})
				.from(investigacionesRedesCobros)
				.leftJoin(user, eq(investigacionesRedesCobros.registradaPor, user.id))
				.where(eq(investigacionesRedesCobros.casoCobroId, input.casoCobroId))
				.orderBy(
					desc(investigacionesRedesCobros.fechaInvestigacion),
					desc(investigacionesRedesCobros.createdAt),
				)
				.limit(input.limite + 1);
			const hayMas = filas.length > input.limite;
			const pagina = filas.slice(0, input.limite);

			const ids = pagina.map((f) => f.id);
			const evidencias =
				ids.length > 0
					? await db
							.select({
								id: investigacionesRedesCobrosEvidencias.id,
								investigacionId:
									investigacionesRedesCobrosEvidencias.investigacionId,
								r2Key: investigacionesRedesCobrosEvidencias.r2Key,
								nombreArchivo:
									investigacionesRedesCobrosEvidencias.nombreArchivo,
								mimeType: investigacionesRedesCobrosEvidencias.mimeType,
							})
							.from(investigacionesRedesCobrosEvidencias)
							.where(
								inArray(
									investigacionesRedesCobrosEvidencias.investigacionId,
									ids,
								),
							)
					: [];
			// URL firmada por archivo: el bucket es privado (son capturas de
			// perfiles de una persona). Uno que no se pueda firmar se omite sin
			// tumbar la lista.
			const conUrl = await Promise.all(
				evidencias.map(async (e) => ({
					id: e.id,
					investigacionId: e.investigacionId,
					nombreArchivo: e.nombreArchivo,
					mimeType: e.mimeType,
					url: await getFileUrl(e.r2Key).catch(() => null),
				})),
			);

			// El botón "Registrar" se habilita con lo mismo que el servidor va a
			// aceptar. Si cartera no contesta, queda cerrado (el registro igual
			// lo vuelve a confirmar).
			let bucket: number | null = null;
			let bucketConfirmado = false;
			if (numeroSifco) {
				try {
					bucket = await bucketActualEstricto(numeroSifco);
					bucketConfirmado = true;
				} catch {
					bucketConfirmado = false;
				}
			}

			return {
				investigaciones: pagina.map((f) => ({
					...f,
					evidencias: conUrl.filter((e) => e.investigacionId === f.id),
				})),
				hayMas,
				bucket,
				permiteRegistrar:
					bucketConfirmado && investigacionPermitidaEnBucket(bucket),
				motivoBloqueo: !numeroSifco
					? "El caso no tiene crédito de cartera asociado."
					: bucketConfirmado
						? motivoBloqueoInvestigacion(bucket)
						: "No se pudo confirmar el bucket del crédito.",
			};
		}),

	registrarInvestigacionRedes: cobrosProcedure
		.input(registrarInvestigacionSchema)
		.handler(async ({ input, context }) => {
			const { numeroSifco } = await casoConAcceso(input.casoCobroId, context);

			const error = erroresRegistroInvestigacion(input);
			if (error) throw new ORPCError("BAD_REQUEST", { message: error });

			const bucket = await exigirBucketDeInvestigacion(numeroSifco);
			const evidencias = await verificarEvidencias(
				input.casoCobroId,
				input.evidencias,
			);

			const investigacionId = await db.transaction(async (tx) => {
				const [fila] = await tx
					.insert(investigacionesRedesCobros)
					.values({
						casoCobroId: input.casoCobroId,
						fuente: input.fuente,
						fuenteOtra:
							input.fuente === "otra" ? (input.fuenteOtra ?? null) : null,
						enlacePerfil: input.enlacePerfil ?? null,
						resultado: input.resultado,
						hallazgos: input.hallazgos,
						fechaInvestigacion: input.fechaInvestigacion,
						bucketSnapshot: bucket,
						registradaPor: context.userId,
					})
					.returning({ id: investigacionesRedesCobros.id });

				if (evidencias.length > 0) {
					await tx.insert(investigacionesRedesCobrosEvidencias).values(
						evidencias.map((e) => ({
							investigacionId: fila.id,
							r2Key: e.key,
							nombreArchivo: e.nombreArchivo,
							mimeType: e.mimeType,
							tamanoBytes: e.tamanoBytes,
							subidoPor: context.userId,
						})),
					);
				}
				return fila.id;
			});

			return { investigacionId, bucket };
		}),
};
