// controllers/leadsController.ts
import fs from "fs";

// 👉 Hardcoded path to the CSV file (Windows requires double backslashes)
const CSV_PATH =
	"C:\\Users\\Kelvin Palacios\\Documents\\analis de datos\\Leads\\leadsFacebook.csv";

// 👉 External service endpoint (Landbot API)
const LANDOBT_URL =
	"https://crmeasysale.com/cashin/api/landbot?utm_medium=botv2";

/**
 * Clean phone by removing prefix "p:" and spaces
 * @param phone Raw phone number from CSV
 * @returns Cleaned phone number string
 */
function cleanPhone(phone: string): string {
	if (!phone) return "";

	// 1. Quitar "p:" o "P:"
	let cleaned = phone.replace(/^p:/i, "");

	// 2. Eliminar todo lo que no sea número
	cleaned = cleaned.replace(/\D/g, "");

	// 3. Caso: número con prefijo 502
	if (cleaned.startsWith("502")) {
		const localPart = cleaned.slice(3).slice(-8); // últimos 8 dígitos
		return `+502 ${localPart}`;
	}

	// 4. Caso: sin prefijo → devolver los últimos 8 dígitos
	if (cleaned.length >= 8) {
		return cleaned.slice(-8);
	}

	// 5. Si no cumple, devolver vacío
	return "";
}
function readCsvUtf16(path: string): string {
	const buffer = fs.readFileSync(path);
	// ⚡ Quitar BOM si existe
	if (buffer[0] === 0xff && buffer[1] === 0xfe) {
		return buffer.slice(2).toString("utf16le");
	}
	return buffer.toString("utf16le");
}

/**
 * Clean email by trimming and forcing lowercase
 * @param email Raw email from CSV
 * @returns Cleaned email string
 */
function cleanEmail(email: string): string {
	if (!email) return "";
	return email.trim().toLowerCase();
}

/**
 * Simple CSV parser (only for clean/simple CSV without quoted values)
 * @param content Raw CSV file content
 * @returns Array of records as objects { header: value }
 */
function parseCsv(content: string): Record<string, string>[] {
	const [headerLine, ...lines] = content.split(/\r?\n/).filter(Boolean);

	// Normalizar headers y quitar la primera columna
	const headers = headerLine
		.split("\t")
		.map((h) => h.trim().toLowerCase())
		.slice(1);

	console.log("[DEBUG] Normalized headers:", headers);

	return lines.map((line, idx) => {
		// Separar valores y también quitar la primera columna
		const values = line
			.split("\t")
			.map((v) => v.trim())
			.slice(1);

		const row: Record<string, string> = {};

		headers.forEach((header, i) => {
			row[header] = values[i] || "";
		});

		console.log(`[DEBUG] Row ${idx + 1}:`, row);
		return row;
	});
}

/**
 * Process the CSV leads file and send each lead to Landbot API.
 * Logs each step for better traceability.
 */
export async function processCsvLeads() {
	console.log("[INFO] Starting CSV leads processing...");
	console.log("[INFO] Reading CSV file from:", CSV_PATH);

	// 1. Read CSV file
	const file = readCsvUtf16(CSV_PATH); //
	console.log("[INFO] File successfully read, size:", file.length, "bytes");

	// 2. Parse CSV into records
	const records = parseCsv(file);
	console.log("[INFO] Total records found:", records.length);

	// 3. Iterate through records and send them to API
	for (const [index, row] of records.entries()) {
		console.log(`\n[STEP] Processing record ${index + 1}/${records.length}`);

		const payload = {
			codigo: "AuQ4yKF9HW1k6Bk7vM7XdOJk", // 🔒 static code for Landbot
			lead_id: row["id"] || "",
			lead_name: row["nombre_completo"] || "",
			lead_email: cleanEmail(row["correo_electrónico"]),
			lead_company: row["campaign_name"] || "",
			lead_phone: cleanPhone(row["phone_number"]),
			welcome: "",
			nombre: row["nombre_completo"]?.split(" ")[0] || "",
			apellido: row["nombre_completo"]?.split(" ").slice(1).join(" ") || "",
			estados_de_cuenta: "",
			tipo_de_credito: row["tipo_de_credito"] || "",
			vehiculo_garantia: "",
			credito_monto: "",
			telefono: cleanPhone(row["phone_number"]),
		};
		console.log("[DEBUG] Payload prepared:", payload);
		console.log("[INFO] Sending lead to Landbot API...");

		try {
			const res = await fetch(LANDOBT_URL, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(payload),
			});

			const data = await res.json();
			console.log(`[SUCCESS] Lead sent (id=${row["id"]})`);
			console.log("[RESPONSE]", data);
		} catch (err: unknown) {
			console.error(
				`[ERROR] Failed to send lead (id=${row["id"]})`,
				err instanceof Error ? err.message : "Unknown error",
			);
		}
	}

	console.log("\n[INFO] CSV processing finished ✅");
	return { message: "CSV processed and leads sent" };
}
