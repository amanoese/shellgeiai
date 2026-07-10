#!/usr/bin/env node
import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { normalizeKnowledgeRecord } from "../src/knowledge/dataset.js";
import {
  extractKnowledgeRecordsFromManPage,
  parseManIndex
} from "../src/knowledge/manKnowledge.js";
import {
  loadManKnowledgeProfile,
  SUPPORTED_MAN_PROFILES
} from "../src/knowledge/manProfile.js";

const execFileAsync = promisify(execFile);

const DEFAULT_OUTPUT = "data/knowledge/man.jsonl";

export function printHelp() {
  console.log(`Usage: node scripts/build-man-knowledge.js [options]

Build data/knowledge/man.jsonl from locally installed rendered man pages.
The script extracts text by deterministic rules only; it does not call an LLM.

Options:
  --output <path>       JSONL output path (default: ${DEFAULT_OUTPUT})
  --profile <name>     Extraction profile: shellgei or all (default: shellgei)
  --sections <list>     Comma-separated man sections, or "all" (profile default)
  --commands <list>     Comma-separated command names. Default collects man -k entries.
  --limit <number>      Stop after this many man entries, useful for smoke tests.
  --locale <locale>     Locale for man rendering (default: ja_JP.UTF-8)
  --man <path>          man executable path/name (default: man)
  --help                Show this help
`);
}

function readOption(argv, index, name) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value.`);
  }
  return value;
}

function parseList(value) {
  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function parseArgs(argv) {
  const options = {
    commands: null,
    help: false,
    limit: null,
    locale: "ja_JP.UTF-8",
    manCommand: "man",
    output: DEFAULT_OUTPUT,
    profile: "shellgei",
    sections: null
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--output") {
      options.output = readOption(argv, index, arg);
      index += 1;
    } else if (arg === "--profile") {
      options.profile = readOption(argv, index, arg);
      if (!SUPPORTED_MAN_PROFILES.has(options.profile)) {
        throw new Error("--profile must be shellgei or all.");
      }
      index += 1;
    } else if (arg === "--sections") {
      const value = readOption(argv, index, arg);
      options.sections = value === "all" ? "all" : parseList(value);
      index += 1;
    } else if (arg === "--commands") {
      options.commands = parseList(readOption(argv, index, arg));
      index += 1;
    } else if (arg === "--limit") {
      options.limit = Number.parseInt(readOption(argv, index, arg), 10);
      if (!Number.isInteger(options.limit) || options.limit < 1) {
        throw new Error("--limit must be a positive integer.");
      }
      index += 1;
    } else if (arg === "--locale") {
      options.locale = readOption(argv, index, arg);
      index += 1;
    } else if (arg === "--man") {
      options.manCommand = readOption(argv, index, arg);
      index += 1;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

export function selectManEntries({ options, profile, indexText = "" }) {
  const sections = options.sections ?? profile.sections;
  const commands = options.commands ?? profile.commands;

  if (sections === "all") {
    const entries = parseManIndex(indexText, { sections: "all" });
    if (commands === null) return entries;

    const selectedCommands = new Set(commands);
    return entries.filter(({ name }) => selectedCommands.has(name));
  }

  if (commands !== null) {
    return commands.flatMap((name) =>
      sections.map((section) => ({ name, section }))
    );
  }

  return parseManIndex(indexText, { sections });
}

async function runMan(manCommand, args, locale) {
  const env = {
    ...process.env,
    LANG: locale,
    LC_ALL: locale,
    MANWIDTH: process.env.MANWIDTH ?? "100"
  };
  return execFileAsync(manCommand, args, {
    env,
    maxBuffer: 128 * 1024 * 1024
  });
}

async function listManEntries(options, profile) {
  let indexText = "";
  if (profile.commands === null || options.sections === "all") {
    const { stdout } = await runMan(options.manCommand, ["-k", "."], options.locale);
    indexText = stdout;
  }

  return selectManEntries({ options, profile, indexText });
}

async function readManPage(options, entry) {
  const { stdout } = await runMan(options.manCommand, [entry.section, entry.name], options.locale);
  return stdout;
}

function dedupeRecords(records) {
  const seen = new Set();
  const unique = [];
  for (const record of records) {
    if (seen.has(record.id)) continue;
    seen.add(record.id);
    unique.push(normalizeKnowledgeRecord(record));
  }
  return unique;
}

export async function buildManKnowledge(options) {
  const profile = await loadManKnowledgeProfile(options.profile);
  const entries = await listManEntries(options, profile);
  const limitedEntries = options.limit ? entries.slice(0, options.limit) : entries;
  const records = [];
  let failed = 0;

  for (const entry of limitedEntries) {
    try {
      const text = await readManPage(options, entry);
      records.push(
        ...extractKnowledgeRecordsFromManPage({
          command: entry.name,
          section: entry.section,
          text,
          profile: profile.name,
          includePatterns:
            profile.patternCommands === null || profile.patternCommands.includes(entry.name)
        })
      );
    } catch (error) {
      failed += 1;
      console.warn(`skip man ${entry.section} ${entry.name}: ${error.message}`);
    }
  }

  const uniqueRecords = dedupeRecords(records);
  const output = uniqueRecords.map((record) => JSON.stringify(record)).join("\n");
  await mkdir(path.dirname(options.output), { recursive: true });
  await writeFile(options.output, output ? `${output}\n` : "", "utf8");

  return {
    entries: limitedEntries.length,
    failed,
    output: options.output,
    profile: profile.name,
    records: uniqueRecords.length
  };
}

async function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      printHelp();
      return;
    }

    const result = await buildManKnowledge(options);
    console.log(
      `wrote ${result.records} records from ${result.entries} man entries to ${result.output} using ${result.profile} profile` +
        (result.failed ? ` (${result.failed} skipped)` : "")
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
