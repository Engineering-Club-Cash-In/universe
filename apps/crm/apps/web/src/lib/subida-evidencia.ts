/**
 * Utilidades para subir evidencia (fotos, capturas) a R2 desde la ficha:
 * achicar la imagen en el navegador y ponerle un tope de tiempo a la subida.
 * Las comparten los diálogos de visitas (CB-037/038) e investigación en redes
 * sociales (CB-039).
 */

const LADO_MAXIMO_FOTO = 1600;

/**
 * Tiempo máximo de una foto. Sin tope, una subida colgada (señal mala, R2 que
 * no contesta) dejaba la visita sin poder guardarse para siempre. El PUT a R2
 * tiene su propio tope, y este cubre todo lo demás (achicar y pedir la URL).
 */
export const LIMITE_PUT_MS = 45_000;
const LIMITE_SUBIDA_MS = 100_000;

export async function conLimite<T>(tarea: () => Promise<T>): Promise<T> {
	let reloj: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			tarea(),
			new Promise<never>((_, rechazar) => {
				reloj = setTimeout(
					() => rechazar(new Error("La foto tardó demasiado en subir.")),
					LIMITE_SUBIDA_MS,
				);
			}),
		]);
	} finally {
		if (reloj) clearTimeout(reloj);
	}
}

/**
 * Achica la foto en el teléfono antes de subirla (JPEG, lado mayor 1600 px).
 * Si el navegador no puede leerla, se sube tal cual y el servidor decide.
 */
export async function comprimirFoto(archivo: File): Promise<File> {
	if (!archivo.type.startsWith("image/")) return archivo;
	try {
		const imagen = await createImageBitmap(archivo);
		const escala = Math.min(
			1,
			LADO_MAXIMO_FOTO / Math.max(imagen.width, imagen.height),
		);
		if (escala === 1 && archivo.size < 1_500_000) {
			imagen.close();
			return archivo;
		}
		const lienzo = document.createElement("canvas");
		lienzo.width = Math.round(imagen.width * escala);
		lienzo.height = Math.round(imagen.height * escala);
		const contexto = lienzo.getContext("2d");
		// JPEG no tiene transparencia: sin fondo, un PNG transparente sale negro.
		if (contexto) {
			contexto.fillStyle = "#ffffff";
			contexto.fillRect(0, 0, lienzo.width, lienzo.height);
			contexto.drawImage(imagen, 0, 0, lienzo.width, lienzo.height);
		}
		imagen.close();
		const blob = await new Promise<Blob | null>((resolve) =>
			lienzo.toBlob(resolve, "image/jpeg", 0.82),
		);
		if (!blob) return archivo;
		const base = archivo.name.replace(/\.[^.]+$/, "") || "foto";
		return new File([blob], `${base}.jpg`, { type: "image/jpeg" });
	} catch {
		return archivo;
	}
}
