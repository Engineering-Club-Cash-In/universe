import { expect, test } from "bun:test";
import { databaseSsl } from "./importCierreMoraOficial.ssl";

test("verifica el certificado TLS de bases remotas", () => {
	expect(databaseSsl("db.example.com")).toEqual({ rejectUnauthorized: true });
});

test("no exige TLS para PostgreSQL local", () => {
	expect(databaseSsl("127.0.0.1")).toBe(false);
});
