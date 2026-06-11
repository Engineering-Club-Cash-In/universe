// src/services/satClientService.ts

import { XMLParser } from 'fast-xml-parser';
import * as fs from 'fs';
import * as path from 'path';
import { LookupInternalIdResponse, GetDocumentResponse, VoidDocumentResponse } from './types';

interface SATCredentials {
  requestor: string;
  user: string;
  userName: string;
  entity: string;
}

interface CertificacionRequest {
  xml: string;
  idInterno?: string;
}

interface CertificacionResponse {
  batch: string;
  serial: string;
  documentGUID: string;
  xmlCertificado: string;
}

function normalizarMensajeCofidi(mensaje: string): string {
  return mensaje
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function esDocumentoNoEncontrado(mensaje: string | undefined): boolean {
  if (!mensaje) return false;
  const normalizado = normalizarMensajeCofidi(mensaje);
  return (
    /(documento|dte|uuid).*no (se )?(encontro|encontrado|existe)/.test(normalizado) ||
    /no (se )?(encontro|existe).*(documento|dte|uuid)/.test(normalizado)
  );
}

export class SATClientService {
  private credentials: SATCredentials;
  private endpointUrl: string;
  private xmlParser: XMLParser;

  constructor(credentials: SATCredentials, endpointUrl: string) {
    this.credentials = credentials;
    this.endpointUrl = endpointUrl.trim();
    this.xmlParser = new XMLParser();
  }

  // 🔥 POST_DOCUMENT_SAT - Certificar documento
  async certificarDocumento(request: CertificacionRequest): Promise<CertificacionResponse> {
    try {
      console.log('📤 Certificando documento...');
      
      const xmlBase64 = Buffer.from(request.xml).toString('base64');

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const logsDir = path.join(process.cwd(), 'logs-dte');
      
      if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir, { recursive: true });
      }

      const xmlPath = path.join(logsDir, `dte-${timestamp}.xml`);
      fs.writeFileSync(xmlPath, request.xml, 'utf-8');
      console.log('📄 XML guardado en:', xmlPath);

      const soapRequest = this.construirSOAPCertificar(xmlBase64, request.idInterno);
      
      const soapPath = path.join(logsDir, `soap-request-${timestamp}.xml`);
      fs.writeFileSync(soapPath, soapRequest, 'utf-8');
      console.log('📄 SOAP Request guardado en:', soapPath);

      const response = await fetch(this.endpointUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/xml;charset=UTF-8'
        },
        body: soapRequest,
        signal: AbortSignal.timeout(60000)
      });

      console.log('📨 Response status:', response.status);

      if (!response.ok) {
        const errorText = await response.text();
        const errorPath = path.join(logsDir, `error-response-${timestamp}.html`);
        fs.writeFileSync(errorPath, errorText, 'utf-8');
        console.error('❌ Error guardado en:', errorPath);
        throw new Error(`Error en certificación: ${response.status} ${response.statusText}`);
      }

      const responseText = await response.text();
      const responsePath = path.join(logsDir, `response-${timestamp}.xml`);
      fs.writeFileSync(responsePath, responseText, 'utf-8');
      console.log('✅ Response guardado en:', responsePath);

      return this.parsearRespuestaCertificacion(responseText);

    } catch (error) {
      console.error('❌ Error al certificar documento:', error);
      throw error;
    }
  }

  private construirSOAPCertificar(xmlBase64: string, idInterno?: string): string {
    return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" 
               xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" 
               xmlns:xsd="http://www.w3.org/2001/XMLSchema">
  <soap:Body>
    <RequestTransaction xmlns="http://www.fact.com.mx/schema/ws">
      <Requestor>${this.credentials.requestor}</Requestor>
      <Transaction>SYSTEM_REQUEST</Transaction>
      <Country>GT</Country>
      <Entity>${this.credentials.entity}</Entity>
      <User>${this.credentials.user}</User>
      <UserName>${this.credentials.userName}</UserName>
      <Data1>POST_DOCUMENT_SAT</Data1>
      <Data2>${xmlBase64}</Data2>
      ${idInterno ? `<Data3>${idInterno}</Data3>` : ''}
    </RequestTransaction>
  </soap:Body>
</soap:Envelope>`;
  }

  private parsearRespuestaCertificacion(soapResponse: string): CertificacionResponse {
    try {
      const parsed = this.xmlParser.parse(soapResponse);
      const envelope = parsed['soap:Envelope'];
      if (!envelope) throw new Error('No se encontró soap:Envelope');

      const body = envelope['soap:Body'];
      if (!body) throw new Error('No se encontró soap:Body');

      const transactionResponse = body['RequestTransactionResponse'];
      if (!transactionResponse) throw new Error('No se encontró RequestTransactionResponse');

      const result = transactionResponse['RequestTransactionResult'];
      if (!result) throw new Error('No se encontró RequestTransactionResult');

      const response = result['Response'];
      if (!response) throw new Error('No se encontró Response');

      const resultSuccess = response['Result'] === 'true' || response['Result'] === true;
      const code = response['Code'];
      const description = response['Description'];
      const hint = response['Hint'];

      console.log('📊 Resultado:', {
        success: resultSuccess,
        code,
        description,
        hint
      });

      if (!resultSuccess) {
        throw new Error(`Certificación falló: ${description}. ${hint}`);
      }

      const identifier = response['Identifier'];
      if (!identifier) throw new Error('No se encontró Identifier');

      const batch = identifier['Batch'];
      const serial = identifier['Serial'];
      const documentGUID = identifier['DocumentGUID'];

      if (!batch || !serial || !documentGUID) {
        throw new Error('Respuesta incompleta: falta Batch, Serial o DocumentGUID');
      }

      const responseData = result['ResponseData'];
      const xmlBase64 = responseData?.['ResponseData1'] || '';

      console.log('✅ Certificación exitosa:', {
        batch,
        serial,
        uuid: documentGUID
      });

      return {
        batch,
        serial,
        documentGUID,
        xmlCertificado: xmlBase64
      };

    } catch (error) {
      console.error('❌ Error al parsear respuesta:', error);
      throw new Error(`Error al procesar respuesta de certificación: ${(error as Error).message}`);
    }
  }

  // 🔥 LOOKUP_ISSUED_INTERNAL_ID - Consultar por ID interno
  async consultarPorIdInterno(idInterno: string): Promise<LookupInternalIdResponse> {
    try {
      console.log('🔍 Consultando DTE con ID interno:', idInterno);

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const logsDir = path.join(process.cwd(), 'logs-dte');
      
      if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir, { recursive: true });
      }

      const soapRequest = this.construirSOAPLookup(idInterno);
      
      const soapPath = path.join(logsDir, `soap-lookup-${timestamp}.xml`);
      fs.writeFileSync(soapPath, soapRequest, 'utf-8');

      const response = await fetch(this.endpointUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/xml;charset=UTF-8'
        },
        body: soapRequest,
        signal: AbortSignal.timeout(60000)
      });

      const responseText = await response.text();
      const responsePath = path.join(logsDir, `response-lookup-${timestamp}.xml`);
      fs.writeFileSync(responsePath, responseText, 'utf-8');

      if (!response.ok) {
        throw new Error(`Error en consulta: ${response.status}`);
      }

      return this.parsearRespuestaLookup(responseText);

    } catch (error) {
      console.error('❌ Error al consultar DTE:', error);
      throw error;
    }
  }

  private construirSOAPLookup(idInterno: string): string {
    return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" 
               xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" 
               xmlns:xsd="http://www.w3.org/2001/XMLSchema">
  <soap:Body>
    <RequestTransaction xmlns="http://www.fact.com.mx/schema/ws">
      <Requestor>${this.credentials.requestor}</Requestor>
      <Transaction>LOOKUP_ISSUED_INTERNAL_ID</Transaction>
      <Country>GT</Country>
      <Entity>${this.credentials.entity}</Entity>
      <User>${this.credentials.user}</User>
      <UserName>${this.credentials.userName}</UserName>
      <Data1>${idInterno}</Data1>
      <Data2></Data2>
      <Data3></Data3>
    </RequestTransaction>
  </soap:Body>
</soap:Envelope>`;
  }

  private parsearRespuestaLookup(soapResponse: string): LookupInternalIdResponse {
    try {
      const parsed = this.xmlParser.parse(soapResponse);
      const result = parsed['soap:Envelope']?.['soap:Body']?.['RequestTransactionResponse']?.['RequestTransactionResult'];
      const response = result?.['Response'];
      
      const resultSuccess = response?.['Result'] === 'true' || response?.['Result'] === true;
      
      if (!resultSuccess) {
        return {
          encontrado: false,
          mensaje: response?.['Description'] || 'Documento no encontrado'
        };
      }

      const responseData = result?.['ResponseData'];
      const xmlBase64 = responseData?.['ResponseData2'];

      if (!xmlBase64) {
        return {
          encontrado: false,
          mensaje: 'No se encontró el XML certificado'
        };
      }

      return {
        encontrado: true,
        xmlCertificado: xmlBase64,
        mensaje: 'Documento encontrado exitosamente'
      };

    } catch (error) {
      console.error('❌ Error al parsear respuesta lookup:', error);
      throw error;
    }
  }

  // 🔥 GET_DOCUMENT - Obtener por UUID
  async obtenerPorUUID(uuid: string): Promise<GetDocumentResponse> {
    try {
      console.log('📥 Obteniendo DTE con UUID:', uuid);

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const logsDir = path.join(process.cwd(), 'logs-dte');
      
      if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir, { recursive: true });
      }

      const soapRequest = this.construirSOAPGet(uuid);
      
      const soapPath = path.join(logsDir, `soap-get-${timestamp}.xml`);
      fs.writeFileSync(soapPath, soapRequest, 'utf-8');

      const response = await fetch(this.endpointUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/xml;charset=UTF-8'
        },
        body: soapRequest,
        signal: AbortSignal.timeout(60000)
      });

      const responseText = await response.text();
      const responsePath = path.join(logsDir, `response-get-${timestamp}.xml`);
      fs.writeFileSync(responsePath, responseText, 'utf-8');

      if (!response.ok) {
        throw new Error(`Error al obtener documento: ${response.status}`);
      }

      return this.parsearRespuestaGet(responseText);

    } catch (error) {
      console.error('❌ Error al obtener DTE:', error);
      throw error;
    }
  }

  private construirSOAPGet(uuid: string): string {
    return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" 
               xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" 
               xmlns:xsd="http://www.w3.org/2001/XMLSchema">
  <soap:Body>
    <RequestTransaction xmlns="http://www.fact.com.mx/schema/ws">
      <Requestor>${this.credentials.requestor}</Requestor>
      <Transaction>GET_DOCUMENT</Transaction>
      <Country>GT</Country>
      <Entity>${this.credentials.entity}</Entity>
      <User>${this.credentials.user}</User>
      <UserName>${this.credentials.userName}</UserName>
      <Data1>${uuid}</Data1>
      <Data2></Data2>
      <Data3>XML</Data3>
    </RequestTransaction>
  </soap:Body>
</soap:Envelope>`;
  }

  private parsearRespuestaGet(soapResponse: string): GetDocumentResponse {
    try {
      const parsed = this.xmlParser.parse(soapResponse);
      const result = parsed['soap:Envelope']?.['soap:Body']?.['RequestTransactionResponse']?.['RequestTransactionResult'];
      const response = result?.['Response'];
      
      const resultSuccess = response?.['Result'] === 'true' || response?.['Result'] === true;
      
      if (!resultSuccess) {
        const mensaje = response?.['Description'];
        if (!esDocumentoNoEncontrado(mensaje)) {
          throw new Error(`GET_DOCUMENT fallo: ${mensaje || 'sin descripcion'}`);
        }

        return {
          encontrado: false,
          mensaje
        };
      }

      const responseData = result?.['ResponseData'];
      const xmlBase64 = responseData?.['ResponseData1'];

      return {
        encontrado: true,
        xmlCertificado: xmlBase64,
        mensaje: 'Documento obtenido exitosamente'
      };

    } catch (error) {
      console.error('❌ Error al parsear respuesta get:', error);
      throw error;
    }
  }

  // 🔥 VOID_DOCUMENT - Anular documento
  async anularDocumento(uuid: string, xmlAnulacion: string): Promise<VoidDocumentResponse> {
    try {
      console.log('🚫 Anulando DTE con UUID:', uuid);

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const logsDir = path.join(process.cwd(), 'logs-dte');
      
      if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir, { recursive: true });
      }

      const soapRequest = this.construirSOAPVoid(uuid, xmlAnulacion);
      
      const soapPath = path.join(logsDir, `soap-void-${timestamp}.xml`);
      fs.writeFileSync(soapPath, soapRequest, 'utf-8');

      const response = await fetch(this.endpointUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/xml;charset=UTF-8'
        },
        body: soapRequest,
        signal: AbortSignal.timeout(60000)
      });

      const responseText = await response.text();
      const responsePath = path.join(logsDir, `response-void-${timestamp}.xml`);
      fs.writeFileSync(responsePath, responseText, 'utf-8');

      if (!response.ok) {
        throw new Error(`Error al anular documento: ${response.status}`);
      }

      return this.parsearRespuestaVoid(responseText);

    } catch (error) {
      console.error('❌ Error al anular DTE:', error);
      throw error;
    }
  }

  private construirSOAPVoid(uuid: string, xmlAnulacion: string): string {
    return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" 
               xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" 
               xmlns:xsd="http://www.w3.org/2001/XMLSchema">
  <soap:Body>
    <RequestTransaction xmlns="http://www.fact.com.mx/schema/ws">
      <Requestor>${this.credentials.requestor}</Requestor>
      <Transaction>SYSTEM_REQUEST</Transaction>
      <Country>GT</Country>
      <Entity>${this.credentials.entity}</Entity>
      <User>${this.credentials.user}</User>
      <UserName>${this.credentials.userName}</UserName>
      <Data1>VOID_DOCUMENT</Data1>
      <Data2>${xmlAnulacion}</Data2>
      <Data3></Data3>
    </RequestTransaction>
  </soap:Body>
</soap:Envelope>`;
  }

  private parsearRespuestaVoid(soapResponse: string): VoidDocumentResponse {
    try {
      const parsed = this.xmlParser.parse(soapResponse);
      const result = parsed['soap:Envelope']?.['soap:Body']?.['RequestTransactionResponse']?.['RequestTransactionResult'];
      const response = result?.['Response'];
      
      const resultSuccess = response?.['Result'] === 'true' || response?.['Result'] === true;
      const description = response?.['Description'] || '';
      const processor = response?.['Processor'] || '';

      return {
        anulado: resultSuccess,
        descripcion: description,
        processor: processor,
        mensaje: resultSuccess ? 'Documento anulado exitosamente' : description
      };

    } catch (error) {
      console.error('❌ Error al parsear respuesta void:', error);
      throw error;
    }
  }

  // Método auxiliar para decodificar XML
  decodificarXMLCertificado(xmlBase64: string): string {
    return Buffer.from(xmlBase64, 'base64').toString('utf-8');
  }
}
