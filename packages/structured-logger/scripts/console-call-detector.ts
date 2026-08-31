import ts from 'typescript';

function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (true) {
    if (ts.isParenthesizedExpression(current) || ts.isNonNullExpression(current) ||
      ts.isAsExpression(current) || ts.isTypeAssertionExpression(current) ||
      ts.isSatisfiesExpression(current)) {
      current = current.expression;
      continue;
    }
    return current;
  }
}

export function consoleMethod(expression: ts.LeftHandSideExpression): string | undefined {
  const callee = unwrapExpression(expression);
  if (ts.isPropertyAccessExpression(callee)) {
    const receiver = unwrapExpression(callee.expression);
    return ts.isIdentifier(receiver) && receiver.text === 'console'
      ? callee.name.text
      : undefined;
  }
  if (ts.isElementAccessExpression(callee)) {
    const receiver = unwrapExpression(callee.expression);
    const argument = callee.argumentExpression ? unwrapExpression(callee.argumentExpression) : undefined;
    return ts.isIdentifier(receiver) && receiver.text === 'console' && argument &&
      (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument))
      ? argument.text
      : undefined;
  }
  return undefined;
}
