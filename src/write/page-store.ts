import type { PageLayout } from '../types.js';

/**
 * Default in-memory budget for a page stream before it spills to disk.
 * Small documents never touch disk; large ones are capped here so peak
 * memory stays bounded by one page plus this budget.
 */
export const DEFAULT_SPILL_THRESHOLD_BYTES = 32 * 1024 * 1024;

export interface PageStoreOptions {
	/** Bytes of serialized pages to keep in memory before spilling. */
	thresholdBytes?: number;
	/** Directory for the spill file. Defaults to the OS temp directory. */
	directory?: string;
}

type FileHandle = import('node:fs/promises').FileHandle;

/**
 * Append-only store for a stream of `PageLayout`s. Pages are serialized on
 * write and deserialized on read, so callers always receive independent
 * objects and a single stored page is never mutated by later passes.
 *
 * While the serialized stream stays under `thresholdBytes` it lives in
 * memory. The first page that would exceed the budget triggers a lazy spill
 * to a temp file (dynamic `node:fs` import, so browser bundles that only use
 * `convertPages` never pull Node built-ins). The file is deleted by
 * `dispose()`.
 */
export class PageStore {
	private readonly threshold: number;
	private readonly directory?: string;
	private memory: string[] = [];
	private bytes = 0;
	private filePath: string | null = null;
	private handle: FileHandle | null = null;

	constructor(options: PageStoreOptions = {}) {
		this.threshold = options.thresholdBytes ?? DEFAULT_SPILL_THRESHOLD_BYTES;
		this.directory = options.directory;
	}

	/** True once the stream has been persisted to a temp file. */
	get spilled(): boolean {
		return this.filePath !== null;
	}

	async add(layout: PageLayout): Promise<void> {
		const line = `${JSON.stringify(layout)}\n`;

		if (this.handle) {
			await this.handle.write(line);
			return;
		}

		if (this.bytes + line.length <= this.threshold) {
			this.memory.push(line);
			this.bytes += line.length;
			return;
		}

		await this.spill(line);
	}

	private async spill(firstLine: string): Promise<void> {
		const fs = await import('node:fs/promises');
		const os = await import('node:os');
		const path = await import('node:path');

		const directory = this.directory ?? os.tmpdir();
		this.filePath = path.join(
			directory,
			`reamify-pages-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`,
		);
		this.handle = await fs.open(this.filePath, 'w');

		for (const line of this.memory) {
			await this.handle.write(line);
		}
		this.memory = [];
		this.bytes = 0;

		await this.handle.write(firstLine);
	}

	async *pages(): AsyncGenerator<PageLayout> {
		if (!this.filePath) {
			for (const line of this.memory) {
				yield JSON.parse(line) as PageLayout;
			}
			return;
		}

		const fs = await import('node:fs/promises');
		const { StringDecoder } = await import('node:string_decoder');

		const handle = await fs.open(this.filePath, 'r');
		const decoder = new StringDecoder('utf8');
		const buffer = Buffer.allocUnsafe(1 << 20);
		let pending = '';

		try {
			for (;;) {
				const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
				if (bytesRead === 0) break;

				pending += decoder.write(buffer.subarray(0, bytesRead));

				let newline = pending.indexOf('\n');
				while (newline >= 0) {
					const line = pending.slice(0, newline);
					pending = pending.slice(newline + 1);
					if (line.length > 0) yield JSON.parse(line) as PageLayout;
					newline = pending.indexOf('\n');
				}
			}

			pending += decoder.end();
			if (pending.length > 0) yield JSON.parse(pending) as PageLayout;
		} finally {
			await handle.close();
		}
	}

	async dispose(): Promise<void> {
		if (this.handle) {
			await this.handle.close();
			this.handle = null;
		}

		if (this.filePath) {
			const filePath = this.filePath;
			this.filePath = null;
			try {
				const fs = await import('node:fs/promises');
				await fs.unlink(filePath);
			} catch {
				// Best-effort cleanup: never mask the conversion result.
			}
		}

		this.memory = [];
		this.bytes = 0;
	}
}
