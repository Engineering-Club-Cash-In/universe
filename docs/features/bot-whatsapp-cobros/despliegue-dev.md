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
   | `DISABLE_SCHEDULED_JOBS` | `true` | **Obligatorio.** Ver la advertencia de abajo |
   | `TEST_MESSAGE` | `false` | Para que cada quien reciba su propio código |
   | `SMS_TOKEN`, `SMS_API_KEY` | las de siempre | Sin esto no sale ningún OTP |
   | `CORS_ORIGIN` | el dominio de dev | |

   El resto (R2, Infornet, SimpleTech, Google, etc.) se copian del CRM API de dev: el binario
   es el mismo y las lee al arrancar.

7. **Health check:** `GET /` devuelve `OK`.
8. **Deploy.**
9. Copiar el **webhook de redeploy** (Coolify → la app → Webhooks) y guardarlo en GitHub como
   secret `COOLIFY_WEBHOOK_CRM_API_COBROS`. El secret `COOLIFY_TOKEN` ya existe en el repo.

### ⚠️ `DISABLE_SCHEDULED_JOBS=true` no es opcional

El binario del CRM levanta **tareas programadas que le escriben a los clientes**:
`sendPremoraReminders` corre a los **15 segundos** del arranque y `sendConvenioReminders` a
los **20 segundos**, además de los recordatorios diarios.

Como esta instancia apunta a una **copia de producción** y va con `TEST_MESSAGE=false`, sin
esa bandera **le mandaría recordatorios de pago reales a clientes reales en cada
despliegue**. Con la bandera, el proceso levanta solo la API y lo deja ver en el log:

```
[Jobs] DISABLE_SCHEDULED_JOBS=true — esta instancia levanta solo la API, sin tareas programadas
```

Los jobs los sigue corriendo la instancia principal del CRM, que es la que debe hacerlo.

---

## 3. El pipeline

`.github/workflows/deploy-crm-api-cobros.yaml`, modelado sobre `deploy-cartera-dev.yaml` y
sobre lo que hace `apps/crm/apps/server/deployServer.sh` a mano.

| | |
| --- | --- |
| **Cuándo corre** | Push a `COBROS-02` que toque `apps/crm/apps/server/**` o los paquetes que usa (`sms`, `simpletech`, `infornet`, `email`). También a mano desde Actions |
| **Qué hace** | Revisa tipos y corre las pruebas del bot → construye la imagen → la empuja como `latest` y como el SHA del commit → dispara el redeploy en Coolify |
| **Secrets** | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `COOLIFY_TOKEN` (ya existen) y **`COOLIFY_WEBHOOK_CRM_API_COBROS`** (hay que crearlo) |

El tag con el SHA permite volver atrás sin reconstruir: en Coolify se cambia la imagen a
`…/cci/crm-api-cobros:<sha>` y se redespliega.

La concurrencia va **a nivel de workflow**: un push nuevo cancela el run anterior completo,
incluida la verificación. Si estuviera solo en el job que despliega, un push viejo que
todavía está verificando no se cancelaría y, al terminar —después de que el nuevo ya
desplegó—, publicaría su imagen encima y dejaría `latest` apuntando a un commit anterior.

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

# 3. Con llave, encuentra al cliente de prueba y manda el SMS
curl -s -X POST https://crmapi-cobros.s2.devteamatcci.site/api/bot/cobros/buscar-cliente \
  -H "Authorization: Bearer $BOT_COBROS_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"search":"P-901BOT","telefono":"50257099747"}'
```

En los logs de Coolify debe aparecer la línea de `DISABLE_SCHEDULED_JOBS` y **ninguna** de
los jobs de recordatorios.
