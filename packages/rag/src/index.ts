// RAG 파이프라인 공개 API (Phase 1-1)
export { parseDocument, parsePdf, parseMarkdown, parsePlainText } from './chunker.js';
export type { TextChunk, ParseResult, SourceType } from './chunker.js';

export {
	embedText,
	embedBatch,
	embedBatchWithProvider,
	EMBEDDING_MODEL,
	EMBEDDING_DIMENSIONS,
} from './embedder.js';
export type { EmbeddingProvider } from './embedder.js';

export { searchSimilarChunks, formatSearchResultsAsContext } from './search.js';
export type { SearchOptions, SearchResult } from './search.js';

export { ingestDocument } from './pipeline.js';
export type { IngestOptions, IngestResult } from './pipeline.js';
