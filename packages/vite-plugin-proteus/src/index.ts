import type { Plugin } from "vite";
import { parseFrontMatter, type ParseOptions } from "proteus";

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
 * @example
 * ```ts
 * // vite.config.ts
 * import { proteusPlugin } from 'vite-plugin-proteus';
 * 
 * export default {
 *   plugins: [proteusPlugin()]
 * }
 * ```
 */
export function proteusPlugin(options: ProteusPluginOptions = {}): Plugin {
  const { include = /\.md$/, ...parseOptions } = options;

  return {
    name: "vite-plugin-proteus",
    async transform(code: string, id: string) {
      // Check if file should be handled
      const cleanId = id.split("?")[0];
      const isIncluded = Array.isArray(include)
        ? include.some((pattern) => (pattern instanceof RegExp ? pattern.test(cleanId) : cleanId.endsWith(String(pattern))))
        : include instanceof RegExp
          ? include.test(cleanId)
          : cleanId.endsWith(include);

      if (!isIncluded) {
        return null;
      }

      const result = await parseFrontMatter(code, parseOptions);

      // Export the result as a JS module
      return {
        code: `export const data = ${JSON.stringify(result.data)};
export const content = ${JSON.stringify(result.content)};
export const excerpt = ${JSON.stringify(result.excerpt)};
export const format = ${JSON.stringify(result.format)};
export const isEmpty = ${JSON.stringify(result.isEmpty)};
export const ast = ${JSON.stringify(result.ast)};
export const toc = ${JSON.stringify(result.toc)};
export default { data, content, excerpt, format, isEmpty, ast, toc };`,
        map: null,
      };
    },
  };
}
