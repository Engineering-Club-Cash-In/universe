/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL: string;
  readonly VITE_WA_SIMPLETECH?: string;
  readonly VITE_AWS_COGNITO_IDENTITY_POOL_ID: string;
  readonly VITE_AWS_USER_POOLS_ID: string;
  readonly VITE_AWS_USER_POOLS_WEB_CLIENT_ID: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
