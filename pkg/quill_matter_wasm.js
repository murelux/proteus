/* @ts-self-types="./quill_matter_wasm.d.ts" */

import * as wasm from "./quill_matter_wasm_bg.wasm";
import { __wbg_set_wasm } from "./quill_matter_wasm_bg.js";
__wbg_set_wasm(wasm);
wasm.__wbindgen_start();
export {
    parse_json, parse_toml, parse_yaml, stringify_json, stringify_toml, stringify_yaml
} from "./quill_matter_wasm_bg.js";
