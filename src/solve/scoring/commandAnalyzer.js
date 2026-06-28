import { getBashParser } from "./treeSitterLoader.js";

const DANGEROUS_COMMANDS = new Set(["rm", "sudo", "chmod", "chown", "curl", "wget"]);
const LANGUAGE_ONE_LINER_FLAGS = {
  node: new Set(["-p", "-pe", "-e"]),
  perl: new Set(["-n", "-p", "-a", "-e", "-ne", "-pe", "-ane", "-lane", "-ple"]),
  python: new Set(["-c"]),
  python3: new Set(["-c"]),
  ruby: new Set(["-n", "-p", "-a", "-e", "-ne", "-pe", "-ane"])
};

function baseFeatures() {
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
    dangerousCommands: []
  };
}

function walk(node, visit) {
  visit(node);
  for (const child of node.children ?? []) {
    walk(child, visit);
  }
}

function isCommandNode(node) {
  return node.type === "command" || node.type === "simple_command";
}

function commandWords(node) {
  return node.namedChildren
    .filter((child) => ["command_name", "word", "string", "raw_string"].includes(child.type))
    .map((child) => child.text)
    .filter(Boolean);
}

function commandNameFromNode(node) {
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

function pipelineAncestor(node) {
  let current = node.parent;
  while (current) {
    if (current.type === "pipeline") {
      return current;
    }
    current = current.parent;
  }
  return null;
}

function oneLinerOption(commandName, words) {
  const flags = LANGUAGE_ONE_LINER_FLAGS[commandName];
  if (!flags) {
    return null;
  }
  return words.find((word) => flags.has(word) || [...flags].some((flag) => word.includes(flag))) ?? null;
}

function isHereDocNode(node) {
  return node.type.includes("heredoc") || node.type.includes("here_document");
}

export async function analyzeShellCommand(command, options = {}) {
  try {
    const parser = await (options.parserProvider ?? getBashParser)();
    const tree = parser.parse(command);
    if (!tree) {
      throw new Error("tree-sitter-bash returned no parse tree.");
    }

    const features = baseFeatures();
    const seenCommands = new Set();

    walk(tree.rootNode, (node) => {
      if (node.type === "pipeline") {
        features.pipelineCount += 1;
      }
      if (["redirected_statement", "file_redirect", "heredoc_redirect"].includes(node.type)) {
        features.hasRedirection = true;
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
