import ts from 'typescript';

/**
 * Todos os especificadores de módulo que um ficheiro TypeScript refere, lidos da árvore sintáctica:
 * import/export ... from, import 'x', import x = require('x'), import('x'), require('x') e tipos import('x').T.
 */
export function moduleSpecifiers(fileName: string, source: string): string[] {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const found: string[] = [];
  const literal = (node: ts.Node | undefined) => { if (node && ts.isStringLiteralLike(node)) found.push(node.text); };
  const visit = (node: ts.Node): void => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) literal(node.moduleSpecifier);
    else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) literal(node.moduleReference.expression);
    else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
      // import(expr) / require(expr): se o argumento não é um literal, não dá para provar nada, por isso conta como violação.
      if (ts.isStringLiteralLike(node.arguments[0]!)) literal(node.arguments[0]); else found.push('<dynamic>');
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) literal(node.argument.literal);
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}
