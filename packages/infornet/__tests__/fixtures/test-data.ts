/**
 * Datos de prueba para tests
 */

import type {
  InfornetCredentials,
  BusquedaPersonaParams,
  BusquedaEmpresaParams,
} from '../../src/types';

// Credenciales de prueba (mock)
export const TEST_CREDENTIALS: InfornetCredentials = {
  username: 'test_user',
  password: 'test_password',
};

// Parametros de busqueda de persona por DPI
export const BUSQUEDA_PERSONA_POR_DPI: BusquedaPersonaParams = {
  orden: 'DPI',
  registro: '1234567890101',
  pais: 'GT',
};

// Parametros de busqueda de persona por nombre
export const BUSQUEDA_PERSONA_POR_NOMBRE: BusquedaPersonaParams = {
  apellidos: 'perez perez',
  nombres: 'juan jose',
  pais: 'GT',
};

// Parametros de busqueda de persona con comodin
export const BUSQUEDA_PERSONA_CON_COMODIN: BusquedaPersonaParams = {
  apellidos: 'pere%',
  nombres: 'juan',
  pais: 'GT',
};

// Parametros de busqueda de empresa por NIT
export const BUSQUEDA_EMPRESA_POR_NIT: BusquedaEmpresaParams = {
  numeroTributario: '12345678',
};

// Parametros de busqueda de empresa por razon social
export const BUSQUEDA_EMPRESA_POR_RAZON_SOCIAL: BusquedaEmpresaParams = {
  razonSocial: 'acme',
  pais: 'GT',
};

// Codigos de prueba
export const CODIGO_PERSONA_TEST = 2150350;
export const CODIGO_EMPRESA_TEST = 3610637;

// Valores esperados de persona
export const PERSONA_ESPERADA = {
  codigoPersona: 2150350,
  nombre: 'PEREZ PEREZ, JUAN JOSE',
  sexo: 'M' as const,
  fechaNacimiento: '08/05/1970',
  edad: 39,
  orden: 'A-01',
  registro: '799045',
  codigoMunicipio: 'GUA',
  codigoPais: 'GTM',
};

// Valores esperados de empresa
export const EMPRESA_ESPERADA = {
  tipo: 'S' as const,
  codigo: 3610637,
  propietario: 'ACME SOCIEDAD ANONIMA',
  nombreComercial: 'ACME S.A.',
  nit: '12345678',
  direccion: '6a. Avenida 1-23 Zona 10',
  pais: 'GTM',
};

// Tipos de documento validos
export const TIPOS_DOCUMENTO = ['DPI', 'NIT', 'LCA', 'PAS'] as const;

// Codigos de pais validos
export const CODIGOS_PAIS = [
  'GT', 'SV', 'HN', 'NI', 'CR', 'PA', 'MX', 'US', 'CO', 'EC', 'CA'
] as const;

// URLs de prueba
export const TEST_WSDL_URL = 'https://right.infor.net/inetws/inetws.php?get_wsdl=1';
export const TEST_ENDPOINT_URL = 'https://right.infor.net/inetws/inetws.php';
