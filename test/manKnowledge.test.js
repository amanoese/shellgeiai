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
});
