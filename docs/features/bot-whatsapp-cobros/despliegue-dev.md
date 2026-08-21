# Despliegue de la API del bot (dev)

**Qué se despliega:** solo el **API del CRM** (`apps/crm/apps/server`) desde la rama
`COBROS-02`, para que SimpleTech tenga los endpoints del bot arriba mientras se desarrolla.
El front del CRM no entra: esa versión sigue viniendo del despliegue principal.

**Por qué una instancia aparte:** `COBROS-02` es una rama larga con cambios en curso. Si el
bot consumiera el CRM API principal, cualquier cosa a medias en la rama afectaría al CRM que
usa la gente, y al revés.

---

## 1. Crear el repositorio de la imagen en AWS

ECR Public vive **solo en `us-east-1`**, sin importar dónde corra después.

```bash
aws ecr-public create-repository \
  --region us-east-1 \
  --repository-name cci/crm-api-cobros \
  --catalog-data '{
    "description": "CRM API - rama COBROS-02, la que consume el bot de WhatsApp de cobros",
    "architectures": ["x86-64"],
    "operatingSystems": ["Linux"]
  }'
```

Confirmar que quedó:

```bash
aws ecr-public describe-repositories --region us-east-1 \
  --query "repositories[?repositoryName=='cci/crm-api-cobros'].repositoryUri" --output text
```

Debe devolver `public.ecr.aws/a6w8m2u2/cci/crm-api-cobros`.

> Las imágenes existentes están en `public.ecr.aws/a6w8m2u2` (`cci/crm-api`, `cci/crm-web`,
> `cartera-back-dev`…). Esta se suma con el mismo prefijo `cci/`.

### Primera imagen a mano (opcional)

Coolify necesita que exista al menos una imagen para levantar la app. Se puede empujar la
primera desde la máquina, igual que `deployServer.sh` pero con el nombre nuevo:

```bash
cd /ruta/al/universe
git checkout COBROS-02

aws ecr-public get-login-password --region us-east-1 \
  | podman login --username AWS --password-stdin public.ecr.aws

podman build -f apps/crm/apps/server/Dockerfile . -t cci/crm-api-cobros
podman tag cci/crm-api-cobros:latest public.ecr.aws/a6w8m2u2/cci/crm-api-cobros:latest
podman push public.ecr.aws/a6w8m2u2/cci/crm-api-cobros:latest
```

O dejar que el pipeline (§3) construya la primera y crear la app en Coolify después.

---

## 2. Crear la aplicación en Coolify

1. **New Resource → Docker Image** (no "Git Repository": la imagen la construye el pipeline).
2. **Image:** `public.ecr.aws/a6w8m2u2/cci/crm-api-cobros:latest`
   Registro público, no hace falta credencial.
3. **Server:** el de **dev** (`s2`), no el de producción.
4. **Puerto.** El contenedor expone `9000`, pero el proceso escucha en `process.env.PORT` y
   cae a `3000` si no está. Con poner `PORT=9000` en las variables (§ siguiente) queda
   coherente con el `EXPOSE` del Dockerfile.
   - Ports Exposes: `9000`
5. **Dominio:** por ejemplo `https://crmapi-cobros.s2.devteamatcci.site`. Es la URL que se le
   entrega a SimpleTech.
6. **Variables de entorno.** Partir de las del CRM API de dev y ajustar:

   | Variable | Valor | Nota |
   | --- | --- | --- |
   | `PORT` | `9000` | Para que coincida con el `EXPOSE` |
   | `DATABASE_URL` | la de **green-tree** | Es la base donde están los datos de prueba |
   | `BOT_COBROS_API_KEY` | una llave nueva | La que se le entrega a SimpleTech. Generar con `openssl rand -hex 32` |
   | `DISABLE_SCHEDULED_JOBS` | — | Ya no hace falta: en esta rama los jobs están apagados en el código. Ver la advertencia de abajo |
   | `TEST_MESSAGE` | `false` | Para que cada quien reciba su propio código |
   | `BOT_COBROS_OTP_SIMULADO` | `true` | **Necesaria hoy.** El SMS no sale: la IP de esta instancia no está en la whitelist del proveedor. Con esto el código es siempre `4321`. Ver abajo |
   | `BOT_COBROS_DOCS` | `true` | Publica el Swagger en `/api/bot/cobros/docs`. **Solo acá**: en el CRM de producción corre el mismo binario y no hay razón para publicarlo |
   | `BOT_COBROS_DOMINIOS_IMAGEN` | el dominio del CDN de SimpleTech | **Obligatoria para el pago con boleta.** Ver abajo |
   | `GOOGLE_GENERATIVE_AI_API_KEY` | la del CRM de dev | Gemini es quien lee la boleta |
   | `SMS_TOKEN`, `SMS_API_KEY` | las de siempre | Para cuando se apague la de arriba |
   | `CORS_ORIGIN` | el dominio de dev | |

   El resto (R2, Infornet, SimpleTech, Google, etc.) se copian del CRM API de dev: el binario
   es el mismo y las lee al arrancar.

7. **Health check:** `GET /` devuelve `OK`.
8. **Deploy.**
9. Copiar el **webhook de redeploy** (Coolify → la app → Webhooks) y guardarlo en GitHub como
   secret `COOLIFY_WEBHOOK_CRM_API_COBROS`. El secret `COOLIFY_TOKEN` ya existe en el repo.

### Sin `BOT_COBROS_DOMINIOS_IMAGEN` el bot no lee ni una boleta

La descarga de la imagen **falla cerrada** ([D-29](./DECISIONES.md#d-29--la-imagen-se-descarga-con-allowlist)):
si la variable viene vacía, la allowlist queda vacía y `POST /boleta/leer` responde
`URL_NO_PERMITIDA` a **todas** las URLs, incluidas las buenas. Es a propósito —una allowlist
que se ignora cuando nadie la configuró no es una allowlist—, pero significa que desplegar
sin esta variable deja el paso 4 muerto y con un error que suena a culpa de SimpleTech.

Va el **host del CDN desde donde SimpleTech sirve las fotos**, sin `https://` ni ruta, varios
separados por coma. Se lo pedimos a ellos: es el mismo dominio de la `imagenUrl` que mandan en
el request. Los subdominios se aceptan solos (poner `simpletech.gt` cubre `cdn.simpletech.gt`).

```
BOT_COBROS_DOMINIOS_IMAGEN=cdn.simpletech.gt
```

Para verificar que quedó bien, mandar un `/boleta/leer` con una `imagenUrl` real: si contesta
`URL_NO_PERMITIDA`, el dominio no está en la lista. En los logs del arranque no se ve nada,
porque la variable se lee en cada descarga y no al levantar.

### 🚨 Las tareas programadas están apagadas EN EL CÓDIGO

El binario del CRM levanta **tareas programadas que le escriben a los clientes**:
`sendPremoraReminders` corre a los **15 segundos** del arranque y `sendConvenioReminders` a
los **20 segundos**, además de los recordatorios diarios.

Como esta instancia apunta a una **copia de producción** y va con `TEST_MESSAGE=false`, sin
protección **le mandaría recordatorios de pago reales a clientes reales en cada despliegue**.

En esta rama la protección **no depende de una variable de entorno**: en `index.ts` hay un
`const TAREAS_PROGRAMADAS_ACTIVAS = false` fijo. Depender de que la env quedara bien puesta
en el ambiente era demasiado frágil para lo que está en juego. Al arrancar lo avisa:

```
[Jobs] ⚠️  Tareas programadas DESACTIVADAS en el código (rama COBROS-02): esta instancia
levanta solo la API. Si ves esto en el CRM principal, el FIXME de index.ts llegó a producción.
```

**Antes de mergear esta rama a `develop` hay que revertirlo.** Si se mergea así, el CRM de
producción se queda **sin ninguna tarea programada** —premora, convenios, alertas de cobros,
sincronización de promesas, cierre diario— y no se nota al desplegar: se nota cuando los
clientes dejan de recibir sus recordatorios. El `FIXME(COBROS-02)` en `index.ts` marca la
línea exacta.

Los jobs los sigue corriendo la instancia principal del CRM, que es la que debe hacerlo.

### 📖 La documentación de la API se publica acá (`BOT_COBROS_DOCS=true`)

`https://<dominio>/api/bot/cobros/docs` — Swagger UI con los endpoints del bot, sus ejemplos
y sus errores. Es lo que se le pasa a SimpleTech en vez del PDF: se actualiza en cada
despliegue y desde ahí pueden **ejecutar** las llamadas con el botón Authorize.

El documento crudo está en `/api/bot/cobros/openapi.json`, para importarlo en Postman.

Las dos rutas van sin API key (no exponen datos, y pedirla impediría que la UI cargara el
documento), pero **solo responden con la env prendida**. Sin ella dan 404, que es lo que se
quiere en producción.

> 🔒 Cada cambio en los endpoints tiene que ir también al Swagger. Lo cuida
> `lib/bot-cobros/openapi.test.ts`, que el pipeline corre **antes** de construir la imagen:
> si un error o una ruta no está documentada, no despliega.

### ⏳ El OTP va en modo simulado (`BOT_COBROS_OTP_SIMULADO=true`)

El proveedor de SMS solo acepta peticiones desde **IPs que estén en su whitelist**, y la de
esta instancia no está: la petición se queda colgada hasta el timeout de 60 s y el flujo
nunca pasa del servicio 1. No es del bot ni del binario — es un trámite pendiente con el
proveedor. (Los timeouts que el CRM registra desde abril son lo mismo: salieron desde IPs no
habilitadas.)

> 📌 **Cuando se pida la habilitación**, hay que darle al proveedor la IP de salida de este
> servidor de Coolify, no la del CRM de producción: son máquinas distintas.

Con esta variable en `true`, el código se guarda igual (mismo vencimiento, mismos límites,
mismos 3 intentos) pero **no se llama al proveedor** y el código es siempre **`4321`**, para
cualquier cliente. Así se prueba el flujo completo como si el SMS hubiera llegado.
Ver [D-21](./DECISIONES.md#d-21--modo-simulado-mientras-el-sms-no-sale).

> 🚨 Esta variable es **solo para esta instancia**. Prendida, el OTP no protege nada: con la
> API key se pueden ver los datos de crédito de cualquier persona de la base. En producción
> **nunca**. Cuando el proveedor habilite la IP se apaga —el código vuelve a ser aleatorio— y
> después se borra el código que la lee.

---

## 3. El pipeline

`.github/workflows/deploy-crm-api-cobros.yaml`, modelado sobre `deploy-cartera-dev.yaml` y
sobre lo que hacen `apps/crm/apps/server/deployServer.sh` y `apps/cartera-back/deploy-dev.sh`
a mano. Despliega **dos apps**, cada una a su instancia de Coolify:

| App | Imagen | Secret del webhook |
| --- | --- | --- |
| CRM API (la que consume SimpleTech) | `cci/crm-api-cobros` | `COOLIFY_WEBHOOK_CRM_API_COBROS` |
| cartera-back (contra el schema `cartera_cobros2`) | `cci/cartera-api-cobros` | `COOLIFY_WEBHOOK_CARTERA_API_COBROS` |

| | |
| --- | --- |
| **Cuándo corre** | Push a `COBROS-02` que toque cualquiera de las dos apps. También a mano desde Actions |
| **Qué hace** | CRM API: revisa tipos y corre las pruebas del bot → construye → empuja → redeploy. cartera-back: construye → smoke test de Puppeteer dentro de la imagen → empuja → redeploy |
| **Secrets** | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `COOLIFY_TOKEN` y los dos webhooks de la tabla de arriba |

**Cada app se construye solo si su código cambió.** Un job `cambios`
(`dorny/paths-filter`) mira qué tocó el push y los demás se saltan solos; en `workflow_dispatch`
se construyen las dos, que para eso sirve el disparo manual. Antes se reconstruían siempre
ambas, así que un commit que solo tocaba cartera reiniciaba también el CRM API mientras
SimpleTech lo estaba probando.

El filtro compara contra el **commit anterior de `COBROS-02`**, no contra `main`: la rama
lleva meses de trabajo aparte y contra `main` todo push saldría como que cambió todo.

El tag con el SHA permite volver atrás sin reconstruir: en Coolify se cambia la imagen a
`…/<imagen>:<sha>` y se redespliega.

La concurrencia va **por app** (`deploy-cobros02-crm` / `deploy-cobros02-cartera`): un push
nuevo cancela el run anterior *de esa misma app*, incluida su verificación, pero no toca el
deploy de la otra. Dentro de una app tiene que cubrir también la verificación: si el grupo
estuviera solo en el job que publica, un run viejo que todavía verifica no se cancelaría y,
al terminar —después de que el nuevo ya desplegó—, publicaría su imagen encima y dejaría
`latest` en un commit anterior.

La verificación de tipos y pruebas va **antes** de publicar a propósito: esta API la consume
un tercero y una imagen rota se nota del lado de ellos.

---

## 4. Migraciones antes de la primera prueba

Las corre el usuario, sobre **green-tree**:

| Migración | Qué hace |
| --- | --- |
| `0033_bot_cobros_otp_codeudor.sql` | ✅ aplicada |
| `0034_bot_cobros_otp_sin_dpi.sql` | `dpi` nullable — sin esto, el 18% de clientes sin DPI no puede recibir código |
| `0035_bot_cobros_otp_origen.sql` | columna `origen` — **sin esto los servicios no validan ningún código** |
| `0037_bot_cobros_boletas.sql` | tablas `bot_cobros_boletas` y compañía — **sin esto `/boleta/leer` revienta con `relation does not exist` en la primera consulta** (paso 4, capa A) |
| `0038_bot_cobros_aviso_reclamado.sql` | el reclamo del aviso de rechazo (paso 4, capa C — D-39); aditiva, sin backfill |

En cartera no hay migraciones que correr: se toca solo con endpoints nuevos de lectura (D-38).

Y los datos de prueba: `apps/crm/apps/server/src/db/seeds/bot-cobros-pruebas.sql`
(ver [`pruebas-equipo-it.md`](./pruebas-equipo-it.md)).

---

## 5. Comprobar que quedó bien

```bash
# 1. Responde
curl -s https://crmapi-cobros.s2.devteamatcci.site/

# 2. Sin llave, rechaza
curl -s -X POST https://crmapi-cobros.s2.devteamatcci.site/api/bot/cobros/buscar-cliente \
  -H 'Content-Type: application/json' \
  -d '{"search":"P-901BOT","telefono":"50257099747"}'
# → 401 NO_AUTORIZADO

# 3. Con llave, encuentra al cliente de prueba y genera el código
curl -s -X POST https://crmapi-cobros.s2.devteamatcci.site/api/bot/cobros/buscar-cliente \
  -H "Authorization: Bearer $BOT_COBROS_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"search":"P-901BOT","telefono":"50257099747"}'
# → debe responder en ~2 s con "otpSimulado": true y una "referencia"
# Si tarda 60 s y devuelve OTP_NO_ENVIADO, falta BOT_COBROS_OTP_SIMULADO=true

# 4. Los créditos, con la referencia del paso anterior y el código fijo
curl -s -X POST https://crmapi-cobros.s2.devteamatcci.site/api/bot/cobros/creditos \
  -H "Authorization: Bearer $BOT_COBROS_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"referencia":"LA-REFERENCIA","otp":"4321"}'
```

En los logs de Coolify debe aparecer la línea de las tareas programadas desactivadas y
**ninguna** de los jobs de recordatorios.
