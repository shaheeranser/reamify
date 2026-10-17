/**
 * Download the curated corpus into eval/corpus and record a manifest with
 * checksums and basic shape (pages, text tokens, scanned heuristic).
 *
 * Usage:
 *   node scripts/eval/fetch-corpus.mjs [--heavy] [--force] [--only=id1,id2] [--no-stats]
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
	corpusDir,
	ensureDir,
	ensureSandbox,
	repoRoot,
} from './sandbox.mjs';
import { pdfTextTokens } from './metrics.mjs';

function parseArgs(argv) {
	const options = { heavy: false, force: false, only: null, stats: true };
	for (const arg of argv) {
		if (arg === '--heavy') options.heavy = true;
		else if (arg === '--force') options.force = true;
		else if (arg === '--no-stats') options.stats = false;
		else if (arg.startsWith('--only=')) options.only = new Set(arg.slice('--only='.length).split(','));
	}
	return options;
}

function sha256(buffer) {
	return crypto.createHash('sha256').update(buffer).digest('hex');
}

async function download(url) {
	const response = await fetch(url, { redirect: 'follow' });
	if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
	return Buffer.from(await response.arrayBuffer());
}

async function main() {
	const options = parseArgs(process.argv.slice(2));
	const corpus = JSON.parse(fs.readFileSync(new URL('./corpus.json', import.meta.url), 'utf8'));

	const selected = corpus.documents.filter((doc) => {
		if (options.only && !options.only.has(doc.id)) return false;
		if (doc.heavy && !options.heavy) return false;
		return true;
	});

	if (selected.length === 0) {
		console.log('No documents selected.');
		return;
	}

	ensureDir(corpusDir);
	const manifestPath = path.join(corpusDir, 'manifest.json');
	const previous = fs.existsSync(manifestPath)
		? JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
		: { documents: [] };
	const previousById = new Map(previous.documents.map((doc) => [doc.id, doc]));

	if (options.stats) ensureSandbox();

	const manifest = { fetchedAt: new Date().toISOString(), documents: [] };

	for (const doc of selected) {
		const targetPath = doc.localPath
			? path.join(repoRoot, doc.localPath)
			: path.join(corpusDir, `${doc.id}.pdf`);

		let buffer;
		let downloaded = false;

		if (doc.localPath) {
			if (!fs.existsSync(targetPath)) {
				console.log(`SKIP ${doc.id} (local file missing: ${doc.localPath})`);
				continue;
			}
			buffer = fs.readFileSync(targetPath);
		} else {
			const prior = previousById.get(doc.id);
			if (!options.force && fs.existsSync(targetPath) && prior?.sha256 === sha256(fs.readFileSync(targetPath))) {
				buffer = fs.readFileSync(targetPath);
			} else {
				process.stdout.write(`GET  ${doc.id} ... `);
				buffer = await download(doc.url);
				fs.writeFileSync(targetPath, buffer);
				downloaded = true;
				process.stdout.write(`${(buffer.length / 1024).toFixed(0)} KiB\n`);
			}
		}

		const entry = {
			id: doc.id,
			path: path.relative(repoRoot, targetPath),
			sha256: sha256(buffer),
			bytes: buffer.length,
			tags: doc.tags,
			sizeClass: doc.sizeClass,
			source: doc.url ?? `local:${doc.localPath}`,
			downloaded,
		};

		if (options.stats) {
			try {
				const { tokens, numPages } = await pdfTextTokens(buffer);
				entry.pages = numPages;
				entry.textTokens = tokens.length;
				entry.scanned = numPages > 0 && tokens.length / numPages < 2;
			} catch (error) {
				entry.statsError = String(error?.message ?? error);
			}
		}

		if (previousById.get(doc.id)?.sha256 && previousById.get(doc.id).sha256 !== entry.sha256 && !downloaded) {
			console.warn(`WARN ${doc.id} content changed on disk vs manifest`);
		}

		manifest.documents.push(entry);
		console.log(
			`OK   ${doc.id.padEnd(24)} ${(buffer.length / 1024).toFixed(0).padStart(7)} KiB` +
				(entry.pages ? `  ${String(entry.pages).padStart(4)} pages` : '') +
				(entry.textTokens !== undefined ? `  ${String(entry.textTokens).padStart(7)} tokens` : '') +
				(entry.scanned ? '  [SCANNED?]' : ''),
		);
	}

	fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
	console.log(`\nWrote ${path.relative(repoRoot, manifestPath)} (${manifest.documents.length} documents)`);
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
