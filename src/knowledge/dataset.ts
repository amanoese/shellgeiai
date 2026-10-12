import type { KnowledgeRecord } from "../types.js";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

export const supportedKinds = new Set(["option", "pattern", "section", "note"]);

export const MAX_EMBEDDING_INPUT_BYTES = 128 * 1024;

function trimmedString(value: unknown) {
    return String(value ?? "").trim();
}

export function normalizeKnowledgeRecord(input: unknown): KnowledgeRecord {
    const record = input == null ? {} : Object(input) as Record<string, unknown>;
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
    if (Buffer.byteLength(text, "utf8") > MAX_EMBEDDING_INPUT_BYTES) {
        throw new Error(`Knowledge record ${id} text exceeds the 128 KiB embedding input limit.`);
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

function parseKnowledgeDataset(content: string): KnowledgeRecord[] {
    const records: KnowledgeRecord[] = [];
    const ids = new Set();
    for (const [index, line] of content.split(/\r?\n/).entries()) {
        if (!line.trim()) {
            continue;
        }
        try {
            const record = normalizeKnowledgeRecord(JSON.parse(line));
            if (ids.has(record.id))
                throw new Error(`Duplicate knowledge record id: ${record.id}.`);
            ids.add(record.id);
            records.push(record);
        }
        catch (error) {
            throw new Error(`Invalid knowledge dataset line ${index + 1}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    if (records.length === 0)
        throw new Error("Knowledge dataset is empty.");
    return records;
}

export async function loadKnowledgeDatasetWithFingerprint(datasetPath: string) {
    const bytes = await readFile(datasetPath);
    return {
        records: parseKnowledgeDataset(bytes.toString("utf8")),
        fingerprint: createHash("sha256").update(bytes).digest("hex")
    };
}

export async function loadKnowledgeDataset(datasetPath: string) {
    return (await loadKnowledgeDatasetWithFingerprint(datasetPath)).records;
}
