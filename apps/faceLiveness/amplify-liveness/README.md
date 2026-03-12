# Face Liveness

Frontend React + Vite para validacion de identidad con AWS Amplify Face Liveness.

## Requisitos

- `bun`
- `aws` CLI autenticado con acceso al ambiente
- Backend de Amplify existente para el ambiente que vayas a usar

## Desarrollo

```bash
bun install
bun run dev
```

## Build

```bash
bun run tsc --noEmit
bun run build
```

## Configuracion de Amplify

La configuracion de Cognito se carga desde variables `VITE_*` en [main.tsx](./src/main.tsx).

Variables requeridas:

- `VITE_AWS_COGNITO_IDENTITY_POOL_ID`
- `VITE_AWS_USER_POOLS_ID`
- `VITE_AWS_USER_POOLS_WEB_CLIENT_ID`
- `VITE_API_BASE_URL`
- `VITE_WA_SIMPLETECH`

Ejemplo de `.env`:

```dotenv
VITE_API_BASE_URL=https://crmapi.s3.devteamatcci.site
VITE_WA_SIMPLETECH=50234849518
VITE_AWS_COGNITO_IDENTITY_POOL_ID=us-east-1:6958d0e8-a59b-4930-8c97-06604eda20cb
VITE_AWS_USER_POOLS_ID=us-east-1_NdiOiRdb4
VITE_AWS_USER_POOLS_WEB_CLIENT_ID=4ti325epavn06p93r0sprc3937
```

## Obtener los valores de Amplify

La forma correcta de recuperar los valores del ambiente es usar Amplify CLI:

```bash
amplify pull --appId <AMPLIFY_APP_ID> --envName <ENV>
```

Para este repo, el ambiente visible en la configuracion versionada es:

- `appId`: `dvogtpuuv17hf`
- `envName`: `dev`
- `region`: `us-east-1`

Ejemplo:

```bash
amplify pull --appId dvogtpuuv17hf --envName dev
```

Luego toma de la salida o del archivo generado los valores de Cognito y colocalos en tu `.env`.

## Si no tienes Amplify CLI

Si no tienes `amplify` instalado pero si tienes `aws` CLI con credenciales validas, puedes recuperar los valores desde CloudFormation.

Stack raiz actual del ambiente `dev`:

```text
amplify-amplifyliveness-dev-28591
```

Stack anidado de auth actual:

```text
amplify-amplifyliveness-dev-28591-authamplifyliveness2afd28122afd2812-1FNAYM7RUZI2T
```

Comandos utiles:

```bash
aws cloudformation list-stack-resources \
  --stack-name amplify-amplifyliveness-dev-28591 \
  --region us-east-1
```

```bash
aws cloudformation describe-stacks \
  --stack-name <AUTH_NESTED_STACK_NAME_OR_ARN> \
  --region us-east-1
```

Los outputs relevantes que necesitas son:

- `IdentityPoolId`
- `UserPoolId`
- `AppClientIDWeb`
- `Region`

## Nota de mantenimiento

- Si cambias de ambiente, actualiza tu `.env` con los IDs correctos.
- Si el backend de Amplify cambia, vuelve a correr `amplify pull`.
- No dejes IDs de Cognito hardcodeados en `src/`.
