/* @ts-self-types="./proteus_wasm.d.ts" */

import * as wasm from "./proteus_wasm_bg.wasm";
import { __wbg_set_wasm } from "./proteus_wasm_bg.js";
__wbg_set_wasm(wasm);
wasm.__wbindgen_start();
export {
    extract_markdown_ast, parse_json, parse_toml, parse_yaml, stringify_json, stringify_toml, stringify_yaml
} from "./proteus_wasm_bg.js";
