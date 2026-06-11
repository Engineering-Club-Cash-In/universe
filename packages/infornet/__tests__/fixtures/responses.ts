/**
 * Fixtures de respuestas XML para tests unitarios
 * Basados en la documentacion de INETWS
 */

// Respuesta exitosa de busqueda_persona
export const BUSQUEDA_PERSONA_RESPONSE = `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <busqueda_personaResponse xmlns="urn:inetws">
      <busqueda_personaReturn><![CDATA[<?xml version="1.0" encoding="UTF-8"?>
<PERSONAS>
  <PERSONA>
    <CODIGO_PERSONA>2150350</CODIGO_PERSONA>
    <NOMBRE>PEREZ PEREZ, JUAN JOSE</NOMBRE>
    <SEXO>M</SEXO>
    <FECHA_NACIMIENTO>08/05/1970</FECHA_NACIMIENTO>
    <EDAD>39</EDAD>
    <ORDEN>A-01</ORDEN>
    <REGISTRO>799045</REGISTRO>
    <ACODIGO_MUNICIPIO>GUA</ACODIGO_MUNICIPIO>
    <ACODIGO_PAIS>GTM</ACODIGO_PAIS>
  </PERSONA>
</PERSONAS>]]></busqueda_personaReturn>
    </busqueda_personaResponse>
  </soap:Body>
</soap:Envelope>`;

// Respuesta exitosa con multiples personas
export const BUSQUEDA_PERSONA_MULTIPLE_RESPONSE = `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <busqueda_personaResponse xmlns="urn:inetws">
      <busqueda_personaReturn><![CDATA[<?xml version="1.0" encoding="UTF-8"?>
<PERSONAS>
  <PERSONA>
    <CODIGO_PERSONA>2150350</CODIGO_PERSONA>
    <NOMBRE>PEREZ PEREZ, JUAN JOSE</NOMBRE>
    <SEXO>M</SEXO>
    <FECHA_NACIMIENTO>08/05/1970</FECHA_NACIMIENTO>
    <EDAD>39</EDAD>
    <ORDEN>DPI</ORDEN>
    <REGISTRO>1234567890101</REGISTRO>
    <ACODIGO_MUNICIPIO>GUA</ACODIGO_MUNICIPIO>
    <ACODIGO_PAIS>GTM</ACODIGO_PAIS>
  </PERSONA>
  <PERSONA>
    <CODIGO_PERSONA>2150351</CODIGO_PERSONA>
    <NOMBRE>PEREZ LOPEZ, JUAN CARLOS</NOMBRE>
    <SEXO>M</SEXO>
    <FECHA_NACIMIENTO>15/03/1985</FECHA_NACIMIENTO>
    <EDAD>38</EDAD>
    <ORDEN>DPI</ORDEN>
    <REGISTRO>9876543210101</REGISTRO>
    <ACODIGO_MUNICIPIO>MIX</ACODIGO_MUNICIPIO>
    <ACODIGO_PAIS>GTM</ACODIGO_PAIS>
  </PERSONA>
</PERSONAS>]]></busqueda_personaReturn>
    </busqueda_personaResponse>
  </soap:Body>
</soap:Envelope>`;

// Respuesta de busqueda_empresa
export const BUSQUEDA_EMPRESA_RESPONSE = `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <busqueda_empresaResponse xmlns="urn:inetws">
      <busqueda_empresaReturn><![CDATA[<?xml version="1.0" encoding="UTF-8"?>
<EMPRESAS>
  <EMPRESA>
    <TIPO>S</TIPO>
    <CODIGO>3610637</CODIGO>
    <PROPIETARIO>ACME SOCIEDAD ANONIMA</PROPIETARIO>
    <NOMBRE_COMERCIAL>ACME S.A.</NOMBRE_COMERCIAL>
    <NIT>12345678</NIT>
    <DIRECCION>6a. Avenida 1-23 Zona 10</DIRECCION>
    <PAIS>GTM</PAIS>
  </EMPRESA>
</EMPRESAS>]]></busqueda_empresaReturn>
    </busqueda_empresaResponse>
  </soap:Body>
</soap:Envelope>`;

// Respuesta de about
export const ABOUT_RESPONSE = `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <aboutResponse xmlns="urn:inetws">
      <aboutReturn><![CDATA[<?xml version="1.0" encoding="UTF-8"?>
<ABOUT>
  <NOMBRE>INETWS</NOMBRE>
  <COPYRIGHT>2024 Infor.net</COPYRIGHT>
  <AUTOR>Gabriel Paz</AUTOR>
  <VERSION>3.0</VERSION>
  <LICENCIA>Uso exclusivo para clientes autorizados de Infor.net</LICENCIA>
</ABOUT>]]></aboutReturn>
    </aboutResponse>
  </soap:Body>
</soap:Envelope>`;

// Respuesta de estudio_persona (simplificada)
export const ESTUDIO_PERSONA_RESPONSE = `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <estudio_personaResponse xmlns="urn:inetws">
      <estudio_personaReturn><![CDATA[<?xml version="1.0" encoding="UTF-8"?>
<ESTUDIO_PERSONA>
  <FICHA_PRINCIPAL>
    <CODIGO>2150350</CODIGO>
    <NOMBRES>JUAN JOSE</NOMBRES>
    <APELLIDOS>PEREZ PEREZ</APELLIDOS>
    <SEXO>M</SEXO>
    <FECHA_NACIMIENTO>08/05/1970</FECHA_NACIMIENTO>
    <ESTADO_CIVIL>CASADO</ESTADO_CIVIL>
    <PROFESION>INGENIERO</PROFESION>
    <NACIONALIDAD>GUATEMALTECA</NACIONALIDAD>
  </FICHA_PRINCIPAL>
  <DOCUMENTOS>
    <DOCUMENTO>
      <TIPO>DPI</TIPO>
      <NUMERO>1234567890101</NUMERO>
      <FECHA_EMISION>01/01/2015</FECHA_EMISION>
      <FECHA_VENCIMIENTO>01/01/2025</FECHA_VENCIMIENTO>
    </DOCUMENTO>
  </DOCUMENTOS>
  <DIRECCIONES>
    <DIRECCION>
      <TIPO>RESIDENCIAL</TIPO>
      <DIRECCION>12 Calle 5-67 Zona 1</DIRECCION>
      <MUNICIPIO>Guatemala</MUNICIPIO>
      <DEPARTAMENTO>Guatemala</DEPARTAMENTO>
      <PAIS>Guatemala</PAIS>
      <TELEFONO>22221234</TELEFONO>
    </DIRECCION>
  </DIRECCIONES>
  <PEP>
    <ES_PEP>false</ES_PEP>
  </PEP>
  <PARIENTES_PEP></PARIENTES_PEP>
  <PARIENTES>
    <PARIENTE>
      <CODIGO>2150360</CODIGO>
      <NOMBRE>PEREZ DE PEREZ, MARIA</NOMBRE>
      <PARENTESCO>ESPOSA</PARENTESCO>
    </PARIENTE>
  </PARIENTES>
  <REFERENCIAS_JUDICIALES>
    <DELITOS></DELITOS>
    <INVOLUCRADOS></INVOLUCRADOS>
  </REFERENCIAS_JUDICIALES>
  <REFERENCIAS_PRENSA></REFERENCIAS_PRENSA>
  <REFERENCIAS_COMERCIALES>
    <REFERENCIA>
      <EMPRESA>BANCO INDUSTRIAL</EMPRESA>
      <TIPO>TARJETA DE CREDITO</TIPO>
      <MONTO>50000</MONTO>
      <MONEDA>GTQ</MONEDA>
      <ESTADO>VIGENTE</ESTADO>
      <FECHA_REGISTRO>01/06/2020</FECHA_REGISTRO>
    </REFERENCIA>
  </REFERENCIAS_COMERCIALES>
  <CHEQUES_GARANTIZADOS></CHEQUES_GARANTIZADOS>
  <REFERENCIAS_MERCANTILES>
    <REFERENCIA>
      <EMPRESA>ACME S.A.</EMPRESA>
      <CARGO>GERENTE GENERAL</CARGO>
      <FECHA_INICIO>01/01/2018</FECHA_INICIO>
      <ESTADO>ACTIVO</ESTADO>
    </REFERENCIA>
  </REFERENCIAS_MERCANTILES>
  <EMPRESAS_DE_SU_PROPIEDAD>
    <EMPRESA>
      <TIPO>S</TIPO>
      <CODIGO>3610637</CODIGO>
      <PROPIETARIO>PEREZ PEREZ, JUAN JOSE</PROPIETARIO>
      <NOMBRE_COMERCIAL>INVERSIONES JP</NOMBRE_COMERCIAL>
      <NIT>87654321</NIT>
      <DIRECCION>1a. Calle 2-34 Zona 9</DIRECCION>
      <PAIS>GTM</PAIS>
    </EMPRESA>
  </EMPRESAS_DE_SU_PROPIEDAD>
  <EMPLEOS>
    <EMPLEO>
      <EMPRESA>ACME S.A.</EMPRESA>
      <CARGO>GERENTE GENERAL</CARGO>
      <FECHA_INICIO>01/01/2018</FECHA_INICIO>
      <SALARIO>25000</SALARIO>
    </EMPLEO>
  </EMPLEOS>
  <VEHICULOS>
    <VEHICULO>
      <PLACA>P123ABC</PLACA>
      <MARCA>TOYOTA</MARCA>
      <LINEA>COROLLA</LINEA>
      <MODELO>2020</MODELO>
      <COLOR>BLANCO</COLOR>
    </VEHICULO>
  </VEHICULOS>
  <INMUEBLES>
    <INMUEBLE>
      <FINCA>12345</FINCA>
      <FOLIO>678</FOLIO>
      <LIBRO>90</LIBRO>
      <UBICACION>Zona 10, Guatemala</UBICACION>
      <AREA>500 m2</AREA>
    </INMUEBLE>
  </INMUEBLES>
  <CONSULTAS_EFECTUADAS>
    <CONSULTA>
      <FECHA>15/12/2023</FECHA>
      <EMPRESA>BANCO XYZ</EMPRESA>
      <MOTIVO>EVALUACION CREDITICIA</MOTIVO>
    </CONSULTA>
  </CONSULTAS_EFECTUADAS>
</ESTUDIO_PERSONA>]]></estudio_personaReturn>
    </estudio_personaResponse>
  </soap:Body>
</soap:Envelope>`;

// Respuesta de error - ninguna entidad encontrada
export const ERROR_NO_ENCONTRADO_RESPONSE = `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <busqueda_personaResponse xmlns="urn:inetws">
      <busqueda_personaReturn><![CDATA[<?xml version="1.0" encoding="UTF-8"?>
<error>
  <numero>00002</numero>
  <mensaje>Ninguna entidad encontrada.</mensaje>
</error>]]></busqueda_personaReturn>
    </busqueda_personaResponse>
  </soap:Body>
</soap:Envelope>`;

// Respuesta de error - verificar acceso
export const ERROR_ACCESO_RESPONSE = `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <busqueda_personaResponse xmlns="urn:inetws">
      <busqueda_personaReturn><![CDATA[<?xml version="1.0" encoding="UTF-8"?>
<error>
  <numero>00003</numero>
  <mensaje>Verificar su acceso.</mensaje>
</error>]]></busqueda_personaReturn>
    </busqueda_personaResponse>
  </soap:Body>
</soap:Envelope>`;

// Respuesta de error - limite de consultas
export const ERROR_LIMITE_RESPONSE = `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <busqueda_personaResponse xmlns="urn:inetws">
      <busqueda_personaReturn><![CDATA[<?xml version="1.0" encoding="UTF-8"?>
<error>
  <numero>00004</numero>
  <mensaje>El usuario a llegado al limite de consultas.</mensaje>
</error>]]></busqueda_personaReturn>
    </busqueda_personaResponse>
  </soap:Body>
</soap:Envelope>`;

// Respuesta de error - debe ampliar seleccion
export const ERROR_AMPLIAR_SELECCION_RESPONSE = `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <busqueda_personaResponse xmlns="urn:inetws">
      <busqueda_personaReturn><![CDATA[<?xml version="1.0" encoding="UTF-8"?>
<error>
  <numero>00001</numero>
  <mensaje>Debe de ampliar su seleccion</mensaje>
</error>]]></busqueda_personaReturn>
    </busqueda_personaResponse>
  </soap:Body>
</soap:Envelope>`;

// SOAP Fault generico
export const SOAP_FAULT_RESPONSE = `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <soap:Fault>
      <faultcode>soap:Server</faultcode>
      <faultstring>Error interno del servidor</faultstring>
    </soap:Fault>
  </soap:Body>
</soap:Envelope>`;
