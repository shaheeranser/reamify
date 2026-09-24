/**
 * Layout-preserving intermediate representation for PDF table extraction.
 *
 * These types are geometry-driven and document-agnostic. No type encodes
 * assumptions about a specific PDF's column count, region layout, or
 * content patterns. Region discovery, row clustering, and column inference
 * are all derived from positioned text coordinates.
 */

/** Bounding box in PDF points, top-left origin: [x1, y1, x2, y2]. */
export type BBox = [number, number, number, number];

export interface TableCell {
	/** Cell text content (never split on whitespace by the library). */
	text: string;
	/** Bounding box of the cell in page PDF points, top-left origin. */
	bbox: BBox;
	/** Column index within the region's column model (0-based). */
	column: number;
	/** Number of rows this cell spans (1 unless from a structured-cell source). */
	rowspan: number;
	/** Number of columns this cell spans (1 unless from a structured-cell source). */
	colspan: number;
	/** Whether this cell is a header cell. */
	isHeader: boolean;
	/** Reconstruction confidence in [0, 1]. */
	confidence: number;
	/** True when reconstruction could not be verified. */
	ambiguous: boolean;
}

export interface TableRow {
	/** Row index within the region (0-based). */
	index: number;
	/** Whether this entire row is a header row. */
	isHeader: boolean;
	/** Cells in this row, ordered by column index. */
	cells: TableCell[];
}

/** How the region's table structure was determined. */
export type RegionSource = 'vector-grid-cells' | 'region-tables' | 'clustered';

export interface TableRegion {
	/** Region identifier, stable within the page (0 = leftmost). */
	id: number;
	/** 0-indexed source page number. */
	page: number;
	/** Bounding box of the region in page PDF points, top-left origin. */
	bbox: BBox;
	/** Which extraction tier produced this region. */
	source: RegionSource;
	/** Rows in this region, ordered by row index. */
	rows: TableRow[];
}

export interface PageLayout {
	/** 0-indexed source page number. */
	page: number;
	/** Table regions discovered on this page, ordered left-to-right. */
	regions: TableRegion[];
	/** Heading text above table regions (bold titles, etc.). */
	titles: Array<{ text: string; bbox: BBox; isBold: boolean }>;
	/**
	 * Non-table text on the page. Includes trailing numeric lines and
	 * other content that doesn't belong to a pipe-table grammar.
	 * `assigned: true` means the text was associated with a region;
	 * `assigned: false` means it could not be placed.
	 */
	outsideText: Array<{ text: string; bbox: BBox; assigned: boolean }>;
	/** Whether OCR is needed for reliable text extraction. */
	needsOcr: boolean;
	/** Machine-readable reason when OCR is needed. */
	ocrReason?: string;
}

/** Warnings emitted during extraction and conversion. */

export type WarningKind =
	| 'ambiguous-cell'
	| 'unassigned-text'
	| 'needs-ocr'
	| 'region-count-unstable'
	| 'tier-fallback';

export interface ConversionWarning {
	kind: WarningKind;
	page: number;
	message: string;
	/** Region ID when the warning is region-specific. */
	regionId?: number;
}

export type OnWarning = (warning: ConversionWarning) => void;

export interface ConversionDiagnostics {
	totalPages: number;
	totalRegions: number;
	totalRows: number;
	totalWarnings: number;
	ambiguousCells: number;
	unassignedTextItems: number;
	ocrPages: number;
	/** Counts of regions produced by each extraction tier. */
	tierCounts: Record<RegionSource, number>;
}

/**
 * Worksheet layout policy:
 * - `'per-region'`: one sheet per region slot (default when region count
 *    is stable across pages).
 * - `'stacked'`: single sheet; regions stacked vertically with separators.
 * - `'auto'`: choose per-region when stable, stacked otherwise.
 */
export type WorksheetPolicy = 'per-region' | 'stacked' | 'auto';

/**
 * Extraction mode:
 * - `'auto'`: three-tier layout engine (default).
 * - `'positions'`: force Tier C (positioned-item clustering only).
 * - `'markdown-legacy'`: use the original markdownToRows path.
 */
export type ExtractionMode = 'auto' | 'positions' | 'markdown-legacy';
