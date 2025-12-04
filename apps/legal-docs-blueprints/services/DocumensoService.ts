import { Documenso } from '@documenso/sdk-typescript';
import { PDFDocument } from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { ContractType } from '../types/contract';
import { getSignerConfig } from '../config/docusealConfig'; // Reutilizamos la config existente
import { getSignaturePattern } from './signaturePatterns';

/**
 * Escribe logs de detección de coordenadas a archivo
 */
async function logCoordinates(
  contractType: ContractType,
  pattern: string,
  pageNum: number,
  pageHeight: number,
  scaleFactor: number,
  pdfX: number,
  pdfY: number,
  documensoX: number,
  documensoY: number
): Promise<void> {
  const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
  const logEntry = `[${timestamp}] ${contractType}\n  Patrón: "${pattern}"\n  Página ${pageNum}, Altura: ${pageHeight.toFixed(2)}, SCALE: ${scaleFactor.toFixed(2)}\n  PDF: (${pdfX.toFixed(1)}, ${pdfY.toFixed(1)}) → Documenso: (${documensoX.toFixed(1)}, ${documensoY.toFixed(1)})\n\n`;

  try {
    // Leer contenido existente si el archivo existe
    const logFile = Bun.file('logs/signature-detection.log');
    let existingContent = '';
    try {
      existingContent = await logFile.text();
    } catch {
      // Archivo no existe, crear directorio
      await Bun.write('logs/.gitkeep', '');
    }

    // Escribir nuevo contenido
    await Bun.write('logs/signature-detection.log', existingContent + logEntry);
  } catch (error) {
    console.error('⚠️ Error escribiendo log:', error);
  }
}

/**
 * Retorna el email del segundo firmante según el tipo de contrato
 * (solo para contratos que requieren 2 firmantes)
 */
function getSecondSignerEmail(contractType: ContractType): string | null {
  const secondSignerMap: Partial<Record<ContractType, string>> = {
    [ContractType.CONTRATO_PRIVADO_USO]: 'richard.kachler@clubcashin.com',
    [ContractType.USO_CARRO_USADO]: 'richard.kachler@clubcashin.com',
    [ContractType.GARANTIA_MOBILIARIA]: 'andresasensio@clubcashin.com',
    [ContractType.RECONOCIMIENTO_DEUDA]: 'andresasensio@clubcashin.com',
  };

  return secondSignerMap[contractType] || null;
}

// Interfaces para tipos de Documenso
interface DocumensoRecipient {
  email: string;
  name: string;
  role: 'SIGNER' | 'VIEWER' | 'APPROVER';
}

interface DocumensoField {
  type: 'SIGNATURE' | 'DATE' | 'EMAIL' | 'NAME' | 'TEXT';
  recipientId: string;
  page: number;
  positionX: number;
  positionY: number;
  width: number;
  height: number;
  required: boolean;
}

/**
 * Detecta las líneas de firma en un PDF y calcula las posiciones para los campos de Documenso
 */
async function findSignatureLinesInPDF(
  pdfBuffer: Buffer,
  contractType: ContractType
): Promise<{ pageCount: number; fields: DocumensoField[] }> {
  try {
    console.log(`🔍 Detectando líneas de firma para contrato tipo: ${contractType}`);

    // 1. Obtener configuración del patrón para este tipo de contrato
    const patternConfig = getSignaturePattern(contractType);
    console.log(`📋 Patrón a buscar: "${patternConfig.pattern}" (${patternConfig.signerCount} firmante(s))`);

    // 2. Parsear PDF con pdfjs-dist para buscar el patrón con coordenadas reales
    const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(pdfBuffer) });
    const pdfDocument = await loadingTask.promise;
    const pageCount = pdfDocument.numPages;
    console.log(`📄 PDF tiene ${pageCount} páginas`);

    // Cargar también con pdf-lib para fallback
    const pdfDoc = await PDFDocument.load(pdfBuffer);

    // 3. Buscar el patrón en cada página y obtener coordenadas reales
    const pattern = patternConfig.pattern;
    const foundPositions: Array<{
      pageNum: number;
      pdfX: number;
      pdfY: number;
      pageHeight: number;
      scaleFactor: number;
    }> = [];

    // Buscar en cada página y guardar TODAS las posiciones encontradas
    for (let pageNum = pageCount; pageNum >= 1; pageNum--) {
      const page = await pdfDocument.getPage(pageNum);
      const textContent = await page.getTextContent();
      const viewport = page.getViewport({ scale: 1.0 });
      const pageHeight = viewport.height;
      const SCALE_FACTOR = pageHeight / 93.6;

      // Buscar el patrón en los items de texto de esta página
      for (let i = 0; i < textContent.items.length; i++) {
        const item = textContent.items[i] as any;
        const itemText = item.str;

        // Verificar si este item contiene el patrón
        const patternStart = pattern.split('_')[0];
        const matchesPattern = itemText.includes(pattern) ||
                               itemText.trim() === pattern.trim() ||
                               (patternStart.length >= 2 && itemText.trim().startsWith(patternStart));

        if (matchesPattern) {
          const pdfX = item.transform[4];
          const pdfY = item.transform[5];

          foundPositions.push({
            pageNum,
            pdfX,
            pdfY,
            pageHeight,
            scaleFactor: SCALE_FACTOR,
          });

          console.log(`✓ Patrón ${foundPositions.length} encontrado en página ${pageNum} - PDF (${pdfX.toFixed(1)}, ${pdfY.toFixed(1)})`);
          
          // Si ya encontramos suficientes, salir
          if (foundPositions.length >= patternConfig.signerCount) {
            break;
          }
        }
      }
      
      // Si ya encontramos suficientes, salir del loop de páginas
      if (foundPositions.length >= patternConfig.signerCount) {
        break;
      }
    }

    console.log(`✓ Total encontradas: ${foundPositions.length} ocurrencias (esperadas: ${patternConfig.signerCount})`);

    if (foundPositions.length === 0) {
      console.warn(`⚠️ No se encontró el patrón "${pattern}" en el PDF`);
      return generateFallbackFields(pdfDoc, patternConfig.signerCount);
    }

    // 4. INVERTIR el orden: el último encontrado será recipient-0 (Representante)
    //    y el primero encontrado será recipient-1 (Cliente)
    foundPositions.reverse();
    console.log(`🔄 Orden invertido: Último encontrado (Representante) → recipient-0, Primero encontrado (Cliente) → recipient-1`);

    // 5. Crear los campos con el orden correcto
    const fields: DocumensoField[] = [];
    
    for (let index = 0; index < Math.min(foundPositions.length, patternConfig.signerCount); index++) {
      const pos = foundPositions[index];
      const { pageNum, pdfX, pdfY, pageHeight, scaleFactor } = pos;

      // Aplicar ajuste en X según el firmante
      let xAdjustment = 80; // Ajuste base para Representante
      
      //! Si es la segunda firma (Cliente) y es en la misma línea, aplicar ajuste grande
      if (index === 0 && patternConfig.xOffsetSignatureSameLine) {
        xAdjustment = patternConfig.xOffsetSignatureSameLine; // Aumentar ajuste significativamente
        console.log(`📍 Segunda firma (Cliente): aplicando ajuste X grande = +${patternConfig.xOffsetSignatureSameLine}`);
      }

      const baseX = (pdfX + xAdjustment) / scaleFactor;
      const baseY = (pageHeight - pdfY) / scaleFactor;

      // Aplicar offsets manuales si están configurados
      const documensoX = baseX + (patternConfig.xOffset || 0);
      const documensoY = baseY + (patternConfig.yOffset || 0);

      const roleName = index === 0 ? 'Representante' : 'Cliente';
      console.log(`✓ Campo ${index} (${roleName}) en página ${pageNum} - PDF (${pdfX.toFixed(1)}, ${pdfY.toFixed(1)}) + ajuste ${xAdjustment} → Documenso (${documensoX.toFixed(1)}, ${documensoY.toFixed(1)}) [SCALE: ${scaleFactor.toFixed(2)}]`);

      // Guardar coordenadas en log
      await logCoordinates(contractType, pattern, pageNum, pageHeight, scaleFactor, pdfX, pdfY, documensoX, documensoY);

      // Campo de firma sobre la línea de firma
      fields.push({
        type: 'SIGNATURE',
        recipientId: `recipient-${index}`,
        page: pageNum,
        positionX: documensoX,
        positionY: documensoY,
        width: 25,
        height: 7,
        required: true,
      });
    }

    return { pageCount, fields };
  } catch (error: any) {
    console.error('❌ Error detectando líneas de firma:', error.message);
    throw error;
  }
}

/**
 * Genera campos de firma en posiciones por defecto cuando no se encuentra el patrón
 */
function generateFallbackFields(
  pdfDoc: PDFDocument,
  signerCount: number
): { pageCount: number; fields: DocumensoField[] } {
  const pageCount = pdfDoc.getPageCount();
  const lastPage = pdfDoc.getPage(pageCount - 1);
  const { width, height } = lastPage.getSize();

  console.log(`📍 Usando posiciones de fallback en última página`);

  const fields: DocumensoField[] = [];

  for (let i = 0; i < signerCount; i++) {
    const baseX = i === 0 ? 50 : width / 2 + 50;
    const baseY = height - 150;

    fields.push({
      type: 'SIGNATURE',
      recipientId: `recipient-${i}`,
      page: pageCount,
      positionX: baseX,
      positionY: baseY,
      width: 200,
      height: 60,
      required: true,
    });
  }

  return { pageCount, fields };
}

/**
 * Servicio para integración con Documenso usando el SDK oficial
 * Usa API v2-beta con soporte completo para TypeScript
 */
export class DocumensoService {
  private client: Documenso;
  private baseUrl: string;

  constructor(apiUrl?: string, apiToken?: string) {
    // API v2-beta es requerida para el SDK
    const apiV1Url = apiUrl || process.env.DOCUMENSO_API_URL || 'https://documenso.s2.devteamatcci.site/api/v1';
    this.baseUrl = apiV1Url.replace('/api/v1', '/api/v2-beta');

    const token = apiToken || process.env.DOCUMENSO_API_TOKEN || '';

    console.log(`🔑 Token cargado: ${token.substring(0, 10)}...`);

    // Inicializar SDK oficial de Documenso
    this.client = new Documenso({
      serverURL: this.baseUrl,
      apiKey: token,
    });

    console.log(`📝 Documenso SDK inicializado con URL: ${this.baseUrl}`);
  }

  /**
   * Crea un documento en Documenso con recipients usando el SDK oficial
   */
  async createDocument(
    title: string,
    pdfBuffer: Buffer,
    recipients: DocumensoRecipient[],
    fields: DocumensoField[]
  ): Promise<any> {
    try {
      console.log(`📄 Creando documento en Documenso: ${title}`);
      console.log(`👥 Firmantes: ${recipients.length}`);

      // Paso 1: Crear documento (sin el PDF todavía)
      const response = await this.client.documents.createV0({
        title,
        recipients: recipients.map((r, index) => ({
          email: r.email,
          name: r.name,
          role: r.role as any,
          fields: fields
            .filter((f) => f.recipientId === `recipient-${index}`)
            .map((f) => ({
              type: f.type as any,
              pageNumber: f.page,
              pageX: f.positionX,
              pageY: f.positionY,
              width: f.width,
              height: f.height,
            })),
        })),
        meta: {
          timezone: 'America/Guatemala',
          dateFormat: 'dd/MM/yyyy' as any,
          language: 'es' as any,
        },
      });

      console.log(`✓ Documento creado con ID: ${response.createDocumentV0Response?.documentId}`);

      // Extraer uploadUrl de la respuesta
      const uploadUrl = (response.createDocumentV0Response as any)?.uploadUrl;

      if (!uploadUrl) {
        throw new Error('No se recibió uploadUrl de Documenso');
      }

      console.log(`📤 Subiendo PDF a R2...`);

      // Paso 2: Subir el PDF a la URL pre-firmada de R2
      const uploadResponse = await fetch(uploadUrl, {
        method: 'PUT',
        body: pdfBuffer,
        headers: {
          'Content-Type': 'application/pdf',
        },
      });

      if (!uploadResponse.ok) {
        throw new Error(`Upload falló con status: ${uploadResponse.status}`);
      }

      console.log(`✓ PDF subido exitosamente a R2`);

      // Paso 3: Distribuir el documento para activar los links de firma
      // ⚠️ COMENTADO en desarrollo para evitar envío automático de emails
      // TODO: Descomentar en producción para enviar emails automáticamente
      // const documentId = response.createDocumentV0Response?.documentId;
      // if (documentId) {
      //   console.log(`📧 Distribuyendo documento...`);
      //   try {
      //     await this.client.documents.distribute({ documentId });
      //     console.log(`✓ Documento distribuido exitosamente`);
      //   } catch (distributeError) {
      //     console.warn(`⚠️ Error al distribuir documento:`, distributeError);
      //   }
      // }

      console.log(`ℹ️ Documento creado pero NO distribuido (emails no enviados en desarrollo)`);

      return response.createDocumentV0Response;
    } catch (error: any) {
      // Si el error es de validación pero contiene los datos en rawValue, usarlos
      if (error.name === 'ResponseValidationError' && error.rawValue) {
        console.log('⚠️ Validación del SDK falló, pero los datos están completos. Usando rawValue...');
        console.log(`✓ Documento creado con ID: ${error.rawValue.document?.id}`);

        // Extraer uploadUrl de rawValue
        const uploadUrl = error.rawValue.uploadUrl;

        if (uploadUrl) {
          console.log(`📤 Subiendo PDF a R2...`);

          // Subir el PDF a la URL pre-firmada
          const uploadResponse = await fetch(uploadUrl, {
            method: 'PUT',
            body: pdfBuffer,
            headers: {
              'Content-Type': 'application/pdf',
            },
          });

          if (!uploadResponse.ok) {
            throw new Error(`Upload falló con status: ${uploadResponse.status}`);
          }

          console.log(`✓ PDF subido exitosamente a R2`);
        }

        // Paso 3: Distribuir el documento para activar los links de firma
        const documentId = error.rawValue.document?.id;
        if (documentId) {
          console.log(`📧 Distribuyendo documento...`);
          try {
            await this.client.documents.distribute({ documentId });
            console.log(`✓ Documento distribuido exitosamente`);
          } catch (distributeError: any) {
            // Ignorar error de validación del SDK - el documento se distribuye correctamente (status 200)
            console.warn(`⚠️ Error de validación del SDK al distribuir (ignorado)`);
          }
        }

        // Devolver los datos crudos que sí funcionan
        return error.rawValue.document;
      }

      console.error('❌ Error creando documento en Documenso:', error.message);
      throw new Error(`Error al crear documento en Documenso: ${error.message}`);
    }
  }

  /**
   * Genera los campos de firma para un tipo de contrato
   */
  private generateSignatureFields(
    contractType: ContractType,
    recipientCount: number,
    pageCount: number
  ): DocumensoField[] {
    // Obtener configuración de firmantes para este tipo de contrato
    const signerConfig = getSignerConfig(contractType);

    // Generar campos de firma según la configuración
    const fields: DocumensoField[] = [];

    for (let index = 0; index < Math.min(recipientCount, signerConfig.signers.length); index++) {
      const baseY = 650 - (index * 120); // Separar firmas verticalmente

      // Campo de firma
      fields.push({
        type: 'SIGNATURE',
        recipientId: `recipient-${index}`,
        page: pageCount, // Última página
        positionX: 50 + (index * 250), // Separar horizontalmente
        positionY: baseY,
        width: 200,
        height: 60,
        required: true,
      });

      // Campo de fecha junto a la firma
      fields.push({
        type: 'DATE',
        recipientId: `recipient-${index}`,
        page: pageCount,
        positionX: 50 + (index * 250),
        positionY: baseY + 70,
        width: 150,
        height: 30,
        required: true,
      });
    }

    return fields;
  }

  /**
   * Flujo completo: crear documento con campos y obtener links de firma
   */
  async createDocumentAndGetSigningLinks(
    title: string,
    pdfBuffer: Buffer,
    contractType: ContractType,
    emails: string[]
  ): Promise<string[]> {
    try {
      console.log(`\n🔄 Iniciando flujo completo en Documenso para: ${title}`);

      // 1. Detectar líneas de firma en el PDF y generar campos automáticamente
      const { pageCount, fields } = await findSignatureLinesInPDF(pdfBuffer, contractType);

      console.log(`📝 Generados ${fields.length} campos de firma en ${pageCount} páginas`);

      // 2. Obtener configuración de firmantes
      const signerConfig = getSignerConfig(contractType);

      // 3. Si se requieren 2 firmantes pero solo se recibió 1 email, agregar el segundo
      const finalEmails = [...emails];
      if (signerConfig.signerCount === 2 && emails.length === 1) {
        const secondEmail = getSecondSignerEmail(contractType);
        if (secondEmail) {
          finalEmails.push(secondEmail);
          console.log(`✓ Agregado email del segundo firmante: ${secondEmail}`);
        } else {
          console.warn(`⚠️ Contrato requiere 2 firmantes pero no hay email hardcoded para: ${contractType}`);
        }
      }

      // Validar número de emails
      if (finalEmails.length !== signerConfig.signerCount) {
        console.warn(
          `⚠ Se esperaban ${signerConfig.signerCount} email(s) pero se tienen ${finalEmails.length}`
        );
      }

      // 4. Preparar recipients con nombres basados en roles
      const recipients: DocumensoRecipient[] = finalEmails.map((email, index) => ({
        email,
        name: signerConfig.signers[index]?.role || `Firmante ${index + 1}`,
        role: 'SIGNER',
      }));

      // 5. Crear documento usando el SDK (incluye subir PDF y agregar campos)
      const documentResponse = await this.createDocument(title, pdfBuffer, recipients, fields);

      // 6. Extraer URLs de firma desde la respuesta del SDK
      // Construir signing URLs usando el token de cada recipient
      const baseUrl = this.baseUrl.replace('/api/v2-beta', '');

      console.log(`📊 Recipients en respuesta: ${documentResponse?.recipients?.length || 0}`);
      console.log(`📧 Recipients:`, documentResponse?.recipients?.map((r: any) => ({ email: r.email, name: r.name, token: r.token?.substring(0, 10) + '...' })));

      const signingLinks = documentResponse?.recipients?.map((r: any) => {
        // Formato: https://domain.com/sign/{token}
        return `${baseUrl}/sign/${r.token}`;
      }) || [];

      console.log(`✅ ${signingLinks.length} link(s) de firma generados`);
      console.log(`📋 Links:`, signingLinks);

      return signingLinks;
    } catch (error: any) {
      console.error('❌ Error en flujo completo de Documenso:', error.message);
      throw error;
    }
  }

  /**
   * Verifica si el servicio Documenso está disponible
   */
  async checkHealth(): Promise<boolean> {
    try {
      // Intentamos listar documentos para verificar conectividad usando el SDK
      await this.client.documents.list({
        page: 1,
        perPage: 1,
      });
      console.log('✓ Documenso está disponible y listo');
      return true;
    } catch (error) {
      console.error('❌ Documenso no está disponible:', error);
      return false;
    }
  }
}

// Exportar instancia singleton
export const documensoService = new DocumensoService();
