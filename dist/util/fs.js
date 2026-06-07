"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureDirectory = ensureDirectory;
exports.fileExists = fileExists;
exports.createWorkingDirectory = createWorkingDirectory;
exports.parseProblemInput = parseProblemInput;
exports.writeJson = writeJson;
const promises_1 = require("node:fs/promises");
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
async function ensureDirectory(dirPath) {
    await (0, promises_1.mkdir)(dirPath, { recursive: true });
}
async function fileExists(targetPath) {
    try {
        await (0, promises_1.stat)(targetPath);
        return true;
    }
    catch {
        return false;
    }
}
async function createWorkingDirectory(requestedWorkdir) {
    if (requestedWorkdir) {
        const resolved = node_path_1.default.resolve(process.cwd(), requestedWorkdir);
        await ensureDirectory(resolved);
        return resolved;
    }
    return await (0, promises_1.mkdtemp)(node_path_1.default.join(node_os_1.default.tmpdir(), "shellgeiai-"));
}
function parseProblemInput(problemInput) {
    return {
        raw: problemInput,
        problemText: problemInput
    };
}
async function writeJson(targetPath, value) {
    await (0, promises_1.writeFile)(targetPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
