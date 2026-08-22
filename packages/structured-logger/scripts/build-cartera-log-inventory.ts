import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname } from 'node:path';
import ts from 'typescript';
import { carteraCatalog } from '../src/cartera-catalog';
import { parseSliceManifest, type ManifestEntry } from './manifest-validator';
import { consoleMethod } from './console-call-detector';

const repo = new URL('../../..', import.meta.url).pathname;
const commit = Bun.argv[2];
const output = Bun.argv[3];
const targetCommit = '56717ddef8f0bbd8c8633172c8ca2c85c248dfd7';

if (!commit || !output) {
  throw new Error('usage: bun scripts/build-cartera-log-inventory.ts <commit> <output.csv>');
}

const consoleMethods = new Set(['log', 'error', 'warn', 'time', 'timeEnd', 'table']);
const extensions = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']);
const excludedParts = new Set(['node_modules', 'dist', 'build', 'coverage', '.turbo']);
const sliceManifests = [
  {
    file: 'FIRST_SLICE_DISPOSITIONS.json',
    paths: new Set([
      'apps/cartera-back/src/controllers/registerPayment.ts',
      'apps/cartera-back/src/utils/functions/uploadsFiles.ts',
    ]),
  },
  {
    file: 'SECOND_SLICE_DISPOSITIONS.json',
    paths: new Set(['apps/cartera-back/src/controllers/revalidatePayment.ts']),
  },
] as const;
const reviewedPaths = new Set(sliceManifests.flatMap(({ paths }) => [...paths]));


function git(args: string[]): string {
  const result = Bun.spawnSync(['git', '-C', repo, ...args], { stdout: 'pipe', stderr: 'pipe' });
  if (result.exitCode !== 0) throw new Error(`git command failed with exit ${result.exitCode}`);
  return result.stdout.toString();
}

function isExcluded(path: string): boolean {
  const parts = path.split('/');
  const name = parts.at(-1)?.toLowerCase() ?? '';
  if (!extensions.has(extname(name))) return true;
  if (parts.some((part) => excludedParts.has(part))) return true;
  if (parts.some((part) => ['test', 'tests', '__tests__', 'fixtures'].includes(part.toLowerCase()))) return true;
  if (['.test.', '.spec.', '.integration.'].some((marker) => name.includes(marker))) return true;
  return path.endsWith('/src/scripts/testMoraFlows.ts');
}

function scriptKind(path: string): ts.ScriptKind {
  const extension = extname(path);
  if (extension === '.tsx') return ts.ScriptKind.TSX;
  if (extension === '.jsx') return ts.ScriptKind.JSX;
  if (['.js', '.mjs', '.cjs'].includes(extension)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}


function normalizeArgument(argument: ts.Expression | undefined): string {
  if (!argument) return '<none>';
  if (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument)) {
    return argument.text.replace(/\s+/g, ' ').trim().slice(0, 180) || '<empty>';
  }
  if (ts.isTemplateExpression(argument)) {
    return [argument.head.text, ...argument.templateSpans.flatMap((span) => ['{expr}', span.literal.text])]
      .join('')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 180) || '<empty>';
  }
  return '<dynamic>';
}

function key(path: string, line: number, method: string): string {
  return `${path}:${line}:${method}`;
}

function loadManifest(): ReadonlyMap<string, ManifestEntry> {
  if (commit !== targetCommit) return new Map();
  const result = new Map<string, ManifestEntry>();
  for (const { file, paths } of sliceManifests) {
    const manifestPath = new URL(`../references/${file}`, import.meta.url);
    const manifest = parseSliceManifest(
      JSON.parse(readFileSync(manifestPath, 'utf8')) as unknown,
      carteraCatalog,
      commit,
      paths,
    );
    for (const entry of manifest.entries) {
      const entryKey = key(entry.path, entry.line, entry.method);
      if (result.has(entryKey)) throw new Error(`duplicate manifest entry: ${entryKey}`);
      result.set(entryKey, entry);
    }
  }
  return result;
}

function csv(value: string | number): string {
  return `"${String(value).replaceAll('"', '""')}"`;
}

const manifest = loadManifest();
const usedManifestEntries = new Set<string>();
const paths = git(['ls-tree', '-r', '--name-only', commit, '--', 'apps/cartera-back'])
  .split('\n')
  .filter(Boolean)
  .filter((path) => !isExcluded(path));
const rows: string[] = [];

for (const path of paths) {
  const source = git(['show', `${commit}:${path}`]);
  const sourceFile = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, scriptKind(path));
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const methodName = consoleMethod(node.expression);
      if (methodName && consoleMethods.has(methodName)) {
        const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
        const method = `console.${methodName}`;
        const entryKey = key(path, line, method);
        const decision = manifest.get(entryKey);
        if (commit === targetCommit && reviewedPaths.has(path) && !decision) {
          throw new Error(`unreviewed slice call: ${entryKey}`);
        }
        if (decision) usedManifestEntries.add(entryKey);
        rows.push([
          commit,
          path,
          line,
          method,
          normalizeArgument(node.arguments[0]),
          decision?.classification ?? 'unresolved',
          decision?.disposition ?? 'unresolved',
          decision?.event ?? '',
          decision?.outcome ?? '',
          decision?.rationale ?? 'pending_semantic_review',
        ].map(csv).join(','));
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
}

if (commit === targetCommit && usedManifestEntries.size !== manifest.size) {
  const unused = [...manifest.keys()].filter((entryKey) => !usedManifestEntries.has(entryKey));
  throw new Error(`stale slice manifest entries: ${unused.join(', ')}`);
}

mkdirSync(dirname(output), { recursive: true });
writeFileSync(
  output,
  [
    'commit,path,line,method,normalized_template,classification,disposition,event,outcome,rationale',
    ...rows,
  ].join('\n') + '\n',
);
console.log(JSON.stringify({ commit, calls: rows.length, output }));
