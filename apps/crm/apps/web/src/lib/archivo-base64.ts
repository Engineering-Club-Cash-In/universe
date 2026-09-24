/**
 * Lee un archivo del navegador como base64, sin el prefijo `data:...;base64,`.
 *
 * Es lo que esperan los endpoints que mandan un PDF al generador: el JSON viaja
 * con el archivo adentro, así que no hay multipart ni URL prefirmada de por
 * medio.
 */
export function leerBase64(file: File): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onerror = () => reject(new Error("No se pudo leer el archivo"));
		reader.onload = () => {
			const resultado = String(reader.result);
			resolve(resultado.slice(resultado.indexOf(",") + 1));
		};
		reader.readAsDataURL(file);
	});
}
