

// src/cofidi/nitXmlBuilder.ts

export class NITXmlBuilder {
  
  /**
   * Genera el XML SOAP para consulta de NIT
   */
  static generarXMLConsultaNIT(params: {
    nit: string;
    entity: string;
    requestor: string;
  }): string {
    const { nit, entity, requestor } = params;

    return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" 
               xmlns:xsd="http://www.w3.org/2001/XMLSchema" 
               xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <getNIT xmlns="http://tempuri.org/">
      <vNIT>${nit}</vNIT>
      <Entity>${entity}</Entity>
      <Requestor>${requestor}</Requestor>
    </getNIT>
  </soap:Body>
</soap:Envelope>`;
  }
}

// src/cofidi/nitGenerator.ts
// src/cofidi/nitGenerator.ts

import axios from 'axios';
import { XMLParser } from 'fast-xml-parser';

export class NITSoapClient {
  private endpointUrl: string;

  constructor(endpointUrl: string) {
    this.endpointUrl = endpointUrl;
  }

  /**
   * Consulta información de un NIT
   */
  async consultarNIT(params: {
    nit: string;
    entity: string;
    requestor: string;
  }): Promise<{ success: boolean; nombre?: string; error?: string }> {
    try {
      console.log('🔍 Consultando NIT:', params.nit);

      // 1. Generar XML SOAP
      const xmlSoap = this.generarXMLConsultaNIT(params);

      // 2. Hacer request SOAP
      const response = await axios.post(this.endpointUrl, xmlSoap, {
        headers: {
          'Content-Type': 'text/xml; charset=utf-8',
          'SOAPAction': 'http://tempuri.org/getNIT'
        }
      });

      console.log('📦 Response recibido de COFIDI');

      // 3. Parsear respuesta SOAP
      const parser = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: '@_',
        trimValues: true,
        // parseTagValue: false — un nombre registrado puramente numérico se
        // convertiría a número y perdería ceros iniciales (misma clase de bug
        // que la serie Infinity en satClientService)
        parseTagValue: false
      });

      const result = parser.parse(response.data);

      // 4. Extraer getNITResult (ya es un objeto, no XML string)
      const getNITResult = result['soap:Envelope']?.['soap:Body']?.['getNITResponse']?.['getNITResult'];
      
      if (!getNITResult) {
        console.error('❌ No se encontró getNITResult en la respuesta');
        return {
          success: false,
          error: 'Respuesta inválida del servicio'
        };
      }

      console.log('📄 getNITResult completo:', getNITResult);

      // 5. getNITResult YA ES UN OBJETO con Request y Response
      // No necesitamos parsearlo de nuevo
      const responseData = getNITResult.Response;

      if (!responseData) {
        console.error('❌ No se encontró Response en getNITResult');
        return {
          success: false,
          error: 'Estructura de respuesta inválida'
        };
      }

      console.log('📄 Response data:', responseData);

      // 6. Verificar si fue exitoso
      const isSuccess = responseData.Result === 'true' || responseData.Result === true;

      if (isSuccess && responseData.nombre) {
        console.log('✅ NIT consultado exitosamente:', responseData.nombre);
        
        return {
          success: true,
          nombre: responseData.nombre
        };
      } else {
        const errorMsg = responseData.error || 'NIT no encontrado';
        console.log('❌ NIT no encontrado:', errorMsg);
        
        return {
          success: false,
          error: errorMsg || 'NIT no encontrado en el registro'
        };
      }

    } catch (error) {
      console.error('❌ Error al consultar NIT:', error);
      
      if (axios.isAxiosError(error)) {
        console.error('📄 Response data:', error.response?.data);
        console.error('📄 Response status:', error.response?.status);
      }
      
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  /**
   * Genera XML SOAP para consulta de NIT
   */
  private generarXMLConsultaNIT(params: {
    nit: string;
    entity: string;
    requestor: string;
  }): string {
    const { nit, entity, requestor } = params;

    return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" 
               xmlns:xsd="http://www.w3.org/2001/XMLSchema" 
               xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <getNIT xmlns="http://tempuri.org/">
      <vNIT>${nit}</vNIT>
      <Entity>${entity}</Entity>
      <Requestor>${requestor}</Requestor>
    </getNIT>
  </soap:Body>
</soap:Envelope>`;
  }
}