import {
  buildKnowledgeVectors,
  prepareKnowledgeModel,
  searchKnowledge
} from "../../knowledge/commands.js";
import { defaultKnowledgeVectorsPath } from "../../knowledge/vectorFile.js";

function resolveModel(options) {
  return options.model ?? options.knowledgeModel;
}

function resolveVectorsPath(options, model) {
  return options.vectors ?? defaultKnowledgeVectorsPath(options.dataset, model);
}

export async function runKnowledgePrepareCommand(options) {
  const result = await prepareKnowledgeModel({ model: resolveModel(options) });
  process.stdout.write(`Knowledge model prepared: ${result.model}\n`);
}

export async function runKnowledgeBuildCommand(options) {
  const model = resolveModel(options);
  const result = await buildKnowledgeVectors({
    datasetPath: options.dataset,
    model,
    vectorsPath: resolveVectorsPath(options, model)
  });
  process.stdout.write(
    `Knowledge vectors built: ${result.itemCount} items -> ${result.vectorsPath}\n`
  );
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
    vectorsPath: resolveVectorsPath(options, model)
  });

  const lines = [
    `Knowledge search: ${result.query}`,
    `model: ${result.model}`,
    ...result.results.map(formatKnowledgeSearchResult)
  ];
  process.stdout.write(`${lines.join("\n")}\n`);
}
