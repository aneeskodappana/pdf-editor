import { rgb } from "pdf-lib";

import { FONT_SIZES, TEXT_BOX_PADDING, TEXT_LINE_HEIGHTS } from "./constants";
import { resolveEffectiveFontStyle, resolveEffectiveFontWeight } from "./fonts";
import type { Overlay, TextOverlay, TextVariant } from "./types";

export function makeId() {
  return Math.random().toString(36).slice(2, 10);
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function hexToRgb(hex: string) {
  const normalized = hex.replace("#", "");
  const safe = normalized.length === 3
    ? normalized
        .split("")
        .map((chunk) => `${chunk}${chunk}`)
        .join("")
    : normalized;

  const parsed = Number.parseInt(safe, 16);
  return rgb(
    ((parsed >> 16) & 255) / 255,
    ((parsed >> 8) & 255) / 255,
    (parsed & 255) / 255,
  );
}

export function dataUrlToBytes(dataUrl: string) {
  const base64 = dataUrl.split(",")[1] ?? "";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

export function fontSizeToVariant(fontSize: number): TextVariant {
  if (fontSize >= FONT_SIZES.h1 - 4) return "h1";
  if (fontSize >= FONT_SIZES.h2 - 4) return "h2";
  if (fontSize >= FONT_SIZES.h3 - 4) return "h3";
  if (fontSize >= FONT_SIZES.h4 - 2) return "h4";
  if (fontSize >= FONT_SIZES.h5 - 2) return "h5";
  return "p";
}

export function isListItemText(text: string) {
  return /^\s*(?:[-*+•◦▪‣▸]|(?:\d+|[A-Za-z]|[ivxlcdmIVXLCDM]+)[.)])\s+/.test(text);
}

export function inferTextVariant(text: string, fontSize: number): TextVariant {
  if (isListItemText(text)) return "li";
  return fontSizeToVariant(fontSize);
}

export function splitLines(text: string) {
  return text
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line, index, lines) => line.length > 0 || index < lines.length - 1);
}

export function estimateTextBoxSize(
  text: string,
  fontSize: number,
  paddingX = TEXT_BOX_PADDING,
  paddingY = TEXT_BOX_PADDING,
  lineHeight = TEXT_LINE_HEIGHTS.p,
) {
  const lines = splitLines(text);
  const longestLine = lines.reduce(
    (longest, line) => Math.max(longest, line.length),
    0,
  );

  return {
    width: Math.max(
      56,
      Math.ceil(longestLine * fontSize * 0.56 + paddingX * 2),
    ),
    height: Math.max(
      fontSize + paddingY * 2,
      Math.ceil(lines.length * fontSize * lineHeight + paddingY * 2),
    ),
  };
}

export function getTextVariantMetrics(variant: TextVariant) {
  return {
    fontSize: FONT_SIZES[variant],
    lineHeight: TEXT_LINE_HEIGHTS[variant],
  };
}

export function normalizeTextOverlayFormatting(overlay: TextOverlay): TextOverlay {
  const cssFontWeight = resolveEffectiveFontWeight(overlay.cssFontWeight, overlay.bold);
  const cssFontStyle = resolveEffectiveFontStyle(overlay.cssFontStyle, overlay.italic);

  return {
    ...overlay,
    cssFontWeight,
    cssFontStyle,
    bold: cssFontWeight >= 600,
    italic: cssFontStyle !== "normal",
  };
}

export function overlayLabel(overlay: Overlay) {
  switch (overlay.kind) {
    case "text":
      return overlay.text.slice(0, 24) || "Text block";
    case "image":
      return overlay.label || "Image";
    case "mask":
      return "Mask";
    case "watermark":
      return overlay.text.slice(0, 24) || "Watermark";
    default:
      return "Overlay";
  }
}

export function loadImageElement(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Unable to load image."));
    image.src = src;
  });
}

export async function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export async function getImageDimensions(dataUrl: string) {
  const image = await loadImageElement(dataUrl);
  return {
    width: image.naturalWidth || image.width || 1,
    height: image.naturalHeight || image.height || 1,
  };
}

export function fitImageSize(
  width: number,
  height: number,
  maxWidth: number,
  maxHeight: number,
) {
  const safeWidth = Math.max(width, 1);
  const safeHeight = Math.max(height, 1);
  const ratio = Math.min(maxWidth / safeWidth, maxHeight / safeHeight, 1);

  return {
    width: Math.max(Math.round(safeWidth * ratio), 40),
    height: Math.max(Math.round(safeHeight * ratio), 24),
  };
}
