import type { SMSCredentials, SendSMSRequest } from '../../src/types';

export const TEST_CREDENTIALS: SMSCredentials = {
  token: 'test-auth-token',
  apiKey: 22,
};

export const VALID_SMS_REQUEST: SendSMSRequest = {
  msisdns: ['525512345678'],
  message: 'Mensaje de prueba',
  country: 'MX',
  tag: 'test-campaign',
  dial: 12345,
};

export const MULTI_RECIPIENT_REQUEST: SendSMSRequest = {
  msisdns: ['525512345678', '525587654321'],
  message: 'Mensaje a multiples destinatarios',
  country: 'MX',
  tag: 'bulk-test',
};

export const SCHEDULED_REQUEST: SendSMSRequest = {
  ...VALID_SMS_REQUEST,
  schedule: '2030-12-31T10:00:00-06:00',
};

export const DLR_REQUEST: SendSMSRequest = {
  ...VALID_SMS_REQUEST,
  dlr: true,
  registeredDelivery: 5,
};

export const FLASH_MESSAGE_REQUEST: SendSMSRequest = {
  ...VALID_SMS_REQUEST,
  msgClass: 1,
};

export const MASKED_REQUEST: SendSMSRequest = {
  ...VALID_SMS_REQUEST,
  mask: 'MYCOMPANY',
};
