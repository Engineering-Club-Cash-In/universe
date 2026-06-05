# Deploy de Cartera a DEV / Staging

Guía para desplegar **cartera-back** y **cartera-front** al ambiente de **desarrollo** (Coolify).

> El ambiente de dev se despliega con **imágenes Docker** que subimos manualmente a
> **AWS ECR Public**. Coolify **no buildea desde Git**: solo jala la imagen ya publicada.
> Por eso, cada cambio que quieras ver en dev requiere **re-build + re-push + redeploy**.

---

## Arquitectura del deploy

```
Tu máquina                         AWS ECR Public                Coolify (dev)
-----------                        ---------------               -------------
podman build  ──►  podman push ──► public.ecr.aws/a6w8m2u2/...  ──► pull imagen ──► contenedor
```

- Registry (ECR Public): `public.ecr.aws/a6w8m2u2`
- Repos de dev:
  - Back:  `public.ecr.aws/a6w8m2u2/cartera-back-dev`
  - Front: `public.ecr.aws/a6w8m2u2/cartera-front-dev`

---

## Requisitos previos (una sola vez)

1. Tener **AWS CLI** y **podman** instalados.
2. Estar autenticado contra el registry (el token vence, si falla el push repetí esto):

```bash
aws ecr-public get-login-password --region us-east-1 \
  | podman login --username AWS --password-stdin public.ecr.aws
```

> ECR Public **solo existe en `us-east-1`** y el servicio en el CLI es `ecr-public`.

### Crear un repo nuevo (solo si no existe)

```bash
aws ecr-public create-repository \
  --repository-name NOMBRE-DEL-REPO \
  --region us-east-1
```

El campo `repository.repositoryUri` de la respuesta es la URL de la imagen.

---

## Desplegar el BACK (cartera-back)

Desde `apps/cartera-back`:

```bash
bun run push:dev
```

Esto corre `deploy-dev.sh`, que hace:

```bash
podman build -f Dockerfile -t cartera-back-dev ../..
podman tag cartera-back-dev:latest public.ecr.aws/a6w8m2u2/cartera-back-dev:latest
podman push public.ecr.aws/a6w8m2u2/cartera-back-dev:latest
```

Luego, en Coolify → servicio **cartera-back-dev** → **Redeploy**.

### ⚠️ Variables de entorno en Coolify (back)

Como es un deploy de imagen (sin Git), Coolify **no tiene el `.env`**. Hay que cargar las
variables a mano en **Environment Variables** del servicio. Puntos críticos:

- **`PORT=9000`** — El `Dockerfile` expone el `9000`, pero la app escucha en `PORT || 7000`
  (ver `src/config/index.ts`). Si no seteás `PORT=9000`, Coolify hace proxy al 9000, no hay
  nada escuchando ahí y te da **Bad Gateway**.
- **Conexión a Postgres** — Usar el connection string de la **DB de dev** (branch de Supabase
  o DB aislada), **nunca** la de producción.
- Resto de variables del `.env` (credenciales de servicios externos, etc.).

---

## Desplegar el FRONT (cartera-front)

Desde `apps/carteraFront`:

```bash
bun run push:dev
```

Esto corre `deploy-dev.sh`, que hace:

```bash
podman build \
  --build-arg VITE_BACK_URL=https://js4cock4o0k04g4cogckw0cc.s2.devteamatcci.site \
  -t cartera-front-dev .
podman tag cartera-front-dev:latest public.ecr.aws/a6w8m2u2/cartera-front-dev:latest
podman push public.ecr.aws/a6w8m2u2/cartera-front-dev:latest
```

Luego, en Coolify → servicio **cartera-front-dev** → **Redeploy**.

### ⚠️ La URL del back se hornea en build time (front)

El front es **Vite**: la variable `VITE_BACK_URL` queda **incrustada en el build**. No se puede
cambiar desde Coolify en runtime. Si necesitás apuntar el front a otro back, hay que cambiar el
`--build-arg VITE_BACK_URL=...` en `deploy-dev.sh` y **re-buildear + re-pushear**.

- `deploy.sh` (prod) → usa el default del `Dockerfile`.
- `deploy-dev.sh` (dev) → fuerza la URL del back de dev.

---

## URLs de DEV

| Servicio | URL |
|----------|-----|
| Back  | https://js4cock4o0k04g4cogckw0cc.s2.devteamatcci.site |
| Front | _(completar con la URL que da Coolify)_ |

---

## Base de datos de DEV

Para que dev **no toque los datos de producción**, usar una DB aislada (branch de Supabase u
otra DB). El connection string de esa DB va en las env del **cartera-back-dev** en Coolify.

> Nota: un branch de Supabase replica el **schema** vía migraciones, **no los datos**. Si el
> proyecto no tiene migraciones registradas, el branch sale prácticamente vacío. Para una copia
> real de prod conviene `pg_dump`/`psql` (schema, y datos si se requiere).

---

## Checklist rápido para desplegar a dev

- [ ] `podman login` a ECR Public vigente
- [ ] `bun run push:dev` en el/los servicio(s) que cambiaron
- [ ] Variables de entorno cargadas en Coolify (back: incluir `PORT=9000` y DB de dev)
- [ ] **Redeploy** en Coolify
- [ ] Verificar la URL de dev
