/**
 * GenderTranslator - Servicio para traducir términos legales según género
 *
 * Maneja la traducción de términos que varían por género en documentos legales,
 * incluyendo artículos, pronombres, participios y sustantivos.
 */

export type Gender = 'male' | 'female';
export type MaritalStatus = 'single' | 'married' | 'widowed' | 'divorced';

interface GenderTerms {
  // Tratamiento formal
  title: string;                    // señor / señora
  title_article: string;            // el señor / la señora
  title_with_article: string;       // al señor / a la señora

  // Sustantivo usuario/a
  user_noun: string;                // el usuario / la usuaria
  to_user: string;                  // al usuario / a la usuaria

  // Participios y adjetivos
  obligated: string;                // obligado / obligada
  direct: string;                   // directo / directa
  informed_plural: string;          // enterados / enteradas

  // Pronombres
  to_same: string;                  // al mismo / a la misma
  of_same: string;                  // del mismo / de la misma

  // Términos específicos para garantía mobiliaria
  debtor: string;                   // el deudor / la deudora
  to_debtor: string;                // al deudor / a la deudora
  debtor_guarantor: string;         // el Deudor Garante / la Deudora Garante
  depositary: string;               // el Depositario / la Depositaria
  owner: string;                    // el propietario / la propietaria
  to_owner: string;                 // al propietario / a la propietaria
  authorized: string;               // autorizado / autorizada
}

export class GenderTranslator {
  private static readonly TERMS: Record<Gender, GenderTerms> = {
    male: {
      title: 'señor',
      title_article: 'el señor',
      title_with_article: 'al señor',
      user_noun: 'el usuario',
      to_user: 'al usuario',
      obligated: 'obligado',
      direct: 'directo',
      informed_plural: 'enterados',
      to_same: 'al mismo',
      of_same: 'del mismo',
      debtor: 'el deudor',
      to_debtor: 'al deudor',
      debtor_guarantor: 'el Deudor Garante',
      depositary: 'el Depositario',
      owner: 'el propietario',
      to_owner: 'al propietario',
      authorized: 'autorizado'
    },
    female: {
      title: 'señora',
      title_article: 'la señora',
      title_with_article: 'a la señora',
      user_noun: 'la usuaria',
      to_user: 'a la usuaria',
      obligated: 'obligada',
      direct: 'directa',
      informed_plural: 'enteradas',
      to_same: 'a la misma',
      of_same: 'de la misma',
      debtor: 'la deudora',
      to_debtor: 'a la deudora',
      debtor_guarantor: 'la Deudora Garante',
      depositary: 'la Depositaria',
      owner: 'la propietaria',
      to_owner: 'a la propietaria',
      authorized: 'autorizada'
    }
  };

  private static readonly MARITAL_STATUS_MALE: Record<MaritalStatus, string> = {
    single: 'soltero',
    married: 'casado',
    widowed: 'viudo',
    divorced: 'divorciado'
  };

  private static readonly MARITAL_STATUS_FEMALE: Record<MaritalStatus, string> = {
    single: 'soltera',
    married: 'casada',
    widowed: 'viuda',
    divorced: 'divorciada'
  };

  /**
   * Obtiene todos los términos traducidos para un género específico
   */
  public static getTerms(gender: Gender): GenderTerms {
    return this.TERMS[gender];
  }

  /**
   * Traduce el estado civil según el género
   */
  public static translateMaritalStatus(status: MaritalStatus, gender: Gender): string {
    if (gender === 'male') {
      return this.MARITAL_STATUS_MALE[status];
    }
    return this.MARITAL_STATUS_FEMALE[status];
  }

  /**
   * Obtiene la nacionalidad con género (para gentilicios que terminan en -o/-a)
   * Ejemplo: guatemalteco/guatemalteca, mexicano/mexicana
   */
  public static getNationality(baseNationality: string, gender: Gender): string {
    // Si la nacionalidad base termina en 'o', reemplazar por 'a' para femenino
    if (gender === 'female' && baseNationality.endsWith('o')) {
      return baseNationality.slice(0, -1) + 'a';
    }
    // Si la nacionalidad base termina en 'a', reemplazar por 'o' para masculino
    if (gender === 'male' && baseNationality.endsWith('a')) {
      return baseNationality.slice(0, -1) + 'o';
    }
    // Si no termina en -o/-a, retornar tal cual (ej: costarricense)
    return baseNationality;
  }

  /**
   * Genera un objeto completo con todos los términos de género
   * para ser usado directamente en el template
   */
  public static generateGenderedData(
    gender: Gender,
    maritalStatus: MaritalStatus,
    nationality: string
  ): Record<string, string> {
    const terms = this.getTerms(gender);

    return {
      // Términos básicos
      ...terms,

      // Estado civil con género
      client_marital_status_gendered: this.translateMaritalStatus(maritalStatus, gender),

      // Nacionalidad con género
      client_nationality_gendered: this.getNationality(nationality, gender)
    };
  }

  /**
   * Valida que un valor de género sea válido
   */
  public static isValidGender(value: any): value is Gender {
    return value === 'male' || value === 'female';
  }

  /**
   * Valida que un valor de estado civil sea válido
   */
  public static isValidMaritalStatus(value: any): value is MaritalStatus {
    return ['single', 'married', 'widowed', 'divorced'].includes(value);
  }
}
