import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

import { Language, Parser } from "web-tree-sitter";

const require = createRequire(import.meta.url);
const TREE_SITTER_WASM_PATH = require.resolve("web-tree-sitter/web-tree-sitter.wasm");
const BASH_WASM_URL = new URL("../../wasm/tree-sitter-bash.wasm", import.meta.url);

let parserPromise: Promise<Parser> | null = null;

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

/** Structural parser boundary keeps upstream WASM ambient types out of declarations. */
export interface BashSyntaxNode {
  type: string;
  text: string;
  children: BashSyntaxNode[];
  namedChildren: BashSyntaxNode[];
  parent: BashSyntaxNode | null;
  childCount: number;
  isNamed: boolean;
  startIndex: number;
  endIndex: number;
  child(index: number): BashSyntaxNode | null;
  childForFieldName(name: string): BashSyntaxNode | null;
}

export interface BashParser {
  parse(command: string): { rootNode: BashSyntaxNode; delete(): void } | null;
}

export async function getBashParser(): Promise<BashParser> {
  parserPromise ??= createBashParser();
  return parserPromise;
}

export interface ShellCommandFeatures {
  parsed: boolean;
  parser: string;
  commandNames: string[];
  simpleCommandCount: number;
  pipelineCount: number;
  hasRedirection: boolean;
  hasCommandSubstitution: boolean;
  hasHereDoc: boolean;
  hasAndOrList: boolean;
  languageOneLiners: { command: string; option: string; inPipeline: boolean }[];
  dangerousCommands: string[];
  redirections: { operator: string; destination: string }[];
  recursiveBackgroundFunctions: string[];
}


const DANGEROUS_COMMANDS = new Set([
  "rm",
  "sudo",
  "su",
  "chmod",
  "chown",
  "dd",
  "mkfs",
  "mount",
  "umount",
  "curl",
  "wget",
  "nc",
  "ssh",
  "scp",
  "ftp"
]);

const LANGUAGE_ONE_LINER_FLAGS: Record<string, Set<string>> = {
  node: new Set(["-p", "-pe", "-e"]),
  perl: new Set(["-n", "-p", "-a", "-e", "-ne", "-pe", "-ane", "-lane", "-ple"]),
  python: new Set(["-c"]),
  python3: new Set(["-c"]),
  ruby: new Set(["-n", "-p", "-a", "-e", "-ne", "-pe", "-ane"])
};

function baseFeatures(): ShellCommandFeatures {
  return {
    parsed: true,
    parser: "tree-sitter-bash",
    commandNames: [],
    simpleCommandCount: 0,
    pipelineCount: 0,
    hasRedirection: false,
    hasCommandSubstitution: false,
    hasHereDoc: false,
    hasAndOrList: false,
    languageOneLiners: [],
    dangerousCommands: [],
    redirections: [],
    recursiveBackgroundFunctions: []
  };
}

function walk(node: BashSyntaxNode, visit: (node: BashSyntaxNode) => void): void {
  visit(node);
  for (const child of node.children ?? []) {
    walk(child, visit);
  }
}

function isCommandNode(node: BashSyntaxNode) {
  return node.type === "command" || node.type === "simple_command";
}

function commandWords(node: BashSyntaxNode) {
  return node.namedChildren
    .filter((child) => ["command_name", "word", "string", "raw_string"].includes(child.type))
    .map((child) => child.text)
    .filter(Boolean);
}

function commandNameFromNode(node: BashSyntaxNode) {
  const nameNode = node.childForFieldName?.("name");
  if (nameNode?.text) {
    return nameNode.text;
  }

  const directName = node.namedChildren.find((child) => child.type === "command_name");
  if (directName?.text) {
    return directName.text;
  }

  return commandWords(node)[0] ?? null;
}

function pipelineAncestor(node: BashSyntaxNode) {
  let current = node.parent;
  while (current) {
    if (current.type === "pipeline") {
      return current;
    }
    current = current.parent;
  }
  return null;
}

function oneLinerOption(commandName: string, words: string[]) {
  const flags = LANGUAGE_ONE_LINER_FLAGS[commandName];
  if (!flags) {
    return null;
  }

  return words.find((word) => flags.has(word)) ?? null;
}

function hasErrorNode(node: BashSyntaxNode) {
  let found = false;
  walk(node, (child) => {
    if (child.type === "ERROR") {
      found = true;
    }
  });
  return found;
}

function isHereDocNode(node: BashSyntaxNode) {
  return node.type === "heredoc_redirect" || node.type === "heredoc_body";
}

function redirectionFromNode(node: BashSyntaxNode) {
  if (node.type !== "file_redirect") {
    return null;
  }

  const destination = node.childForFieldName?.("destination") ?? node.namedChildren.at(-1);
  if (!destination?.text) {
    return null;
  }

  const operator = Array.from({ length: node.childCount }, (_, index) => node.child(index))
    .find((child) => child != null && !child.isNamed && [">", ">>", "<", "<>", ">|"].includes(child.text))
    ?.text;

  return {
    operator: operator ?? "",
    destination: destination.text
  };
}

function functionNameFromNode(node: BashSyntaxNode) {
  const nameNode = node.childForFieldName?.("name") ?? node.namedChildren.find((child) => child.type === "word");
  return nameNode?.text ?? null;
}

function functionBodyFromNode(node: BashSyntaxNode) {
  return node.childForFieldName?.("body") ?? node.namedChildren.find((child) => child.type === "compound_statement");
}

function commandNamesInNode(node: BashSyntaxNode) {
  const names: string[] = [];
  walk(node, (child) => {
    if (!isCommandNode(child)) {
      return;
    }

    const commandName = commandNameFromNode(child);
    if (commandName) {
      names.push(commandName);
    }
  });
  return names;
}

function hasBackgroundOperator(node: BashSyntaxNode) {
  let found = false;
  walk(node, (child) => {
    for (let index = 0; index < child.childCount; index += 1) {
      const descendant = child.child(index);
      if (descendant != null && !descendant.isNamed && descendant.text === "&") {
        found = true;
      }
    }
  });
  return found;
}

function recursiveBackgroundFunctionFromNode(node: BashSyntaxNode) {
  if (node.type !== "function_definition") {
    return null;
  }

  const functionName = functionNameFromNode(node);
  const body = functionBodyFromNode(node);
  if (!functionName || !body || !hasBackgroundOperator(body)) {
    return null;
  }

  return commandNamesInNode(body).includes(functionName) ? functionName : null;
}

export async function analyzeShellCommand(command: string, options: { parserProvider?: () => Promise<BashParser> } = {}): Promise<ShellCommandFeatures> {
  const parserProvider = options.parserProvider ?? getBashParser;

  try {
    const parser = await parserProvider();
    const tree = parser.parse(command);

    if (!tree?.rootNode || hasErrorNode(tree.rootNode)) {
      tree?.delete?.();
      throw new Error("Command could not be parsed as a Bash parse tree.");
    }

    const features = baseFeatures();
    const seenCommands = new Set();
    const seenRecursiveFunctions = new Set();

    walk(tree.rootNode, (node) => {
      if (node.type === "pipeline") {
        features.pipelineCount += 1;
      }

      if (["redirected_statement", "file_redirect", "heredoc_redirect"].includes(node.type)) {
        features.hasRedirection = true;
      }

      const redirection = redirectionFromNode(node);
      if (redirection) {
        features.redirections.push(redirection);
      }

      if (node.type === "command_substitution") {
        features.hasCommandSubstitution = true;
      }

      if (isHereDocNode(node)) {
        features.hasHereDoc = true;
      }

      if (node.type === "list" && /&&|\|\|/.test(node.text)) {
        features.hasAndOrList = true;
      }

      const recursiveFunction = recursiveBackgroundFunctionFromNode(node);
      if (recursiveFunction && !seenRecursiveFunctions.has(recursiveFunction)) {
        seenRecursiveFunctions.add(recursiveFunction);
        features.recursiveBackgroundFunctions.push(recursiveFunction);
      }

      if (!isCommandNode(node)) {
        return;
      }

      const commandName = commandNameFromNode(node);
      if (!commandName) {
        return;
      }

      const key = `${node.startIndex}:${node.endIndex}:${commandName}`;
      if (seenCommands.has(key)) {
        return;
      }
      seenCommands.add(key);

      const words = commandWords(node);
      features.commandNames.push(commandName);
      features.simpleCommandCount += 1;

      if (DANGEROUS_COMMANDS.has(commandName)) {
        features.dangerousCommands.push(commandName);
      }

      const option = oneLinerOption(commandName, words.slice(1));
      if (option) {
        features.languageOneLiners.push({
          command: commandName,
          option,
          inPipeline: Boolean(pipelineAncestor(node))
        });
      }
    });

    tree.delete();
    return features;
  } catch (error) {
    throw new Error("Unable to analyze shell command with tree-sitter-bash.", {
      cause: error
    });
  }
}
