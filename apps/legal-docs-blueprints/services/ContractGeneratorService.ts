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
import { GenderTranslator, Gender, MaritalStatus } from './GenderTranslator';
import { documensoService } from './DocumensoService';
import { getRequiredEmailCount } from '../config/docusealConfig';
import { crmApiService } from './CrmApiService';

/**
 * Servicio genérico para generación de contratos desde templates DOCX
 * Soporta múltiples tipos de contratos de manera extensible
 */
export class ContractGeneratorService {
  private gotenbergUrl: string;
  private templatesDir: string;
  private outputDir: string;
  private templateRegistry: Map<ContractType, ContractTemplateConfig>;

  // Control de concurrencia para Gotenberg
  private pdfConversionQueue: Array<() => void> = [];
  private activePdfConversions = 0;
  private readonly maxConcurrentPdfConversions = 3; // Máximo 3 conversiones simultáneas

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
    this.registerTemplate(
      {
        type: ContractType.USO_CARRO_USADO,
        templateFilename: "contrato_uso_carro_usado/contrato_uso_carro_usado.docx",
        templateFilenameFemale: "contrato_uso_carro_usado/contrato_uso_carro_usado-mujer.docx",
        templateFilenamePlural: "contrato_uso_carro_usado/contrato_uso_carro_usado-plural.docx",
        templateFilenameFemalePlural: "contrato_uso_carro_usado/contrato_uso_carro_usado-mujer-plural.docx",
        description: "Contrato privado de uso de bien mueble (vehículo usado)",
        requiredFields: [
          "nombreCompleto",
        ],
      }
    );

    this.registerTemplate({
      type: ContractType.RECONOCIMIENTO_DEUDA,
      templateFilename: 'reconocimiento_deuda/reconocimiento_deuda_template.docx',
      templateFilenameFemale: 'reconocimiento_deuda/reconocimiento_deuda_template-mujer.docx',
      templateFilenamePlural: 'reconocimiento_deuda/reconocimiento_deuda_template-plural.docx',
      templateFilenameFemalePlural: 'reconocimiento_deuda/reconocimiento_deuda_template-mujer-plural.docx',
      description: 'Contrato de reconocimiento de deuda',
      requiredFields: ['nombreCompleto']
    });

    // Registrar contrato de garantía mobiliaria
    this.registerTemplate({
      type: ContractType.GARANTIA_MOBILIARIA,
      templateFilename: 'garantia_mobiliaria/garantia_mobiliaria.docx',
      templateFilenameFemale: 'garantia_mobiliaria/garantia_mobiliaria-mujer.docx',
      templateFilenamePlural: 'garantia_mobiliaria/garantia_mobiliaria-plural.docx',
      templateFilenameFemalePlural: 'garantia_mobiliaria/garantia_mobiliaria-mujer-plural.docx',
      description: 'Contrato de garantía mobiliaria con vehículo',
      requiredFields: [
        'nombreCompleto',
      ]
    });

    // Registrar carta de emisión de cheques
    this.registerTemplate({
      type: ContractType.CARTA_EMISION_CHEQUES,
      templateFilename: 'carta_emision_cheques/carta_emision_cheques.docx',
      templateFilenameFemale: 'carta_emision_cheques/carta_emision_cheques-mujer.docx',
      templateFilenamePlural: 'carta_emision_cheques/carta_emision_cheques-plural.docx',
      templateFilenameFemalePlural: 'carta_emision_cheques/carta_emision_cheques-mujer-plural.docx',
      description: 'Carta de emisión de cheques / Solicitud de desembolso',
      requiredFields: [
        'nombreCompleto',
      ]
    });

    // Registrar descargo de responsabilidades
    this.registerTemplate({
      type: ContractType.DESCARGO_RESPONSABILIDADES,
      templateFilename: 'descargo_responsabilidades/descargo_responsabilidades.docx',
      templateFilenameFemale: 'descargo_responsabilidades/descargo_responsabilidades-mujer.docx',
      templateFilenamePlural: 'descargo_responsabilidades/descargo_responsabilidades-plural.docx',
      templateFilenameFemalePlural: 'descargo_responsabilidades/descargo_responsabilidades-mujer-plural.docx',
      description: 'Descargo de responsabilidades de vehículo',
      requiredFields: [
        'nombreCompleto',
      ]
    });

    // Registrar cobertura INREXSA (no tiene género, solo singular y plural)
    this.registerTemplate({
      type: ContractType.COBERTURA_INREXSA,
      templateFilename: 'cobertura_inrexsa/cobertura_inrexsa.docx',
      templateFilenameFemale: 'cobertura_inrexsa/cobertura_inrexsa.docx',
      templateFilenamePlural: 'cobertura_inrexsa/cobertura_inrexsa-plural.docx',
      templateFilenameFemalePlural: 'cobertura_inrexsa/cobertura_inrexsa-plural.docx',
      description: 'Carta de cobertura INREXSA',
      requiredFields: [
        'nombreCompleto',
      ]
    });

    // Registrar pagaré único libre de protesto
    this.registerTemplate({
      type: ContractType.PAGARE_UNICO_LIBRE_PROTESTO,
      templateFilename: 'pagare_unico_libre_protesto/pagare_unico_libre_de_protesto.docx',
      templateFilenameFemale: 'pagare_unico_libre_protesto/pagare_unico_libre_de_protesto-mujer.docx',
      templateFilenamePlural: 'pagare_unico_libre_protesto/pagare_unico_libre_de_protesto-plural.docx',
      templateFilenameFemalePlural: 'pagare_unico_libre_protesto/pagare_unico_libre_de_protesto-mujer-plural.docx',
      description: 'Pagaré único libre de protesto',
      requiredFields: [
        'nombreCompleto',
      ]
    });

    // Registrar declaración de vendedor
    this.registerTemplate({
      type: ContractType.DECLARACION_DE_VENDEDOR,
      templateFilenamePlural: 'declaracion_vendedor/declaracion_de_vendedor.docx',
      templateFilenameFemalePlural: 'declaracion_vendedor/declaracion_de_vendedor-mujer.docx',
      templateFilename: 'declaracion_vendedor/declaracion_de_vendedor.docx',
      templateFilenameFemale: 'declaracion_vendedor/declaracion_de_vendedor-mujer.docx',
      description: 'Declaración de vendedor de vehículo',
      requiredFields: []
    });

    // Registrar carta carro nuevo
    this.registerTemplate({
      type: ContractType.CARTA_CARRO_NUEVO,
      templateFilename: 'carta_carro_nuevo/carta_carro_nuevo.docx',
      templateFilenameFemale: 'carta_carro_nuevo/carta_carro_nuevo-mujer.docx',
      templateFilenamePlural: 'carta_carro_nuevo/carta_carro_nuevo-plural.docx',
      templateFilenameFemalePlural: 'carta_carro_nuevo/carta_carro_nuevo-mujer-plural.docx',
      description: 'Carta de conformidad para adquisición de carro nuevo',
      requiredFields: []
    });

    this.registerTemplate({
      type: ContractType.CARTA_ACEPTACION_INSTALACION_GPS,
      templateFilename: 'carta_aceptacion_gps/carta_aceptacion_gps.docx',
      templateFilenameFemale: 'carta_aceptacion_gps/carta_aceptacion_gps-mujer.docx',
      templateFilenamePlural: 'carta_aceptacion_gps/carta_aceptacion_gps-plural.docx',
      templateFilenameFemalePlural: 'carta_aceptacion_gps/carta_aceptacion_gps-mujer-plural.docx',
      description: 'Carta de aceptación para instalación de GPS en vehículo',
      requiredFields: []
    }); 

    this.registerTemplate({
      type: ContractType.CARTA_SOLICITUD_TRASPASO_VEHICULO,
      templateFilename: 'carta_solicitud_traspaso_vehiculo/carta_solicitud_traspaso_vehiculo.docx',
      templateFilenameFemale: 'carta_solicitud_traspaso_vehiculo/carta_solicitud_traspaso_vehiculo-mujer.docx',
      templateFilenamePlural: 'carta_solicitud_traspaso_vehiculo/carta_solicitud_traspaso_vehiculo-plural.docx',
      templateFilenameFemalePlural: 'carta_solicitud_traspaso_vehiculo/carta_solicitud_traspaso_vehiculo-mujer-plural.docx',
      description: 'Carta de solicitud de traspaso de vehículo',
      requiredFields: []
    });

    this.registerTemplate({
      type: ContractType.CONTRATO_PRIVADO_USO,
      templateFilename: 'contrato_privado_uso_nuevo/contrato_privado_uso_nuevo.docx',
      templateFilenameFemale: 'contrato_privado_uso_nuevo/contrato_privado_uso_nuevo-mujer.docx',
      templateFilenamePlural: 'contrato_privado_uso_nuevo/contrato_privado_uso_nuevo-plural.docx',
      templateFilenameFemalePlural: 'contrato_privado_uso_nuevo/contrato_privado_uso_nuevo-mujer-plural.docx',
      description: 'Contrato privado de uso de bien mueble',
      requiredFields: []
    });

    this.registerTemplate({
      type: ContractType.SOLICITUD_COMPRA_VEHICULO,
      templateFilename: 'solicitud_compra_vehiculo/solicitud_compra_vehiculo.docx',
      templateFilenameFemale: 'solicitud_compra_vehiculo/solicitud_compra_vehiculo-mujer.docx',
      templateFilenamePlural: 'solicitud_compra_vehiculo/solicitud_compra_vehiculo-plural.docx',
      templateFilenameFemalePlural: 'solicitud_compra_vehiculo/solicitud_compra_vehiculo-mujer-plural.docx',
      description: 'Carta de solicitud de compra de vehículo',
      requiredFields: []
    });

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
   * Prepara los datos agregando términos de género traducidos si aplica
   */
  private prepareDataWithGender(
    contractType: ContractType,
    data: Record<string, any>
  ): Record<string, any> {
    // ==== CONTRATO DE USO DE CARRO USADO ====
    if (contractType === ContractType.USO_CARRO_USADO) {
      // Verificar si el contrato tiene información de género
      if (!data.client_gender || !data.client_marital_status || !data.client_nationality) {
        console.warn('⚠ Advertencia: Contrato sin campos de género. Se recomienda agregar client_gender, client_marital_status y client_nationality');
        return data;
      }

      // Validar género y estado civil
      if (!GenderTranslator.isValidGender(data.client_gender)) {
        throw new Error(`Género inválido: ${data.client_gender}. Debe ser 'male' o 'female'`);
      }

      if (!GenderTranslator.isValidMaritalStatus(data.client_marital_status)) {
        throw new Error(`Estado civil inválido: ${data.client_marital_status}. Debe ser 'single', 'married', 'widowed' o 'divorced'`);
      }

      // Generar términos de género traducidos
      const genderedData = GenderTranslator.generateGenderedData(
        data.client_gender as Gender,
        data.client_marital_status as MaritalStatus,
        data.client_nationality as string
      );

      console.log(`✓ Términos de género aplicados: ${data.client_gender} → ${genderedData.title_with_article}`);

      return {
        ...data,
        ...genderedData
      };
    }

    // ==== CONTRATO DE GARANTÍA MOBILIARIA ====
    if (contractType === ContractType.GARANTIA_MOBILIARIA) {
      // Verificar si el contrato tiene información de género del deudor
      if (!data.debtor_gender || !data.debtor_marital_status || !data.debtor_nationality) {
        console.warn('⚠ Advertencia: Contrato sin campos de género del deudor. Se recomienda agregar debtor_gender, debtor_marital_status y debtor_nationality');
        return data;
      }

      // Validar género y estado civil
      if (!GenderTranslator.isValidGender(data.debtor_gender)) {
        throw new Error(`Género inválido: ${data.debtor_gender}. Debe ser 'male' o 'female'`);
      }

      if (!GenderTranslator.isValidMaritalStatus(data.debtor_marital_status)) {
        throw new Error(`Estado civil inválido: ${data.debtor_marital_status}. Debe ser 'single', 'married', 'widowed' o 'divorced'`);
      }

      // Generar términos de género traducidos
      const genderedData = GenderTranslator.generateGenderedData(
        data.debtor_gender as Gender,
        data.debtor_marital_status as MaritalStatus,
        data.debtor_nationality as string
      );

      // Para garantía mobiliaria, también agregar términos con prefijo "debtor_"
      const debtorGenderedData = {
        debtor_marital_status_gendered: genderedData.client_marital_status_gendered,
        debtor_nationality_gendered: genderedData.client_nationality_gendered
      };

      console.log(`✓ Términos de género del deudor aplicados: ${data.debtor_gender} → ${genderedData.debtor}`);

      return {
        ...data,
        ...genderedData,
        ...debtorGenderedData
      };
    }

    // Otros tipos de contrato sin género dinámico
    return data;
  }

  /**
   * Genera múltiples contratos de manera secuencial (uno tras otro)
   * @param contracts - Array de solicitudes de contratos a generar
   * @returns Array de respuestas con el resultado de cada generación
   */
  public async generateContractsBatch(
    contracts: Array<{
      contractType: ContractType;
      data: Record<string, any>;
      emails?: string[];
      options?: { generatePdf?: boolean; filenamePrefix?: string; gender?: "male" | "female"; isPlural?: boolean };
    }>
  ): Promise<{
    success: boolean;
    message: string;
    results: ContractGenerationResponse[];
    summary: {
      total: number;
      successful: number;
      failed: number;
      duration: number;
    };
  }> {
    const startTime = Date.now();
    const results: ContractGenerationResponse[] = [];

    console.log(`\n🔄 Iniciando generación de ${contracts.length} contratos en batch...\n`);

    // Procesar cada contrato de manera secuencial
    for (let i = 0; i < contracts.length; i++) {
      const { contractType, data, emails, options } = contracts[i];

      console.log(`[${i + 1}/${contracts.length}] Procesando contrato: ${contractType}`);
      console.log(`  Options recibidas:`, JSON.stringify(options));

      try {
        const result = await this.generateContract(contractType, data, { ...options, emails });
        results.push(result);
        
        if (result.success) {
          console.log(`  ✅ Éxito: ${result.message}`);
        } else {
          console.error(`  ❌ Error: ${result.error}`);
        }
      } catch (error: any) {
        // Capturar errores inesperados
        console.error(`  ❌ Error inesperado: ${error.message}`);
        results.push({
          success: false,
          contractType,
          message: 'Error inesperado durante la generación',
          error: error.message || 'Error desconocido'
        });
      }
      
      // Pequeña pausa entre contratos para evitar sobrecarga
      if (i < contracts.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    const endTime = Date.now();
    const duration = endTime - startTime;

    // Calcular estadísticas
    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;

    const summary = {
      total: contracts.length,
      successful,
      failed,
      duration
    };

    console.log(`\n📊 Resumen de generación batch:`);
    console.log(`   Total: ${summary.total}`);
    console.log(`   ✅ Exitosos: ${summary.successful}`);
    console.log(`   ❌ Fallidos: ${summary.failed}`);
    console.log(`   ⏱️  Duración: ${(duration / 1000).toFixed(2)}s`);

    return {
      success: true,
      message: `${summary.successful} de ${summary.total} contratos generados exitosamente`,
      results,
      summary
    };
  }

  /**
   * Genera un contrato basado en el tipo y los datos proporcionados
   */
  public async generateContract(
    contractType: ContractType,
    data: Record<string, any>,
    options: { gender?: "male" | "female"; generatePdf?: boolean; filenamePrefix?: string; emails?: string[]; isPlural?: boolean } = { gender: "male" }
  ): Promise<ContractGenerationResponse> {
    try {
      // 1. Obtener configuración del template
      const config = this.getTemplateConfig(contractType);
      console.log(`📄 Generando contrato: ${config.description}${options.isPlural ? ' (PLURAL)' : ''}`);

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

      // 3. Seleccionar template según género y plural
      let templateFilename: string;
      if (options.isPlural) {
        // Template plural
        if (options.gender === "female") {
          templateFilename = config.templateFilenameFemalePlural || config.templateFilenameFemale;
        } else {
          templateFilename = config.templateFilenamePlural || config.templateFilename;
        }
      } else {
        // Template singular
        templateFilename = options.gender === "female" ? config.templateFilenameFemale : config.templateFilename;
      }

      // 4. Cargar template
      console.log(`  → Template seleccionado: ${templateFilename}`);
      const templatePath = path.join(this.templatesDir, templateFilename);
      const templateContent = await fs.readFile(templatePath, 'binary');
      const zip = new PizZip(templateContent);

      // 5. Crear instancia de docxtemplater
      const doc = new Docxtemplater(zip, {
        paragraphLoop: true,
        linebreaks: true,
        nullGetter: () => '-', // Reemplazar nulls con '-'
        parser: (tag: string) => {
          // remplazar cadenas vacías por guion
          return {
            get: (scope: any) => {
              const value = scope[tag];
              if (value === null || value === undefined || value === '') {
                return '- ';
              }
              return value;
            }
          };
        }
      })

      // 6. Preparar datos para renderizado
      let renderData = { ...data };

      // Si es plural, crear array de firmantes (deudor 1 + deudores adicionales)
      if (options.isPlural) {
        const deudor1 = {
          nombreCompleto: data.nombreCompleto,
          dpiTexto: data.dpiTexto,
          dpi: data.dpi
        };

        const deudoresAdicionales = data.deudoresAdicionales || [];

        // Array de firmantes = deudor 1 + deudores adicionales
        const firmantes = [deudor1, ...deudoresAdicionales];

        // Agrupar firmantes en filas de 2 columnas (aplanar datos para evitar problemas con parser)
        const firmantesFilas: Array<{
          col1nombreCompleto: string;
          col1dpi: string;
          col2nombreCompleto?: string;
          col2dpi?: string;
          tieneCol2: boolean;
        }> = [];

        for (let i = 0; i < firmantes.length; i += 2) {
          const f1 = firmantes[i];
          const f2 = firmantes[i + 1];
          firmantesFilas.push({
            col1nombreCompleto: f1.nombreCompleto,
            col1dpi: f1.dpi,
            col2nombreCompleto: f2?.nombreCompleto,
            col2dpi: f2?.dpi,
            tieneCol2: !!f2
          });
        }

        renderData.firmantesFilas = firmantesFilas;
        console.log(`✓ Plural: ${firmantes.length} firmante(s) en ${firmantesFilas.length} fila(s)`);
        console.log(`  firmantesFilas:`, JSON.stringify(firmantesFilas, null, 2));
      }

      // 7. Renderizar con los datos
      doc.render(renderData);

      // 7. Generar buffer del DOCX
      const docxBuffer = doc.getZip().generate({
        type: 'nodebuffer',
        compression: 'DEFLATE',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      });

      // 8. Generar nombres de archivo
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('.')[0];
      const prefix = options.filenamePrefix || data.client_name?.replace(/\s+/g, '_') || 'contract';
      const baseFilename = `${prefix}_${contractType}_${timestamp}`;

      // 9. Asegurar que el directorio de salida existe
      await fs.mkdir(this.outputDir, { recursive: true });

      // 10. Guardar DOCX
      const docxFilename = `${baseFilename}.docx`;
      const docxPath = path.join(this.outputDir, docxFilename);
      await fs.writeFile(docxPath, docxBuffer);
      console.log(`✓ DOCX generado: ${docxFilename}`);

      // 11. Generar PDF si se solicita
      let pdfPath: string | undefined;
      let pdfBuffer: Buffer | undefined;
      if (options.generatePdf !== false) { // Por defecto genera PDF
        try {
          pdfBuffer = await this.convertToPdf(docxBuffer);
          const pdfFilename = `${baseFilename}.pdf`;
          pdfPath = path.join(this.outputDir, pdfFilename);
          await fs.writeFile(pdfPath, pdfBuffer);
          console.log(`✓ PDF generado: ${pdfFilename}`);
        } catch (pdfError) {
          console.error('Error al generar PDF:', pdfError);
          // No fallar si PDF falla, el DOCX ya está generado
        }
      }

      // 12. Integración con Documenso (si se proporcionaron emails y se generó PDF)
      let signing: {
        signs: string[];
        linkDocument: string;
       } | undefined;
      let signingLinks: string[] | undefined;
      let shouldCleanupFiles = false;

      if (options.emails && options.emails.length > 0 && pdfBuffer) {
        try {
          console.log(`🔗 Creando documento en Documenso para firma...`);

          // Validar número de emails
          const requiredEmails = getRequiredEmailCount(contractType);
          if (options.emails.length !== requiredEmails) {
            console.warn(`⚠ Se esperaban ${requiredEmails} email(s) pero se recibieron ${options.emails.length}`);
          }

          // Crear documento y obtener links de firma (detección automática de posiciones)
          signing = await documensoService.createDocumentAndGetSigningLinks(
            baseFilename,
            pdfBuffer,
            contractType,
            options.emails
          );

          signingLinks = signing.signs ?? [];

          console.log(`✓ ${signingLinks.length} link(s) de firma generados`);

          // Marcar para limpieza: archivo subido exitosamente a Documenso/R2
          shouldCleanupFiles = true;
        } catch (documensoError) {
          console.error('⚠ Error al crear documento en Documenso:', documensoError);
          // No fallar si Documenso falla, los archivos ya están generados
        }
      }

      // 13. Limpiar archivos locales si se subieron exitosamente a R2
      if (shouldCleanupFiles) {
        try {
          await this.cleanupLocalFiles(docxPath, pdfPath);
          console.log(`🗑️  Archivos locales eliminados (ya están en R2)`);
        } catch (cleanupError) {
          console.warn('⚠ Error al limpiar archivos locales:', cleanupError);
          // No fallar si la limpieza falla
        }
      }

      // Construir datos de firmantes para el frontend
      const submissionData = (options.emails || []).map((email, index) => {
        const signingLink = signingLinks?.[index] || '';

        return {
          id: index + 1,
          slug: `documenso-${Date.now()}-${index}`,
          uuid: `uuid-${Date.now()}-${index}`,
          name: null,
          email: email,
          phone: null,
          completed_at: null,
          declined_at: null,
          external_id: null,
          submission_id: index + 1,
          metadata: { contractType, generatedAt: new Date().toISOString() },
          opened_at: null,
          sent_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          status: 'pending',
          application_key: null,
          values: Object.entries(data).map(([field, value]) => ({
            field,
            value: value as string | number | null
          })),
          preferences: {
            send_email: true,
            send_sms: false
          },
          role: 'SIGNER',
          embed_src: signingLink // Link de firma de Documenso
        };
      });

      // 14. Guardar contrato en CRM (si hay DPI y signing links)
      if (data.dpi && signingLinks && signingLinks.length > 0) {
        const templateId = Math.floor(Math.random() * 100000);

        // Preparar response completo para guardar en CRM
        const fullApiResponse = {
          templateId,
          success: true,
          nameDocument: [{ enum: contractType, label: config.description }],
          data: submissionData,
          signing_links: signingLinks,
          linkDocument: signing?.linkDocument || '',
          contractType,
          docx_path: docxPath,
          pdf_path: pdfPath,
          message: `Contrato ${contractType} generado exitosamente`,
          generatedAt: new Date().toISOString()
        };

        // Llamar al CRM de manera no-bloqueante
        crmApiService.saveContractSilently({
          dpi: data.dpi,
          contractType,
          contractName: config.description,
          signingLinks,
          templateId,
          apiResponse: fullApiResponse,
        }).catch(err => {
          console.error('[ContractGeneratorService] Error al guardar en CRM:', err);
          // No bloquear la respuesta si falla el guardado en CRM
        });
      } else {
        if (!data.dpi) {
          console.warn('[ContractGeneratorService] No se guardará en CRM: falta DPI en los datos');
        }
        if (!signingLinks || signingLinks.length === 0) {
          console.warn('[ContractGeneratorService] No se guardará en CRM: no hay signing links');
        }
      }

      return {
        templateId: Math.floor(Math.random() * 100000), // ID de template simulado
        success: true,
        nameDocument: [{ enum: contractType, label: config.description }],
        data: submissionData,
        signing_links: signingLinks,
        linkDocument: signing?.linkDocument || '',
        // Campos adicionales para backward compatibility
        contractType,
        docx_path: docxPath,
        pdf_path: pdfPath,
        message: `Contrato ${contractType} generado exitosamente`,
        generatedAt: new Date().toISOString()
      };

    } catch (error: any) {
      console.error('Error generando contrato:', error);

      return {
        templateId: 0,
        success: false,
        nameDocument: [{ enum: contractType, label: contractType }],
        data: [],
        linkDocument: '',
        signing_links: undefined,
        contractType,
        message: 'Error al generar contrato',
        error: error.message || 'Error desconocido'
      };
    }
  }

  /**
   * Convierte un buffer DOCX a PDF usando Gotenberg
   */
  /**
   * Espera a que haya un slot disponible para conversión PDF
   */
  private async acquirePdfSlot(): Promise<void> {
    if (this.activePdfConversions < this.maxConcurrentPdfConversions) {
      this.activePdfConversions++;
      return;
    }

    // Esperar a que se libere un slot
    return new Promise<void>((resolve) => {
      this.pdfConversionQueue.push(() => {
        this.activePdfConversions++;
        resolve();
      });
    });
  }

  /**
   * Libera un slot de conversión PDF
   */
  private releasePdfSlot(): void {
    this.activePdfConversions--;
    const next = this.pdfConversionQueue.shift();
    if (next) {
      next();
    }
  }

  private async convertToPdf(docxBuffer: Buffer): Promise<Buffer> {
    // Esperar a que haya un slot disponible (máximo 3 conversiones simultáneas)
    await this.acquirePdfSlot();

    try {
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
          // Límites razonables para evitar memory leaks
          maxBodyLength: 50 * 1024 * 1024, // 50MB máximo
          maxContentLength: 50 * 1024 * 1024, // 50MB máximo
          timeout: 60000 // 60 segundos timeout (LibreOffice puede ser lento)
        }
      );

      return Buffer.from(response.data);
    } catch (error: any) {
      // Mejorar el mensaje de error para diagnóstico
      if (error.code === 'ECONNREFUSED') {
        throw new Error('Gotenberg no está disponible. El servicio puede estar caído o reiniciándose.');
      }
      if (error.code === 'ETIMEDOUT' || error.code === 'ECONNABORTED') {
        throw new Error('Timeout al conectar con Gotenberg. El servicio puede estar sobrecargado.');
      }
      if (error.response?.status === 503) {
        throw new Error('Gotenberg está sobrecargado (503). Intente nuevamente en unos segundos.');
      }
      throw new Error(`Error al convertir a PDF: ${error.message}`);
    } finally {
      // SIEMPRE liberar el slot, incluso si hay error
      this.releasePdfSlot();
    }
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
   * Limpia archivos locales después de subir exitosamente a R2
   */
  private async cleanupLocalFiles(docxPath: string, pdfPath?: string): Promise<void> {
    const filesToDelete = [docxPath];
    if (pdfPath) {
      filesToDelete.push(pdfPath);
    }

    for (const filePath of filesToDelete) {
      try {
        await fs.unlink(filePath);
        console.log(`  ✓ Eliminado: ${path.basename(filePath)}`);
      } catch (error) {
        console.warn(`  ⚠ No se pudo eliminar ${path.basename(filePath)}:`, error);
      }
    }
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
export const contractGenerator = new ContractGeneratorService({
  gotenbergUrl: process.env.GOTENBERG_URL || 'http://localhost:3000'
});
