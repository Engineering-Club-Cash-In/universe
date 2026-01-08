import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { InfornetClient, createClientFromEnv } from '../src/client';
import {
  buildSoapEnvelope,
  buildBusquedaPersonaRequest,
  buildBusquedaEmpresaRequest,
  buildEstudioPersonaRequest,
  buildEstudioEmpresaRequest,
  buildAboutRequest,
  escapeXml,
  validateBusquedaPersonaParams,
  validateBusquedaEmpresaParams,
} from '../src/soap-builder';
import {
  parseBusquedaPersonaResponse,
  parseBusquedaEmpresaResponse,
  parseAboutResponse,
  parseEstudioPersonaResponse,
} from '../src/xml-parser';
import {
  InfornetError,
  SoapConnectionError,
  ValidationError,
  isInfornetError,
  isNotFoundError,
  isAuthorizationError,
  isLimitError,
} from '../src/errors';
import {
  BUSQUEDA_PERSONA_RESPONSE,
  BUSQUEDA_PERSONA_MULTIPLE_RESPONSE,
  BUSQUEDA_EMPRESA_RESPONSE,
  ABOUT_RESPONSE,
  ESTUDIO_PERSONA_RESPONSE,
  ERROR_NO_ENCONTRADO_RESPONSE,
  ERROR_ACCESO_RESPONSE,
  ERROR_LIMITE_RESPONSE,
  ERROR_AMPLIAR_SELECCION_RESPONSE,
  SOAP_FAULT_RESPONSE,
} from './fixtures/responses';
import {
  TEST_CREDENTIALS,
  BUSQUEDA_PERSONA_POR_DPI,
  BUSQUEDA_PERSONA_POR_NOMBRE,
  BUSQUEDA_EMPRESA_POR_NIT,
  PERSONA_ESPERADA,
  EMPRESA_ESPERADA,
  CODIGO_PERSONA_TEST,
} from './fixtures/test-data';

describe('SOAP Builder', () => {
  describe('escapeXml', () => {
    it('deberia escapar caracteres especiales XML', () => {
      expect(escapeXml('a & b')).toBe('a &amp; b');
      expect(escapeXml('<tag>')).toBe('&lt;tag&gt;');
      expect(escapeXml('"quoted"')).toBe('&quot;quoted&quot;');
      expect(escapeXml("it's")).toBe('it&apos;s');
    });

    it('deberia manejar strings vacios', () => {
      expect(escapeXml('')).toBe('');
    });
  });

  describe('buildSoapEnvelope', () => {
    it('deberia incluir header con UsernameToken', () => {
      const envelope = buildSoapEnvelope(TEST_CREDENTIALS, '<test/>');
      expect(envelope).toContain('UsernameToken');
      expect(envelope).toContain(TEST_CREDENTIALS.username);
      expect(envelope).toContain(TEST_CREDENTIALS.password);
    });

    it('deberia incluir el body content', () => {
      const bodyContent = '<myMethod>test</myMethod>';
      const envelope = buildSoapEnvelope(TEST_CREDENTIALS, bodyContent);
      expect(envelope).toContain(bodyContent);
    });

    it('deberia tener estructura SOAP valida', () => {
      const envelope = buildSoapEnvelope(TEST_CREDENTIALS, '<test/>');
      expect(envelope).toContain('<?xml version="1.0"');
      expect(envelope).toContain('soap:Envelope');
      expect(envelope).toContain('soap:Header');
      expect(envelope).toContain('soap:Body');
    });
  });

  describe('buildBusquedaPersonaRequest', () => {
    it('deberia construir request con parametros de DPI', () => {
      const request = buildBusquedaPersonaRequest(TEST_CREDENTIALS, BUSQUEDA_PERSONA_POR_DPI);
      expect(request).toContain('busqueda_persona');
      expect(request).toContain('DPI');
      expect(request).toContain('1234567890101');
      expect(request).toContain('GT');
    });

    it('deberia construir request con parametros de nombre', () => {
      const request = buildBusquedaPersonaRequest(TEST_CREDENTIALS, BUSQUEDA_PERSONA_POR_NOMBRE);
      expect(request).toContain('busqueda_persona');
      expect(request).toContain('perez perez');
      expect(request).toContain('juan jose');
    });

    it('deberia manejar parametros vacios', () => {
      const request = buildBusquedaPersonaRequest(TEST_CREDENTIALS, {});
      expect(request).toContain('busqueda_persona');
      expect(request).toContain('<apellidos');
      expect(request).toContain('<nombres');
    });
  });

  describe('buildBusquedaEmpresaRequest', () => {
    it('deberia construir request con NIT', () => {
      const request = buildBusquedaEmpresaRequest(TEST_CREDENTIALS, BUSQUEDA_EMPRESA_POR_NIT);
      expect(request).toContain('busqueda_empresa');
      expect(request).toContain('12345678');
    });
  });

  describe('buildEstudioPersonaRequest', () => {
    it('deberia incluir codigo de persona', () => {
      const request = buildEstudioPersonaRequest(TEST_CREDENTIALS, CODIGO_PERSONA_TEST);
      expect(request).toContain('estudio_persona');
      expect(request).toContain(String(CODIGO_PERSONA_TEST));
    });
  });

  describe('buildAboutRequest', () => {
    it('deberia construir request de about', () => {
      const request = buildAboutRequest(TEST_CREDENTIALS);
      expect(request).toContain('about');
    });
  });

  describe('validateBusquedaPersonaParams', () => {
    it('deberia aceptar busqueda por nombre', () => {
      expect(() => validateBusquedaPersonaParams({ apellidos: 'perez' })).not.toThrow();
      expect(() => validateBusquedaPersonaParams({ nombres: 'juan' })).not.toThrow();
    });

    it('deberia aceptar busqueda por documento', () => {
      expect(() => validateBusquedaPersonaParams({ orden: 'DPI', registro: '123' })).not.toThrow();
    });

    it('deberia rechazar busqueda sin parametros', () => {
      expect(() => validateBusquedaPersonaParams({})).toThrow();
    });
  });

  describe('validateBusquedaEmpresaParams', () => {
    it('deberia aceptar busqueda por razon social', () => {
      expect(() => validateBusquedaEmpresaParams({ razonSocial: 'acme' })).not.toThrow();
    });

    it('deberia aceptar busqueda por NIT', () => {
      expect(() => validateBusquedaEmpresaParams({ numeroTributario: '123' })).not.toThrow();
    });

    it('deberia rechazar busqueda sin parametros', () => {
      expect(() => validateBusquedaEmpresaParams({})).toThrow();
    });
  });
});

describe('XML Parser', () => {
  describe('parseBusquedaPersonaResponse', () => {
    it('deberia parsear respuesta exitosa', () => {
      const result = parseBusquedaPersonaResponse(BUSQUEDA_PERSONA_RESPONSE);
      expect(result).toHaveLength(1);
      expect(result[0].codigoPersona).toBe(PERSONA_ESPERADA.codigoPersona);
      expect(result[0].nombre).toBe(PERSONA_ESPERADA.nombre);
      expect(result[0].sexo).toBe(PERSONA_ESPERADA.sexo);
    });

    it('deberia parsear multiples personas', () => {
      const result = parseBusquedaPersonaResponse(BUSQUEDA_PERSONA_MULTIPLE_RESPONSE);
      expect(result).toHaveLength(2);
      expect(result[0].codigoPersona).toBe(2150350);
      expect(result[1].codigoPersona).toBe(2150351);
    });

    it('deberia lanzar InfornetError en error 00002', () => {
      expect(() => parseBusquedaPersonaResponse(ERROR_NO_ENCONTRADO_RESPONSE)).toThrow(InfornetError);
      try {
        parseBusquedaPersonaResponse(ERROR_NO_ENCONTRADO_RESPONSE);
      } catch (e) {
        expect((e as InfornetError).codigo).toBe('00002');
      }
    });

    it('deberia lanzar InfornetError en error de acceso', () => {
      expect(() => parseBusquedaPersonaResponse(ERROR_ACCESO_RESPONSE)).toThrow(InfornetError);
      try {
        parseBusquedaPersonaResponse(ERROR_ACCESO_RESPONSE);
      } catch (e) {
        expect((e as InfornetError).codigo).toBe('00003');
      }
    });

    it('deberia lanzar InfornetError en error de limite', () => {
      expect(() => parseBusquedaPersonaResponse(ERROR_LIMITE_RESPONSE)).toThrow(InfornetError);
      try {
        parseBusquedaPersonaResponse(ERROR_LIMITE_RESPONSE);
      } catch (e) {
        expect((e as InfornetError).codigo).toBe('00004');
      }
    });
  });

  describe('parseBusquedaEmpresaResponse', () => {
    it('deberia parsear respuesta exitosa', () => {
      const result = parseBusquedaEmpresaResponse(BUSQUEDA_EMPRESA_RESPONSE);
      expect(result).toHaveLength(1);
      expect(result[0].codigo).toBe(EMPRESA_ESPERADA.codigo);
      expect(result[0].propietario).toBe(EMPRESA_ESPERADA.propietario);
      expect(result[0].nit).toBe(EMPRESA_ESPERADA.nit);
    });
  });

  describe('parseAboutResponse', () => {
    it('deberia parsear respuesta de about', () => {
      const result = parseAboutResponse(ABOUT_RESPONSE);
      expect(result.nombre).toBe('INETWS');
      expect(result.version).toBe('3.0');
      expect(result.autor).toBe('Gabriel Paz');
    });
  });

  describe('parseEstudioPersonaResponse', () => {
    it('deberia parsear estudio completo', () => {
      const result = parseEstudioPersonaResponse(ESTUDIO_PERSONA_RESPONSE);

      // Ficha principal
      expect(result.fichaPrincipal.codigo).toBe(2150350);
      expect(result.fichaPrincipal.nombres).toBe('JUAN JOSE');
      expect(result.fichaPrincipal.apellidos).toBe('PEREZ PEREZ');

      // Documentos
      expect(result.documentos).toHaveLength(1);
      expect(result.documentos[0].tipo).toBe('DPI');

      // Direcciones
      expect(result.direcciones).toHaveLength(1);
      expect(result.direcciones[0].tipo).toBe('RESIDENCIAL');

      // Parientes
      expect(result.parientes).toHaveLength(1);
      expect(result.parientes[0].parentesco).toBe('ESPOSA');

      // Referencias comerciales
      expect(result.referenciasComerciales).toHaveLength(1);
      expect(result.referenciasComerciales[0].empresa).toBe('BANCO INDUSTRIAL');

      // Vehiculos
      expect(result.vehiculos).toHaveLength(1);
      expect(result.vehiculos[0].placa).toBe('P123ABC');

      // Inmuebles
      expect(result.inmuebles).toHaveLength(1);
      expect(result.inmuebles[0].finca).toBe('12345');
    });
  });
});

describe('Errors', () => {
  describe('InfornetError', () => {
    it('deberia crear error con codigo y mensaje', () => {
      const error = new InfornetError('00002');
      expect(error.codigo).toBe('00002');
      expect(error.message).toContain('Ninguna entidad');
    });

    it('deberia crear error desde codigo string', () => {
      const error = InfornetError.fromCode('00003');
      expect(error.codigo).toBe('00003');
    });
  });

  describe('Error helpers', () => {
    it('isInfornetError deberia identificar errores de Infornet', () => {
      const infornetError = new InfornetError('00002');
      const genericError = new Error('test');

      expect(isInfornetError(infornetError)).toBe(true);
      expect(isInfornetError(genericError)).toBe(false);
    });

    it('isNotFoundError deberia identificar error 00002', () => {
      const notFoundError = new InfornetError('00002');
      const otherError = new InfornetError('00003');

      expect(isNotFoundError(notFoundError)).toBe(true);
      expect(isNotFoundError(otherError)).toBe(false);
    });

    it('isAuthorizationError deberia identificar errores de autorizacion', () => {
      expect(isAuthorizationError(new InfornetError('00003'))).toBe(true);
      expect(isAuthorizationError(new InfornetError('00005'))).toBe(true);
      expect(isAuthorizationError(new InfornetError('00006'))).toBe(true);
      expect(isAuthorizationError(new InfornetError('00002'))).toBe(false);
    });

    it('isLimitError deberia identificar error 00004', () => {
      expect(isLimitError(new InfornetError('00004'))).toBe(true);
      expect(isLimitError(new InfornetError('00002'))).toBe(false);
    });
  });
});

describe('InfornetClient', () => {
  describe('constructor', () => {
    it('deberia crear cliente con credenciales', () => {
      const client = new InfornetClient(TEST_CREDENTIALS);
      expect(client).toBeDefined();
    });

    it('deberia crear cliente con config completa', () => {
      const client = new InfornetClient({
        credentials: TEST_CREDENTIALS,
        wsdlUrl: 'https://custom.url',
        timeout: 5000,
      });
      expect(client).toBeDefined();
    });

    it('deberia lanzar error sin credenciales', () => {
      expect(() => new InfornetClient({ username: '', password: '' })).toThrow(ValidationError);
    });
  });

  describe('createClientFromEnv', () => {
    beforeEach(() => {
      process.env.INFORNET_USERNAME = 'env_user';
      process.env.INFORNET_PASSWORD = 'env_pass';
    });

    afterEach(() => {
      delete process.env.INFORNET_USERNAME;
      delete process.env.INFORNET_PASSWORD;
    });

    it('deberia crear cliente desde variables de entorno', () => {
      const client = createClientFromEnv();
      expect(client).toBeDefined();
    });

    it('deberia lanzar error sin variables de entorno', () => {
      delete process.env.INFORNET_USERNAME;
      expect(() => createClientFromEnv()).toThrow(ValidationError);
    });
  });

  describe('validaciones de parametros', () => {
    const client = new InfornetClient(TEST_CREDENTIALS);

    it('estudioPersona deberia validar codigo', async () => {
      await expect(client.estudioPersona(0)).rejects.toThrow(ValidationError);
      await expect(client.estudioPersona(-1)).rejects.toThrow(ValidationError);
    });

    it('estudioEmpresa deberia validar codigo', async () => {
      await expect(client.estudioEmpresa(0)).rejects.toThrow(ValidationError);
      await expect(client.estudioEmpresa(-1)).rejects.toThrow(ValidationError);
    });
  });
});

describe('Client con mock de fetch', () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('deberia hacer peticion SOAP y parsear respuesta', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(BUSQUEDA_PERSONA_RESPONSE),
    });

    const client = new InfornetClient(TEST_CREDENTIALS);
    const result = await client.busquedaPersona(BUSQUEDA_PERSONA_POR_DPI);

    expect(result).toHaveLength(1);
    expect(result[0].codigoPersona).toBe(2150350);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('deberia manejar errores HTTP', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      text: () => Promise.resolve('Error'),
    });

    const client = new InfornetClient(TEST_CREDENTIALS);
    await expect(client.busquedaPersona(BUSQUEDA_PERSONA_POR_DPI)).rejects.toThrow(SoapConnectionError);
  });

  it('deberia manejar errores de conexion', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

    const client = new InfornetClient(TEST_CREDENTIALS);
    await expect(client.busquedaPersona(BUSQUEDA_PERSONA_POR_DPI)).rejects.toThrow(SoapConnectionError);
  });

  it('deberia propagar InfornetError desde respuesta', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(ERROR_NO_ENCONTRADO_RESPONSE),
    });

    const client = new InfornetClient(TEST_CREDENTIALS);
    await expect(client.busquedaPersona(BUSQUEDA_PERSONA_POR_DPI)).rejects.toThrow(InfornetError);
  });
});
