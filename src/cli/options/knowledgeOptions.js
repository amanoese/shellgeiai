import { DEFAULT_KNOWLEDGE_DATASET } from "../../knowledge/commands.js";
import { resolveKnowledgeModel } from "../../knowledge/modelConfig.js";
import { defaultKnowledgeVectorsPath } from "../../knowledge/vectorFile.js";
import { isFlag, parseNumber, takeValue } from "./shared.js";

function parseKnowledgeFlags(argv, startIndex, defaults) {
  const options = { ...defaults };
  let vectorsPathExplicit = Boolean(options.vectorsPath);
  for (let index = startIndex; index < argv.length; index += 1) {
    const token = argv[index];
    if (!isFlag(token)) {
      throw new Error(`Unexpected knowledge argument: ${token}`);
    }
    switch (token) {
      case "--knowledge-model":
      case "--model":
        options.model = takeValue(argv, index, `Missing value ${token}.`);
        index += 1;
        break;
      case "--dataset":
        options.datasetPath = takeValue(argv, index, "Missing value --dataset.");
        index += 1;
        break;
      case "--vectors":
        options.vectorsPath = takeValue(argv, index, "Missing value --vectors.");
        vectorsPathExplicit = true;
        index += 1;
        break;
      default:
        throw new Error(`Unknown knowledge option: ${token}`);
    }
  }
  if (!vectorsPathExplicit && options.datasetPath && options.model) {
    options.vectorsPath = defaultKnowledgeVectorsPath(
      options.datasetPath,
      options.model
    );
  }
  return options;
}

function parseKnowledgeSearch(argv) {
  const options = {
    command: "knowledge-search",
    datasetPath: DEFAULT_KNOWLEDGE_DATASET,
    model: resolveKnowledgeModel(),
    topK: 10
  };
  const positionals = [];
  let vectorsPathExplicit = false;

  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    if (!isFlag(token)) {
      positionals.push(token);
      continue;
    }

    switch (token) {
      case "--knowledge-model":
      case "--model":
        options.model = takeValue(argv, index, `Missing value ${token}.`);
        index += 1;
        break;
      case "--dataset":
        options.datasetPath = takeValue(argv, index, "Missing value --dataset.");
        index += 1;
        break;
      case "--vectors":
        options.vectorsPath = takeValue(argv, index, "Missing value --vectors.");
        vectorsPathExplicit = true;
        index += 1;
        break;
      case "--top-k":
        options.topK = parseNumber(
          takeValue(argv, index, "Missing value --top-k."),
          "Invalid --top-k value. Use positive integer."
        );
        index += 1;
        break;
      default:
        throw new Error(`Unknown knowledge option: ${token}`);
    }
  }

  if (positionals.length === 0) {
    throw new Error("Missing <query> argument.");
  }

  if (!vectorsPathExplicit) {
    options.vectorsPath = defaultKnowledgeVectorsPath(
      options.datasetPath,
      options.model
    );
  }

  return { ...options, query: positionals.join(" ") };
}

export function parseKnowledge(argv) {
  const subcommand = argv[1];
  if (subcommand === "prepare") {
    return parseKnowledgeFlags(argv, 2, {
      command: "knowledge-prepare",
      model: resolveKnowledgeModel()
    });
  }
  if (subcommand === "build") {
    return parseKnowledgeFlags(argv, 2, {
      command: "knowledge-build",
      datasetPath: DEFAULT_KNOWLEDGE_DATASET,
      model: resolveKnowledgeModel()
    });
  }
  if (subcommand === "search") {
    return parseKnowledgeSearch(argv);
  }
  throw new Error(`Unsupported knowledge subcommand: ${subcommand ?? "(missing)"}`);
}
