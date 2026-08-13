# Documentación transversal del monorepo

Esta carpeta guarda la documentación de **features que tocan más de una app** del
monorepo (CRM, cartera-back, portal, etc.). Es el lugar donde se define *qué* se va
a construir y *por qué*, **antes** de escribir código.

## Cuándo escribir aquí y cuándo no

| Tipo de documento | Dónde va |
| --- | --- |
| Feature que cruza dos o más apps (CRM ↔ cartera-back ↔ bot) | `docs/features/<feature>/` |
| Decisión de diseño interna de una sola app | `apps/<app>/docs/` (ej. los `RFC-00X` del CRM) |
| Instrucciones para agentes/Claude sobre cómo trabajar una app | `apps/<app>/CLAUDE.md` |
| Runbook de un proceso operativo (deploy, restore, cierre) | `apps/<app>/*.md` (ej. `DEPLOY_DEV.md`) |

> `.gitignore` ignora `**/docs/` en todo el repo, con una excepción explícita para
> `/docs/` (esta carpeta). Si creás una carpeta `docs/` dentro de una app, git la
> va a ignorar.

## Features documentados

| Feature | Estado | Doc |
| --- | --- | --- |
| Bot de WhatsApp — Flujo de cobros | 🟡 En definición (Paso 1 definido, sin implementar) | [`features/bot-whatsapp-cobros/`](./features/bot-whatsapp-cobros/README.md) |

## Convenciones

1. **Primero se define, luego se programa.** Un paso no se implementa hasta que su
   documento tenga los contratos cerrados y las decisiones bloqueantes resueltas.
2. **Un archivo por paso o por tema.** Nada de un documento gigante que nadie
   actualiza.
3. **Las decisiones se registran, no se recuerdan.** Cada feature lleva su
   `DECISIONES.md` con las opciones que se consideraron y por qué se eligió una.
4. **Todo en español**, igual que el resto del producto de cara al cliente.
5. **Estado explícito** al inicio de cada documento: `Propuesta`, `Aprobado`,
   `En desarrollo`, `Implementado`. Si dice `Propuesta`, nada de eso existe todavía
   en el código.
