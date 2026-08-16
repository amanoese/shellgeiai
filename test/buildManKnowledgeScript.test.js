import { readFile, rm, mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import * as buildManKnowledgeScript from "../scripts/build-man-knowledge.js";
import {
  buildManKnowledge,
  parseArgs,
  selectManEntries
} from "../scripts/build-man-knowledge.js";

const shellgeiProfile = {
  name: "shellgei",
  sections: ["1"],
  commands: ["awk", "sed", "grep"],
  patternCommands: ["awk", "sed", "grep"]
};

const allProfile = {
  name: "all",
  sections: ["1", "8"],
  commands: null,
  patternCommands: null
};

const indexText = [
  "awk (1)              - pattern scanning and processing language",
  "useradd (8)          - create a new user",
  "passwd (5)           - the password file"
].join("\n");

describe("build man knowledge CLI", () => {
  it("rejects an empty build without writing output", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "shellgeiai-empty-man-"));
    const output = path.join(directory, "man.jsonl");
    const writeOutput = vi.fn();

    try {
      await expect(
        buildManKnowledge(
          { ...parseArgs([]), output },
          {
            loadProfile: vi.fn().mockResolvedValue(shellgeiProfile),
            listEntries: vi.fn().mockResolvedValue([{ name: "missing", section: "1" }]),
            readPage: vi.fn().mockResolvedValue("AUTHOR\n       Written by example."),
            writeOutput
          }
        )
      ).rejects.toThrow("Man knowledge build produced no records.");
      expect(writeOutput).not.toHaveBeenCalled();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("writes stable JSONL and skips unreadable man pages", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "shellgeiai-man-"));
    const output = path.join(directory, "knowledge", "man.jsonl");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const profile = {
      name: "shellgei",
      sections: ["1"],
      commands: ["awk", "missing"],
      patternCommands: ["awk"]
    };

    try {
      const result = await buildManKnowledge(
        { ...parseArgs([]), output },
        {
          loadProfile: vi.fn().mockResolvedValue(profile),
          listEntries: vi.fn().mockResolvedValue([
            { name: "awk", section: "1" },
            { name: "missing", section: "1" }
          ]),
          readPage: vi.fn().mockImplementation(async (_options, entry) => {
            if (entry.name === "missing") throw new Error("not installed");
            return [
              "NAME",
              "       awk - pattern scanning language",
              "OPTIONS",
              "       -F fs",
              "              set the field separator"
            ].join("\n");
          })
        }
      );

      expect(result).toEqual({
        entries: 2,
        failed: 1,
        output,
        profile: "shellgei",
        records: 2
      });
      expect(await readFile(output, "utf8")).toBe(
        [
          '{"id":"man:awk:1:note:summary","kind":"note","command":"awk","option":"","text":"awk - pattern scanning language","source":"man awk(1) / NAME"}',
          '{"id":"man:awk:1:option:-F","kind":"option","command":"awk","option":"-F","text":"-F fs set the field separator","source":"man awk(1) / OPTIONS"}',
          ""
        ].join("\n")
      );
      expect(warn).toHaveBeenCalledOnce();
      expect(warn).toHaveBeenCalledWith("skip man 1 missing: not installed");
    } finally {
      warn.mockRestore();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("documents the profile and profile-default sections", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    try {
      buildManKnowledgeScript.printHelp();
      const help = log.mock.calls[0][0];

      expect(help).toContain(
        "--profile <name>     Extraction profile: shellgei or all (default: shellgei)"
      );
      expect(help).toContain(
        '--sections <list>     Comma-separated man sections, or "all" (profile default)'
      );
      expect(help).toContain(
        "--commands <list>     Comma-separated commands; replaces profile command list."
      );
      expect(help).toContain(
        "The all profile discovers commands with man -k by default."
      );
    } finally {
      log.mockRestore();
    }
  });

  it("defaults to the shellgei profile without command or section overrides", () => {
    expect(parseArgs([])).toMatchObject({
      profile: "shellgei",
      commands: null,
      sections: null
    });
  });

  it("accepts the all profile and rejects an unsupported profile", () => {
    expect(parseArgs(["--profile", "all"]).profile).toBe("all");
    expect(() => parseArgs(["--profile", "wide"])).toThrow(
      "--profile must be shellgei or all."
    );
  });

  it.each([
    ["--commands", "--commands must contain at least one command."],
    ["--sections", "--sections must contain at least one section."]
  ])("rejects an empty %s list", (option, message) => {
    expect(() => parseArgs([option, ","])).toThrow(message);
  });

  it.each(["1.5", "1abc", "0", "-1"])(
    "rejects invalid limit token %s",
    (limit) => {
      expect(() => parseArgs(["--limit", limit])).toThrow(
        "--limit must be a positive integer."
      );
    }
  );

  it("uses explicit commands instead of the profile command list", () => {
    expect(
      selectManEntries({
        options: { commands: ["awk"], sections: null },
        profile: shellgeiProfile
      })
    ).toEqual([{ name: "awk", section: "1" }]);
  });

  it.each([
    {
      label: "explicit all-profile commands with concrete sections",
      options: { commands: ["awk"], sections: ["1"] },
      profile: allProfile,
      expected: false
    },
    {
      label: "an effective null command list",
      options: { commands: null, sections: ["1"] },
      profile: allProfile,
      expected: true
    },
    {
      label: "all sections",
      options: { commands: ["awk"], sections: "all" },
      profile: shellgeiProfile,
      expected: true
    },
    {
      label: "profile commands with concrete sections",
      options: { commands: null, sections: ["1"] },
      profile: shellgeiProfile,
      expected: false
    }
  ])("requests a man index for $label: $expected", ({ options, profile, expected }) => {
    expect(buildManKnowledgeScript.needsManIndex({ options, profile })).toBe(expected);
  });

  it("selects sections 1 and 8 from the man index for the all profile", () => {
    expect(
      selectManEntries({
        options: { commands: null, sections: null },
        profile: allProfile,
        indexText
      })
    ).toEqual([
      { name: "awk", section: "1" },
      { name: "useradd", section: "8" }
    ]);
  });

  it("filters all index sections to explicitly selected commands", () => {
    expect(
      selectManEntries({
        options: { commands: ["passwd"], sections: "all" },
        profile: shellgeiProfile,
        indexText
      })
    ).toEqual([{ name: "passwd", section: "5" }]);
  });

  it("stable-deduplicates explicit commands and concrete sections", () => {
    expect(
      selectManEntries({
        options: {
          commands: ["sed", "awk", "sed"],
          sections: ["8", "1", "8"]
        },
        profile: shellgeiProfile
      })
    ).toEqual([
      { name: "sed", section: "8" },
      { name: "sed", section: "1" },
      { name: "awk", section: "8" },
      { name: "awk", section: "1" }
    ]);
  });

  it("groups all-section index matches in explicit command order", () => {
    const unorderedIndex = [
      "awk (1)              - pattern scanning and processing language",
      "sed (8)              - stream editor administration entry",
      "sed (1)              - stream editor",
      "awk (8)              - pattern scanning administration entry"
    ].join("\n");

    expect(
      selectManEntries({
        options: { commands: ["sed", "awk", "sed"], sections: "all" },
        profile: shellgeiProfile,
        indexText: unorderedIndex
      })
    ).toEqual([
      { name: "sed", section: "8" },
      { name: "sed", section: "1" },
      { name: "awk", section: "1" },
      { name: "awk", section: "8" }
    ]);
  });

  it("uses explicit sections instead of the profile sections", () => {
    expect(
      selectManEntries({
        options: { commands: null, sections: ["1", "8"] },
        profile: shellgeiProfile
      })
    ).toEqual([
      { name: "awk", section: "1" },
      { name: "awk", section: "8" },
      { name: "sed", section: "1" },
      { name: "sed", section: "8" },
      { name: "grep", section: "1" },
      { name: "grep", section: "8" }
    ]);
  });
});
