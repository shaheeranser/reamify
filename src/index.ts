import { convertPages, convertPdf } from './convert.js';

export { convertPages, convertPdf };
export { mergeTableRegions, mergeTableRegionsWithReport, getLastMergeReport, headerBlockSignature } from './extract/index.js';
export { reconstructMultiLineHeaders, filterRepeatedHeaders, reconstructRegionHeaders } from './write/postprocess.js';

// Legacy exports retained for backward compatibility.
/** @deprecated Prefer the structured extraction path or `convertPdf` / `convertPages`. */
export { markdownToRows } from './legacy/parser.js';

// New IR types
export type {
	BBox,
	TableCell,
	TableRow,
	TableRegion,
	RegionSource,
	PageLayout,
	ConversionWarning,
	WarningKind,
	ConversionDiagnostics,
	OnWarning,
	WorksheetPolicy,
	ExtractionMode,
} from './types.js';

/** Public conversion and writer types exposed at the package entry point. */
export type { ConvertOptions, OnDiagnostics } from './convert.js';
export type { WorkbookResult } from './convert.js';
export type { ExtractedPage } from './legacy/engine.js';
export type { InspectorOptions } from './convert.js';
export type { PageRows, WorkbookOptions } from './write/index.js';

export const convert = convertPdf;