import { getBashParser } from "./treeSitterLoader.js";

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
    dangerousCommands: [],
    redirections: [],
    recursiveBackgroundFunctions: []
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

  return words.find((word) => flags.has(word)) ?? null;
}

function hasErrorNode(node) {
  let found = false;
  walk(node, (child) => {
    if (child.type === "ERROR") {
      found = true;
    }
  });
  return found;
}

function isHereDocNode(node) {
  return node.type === "heredoc_redirect" || node.type === "heredoc_body";
}

function redirectionFromNode(node) {
  if (node.type !== "file_redirect") {
    return null;
  }

  const destination = node.childForFieldName?.("destination") ?? node.namedChildren.at(-1);
  if (!destination?.text) {
    return null;
  }

  const operator = Array.from({ length: node.childCount }, (_, index) => node.child(index))
    .find((child) => !child.isNamed && [">", ">>", "<", "<>", ">|"].includes(child.text))
    ?.text;

  return {
    operator: operator ?? "",
    destination: destination.text
  };
}

function functionNameFromNode(node) {
  const nameNode = node.childForFieldName?.("name") ?? node.namedChildren.find((child) => child.type === "word");
  return nameNode?.text ?? null;
}

function functionBodyFromNode(node) {
  return node.childForFieldName?.("body") ?? node.namedChildren.find((child) => child.type === "compound_statement");
}

function commandNamesInNode(node) {
  const names = [];
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

function hasBackgroundOperator(node) {
  let found = false;
  walk(node, (child) => {
    for (let index = 0; index < child.childCount; index += 1) {
      const descendant = child.child(index);
      if (!descendant.isNamed && descendant.text === "&") {
        found = true;
      }
    }
  });
  return found;
}

function recursiveBackgroundFunctionFromNode(node) {
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

export async function analyzeShellCommand(command, options = {}) {
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
