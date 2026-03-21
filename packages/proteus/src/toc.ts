import type { AstHeading, TocNode } from "./types.js";

/**
 * Generates a nested Table of Contents containing the headings structure.
 *
 * @param headings - A flat array of Markdown headings extracted from the AST.
 * @returns An array of top-level TOC nodes, each potentially containing nested children.
 */
export function generateTOC(headings: AstHeading[]): TocNode[] {
  if (!headings || headings.length === 0) {
    return [];
  }

  const result: TocNode[] = [];
  const stack: TocNode[] = [];

  for (const heading of headings) {
    const node: TocNode = {
      level: heading.level,
      text: heading.text,
      id: heading.id,
      children: [],
    };

    const top = () => stack[stack.length - 1];

    // Pop the stack until we find a parent that has a strictly lower level number (higher hierarchy)
    while (stack.length > 0 && top().level >= node.level) {
      stack.pop();
    }

    if (stack.length === 0) {
      // Top-level node
      result.push(node);
    } else {
      // Child of the current top of the stack
      top().children.push(node);
    }

    // Push the current node onto the stack to act as a potential parent for subsequent headings
    stack.push(node);
  }

  return result;
}
