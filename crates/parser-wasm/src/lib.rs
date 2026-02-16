use serde::Serialize;
use serde_wasm_bindgen::Serializer;
use wasm_bindgen::prelude::*;

/// Maximum allowed input size (1 MB).
const MAX_INPUT_SIZE: usize = 1_048_576;

/// Serializer configured to emit plain JS objects instead of `Map` instances.
const JS_SERIALIZER: Serializer = Serializer::new().serialize_maps_as_objects(true);

/// Reject inputs that exceed `MAX_INPUT_SIZE`.
fn check_input_size(input: &str) -> Result<(), JsError> {
    if input.len() > MAX_INPUT_SIZE {
        return Err(JsError::new(&format!(
            "Input too large: {} bytes (max: {} bytes)",
            input.len(),
            MAX_INPUT_SIZE
        )));
    }
    Ok(())
}

/// Serialize any `Serialize` value into a `JsValue` using object-style maps.
fn to_js<T: Serialize>(value: &T) -> Result<JsValue, JsError> {
    value
        .serialize(&JS_SERIALIZER)
        .map_err(|e| JsError::new(&format!("Serialization error: {e}")))
}

/// Parse a YAML string into a JavaScript value.
///
/// Uses `serde-saphyr` (pure Rust, YAML 1.2, no unsafe).
///
/// # Errors
/// Returns a `JsError` if the input is not valid YAML or exceeds the size limit.
/// Error message includes line and column information when available.
#[wasm_bindgen]
pub fn parse_yaml(input: &str) -> Result<JsValue, JsError> {
    check_input_size(input)?;
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
    serde_saphyr::to_string(&v)
        .map_err(|e| JsError::new(&format!("YAML stringify error: {e}")))
}

/// Stringify a JavaScript value to JSON (pretty-printed).
///
/// # Errors
/// Returns a `JsError` if serialization fails.
#[wasm_bindgen]
pub fn stringify_json(value: JsValue) -> Result<String, JsError> {
    let v: serde_json::Value = serde_wasm_bindgen::from_value(value)
        .map_err(|e| JsError::new(&format!("Failed to convert JS value: {e}")))?;
    serde_json::to_string_pretty(&v)
        .map_err(|e| JsError::new(&format!("JSON stringify error: {e}")))
}

/// Stringify a JavaScript value to TOML.
///
/// # Errors
/// Returns a `JsError` if serialization fails.
#[wasm_bindgen]
pub fn stringify_toml(value: JsValue) -> Result<String, JsError> {
    let v: serde_json::Value = serde_wasm_bindgen::from_value(value)
        .map_err(|e| JsError::new(&format!("Failed to convert JS value: {e}")))?;
    toml::to_string_pretty(&v)
        .map_err(|e| JsError::new(&format!("TOML stringify error: {e}")))
}

#[cfg(test)]
mod tests {
    use super::*;

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
}
