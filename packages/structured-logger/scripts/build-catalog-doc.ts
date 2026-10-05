import { writeFileSync } from 'node:fs';
import { carteraCatalog } from '../src/cartera-catalog';
import type { EventDefinition, FieldDefinition } from '../src/catalog-types';

const output = Bun.argv[2] ?? 'CATALOG.generated.md';

function fieldDescription(field: FieldDefinition): string {
  if (field.type === 'boolean' || field.type === 'timestamp' || field.type === 'uuid') return field.type;
  if (field.type === 'integer') return `integer ${field.min}..${field.max}`;
  if (field.type === 'string') return `string max=${field.maxLength} pattern=${field.pattern}`;
  return `enum: ${field.values.join(', ')}`;
}

const lines: string[] = [
  '# Catálogo ejecutable generado',
  '',
  '> No editar manualmente. Fuente: `src/cartera-catalog.ts`.',
  '',
  `Schema version: **${carteraCatalog.schemaVersion}**`,
  '',
  '## Campos comunes',
  '',
  '| Campo | Contrato |',
  '|---|---|',
];
for (const [name, definition] of Object.entries(carteraCatalog.commonFields).sort(([a], [b]) => a.localeCompare(b))) {
  lines.push(`| \`${name}\` | ${fieldDescription(definition)} |`);
}
lines.push('', '## Campos de payload', '', '| Campo | Contrato |', '|---|---|');
for (const [name, definition] of Object.entries(carteraCatalog.fields).sort(([a], [b]) => a.localeCompare(b))) {
  lines.push(`| \`${name}\` | ${fieldDescription(definition)} |`);
}
lines.push('', '## Eventos y outcomes', '');
const events: Readonly<Record<string, EventDefinition>> = carteraCatalog.events;
for (const [event, definition] of Object.entries(events).sort(([a], [b]) => a.localeCompare(b))) {
  lines.push(`### \`${event}\``, '', '| Outcome | Level | Required | Optional | Constants |', '|---|---|---|---|---|');
  for (const [outcome, rule] of Object.entries(definition.outcomes).sort(([a], [b]) => a.localeCompare(b))) {
    const required = rule.required.map((field) => `\`${field}\``).join(', ') || '—';
    const optional = rule.optional.map((field) => `\`${field}\``).join(', ') || '—';
    const constants = rule.constants
      ? Object.entries(rule.constants).map(([field, value]) => `\`${field}=${String(value)}\``).join(', ')
      : '—';
    lines.push(`| \`${outcome}\` | \`${rule.level}\` | ${required} | ${optional} | ${constants} |`);
  }
  lines.push('');
}
lines.push('## Provider → operations', '', '| Provider | Operations |', '|---|---|');
for (const [provider, operations] of Object.entries(carteraCatalog.providerOperations).sort(([a], [b]) => a.localeCompare(b))) {
  lines.push(`| \`${provider}\` | ${operations.map((operation) => `\`${operation}\``).join(', ')} |`);
}
lines.push('', '## Invariantes de conteo', '');
for (const invariant of carteraCatalog.countInvariants) {
  lines.push(`- \`${invariant.total}\` = ${[...invariant.parts, ...invariant.optionalParts].map((field) => `\`${field}\``).join(' + ')}.`);
}
writeFileSync(output, `${lines.join('\n')}\n`);
console.log(JSON.stringify({ output, events: Object.keys(carteraCatalog.events).length }));
