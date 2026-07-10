import { describe, expect, it } from "vitest";

import {
  extractKnowledgeRecordsFromManPage,
  parseManIndex,
  stripManControlCharacters
} from "../src/knowledge/manKnowledge.js";

describe("man knowledge extraction", () => {
  it("parses man index entries for command sections", () => {
    const entries = parseManIndex(
      [
        "awk (1)              - pattern scanning and processing language",
        "sed (1)              - stream editor for filtering and transforming text",
        "passwd (5)           - the password file",
        "useradd (8)          - create a new user"
      ].join("\n"),
      { sections: ["1", "8"] }
    );

    expect(entries).toEqual([
      { name: "awk", section: "1" },
      { name: "sed", section: "1" },
      { name: "useradd", section: "8" }
    ]);
  });

  it("strips man backspace overstrike formatting", () => {
    expect(stripManControlCharacters("N\bNA\bAM\bME\bE")).toBe("NAME");
    expect(stripManControlCharacters("_\ba_\bb")).toBe("ab");
  });

  it("extracts option, section, and pattern records from rendered man text without LLM generation", () => {
    const records = extractKnowledgeRecordsFromManPage({
      command: "sed",
      section: "1",
      text: [
        "NAME",
        "       sed - stream editor",
        "",
        "OPTIONS",
        "       -n, --quiet, --silent",
        "              suppress automatic printing of pattern space",
        "",
        "ADDRESSES",
        "       first~step",
        "              Match every step'th line starting with line first.",
        "",
        "       addr1,addr2",
        "              Start out in matched state until addr2 is found.",
        "",
        "COMMANDS",
        "       s/regexp/replacement/[flags]",
        "              Attempt to match regexp against the pattern space.",
        "",
        "AUTHOR",
        "       Written by example."
      ].join("\n")
    });

    expect(records).toEqual([
      {
        id: "man:sed:1:section:options",
        kind: "section",
        command: "sed",
        option: "",
        text: "OPTIONS: -n, --quiet, --silent suppress automatic printing of pattern space",
        source: "man sed(1) / OPTIONS"
      },
      {
        id: "man:sed:1:option:-n",
        kind: "option",
        command: "sed",
        option: "-n",
        text: "-n, --quiet, --silent suppress automatic printing of pattern space",
        source: "man sed(1) / OPTIONS"
      },
      {
        id: "man:sed:1:option:--quiet",
        kind: "option",
        command: "sed",
        option: "--quiet",
        text: "-n, --quiet, --silent suppress automatic printing of pattern space",
        source: "man sed(1) / OPTIONS"
      },
      {
        id: "man:sed:1:option:--silent",
        kind: "option",
        command: "sed",
        option: "--silent",
        text: "-n, --quiet, --silent suppress automatic printing of pattern space",
        source: "man sed(1) / OPTIONS"
      },
      {
        id: "man:sed:1:section:addresses",
        kind: "section",
        command: "sed",
        option: "",
        text: "ADDRESSES: first~step Match every step'th line starting with line first. addr1,addr2 Start out in matched state until addr2 is found.",
        source: "man sed(1) / ADDRESSES"
      },
      {
        id: "man:sed:1:pattern:first-step",
        kind: "pattern",
        command: "sed",
        option: "first~step",
        text: "first~step Match every step'th line starting with line first.",
        source: "man sed(1) / ADDRESSES"
      },
      {
        id: "man:sed:1:pattern:addr1-addr2",
        kind: "pattern",
        command: "sed",
        option: "addr1,addr2",
        text: "addr1,addr2 Start out in matched state until addr2 is found.",
        source: "man sed(1) / ADDRESSES"
      },
      {
        id: "man:sed:1:section:commands",
        kind: "section",
        command: "sed",
        option: "",
        text: "COMMANDS: s/regexp/replacement/[flags] Attempt to match regexp against the pattern space.",
        source: "man sed(1) / COMMANDS"
      },
      {
        id: "man:sed:1:pattern:s-regexp-replacement-flags",
        kind: "pattern",
        command: "sed",
        option: "s/regexp/replacement/[flags]",
        text: "s/regexp/replacement/[flags] Attempt to match regexp against the pattern space.",
        source: "man sed(1) / COMMANDS"
      }
    ]);
  });

  it("extracts compact ShellGei records from rendered man text", () => {
    const text = [
      "NAME",
      "       sed - stream editor",
      "",
      "OPTIONS",
      "       -n, --quiet, --silent",
      "              suppress automatic printing of pattern space",
      "",
      "       -h, --help",
      "              display this help and exit",
      "",
      "COMMANDS",
      "       s/regexp/replacement/[flags]",
      "              Attempt to match regexp against the pattern space."
    ].join("\n");

    const records = extractKnowledgeRecordsFromManPage({
      command: "sed",
      section: "1",
      text,
      profile: "shellgei",
      includePatterns: true
    });

    expect(records).toEqual([
      {
        id: "man:sed:1:note:summary",
        kind: "note",
        command: "sed",
        option: "",
        text: "sed - stream editor",
        source: "man sed(1) / NAME"
      },
      {
        id: "man:sed:1:option:-n",
        kind: "option",
        command: "sed",
        option: "-n, --quiet, --silent",
        text: "-n, --quiet, --silent suppress automatic printing of pattern space",
        source: "man sed(1) / OPTIONS"
      },
      {
        id: "man:sed:1:pattern:s-regexp-replacement-flags",
        kind: "pattern",
        command: "sed",
        option: "s/regexp/replacement/[flags]",
        text: "s/regexp/replacement/[flags] Attempt to match regexp against the pattern space.",
        source: "man sed(1) / COMMANDS"
      }
    ]);

    expect(
      extractKnowledgeRecordsFromManPage({
        command: "sed",
        section: "1",
        text,
        profile: "shellgei",
        includePatterns: false
      }).map((record) => record.kind)
    ).toEqual(["note", "option"]);
  });

  it("omits pattern records from the all profile when patterns are disabled", () => {
    const records = extractKnowledgeRecordsFromManPage({
      command: "sed",
      section: "1",
      text: [
        "COMMANDS",
        "       s/regexp/replacement/[flags]",
        "              Attempt to match regexp against the pattern space."
      ].join("\n"),
      profile: "all",
      includePatterns: false
    });

    expect(records.map((record) => record.kind)).not.toContain("pattern");
  });

  it("preserves a question mark in the first grouped option alias ID", () => {
    const records = extractKnowledgeRecordsFromManPage({
      command: "query",
      section: "1",
      text: [
        "OPTIONS",
        "       -?, --query",
        "              display query information"
      ].join("\n"),
      profile: "shellgei"
    });

    expect(records).toEqual([
      {
        id: "man:query:1:option:-?",
        kind: "option",
        command: "query",
        option: "-?, --query",
        text: "-?, --query display query information",
        source: "man query(1) / OPTIONS"
      }
    ]);
  });

  it("preserves case in option IDs so distinct short options are retained", () => {
    const records = extractKnowledgeRecordsFromManPage({
      command: "case-tool",
      section: "1",
      text: [
        "OPTIONS",
        "       -e",
        "              use the lowercase mode",
        "       -E",
        "              use the uppercase mode",
        "       -m",
        "              select lowercase matching",
        "       -M",
        "              select uppercase matching",
        "       -F",
        "              use fixed strings"
      ].join("\n"),
      profile: "shellgei"
    });

    expect(records.map(({ id, option }) => ({ id, option }))).toEqual([
      { id: "man:case-tool:1:option:-e", option: "-e" },
      { id: "man:case-tool:1:option:-E", option: "-E" },
      { id: "man:case-tool:1:option:-m", option: "-m" },
      { id: "man:case-tool:1:option:-M", option: "-M" },
      { id: "man:case-tool:1:option:-F", option: "-F" }
    ]);
  });

  it("extracts patterns from realistic sed, awk, and find headings", () => {
    const sedRecords = extractKnowledgeRecordsFromManPage({
      command: "sed",
      section: "1",
      text: [
        "Addresses",
        "       first~step",
        "              Match every step'th line starting with line first.",
        "COMMAND SYNOPSIS",
        "       s/regexp/replacement/[flags]",
        "              Replace text matching regexp."
      ].join("\n"),
      profile: "shellgei"
    });
    const awkRecords = extractKnowledgeRecordsFromManPage({
      command: "awk",
      section: "1",
      text: [
        "PATTERNS AND ACTIONS",
        "       /regular expression/",
        "              Select records that match the expression."
      ].join("\n"),
      profile: "shellgei"
    });
    const findRecords = extractKnowledgeRecordsFromManPage({
      command: "find",
      section: "1",
      text: [
        "EXPRESSION",
        "       -name pattern",
        "              Match the base of the file name."
      ].join("\n"),
      profile: "shellgei"
    });

    expect(sedRecords.map(({ id, option, source }) => ({ id, option, source }))).toEqual([
      {
        id: "man:sed:1:pattern:first-step",
        option: "first~step",
        source: "man sed(1) / Addresses"
      },
      {
        id: "man:sed:1:pattern:s-regexp-replacement-flags",
        option: "s/regexp/replacement/[flags]",
        source: "man sed(1) / COMMAND SYNOPSIS"
      }
    ]);
    expect(awkRecords.map(({ id, option }) => ({ id, option }))).toEqual([
      {
        id: "man:awk:1:pattern:regular-expression",
        option: "/regular expression/"
      }
    ]);
    expect(findRecords.map(({ id, option }) => ({ id, option }))).toEqual([
      { id: "man:find:1:pattern:name-pattern", option: "-name pattern" }
    ]);
  });

  it("uses Japanese section headings as boundaries without extracting example options", () => {
    const records = extractKnowledgeRecordsFromManPage({
      command: "jp-tool",
      section: "1",
      text: [
        "オプション",
        "       -a",
        "              実際のオプションです。",
        "終了ステータス",
        "       0 なら成功です。",
        "環境変数",
        "       LANG を参照します。",
        "ファイル",
        "       /tmp/example",
        "例",
        "       -1",
        "              負数を指定する例です。",
        "       -b",
        "              オプションに似た引数です。"
      ].join("\n"),
      profile: "shellgei"
    });

    expect(records).toEqual([
      {
        id: "man:jp-tool:1:option:-a",
        kind: "option",
        command: "jp-tool",
        option: "-a",
        text: "-a 実際のオプションです。",
        source: "man jp-tool(1) / オプション"
      }
    ]);
  });

  it("recognizes punctuation short options as definition boundaries", () => {
    const records = extractKnowledgeRecordsFromManPage({
      command: "zip",
      section: "1",
      text: [
        "OPTIONS",
        "       -a",
        "              add files to the archive",
        "       -@",
        "              read file names from standard input",
        "       -$",
        "              include the volume label"
      ].join("\n"),
      profile: "shellgei"
    });

    expect(records.map(({ id, option }) => ({ id, option }))).toEqual([
      { id: "man:zip:1:option:-a", option: "-a" },
      { id: "man:zip:1:option:-@", option: "-@" },
      { id: "man:zip:1:option:-$", option: "-$" }
    ]);
  });

  it("extracts each option boundary from the rendered zip option layout", () => {
    const records = extractKnowledgeRecordsFromManPage({
      command: "zip",
      section: "1",
      text: [
        "OPTIONS",
        "       -@",
        "       --names-stdin",
        "              Take the list of input files from standard input. Only one filename per line.",
        "       -$",
        "       --volume-label",
        "              Include the volume label for the drive holding the first file."
      ].join("\n"),
      profile: "shellgei"
    });

    expect(records.map(({ id, option, text }) => ({ id, option, text }))).toEqual([
      { id: "man:zip:1:option:-@", option: "-@", text: "-@" },
      {
        id: "man:zip:1:option:--names-stdin",
        option: "--names-stdin",
        text: "--names-stdin Take the list of input files from standard input. Only one filename per line."
      },
      { id: "man:zip:1:option:-$", option: "-$", text: "-$" },
      {
        id: "man:zip:1:option:--volume-label",
        option: "--volume-label",
        text: "--volume-label Include the volume label for the drive holding the first file."
      }
    ]);
  });

  it("keeps legacy all-profile option scanning separate from compact extraction", () => {
    const text = [
      "COMMANDS",
      "       -x, --execute",
      "              execute a command",
      "OPTIONS",
      "       -q quiet operation"
    ].join("\n");

    const allRecords = extractKnowledgeRecordsFromManPage({
      command: "legacy",
      section: "1",
      text,
      profile: "all",
      includePatterns: false
    });
    const compactRecords = extractKnowledgeRecordsFromManPage({
      command: "legacy",
      section: "1",
      text,
      profile: "shellgei",
      includePatterns: false
    });

    expect(
      allRecords
        .filter((record) => record.kind === "option")
        .map(({ id, option, text }) => ({ id, option, text }))
    ).toEqual([
      {
        id: "man:legacy:1:option:-x",
        option: "-x",
        text: "-x, --execute execute a command"
      },
      {
        id: "man:legacy:1:option:--execute",
        option: "--execute",
        text: "-x, --execute execute a command"
      },
      { id: "man:legacy:1:option:-q", option: "-q", text: "-q quiet operation" }
    ]);
    expect(compactRecords.map(({ id, option }) => ({ id, option }))).toEqual([
      { id: "man:legacy:1:option:-q", option: "-q" }
    ]);
  });

  it("deduplicates grouped aliases while preserving declaration order", () => {
    const records = extractKnowledgeRecordsFromManPage({
      command: "checker",
      section: "1",
      text: [
        "OPTIONS",
        "       --check, --check=diagnose-first, -c",
        "              check the input before processing"
      ].join("\n"),
      profile: "shellgei"
    });

    expect(records).toEqual([
      {
        id: "man:checker:1:option:--check",
        kind: "option",
        command: "checker",
        option: "--check, -c",
        text: "--check, --check=diagnose-first, -c check the input before processing",
        source: "man checker(1) / OPTIONS"
      }
    ]);
  });

  it("keeps legacy pattern IDs and disambiguates only collisions", () => {
    const records = extractKnowledgeRecordsFromManPage({
      command: "matcher",
      section: "1",
      text: [
        "PATTERNS",
        "       a/b",
        "              slash form",
        "       a-b",
        "              dash form",
        "       a-b",
        "              alternate dash form",
        "       a/b",
        "              slash form",
        "       日本語",
        "              非 ASCII の形式",
        "       別形式",
        "              別の非 ASCII 形式"
      ].join("\n"),
      profile: "shellgei"
    });

    expect(records.map(({ id, option }) => ({ id, option }))).toEqual([
      { id: "man:matcher:1:pattern:a-b", option: "a/b" },
      { id: "man:matcher:1:pattern:a-b:a-b", option: "a-b" },
      { id: "man:matcher:1:pattern:a-b:a-b:2", option: "a-b" },
      { id: "man:matcher:1:pattern:item", option: "日本語" },
      { id: "man:matcher:1:pattern:item:%E5%88%A5%E5%BD%A2%E5%BC%8F", option: "別形式" }
    ]);
  });

  it("does not treat nested negative values or example arguments as options", () => {
    const records = extractKnowledgeRecordsFromManPage({
      command: "sample",
      section: "1",
      text: [
        "DESCRIPTION",
        "       -a",
        "              a real option",
        "              -1 is a negative value",
        "              -b is mentioned as an argument",
        "              -z",
        "              This is not a top-level option definition.",
        "EXAMPLES",
        "       -1",
        "              a negative example",
        "       -b",
        "              an option-like example argument"
      ].join("\n"),
      profile: "shellgei"
    });

    expect(records.map(({ id, option }) => ({ id, option }))).toEqual([
      { id: "man:sample:1:option:-a", option: "-a" }
    ]);
  });

  it("filters prose and subsection labels from compact pattern records", () => {
    const text = [
      "PATTERNS AND ACTIONS",
      "       of input. A missing action is equivalent to",
      "              wrapped prose from the preceding paragraph",
      "       Patterns",
      "              a subsection label",
      "       BEGIN",
      "              run before reading input",
      "       /regular expression/",
      "              select matching records",
      "       Actions",
      "              another subsection label",
      "       Tests Tests return a true or false value",
      "              prose introducing find-style tests",
      "       as those in egrep(1). See https://example.invalid",
      "              wrapped manual cross-reference prose",
      "       The control statements are as follows:",
      "              prose introducing control statements",
      "       Supported tests:",
      "              prose introducing find tests",
      "       -size, -uid and -used) as",
      "              a wrapped fragment from the preceding sentence",
      "       pattern && pattern",
      "              combine two patterns"
    ].join("\n");

    const compactRecords = extractKnowledgeRecordsFromManPage({
      command: "awk",
      section: "1",
      text,
      profile: "shellgei"
    });
    const allRecords = extractKnowledgeRecordsFromManPage({
      command: "awk",
      section: "1",
      text,
      profile: "all"
    });

    expect(
      compactRecords.map(({ id, option }) => ({ id, option }))
    ).toEqual([
      { id: "man:awk:1:pattern:begin", option: "BEGIN" },
      { id: "man:awk:1:pattern:regular-expression", option: "/regular expression/" },
      { id: "man:awk:1:pattern:pattern-pattern", option: "pattern && pattern" }
    ]);
    expect(allRecords.filter((record) => record.kind === "pattern").map((record) => record.option)).toEqual([
      "of input. A missing action is equivalent to",
      "Patterns",
      "BEGIN",
      "/regular expression/",
      "Actions",
      "Tests Tests return a true or false value",
      "as those in egrep(1). See https://example.invalid",
      "The control statements are as follows:",
      "Supported tests:",
      "-size, -uid and -used) as",
      "pattern && pattern"
    ]);
  });

  it("uses short Japanese headings such as 注意 as structural boundaries", () => {
    const records = extractKnowledgeRecordsFromManPage({
      command: "jp-boundary",
      section: "1",
      text: [
        "オプション",
        "       -a",
        "              実際の説明です。",
        "注意",
        "       -1",
        "              負数の例です。",
        "       -b",
        "              オプションに似た注意書きです。"
      ].join("\n"),
      profile: "shellgei"
    });

    expect(records).toEqual([
      {
        id: "man:jp-boundary:1:option:-a",
        kind: "option",
        command: "jp-boundary",
        option: "-a",
        text: "-a 実際の説明です。",
        source: "man jp-boundary(1) / オプション"
      }
    ]);
  });

  it("keeps complete normalized option and pattern text", () => {
    const optionDescription = "x".repeat(1300);
    const patternDescription = "y".repeat(1300);
    const records = extractKnowledgeRecordsFromManPage({
      command: "bounded",
      section: "1",
      text: [
        "OPTIONS",
        "       -a",
        `              ${optionDescription}`,
        "PATTERNS",
        "       a/b",
        `              ${patternDescription}`
      ].join("\n"),
      profile: "shellgei"
    });

    expect(records.map((record) => record.text)).toEqual([
      `-a ${optionDescription}`,
      `a/b ${patternDescription}`
    ]);
  });

  it("caps the NAME summary at 1200 characters", () => {
    const records = extractKnowledgeRecordsFromManPage({
      command: "bounded",
      section: "1",
      text: ["NAME", `       bounded - ${"summary".repeat(200)}`].join("\n"),
      profile: "shellgei"
    });

    expect(records).toHaveLength(1);
    expect(records[0].kind).toBe("note");
    expect(records[0].text).toHaveLength(1200);
  });
});
