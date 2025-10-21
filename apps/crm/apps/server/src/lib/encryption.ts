import crypto from "node:crypto";

// Clave de cifrado (debe estar en .env en producción)
const ENCRYPTION_KEY =
	process.env.ENCRYPTION_KEY || "default-key-change-in-production-32b";
const ALGORITHM = "aes-256-gcm";

/**
 * Cifra un texto usando AES-256-GCM
 */
export function encrypt(text: string): string {
	// Asegurar que la clave tenga 32 bytes
	const key = Buffer.from(ENCRYPTION_KEY.padEnd(32, "0").slice(0, 32));

	// IV aleatorio de 16 bytes
	const iv = crypto.randomBytes(16);

	// Crear cipher
	const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

	// Cifrar
	let encrypted = cipher.update(text, "utf8", "hex");
	encrypted += cipher.final("hex");

	// Obtener auth tag
	const authTag = cipher.getAuthTag();

	// Retornar: iv:authTag:encrypted
	return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted}`;
}

/**
 * Descifra un texto cifrado con encrypt()
 */
export function decrypt(encryptedData: string): string {
	// Asegurar que la clave tenga 32 bytes
	const key = Buffer.from(ENCRYPTION_KEY.padEnd(32, "0").slice(0, 32));

	// Separar iv, authTag y encrypted
	const parts = encryptedData.split(":");
	if (parts.length !== 3) {
		throw new Error("Formato de datos cifrados inválido");
	}

	const iv = Buffer.from(parts[0], "hex");
	const authTag = Buffer.from(parts[1], "hex");
	const encrypted = parts[2];

	// Crear decipher
	const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
	decipher.setAuthTag(authTag);

	// Descifrar
	let decrypted = decipher.update(encrypted, "hex", "utf8");
	decrypted += decipher.final("utf8");

	return decrypted;
}
