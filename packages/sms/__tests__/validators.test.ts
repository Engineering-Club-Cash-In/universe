import { describe, it, expect } from 'vitest';
import {
  validateMsisdn,
  validateMsisdns,
  validateCountry,
  validateMessage,
  validateTag,
  validateSchedule,
  validateApiKey,
  validateSendSMSRequest,
  calculateMessageSegments,
  MAX_MESSAGE_LENGTH,
  MAX_CONCATENATED_SEGMENT,
} from '../src/validators';
import { ValidationError } from '../src/errors';
import { VALID_SMS_REQUEST } from './fixtures/test-data';

describe('validateMsisdn', () => {
  it('deberia aceptar MSISDN valido de 10 digitos', () => {
    expect(() => validateMsisdn('5512345678')).not.toThrow();
  });

  it('deberia aceptar MSISDN valido de 12 digitos', () => {
    expect(() => validateMsisdn('525512345678')).not.toThrow();
  });

  it('deberia aceptar MSISDN valido de 15 digitos', () => {
    expect(() => validateMsisdn('123456789012345')).not.toThrow();
  });

  it('deberia rechazar MSISDN muy corto', () => {
    expect(() => validateMsisdn('123456789')).toThrow(ValidationError);
  });

  it('deberia rechazar MSISDN muy largo', () => {
    expect(() => validateMsisdn('1234567890123456')).toThrow(ValidationError);
  });

  it('deberia rechazar MSISDN con letras', () => {
    expect(() => validateMsisdn('52551234567a')).toThrow(ValidationError);
  });

  it('deberia rechazar MSISDN vacio', () => {
    expect(() => validateMsisdn('')).toThrow(ValidationError);
  });
});

describe('validateMsisdns', () => {
  it('deberia aceptar array con un MSISDN', () => {
    expect(() => validateMsisdns(['525512345678'])).not.toThrow();
  });

  it('deberia aceptar array con multiples MSISDNs', () => {
    expect(() => validateMsisdns(['525512345678', '525587654321'])).not.toThrow();
  });

  it('deberia rechazar array vacio', () => {
    expect(() => validateMsisdns([])).toThrow(ValidationError);
  });

  it('deberia rechazar null', () => {
    expect(() => validateMsisdns(null as any)).toThrow(ValidationError);
  });

  it('deberia rechazar undefined', () => {
    expect(() => validateMsisdns(undefined as any)).toThrow(ValidationError);
  });

  it('deberia rechazar si algun MSISDN es invalido', () => {
    expect(() => validateMsisdns(['525512345678', 'invalid'])).toThrow(ValidationError);
  });
});

describe('validateCountry', () => {
  it('deberia aceptar codigo ISO2 valido', () => {
    expect(() => validateCountry('MX')).not.toThrow();
  });

  it('deberia aceptar codigo ISO2 en minusculas', () => {
    expect(() => validateCountry('mx')).not.toThrow();
  });

  it('deberia rechazar codigo de 3 caracteres', () => {
    expect(() => validateCountry('MEX')).toThrow(ValidationError);
  });

  it('deberia rechazar codigo de 1 caracter', () => {
    expect(() => validateCountry('M')).toThrow(ValidationError);
  });

  it('deberia rechazar codigo vacio', () => {
    expect(() => validateCountry('')).toThrow(ValidationError);
  });

  it('deberia rechazar codigo con numeros', () => {
    expect(() => validateCountry('M1')).toThrow(ValidationError);
  });
});

describe('validateMessage', () => {
  it('deberia aceptar mensaje valido', () => {
    expect(() => validateMessage('Hola mundo')).not.toThrow();
  });

  it('deberia aceptar mensaje largo', () => {
    const longMessage = 'a'.repeat(500);
    expect(() => validateMessage(longMessage)).not.toThrow();
  });

  it('deberia rechazar mensaje vacio', () => {
    expect(() => validateMessage('')).toThrow(ValidationError);
  });

  it('deberia rechazar mensaje con solo espacios', () => {
    expect(() => validateMessage('   ')).toThrow(ValidationError);
  });
});

describe('validateTag', () => {
  it('deberia aceptar tag valido', () => {
    expect(() => validateTag('mi-campana')).not.toThrow();
  });

  it('deberia rechazar tag vacio', () => {
    expect(() => validateTag('')).toThrow(ValidationError);
  });

  it('deberia rechazar tag con solo espacios', () => {
    expect(() => validateTag('   ')).toThrow(ValidationError);
  });
});

describe('validateSchedule', () => {
  it('deberia aceptar fecha futura como Date', () => {
    const futureDate = new Date();
    futureDate.setFullYear(futureDate.getFullYear() + 1);
    expect(() => validateSchedule(futureDate)).not.toThrow();
  });

  it('deberia aceptar fecha futura como string ISO-8601', () => {
    expect(() => validateSchedule('2030-12-31T10:00:00Z')).not.toThrow();
  });

  it('deberia aceptar fecha futura con timezone', () => {
    expect(() => validateSchedule('2030-12-31T10:00:00-06:00')).not.toThrow();
  });

  it('deberia rechazar fecha en el pasado', () => {
    expect(() => validateSchedule('2020-01-01T00:00:00Z')).toThrow(ValidationError);
  });

  it('deberia rechazar fecha invalida', () => {
    expect(() => validateSchedule('not-a-date')).toThrow(ValidationError);
  });

  it('deberia rechazar fecha muy en el pasado', () => {
    const pastDate = new Date();
    pastDate.setFullYear(pastDate.getFullYear() - 1);
    expect(() => validateSchedule(pastDate)).toThrow(ValidationError);
  });
});

describe('validateApiKey', () => {
  it('deberia aceptar entero positivo', () => {
    expect(() => validateApiKey(22)).not.toThrow();
  });

  it('deberia aceptar entero grande', () => {
    expect(() => validateApiKey(999999)).not.toThrow();
  });

  it('deberia rechazar cero', () => {
    expect(() => validateApiKey(0)).toThrow(ValidationError);
  });

  it('deberia rechazar negativo', () => {
    expect(() => validateApiKey(-1)).toThrow(ValidationError);
  });

  it('deberia rechazar decimal', () => {
    expect(() => validateApiKey(22.5)).toThrow(ValidationError);
  });
});

describe('validateSendSMSRequest', () => {
  it('deberia aceptar request valido', () => {
    expect(() => validateSendSMSRequest(VALID_SMS_REQUEST)).not.toThrow();
  });

  it('deberia rechazar request sin msisdns', () => {
    expect(() => validateSendSMSRequest({
      ...VALID_SMS_REQUEST,
      msisdns: [],
    })).toThrow(ValidationError);
  });

  it('deberia rechazar request sin message', () => {
    expect(() => validateSendSMSRequest({
      ...VALID_SMS_REQUEST,
      message: '',
    })).toThrow(ValidationError);
  });

  it('deberia rechazar request sin country valido', () => {
    expect(() => validateSendSMSRequest({
      ...VALID_SMS_REQUEST,
      country: 'INVALID',
    })).toThrow(ValidationError);
  });

  it('deberia rechazar request sin tag', () => {
    expect(() => validateSendSMSRequest({
      ...VALID_SMS_REQUEST,
      tag: '',
    })).toThrow(ValidationError);
  });

  it('deberia validar schedule si esta presente', () => {
    expect(() => validateSendSMSRequest({
      ...VALID_SMS_REQUEST,
      schedule: '2020-01-01T00:00:00Z',
    })).toThrow(ValidationError);
  });

  it('deberia aceptar request con schedule futuro', () => {
    expect(() => validateSendSMSRequest({
      ...VALID_SMS_REQUEST,
      schedule: '2030-12-31T10:00:00Z',
    })).not.toThrow();
  });
});

describe('calculateMessageSegments', () => {
  it('deberia retornar 1 para mensaje corto', () => {
    expect(calculateMessageSegments('Hola')).toBe(1);
  });

  it('deberia retornar 1 para mensaje de exactamente 160 chars', () => {
    const message = 'a'.repeat(MAX_MESSAGE_LENGTH);
    expect(calculateMessageSegments(message)).toBe(1);
  });

  it('deberia retornar 2 para mensaje de 161 chars', () => {
    const message = 'a'.repeat(161);
    expect(calculateMessageSegments(message)).toBe(2);
  });

  it('deberia retornar 2 para mensaje de 306 chars (2 * 153)', () => {
    const message = 'a'.repeat(306);
    expect(calculateMessageSegments(message)).toBe(2);
  });

  it('deberia retornar 3 para mensaje de 307 chars', () => {
    const message = 'a'.repeat(307);
    expect(calculateMessageSegments(message)).toBe(3);
  });

  it('deberia calcular correctamente para mensaje largo', () => {
    const message = 'a'.repeat(500);
    // 500 / 153 = 3.27 -> ceil = 4
    expect(calculateMessageSegments(message)).toBe(4);
  });
});

describe('Constantes', () => {
  it('MAX_MESSAGE_LENGTH deberia ser 160', () => {
    expect(MAX_MESSAGE_LENGTH).toBe(160);
  });

  it('MAX_CONCATENATED_SEGMENT deberia ser 153', () => {
    expect(MAX_CONCATENATED_SEGMENT).toBe(153);
  });
});
