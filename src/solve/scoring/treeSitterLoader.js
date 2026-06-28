import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

import { Language, Parser } from "web-tree-sitter";

const require = createRequire(import.meta.url);
const TREE_SITTER_WASM_PATH = require.resolve("web-tree-sitter/web-tree-sitter.wasm");
const BASH_WASM_URL = new URL("../../../wasm/tree-sitter-bash.wasm", import.meta.url);

let parserPromise = null;

async function createBashParser() {
  await Parser.init({
    locateFile() {
      return TREE_SITTER_WASM_PATH;
    }
  });

  const parser = new Parser();
  const bash = await Language.load(fileURLToPath(BASH_WASM_URL));
  parser.setLanguage(bash);
  return parser;
}

export async function getBashParser() {
  parserPromise ??= createBashParser();
  return parserPromise;
}
