import { describe, expect, test } from "bun:test";
import { formatearTamanoArchivo } from "./tamano-archivo";

describe("formatearTamanoArchivo", () => {
	test("bytes, KB o MB según el tamaño", () => {
		expect(formatearTamanoArchivo(850)).toBe("850 B");
		expect(formatearTamanoArchivo(2048)).toBe("2 KB");
		expect(formatearTamanoArchivo(512 * 1024)).toBe("512 KB");
		expect(formatearTamanoArchivo(3.4 * 1024 * 1024)).toBe("3.4 MB");
	});
});
