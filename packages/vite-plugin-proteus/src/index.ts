import { type ParseOptions, parseFrontMatter } from "@quill/proteus";
import type { Plugin } from "vite";

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

      // Refactor nested ternary (SonarQube S3358)
      let isIncluded = false;
      if (Array.isArray(include)) {
        isIncluded = include.some((p) =>
          p instanceof RegExp ? p.test(cleanId) : cleanId.endsWith(String(p)),
        );
      } else if (include instanceof RegExp) {
        isIncluded = include.test(cleanId);
      } else {
        isIncluded = cleanId.endsWith(include);
      }

      if (!isIncluded) {
        return null;
      }

      const result = await parseFrontMatter(code, parseOptions);

      // Extract optional fields safely. They are present in all ParseResult variants.
      let ast = null;
      let toc = null;
      let excerpt = null;

      if (!result.isEmpty && !result.error) {
        ast = result.ast ?? null;
        toc = result.toc ?? null;
        excerpt = result.excerpt ?? null;
      }

      return {
        code: [
          `export const data = ${JSON.stringify(result.data ?? {})};`,
          `export const content = ${JSON.stringify(result.content ?? "")};`,
          `export const excerpt = ${JSON.stringify(excerpt)};`,
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
