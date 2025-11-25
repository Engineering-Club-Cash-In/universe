/**
 * CrmApiService - Cliente para comunicarse con el API del CRM
 *
 * Este servicio se encarga de:
 * 1. Autenticarse con la cuenta de servicio en el CRM
 * 2. Enviar los contratos generados para guardarlos en la base de datos del CRM
 * 3. Manejar errores de manera que no bloqueen la generación de documentos
 */

interface SaveContractPayload {
  dpi: string;
  contractType: string;
  contractName: string;
  signingLinks: string[];
  templateId?: number;
  apiResponse?: any;
  opportunityId?: string;
}

interface SaveContractResponse {
  success: boolean;
  data?: {
    contractId: string;
    leadId: string;
    leadName: string;
    contractType: string;
    contractName: string;
    status: string;
  };
  error?: string;
}

export class CrmApiService {
  private baseUrl: string;
  private sessionToken: string | null = null;
  private serviceAccountEmail: string;
  private serviceAccountPassword: string;

  constructor() {
    this.baseUrl = process.env.CRM_API_URL || 'http://localhost:3000';
    this.serviceAccountEmail = process.env.CRM_SERVICE_ACCOUNT_EMAIL || 'legal-docs-api@clubcashin.com';
    this.serviceAccountPassword = process.env.CRM_SERVICE_ACCOUNT_PASSWORD || '';

    if (!this.serviceAccountPassword) {
      console.warn('[CrmApiService] WARNING: CRM_SERVICE_ACCOUNT_PASSWORD no está configurado');
    }
  }

  /**
   * Autentica con la cuenta de servicio del CRM usando Better Auth
   */
  private async authenticate(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/auth/sign-in/email`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: this.serviceAccountEmail,
          password: this.serviceAccountPassword,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[CrmApiService] Error al autenticar:', response.status, errorText);
        return false;
      }

      // Better Auth devuelve las cookies automáticamente en los headers
      // Extraer el cookie de sesión
      const setCookieHeader = response.headers.get('set-cookie');
      if (setCookieHeader) {
        // Extraer el valor de better-auth.session_token
        const sessionMatch = setCookieHeader.match(/better-auth\.session_token=([^;]+)/);
        if (sessionMatch) {
          this.sessionToken = sessionMatch[1];
          console.log('[CrmApiService] Autenticación exitosa');
          return true;
        }
      }

      console.error('[CrmApiService] No se pudo extraer el session token');
      return false;

    } catch (error: any) {
      console.error('[CrmApiService] Error al autenticar:', error.message);
      return false;
    }
  }

  /**
   * Guarda un contrato en el CRM
   *
   * @param payload - Datos del contrato a guardar
   * @returns Respuesta del CRM o null si falla
   */
  async saveContract(payload: SaveContractPayload): Promise<SaveContractResponse | null> {
    try {
      // 1. Autenticar si no tenemos token
      if (!this.sessionToken) {
        const authenticated = await this.authenticate();
        if (!authenticated) {
          console.error('[CrmApiService] No se pudo autenticar con el CRM');
          return null;
        }
      }

      // 2. Enviar el contrato al CRM
      const response = await fetch(`${this.baseUrl}/api/contracts/external`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': `better-auth.session_token=${this.sessionToken}`,
        },
        body: JSON.stringify(payload),
      });

      // 3. Si falla por auth (401/403), re-autenticar e intentar de nuevo
      if (response.status === 401 || response.status === 403) {
        console.log('[CrmApiService] Token expirado, re-autenticando...');
        this.sessionToken = null;
        const authenticated = await this.authenticate();

        if (!authenticated) {
          console.error('[CrmApiService] No se pudo re-autenticar con el CRM');
          return null;
        }

        // Reintentar la petición
        const retryResponse = await fetch(`${this.baseUrl}/api/contracts/external`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Cookie': `better-auth.session_token=${this.sessionToken}`,
          },
          body: JSON.stringify(payload),
        });

        if (!retryResponse.ok) {
          const errorText = await retryResponse.text();
          console.error('[CrmApiService] Error al guardar contrato (retry):', retryResponse.status, errorText);
          return null;
        }

        return await retryResponse.json() as SaveContractResponse;
      }

      // 4. Si no es error de auth pero tampoco es exitoso
      if (!response.ok) {
        const errorText = await response.text();
        console.error('[CrmApiService] Error al guardar contrato:', response.status, errorText);
        return null;
      }

      // 5. Éxito
      const result = await response.json() as SaveContractResponse;
      console.log('[CrmApiService] Contrato guardado exitosamente:', result.data?.contractId);
      return result;

    } catch (error: any) {
      console.error('[CrmApiService] Error al guardar contrato:', error.message);
      return null;
    }
  }

  /**
   * Intenta guardar un contrato pero no lanza errores si falla
   * Útil para no bloquear la generación de documentos
   */
  async saveContractSilently(payload: SaveContractPayload): Promise<void> {
    try {
      const result = await this.saveContract(payload);
      if (result?.success) {
        console.log(`[CrmApiService] ✓ Contrato guardado en CRM para DPI: ${payload.dpi}`);
      } else {
        console.warn(`[CrmApiService] ✗ No se pudo guardar contrato en CRM para DPI: ${payload.dpi}`);
      }
    } catch (error: any) {
      console.error('[CrmApiService] Error inesperado al guardar contrato:', error.message);
    }
  }
}

// Singleton instance
export const crmApiService = new CrmApiService();
