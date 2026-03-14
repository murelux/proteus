use pulldown_cmark::{Event, Parser, Tag, TagEnd};
use serde::Serialize;
use wasm_bindgen::prelude::*;

// Define AST node structures that can be serialized to JS

#[derive(Serialize)]
pub struct AstHeading {
    pub level: usize,
    pub text: String,
    pub id: String, // simplified slug
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

#[derive(Serialize)]
pub struct MarkdownAst {
    pub headings: Vec<AstHeading>,
    pub links: Vec<AstLink>,
    pub images: Vec<AstImage>,
    pub code_blocks: Vec<AstCodeBlock>,
    pub excerpt: Option<String>,
}

/// Helper to generate a simple slug from text
fn generate_slug(text: &str) -> String {
    text.to_lowercase()
        .replace(|c: char| !c.is_alphanumeric() && c != '-', "-")
        .trim_matches('-')
        .to_string()
}

/// Extract structural bits from Markdown string into a MarkdownAst object
pub fn extract_ast(markdown: &str) -> MarkdownAst {
    let mut headings = Vec::new();
    let mut links = Vec::new();
    let mut images = Vec::new();
    let mut code_blocks = Vec::new();
    
    // Simplistic excerpt: just grab the first paragraph text
    let mut excerpt = String::new();
    let mut in_first_paragraph = false;
    let mut first_paragraph_done = false;

    let mut current_heading_level = 0;
    let mut current_heading_text = String::new();
    
    let mut current_link_url = String::new();
    let mut current_link_text = String::new();
    let mut in_link = false;
    
    let mut current_image_url = String::new();
    let mut current_image_alt = String::new();
    let mut in_image = false;
    
    let mut in_code_block = false;
    let mut current_code_language = None;
    let mut current_code_content = String::new();

    let parser = Parser::new(markdown);

    for event in parser {
        match event {
            // -- HEADINGS --
            Event::Start(Tag::Heading { level, .. }) => {
                current_heading_level = level as usize;
                current_heading_text.clear();
            }
            Event::End(TagEnd::Heading(_level)) => {
                if current_heading_level > 0 {
                    let text = current_heading_text.trim().to_string();
                    let id = generate_slug(&text);
                    headings.push(AstHeading {
                        level: current_heading_level,
                        text,
                        id,
                    });
                    current_heading_level = 0;
                }
            }
            
            // -- LINKS --
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
            
            // -- IMAGES --
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
            
            // -- CODE BLOCKS --
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
            
            // -- PARAGRAPH (for excerpt) --
            Event::Start(Tag::Paragraph) => {
                if !first_paragraph_done {
                    in_first_paragraph = true;
                }
            }
            Event::End(TagEnd::Paragraph) => {
                if in_first_paragraph {
                    in_first_paragraph = false;
                    first_paragraph_done = true;
                }
            }
            
            // -- TEXT --
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
                } else if in_first_paragraph {
                    if !excerpt.is_empty() && !excerpt.ends_with(' ') && !s.starts_with(' ') {
                        let c = excerpt.chars().last().unwrap();
                        if c.is_alphanumeric() || c.is_ascii_punctuation() {
                            excerpt.push(' ');
                        }
                    }
                    excerpt.push_str(&s);
                }
            }
            
            // -- CODE (inline) --
            Event::Code(code) => {
                 let s = code.to_string();
                 if current_heading_level > 0 {
                    current_heading_text.push_str(&s);
                } else if in_link {
                    current_link_text.push_str(&s);
                } else if in_first_paragraph {
                    if !excerpt.is_empty() && !excerpt.ends_with(' ') && !s.starts_with(' ') {
                        let c = excerpt.chars().last().unwrap();
                        if c.is_alphanumeric() || c.is_ascii_punctuation() {
                            excerpt.push(' ');
                        }
                    }
                    excerpt.push_str(&s);
                }
            }
            
            _ => {}
        }
    }

    MarkdownAst {
        headings,
        links,
        images,
        code_blocks,
        excerpt: if excerpt.is_empty() { None } else { Some(excerpt.trim().to_string()) },
    }
}
