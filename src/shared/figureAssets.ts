export interface FigureAssetExportItem {
  fileName: string;
  contentBase64: string;
  pageNumber: number;
  figureLabel?: string;
  caption: string;
  assetType?: 'figure' | 'table';
  extractionMethod?: 'native-image' | 'native-image-composite' | 'page-crop';
  pixelWidth?: number;
  pixelHeight?: number;
  cropBox?: {
    x: number;
    y: number;
    width: number;
    height: number;
    pageWidth: number;
    pageHeight: number;
  };
}

export interface FigureAssetsExportRequest {
  defaultDirectoryName: string;
  paperTitle: string;
  figures: FigureAssetExportItem[];
}

export interface FigureAssetsExportResult {
  directoryPath: string;
  fileCount: number;
  metadataPath: string;
}
