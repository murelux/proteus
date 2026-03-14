use pulldown_cmark::{Event, Parser, Tag, TagEnd};
use serde::Serialize;
use wasm_bindgen::prelude::*;

#[derive(Serialize)]
pub struct AstHeading {
    pub level: usize,
    pub text: String,
    pub id: String,
}

#[derive(Serialize)]
pub struct AstLink {
    pub text: String,
    pub url: String,
}

#[derive(Serialize)]
pub struct AstImage {
    pub alt: String,
    pub url: String,
}

#[derive(Serialize)]
pub struct AstCodeBlock {
    pub language: Option<String>,
    pub code: String,
}

/// Structured elements extracted from the Markdown body.
/// Note: excerpt is intentionally omitted here — it is handled by the TS
/// layer's `extractExcerpt()` to avoid duplicated logic.
#[derive(Serialize)]
pub struct MarkdownAst {
    pub headings: Vec<AstHeading>,
    pub links: Vec<AstLink>,
    pub images: Vec<AstImage>,
    pub code_blocks: Vec<AstCodeBlock>,
}

/// Generate a URL-safe slug from heading text.
/// Collapses consecutive hyphens and strips leading/trailing hyphens.
fn generate_slug(text: &str) -> String {
    let mut result = String::new();
    let mut prev_dash = false;
    for c in text.chars() {
        if c.is_alphanumeric() {
            result.push(c.to_lowercase().next().unwrap());
            prev_dash = false;
        } else if !prev_dash && !result.is_empty() {
            result.push('-');
            prev_dash = true;
        }
    }
    result.trim_end_matches('-').to_string()
}

/// Extract structural elements from a Markdown body string.
pub fn extract_ast(markdown: &str) -> MarkdownAst {
    let mut headings = Vec::new();
    let mut links = Vec::new();
    let mut images = Vec::new();
    let mut code_blocks = Vec::new();

    let mut current_heading_level = 0;
    let mut current_heading_text = String::new();

    let mut current_link_url = String::new();
    let mut current_link_text = String::new();
    let mut in_link = false;

    let mut current_image_url = String::new();
    let mut current_image_alt = String::new();
    let mut in_image = false;

    let mut in_code_block = false;
    let mut current_code_language: Option<String> = None;
    let mut current_code_content = String::new();

    use pulldown_cmark::Options;
    let mut options = Options::empty();
    options.insert(Options::ENABLE_TABLES);
    options.insert(Options::ENABLE_STRIKETHROUGH);
    options.insert(Options::ENABLE_TASKLISTS);
    options.insert(Options::ENABLE_HEADING_ATTRIBUTES);

    let parser = Parser::new_ext(markdown, options);

    for event in parser {
        match event {
            Event::Start(Tag::Heading { level, .. }) => {
                current_heading_level = level as usize;
                current_heading_text.clear();
            }
            Event::End(TagEnd::Heading(_)) => {
                if current_heading_level > 0 {
                    let text = current_heading_text.trim().to_string();
                    let id = generate_slug(&text);
                    headings.push(AstHeading { level: current_heading_level, text, id });
                    current_heading_level = 0;
                }
            }
            Event::Start(Tag::Link { dest_url, .. }) => {
                in_link = true;
                current_link_url = dest_url.to_string();
                current_link_text.clear();
            }
            Event::End(TagEnd::Link) => {
                if in_link {
                    links.push(AstLink {
                        text: current_link_text.trim().to_string(),
                        url: current_link_url.clone(),
                    });
                    in_link = false;
                }
            }
            Event::Start(Tag::Image { dest_url, .. }) => {
                in_image = true;
                current_image_url = dest_url.to_string();
                current_image_alt.clear();
            }
            Event::End(TagEnd::Image) => {
                if in_image {
                    images.push(AstImage {
                        alt: current_image_alt.trim().to_string(),
                        url: current_image_url.clone(),
                    });
                    in_image = false;
                }
            }
            Event::Start(Tag::CodeBlock(kind)) => {
                in_code_block = true;
                current_code_content.clear();
                current_code_language = match kind {
                    pulldown_cmark::CodeBlockKind::Fenced(lang) if !lang.is_empty() => {
                        Some(lang.to_string())
                    }
                    _ => None,
                };
            }
            Event::End(TagEnd::CodeBlock) => {
                if in_code_block {
                    code_blocks.push(AstCodeBlock {
                        language: current_code_language.take(),
                        code: current_code_content.clone(),
                    });
                    in_code_block = false;
                }
            }
            Event::Text(text) => {
                let s = text.to_string();
                if current_heading_level > 0 {
                    current_heading_text.push_str(&s);
                } else if in_link {
                    current_link_text.push_str(&s);
                } else if in_image {
                    current_image_alt.push_str(&s);
                } else if in_code_block {
                    current_code_content.push_str(&s);
                }
            }
            Event::Code(code) => {
                let s = code.to_string();
                if current_heading_level > 0 {
                    current_heading_text.push_str(&s);
                } else if in_link {
                    current_link_text.push_str(&s);
                }
            }
            _ => {}
        }
    }

    MarkdownAst { headings, links, images, code_blocks }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_generate_slug_simple() {
        assert_eq!(generate_slug("Hello World"), "hello-world");
    }

    #[test]
    fn test_generate_slug_multiple_spaces() {
        // Consecutive non-alphanumeric chars must collapse into a single '-'
        assert_eq!(generate_slug("Hello  World"), "hello-world");
    }

    #[test]
    fn test_generate_slug_special_chars() {
        assert_eq!(generate_slug("Rust & WASM: A Guide"), "rust-wasm-a-guide");
    }

    #[test]
    fn test_generate_slug_leading_trailing() {
        assert_eq!(generate_slug("  hello  "), "hello");
    }

    #[test]
    fn test_extract_ast_headings() {
        let md = "# Hello World\n## Sub Section\n";
        let ast = extract_ast(md);
        assert_eq!(ast.headings.len(), 2);
        assert_eq!(ast.headings[0].level, 1);
        assert_eq!(ast.headings[0].id, "hello-world");
        assert_eq!(ast.headings[1].level, 2);
        assert_eq!(ast.headings[1].id, "sub-section");
    }

    #[test]
    fn test_extract_ast_no_excerpt_field() {
        // MarkdownAst must not contain an excerpt field (handled by TS layer)
        let md = "# Title\n\nFirst paragraph text.";
        let ast = extract_ast(md);
        // Compilation itself verifies no `excerpt` field exists on MarkdownAst
        assert_eq!(ast.headings.len(), 1);
    }

    #[test]
    fn test_extract_ast_links() {
        let md = "See [Rust](https://rust-lang.org) for details.";
        let ast = extract_ast(md);
        assert_eq!(ast.links.len(), 1);
        assert_eq!(ast.links[0].text, "Rust");
        assert_eq!(ast.links[0].url, "https://rust-lang.org");
    }

    #[test]
    fn test_extract_ast_images() {
        let md = "![Ferris](https://example.com/ferris.png)";
        let ast = extract_ast(md);
        assert_eq!(ast.images.len(), 1);
        assert_eq!(ast.images[0].alt, "Ferris");
    }

    #[test]
    fn test_extract_ast_code_blocks() {
        let md = "```rust\nfn main() {}\n```";
        let ast = extract_ast(md);
        assert_eq!(ast.code_blocks.len(), 1);
        assert_eq!(ast.code_blocks[0].language.as_deref(), Some("rust"));
    }
}
