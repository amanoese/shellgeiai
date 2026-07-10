import { isAbsolute, join } from "node:path";

import { describe, expect, it } from "vitest";

import { defaultCommandPolicy } from "../src/execution/safety/commandPolicy.js";
import {
  loadManKnowledgeProfile,
  SUPPORTED_MAN_PROFILES
} from "../src/knowledge/manProfile.js";

const EXPECTED_COMMANDS = [
  "7z",
  "ar",
  "awk",
  "base32",
  "base64",
  "basename",
  "basenc",
  "bash",
  "bc",
  "bunzip2",
  "bzcat",
  "bzip2",
  "cal",
  "cat",
  "cksum",
  "col",
  "column",
  "colrm",
  "comm",
  "cpio",
  "csplit",
  "csvtool",
  "cut",
  "datamash",
  "date",
  "dc",
  "df",
  "diff",
  "diff3",
  "dirname",
  "dos2unix",
  "du",
  "echo",
  "egrep",
  "env",
  "expand",
  "expr",
  "factor",
  "false",
  "fgrep",
  "file",
  "find",
  "fmt",
  "fold",
  "getconf",
  "gnuplot",
  "grep",
  "groups",
  "gunzip",
  "gzip",
  "head",
  "hexdump",
  "hostid",
  "iconv",
  "id",
  "join",
  "jot",
  "jq",
  "less",
  "look",
  "ls",
  "lua",
  "md5sum",
  "mlr",
  "more",
  "namei",
  "nawk",
  "ncal",
  "nl",
  "nkf",
  "node",
  "nproc",
  "numfmt",
  "od",
  "parallel",
  "paste",
  "pee",
  "perl",
  "pgrep",
  "php",
  "pr",
  "printenv",
  "printf",
  "ps",
  "ptx",
  "pwd",
  "python3",
  "readlink",
  "realpath",
  "rev",
  "rs",
  "Rscript",
  "ruby",
  "sed",
  "seq",
  "sha1sum",
  "sha224sum",
  "sha256sum",
  "sha384sum",
  "sha512sum",
  "shuf",
  "sleep",
  "sort",
  "split",
  "sponge",
  "stat",
  "stdbuf",
  "strings",
  "sum",
  "tac",
  "tail",
  "tar",
  "tee",
  "test",
  "time",
  "timeout",
  "tr",
  "tree",
  "true",
  "ts",
  "tsort",
  "tty",
  "uname",
  "unexpand",
  "uniq",
  "units",
  "unlzma",
  "unxz",
  "unzip",
  "uptime",
  "users",
  "uudecode",
  "uuencode",
  "wc",
  "whereis",
  "which",
  "who",
  "whoami",
  "xargs",
  "xmllint",
  "xmlstarlet",
  "xxd",
  "xz",
  "xzcat",
  "yes",
  "yq",
  "zcat",
  "zip",
  "zipinfo",
  "zstd",
  "zstdcat"
];

const EXPECTED_PATTERN_COMMANDS = [
  "awk",
  "bash",
  "bc",
  "date",
  "dc",
  "expr",
  "find",
  "grep",
  "jq",
  "perl",
  "printf",
  "sed",
  "sort"
];

function validProfile(overrides = {}) {
  return {
    name: "shellgei",
    sections: ["1"],
    commands: [...EXPECTED_COMMANDS],
    patternCommands: [...EXPECTED_PATTERN_COMMANDS],
    ...overrides
  };
}

function profileReader(profile) {
  return async () => JSON.stringify(profile);
}

describe("man knowledge profiles", () => {
  it("loads the exact curated ShellGei profile", async () => {
    const profile = await loadManKnowledgeProfile("shellgei");
    const blockedCommands = new Set(
      defaultCommandPolicy.blockedCommands.map(({ name }) => name)
    );

    expect(profile).toEqual({
      name: "shellgei",
      sections: ["1"],
      commands: EXPECTED_COMMANDS,
      patternCommands: EXPECTED_PATTERN_COMMANDS
    });
    expect(profile.commands).toHaveLength(151);
    expect(profile.patternCommands).toHaveLength(13);
    expect(new Set(profile.commands).size).toBe(profile.commands.length);
    expect(profile.commands.filter((command) => blockedCommands.has(command))).toEqual([]);
    expect(profile.patternCommands.every((command) => profile.commands.includes(command))).toBe(true);
  });

  it("loads the unrestricted all profile", async () => {
    await expect(loadManKnowledgeProfile("all")).resolves.toEqual({
      name: "all",
      sections: ["1", "8"],
      commands: null,
      patternCommands: null
    });
  });

  it("exposes supported profiles and rejects an unknown profile", async () => {
    expect(SUPPORTED_MAN_PROFILES).toEqual(new Set(["shellgei", "all"]));
    await expect(loadManKnowledgeProfile("unknown")).rejects.toThrow(
      "Unknown man knowledge profile 'unknown'. Use shellgei or all."
    );
  });

  it("rejects a profile with the wrong name", async () => {
    await expect(
      loadManKnowledgeProfile("shellgei", {
        readFile: profileReader(validProfile({ name: "other" }))
      })
    ).rejects.toThrow("Invalid ShellGei man profile: expected name 'shellgei'.");
  });

  it.each(["sections", "commands", "patternCommands"])(
    "rejects %s when it is not an array",
    async (fieldName) => {
      await expect(
        loadManKnowledgeProfile("shellgei", {
          readFile: profileReader(validProfile({ [fieldName]: "invalid" }))
        })
      ).rejects.toThrow(
        `Invalid ShellGei man profile: '${fieldName}' must be an array of nonblank strings.`
      );
    }
  );

  it.each(["sections", "commands", "patternCommands"])(
    "rejects %s containing a blank entry",
    async (fieldName) => {
      const profile = validProfile();
      profile[fieldName].push(" ");

      await expect(
        loadManKnowledgeProfile("shellgei", { readFile: profileReader(profile) })
      ).rejects.toThrow(
        `Invalid ShellGei man profile: '${fieldName}' must be an array of nonblank strings.`
      );
    }
  );

  it.each(["sections", "commands", "patternCommands"])(
    "rejects duplicate entries in %s",
    async (fieldName) => {
      const profile = validProfile();
      profile[fieldName].push(profile[fieldName][0]);

      await expect(
        loadManKnowledgeProfile("shellgei", { readFile: profileReader(profile) })
      ).rejects.toThrow(
        `Invalid ShellGei man profile: '${fieldName}' must not contain duplicates.`
      );
    }
  );

  it.each([99, 201])("rejects a profile containing %i commands", async (commandCount) => {
    const commands = Array.from({ length: commandCount }, (_, index) => `command-${index}`);

    await expect(
      loadManKnowledgeProfile("shellgei", {
        readFile: profileReader(validProfile({ commands, patternCommands: [] }))
      })
    ).rejects.toThrow(
      "Invalid ShellGei man profile: 'commands' must contain between 100 and 200 commands."
    );
  });

  it("rejects a pattern command that is not selected", async () => {
    await expect(
      loadManKnowledgeProfile("shellgei", {
        readFile: profileReader(validProfile({ patternCommands: ["missing"] }))
      })
    ).rejects.toThrow(
      "Invalid ShellGei man profile: pattern command 'missing' is not selected."
    );
  });

  it("rejects a command blocked by the default policy", async () => {
    const commands = [...EXPECTED_COMMANDS.slice(0, -1), "rm"];

    await expect(
      loadManKnowledgeProfile("shellgei", {
        readFile: profileReader(validProfile({ commands }))
      })
    ).rejects.toThrow(
      "Invalid ShellGei man profile: command 'rm' is blocked by the default command policy."
    );
  });

  it("resolves the packaged ShellGei profile relative to the module", async () => {
    let requestedPath;
    let requestedEncoding;

    await loadManKnowledgeProfile("shellgei", {
      readFile: async (profilePath, encoding) => {
        requestedPath = profilePath;
        requestedEncoding = encoding;
        return JSON.stringify(validProfile());
      }
    });

    expect(isAbsolute(requestedPath)).toBe(true);
    expect(requestedPath.endsWith(join("data", "knowledge", "shellgei-man-profile.json"))).toBe(true);
    expect(requestedEncoding).toBe("utf8");
  });
});
