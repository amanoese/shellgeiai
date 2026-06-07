"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.commandExists = commandExists;
const promises_1 = require("node:fs/promises");
const node_path_1 = __importDefault(require("node:path"));
async function commandExists(command) {
    const pathValue = process.env.PATH ?? "";
    const directories = pathValue.split(node_path_1.default.delimiter).filter(Boolean);
    for (const directory of directories) {
        const candidate = node_path_1.default.join(directory, command);
        try {
            await (0, promises_1.access)(candidate);
            return true;
        }
        catch {
            continue;
        }
    }
    return false;
}
