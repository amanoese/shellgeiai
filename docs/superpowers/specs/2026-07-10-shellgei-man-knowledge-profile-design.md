# ShellGei man knowledge profile design

## Purpose

The current man-derived knowledge corpus contains 133,125 records from about
4,400 commands. Building embeddings is slow, the vector file is about 640 MB,
and every worker search performs a linear cosine scan over the full corpus.

This change introduces a curated ShellGei profile that keeps useful command,
option, and syntax knowledge while excluding unrelated system administration
manuals and redundant records.

## Scope

The default man knowledge build will target 100 to 200 commands commonly used
in ShellGei solutions. The existing explicit `--commands` behavior remains
available, and a `--profile all` escape hatch preserves the ability to extract
all discovered section 1 and 8 manuals.

This change does not introduce approximate nearest-neighbor search, BM25,
planner retrieval, or retry-time retrieval. Worker-only vector retrieval and
the current cosine search implementation remain unchanged.

## Command selection

A repository-owned JSON profile file will contain a `commands` array and a
smaller `patternCommands` array. The command list will cover these groups:

- text filtering and transformation, such as `awk`, `sed`, `grep`, `cut`, and
  `tr`;
- ordering, aggregation, and joins, such as `sort`, `uniq`, `join`, `comm`, and
  `paste`;
- file and record traversal, such as `find`, `xargs`, `head`, and `tail`;
- formatting and encoding, such as `printf`, `column`, `fold`, `xxd`, and
  `base64`;
- structured data and scripting tools, such as `jq`, `perl`, and `bash`;
- numeric, date, archive, and compression utilities commonly used in ShellGei
  problems.

Commands blocked by the default command policy will not be included in the
curated profile. The curated profile uses section 1 manuals by default.
Section 8 manuals are available only through `--profile all` or an explicit
`--sections` value.

The profile is static and reviewable. It is not inferred automatically from
the seed dataset or local usage logs, so builds remain deterministic across
machines with the same installed manuals.

## Record filtering and normalization

The curated profile produces the following records:

- one `note` command-summary record from the man page NAME section;
- option records from option definition blocks;
- pattern records only for commands whose language or expression syntax is
  useful to ShellGei, including `awk`, `sed`, `grep`, `find`, `bash`, and
  `perl`.

Whole-section records are excluded from the curated profile. They remain
available in the `all` profile for compatibility and diagnostics.

Generic operational options are excluded from the curated profile:

- `--help` and equivalent help-only aliases;
- `--version` and equivalent version-only aliases;
- `--debug`;
- `--usage`.

Aliases declared in the same option definition, such as `-n`, `--quiet`, and
`--silent`, produce one record and one vector. Its `option` field contains the
comma-separated aliases in declaration order, its ID uses the first declared
alias, and its text retains the full definition. Duplicate records with the
same command, kind, and normalized text are removed before writing JSONL.

The `all` profile preserves the current extraction behavior, including
whole-section records and per-alias option records. Curated filtering and
alias grouping apply only to the `shellgei` profile.

## CLI behavior

The default command uses the curated profile:

```bash
npm run knowledge:man
```

The full locally installed man corpus remains opt-in:

```bash
npm run knowledge:man -- --profile all
```

Explicit command selection remains supported and replaces the profile's
command list:

```bash
npm run knowledge:man -- --commands awk,sed,grep
```

The selected profile still controls record filtering. For example,
`--commands awk,sed` uses curated filtering, while
`--profile all --commands awk,sed` preserves the full extraction shape for
only those commands. `--sections` overrides the profile's default sections.

Supported profiles are `shellgei` and `all`. An unknown profile produces an
actionable error. Help output explains these precedence rules.

## Data flow

1. Parse the CLI profile and optional explicit command list.
2. Resolve man entries from the curated profile, explicit commands, or
   `man -k .` for the `all` profile.
3. Render each selected man page.
4. Extract command summaries, option definitions, and eligible patterns.
5. Apply curated-profile filtering and alias grouping.
6. Deduplicate normalized records and write `man.jsonl`.
7. Use the existing `knowledge build` command to create vectors.
8. Load the reduced dataset and vectors for worker-only retrieval.

## Error handling

- Missing man pages are reported and skipped as they are today.
- A build fails only when argument validation fails or the output cannot be
  written.
- Commands unavailable on the current machine do not cause the entire curated
  build to fail.
- An empty result is reported clearly instead of silently producing an
  apparently successful corpus.

## Verification and success criteria

Tests will cover:

- default `shellgei` and explicit `all` profile parsing;
- explicit `--commands` precedence;
- rejection of an unknown profile;
- exclusion of blocked and generic operational options;
- grouping of aliases into one record;
- exclusion of whole-section records from the curated profile;
- retention of selected command summaries and syntax patterns;
- deterministic deduplication and stable JSONL output.

The generated curated dataset must meet these measurable criteria:

- 100 to 200 selected command names before unavailable manuals are skipped;
- no command blocked by the default command policy;
- no more than 8,000 output records;
- no duplicate command/kind/normalized-text records;
- a vector file no larger than 10 percent of the current approximately 640 MB
  full-corpus vector file when built with the same embedding model.

These bounds reduce both embedding work and linear vector scoring without
changing retrieval semantics or adding a new search dependency.
