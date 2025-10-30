import axios, { AxiosInstance } from 'axios';
import { ContractType } from '../types/contract';
import { docusealConfig, type SignerConfig } from '../config/docusealConfig';
import fs from 'fs/promises';

/**
 * Interfaz para las coordenadas de un campo en el PDF
 */
export interface FieldArea {
  x: number;
  y: number;
  w: number;
  h: number;
  page: number;
}

/**
 * Interfaz para un campo de firma
 */
export interface SignatureField {
  name: string;
  type: 'signature' | 'date' | 'text';
  areas: FieldArea[];
}

/**
 * Interfaz para la respuesta de creación de template
 */
export interface DocuSealTemplateResponse {
  id: number;
  slug: string;
  name: string;
  created_at: string;
}

/**
 * Interfaz para la respuesta de creación de submission
 */
export interface DocuSealSubmissionResponse {
  id: number;
  slug: string;
  status: string;
  submitters: Array<{
    id: number;
    email: string;
    slug: string;
    url: string;
    status: string;
  }>;
}

/**
 * Servicio para integración con DocuSeal API
 */
export class DocuSealService {
  private api: AxiosInstance;
  private baseUrl: string;

  constructor(apiUrl?: string, apiToken?: string) {
    this.baseUrl = apiUrl || process.env.DOCUSEAL_API_URL || 'https://docuseal.devteamatcci.site/api';
    const token = apiToken || process.env.DOCUSEAL_API_TOKEN || '';

    this.api = axios.create({
      baseURL: this.baseUrl,
      headers: {
        'X-Auth-Token': token,
        'Content-Type': 'application/json',
      },
      timeout: 30000, // 30 segundos
    });

    console.log(`📝 DocuSeal Service inicializado con URL: ${this.baseUrl}`);
  }

  /**
   * Detecta automáticamente las posiciones de los campos de firma en el PDF
   * Por ahora, retorna posiciones predeterminadas basadas en el tipo de contrato
   * En el futuro, se puede implementar detección real usando pdf-parse o similar
   */
  async detectSignaturePositions(
    contractType: ContractType,
    pdfBuffer: Buffer,
    pageCount: number = 1
  ): Promise<SignatureField[]> {
    console.log(`🔍 Detectando posiciones de firma para: ${contractType}`);

    // Obtener configuración de firmantes para este tipo de contrato
    const signerConfig = this.getSignerConfig(contractType);

    const fields: SignatureField[] = [];

    // Generar campos de firma según la configuración
    signerConfig.signers.forEach((signer, index) => {
      // Posición vertical base (empezando desde la parte inferior)
      const baseY = 650 - (index * 120); // Separar firmas verticalmente

      // Campo de firma
      fields.push({
        name: `Firma_${signer.role}`,
        type: 'signature',
        areas: [
          {
            x: 50 + (index * 250), // Separar horizontalmente si hay múltiples firmas
            y: baseY,
            w: 200,
            h: 60,
            page: pageCount, // Última página
          },
        ],
      });

      // Campo de fecha junto a la firma
      fields.push({
        name: `Fecha_${signer.role}`,
        type: 'date',
        areas: [
          {
            x: 50 + (index * 250),
            y: baseY + 70,
            w: 150,
            h: 30,
            page: pageCount,
          },
        ],
      });
    });

    console.log(`✓ Detectados ${fields.length} campos para ${signerConfig.signers.length} firmante(s)`);

    return fields;
  }

  /**
   * Obtiene la configuración de firmantes para un tipo de contrato
   */
  private getSignerConfig(contractType: ContractType): SignerConfig {
    const config = docusealConfig[contractType];

    if (!config) {
      console.warn(`⚠ No hay configuración de firmantes para ${contractType}, usando default`);
      return {
        signerCount: 1,
        signers: [
          {
            role: 'Cliente',
            required: true,
          },
        ],
      };
    }

    return config;
  }

  /**
   * Crea un template en DocuSeal desde un buffer de PDF
   */
  async createTemplateFromPDF(
    name: string,
    pdfBuffer: Buffer,
    contractType: ContractType,
    pageCount: number = 1
  ): Promise<DocuSealTemplateResponse> {
    try {
      console.log(`📄 Creando template en DocuSeal: ${name}`);

      // Convertir PDF a base64
      const base64Pdf = pdfBuffer.toString('base64');

      // Detectar posiciones de firma
      const fields = await this.detectSignaturePositions(contractType, pdfBuffer, pageCount);

      // Preparar payload para DocuSeal
      const payload = {
        name,
        documents: [
          {
            name: `${name}.pdf`,
            file: base64Pdf,
            fields: fields.map((field) => ({
              name: field.name,
              type: field.type,
              areas: field.areas,
            })),
          },
        ],
      };

      // Crear template en DocuSeal
      const response = await this.api.post<DocuSealTemplateResponse>('/templates/pdf', payload);

      console.log(`✓ Template creado con ID: ${response.data.id}`);

      return response.data;
    } catch (error: any) {
      console.error('❌ Error creando template en DocuSeal:', error.response?.data || error.message);
      throw new Error(`Error al crear template en DocuSeal: ${error.message}`);
    }
  }

  /**
   * Crea una submission (documento para firmar) desde un template
   */
  async createSubmission(
    templateId: number,
    emails: string[],
    contractType: ContractType
  ): Promise<DocuSealSubmissionResponse> {
    try {
      console.log(`📨 Creando submission para template ${templateId}`);

      // Obtener configuración de firmantes
      const signerConfig = this.getSignerConfig(contractType);

      // Validar que el número de emails coincida con el número de firmantes
      if (emails.length !== signerConfig.signerCount) {
        throw new Error(
          `Se esperaban ${signerConfig.signerCount} email(s) pero se recibieron ${emails.length}`
        );
      }

      // Preparar submitters
      const submitters = emails.map((email, index) => ({
        email,
        role: signerConfig.signers[index]?.role || `Firmante ${index + 1}`,
        send_email: false, // No enviar emails automáticos
      }));

      // Crear submission
      const payload = {
        template_id: templateId,
        submitters,
      };

      const response = await this.api.post<DocuSealSubmissionResponse>('/submissions', payload);

      console.log(`✓ Submission creada con ID: ${response.data.id}`);

      return response.data;
    } catch (error: any) {
      console.error('❌ Error creando submission en DocuSeal:', error.response?.data || error.message);
      throw new Error(`Error al crear submission en DocuSeal: ${error.message}`);
    }
  }

  /**
   * Flujo completo: crear template y submission, retornar links de firma
   */
  async createTemplateAndSubmission(
    name: string,
    pdfBuffer: Buffer,
    contractType: ContractType,
    emails: string[],
    pageCount: number = 1
  ): Promise<string[]> {
    try {
      // 1. Crear template
      const template = await this.createTemplateFromPDF(name, pdfBuffer, contractType, pageCount);

      // 2. Crear submission
      const submission = await this.createSubmission(template.id, emails, contractType);

      // 3. Extraer URLs de firma
      const signingLinks = submission.submitters.map((submitter) => submitter.url);

      console.log(`✓ ${signingLinks.length} link(s) de firma generados`);

      return signingLinks;
    } catch (error: any) {
      console.error('❌ Error en flujo completo de DocuSeal:', error.message);
      throw error;
    }
  }

  /**
   * Verifica si el servicio DocuSeal está disponible
   */
  async checkHealth(): Promise<boolean> {
    try {
      await this.api.get('/health', { timeout: 5000 });
      return true;
    } catch (error) {
      console.error('❌ DocuSeal no está disponible');
      return false;
    }
  }
}

// Exportar instancia singleton
export const docuSealService = new DocuSealService();
