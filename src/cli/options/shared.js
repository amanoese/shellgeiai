export function isFlag(value) {
  return typeof value === "string" && value.startsWith("--");
}

export function isHelpToken(value) {
  return value === "--help" || value === "-h" || value === "help";
}

export function parseNumber(value, message) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(message);
  }
  return parsed;
}

export function takeValue(argv, index, message) {
  const value = argv[index + 1];
  if (value == null || isFlag(value)) {
    throw new Error(message);
  }
  return value;
}
