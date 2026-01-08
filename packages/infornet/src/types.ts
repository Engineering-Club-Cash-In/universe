// Credenciales de autenticacion
export interface InfornetCredentials {
  username: string;
  password: string;
}

// Configuracion del cliente
export interface InfornetConfig {
  credentials: InfornetCredentials;
  wsdlUrl?: string;
  timeout?: number;
}

// Tipos de documento para busqueda
export type OrdenDocumento = 'DPI' | 'NIT' | 'LCA' | 'PAS' | '';

// Codigos de pais soportados
export type CodigoPais =
  | 'GT' // Guatemala
  | 'SV' // El Salvador
  | 'HN' // Honduras
  | 'NI' // Nicaragua
  | 'CR' // Costa Rica
  | 'PA' // Panama
  | 'MX' // Mexico
  | 'US' // Estados Unidos
  | 'CO' // Colombia
  | 'EC' // Ecuador
  | 'CA' // Canada
  | ''; // Todos los paises

// Parametros de busqueda de persona
export interface BusquedaPersonaParams {
  apellidos?: string;
  nombres?: string;
  orden?: OrdenDocumento;
  registro?: string;
  pais?: CodigoPais;
}

// Parametros de busqueda de empresa
export interface BusquedaEmpresaParams {
  razonSocial?: string;
  nombreComercial?: string;
  numeroTributario?: string;
  pais?: CodigoPais;
}

// Resultado de busqueda de persona
export interface PersonaResult {
  codigoPersona: number;
  nombre: string;
  sexo: 'M' | 'F';
  fechaNacimiento: string;
  edad: number;
  orden: string;
  registro: string;
  codigoMunicipio: string;
  codigoPais: string;
}

// Resultado de busqueda de empresa
export interface EmpresaResult {
  tipo: 'S' | 'P'; // S = Sociedad, P = Persona
  codigo: number;
  propietario: string;
  nombreComercial: string;
  nit: string;
  direccion: string;
  pais: string;
}

// Respuesta de about()
export interface AboutResponse {
  nombre: string;
  copyright: string;
  autor: string;
  version: string;
  licencia: string;
}

// Secciones del estudio de persona
export interface FichaPrincipalPersona {
  codigo: number;
  nombres: string;
  apellidos: string;
  sexo: string;
  fechaNacimiento: string;
  estadoCivil?: string;
  profesion?: string;
  nacionalidad?: string;
}

export interface DocumentoIdentidad {
  tipo: string;
  numero: string;
  fechaEmision?: string;
  fechaVencimiento?: string;
}

export interface Direccion {
  tipo: string;
  direccion: string;
  municipio?: string;
  departamento?: string;
  pais?: string;
  telefono?: string;
}

export interface PEP {
  esPEP: boolean;
  cargo?: string;
  institucion?: string;
  fechaInicio?: string;
  fechaFin?: string;
}

export interface Pariente {
  codigo: number;
  nombre: string;
  parentesco: string;
  esPEP?: boolean;
}

export interface ReferenciaJudicial {
  delitos: Delito[];
  involucrados: Involucrado[];
}

export interface Delito {
  tipo: string;
  descripcion: string;
  fecha?: string;
  estado?: string;
}

export interface Involucrado {
  codigo: number;
  nombre: string;
  rol: string;
}

export interface ReferenciaComercial {
  empresa: string;
  tipo: string;
  monto?: number;
  moneda?: string;
  estado?: string;
  fechaRegistro?: string;
}

export interface ReferenciaPrensa {
  medio: string;
  fecha: string;
  titulo: string;
  resumen?: string;
}

export interface ReferenciaMercantil {
  empresa: string;
  cargo: string;
  fechaInicio?: string;
  fechaFin?: string;
  estado?: string;
}

export interface Vehiculo {
  placa: string;
  marca: string;
  linea: string;
  modelo: string;
  color?: string;
}

export interface Inmueble {
  finca: string;
  folio: string;
  libro: string;
  ubicacion?: string;
  area?: string;
}

export interface Empleo {
  empresa: string;
  cargo: string;
  fechaInicio?: string;
  fechaFin?: string;
  salario?: number;
}

export interface ChequeGarantizado {
  numero: string;
  banco: string;
  monto: number;
  fecha: string;
  estado: string;
}

export interface ConsultaEfectuada {
  fecha: string;
  empresa: string;
  motivo?: string;
}

// Estudio completo de persona
export interface EstudioPersona {
  fichaPrincipal: FichaPrincipalPersona;
  documentos: DocumentoIdentidad[];
  direcciones: Direccion[];
  pep?: PEP;
  parientesPep: Pariente[];
  parientes: Pariente[];
  referenciasJudiciales: ReferenciaJudicial;
  referenciasPrensa: ReferenciaPrensa[];
  referenciasComerciales: ReferenciaComercial[];
  chequesGarantizados: ChequeGarantizado[];
  referenciasMercantiles: ReferenciaMercantil[];
  empresasPropiedad: EmpresaResult[];
  empleos: Empleo[];
  vehiculos: Vehiculo[];
  inmuebles: Inmueble[];
  consultasEfectuadas: ConsultaEfectuada[];
}

// Ficha principal de empresa
export interface FichaPrincipalEmpresa {
  codigo: number;
  razonSocial: string;
  nombreComercial?: string;
  nit: string;
  fechaConstitucion?: string;
  capital?: number;
  moneda?: string;
  giro?: string;
}

// Estudio completo de empresa
export interface EstudioEmpresa {
  fichaPrincipal: FichaPrincipalEmpresa;
  direcciones: Direccion[];
  referenciasJudiciales: ReferenciaJudicial;
  referenciasPrensa: ReferenciaPrensa[];
  referenciasComerciales: ReferenciaComercial[];
  referenciasMercantiles: ReferenciaMercantil[];
  empresasPropiedad: EmpresaResult[];
  vehiculos: Vehiculo[];
  inmuebles: Inmueble[];
  consultasEfectuadas: ConsultaEfectuada[];
}

// Respuesta generica de la API
export interface InfornetResponse<T> {
  success: boolean;
  data?: T;
  error?: InfornetErrorInfo;
}

// Informacion de error
export interface InfornetErrorInfo {
  codigo: InfornetErrorCode;
  mensaje: string;
}

// Codigos de error documentados
export type InfornetErrorCode =
  | '00001' // Debe ampliar su seleccion
  | '00002' // Ninguna entidad encontrada
  | '00003' // Verificar su acceso
  | '00004' // El usuario ha llegado al limite de consultas
  | '00005' // Requiere autorizacion del titular
  | '00006'; // El titular no autoriza divulgacion
