import { describe, expect, it, vi } from "vitest";

import * as buildManKnowledgeScript from "../scripts/build-man-knowledge.js";
import {
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

  it("uses explicit commands instead of the profile command list", () => {
    expect(
      selectManEntries({
        options: { commands: ["awk"], sections: null },
        profile: shellgeiProfile
      })
    ).toEqual([{ name: "awk", section: "1" }]);
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
