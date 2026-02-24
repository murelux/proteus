/* @ts-self-types="./matter_wasm.d.ts" */

import * as wasm from "./matter_wasm_bg.wasm";
import { __wbg_set_wasm } from "./matter_wasm_bg.js";
__wbg_set_wasm(wasm);
wasm.__wbindgen_start();
export {
    parse_json, parse_toml, parse_yaml, stringify_json, stringify_toml, stringify_yaml
} from "./matter_wasm_bg.js";
