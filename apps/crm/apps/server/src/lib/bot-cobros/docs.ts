/**
 * Página de documentación de la API del bot (Swagger UI).
 *
 * Reemplaza al PDF que se le pasaba a SimpleTech: se actualiza sola en cada
 * despliegue y permite **ejecutar** las llamadas desde el navegador con el
 * botón "Authorize", en vez de armar curls a mano.
 *
 * Por qué el HTML va acá y no con `@hono/swagger-ui`: el Dockerfile del server
 * corre `bun install` **sin lockfile**, así que cada dependencia nueva puede
 * cambiar de versión sola entre builds (ya pasó: better-auth tumbó el login del
 * CRM). Esto es el mismo HTML que genera ese paquete, sin sumar una dependencia
 * que se mueva sola. Los assets vienen del CDN con la versión **fija**.
 */

import type { Context } from "hono";
import { especificacionBotCobros } from "./openapi";

/** Versión exacta, nunca `latest`: un cambio mayor de Swagger UI no debe entrar solo. */
const SWAGGER_UI_VERSION = "5.17.14";
const CDN = `https://unpkg.com/swagger-ui-dist@${SWAGGER_UI_VERSION}`;

/**
 * ¿Se publica la documentación en esta instancia?
 *
 * Apagada por defecto. El binario del CRM es el mismo que corre en producción,
 * donde no hay razón para publicar la documentación de la API: se prende solo
 * en la instancia de dev del bot. Mismo criterio que `BOT_COBROS_OTP_SIMULADO`.
 */
export function documentacionHabilitada(): boolean {
	const valor = process.env.BOT_COBROS_DOCS;
	return valor === "true" || valor === "1";
}

/** El documento OpenAPI crudo, por si lo quieren importar en Postman o Insomnia. */
export function openapiBotCobros(c: Context) {
	if (!documentacionHabilitada()) return c.notFound();

	return c.json(especificacionBotCobros);
}

/** La página con la UI. */
export function docsBotCobros(c: Context) {
	if (!documentacionHabilitada()) return c.notFound();

	return c.html(`<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>API del bot de cobros</title>
    <link rel="stylesheet" href="${CDN}/swagger-ui.css" />
    <style>
      body { margin: 0; background: #fafafa; }
      .swagger-ui .topbar { display: none; }
    </style>
  </head>
  <body>
    <div id="swagger"></div>
    <script src="${CDN}/swagger-ui-bundle.js" crossorigin></script>
    <script>
      window.onload = () => {
        window.ui = SwaggerUIBundle({
          url: "/api/bot/cobros/openapi.json",
          dom_id: "#swagger",
          deepLinking: true,
          persistAuthorization: true,
          defaultModelsExpandDepth: -1,
          tryItOutEnabled: true,
        });
      };
    </script>
  </body>
</html>`);
}
