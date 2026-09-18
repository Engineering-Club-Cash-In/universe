/** Prueba el login de Agencia Virtual SAT y la lectura del menú. */
import "dotenv/config";
import { writeFileSync } from "node:fs";
import {
	conNavegador,
	explorarMenu,
	iniciarSesion,
	SatRequiereCodigoError,
} from "../controllers/satVehiculos";

const usuario = process.env.SAT_AV_USUARIO;
const password = process.env.SAT_AV_PASSWORD;

if (!usuario || !password) {
	console.error("Faltan SAT_AV_USUARIO y/o SAT_AV_PASSWORD en .env");
	process.exit(1);
}

await conNavegador(async (page) => {
	try {
		const url = await iniciarSesion(page, { usuario, password });
		console.log("Login OK ->", url);
	} catch (error) {
		await page.screenshot({ path: "sat-login-error.png" });
		if (error instanceof SatRequiereCodigoError) {
			console.error("SAT pidió código de verificación. Captura: sat-login-error.png");
		} else {
			console.error(
				"Login falló:",
				error instanceof Error ? error.message : String(error),
				"| Captura: sat-login-error.png",
			);
		}
		process.exit(1);
	}

	await page.screenshot({ path: "sat-portada.png" });
	const enlaces = await explorarMenu(page);
	writeFileSync("sat-menu.json", JSON.stringify(enlaces, null, 2), "utf-8");
	console.log(JSON.stringify(enlaces.filter((enlace) => /veh[ií]culo/i.test(enlace.texto)), null, 2));
});
