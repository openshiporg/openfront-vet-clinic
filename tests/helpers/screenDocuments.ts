import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

/**
 * Review r6 #1: every GraphQL document the dashboard screens send, read straight from the source.
 * Template placeholders are filled the way they can be at run time: a const string from the same file is
 * inlined, `take: ${PAGE}` becomes the const's number and any other `take: ${…}` the largest page (500), `where: ${…}` becomes `{}`, anything else
 * (an optional variable list, an optional search clause) becomes empty. Nested templates are expanded
 * with the same rules.
 */
export type ScreenDocument = { file: string; line: number; source: string }

const ROOT = path.join(__dirname, '..', '..')

function files(dir: string, out: string[] = []) {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f)
    if (fs.statSync(p).isDirectory()) files(p, out)
    else if (/\.tsx?$/.test(f) && !/\.(test|spec|node-test)\.tsx?$/.test(f)) out.push(p)
  }
  return out
}

const looksLikeGraphQL = (text: string) => /^\s*(query|mutation)\b[\s\S]*\{|^\s*\{\s*[A-Za-z_]/.test(text) && /\}\s*$/.test(text)

export function screenDocuments(dir = path.join(ROOT, 'features', 'platform')): ScreenDocument[] {
  const docs: ScreenDocument[] = []
  for (const file of files(dir)) {
    const text = fs.readFileSync(file, 'utf8')
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
    const consts = new Map<string, ts.Expression>()
    const numbers = new Map<string, string>()
    const gather = (n: ts.Node) => {
      if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer && ts.isNumericLiteral(n.initializer)) numbers.set(n.name.text, n.initializer.text)
      if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer && (ts.isStringLiteral(n.initializer) || ts.isNoSubstitutionTemplateLiteral(n.initializer) || ts.isTemplateExpression(n.initializer) || ts.isConditionalExpression(n.initializer))) consts.set(n.name.text, n.initializer)
      ts.forEachChild(n, gather)
    }
    gather(sf)
    const render = (e: ts.Expression, before: string): string => {
      if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return e.text
      if (ts.isTemplateExpression(e)) {
        let out = e.head.text
        for (const span of e.templateSpans) out += fill(span.expression, out) + span.literal.text
        return out
      }
      return fill(e, before)
    }
    const fill = (e: ts.Expression, before: string): string => {
      if (/take:\s*$/.test(before)) return ts.isIdentifier(e) && numbers.has(e.text) ? numbers.get(e.text)! : '500'
      if (/where:\s*$/.test(before)) return '{}'
      if (ts.isIdentifier(e) && consts.has(e.text)) return render(consts.get(e.text)!, before)
      if (ts.isParenthesizedExpression(e)) return fill(e.expression, before)
      // `in: ${JSON.stringify(LIST)}`
      if (ts.isCallExpression(e) && e.expression.getText() === 'JSON.stringify') return '[]'
      // `cond ? a : b`: take the longer branch (the one that adds selection or filters).
      if (ts.isConditionalExpression(e)) {
        const a = fill(e.whenTrue, before), b = fill(e.whenFalse, before)
        return a.length >= b.length ? a : b
      }
      if (ts.isTemplateExpression(e) || ts.isNoSubstitutionTemplateLiteral(e) || ts.isStringLiteral(e)) return render(e, before)
      return ''
    }
    const visit = (n: ts.Node) => {
      if ((ts.isTemplateExpression(n) || ts.isNoSubstitutionTemplateLiteral(n)) && !ts.isTemplateSpan(n.parent) && !(ts.isConditionalExpression(n.parent))) {
        const source = render(n, '')
        if (looksLikeGraphQL(source)) docs.push({ file: path.relative(ROOT, file), line: sf.getLineAndCharacterOfPosition(n.getStart()).line + 1, source })
      }
      ts.forEachChild(n, visit)
    }
    visit(sf)
  }
  return docs
}
