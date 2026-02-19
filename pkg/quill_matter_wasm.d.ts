/* tslint:disable */
/* eslint-disable */

/**
 * Parse a JSON string into a JavaScript value.
 *
 * # Errors
 * Returns a `JsError` if the input is not valid JSON or exceeds the size limit.
 * Error message includes line and column information.
 */
export function parse_json(input: string): any;

/**
 * Parse a TOML string into a JavaScript value.
 *
 * # Errors
 * Returns a `JsError` if the input is not valid TOML or exceeds the size limit.
 * Error message includes span information when available.
 */
export function parse_toml(input: string): any;

/**
 * Parse a YAML string into a JavaScript value.
 *
 * Uses `serde-saphyr` (pure Rust, YAML 1.2, no unsafe).
 *
 * NOTE: YAML is first deserialized into `serde_json::Value` as an
 * intermediate representation, then converted to `JsValue` via
 * `serde-wasm-bindgen`.  This means YAML-specific types (e.g. `!!timestamp`,
 * `!!null` tag variants) are normalised to their JSON equivalents (strings,
 * null).  This is intentional for the front matter use-case where JSON-safe
 * types are expected.
 *
 * # Errors
 * Returns a `JsError` if the input is not valid YAML or exceeds the size limit.
 * Error message includes line and column information when available.
 */
export function parse_yaml(input: string): any;

/**
 * Stringify a JavaScript value to JSON (pretty-printed).
 *
 * # Errors
 * Returns a `JsError` if serialization fails.
 */
export function stringify_json(value: any): string;

/**
 * Stringify a JavaScript value to TOML.
 *
 * # Errors
 * Returns a `JsError` if serialization fails.
 */
export function stringify_toml(value: any): string;

/**
 * Stringify a JavaScript value to YAML.
 *
 * # Errors
 * Returns a `JsError` if serialization fails.
 */
export function stringify_yaml(value: any): string;
