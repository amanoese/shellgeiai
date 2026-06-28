import {
  DEFAULT_KNOWLEDGE_DATASET,
  DEFAULT_KNOWLEDGE_MODEL,
  DEFAULT_KNOWLEDGE_VECTORS
} from "../../knowledge/commands.js";
import { isFlag, takeValue } from "./shared.js";

function parseKnowledgeFlags(argv, startIndex, defaults) {
  const options = { ...defaults };
  for (let index = startIndex; index < argv.length; index += 1) {
    const token = argv[index];
    if (!isFlag(token)) {
      throw new Error(`Unexpected knowledge argument: ${token}`);
    }
    switch (token) {
      case "--model":
        options.model = takeValue(argv, index, "Missing value --model.");
        index += 1;
        break;
      case "--dataset":
        options.datasetPath = takeValue(argv, index, "Missing value --dataset.");
        index += 1;
        break;
      case "--vectors":
        options.vectorsPath = takeValue(argv, index, "Missing value --vectors.");
        index += 1;
        break;
      default:
        throw new Error(`Unknown knowledge option: ${token}`);
    }
  }
  return options;
}

export function parseKnowledge(argv) {
  const subcommand = argv[1];
  if (subcommand === "prepare") {
    return parseKnowledgeFlags(argv, 2, {
      command: "knowledge-prepare",
      model: DEFAULT_KNOWLEDGE_MODEL
    });
  }
  if (subcommand === "build") {
    return parseKnowledgeFlags(argv, 2, {
      command: "knowledge-build",
      datasetPath: DEFAULT_KNOWLEDGE_DATASET,
      model: DEFAULT_KNOWLEDGE_MODEL,
      vectorsPath: DEFAULT_KNOWLEDGE_VECTORS
    });
  }
  throw new Error(`Unsupported knowledge subcommand: ${subcommand ?? "(missing)"}`);
}
