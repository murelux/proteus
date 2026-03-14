import type { Plugin } from "vite";
import { parseFrontMatter, type ParseOptions, type ParseResult } from "@quill/proteus";

interface ProteusPluginOptions extends ParseOptions {
  /**
   * Filter which files to process.
   * @default /\.md$/
   */
  include?: RegExp | string | (RegExp | string)[];
}

/**
 * A Vite plugin to import Markdown files as structured data objects.
 *
 * Each `.md` file is transformed into an ES module exporting:
 * - `data`    — parsed front matter object
 * - `content` — Markdown body (front matter stripped)
 * - `excerpt` — first excerpt (if configured via `ParseOptions.excerpt`)
 * - `format`  — detected format: "yaml" | "json" | "toml" | undefined
 * - `isEmpty` — true when no front matter block was found
 * - `ast`     — structural AST (headings, links, images, code blocks)
 *
 * @example
 * ```ts
 * // vite.config.ts
 * import { proteusPlugin } from 'vite-plugin-proteus';
 *
 * export default {
 *   plugins: [proteusPlugin()]
 * }
 * ```
 *
 * @example
 * ```ts
 * // In a component
 * import post from './posts/hello.md';
 * console.log(post.data.title);
 * console.log(post.ast.headings);
 * ```
 */
export function proteusPlugin(options: ProteusPluginOptions = {}): Plugin {
  const { include = /\.md$/, ...parseOptions } = options;

  return {
    name: "vite-plugin-proteus",
    async transform(code: string, id: string) {
      const cleanId = id.split("?")[0];
      const isIncluded = Array.isArray(include)
        ? include.some((pattern) =>
            pattern instanceof RegExp
              ? pattern.test(cleanId)
              : cleanId.endsWith(String(pattern))
          )
        : include instanceof RegExp
          ? include.test(cleanId)
          : cleanId.endsWith(include);

      if (!isIncluded) {
        return null;
      }

      const result: ParseResult<unknown> = await parseFrontMatter(code, parseOptions);

      // `ast` and `toc` come from ParseResultSuccess; guard against empty/error variants
      const ast = !result.isEmpty && !result.error ? (result as any).ast ?? null : null;
      const toc = !result.isEmpty && !result.error ? (result as any).toc ?? null : null;

      return {
        code: [
          `export const data = ${JSON.stringify(result.data ?? {})};`,
          `export const content = ${JSON.stringify(result.content ?? "")};`,
          `export const excerpt = ${JSON.stringify(
            !result.isEmpty && !result.error ? (result as any).excerpt ?? null : null
          )};`,
          `export const format = ${JSON.stringify(result.format ?? null)};`,
          `export const isEmpty = ${JSON.stringify(result.isEmpty ?? false)};`,
          `export const ast = ${JSON.stringify(ast)};`,
          `export const toc = ${JSON.stringify(toc)};`,
          `export default { data, content, excerpt, format, isEmpty, ast, toc };`,
        ].join("\n"),
        map: null,
      };
    },
  };
}
