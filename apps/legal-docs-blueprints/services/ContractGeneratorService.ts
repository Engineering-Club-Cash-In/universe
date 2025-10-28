import Docxtemplater from 'docxtemplater';
import PizZip from 'pizzip';
import fs from 'fs/promises';
import path from 'path';
import axios from 'axios';
import FormData from 'form-data';
import {
  ContractType,
  ContractGenerationResponse,
  ContractGeneratorOptions,
  ContractTemplateConfig,
  AnyContractData
} from '../types/contract';

/**
 * Servicio genérico para generación de contratos desde templates DOCX
 * Soporta múltiples tipos de contratos de manera extensible
 */
export class ContractGeneratorService {
  private gotenbergUrl: string;
  private templatesDir: string;
  private outputDir: string;
  private templateRegistry: Map<ContractType, ContractTemplateConfig>;

  constructor(options: ContractGeneratorOptions = {}) {
    this.gotenbergUrl = options.gotenbergUrl || 'http://localhost:3000';
    this.templatesDir = options.templatesDir || path.join(process.cwd(), 'templates');
    this.outputDir = options.outputDir || path.join(process.cwd(), 'output');
    this.templateRegistry = new Map();

    // Inicializar registro de templates
    this.initializeTemplateRegistry();
  }

  /**
   * Registra los templates de contratos disponibles
   */
  private initializeTemplateRegistry(): void {
    // Registrar contrato de uso de carro usado
    this.registerTemplate({
      type: ContractType.USO_CARRO_USADO,
      templateFilename: 'contrato_uso_carro_usado.docx',
      description: 'Contrato privado de uso de bien mueble (vehículo usado)',
      requiredFields: [
        'contract_day',
        'contract_month',
        'contract_year',
        'client_name',
        'vehicle_brand',
        'vehicle_model'
      ]
    });

    // Aquí se pueden registrar más templates a futuro:
    // this.registerTemplate({
    //   type: ContractType.RECONOCIMIENTO_DEUDA,
    //   templateFilename: 'contrato_reconocimiento_deuda.docx',
    //   description: 'Contrato de reconocimiento de deuda',
    //   requiredFields: ['client_name', 'loan_amount', 'interest_rate']
    // });
  }

  /**
   * Registra un nuevo tipo de contrato en el sistema
   */
  public registerTemplate(config: ContractTemplateConfig): void {
    this.templateRegistry.set(config.type, config);
    console.log(`✓ Template registrado: ${config.type} - ${config.description}`);
  }

  /**
   * Obtiene la configuración de un template por tipo
   */
  private getTemplateConfig(type: ContractType): ContractTemplateConfig {
    const config = this.templateRegistry.get(type);
    if (!config) {
      throw new Error(`Template no encontrado para el tipo: ${type}`);
    }
    return config;
  }

  /**
   * Lista todos los tipos de contratos disponibles
   */
  public listAvailableContracts(): ContractTemplateConfig[] {
    return Array.from(this.templateRegistry.values());
  }

  /**
   * Valida que todos los campos requeridos estén presentes
   */
  private validateRequiredFields(
    data: Record<string, any>,
    requiredFields: string[]
  ): { valid: boolean; missing: string[] } {
    const missing: string[] = [];

    for (const field of requiredFields) {
      if (!data[field] || data[field].toString().trim() === '') {
        missing.push(field);
      }
    }

    return {
      valid: missing.length === 0,
      missing
    };
  }

  /**
   * Genera un contrato basado en el tipo y los datos proporcionados
   */
  public async generateContract(
    contractType: ContractType,
    data: Record<string, any>,
    options: { generatePdf?: boolean; filenamePrefix?: string } = {}
  ): Promise<ContractGenerationResponse> {
    try {
      // 1. Obtener configuración del template
      const config = this.getTemplateConfig(contractType);
      console.log(`📄 Generando contrato: ${config.description}`);

      // 2. Validar campos requeridos
      const validation = this.validateRequiredFields(data, config.requiredFields);
      if (!validation.valid) {
        return {
          success: false,
          contractType,
          message: 'Validación fallida',
          error: `Campos requeridos faltantes: ${validation.missing.join(', ')}`
        };
      }

      // 3. Cargar template
      const templatePath = path.join(this.templatesDir, config.templateFilename);
      const templateContent = await fs.readFile(templatePath, 'binary');
      const zip = new PizZip(templateContent);

      // 4. Crear instancia de docxtemplater
      const doc = new Docxtemplater(zip, {
        paragraphLoop: true,
        linebreaks: true,
        nullGetter: () => '', // Reemplazar nulls con string vacío
      });

      // 5. Renderizar con los datos
      doc.render(data);

      // 6. Generar buffer del DOCX
      const docxBuffer = doc.getZip().generate({
        type: 'nodebuffer',
        compression: 'DEFLATE',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      });

      // 7. Generar nombres de archivo
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('.')[0];
      const prefix = options.filenamePrefix || data.client_name?.replace(/\s+/g, '_') || 'contract';
      const baseFilename = `${prefix}_${contractType}_${timestamp}`;

      // 8. Asegurar que el directorio de salida existe
      await fs.mkdir(this.outputDir, { recursive: true });

      // 9. Guardar DOCX
      const docxFilename = `${baseFilename}.docx`;
      const docxPath = path.join(this.outputDir, docxFilename);
      await fs.writeFile(docxPath, docxBuffer);
      console.log(`✓ DOCX generado: ${docxFilename}`);

      // 10. Generar PDF si se solicita
      let pdfPath: string | undefined;
      if (options.generatePdf !== false) { // Por defecto genera PDF
        try {
          const pdfBuffer = await this.convertToPdf(docxBuffer);
          const pdfFilename = `${baseFilename}.pdf`;
          pdfPath = path.join(this.outputDir, pdfFilename);
          await fs.writeFile(pdfPath, pdfBuffer);
          console.log(`✓ PDF generado: ${pdfFilename}`);
        } catch (pdfError) {
          console.error('Error al generar PDF:', pdfError);
          // No fallar si PDF falla, el DOCX ya está generado
        }
      }

      return {
        success: true,
        contractType,
        docx_path: docxPath,
        pdf_path: pdfPath,
        message: `Contrato ${contractType} generado exitosamente`,
        generatedAt: new Date().toISOString()
      };

    } catch (error: any) {
      console.error('Error generando contrato:', error);

      return {
        success: false,
        contractType,
        message: 'Error al generar contrato',
        error: error.message || 'Error desconocido'
      };
    }
  }

  /**
   * Convierte un buffer DOCX a PDF usando Gotenberg
   */
  private async convertToPdf(docxBuffer: Buffer): Promise<Buffer> {
    const form = new FormData();
    form.append('file', docxBuffer, {
      filename: 'contract.docx',
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    });

    const response = await axios.post(
      `${this.gotenbergUrl}/forms/libreoffice/convert`,
      form,
      {
        headers: {
          ...form.getHeaders(),
        },
        responseType: 'arraybuffer',
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
        timeout: 30000 // 30 segundos timeout
      }
    );

    return Buffer.from(response.data);
  }

  /**
   * Método de conveniencia para generar contrato de uso de carro usado
   */
  public async generateUsoCarroUsado(
    data: Record<string, any>,
    generatePdf: boolean = true
  ): Promise<ContractGenerationResponse> {
    return this.generateContract(
      ContractType.USO_CARRO_USADO,
      data,
      { generatePdf }
    );
  }

  /**
   * Verifica si Gotenberg está disponible
   */
  public async checkGotenbergHealth(): Promise<boolean> {
    try {
      const response = await axios.get(`${this.gotenbergUrl}/health`, {
        timeout: 5000
      });
      return response.status === 200;
    } catch (error) {
      console.error('Gotenberg no está disponible:', error);
      return false;
    }
  }
}

// Exportar instancia singleton por defecto
export const contractGenerator = new ContractGeneratorService();
