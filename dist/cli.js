#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const cliOptions_1 = require("./cliOptions");
const solve_1 = require("./core/solve");
const codexCliEngine_1 = require("./engines/codexCliEngine");
const cursorCliEngine_1 = require("./engines/cursorCliEngine");
const mockEngine_1 = require("./engines/mockEngine");
const formatResult_1 = require("./formatter/formatResult");
const simpleJudge_1 = require("./judge/simpleJudge");
const localRunner_1 = require("./runner/localRunner");
function printUsage() {
    process.stderr.write(`${(0, cliOptions_1.createCliProgram)().helpInformation()}\n`);
}
function createEngine(name) {
    switch (name) {
        case "mock":
            return new mockEngine_1.MockEngine();
        case "codex":
            return new codexCliEngine_1.CodexCliEngine();
        case "cursor":
            return new cursorCliEngine_1.CursorCliEngine();
        default:
            throw new Error(`Unsupported engine: ${String(name)}`);
    }
}
async function main() {
    try {
        const options = (0, cliOptions_1.parseCliOptions)(process.argv.slice(2));
        const result = await (0, solve_1.solveProblem)({
            problemInput: options.problem,
            engine: createEngine(options.engine),
            runner: new localRunner_1.LocalRunner(),
            judge: new simpleJudge_1.SimpleJudge(),
            maxIterations: options.maxIter,
            requestedWorkdir: options.workdir
        });
        process.stdout.write(`${(0, formatResult_1.formatResult)(result)}\n`);
        process.exitCode = result.finalCheck.passed ? 0 : 1;
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Error: ${message}`);
        printUsage();
        process.exitCode = 1;
    }
}
void main();
