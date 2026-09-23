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
  AnyContractData,
  SignerRole,
  type ContractSigner
} from '../types/contract';
import { GenderTranslator, Gender, MaritalStatus } from './GenderTranslator';
import { documensoService } from './DocumensoService';
import { WeeTrustService } from './WeeTrustService';
import { getSignatureMode, SignatureLayoutError } from './signaturePatterns';
import { crmApiService } from './CrmApiService';
import { uploadPdfToR2, urlFirmadaDePdf } from './R2Service';

/** Texto legible de un error desconocido, para reportarlo al CRM. */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Nombre con el que el documento se ve en WeeTrust y en el correo de firma.
 *
 * Es lo que lee el cliente, así que dice quién firma y qué está firmando:
 * "Albertsond Gabriel Velásquez Ramírez - Pagaré único libre de protesto".
 *
 * No es el nombre de archivo. El de archivo lleva el tipo de contrato y un
 * timestamp porque tiene que ser único en R2; arrastrar eso hasta WeeTrust
 * producía nombres como
 * `Albertsond_Gabriel_..._pagare_unico_libre_protesto_pagare_unico_libre_protesto_2026-09-23T16-21-33`,
 * con el tipo repetido (el CRM ya lo mandaba en el prefijo y acá se volvía a
 * pegar) y el timestamp a la vista.
 */
function nombreDeDocumento(
  nombrePersona: string | undefined,
  descripcion: string,
  /**
   * El identificador técnico del tipo. Las fotos de generación guardadas antes
   * de separar los nombres traen el prefijo como `<nombre>_<tipo>`, y al
   * regenerarlas el tipo se colaba en lo que lee el cliente: compararlo con la
   * descripción no lo detecta ("pagare_unico_libre_protesto" no contiene
   * "Pagaré único libre de protesto", por las tildes y el "de").
   */
  contractType?: string,
): string {
  const sinTipo =
    contractType && nombrePersona
      ? nombrePersona.split(contractType).join(' ')
      : nombrePersona;
  const persona = (sinTipo ?? '')
    .replace(/\.pdf$/i, '')
    .replace(/[_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Sin nombre de persona queda la descripción sola: es preferible a inventar
  // un nombre o a dejar el identificador técnico del tipo de contrato.
  //
  // Y si lo que llegó como "persona" ya es la descripción (o la contiene),
  // tampoco se pega dos veces: de ahí salían los nombres con el tipo repetido.
  const normalizar = (t: string) => t.toLowerCase().replace(/[\s_-]+/g, ' ').trim();
  const yaLaDice = normalizar(persona).includes(normalizar(descripcion));
  const completo = persona && !yaLaDice ? `${persona} - ${descripcion}` : persona || descripcion;
  return completo.slice(0, 150);
}

// Instancia de WeeTrust (servicio principal de firma)
// Si WEETRUST_DISABLED=true o faltan credenciales, queda como null y se usa Documenso directo.
const weeTrustService: WeeTrustService | null = (() => {
  if (process.env.WEETRUST_DISABLED === 'true') {
    console.log('[WeeTrust] Deshabilitado por WEETRUST_DISABLED=true. Usando Documenso.');
    return null;
  }
  try {
    return new WeeTrustService();
  } catch (err) {
    console.warn('[WeeTrust] No inicializado (faltan credenciales). Se usará Documenso:', err);
    return null;
  }
})();

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
  // Timeouts duros. Bajo Bun, el `timeout` de axios NO corta una respuesta que llegó a medias
  // (headers recibidos, cuerpo que nunca termina): la promesa quedaba viva y el slot tomado para siempre.
  // Con 3 slots tomados, toda conversión posterior esperaba en la cola sin log ni error.
  private readonly pdfTimeoutMs: number;
  private readonly pdfQueueTimeoutMs: number;
  // Gotenberg se traba de vez en cuando en una conversión suelta y la siguiente sale en
  // menos de un segundo, así que el reintento resuelve el caso normal sin que nadie se entere.
  private readonly pdfConversionAttempts: number;

  constructor(options: ContractGeneratorOptions = {}) {
    this.gotenbergUrl = options.gotenbergUrl || 'http://localhost:3000';
    // 20 s con 3 intentos y no 60 s de una sola oportunidad: el p99 real de estas
    // conversiones es 1.8 s, así que esperar un minuto solo alarga el fallo.
    this.pdfTimeoutMs = options.pdfTimeoutMs ?? 20000;
    this.pdfQueueTimeoutMs = options.pdfQueueTimeoutMs ?? 90000;
    this.pdfConversionAttempts = Math.max(1, options.pdfConversionAttempts ?? 3);
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

    // Registrar cobertura placas particulares (no tiene género, solo singular y plural)
    this.registerTemplate({
      type: ContractType.COBERTURA_INREXSA,
      templateFilename: 'cobertura_inrexsa/CARTA_COBERTURA_PLACAS_PARTICULARES.docx',
      templateFilenameFemale: 'cobertura_inrexsa/CARTA_COBERTURA_PLACAS_PARTICULARES.docx',
      templateFilenamePlural: 'cobertura_inrexsa/CARTA_COBERTURA_PLACAS_PARTICULARES_PLURAL.docx',
      templateFilenameFemalePlural: 'cobertura_inrexsa/CARTA_COBERTURA_PLACAS_PARTICULARES_PLURAL.docx',
      description: 'Carta de cobertura placas particulares',
      requiredFields: [
        'nombreCompleto',
      ]
    });

    // Registrar cobertura placas comerciales (no tiene género, solo singular y plural)
    this.registerTemplate({
      type: ContractType.COBERTURA_INREXSA_COMERCIAL,
      templateFilename: 'cobertura_inrexsa/CARTA_COBERTURA_PLACAS_COMERCIALES.docx',
      templateFilenameFemale: 'cobertura_inrexsa/CARTA_COBERTURA_PLACAS_COMERCIALES.docx',
      templateFilenamePlural: 'cobertura_inrexsa/CARTA_COBERTURA_PLACAS_COMERCIALES_PLURAL.docx',
      templateFilenameFemalePlural: 'cobertura_inrexsa/CARTA_COBERTURA_PLACAS_COMERCIALES_PLURAL.docx',
      description: 'Carta de cobertura placas comerciales',
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

    // ===== INVERSIONES =====
    this.registerTemplate({
      type: ContractType.ACUERDO_INVERSION_CASH_IN,
      templateFilename: 'inversiones/acuerdo_inversion/acuerdo_inversion_hombre.docx',
      templateFilenameFemale: 'inversiones/acuerdo_inversion/acuerdo_inversion_mujer.docx',
      description: 'Acuerdo de Inversión Cash In',
      requiredFields: []
    });

    this.registerTemplate({
      type: ContractType.CARTA_CONFIRMACION_INVERSION_INICIAL,
      templateFilename: 'inversiones/anexo1/carta_confirmacion_hombre.docx',
      templateFilenameFemale: 'inversiones/anexo1/carta_confirmacion_mujer.docx',
      description: 'Anexo 1 - Carta de Confirmación de Inversión Inicial',
      requiredFields: []
    });

    this.registerTemplate({
      type: ContractType.CARTA_ELECCION_MODALIDAD_PAGO_REINVERSION,
      templateFilename: 'inversiones/anexo2/carta_eleccion_hombre.docx',
      templateFilenameFemale: 'inversiones/anexo2/carta_eleccion_hombre.docx',
      description: 'Anexo 2 - Carta de Elección de Modalidad de Pago y Reinversión',
      requiredFields: []
    });

    this.registerTemplate({
      type: ContractType.CESION_CREDITOS,
      // Nota: ambos archivos tienen typo en el nombre (cestion en vez de cesion)
      templateFilename: 'inversiones/cesion_creditos/cestion_creditos_hombre.docx',
      templateFilenameFemale: 'inversiones/cesion_creditos/cestion_creditos_mujer.docx',
      description: 'Cesión de Créditos',
      requiredFields: []
    });

    this.registerTemplate({
      type: ContractType.CARTA_INSTRUCCION_INVERSION_CARTERA_ACTIVA,
      templateFilename: 'inversiones/anexo3/carta_instruccion_hombre.docx',
      templateFilenameFemale: 'inversiones/anexo3/carta_instruccion_mujer.docx',
      description: 'Anexo 3 - Carta de Instrucción para Inversión en Cartera Activa',
      requiredFields: []
    });

    this.registerTemplate({
      type: ContractType.CARTA_INCREMENTO_INVERSION,
      templateFilename: 'inversiones/anexo4/carta_incremento_hombre.docx',
      templateFilenameFemale: 'inversiones/anexo4/carta_incremento_mujer.docx',
      description: 'Anexo 4 - Carta de Incremento de Inversión',
      requiredFields: []
    });

    this.registerTemplate({
      type: ContractType.CARTA_INSTRUCCION_PAGO_ANTICIPADO,
      templateFilename: 'inversiones/anexo6/carta_instruccion_pago_anticipado_hombre.docx',
      templateFilenameFemale: 'inversiones/anexo6/carta_instruccion_pago_anticipado_mujer.docx',
      description: 'Anexo 6 - Carta de Instrucción por Pago Anticipado',
      requiredFields: []
    });

    this.registerTemplate({
      type: ContractType.CONTRATO_SERVICIOS_CASH_IN_INVERSOR_GENERAL,
      templateFilename: 'inversiones/contrato_servicio_cashin/inversor_general_hombre.docx',
      templateFilenameFemale: 'inversiones/contrato_servicio_cashin/inversor_general_mujer.docx',
      description: 'Contrato de Servicios Cash In - Inversor General',
      requiredFields: []
    });

    this.registerTemplate({
      type: ContractType.DESIGNACION_BENEFICIARIO,
      templateFilename: 'inversiones/anexo7/designacion_beneficiarios.docx',
      templateFilenameFemale: 'inversiones/anexo7/designacion_beneficiarios.docx',
      description: 'Anexo 7 - Designación de Beneficiarios',
      requiredFields: []
    });

    // Contrato de Participación y Administración de Cartera (mismo doc para hombre y mujer)
    this.registerTemplate({
      type: ContractType.CONTRATO_PARTICIPACION_ADMINISTRACION_CARTERA,
      templateFilename: 'inversiones/contrato_participacion_administracion_cartera/contrato_participacion_administracion_cartera.docx',
      templateFilenameFemale: 'inversiones/contrato_participacion_administracion_cartera/contrato_participacion_administracion_cartera.docx',
      description: 'Contrato de Participación y Administración de Cartera - Inversionista Individual',
      requiredFields: []
    });

    // Anexos 1 y 2 - Confirmación de Participación y Designación de Beneficiario
    // (mismo doc para hombre y mujer; incluye lista repetible de beneficiarios)
    this.registerTemplate({
      type: ContractType.ANEXOS_CONFIRMACION_PARTICIPACION_BENEFICIARIO,
      templateFilename: 'inversiones/anexos_confirmacion_participacion_beneficiario/anexos_confirmacion_participacion_beneficiario.docx',
      templateFilenameFemale: 'inversiones/anexos_confirmacion_participacion_beneficiario/anexos_confirmacion_participacion_beneficiario.docx',
      description: 'Anexos 1 y 2 - Confirmación de Participación y Designación de Beneficiario',
      requiredFields: []
    });

    // ===== INVERSIONES SOCIEDAD =====
    this.registerTemplate({
      type: ContractType.ACUERDO_INVERSION_CASH_IN_SOCIEDAD,
      templateFilename: 'inversiones_Sociedad/acuerdo_inversion/acuerdo_inversion_hombre.docx',
      templateFilenameFemale: 'inversiones_Sociedad/acuerdo_inversion/acuerdo_inversion_mujer.docx',
      description: 'Acuerdo de Inversión Cash In (Sociedad)',
      requiredFields: []
    });

    this.registerTemplate({
      type: ContractType.CARTA_CONFIRMACION_INVERSION_INICIAL_SOCIEDAD,
      templateFilename: 'inversiones_Sociedad/anexo1/carta_confirmacion_hombre.docx',
      templateFilenameFemale: 'inversiones_Sociedad/anexo1/carta_confirmacion_mujer.docx',
      description: 'Anexo 1 - Carta de Confirmación de Inversión Inicial (Sociedad)',
      requiredFields: []
    });

    this.registerTemplate({
      type: ContractType.CARTA_ELECCION_MODALIDAD_PAGO_REINVERSION_SOCIEDAD,
      templateFilename: 'inversiones_Sociedad/anexo2/carta_eleccion_hombre.docx',
      templateFilenameFemale: 'inversiones_Sociedad/anexo2/carta_eleccion_hombre.docx',
      description: 'Anexo 2 - Carta de Elección de Modalidad de Pago y Reinversión (Sociedad)',
      requiredFields: []
    });

    this.registerTemplate({
      type: ContractType.CARTA_INSTRUCCION_INVERSION_CARTERA_ACTIVA_SOCIEDAD,
      templateFilename: 'inversiones_Sociedad/anexo3/carta_instruccion_hombre.docx',
      templateFilenameFemale: 'inversiones_Sociedad/anexo3/carta_instruccion_mujer.docx',
      description: 'Anexo 3 - Carta de Instrucción para Inversión en Cartera Activa (Sociedad)',
      requiredFields: []
    });

    this.registerTemplate({
      type: ContractType.CARTA_INCREMENTO_INVERSION_SOCIEDAD,
      templateFilename: 'inversiones_Sociedad/anexo4/carta_incremento_hombre.docx',
      templateFilenameFemale: 'inversiones_Sociedad/anexo4/carta_incremento_mujer.docx',
      description: 'Anexo 4 - Carta de Incremento de Inversión (Sociedad)',
      requiredFields: []
    });

    this.registerTemplate({
      type: ContractType.CARTA_INSTRUCCION_PAGO_ANTICIPADO_SOCIEDAD,
      templateFilename: 'inversiones_Sociedad/anexo6/carta_instruccion_pago_anticipado_hombre.docx',
      templateFilenameFemale: 'inversiones_Sociedad/anexo6/carta_instruccion_pago_anticipado_mujer.docx',
      description: 'Anexo 6 - Carta de Instrucción por Pago Anticipado (Sociedad)',
      requiredFields: []
    });

    this.registerTemplate({
      type: ContractType.CESION_CREDITOS_SOCIEDAD,
      // Nota: ambos archivos tienen typo en el nombre (cestion en vez de cesion)
      templateFilename: 'inversiones_Sociedad/cesion_creditos/cestion_creditos_hombre.docx',
      templateFilenameFemale: 'inversiones_Sociedad/cesion_creditos/cestion_creditos_mujer.docx',
      description: 'Cesión de Créditos (Sociedad)',
      requiredFields: []
    });

    this.registerTemplate({
      type: ContractType.CONTRATO_SERVICIOS_CASH_IN_INVERSOR_GENERAL_SOCIEDAD,
      templateFilename: 'inversiones_Sociedad/contrato_servicio_cashin/inversor_general_hombre.docx',
      templateFilenameFemale: 'inversiones_Sociedad/contrato_servicio_cashin/inversor_general_mujer.docx',
      description: 'Contrato de Servicios Cash In - Inversor General (Sociedad)',
      requiredFields: []
    });

    this.registerTemplate({
      type: ContractType.DESIGNACION_BENEFICIARIO_SOCIEDAD,
      templateFilename: 'inversiones_Sociedad/anexo7/designacion_beneficiarios.docx',
      templateFilenameFemale: 'inversiones_Sociedad/anexo7/designacion_beneficiarios.docx',
      description: 'Anexo 7 - Designación de Beneficiarios (Sociedad)',
      requiredFields: []
    });

    // ===== CARTA PODER =====
    this.registerTemplate({
      type: ContractType.CARTA_CUBE_ANDRES,
      templateFilename: 'carta_poder/CARTA-CUBE-ANDRES-HOMBRE.docx',
      templateFilenameFemale: 'carta_poder/CARTA-CUBE-ANDRES-MUJER.docx',
      description: 'Carta poder CUBE - Andrés',
      requiredFields: []
    });

    this.registerTemplate({
      type: ContractType.CARTA_CUBE_DON_ALEX,
      templateFilename: 'carta_poder/CARTA-CUBE-DON ALEX-HOMBRE.docx',
      templateFilenameFemale: 'carta_poder/CARTA-CUBE-DON ALEX-MUJER.docx',
      description: 'Carta poder CUBE - Don Alex',
      requiredFields: []
    });

    this.registerTemplate({
      type: ContractType.CARTA_RDBE_DON_ALEX,
      templateFilename: 'carta_poder/CARTA-RDBE-DON ALEX-HOMBRE.docx',
      templateFilenameFemale: 'carta_poder/CARTA-RDBE-DON ALEX-MUJER.docx',
      description: 'Carta poder RDBE - Don Alex',
      requiredFields: []
    });

    this.registerTemplate({
      type: ContractType.CARTA_RDBE_RICHARD,
      templateFilename: 'carta_poder/CARTA-RDBE-RICHARD-HOMBRE.docx',
      templateFilenameFemale: 'carta_poder/CARTA-RDBE-RICHARD-MUJER.docx',
      description: 'Carta poder RDBE - Richard',
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
      /**
       * Firmantes con su rol. Es por donde manda el CRM desde que la firma se
       * reparte por rol; `emails` es el camino viejo.
       */
      signers?: ContractSigner[];
      /** Observadores: ven el flujo de firma sin firmar. */
      observers?: string[];
      emails?: string[];
      options?: { generatePdf?: boolean; filenamePrefix?: string; documentName?: string; gender?: "male" | "female"; isPlural?: boolean };
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
      const { contractType, data, signers, observers, emails, options } =
        contracts[i];

      console.log(`[${i + 1}/${contracts.length}] Procesando contrato: ${contractType}`);
      console.log(`  Options recibidas:`, JSON.stringify(options));

      try {
        // `signers` y `observers` tienen que viajar igual que `emails`: el batch
        // es el camino que usa el wizard, y dejarlos afuera hacía que el
        // contrato saliera sin firmantes y, por lo tanto, sin links.
        const result = await this.generateContract(contractType, data, {
          ...options,
          signers,
          observers,
          emails,
        });
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
    options: {
      gender?: "male" | "female";
      generatePdf?: boolean;
      filenamePrefix?: string;
      /** Ver `nombreDeDocumento`: cómo se ve en WeeTrust, no el nombre de archivo. */
      documentName?: string;
      /** @deprecated Usar `signers`, que lleva el rol de cada firmante. */
      emails?: string[];
      signers?: ContractSigner[];
      observers?: string[];
      isPlural?: boolean;
    } = { gender: "male" }
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

      // Lo que ve el cliente en WeeTrust, que no es el nombre de archivo.
      // Al CRM le basta con mandar el nombre de quien firma: la descripción la
      // pone el generador desde su propio registro de plantillas, que es el
      // que manda.
      const documentName = nombreDeDocumento(
        options.documentName?.trim() || data.client_name || prefix,
        config.description,
        contractType,
      );

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
        } catch (pdfError: any) {
          // Sin PDF no hay nada que subir a R2 ni que mandar a firma, así que devolver
          // éxito acá dejaba el contrato "generado" pero sin documento ni link: el CRM
          // lo enlazaba igual y jurídico se enteraba hasta que lo iba a abrir.
          console.error('Error al generar PDF:', pdfError);
          await this.cleanupLocalFiles(docxPath);
          return {
            templateId: 0,
            success: false,
            nameDocument: [{ enum: contractType, label: config.description }],
            data: [],
            linkDocument: '',
            signing_links: undefined,
            contractType,
            message: 'Error al generar contrato',
            error: `No se pudo convertir el documento a PDF: ${pdfError?.message ?? 'error desconocido'}`
          };
        }
      }

      // 11.5. Subir PDF a R2 siempre (garantiza r2Key independiente de firma)
      let r2KeyDirect: string | undefined;
      if (pdfBuffer) {
        const result = await uploadPdfToR2(pdfBuffer, baseFilename);
        r2KeyDirect = result.r2Key;
      }

      // 12. Integración con firma electrónica (WeeTrust principal, Documenso fallback)
      let signing: {
        signs: string[];
        linkDocument: string;
        r2Key?: string;
        documentID?: string;
        observerUrl?: string;
        signatories?: Array<{
          role: SignerRole;
          email: string;
          name: string;
          signatoryID?: string;
          signingUrl?: string;
        }>;
       } | undefined;
      let signingLinks: string[] | undefined;
      let shouldCleanupFiles = false;
      let signingProvider: 'weetrust' | 'documenso' | undefined;
      /** Motivo por el que no hay links de firma, si se pidieron. */
      let signingError: string | undefined;

      // Los firmantes pueden venir con rol (`signers`) o como lista plana de
      // emails (`emails`, el camino viejo). La lista plana se interpreta como
      // titular seguido de cofirmantes, que es como la armaba el CRM.
      // Quien manda `signers` usa el reparto por rol. Quien sólo manda `emails`
      // (la app legal-documents) sigue con el comportamiento de siempre.
      const firmaPorRol = Boolean(options.signers && options.signers.length > 0);
      const signers: ContractSigner[] =
        options.signers && options.signers.length > 0
          ? options.signers
          : (options.emails ?? []).map((email, i) => ({
              role: i === 0 ? SignerRole.TITULAR : SignerRole.COFIRMANTE,
              email,
              // Cada cofirmante con su propio nombre, no con el del titular.
              name:
                (i === 0
                  ? data.nombreCompleto
                  : data.deudoresAdicionales?.[i - 1]?.nombreCompleto) ?? email,
            }));

      // Hay contratos que no se firman electrónicamente: se imprimen y se
      // firman en papel. Para esos el PDF en R2 ES el entregable, y pedirles
      // links de firma (o marcarlos como fallidos por no tenerlos) es tratar
      // como error algo que está bien.
      const signatureMode = getSignatureMode(contractType);

      if (signatureMode === 'fisica') {
        console.log(
          `✍️  ${contractType} se firma en papel: no se envía a firma electrónica.`,
        );
      } else if (signers.length > 0 && pdfBuffer) {
        // Intentar primero con WeeTrust (si está habilitado)
        try {
          if (!weeTrustService) {
            throw new Error('WeeTrust deshabilitado o no inicializado');
          }

          console.log(`🔗 Creando documento en WeeTrust para firma...`);

          signing = await weeTrustService.createDocumentForSigning(
            documentName,
            pdfBuffer,
            contractType,
            signers,
            options.observers,
            firmaPorRol ? 'rol' : 'legado',
          );

          signingLinks = signing.signs ?? [];
          signingProvider = 'weetrust';

          console.log(`✓ WeeTrust: ${signingLinks.length} link(s) de firma generados`);
          shouldCleanupFiles = true;

        } catch (weeTrustError) {
          // Un desajuste de layout es un problema de nuestra configuración, no
          // del proveedor: mandarlo a Documenso pondría las firmas igual de mal.
          // Se corta acá para que el error salga a la vista.
          if (weeTrustError instanceof SignatureLayoutError) {
            signingError = weeTrustError.message;
            console.error(`✗ Layout de firmas inválido: ${weeTrustError.message}`);
          } else if (firmaPorRol) {
            // Con roles no se cae a Documenso: no arma las firmas dinámicas (más
            // codeudores, la cobertura con dos juegos) ni agrega observadores, y
            // el contrato saldría "bien" con firmas faltantes. Mejor un error a
            // la vista y reintentar.
            signingError = `WeeTrust: ${errorMessage(weeTrustError)}`;
            console.error('✗ Error con WeeTrust (sin fallback para firma por rol):', weeTrustError);
          } else {
            console.error('⚠ Error con WeeTrust, intentando Documenso como fallback:', weeTrustError);

            // Fallback a Documenso, sólo para quien manda `emails` sin rol
            // (legal-documents): es el comportamiento de siempre.
            try {
              console.log(`🔗 Creando documento en Documenso (fallback)...`);

              signing = await documensoService.createDocumentAndGetSigningLinks(
                documentName,
                pdfBuffer,
                contractType,
                signers.map((s) => s.email)
              );

              signingLinks = signing.signs ?? [];
              signingProvider = 'documenso';

              console.log(`✓ Documenso: ${signingLinks.length} link(s) de firma generados`);
              shouldCleanupFiles = true;

            } catch (documensoError) {
              console.error('⚠ Error al crear documento en Documenso:', documensoError);
              signingError = `WeeTrust: ${errorMessage(weeTrustError)} | Documenso: ${errorMessage(documensoError)}`;
            }
          }
        }

        // Pedimos firma y no la conseguimos. Devolver `success: true` acá era lo
        // que dejaba pasar contratos sin link: el CRM los guardaba como buenos y
        // nadie se enteraba hasta que alguien iba a firmarlos.
        if (!signingLinks || signingLinks.length === 0) {
          signingError ??= 'No se generaron links de firma';
        }
      }

      // 13. Limpiar archivos locales si se subieron exitosamente a R2
      if (shouldCleanupFiles || r2KeyDirect) {
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
          signingProvider,
          contractType,
          docx_path: docxPath,
          pdf_path: pdfPath,
          message: `Contrato ${contractType} generado exitosamente`,
          generatedAt: new Date().toISOString()
        };

        // NOTA: Llamada al CRM deshabilitada temporalmente para agilizar el proceso
        // crmApiService.saveContractSilently({
        //   dpi: data.dpi,
        //   contractType,
        //   contractName: config.description,
        //   signingLinks,
        //   templateId,
        //   apiResponse: fullApiResponse,
        // }).catch(err => {
        //   console.error('[ContractGeneratorService] Error al guardar en CRM:', err);
        // });
      }

      // En papel no hay documento en WeeTrust: el link del documento es el PDF.
      // Quien sólo lee `linkDocument` (legal-documents) no tenía cómo abrirlo.
      let linkDelPdfEnPapel: string | undefined;
      if (signatureMode === 'fisica' && r2KeyDirect) {
        linkDelPdfEnPapel = await urlFirmadaDePdf(r2KeyDirect).catch((error) => {
          console.warn('⚠ No se pudo firmar la URL del PDF en papel:', error);
          return undefined;
        });
      }

      return {
        templateId: Math.floor(Math.random() * 100000), // ID de template simulado
        // Se pidió firma y no hubo links: el contrato no sirve, aunque el PDF exista.
        success: !signingError,
        nameDocument: [{ enum: contractType, label: config.description }],
        data: submissionData,
        signing_links: signingLinks,
        signatureMode,
        linkDocument: signing?.linkDocument || linkDelPdfEnPapel || '',
        signingProvider,
        r2Key: r2KeyDirect || signing?.r2Key,
        // Identificadores de WeeTrust: sin ellos no se puede consultar el estado
        // del documento ni reintentar la firma de una persona más adelante.
        documentID: signing?.documentID,
        observerUrl: signing?.observerUrl,
        signatories: signing?.signatories,
        // Campos adicionales para backward compatibility
        contractType,
        docx_path: docxPath,
        pdf_path: pdfPath,
        message: signingError
          ? `Contrato ${contractType} generado, pero sin firma electrónica`
          : signatureMode === 'fisica'
            ? `Contrato ${contractType} generado para firma en papel`
            : `Contrato ${contractType} generado exitosamente`,
        error: signingError,
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
  /**
   * Manda a firmar un PDF que ya existe, sin generarlo desde el template.
   *
   * Es el camino para cuando jurídico sube el contrato a mano: hay casos en que
   * el documento se arma fuera (una versión negociada, un escaneo corregido),
   * pero el tipo de contrato sigue siendo uno de los que tenemos mapeados, así
   * que las líneas de firma están donde siempre y se puede repartir por rol
   * igual que en el camino automático.
   *
   * No se inventa nada: si el PDF subido no trae las líneas de firma que el
   * layout declara, `locateSignatureWidgets` lanza `SignatureLayoutError` y no
   * se manda nada a firmar. Un PDF que no es el contrato que dice ser se
   * detecta acá y no cuando alguien vaya a firmarlo.
   */
  async signExistingPdf(
    contractType: ContractType,
    pdfBuffer: Buffer,
    options: {
      filenamePrefix?: string;
      /**
       * Nombre con el que se ve en WeeTrust. Sin esto, la reemisión mandaba el
       * `filenamePrefix` que le pasaba el CRM, que era la descripción del
       * documento ("Pagaré único libre de protesto"): el documento reemitido
       * perdía el nombre de la persona y quedaba imposible de ubicar entre
       * decenas de pagarés.
       */
      documentName?: string;
      signers?: ContractSigner[];
      observers?: string[];
      /**
       * El PDF ya está en R2 con esta key (reemisión): no se vuelve a subir.
       * Si no, cada regeneración dejaba una copia más del mismo contrato que
       * nadie referencia.
       */
      r2KeyExistente?: string;
    } = {},
  ): Promise<ContractGenerationResponse> {
    const config = this.templateRegistry.get(contractType);
    const descripcion = config?.description ?? contractType;
    const baseFilename = options.filenamePrefix || `manual_${contractType}`;
    const documentName = nombreDeDocumento(
      options.documentName?.trim() || options.filenamePrefix,
      descripcion,
      contractType,
    );

    const respuestaBase = {
      templateId: 0,
      nameDocument: [{ enum: contractType, label: descripcion }],
      data: [],
      contractType,
      generatedAt: new Date().toISOString(),
    };

    try {
      const signatureMode = getSignatureMode(contractType);

      // Los contratos en papel no tienen líneas que contrastar (y el archivo
      // puede ser un escaneo, sin texto), pero por lo menos tiene que abrir:
      // si no, un archivo roto quedaba registrado como el contrato.
      if (signatureMode === 'fisica') {
        try {
          const paginas = await WeeTrustService.contarPaginas(pdfBuffer);
          if (paginas === 0) throw new Error('el PDF no tiene páginas');
        } catch (error) {
          return {
            ...respuestaBase,
            success: false,
            linkDocument: '',
            signatureMode,
            message: 'El archivo no es un PDF válido',
            error: `No se pudo abrir el PDF: ${errorMessage(error)}`,
          };
        }
      }

      // El PDF va a R2 sólo cuando el contrato quedó bien: si la firma falla,
      // el CRM no guarda nada y el archivo quedaba en R2 sin nadie que lo
      // referencie ni forma de borrarlo. Jurídico lo tiene en su máquina.
      if (signatureMode === 'fisica') {
        const { r2Key } = await uploadPdfToR2(pdfBuffer, baseFilename);
        return {
          ...respuestaBase,
          success: true,
          r2Key,
          linkDocument: '',
          signatureMode,
          message: `Contrato ${contractType} subido para firma en papel`,
        };
      }

      const signers = options.signers ?? [];
      if (signers.length === 0) {
        return {
          ...respuestaBase,
          success: false,
          linkDocument: '',
          signatureMode,
          message: 'Contrato no enviado: sin firmantes',
          error: 'No se recibió ningún firmante para este contrato',
        };
      }

      if (!weeTrustService) {
        return {
          ...respuestaBase,
          success: false,
          linkDocument: '',
          signatureMode,
          message: 'Contrato no enviado: sin firma electrónica',
          error: 'WeeTrust deshabilitado o no inicializado',
        };
      }

      const signing = await weeTrustService.createDocumentForSigning(
        documentName,
        pdfBuffer,
        contractType,
        signers,
        options.observers,
      );

      // Si R2 falla con el documento ya enviado, se borra en WeeTrust: sin el
      // PDF guardado el CRM no lo registra, y quedaría vivo sin dueño.
      let r2Key: string;
      try {
        r2Key =
          options.r2KeyExistente ??
          (await uploadPdfToR2(pdfBuffer, baseFilename)).r2Key;
      } catch (error) {
        await weeTrustService.deleteDocument(signing.documentID).catch(() => {});
        throw error;
      }

      return {
        ...respuestaBase,
        success: true,
        r2Key,
        signing_links: signing.signs,
        signatureMode,
        linkDocument: signing.linkDocument,
        signingProvider: 'weetrust',
        documentID: signing.documentID,
        observerUrl: signing.observerUrl,
        signatories: signing.signatories,
        message: `Contrato ${contractType} subido y enviado a firma`,
      };
    } catch (error) {
      // A diferencia del camino automático, acá NO se cae a Documenso: el
      // documento lo subió una persona y lo que corresponde es decírselo.
      console.error(`[signExistingPdf] ${contractType}:`, error);
      return {
        ...respuestaBase,
        success: false,
        linkDocument: '',
        message: 'No se pudo enviar el contrato a firma',
        error: errorMessage(error),
      };
    }
  }

  private async acquirePdfSlot(): Promise<void> {
    if (this.activePdfConversions < this.maxConcurrentPdfConversions) {
      this.activePdfConversions++;
      return;
    }

    console.warn(`⏳ Cola de PDF llena (${this.activePdfConversions} activas, ${this.pdfConversionQueue.length} en espera). Esperando slot...`);

    // Esperar a que se libere un slot, con tope: si nunca se libera, fallar en vez de colgar la request
    return new Promise<void>((resolve, reject) => {
      const waiter = () => {
        clearTimeout(timer);
        this.activePdfConversions++;
        resolve();
      };
      const timer = setTimeout(() => {
        const idx = this.pdfConversionQueue.indexOf(waiter);
        if (idx !== -1) this.pdfConversionQueue.splice(idx, 1);
        reject(new Error(
          `Timeout esperando slot de conversión PDF (${this.pdfQueueTimeoutMs} ms). ` +
          `Conversiones activas: ${this.activePdfConversions}, en cola: ${this.pdfConversionQueue.length}.`
        ));
      }, this.pdfQueueTimeoutMs);
      this.pdfConversionQueue.push(waiter);
    });
  }

  /**
   * Estado de la cola de conversión PDF (para /health y /metrics)
   */
  public getPdfQueueStats(): { active: number; queued: number; max: number } {
    return {
      active: this.activePdfConversions,
      queued: this.pdfConversionQueue.length,
      max: this.maxConcurrentPdfConversions
    };
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

  /**
   * Convierte a PDF reintentando: el cuelgue de Gotenberg es puntual, no del documento.
   * Medido sobre las conversiones históricas, el p99 es 1.8 s y el mismo documento que
   * expiró convierte en menos de un segundo al reintentarlo.
   */
  private async convertToPdf(docxBuffer: Buffer): Promise<Buffer> {
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= this.pdfConversionAttempts; attempt++) {
      try {
        return await this.convertToPdfOnce(docxBuffer);
      } catch (error: any) {
        lastError = error;
        const quedanIntentos = attempt < this.pdfConversionAttempts;
        console.error(
          `  ⚠ Conversión a PDF fallida (intento ${attempt}/${this.pdfConversionAttempts}): ${error.message}` +
          (quedanIntentos ? ' — reintentando...' : '')
        );
        // Respiro corto antes de reintentar: si Gotenberg viene de un cuelgue,
        // pegarle de inmediato suele caer en el mismo estado.
        if (quedanIntentos) await new Promise(r => setTimeout(r, 1000));
      }
    }

    throw new Error(
      `No se pudo convertir a PDF tras ${this.pdfConversionAttempts} intento(s). ` +
      `Último error: ${lastError?.message ?? 'desconocido'}`
    );
  }

  private async convertToPdfOnce(docxBuffer: Buffer): Promise<Buffer> {
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
          timeout: this.pdfTimeoutMs, // Cubre la espera de headers (LibreOffice puede ser lento)
          // Cubre TODO el request, incluido un cuerpo que se queda a medias: `timeout` no lo corta en Bun
          signal: AbortSignal.timeout(this.pdfTimeoutMs)
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
      if (error.code === 'ERR_CANCELED' || error.name === 'CanceledError' || error.name === 'TimeoutError') {
        throw new Error(`Timeout de ${this.pdfTimeoutMs} ms convirtiendo a PDF: Gotenberg dejó la respuesta a medias.`);
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
const numeroDeEnv = (valor: string | undefined): number | undefined => {
  const n = Number(valor);
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

export const contractGenerator = new ContractGeneratorService({
  gotenbergUrl: process.env.GOTENBERG_URL || 'http://localhost:3000',
  // Ajustables por env para poder afinarlos en caliente si Gotenberg se pone lento
  pdfTimeoutMs: numeroDeEnv(process.env.PDF_TIMEOUT_MS),
  pdfQueueTimeoutMs: numeroDeEnv(process.env.PDF_QUEUE_TIMEOUT_MS),
  pdfConversionAttempts: numeroDeEnv(process.env.PDF_CONVERSION_ATTEMPTS)
});
