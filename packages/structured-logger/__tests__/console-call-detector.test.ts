import { expect, test } from 'bun:test';
import ts from 'typescript';
import { consoleMethod } from '../scripts/console-call-detector';

function detectedMethods(source: string): string[] {
  const file = ts.createSourceFile('sample.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const methods: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const method = consoleMethod(node.expression);
      if (method) methods.push(method);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return methods;
}

test('detects direct, computed-template and parenthesized console calls', () => {
  expect(detectedMethods(`
    console.log('a');
    console['warn']('b');
    console[\`log\`]('c');
    (console).error('d');
    (console.log)('e');
    (console['warn'])('f');
    console!.warn('g');
    (console as Console).error('h');
    (<Console>console).log('i');
    console[('log' as const)]('j');
    console[(<string>'warn')]('k');
    console[('error' satisfies string)]('l');
    console['table'!]('m');
  `)).toEqual([
    'log', 'warn', 'log', 'error', 'log', 'warn', 'warn', 'error', 'log',
    'log', 'warn', 'error', 'table',
  ]);
});
