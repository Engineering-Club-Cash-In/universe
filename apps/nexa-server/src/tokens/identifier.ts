const MIN_IDENTIFIER_SEQUENCE = 100_000_000;
const MAX_IDENTIFIER_SEQUENCE = 999_999_999;

export function formatTokenIdentifier(sequence: number): string {
  if (!Number.isInteger(sequence) || sequence < MIN_IDENTIFIER_SEQUENCE || sequence > MAX_IDENTIFIER_SEQUENCE) {
    throw new Error("Identifier sequence must be between 100000000 and 999999999");
  }

  return sequence.toString();
}

export function formatTokenIdentifierForPrefix(options: { prefix: string; sequence: number }): string {
  if (!/^\d+$/.test(options.prefix) || options.prefix.length >= 16) {
    throw new Error("Nexa token prefix must be numeric and shorter than 16 digits");
  }

  if (!Number.isInteger(options.sequence) || options.sequence < MIN_IDENTIFIER_SEQUENCE || options.sequence > MAX_IDENTIFIER_SEQUENCE) {
    throw new Error("Identifier sequence must be between 100000000 and 999999999");
  }

  return formatTokenIdentifier(options.sequence);
}
