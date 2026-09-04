/**
 * Extrae el listado de Vehículos Propios de Agencia Virtual.
 * Uso: bun scripts/sat-vehiculos-listar.ts
 * Requiere SAT_AV_USUARIO y SAT_AV_PASSWORD en .env
 */
import { writeFileSync } from "node:fs";
import {
  conNavegador,
  iniciarSesion,
  irAVehiculosPropios,
  leerTablaVehiculos,
  SatRequiereCodigoError,
  verTodosLosVehiculos,
} from "../src/controllers/satVehiculos";

const usuario = process.env.SAT_AV_USUARIO;
const password = process.env.SAT_AV_PASSWORD;

if (!usuario || !password) {
  console.error("Faltan SAT_AV_USUARIO y/o SAT_AV_PASSWORD en .env");
  process.exit(1);
}

await conNavegador(async (page) => {
  try {
    await iniciarSesion(page, { usuario, password });
    console.log("1. Login OK");

    const listado = await irAVehiculosPropios(page);
    console.log("2. Navegación OK ->", listado.url());

    const pidioTodos = await verTodosLosVehiculos(listado);
    console.log(`3. "Ver todos mis vehiculos": ${pidioTodos ? "clic OK" : "no encontrado"}`);

    const vehiculos = await leerTablaVehiculos(listado);
    console.log(`4. Vehículos leídos: ${vehiculos.length}\n`);
    console.log(JSON.stringify(vehiculos, null, 2));

    writeFileSync("sat-vehiculos.json", JSON.stringify(vehiculos, null, 2), "utf-8");
    await page.screenshot({ path: "sat-listado-final.png" });
  } catch (error) {
    await page.screenshot({ path: "sat-error.png" });
    writeFileSync("sat-error.html", await page.content(), "utf-8");
    if (error instanceof SatRequiereCodigoError) {
      console.error("SAT pidió código de verificación.");
    } else {
      console.error("Falló:", error instanceof Error ? error.message : String(error));
    }
    console.error("Diagnóstico: sat-error.png / sat-error.html");
    process.exit(1);
  }
});
