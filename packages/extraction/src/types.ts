export interface ExtractionResult {
    text: string;
    pageCount?: number;
}

export type Extractor = (
    buffer: Buffer
) => Promise<ExtractionResult>;