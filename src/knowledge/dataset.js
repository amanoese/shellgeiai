import { readFile } from "node:fs/promises";

export const supportedKinds = new Set(["option", "pattern", "note"]);

function trimmedString(value) {
  return String(value ?? "").trim();
}

export function normalizeKnowledgeRecord(record) {
  const id = trimmedString(record?.id);
  const kind = trimmedString(record?.kind);
  const command = trimmedString(record?.command);
  const option = trimmedString(record?.option);
  const text = trimmedString(record?.text);
  const source = trimmedString(record?.source);

  if (!id) {
    throw new Error("Knowledge record id is required.");
  }

  if (!supportedKinds.has(kind)) {
    throw new Error(`Knowledge record ${id} has invalid kind.`);
  }

  if (!text) {
    throw new Error(`Knowledge record ${id} text is required.`);
  }

  return {
    id,
    kind,
    command,
    option,
    text,
    source
  };
}

export async function loadKnowledgeDataset(datasetPath) {
  const content = await readFile(datasetPath, "utf8");
  const records = [];

  for (const [index, line] of content.split(/\r?\n/).entries()) {
    if (!line.trim()) {
      continue;
    }

    try {
      records.push(normalizeKnowledgeRecord(JSON.parse(line)));
    } catch (error) {
      throw new Error(`Invalid knowledge dataset line ${index + 1}: ${error.message}`);
    }
  }

  return records;
}
