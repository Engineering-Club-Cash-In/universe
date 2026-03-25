import { ValidationError } from './errors';
import type { Message } from './types';

const VALID_CHANNELS = ['WHATSAPP', 'SMS', 'WEB', 'FACEBOOK', 'INSTAGRAM'] as const;
const VALID_TYPES = ['message', 'location', 'document', 'image', 'video', 'sound'] as const;

/**
 * Valida que el numero no este vacio
 */
export function validateNumber(number: string): void {
  if (!number || number.trim().length === 0) {
    throw new ValidationError('El numero no puede estar vacio', 'number');
  }
}

/**
 * Valida que el canal sea soportado
 */
export function validateChannel(channel: string): void {
  if (!VALID_CHANNELS.includes(channel as any)) {
    throw new ValidationError(
      `Canal invalido: "${channel}". Canales soportados: ${VALID_CHANNELS.join(', ')}`,
      'channel'
    );
  }
}

/**
 * Valida que el tipo de mensaje sea soportado
 */
export function validateType(type: string): void {
  if (!VALID_TYPES.includes(type as any)) {
    throw new ValidationError(
      `Tipo de mensaje invalido: "${type}". Tipos soportados: ${VALID_TYPES.join(', ')}`,
      'type'
    );
  }
}

/**
 * Valida un mensaje individual segun su tipo
 */
export function validateMessage(message: Message): void {
  validateNumber(message.number);
  validateChannel(message.channel);
  validateType(message.type);

  switch (message.type) {
    case 'message':
      if (!message.text || message.text.trim().length === 0) {
        throw new ValidationError('El texto del mensaje no puede estar vacio', 'text');
      }
      break;

    case 'location':
      if (!message.lat || !message.lng) {
        throw new ValidationError('lat y lng son obligatorios para mensajes de ubicacion', 'lat');
      }
      break;

    case 'document':
      if (!message.name || message.name.trim().length === 0) {
        throw new ValidationError('El nombre del archivo es obligatorio para documentos', 'name');
      }
      if (!message.url && !message.base64) {
        throw new ValidationError('Se requiere url o base64 para documentos', 'url');
      }
      break;

    case 'image':
      if (!message.url && !message.base64) {
        throw new ValidationError('Se requiere url o base64 para imagenes', 'url');
      }
      break;

    case 'video':
      if (!message.url && !message.base64) {
        throw new ValidationError('Se requiere url o base64 para videos', 'url');
      }
      break;

    case 'sound':
      if (!message.url && !message.base64) {
        throw new ValidationError('Se requiere url o base64 para audio', 'url');
      }
      break;
  }
}

/**
 * Valida un array de mensajes
 */
export function validateMessages(messages: Message[]): void {
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    throw new ValidationError('El array de mensajes no puede estar vacio', 'messages');
  }
  messages.forEach(validateMessage);
}
