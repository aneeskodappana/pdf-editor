export type RenderedPage = {
  pdfWidth: number;
  pdfHeight: number;
  width: number;
  height: number;
  previewUrl: string;
  textBlocks: SourceTextBlock[];
  sourceImages: SourceImage[];
};

export type SourceImage = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  dataUrl: string;
};

export type SourceTextBlock = {
  id: string;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  fontFamily: FontCategory;
  cssFontFamily?: string;
  cssFontWeight?: number;
  cssFontStyle?: string;
  color: string;
  lineHeight: number;
  textOffsetY: number;
  bold: boolean;
  italic: boolean;
};

export type TextVariant = "p" | "li" | "h1" | "h2" | "h3" | "h4" | "h5";
export type FontCategory = "serif" | "sans" | "mono";

export type BaseOverlay = {
  id: string;
  pageIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type TextOverlay = BaseOverlay & {
  kind: "text";
  text: string;
  variant: TextVariant;
  fontFamily: FontCategory;
  fontSize: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  color: string;
  backgroundColor?: string;
  sourceTextId?: string;
  maskWidth?: number;
  maskHeight?: number;
  maskOffsetX?: number;
  maskOffsetY?: number;
  paddingX?: number;
  paddingY?: number;
  cssFontFamily?: string;
  cssFontWeight?: number;
  cssFontStyle?: string;
  lineHeight: number;
  textOffsetY: number;
};

export type ImageOverlay = BaseOverlay & {
  kind: "image";
  dataUrl: string;
  label: string;
  aspectRatio: number;
  opacity: number;
};

export type MaskOverlay = BaseOverlay & {
  kind: "mask";
  color: string;
};

export type WatermarkOverlay = BaseOverlay & {
  kind: "watermark";
  text: string;
  opacity: number;
  rotation: number;
  color: string;
  variant: TextVariant;
};

export type Overlay = TextOverlay | ImageOverlay | MaskOverlay | WatermarkOverlay;

export type OcrBBox = {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
};

export type OcrLine = {
  text: string;
  bbox: OcrBBox;
};

export type OcrParagraph = {
  lines: OcrLine[];
};

export type OcrBlock = {
  paragraphs: OcrParagraph[];
};

export type PreviewMask = {
  x: number;
  y: number;
  width: number;
  height: number;
  backgroundColor?: string;
};

export type PreviewReplacement = PreviewMask & {
  id: string;
  text: string;
  color: string;
  fontSize: number;
  fontFamily: string;
  fontWeight: number;
  fontStyle: string;
  underline: boolean;
  strike: boolean;
  paddingX: number;
  paddingY: number;
  lineHeight: number;
  textOffsetY: number;
  renderText: boolean;
};
