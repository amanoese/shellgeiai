const DEFAULT_COMMAND_SECTIONS = new Set(["1", "8"]);

const EXCLUDED_SECTION_TITLES = new Set([
  "AUTHOR",
  "AUTHORS",
  "BUGS",
  "COPYRIGHT",
  "COLOPHON",
  "HISTORY",
  "LICENSE",
  "NAME",
  "REPORTING BUGS",
  "SEE ALSO",
  "SYNOPSIS",
  "VERSION",
  "著者",
  "関連項目",
  "バグ",
  "版",
  "著作権"
]);

const OPTION_DEFINITION_SECTION_TITLES = new Set([
  "DESCRIPTION",
  "OPTION",
  "OPTIONS",
  "オプション",
  "説明"
]);

const NAME_SECTION_TITLES = new Set(["NAME", "名前"]);

const GENERIC_LONG_OPTIONS = new Set(["--help", "--version", "--debug", "--usage"]);

const PATTERN_SECTION_TITLES = new Set([
  "ADDRESSES",
  "ARGUMENTS",
  "COMMAND SYNOPSIS",
  "COMMANDS",
  "EXPRESSION",
  "EXPRESSIONS",
  "FORMAT",
  "FORMAT SPECIFIERS",
  "LANGUAGE",
  "OPERANDS",
  "PATTERNS",
  "PATTERNS AND ACTIONS",
  "REGULAR EXPRESSIONS",
  "VARIABLES",
  "アドレス",
  "コマンド",
  "書式",
  "式",
  "正規表現",
  "変数",
  "引数"
]);

const STRUCTURAL_SECTION_TITLES = new Set([
  ...EXCLUDED_SECTION_TITLES,
  ...NAME_SECTION_TITLES,
  ...OPTION_DEFINITION_SECTION_TITLES,
  ...PATTERN_SECTION_TITLES,
  "ENVIRONMENT",
  "EXAMPLE",
  "EXAMPLES",
  "EXIT STATUS",
  "FILES",
  "終了ステータス",
  "環境変数",
  "ファイル",
  "例"
]);

const MAX_DEFINITION_TERM_INDENT = 12;

function collapseWhitespace(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function leadingSpaceCount(line) {
  return line.match(/^\s*/)?.[0].length ?? 0;
}

function cleanLine(line) {
  return String(line ?? "").replace(/\t/g, "        ").replace(/\s+$/u, "");
}

export function stripManControlCharacters(text) {
  let output = String(text ?? "").replace(/\u001b\[[0-9;]*[A-Za-z]/g, "");
  while (/.\x08/.test(output)) {
    output = output.replace(/.\x08/g, "");
  }
  return output.replace(/\r/g, "");
}

function sectionBase(section) {
  return String(section ?? "").match(/^\d+/)?.[0] ?? String(section ?? "");
}

export function parseManIndex(indexText, { sections = [...DEFAULT_COMMAND_SECTIONS] } = {}) {
  const allowedSections = sections === "all" ? null : new Set(sections.map(String));
  const entries = [];
  const seen = new Set();

  for (const line of String(indexText ?? "").split(/\r?\n/)) {
    const match = line.match(/^(.+?)\s+\(([^)]+)\)\s+-\s+/);
    if (!match) continue;

    const section = match[2].trim();
    const base = sectionBase(section);
    if (allowedSections && !allowedSections.has(section) && !allowedSections.has(base)) continue;

    const names = match[1]
      .split(",")
      .map((name) => name.trim())
      .filter((name) => /^[A-Za-z0-9_.+:-]+$/.test(name));

    for (const name of names) {
      const key = `${name}\0${section}`;
      if (seen.has(key)) continue;
      seen.add(key);
      entries.push({ name, section });
    }
  }

  return entries;
}

function canonicalSectionTitle(title) {
  return collapseWhitespace(title).toUpperCase();
}

function isHeading(line) {
  if (!line || leadingSpaceCount(line) > 0) return false;
  const trimmed = line.trim();
  if (trimmed.length < 2 || trimmed.length > 80) return false;
  if (STRUCTURAL_SECTION_TITLES.has(canonicalSectionTitle(trimmed))) return true;
  if (/^[A-Z][A-Z0-9 _/().-]*$/.test(trimmed)) return true;
  return false;
}

function splitSections(text) {
  const sections = [];
  let current = null;

  for (const rawLine of stripManControlCharacters(text).split(/\n/)) {
    const line = cleanLine(rawLine);
    if (isHeading(line)) {
      current = { title: line.trim(), lines: [] };
      sections.push(current);
      continue;
    }
    if (current) current.lines.push(line);
  }

  return sections;
}

function slugify(value) {
  const slug = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/^-{1,2}/, (prefix) => prefix)
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "");
  return slug || "item";
}

function optionIdValue(option) {
  return String(option ?? "")
    .trim()
    .replace(/[^A-Za-z0-9_?@$-]+/g, "-")
    .replace(/-+$/, "");
}

function patternCollisionSuffix(term) {
  return encodeURIComponent(collapseWhitespace(term));
}

function sourceFor(command, section, title) {
  return `man ${command}(${section}) / ${title}`;
}

function sectionRecord({ command, section, title, lines }) {
  const body = collapseWhitespace(lines.join(" "));
  if (!body) return null;
  return {
    id: `man:${command}:${section}:section:${slugify(title)}`,
    kind: "section",
    command,
    option: "",
    text: `${title}: ${body}`.slice(0, 1200),
    source: sourceFor(command, section, title)
  };
}

function commandSummaryRecord({ command, section, title, lines }) {
  const body = collapseWhitespace(lines.join(" "));
  if (!body) return null;
  return {
    id: `man:${command}:${section}:note:summary`,
    kind: "note",
    command,
    option: "",
    text: body.slice(0, 1200),
    source: sourceFor(command, section, title)
  };
}

function looksLikeOptionItem(trimmed) {
  return /^--?[A-Za-z0-9?@$][A-Za-z0-9?_.-]*/.test(trimmed);
}

function looksLikePatternItem(trimmed) {
  if (!trimmed || trimmed.length > 100) return false;
  if (/[.。]$/.test(trimmed)) return false;
  return /\S/u.test(trimmed);
}

function hasIndentedDescription(lines, index) {
  const currentIndent = leadingSpaceCount(lines[index]);
  for (let nextIndex = index + 1; nextIndex < lines.length; nextIndex += 1) {
    const nextLine = cleanLine(lines[nextIndex]);
    if (!nextLine.trim()) continue;
    return leadingSpaceCount(nextLine) > currentIndent;
  }
  return false;
}

function shouldStartItem(lines, index, mode) {
  const line = lines[index];
  const trimmed = line.trim();
  if (!trimmed) return false;
  const hasDefinitionStructure =
    leadingSpaceCount(line) <= MAX_DEFINITION_TERM_INDENT && hasIndentedDescription(lines, index);
  if (mode === "option") return looksLikeOptionItem(trimmed) && hasDefinitionStructure;
  return looksLikePatternItem(trimmed) && hasDefinitionStructure;
}

function extractDefinitionItems(lines, mode) {
  const items = [];
  let current = null;

  function flush() {
    if (current && collapseWhitespace([current.term, ...current.description].join(" "))) {
      items.push(current);
    }
    current = null;
  }

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index];
    const line = cleanLine(rawLine);
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    if (shouldStartItem(lines, index, mode)) {
      flush();
      current = { term: trimmed, description: [] };
      continue;
    }
    if (current) {
      current.description.push(trimmed);
    }
  }
  flush();

  return items.map((item) => ({
    term: item.term,
    text: collapseWhitespace([item.term, ...item.description].join(" "))
  }));
}

function optionTokens(term) {
  return [...term.matchAll(/(^|[\s,])(--?[A-Za-z0-9?@$][A-Za-z0-9?_.-]*)/g)].map(
    (match) => match[2]
  );
}

function isGenericOptionGroup(options) {
  return options.some((option) => GENERIC_LONG_OPTIONS.has(option));
}

function optionRecords({
  command,
  section,
  title,
  lines,
  groupAliases = false,
  excludeGeneric = false
}) {
  const records = [];
  for (const item of extractDefinitionItems(lines, "option")) {
    const options = optionTokens(item.term);
    if (excludeGeneric && isGenericOptionGroup(options)) continue;

    if (groupAliases && options.length > 0) {
      records.push({
        id: `man:${command}:${section}:option:${optionIdValue(options[0])}`,
        kind: "option",
        command,
        option: options.join(", "),
        text: item.text,
        source: sourceFor(command, section, title)
      });
      continue;
    }

    for (const option of options) {
      records.push({
        id: `man:${command}:${section}:option:${optionIdValue(option)}`,
        kind: "option",
        command,
        option,
        text: item.text,
        source: sourceFor(command, section, title)
      });
    }
  }
  return records;
}

function patternRecords({ command, section, title, lines }) {
  return extractDefinitionItems(lines, "pattern").map((item) => ({
    id: `man:${command}:${section}:pattern:${slugify(item.term)}`,
    kind: "pattern",
    command,
    option: item.term,
    text: item.text,
    source: sourceFor(command, section, title)
  }));
}

function pushUnique(records, record, seen) {
  if (!record || seen.has(record.id)) return;
  seen.add(record.id);
  records.push(record);
}

function hasSamePatternContent(left, right) {
  return left?.kind === "pattern" && left.option === right.option && left.text === right.text;
}

function pushPatternRecord(records, record, seen) {
  const existing = records.find((candidate) => candidate.id === record.id);
  if (!existing) {
    pushUnique(records, record, seen);
    return;
  }
  if (hasSamePatternContent(existing, record)) return;

  const disambiguatedBaseId = `${record.id}:${patternCollisionSuffix(record.option)}`;
  let disambiguatedId = disambiguatedBaseId;
  let suffix = 2;

  while (seen.has(disambiguatedId)) {
    const disambiguatedExisting = records.find((candidate) => candidate.id === disambiguatedId);
    if (hasSamePatternContent(disambiguatedExisting, record)) return;
    disambiguatedId = `${disambiguatedBaseId}:${suffix}`;
    suffix += 1;
  }

  pushUnique(records, { ...record, id: disambiguatedId }, seen);
}

export function extractKnowledgeRecordsFromManPage({
  command,
  section,
  text,
  profile = "all",
  includePatterns = true
}) {
  const records = [];
  const seen = new Set();
  const isShellgeiProfile = profile === "shellgei";

  for (const manSection of splitSections(text)) {
    const title = manSection.title;
    const canonicalTitle = canonicalSectionTitle(title);
    const context = { command, section, title, lines: manSection.lines };

    if (isShellgeiProfile && NAME_SECTION_TITLES.has(canonicalTitle)) {
      pushUnique(records, commandSummaryRecord(context), seen);
      continue;
    }
    if (EXCLUDED_SECTION_TITLES.has(canonicalTitle)) continue;

    if (isShellgeiProfile) {
      if (OPTION_DEFINITION_SECTION_TITLES.has(canonicalTitle)) {
        for (const record of optionRecords({ ...context, groupAliases: true, excludeGeneric: true })) {
          pushUnique(records, record, seen);
        }
      }

      if (includePatterns && PATTERN_SECTION_TITLES.has(canonicalTitle)) {
        for (const record of patternRecords(context)) pushPatternRecord(records, record, seen);
      }
      continue;
    }

    pushUnique(records, sectionRecord(context), seen);

    if (OPTION_DEFINITION_SECTION_TITLES.has(canonicalTitle)) {
      for (const record of optionRecords(context)) pushUnique(records, record, seen);
    }

    if (includePatterns && PATTERN_SECTION_TITLES.has(canonicalTitle)) {
      for (const record of patternRecords(context)) pushPatternRecord(records, record, seen);
    }
  }

  return records;
}
