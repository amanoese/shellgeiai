import {
  buildKnowledgeVectors,
  prepareKnowledgeModel,
  searchKnowledge
} from "../../knowledge/commands.js";
import {
  buildManKnowledge,
  parseArgs as parseManKnowledgeArgs
} from "../../../scripts/build-man-knowledge.js";

function resolveModel(options) {
  return options.model ?? options.knowledgeModel;
}

export async function runKnowledgePrepareCommand(options) {
  const result = await prepareKnowledgeModel({ model: resolveModel(options) });
  process.stdout.write(
    `Knowledge API/native check passed: ${result.model} dimensions=${result.dimensions} provider=${result.provider}\n`
  );
}

export async function runKnowledgeBuildCommand(options) {
  const model = resolveModel(options);
  const result = await buildKnowledgeVectors({
    datasetPath: options.dataset,
    model,
    dbPath: options.db,
    batchSize: options.batchSize,
    force: options.force
  });
  process.stdout.write(
    `Knowledge database ${result.reused ? "reused" : "built"}: ${result.itemCount} items -> ${result.dbPath}\n` +
    `model: ${result.model}\ndimensions: ${result.dimensions}\ngeneration: ${result.generationId}\n`
  );
}

function toManKnowledgeArgs(options) {
  const optionNames = ["output", "profile", "sections", "commands", "limit", "locale"];
  const args = [];

  for (const optionName of optionNames) {
    if (options[optionName] == null) continue;
    args.push(`--${optionName}`, String(options[optionName]));
  }
  if (options.man != null) args.push("--man", String(options.man));
  return args;
}

export async function runKnowledgeManCommand(
  options,
  {
    buildManKnowledge: build = buildManKnowledge,
    parseManKnowledgeArgs: parse = parseManKnowledgeArgs
  } = {}
) {
  const result = await build(parse(toManKnowledgeArgs(options)));
  process.stdout.write(`Man knowledge built: ${result.records} records -> ${result.output}\n`);
}

function formatKnowledgeSearchResult(record, index) {
  const lines = [
    `${index + 1}. ${record.id} score=${record.score.toFixed(4)}`,
    `  kind: ${record.kind}`
  ];
  if (record.command) lines.push(`  command: ${record.command}`);
  if (record.option) lines.push(`  option: ${record.option}`);
  lines.push(`  text: ${record.text}`);
  if (record.source) lines.push(`  source: ${record.source}`);
  return lines.join("\n");
}

export async function runKnowledgeSearchCommand(options) {
  const model = resolveModel(options);
  const result = await searchKnowledge({
    query: options.query,
    datasetPath: options.dataset,
    model,
    topK: options.topK,
    dbPath: options.db
  });

  const lines = [
    `Knowledge search: ${result.query}`,
    `model: ${result.model}`,
    `database: ${result.dbPath}`,
    ...result.results.map(formatKnowledgeSearchResult)
  ];
  process.stdout.write(`${lines.join("\n")}\n`);
}
