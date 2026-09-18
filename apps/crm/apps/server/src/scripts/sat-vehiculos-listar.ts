/** Extrae el listado de Vehículos Propios de Agencia Virtual SAT. */
import "dotenv/config";
import { writeFileSync } from "node:fs";
import {
	conNavegador,
	iniciarSesion,
	irAVehiculosPropios,
	leerTablaVehiculos,
	SatRequiereCodigoError,
	verTodosLosVehiculos,
} from "../controllers/satVehiculos";

const usuario = process.env.SAT_AV_USUARIO;
const password = process.env.SAT_AV_PASSWORD;

if (!usuario || !password) {
	console.error("Faltan SAT_AV_USUARIO y/o SAT_AV_PASSWORD en .env");
	process.exit(1);
}

await conNavegador(async (page) => {
	try {
		await iniciarSesion(page, { usuario, password });
		const listado = await irAVehiculosPropios(page);
		const pidioTodos = await verTodosLosVehiculos(listado);
		console.log(`\"Ver todos mis vehiculos\": ${pidioTodos ? "clic OK" : "no encontrado"}`);
		const vehiculos = await leerTablaVehiculos(listado);
		console.log(`Vehículos leídos: ${vehiculos.length}`);
		writeFileSync("sat-vehiculos.json", JSON.stringify(vehiculos, null, 2), "utf-8");
		await page.screenshot({ path: "sat-listado-final.png" });
	} catch (error) {
		await page.screenshot({ path: "sat-error.png" });
		writeFileSync("sat-error.html", await page.content(), "utf-8");
		console.error(
			error instanceof SatRequiereCodigoError
				? "SAT pidió código de verificación."
				: `Falló: ${error instanceof Error ? error.message : String(error)}`,
		);
		process.exit(1);
	}
});
