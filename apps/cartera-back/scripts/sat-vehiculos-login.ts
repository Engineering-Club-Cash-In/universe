/**
 * Prueba de login a Agencia Virtual y mapeo del menú.
 * Uso: bun scripts/sat-vehiculos-login.ts
 * Requiere SAT_AV_USUARIO y SAT_AV_PASSWORD en .env
 */
import { writeFileSync } from "node:fs";
import {
  conNavegador,
  explorarMenu,
  iniciarSesion,
  SatRequiereCodigoError,
} from "../src/controllers/satVehiculos";

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
      const mensaje = error instanceof Error ? error.message : String(error);
      console.error("Login falló:", mensaje, "| Captura: sat-login-error.png");
    }
    process.exit(1);
  }

  await page.screenshot({ path: "sat-portada.png" });

  const enlaces = await explorarMenu(page);
  writeFileSync("sat-menu.json", JSON.stringify(enlaces, null, 2), "utf-8");

  const candidatos = enlaces.filter((e) => /veh[ií]culo/i.test(e.texto));
  console.log("\n=== Opciones con 'vehículo' ===");
  console.log(JSON.stringify(candidatos, null, 2));
  console.log(`\n(${enlaces.length} elementos; menú completo en sat-menu.json)`);
});
