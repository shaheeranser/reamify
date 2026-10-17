/**
 * Shared paths and helpers for the comparison harness.
 *
 * Third-party evaluation dependencies (the `pdf-to-excel` library under test
 * and `pdfkit` for generating ground-truth PDFs) are installed into an
 * isolated sandbox under `eval/harness/` so they never become dependencies of
 * the published package.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export const repoRoot = path.resolve(here, '..', '..');
export const evalDir = path.join(repoRoot, 'eval');
export const corpusDir = path.join(evalDir, 'corpus');
export const groundTruthDir = path.join(evalDir, 'ground-truth');
export const resultsDir = path.join(evalDir, 'results');
export const sandboxDir = path.join(evalDir, 'harness');
export const sandboxPackageJson = path.join(sandboxDir, 'package.json');
export const reamifyDistEntry = path.join(repoRoot, 'dist', 'index.js');

/** Pinned evaluation-only dependencies. */
const SANDBOX_DEPENDENCIES = ['pdf-to-excel@0.3.2', 'pdfkit@0.15.0', 'pdfjs-dist@2.2.228'];

export function ensureDir(dir) {
	fs.mkdirSync(dir, { recursive: true });
}

/** Require a module from the sandbox's own node_modules. */
export function sandboxRequire(name) {
	const require = createRequire(sandboxPackageJson);
	return require(name);
}

/** Create the sandbox and install evaluation dependencies once. */
export function ensureSandbox({ force = false } = {}) {
	ensureDir(sandboxDir);

	if (!fs.existsSync(sandboxPackageJson)) {
		fs.writeFileSync(
			sandboxPackageJson,
			`${JSON.stringify({
				name: 'reamify-eval-harness',
				version: '0.0.0',
				private: true,
				type: 'module',
			}, null, 2)}\n`,
			'utf8',
		);
	}

	const marker = path.join(sandboxDir, '.installed');
	if (!force && fs.existsSync(marker)) return;

	const result = spawnSync(
		'npm',
		['install', '--prefix', sandboxDir, '--no-audit', '--no-fund', ...SANDBOX_DEPENDENCIES],
		{ cwd: sandboxDir, stdio: 'inherit' },
	);

	if (result.status !== 0) {
		throw new Error('Failed to install evaluation sandbox dependencies');
	}

	fs.writeFileSync(marker, `${new Date().toISOString()}\n`, 'utf8');
}

/** Build the local package so the dist entry point is current. */
export function buildLocalPackage() {
	const result = spawnSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' });
	if (result.status !== 0) throw new Error('Local package build failed');
}
