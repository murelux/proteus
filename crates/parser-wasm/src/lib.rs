use serde::Serialize;
use serde_wasm_bindgen::Serializer;
use wasm_bindgen::prelude::*;

pub mod ast;

/// Maximum allowed input size (1 MB).
const MAX_INPUT_SIZE: usize = 1_048_576;

/// Serializer configured to emit plain JS objects instead of `Map` instances.
const JS_SERIALIZER: Serializer = Serializer::new().serialize_maps_as_objects(true);

/// Reject inputs that exceed `MAX_INPUT_SIZE` (pure Rust, no wasm-bindgen dependency).
fn validate_input_size(input: &str) -> Result<(), String> {
    if input.len() > MAX_INPUT_SIZE {
        return Err(format!(
            "Input too large: {} bytes (max: {} bytes)",
            input.len(),
            MAX_INPUT_SIZE
        ));
    }
    Ok(())
}

/// Reject inputs — JsError wrapper for WASM exports.
fn check_input_size(input: &str) -> Result<(), JsError> {
    validate_input_size(input).map_err(|e| JsError::new(&e))
}

/// Maximum allowed output size (1 MB).
const MAX_OUTPUT_SIZE: usize = 1_048_576;

/// Reject serialized output that exceeds `MAX_OUTPUT_SIZE` (pure Rust).
fn validate_output_size(output: String) -> Result<String, String> {
    if output.len() > MAX_OUTPUT_SIZE {
        return Err(format!(
            "Output too large: {} bytes (max: {} bytes)",
            output.len(),
            MAX_OUTPUT_SIZE
        ));
    }
    Ok(output)
}

/// Reject output — JsError wrapper for WASM exports.
fn check_output_size(output: String) -> Result<String, JsError> {
    validate_output_size(output).map_err(|e| JsError::new(&e))
}

/// Serialize any `Serialize` value into a `JsValue` using object-style maps.
fn to_js<T: Serialize>(value: &T) -> Result<JsValue, JsError> {
    value
        .serialize(&JS_SERIALIZER)
        .map_err(|e| JsError::new(&format!("Serialization error: {e}")))
}

/// Maximum number of YAML aliases allowed to mitigate Billion Laughs DoS
const MAX_YAML_ALIASES: usize = 50;

/// Fast pre-scan to reject YAML inputs with excessive alias usage
fn check_yaml_alias_limit(input: &str) -> Result<(), JsError> {
    // Quickly count the number of alias nodes (*alias) in the string
    // This is a heuristic pre-filter before passing to full serde parsing
    let alias_count = input.matches('*').count();
    if alias_count > MAX_YAML_ALIASES {
        return Err(JsError::new(&format!(
            "YAML parse error: Too many aliases (found {}, max {})",
            alias_count, MAX_YAML_ALIASES
        )));
    }
    Ok(())
}

/// Parse a YAML string into a JavaScript value.
///
/// Uses `serde-saphyr` (pure Rust, YAML 1.2, no unsafe).
///
/// NOTE: YAML is first deserialized into `serde_json::Value` as an
/// intermediate representation, then converted to `JsValue` via
/// `serde-wasm-bindgen`.  This means YAML-specific types (e.g. `!!timestamp`,
/// `!!null` tag variants) are normalised to their JSON equivalents (strings,
/// null).  This is intentional for the front matter use-case where JSON-safe
/// types are expected.
///
/// # Errors
/// Returns a `JsError` if the input is not valid YAML or exceeds the size limit.
/// Error message includes line and column information when available.
#[wasm_bindgen]
pub fn parse_yaml(input: &str) -> Result<JsValue, JsError> {
    check_input_size(input)?;
    check_yaml_alias_limit(input)?;

    let value: serde_json::Value = serde_saphyr::from_str(input).map_err(|e| {
        // serde-saphyr errors include location info in the Display output
        JsError::new(&format!("YAML parse error: {e}"))
    })?;
    to_js(&value)
}

/// Parse a JSON string into a JavaScript value.
///
/// # Errors
/// Returns a `JsError` if the input is not valid JSON or exceeds the size limit.
/// Error message includes line and column information.
#[wasm_bindgen]
pub fn parse_json(input: &str) -> Result<JsValue, JsError> {
    check_input_size(input)?;
    let value: serde_json::Value = serde_json::from_str(input).map_err(|e| {
        JsError::new(&format!(
            "JSON parse error at line {}, column {}: {}",
            e.line(),
            e.column(),
            e
        ))
    })?;
    to_js(&value)
}

/// Parse a TOML string into a JavaScript value.
///
/// # Errors
/// Returns a `JsError` if the input is not valid TOML or exceeds the size limit.
/// Error message includes span information when available.
#[wasm_bindgen]
pub fn parse_toml(input: &str) -> Result<JsValue, JsError> {
    check_input_size(input)?;
    let value: toml::Value = toml::from_str(input).map_err(|e| {
        // toml errors include span info in Display
        JsError::new(&format!("TOML parse error: {e}"))
    })?;
    to_js(&value)
}

/// Stringify a JavaScript value to YAML.
///
/// # Errors
/// Returns a `JsError` if serialization fails.
#[wasm_bindgen]
pub fn stringify_yaml(value: JsValue) -> Result<String, JsError> {
    let v: serde_json::Value = serde_wasm_bindgen::from_value(value)
        .map_err(|e| JsError::new(&format!("Failed to convert JS value: {e}")))?;
    let result = serde_saphyr::to_string(&v)
        .map_err(|e| JsError::new(&format!("YAML stringify error: {e}")))?;
    check_output_size(result)
}

/// Stringify a JavaScript value to JSON (pretty-printed).
///
/// # Errors
/// Returns a `JsError` if serialization fails.
#[wasm_bindgen]
pub fn stringify_json(value: JsValue) -> Result<String, JsError> {
    let v: serde_json::Value = serde_wasm_bindgen::from_value(value)
        .map_err(|e| JsError::new(&format!("Failed to convert JS value: {e}")))?;
    let result = serde_json::to_string_pretty(&v)
        .map_err(|e| JsError::new(&format!("JSON stringify error: {e}")))?;
    check_output_size(result)
}

/// Stringify a JavaScript value to TOML.
///
/// # Errors
/// Returns a `JsError` if serialization fails.
#[wasm_bindgen]
pub fn stringify_toml(value: JsValue) -> Result<String, JsError> {
    let v: serde_json::Value = serde_wasm_bindgen::from_value(value)
        .map_err(|e| JsError::new(&format!("Failed to convert JS value: {e}")))?;
    let result = toml::to_string_pretty(&v)
        .map_err(|e| JsError::new(&format!("TOML stringify error: {e}")))?;
    check_output_size(result)
}

/// Extract AST from Markdown body.
#[wasm_bindgen]
pub fn extract_markdown_ast(markdown: &str) -> Result<JsValue, JsError> {
    check_input_size(markdown)?;
    let ast = ast::extract_ast(markdown);
    to_js(&ast)
}

#[cfg(test)]
mod tests {
    use super::*;

    // -----------------------------------------------------------------------
    // Happy-path (existing)
    // -----------------------------------------------------------------------

    #[test]
    fn test_parse_yaml_valid() {
        let input = "title: Hello\ncount: 42\n";
        let value: serde_json::Value = serde_saphyr::from_str(input).unwrap();
        assert_eq!(value["title"], "Hello");
        assert_eq!(value["count"], 42);
    }

    #[test]
    fn test_parse_json_valid() {
        let input = r#"{"title": "Hello", "count": 42}"#;
        let value: serde_json::Value = serde_json::from_str(input).unwrap();
        assert_eq!(value["title"], "Hello");
        assert_eq!(value["count"], 42);
    }

    #[test]
    fn test_parse_toml_valid() {
        let input = "title = \"Hello\"\ncount = 42\n";
        let value: toml::Value = toml::from_str(input).unwrap();
        assert_eq!(value["title"].as_str().unwrap(), "Hello");
        assert_eq!(value["count"].as_integer().unwrap(), 42);
    }

    #[test]
    fn test_stringify_yaml() {
        let value = serde_json::json!({"title": "Hello", "count": 42});
        let yaml = serde_saphyr::to_string(&value).unwrap();
        assert!(yaml.contains("title:"));
        assert!(yaml.contains("Hello"));
    }

    #[test]
    fn test_stringify_json() {
        let value = serde_json::json!({"title": "Hello"});
        let json = serde_json::to_string_pretty(&value).unwrap();
        assert!(json.contains("\"title\""));
    }

    #[test]
    fn test_stringify_toml() {
        let value = serde_json::json!({"title": "Hello", "count": 42});
        let toml_str = toml::to_string_pretty(&value).unwrap();
        assert!(toml_str.contains("title"));
    }

    // -----------------------------------------------------------------------
    // Invalid input — parse errors
    // -----------------------------------------------------------------------

    #[test]
    fn test_parse_yaml_invalid() {
        let input = ":\n  - :\n    -invalid";
        let result: Result<serde_json::Value, _> = serde_saphyr::from_str(input);
        assert!(result.is_err());
    }

    #[test]
    fn test_parse_json_invalid() {
        let input = r#"{"title": broken}"#;
        let result: Result<serde_json::Value, _> = serde_json::from_str(input);
        assert!(result.is_err());
        let err = result.unwrap_err();
        // Error should include line/column info
        assert!(err.line() > 0);
        assert!(err.column() > 0);
    }

    #[test]
    fn test_parse_json_trailing_comma() {
        let input = r#"{"title": "Hello",}"#;
        let result: Result<serde_json::Value, _> = serde_json::from_str(input);
        assert!(result.is_err());
    }

    #[test]
    fn test_parse_toml_invalid() {
        let input = "title = \ntoo broken";
        let result: Result<toml::Value, _> = toml::from_str(input);
        assert!(result.is_err());
    }

    // -----------------------------------------------------------------------
    // Empty input
    // -----------------------------------------------------------------------

    #[test]
    fn test_parse_yaml_empty() {
        let input = "";
        // Empty YAML parses to Null
        let value: serde_json::Value = serde_saphyr::from_str(input).unwrap();
        assert!(value.is_null());
    }

    #[test]
    fn test_parse_json_empty() {
        let input = "";
        let result: Result<serde_json::Value, _> = serde_json::from_str(input);
        assert!(result.is_err());
    }

    #[test]
    fn test_parse_toml_empty() {
        let input = "";
        let value: toml::Value = toml::from_str(input).unwrap();
        // Empty TOML parses to an empty table
        assert!(value.is_table());
        assert!(value.as_table().unwrap().is_empty());
    }

    // -----------------------------------------------------------------------
    // Size limit enforcement
    // -----------------------------------------------------------------------

    #[test]
    fn test_check_input_size_within_limit() {
        let input = "a".repeat(MAX_INPUT_SIZE);
        assert!(validate_input_size(&input).is_ok());
    }

    #[test]
    fn test_check_input_size_exceeds_limit() {
        let input = "a".repeat(MAX_INPUT_SIZE + 1);
        let result = validate_input_size(&input);
        assert!(result.is_err());
    }

    #[test]
    fn test_check_input_size_multibyte_utf8() {
        // Each CJK character is 3 bytes in UTF-8, so 350_000 chars ≈ 1.05 MB
        let input: String = std::iter::repeat('中').take(350_000).collect();
        assert!(input.len() > MAX_INPUT_SIZE);
        let result = validate_input_size(&input);
        assert!(result.is_err());
    }

    #[test]
    fn test_check_output_size_within_limit() {
        let output = "b".repeat(MAX_OUTPUT_SIZE);
        assert!(validate_output_size(output).is_ok());
    }

    #[test]
    fn test_check_output_size_exceeds_limit() {
        let output = "b".repeat(MAX_OUTPUT_SIZE + 1);
        let result = validate_output_size(output);
        assert!(result.is_err());
    }

    // -----------------------------------------------------------------------
    // Edge cases — special values
    // -----------------------------------------------------------------------

    #[test]
    fn test_parse_yaml_nested() {
        let input = "parent:\n  child:\n    key: value\n";
        let value: serde_json::Value = serde_saphyr::from_str(input).unwrap();
        assert_eq!(value["parent"]["child"]["key"], "value");
    }

    #[test]
    fn test_parse_yaml_array() {
        let input = "tags:\n  - rust\n  - wasm\n";
        let value: serde_json::Value = serde_saphyr::from_str(input).unwrap();
        assert_eq!(value["tags"][0], "rust");
        assert_eq!(value["tags"][1], "wasm");
    }

    #[test]
    fn test_parse_json_nested() {
        let input = r#"{"a": {"b": {"c": 1}}}"#;
        let value: serde_json::Value = serde_json::from_str(input).unwrap();
        assert_eq!(value["a"]["b"]["c"], 1);
    }

    #[test]
    fn test_parse_json_special_floats() {
        // JSON does not support NaN/Infinity — they should error
        let nan = serde_json::from_str::<serde_json::Value>("NaN");
        assert!(nan.is_err());

        let inf = serde_json::from_str::<serde_json::Value>("Infinity");
        assert!(inf.is_err());
    }

    #[test]
    fn test_parse_toml_nested_tables() {
        let input = "[parent]\nkey = \"val\"\n\n[parent.child]\nnested = true\n";
        let value: toml::Value = toml::from_str(input).unwrap();
        assert_eq!(value["parent"]["key"].as_str().unwrap(), "val");
        assert_eq!(value["parent"]["child"]["nested"].as_bool().unwrap(), true);
    }

    #[test]
    fn test_parse_yaml_unicode() {
        let input = "title: 你好世界\nemoji: 🦀\n";
        let value: serde_json::Value = serde_saphyr::from_str(input).unwrap();
        assert_eq!(value["title"], "你好世界");
        assert_eq!(value["emoji"], "🦀");
    }

    #[test]
    fn test_stringify_roundtrip_yaml() {
        let original = serde_json::json!({"title": "Test", "tags": ["a", "b"]});
        let yaml = serde_saphyr::to_string(&original).unwrap();
        let parsed: serde_json::Value = serde_saphyr::from_str(&yaml).unwrap();
        assert_eq!(original, parsed);
    }

    #[test]
    fn test_stringify_roundtrip_json() {
        let original = serde_json::json!({"title": "Test", "count": 42});
        let json = serde_json::to_string_pretty(&original).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(original, parsed);
    }

    #[test]
    fn test_stringify_roundtrip_toml() {
        let original = serde_json::json!({"title": "Test", "count": 42});
        let toml_str = toml::to_string_pretty(&original).unwrap();
        let parsed: toml::Value = toml::from_str(&toml_str).unwrap();
        assert_eq!(parsed["title"].as_str().unwrap(), "Test");
        assert_eq!(parsed["count"].as_integer().unwrap(), 42);
    }
}
