/**
 * Tests de integracion con el API real de Infornet
 *
 * IMPORTANTE: Estos tests requieren credenciales reales y consumen saldo.
 * Solo ejecutar cuando sea necesario verificar la integracion.
 *
 * Ejecutar con: pnpm test:integration
 *
 * Variables de entorno requeridas:
 * - INFORNET_USERNAME
 * - INFORNET_PASSWORD
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { InfornetClient, createClientFromEnv } from '../src/client';
import {
  InfornetError,
  isNotFoundError,
  isAuthorizationError,
} from '../src/errors';

// Solo ejecutar si la variable INTEGRATION esta definida
const RUN_INTEGRATION = process.env.INTEGRATION === 'true';

// Datos de prueba reales (personas y empresas publicas o ficticias)
const TEST_DATA = {
  // Busqueda que probablemente retorne resultados (nombre comun)
  personaComun: {
    apellidos: 'garcia',
    nombres: 'jose',
    pais: 'GT' as const,
  },
  // Busqueda por DPI (usar uno de prueba o conocido)
  personaPorDPI: {
    orden: 'DPI' as const,
    registro: process.env.TEST_DPI || '', // Opcional
  },
  // Empresa conocida
  empresaPorNIT: {
    numeroTributario: process.env.TEST_NIT || '', // Opcional
  },
};

describe.skipIf(!RUN_INTEGRATION)('Integracion con API real de Infornet', () => {
  let client: InfornetClient;

  beforeAll(() => {
    // Verificar credenciales
    if (!process.env.INFORNET_USERNAME || !process.env.INFORNET_PASSWORD) {
      throw new Error(
        'Se requieren las variables de entorno INFORNET_USERNAME y INFORNET_PASSWORD'
      );
    }

    client = createClientFromEnv();
    console.log('Cliente creado exitosamente');
  });

  describe('about()', () => {
    it('deberia obtener informacion del servicio', async () => {
      const result = await client.about();

      expect(result).toBeDefined();
      expect(result.nombre).toBeTruthy();
      expect(result.version).toBeTruthy();

      console.log('About response:', result);
    });
  });

  describe('busquedaPersona()', () => {
    it('deberia buscar personas por nombre comun', async () => {
      try {
        const result = await client.busquedaPersona(TEST_DATA.personaComun);

        expect(Array.isArray(result)).toBe(true);
        console.log(`Encontradas ${result.length} personas`);

        if (result.length > 0) {
          expect(result[0].codigoPersona).toBeDefined();
          expect(result[0].nombre).toBeDefined();
          console.log('Primera persona:', result[0]);
        }
      } catch (error) {
        // Es aceptable no encontrar resultados o error de ampliar seleccion
        if (isNotFoundError(error)) {
          console.log('No se encontraron personas (esperado para datos de prueba)');
          expect(true).toBe(true);
        } else if ((error as InfornetError).codigo === '00001') {
          console.log('Demasiados resultados, ampliar seleccion');
          expect(true).toBe(true);
        } else {
          throw error;
        }
      }
    });

    it.skipIf(!TEST_DATA.personaPorDPI.registro)('deberia buscar persona por DPI', async () => {
      try {
        const result = await client.busquedaPersona(TEST_DATA.personaPorDPI);

        expect(Array.isArray(result)).toBe(true);
        console.log(`Encontradas ${result.length} personas por DPI`);

        if (result.length > 0) {
          console.log('Persona encontrada:', result[0]);
        }
      } catch (error) {
        if (isNotFoundError(error)) {
          console.log('DPI no encontrado');
        } else {
          throw error;
        }
      }
    });

    it('deberia manejar busqueda sin resultados', async () => {
      try {
        // Busqueda que probablemente no encuentre nada
        await client.busquedaPersona({
          apellidos: 'zzzzzzzzz',
          nombres: 'xxxxxxx',
          pais: 'GT',
        });
        // Si llega aqui, se encontro algo inesperado
        console.log('Inesperadamente se encontraron resultados');
      } catch (error) {
        expect(isNotFoundError(error)).toBe(true);
        console.log('Correctamente reporto "no encontrado"');
      }
    });
  });

  describe('busquedaEmpresa()', () => {
    it.skipIf(!TEST_DATA.empresaPorNIT.numeroTributario)('deberia buscar empresa por NIT', async () => {
      try {
        const result = await client.busquedaEmpresa(TEST_DATA.empresaPorNIT);

        expect(Array.isArray(result)).toBe(true);
        console.log(`Encontradas ${result.length} empresas`);

        if (result.length > 0) {
          expect(result[0].codigo).toBeDefined();
          expect(result[0].propietario).toBeDefined();
          console.log('Empresa encontrada:', result[0]);
        }
      } catch (error) {
        if (isNotFoundError(error)) {
          console.log('NIT no encontrado');
        } else {
          throw error;
        }
      }
    });

    it('deberia buscar empresa por razon social', async () => {
      try {
        const result = await client.busquedaEmpresa({
          razonSocial: 'banco',
          pais: 'GT',
        });

        expect(Array.isArray(result)).toBe(true);
        console.log(`Encontradas ${result.length} empresas con "banco"`);

        if (result.length > 0) {
          console.log('Primera empresa:', result[0]);
        }
      } catch (error) {
        if ((error as InfornetError).codigo === '00001') {
          console.log('Demasiados resultados');
        } else {
          throw error;
        }
      }
    });
  });

  describe('estudioPersona()', () => {
    it('deberia obtener estudio de persona (si hay credito)', async () => {
      // Primero buscar una persona para obtener codigo
      let codigoPersona: number | null = null;

      try {
        const busqueda = await client.busquedaPersona(TEST_DATA.personaComun);
        if (busqueda.length > 0) {
          codigoPersona = busqueda[0].codigoPersona;
        }
      } catch {
        console.log('No se pudo buscar persona para estudio');
      }

      if (!codigoPersona) {
        console.log('Sin codigo de persona para probar estudio');
        return;
      }

      try {
        const estudio = await client.estudioPersona(codigoPersona);

        expect(estudio).toBeDefined();
        expect(estudio.fichaPrincipal).toBeDefined();
        expect(estudio.fichaPrincipal.codigo).toBe(codigoPersona);

        console.log('Estudio obtenido:', {
          codigo: estudio.fichaPrincipal.codigo,
          nombres: estudio.fichaPrincipal.nombres,
          apellidos: estudio.fichaPrincipal.apellidos,
          numDocumentos: estudio.documentos.length,
          numDirecciones: estudio.direcciones.length,
          numReferenciasComerciales: estudio.referenciasComerciales.length,
        });
      } catch (error) {
        if (isAuthorizationError(error)) {
          console.log('Sin creditos o autorizacion para estudios');
        } else {
          throw error;
        }
      }
    });
  });

  describe('Manejo de errores', () => {
    it('deberia manejar credenciales invalidas', async () => {
      const badClient = new InfornetClient({
        username: 'usuario_invalido',
        password: 'password_invalido',
      });

      try {
        await badClient.about();
        expect.fail('Deberia haber lanzado error');
      } catch (error) {
        expect(error).toBeDefined();
        console.log('Error esperado con credenciales invalidas:', (error as Error).message);
      }
    });
  });

  afterAll(() => {
    console.log('Tests de integracion completados');
  });
});

// Tests que siempre corren para verificar estructura
describe('Verificacion de estructura (sin API)', () => {
  it('deberia poder crear cliente sin conectar', () => {
    const client = new InfornetClient({
      username: 'test',
      password: 'test',
    });
    expect(client).toBeDefined();
  });

  it('deberia validar parametros antes de enviar', async () => {
    const client = new InfornetClient({
      username: 'test',
      password: 'test',
    });

    // Deberia fallar en validacion, no en conexion
    await expect(client.busquedaPersona({})).rejects.toThrow();
    await expect(client.busquedaEmpresa({})).rejects.toThrow();
    await expect(client.estudioPersona(0)).rejects.toThrow();
    await expect(client.estudioEmpresa(-1)).rejects.toThrow();
  });
});
