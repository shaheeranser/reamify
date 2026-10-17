/**
 * Child-process entry point: run a single conversion and report timing and
 * peak memory as one JSON line on stdout.
 *
 * Usage: node run-tool.mjs <reamify|pdf-to-excel> <pdfPath> <outPath> [variant]
 *
 * Environment:
 *   REAMIFY_DIST  absolute path to dist/index.js
 *   SANDBOX_DIR   absolute path to the eval harness sandbox
 */

import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { createRequire } from 'node:module';

const [, , tool, pdfPath, outPath, variant = 'default'] = process.argv;

function peakRssBytes() {
	try {
		const status = fs.readFileSync('/proc/self/status', 'utf8');
		const match = status.match(/VmHWM:\s+(\d+)\s+kB/);
		if (match) return Number(match[1]) * 1024;
	} catch {
		// fall through to resourceUsage
	}
	return process.resourceUsage().maxRSS * 1024;
}

async function runReamify() {
	const mod = await import(process.env.REAMIFY_DIST);
	const source = fs.readFileSync(pdfPath);
	await mod.convertPdf(source, { filename: outPath, extraction: variant });
}

async function runPdfToExcel() {
	const require = createRequire(path.join(process.env.SANDBOX_DIR, 'package.json'));
	const lib = require('pdf-to-excel');
	const api = lib.default ?? lib;
	await api.genXlsx(pdfPath, outPath);
}

async function main() {
	const started = performance.now();
	let ok = true;
	let error;
	try {
		if (tool === 'reamify') await runReamify();
		else if (tool === 'pdf-to-excel') await runPdfToExcel();
		else throw new Error(`Unknown tool: ${tool}`);
	} catch (caught) {
		ok = false;
		error = caught?.stack ?? String(caught);
	}
	const ms = performance.now() - started;

	let outBytes = 0;
	try {
		outBytes = fs.statSync(outPath).size;
	} catch {
		// no output produced
	}

	console.log(JSON.stringify({ tool, variant, ok, ms, peakBytes: peakRssBytes(), outBytes, error }));
	if (!ok) process.exitCode = 1;
}

main();
