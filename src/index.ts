import { convertPages, convertPdf } from './convert.js';

export { convertPages, convertPdf };
export { mergeTableRegions, mergeTableRegionsWithReport, getLastMergeReport, headerBlockSignature } from './extract/index.js';
export { reconstructMultiLineHeaders, filterRepeatedHeaders, reconstructRegionHeaders } from './write/postprocess.js';

// Legacy exports (deprecated but preserved for backward compatibility)
/** @deprecated Use the layout engine path instead. */
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

// Pipeline and writer types
export type { ConvertOptions, OnDiagnostics } from './convert.js';
export type { WorkbookResult } from './convert.js';
export type { ExtractedPage } from './legacy/engine.js';
export type { InspectorOptions } from './convert.js';
export type { PageRows, WorkbookOptions } from './write/index.js';

export const convert = convertPdf;