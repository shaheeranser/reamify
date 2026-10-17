/**
 * Comparison harness: runs reamify (auto + clustered) and the `pdf-to-excel`
 * npm library over a curated PDF corpus and the generated ground-truth PDFs,
 * measuring wall-clock time, peak RSS, structural output stats, a text-coverage
 * accuracy proxy, and exact ground-truth accuracy. Multiple runs are collected
 * and summarized (min / median / mean / stddev).
 *
 * Usage:
 *   node scripts/eval/harness.mjs [options]
 *
 * Options:
 *   --runs=N        measured runs per document/tool (default 3)
 *   --warmup=N      discarded warm-up runs before measuring (default 1)
 *   --heavy         include large/heavy documents
 *   --only=id,id    restrict to specific document ids
 *   --tools=a,b     reamify-default, reamify-auto, pdf-to-excel (default: default + pdf-to-excel)
 *   --timeout=ms    per-run timeout (default 600000)
 *   --no-fetch      assume the corpus is already downloaded
 *   --no-gt         skip ground-truth generation
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import {
	repoRoot,
	corpusDir,
	evalDir,
	resultsDir,
	ensureDir,
	ensureSandbox,
	buildLocalPackage,
	reamifyDistEntry,
	sandboxDir,
} from './sandbox.mjs';
import { readWorkbook, pdfTextTokens, coverage, compareToGroundTruth } from './metrics.mjs';
import { generateGroundTruth } from './ground-truth.mjs';

const REAMIFY_VARIANTS = {
	'reamify-default': { tool: 'reamify', variant: 'default', label: 'reamify (default)' },
	'reamify-auto': { tool: 'reamify', variant: 'auto', label: 'reamify (auto)' },
	'pdf-to-excel': { tool: 'pdf-to-excel', variant: 'default', label: 'pdf-to-excel' },
};

function parseArgs(argv) {
	const args = { runs: 3, warmup: 1, heavy: false, only: null, tools: ['reamify-default', 'pdf-to-excel'], timeout: 600000, fetch: true, gt: true };
	for (const arg of argv) {
		if (arg.startsWith('--runs=')) args.runs = Number(arg.slice(7)) || args.runs;
		else if (arg.startsWith('--warmup=')) args.warmup = Number(arg.slice(9)) || 0;
		else if (arg === '--heavy') args.heavy = true;
		else if (arg === '--no-fetch') args.fetch = false;
		else if (arg === '--no-gt') args.gt = false;
		else if (arg.startsWith('--only=')) args.only = new Set(arg.slice(7).split(','));
		else if (arg.startsWith('--tools=')) args.tools = arg.slice(8).split(',').map((t) => t.trim()).filter(Boolean);
		else if (arg.startsWith('--timeout=')) args.timeout = Number(arg.slice(10)) || args.timeout;
	}
	return args;
}

function summary(values) {
	if (values.length === 0) return { min: NaN, max: NaN, mean: NaN, median: NaN, stdev: NaN };
	const sorted = [...values].sort((a, b) => a - b);
	const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
	const mid = Math.floor(sorted.length / 2);
	const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
	const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
	return { min: sorted[0], max: sorted[sorted.length - 1], mean, median, stdev: Math.sqrt(variance) };
}

function runChild(args, timeout) {
	return new Promise((resolve) => {
		const child = spawn(
			process.execPath,
			[path.join(repoRoot, 'scripts', 'eval', 'run-tool.mjs'), ...args],
			{
				cwd: repoRoot,
				env: { ...process.env, REAMIFY_DIST: reamifyDistEntry, SANDBOX_DIR: sandboxDir },
			},
		);
		let stdout = '';
		let stderr = '';
		let killed = false;
		const timer = setTimeout(() => {
			killed = true;
			child.kill('SIGKILL');
		}, timeout);
		child.stdout.on('data', (chunk) => (stdout += chunk));
		child.stderr.on('data', (chunk) => (stderr += chunk));
		child.on('close', (code) => {
			clearTimeout(timer);
			const last = stdout.trim().split('\n').filter(Boolean).at(-1);
			let parsed = null;
			try {
				parsed = JSON.parse(last);
			} catch {
				// leave parsed null
			}
			resolve({ code, killed, parsed, stderr });
		});
	});
}

function loadCorpus(only, heavy) {
	const manifestPath = path.join(corpusDir, 'manifest.json');
	if (!fs.existsSync(manifestPath)) throw new Error('Corpus manifest missing; run fetch-corpus.mjs first');
	const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
	const corpus = JSON.parse(fs.readFileSync(path.join(repoRoot, 'scripts', 'eval', 'corpus.json'), 'utf8'));
	const metaById = new Map(corpus.documents.map((doc) => [doc.id, doc]));

	return manifest.documents
		.filter((doc) => {
			const meta = metaById.get(doc.id);
			if (!meta) return false;
			// An explicit `--only` selection is an allowlist that also
			// overrides the heavy gate, so a single heavy document can be
			// evaluated without enabling the whole heavy set.
			if (only) return only.has(doc.id);
			return heavy || !meta.heavy;
		})
		.map((doc) => {
			const meta = metaById.get(doc.id);
			return {
				id: doc.id,
				kind: 'corpus',
				pdfPath: path.join(repoRoot, doc.path),
				tags: doc.tags,
				sizeClass: doc.sizeClass,
				pages: doc.pages,
				heavy: meta?.heavy ?? false,
			};
		});
}

async function measureDocument(doc, tools, args, artifactDir) {
	const results = {};
	let lastOutput = {};
	const reference = await pdfTextTokens(fs.readFileSync(doc.pdfPath));

	for (const toolKey of tools) {
		const spec = REAMIFY_VARIANTS[toolKey];
		if (!spec) throw new Error(`Unknown tool key: ${toolKey}`);

		const runs = [];
		for (let index = 0; index < args.warmup + args.runs; index++) {
			const measured = index >= args.warmup;
			const outPath = path.join(artifactDir, `${doc.id}__${toolKey}__${index}.xlsx`);
			process.stdout.write(`  ${doc.id} ${toolKey} run ${index + 1}/${args.warmup + args.runs} ... `);
			const outcome = await runChild([spec.tool, doc.pdfPath, outPath, spec.variant], args.timeout);
			if (outcome.killed) {
				console.log('TIMEOUT');
			} else if (!outcome.parsed || !outcome.parsed.ok) {
				console.log(`FAIL ${outcome.parsed?.error?.split('\n')[0] ?? outcome.stderr.split('\n')[0] ?? 'unknown'}`);
			} else {
				console.log(`${outcome.parsed.ms.toFixed(0)} ms  ${(outcome.parsed.peakBytes / 1048576).toFixed(0)} MiB`);
				if (measured) runs.push(outcome.parsed);
				lastOutput[toolKey] = outPath;
			}
		}

		results[toolKey] = {
			label: spec.label,
			runs,
			time: summary(runs.map((run) => run.ms)),
			memory: summary(runs.map((run) => run.peakBytes)),
		};

		// Drop earlier artifacts; keep only the last successful output.
		for (let index = 0; index < args.warmup + args.runs; index++) {
			const outPath = path.join(artifactDir, `${doc.id}__${toolKey}__${index}.xlsx`);
			if (outPath !== lastOutput[toolKey] && fs.existsSync(outPath)) fs.rmSync(outPath, { force: true });
		}
	}

	// Accuracy: last output of each tool.
	const accuracy = { referenceTokens: reference.tokens.length, pages: reference.numPages, byTool: {} };
	for (const toolKey of tools) {
		const outPath = lastOutput[toolKey];
		if (!outPath || !fs.existsSync(outPath)) {
			accuracy.byTool[toolKey] = null;
			continue;
		}
		const workbook = await readWorkbook(outPath);
		const entry = { stats: workbook.stats, coverage: coverage(reference.tokens, workbook.allTokens) };
		if (doc.expectedGrid) {
			entry.groundTruth = await compareToGroundTruth(outPath, doc.expectedGrid);
		}
		accuracy.byTool[toolKey] = entry;
	}

	return { results, accuracy };
}

function formatMs(value) {
	return Number.isFinite(value) ? `${value.toFixed(0)} ms` : 'n/a';
}
function formatMiB(bytes) {
	return Number.isFinite(bytes) ? `${(bytes / 1048576).toFixed(0)} MiB` : 'n/a';
}
function pct(value) {
	return Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : 'n/a';
}

function renderReport({ generatedAt, args, tools, documents }) {
	const lines = [];
	lines.push('# reamify vs pdf-to-excel evaluation');
	lines.push('');
	lines.push(`Generated: ${generatedAt}`);
	lines.push(`Measured runs per tool/document: ${args.runs}; warm-up runs: ${args.warmup}`);
	lines.push(`Tools: ${tools.map((key) => REAMIFY_VARIANTS[key].label).join(', ')}`);
	lines.push('');
	lines.push('## Methodology and caveats');
	lines.push('');
	lines.push('- **Time** is wall-clock milliseconds for one conversion in a fresh child process; **peak RSS** is that process\'s `VmHWM` (includes the ~85 MiB Node baseline).');
	lines.push('- **Coverage** is the multiset token recall/precision/F1 of the workbook text against the PDF\'s embedded text layer, reconstructed positionally with pdf.js. It is a *proxy*: a tool that emits every line as one column scores high recall even with broken structure, so it must be read alongside the structural columns.');
	lines.push('- **Exact grid** is only reported for generated ground-truth documents, where the expected grid is known exactly. "differs" means the normalized cell grid does not match (e.g. an extra title row or a de-duplicated header), which is not automatically wrong.');
	lines.push('- Reamify uses its default worksheet policy for these runs.');
	lines.push('');

	for (const doc of documents) {
		lines.push(`## ${doc.id}  (${doc.kind}${doc.pages ? `, ${doc.pages} pages` : ''})`);
		lines.push('');
		lines.push('| Tool | Time (min/median/mean) | Peak RSS (min/median) | Coverage recall/precision/F1 | Output rows / cells | Structured |');
		lines.push('|---|---|---|---|---|---|');
		for (const toolKey of tools) {
			const result = doc.measured.results[toolKey];
			const acc = doc.measured.accuracy.byTool[toolKey];
			const cov = acc?.coverage;
			const stats = acc?.stats;
			const gt = acc?.groundTruth;
			lines.push(
				`| ${result.label} | ${formatMs(result.time.min)} / ${formatMs(result.time.median)} / ${formatMs(result.time.mean)} | ${formatMiB(result.memory.min)} / ${formatMiB(result.memory.median)} | ${pct(cov?.recall)} / ${pct(cov?.precision)} / ${pct(cov?.f1)} | ${stats?.rows ?? 'n/a'} / ${stats?.nonEmptyCells ?? 'n/a'} | ${gt ? (gt.exactMatch ? 'exact grid' : 'differs') : `${stats?.sheets ?? 'n/a'} sheet(s)`} |`,
			);
		}
		lines.push('');
		if (doc.expectedGrid) {
			lines.push(`Expected grid (${doc.expectedGrid.length} rows) for exact match; see eval/ground-truth/expected.json.`);
			lines.push('');
		}
	}

	lines.push('## Aggregate');
	lines.push('');
	lines.push('| Tool | Sum of median times | Mean coverage F1 | Exact ground-truth grids |');
	lines.push('|---|---|---|---|');
	const groundTruthCount = documents.filter((doc) => doc.expectedGrid).length;
	for (const toolKey of tools) {
		const medians = documents
			.map((doc) => doc.measured.results[toolKey].time.median)
			.filter(Number.isFinite);
		const f1s = documents
			.map((doc) => doc.measured.accuracy.byTool[toolKey]?.coverage?.f1)
			.filter(Number.isFinite);
		const exact = documents.filter(
			(doc) => doc.expectedGrid && doc.measured.accuracy.byTool[toolKey]?.groundTruth?.exactMatch,
		).length;
		const sumMedian = medians.reduce((sum, value) => sum + value, 0);
		const meanF1 = f1s.length ? f1s.reduce((sum, value) => sum + value, 0) / f1s.length : NaN;
		lines.push(
			`| ${REAMIFY_VARIANTS[toolKey].label} | ${formatMs(sumMedian)} | ${pct(meanF1)} | ${exact} / ${groundTruthCount} |`,
		);
	}
	lines.push('');

	return `${lines.join('\n')}\n`;
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	const tools = args.tools.filter((key) => key in REAMIFY_VARIANTS);
	if (tools.length === 0) throw new Error('No valid tools selected');

	console.log('Building local package ...');
	buildLocalPackage();
	console.log('Ensuring evaluation sandbox ...');
	ensureSandbox();

	if (args.fetch) {
		const fetchArgs = [path.join(repoRoot, 'scripts', 'eval', 'fetch-corpus.mjs')];
		if (args.heavy) fetchArgs.push('--heavy');
		const result = spawnSync(process.execPath, fetchArgs, { cwd: repoRoot, stdio: 'inherit' });
		if (result.status !== 0) throw new Error('Corpus fetch failed');
	}

	const documents = loadCorpus(args.only, args.heavy);

	if (args.gt) {
		console.log('Generating ground-truth PDFs ...');
		for (const fixture of await generateGroundTruth()) {
			documents.push({
				id: fixture.id,
				kind: 'ground-truth',
				pdfPath: fixture.pdfPath,
				tags: ['ground-truth'],
				sizeClass: 'tiny',
				expectedGrid: fixture.expectedGrid,
			});
		}
	}

	ensureDir(resultsDir);
	const artifactDir = path.join(resultsDir, 'artifacts');
	ensureDir(artifactDir);

	const measured = [];
	for (const doc of documents) {
		console.log(`\n== ${doc.id} ==`);
		const result = await measureDocument(doc, tools, args, artifactDir);
		measured.push({ ...doc, measured: result });
	}

	const generatedAt = new Date().toISOString();
	const report = renderReport({ generatedAt, args, tools, documents: measured });
	const reportPath = path.join(resultsDir, `report-${generatedAt.replace(/[:.]/g, '-')}.md`);
	fs.writeFileSync(reportPath, report, 'utf8');

	console.log(`\nReport written to ${path.relative(repoRoot, reportPath)}`);
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
