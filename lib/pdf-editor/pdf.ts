import { StandardFonts, type PDFPage } from "pdf-lib";

import {
  buildCssFontStack,
  getCssFontFamily,
  inferFontTraits,
  normalizeCssFontFamily,
  resolveEffectiveFontStyle,
  resolveEffectiveFontWeight,
  resolvePdfFont,
} from "./fonts";
import type {
  FontCategory,
  OcrBlock,
  PreviewReplacement,
  RenderedPage,
  TextOverlay,
  WatermarkOverlay,
} from "./types";
import { clamp, loadImageElement, splitLines } from "./utils";

function rgbToHex(red: number, green: number, blue: number) {
  return `#${[red, green, blue]
    .map((value) => clamp(Math.round(value), 0, 255).toString(16).padStart(2, "0"))
    .join("")}`;
}

function colorDistance(
  left: [number, number, number],
  right: [number, number, number],
) {
  return Math.hypot(left[0] - right[0], left[1] - right[1], left[2] - right[2]);
}

export function sampleMaskColor(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  const margin = 2;
  const samplePoints = [
    [x - margin, y + height / 2],
    [x + width + margin, y + height / 2],
    [x + width / 2, y - margin],
    [x + width / 2, y + height + margin],
    [x - margin, y - margin],
    [x + width + margin, y - margin],
    [x - margin, y + height + margin],
    [x + width + margin, y + height + margin],
  ];
  let red = 0;
  let green = 0;
  let blue = 0;
  let alpha = 0;
  let count = 0;

  for (const [sampleX, sampleY] of samplePoints) {
    const px = Math.round(clamp(sampleX, 0, context.canvas.width - 1));
    const py = Math.round(clamp(sampleY, 0, context.canvas.height - 1));
    const data = context.getImageData(px, py, 1, 1).data;
    if (data[3] === 0) continue;
    red += data[0];
    green += data[1];
    blue += data[2];
    alpha += data[3];
    count += 1;
  }

  if (count === 0) return "#ffffff";

  return `rgba(${Math.round(red / count)}, ${Math.round(green / count)}, ${Math.round(blue / count)}, ${Math.max(alpha / count / 255, 0.96).toFixed(3)})`;
}

function sampleTextColor(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  const safeX = Math.round(clamp(x, 0, context.canvas.width - 1));
  const safeY = Math.round(clamp(y, 0, context.canvas.height - 1));
  const safeWidth = Math.max(
    1,
    Math.round(clamp(width, 1, Math.max(context.canvas.width - safeX, 1))),
  );
  const safeHeight = Math.max(
    1,
    Math.round(clamp(height, 1, Math.max(context.canvas.height - safeY, 1))),
  );
  const imageData = context.getImageData(safeX, safeY, safeWidth, safeHeight).data;
  const backgroundCss = sampleMaskColor(context, safeX, safeY, safeWidth, safeHeight);
  const backgroundMatch = backgroundCss.match(
    /rgba?\((\d+),\s*(\d+),\s*(\d+)/i,
  );
  const background: [number, number, number] = backgroundMatch
    ? [
        Number(backgroundMatch[1]),
        Number(backgroundMatch[2]),
        Number(backgroundMatch[3]),
      ]
    : [255, 255, 255];
  let red = 0;
  let green = 0;
  let blue = 0;
  let weightTotal = 0;
  let darkest: [number, number, number] = background;
  let darkestLuma = Number.POSITIVE_INFINITY;

  for (let offset = 0; offset < imageData.length; offset += 4) {
    const alpha = imageData[offset + 3];
    if (alpha < 32) continue;

    const pixel: [number, number, number] = [
      imageData[offset],
      imageData[offset + 1],
      imageData[offset + 2],
    ];
    const distance = colorDistance(pixel, background);
    const luma = pixel[0] * 0.299 + pixel[1] * 0.587 + pixel[2] * 0.114;

    if (luma < darkestLuma) {
      darkest = pixel;
      darkestLuma = luma;
    }

    if (distance < 26) continue;

    const weight = Math.max(distance, 1);
    red += pixel[0] * weight;
    green += pixel[1] * weight;
    blue += pixel[2] * weight;
    weightTotal += weight;
  }

  if (weightTotal > 0) {
    return rgbToHex(red / weightTotal, green / weightTotal, blue / weightTotal);
  }

  return rgbToHex(darkest[0], darkest[1], darkest[2]);
}

export async function loadPdfJs() {
  const pdfjsLib = await import("pdfjs-dist");
  const workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();
  pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;
  return pdfjsLib;
}

export async function renderPdfPages(pdfBytes: Uint8Array) {
  const pdfjsLib = await loadPdfJs();
  const previewScale = 1.4;
  const loadingTask = pdfjsLib.getDocument({ data: pdfBytes });
  const pdf = await loadingTask.promise;
  const pages: RenderedPage[] = [];

  for (let index = 1; index <= pdf.numPages; index += 1) {
    const page = await pdf.getPage(index);
    const baseViewport = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: previewScale });
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");

    if (!context) {
      throw new Error("Canvas rendering is not supported in this browser.");
    }

    canvas.width = viewport.width;
    canvas.height = viewport.height;

    await page.render({
      canvasContext: context,
      viewport,
    }).promise;

    const textContent = await page.getTextContent();
    const textBlocks = textContent.items
      .filter((item) => "str" in item && typeof item.str === "string" && item.str.trim().length > 0)
      .map((item, textIndex) => {
        const textItem = item as {
          str: string;
          width: number;
          height: number;
          transform: number[];
          fontName: string;
        };
        const styleMap = textContent.styles as Record<
          string,
          { fontFamily?: string; ascent?: number; descent?: number }
        >;
        const sourceStyle = styleMap[textItem.fontName] ?? {};
        const traits = inferFontTraits(textItem.fontName, sourceStyle.fontFamily);
        const resolvedFont = resolvePdfFont(page.commonObjs, textItem.fontName, sourceStyle.fontFamily);
        const transform = pdfjsLib.Util.transform(viewport.transform, textItem.transform);
        const width = Math.max(textItem.width * viewport.scale, 12);
        const fontHeight = Math.max(Math.abs(transform[3]), textItem.height * viewport.scale, 12);
        const x = transform[4];
        const y = transform[5] - fontHeight;
        const ascent =
          typeof sourceStyle.ascent === "number"
            ? clamp(sourceStyle.ascent, 0.55, 0.95)
            : 0.82;
        const textOffsetY = Math.max(fontHeight * (1 - ascent), 0);
        const fontSize = Math.max(fontHeight * 0.8, 12);
        const lineHeight = Math.max(fontHeight / Math.max(fontSize, 1), 1);

        const bold = resolvedFont?.bold ?? traits.bold;
        const italic = resolvedFont?.italic ?? traits.italic;

        return {
          id: `${index}-${textIndex}`,
          text: textItem.str,
          x,
          y,
          width,
          height: fontHeight,
          fontSize,
          fontFamily: resolvedFont?.fontFamily ?? traits.fontFamily,
          cssFontFamily:
            resolvedFont?.cssFontFamily ||
            buildCssFontStack(
              resolvedFont?.fontFamily ?? traits.fontFamily,
              normalizeCssFontFamily(sourceStyle.fontFamily),
            ),
          cssFontWeight: resolveEffectiveFontWeight(resolvedFont?.cssFontWeight, bold),
          cssFontStyle: resolveEffectiveFontStyle(resolvedFont?.cssFontStyle, italic),
          color: sampleTextColor(context, x, y, width, fontHeight),
          lineHeight,
          textOffsetY,
          bold,
          italic,
        };
      });

    pages.push({
      pdfWidth: baseViewport.width,
      pdfHeight: baseViewport.height,
      width: viewport.width,
      height: viewport.height,
      previewUrl: canvas.toDataURL("image/png"),
      textBlocks,
    });
  }

  return pages;
}

export async function renderPdfPageImages(
  pdfBytes: Uint8Array,
  pageIndices: number[],
  scale: number,
) {
  if (pageIndices.length === 0) {
    return new Map<number, { previewUrl: string; width: number; height: number }>();
  }

  const pdfjsLib = await loadPdfJs();
  const loadingTask = pdfjsLib.getDocument({ data: pdfBytes.slice() });
  const pdf = await loadingTask.promise;
  const renderedImages = new Map<number, { previewUrl: string; width: number; height: number }>();

  for (const pageIndex of pageIndices) {
    const page = await pdf.getPage(pageIndex + 1);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");

    if (!context) {
      throw new Error("Canvas rendering is not supported in this browser.");
    }

    canvas.width = viewport.width;
    canvas.height = viewport.height;

    await page.render({
      canvasContext: context,
      viewport,
    }).promise;

    renderedImages.set(pageIndex, {
      previewUrl: canvas.toDataURL("image/png"),
      width: viewport.width,
      height: viewport.height,
    });
  }

  await loadingTask.destroy();

  return renderedImages;
}

export async function buildPagePreview(
  page: RenderedPage,
  replacements: PreviewReplacement[],
  options?: {
    previewUrl?: string;
    width?: number;
    height?: number;
    coordinateScale?: number;
  },
) {
  if (replacements.length === 0) return page.previewUrl;

  if (typeof document !== "undefined" && "fonts" in document) {
    await document.fonts.ready;
  }

  const previewUrl = options?.previewUrl ?? page.previewUrl;
  const outputWidth = options?.width ?? page.width;
  const outputHeight = options?.height ?? page.height;
  const coordinateScale =
    options?.coordinateScale ?? outputWidth / Math.max(page.width, 1);
  const image = await loadImageElement(previewUrl);
  const sourceCanvas = document.createElement("canvas");
  const sourceContext = sourceCanvas.getContext("2d");
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");

  if (!sourceContext || !context) {
    return page.previewUrl;
  }

  sourceCanvas.width = outputWidth;
  sourceCanvas.height = outputHeight;
  canvas.width = outputWidth;
  canvas.height = outputHeight;

  sourceContext.drawImage(image, 0, 0, outputWidth, outputHeight);
  context.drawImage(image, 0, 0, outputWidth, outputHeight);

  for (const replacement of replacements) {
    const fontSize = replacement.fontSize * coordinateScale;
    const bleedX = Math.max(3 * coordinateScale, Math.min(fontSize * 0.2, 8 * coordinateScale));
    const bleedY = Math.max(4 * coordinateScale, Math.min(fontSize * 0.28, 10 * coordinateScale));
    const scaledX = replacement.x * coordinateScale;
    const scaledY = replacement.y * coordinateScale;
    const scaledWidth = replacement.width * coordinateScale;
    const scaledHeight = replacement.height * coordinateScale;
    const x = clamp(scaledX - bleedX, 0, outputWidth);
    const y = clamp(scaledY - bleedY, 0, outputHeight);
    const width = clamp(
      scaledWidth + bleedX * 2,
      0,
      Math.max(outputWidth - x, 0),
    );
    const height = clamp(
      scaledHeight + bleedY * 2,
      0,
      Math.max(outputHeight - y, 0),
    );

    if (width <= 0 || height <= 0) continue;

    context.fillStyle =
      replacement.backgroundColor || sampleMaskColor(sourceContext, x, y, width, height);
    context.fillRect(x, y, width, height);

    if (!replacement.renderText) continue;

    const lines = splitLines(replacement.text);
    const lineHeight = fontSize * replacement.lineHeight;
    const drawX = scaledX + replacement.paddingX * coordinateScale;
    const drawY =
      scaledY +
      (replacement.paddingY + replacement.textOffsetY) * coordinateScale;
    const styleToken =
      replacement.fontStyle !== "normal" ? replacement.fontStyle : "normal";
    context.fillStyle = replacement.color;
    context.textAlign = "left";
    context.textBaseline = "top";
    context.font = `${styleToken} ${replacement.fontWeight} ${fontSize}px ${replacement.fontFamily}`;

    lines.forEach((line, lineIndex) => {
      const currentY = drawY + lineIndex * lineHeight;
      context.fillText(line, drawX, currentY);

      if (replacement.underline) {
        const lineWidth = context.measureText(line).width;
        const underlineY = currentY + fontSize * 1.05;
        context.lineWidth = Math.max(fontSize * 0.055, coordinateScale);
        context.beginPath();
        context.moveTo(drawX, underlineY);
        context.lineTo(drawX + lineWidth, underlineY);
        context.strokeStyle = replacement.color;
        context.stroke();
      }

      if (replacement.strike) {
        const lineWidth = context.measureText(line).width;
        const strikeY = currentY + fontSize * 0.58;
        context.lineWidth = Math.max(fontSize * 0.055, coordinateScale);
        context.beginPath();
        context.moveTo(drawX, strikeY);
        context.lineTo(drawX + lineWidth, strikeY);
        context.strokeStyle = replacement.color;
        context.stroke();
      }
    });
  }

  return canvas.toDataURL("image/png");
}

export function getFontFamily(overlay: TextOverlay | WatermarkOverlay) {
  if (overlay.kind === "watermark") return StandardFonts.HelveticaBold;
  if (overlay.fontFamily === "mono") {
    if (overlay.bold && overlay.italic) return StandardFonts.CourierBoldOblique;
    if (overlay.bold) return StandardFonts.CourierBold;
    if (overlay.italic) return StandardFonts.CourierOblique;
    return StandardFonts.Courier;
  }
  if (overlay.fontFamily === "sans") {
    if (overlay.bold && overlay.italic) return StandardFonts.HelveticaBoldOblique;
    if (overlay.bold) return StandardFonts.HelveticaBold;
    if (overlay.italic) return StandardFonts.HelveticaOblique;
    return StandardFonts.Helvetica;
  }
  if (overlay.bold && overlay.italic) return StandardFonts.TimesRomanBoldItalic;
  if (overlay.bold) return StandardFonts.TimesRomanBold;
  if (overlay.italic) return StandardFonts.TimesRomanItalic;
  return StandardFonts.TimesRoman;
}

export function pageToPdfY(page: PDFPage, y: number, height: number) {
  return page.getHeight() - y - height;
}

export function buildOcrTextBlocks(
  ocrBlocks: OcrBlock[],
  pageIndex: number,
) {
  return ocrBlocks.flatMap((block, blockIndex) =>
    block.paragraphs.flatMap((paragraph, paragraphIndex) =>
      paragraph.lines
        .filter((line) => line.text.trim().length > 0)
        .map((line, lineIndex) => ({
          id: `ocr-${pageIndex}-${blockIndex}-${paragraphIndex}-${lineIndex}`,
          text: line.text.trim(),
          x: line.bbox.x0,
          y: line.bbox.y0,
          width: Math.max(line.bbox.x1 - line.bbox.x0, 12),
          height: Math.max(line.bbox.y1 - line.bbox.y0, 12),
          fontSize: Math.max(line.bbox.y1 - line.bbox.y0, 12),
          fontFamily: "serif" as FontCategory,
          cssFontFamily: getCssFontFamily("serif"),
          cssFontWeight: 400,
          cssFontStyle: "normal",
          color: "#111827",
          lineHeight: 1.12,
          textOffsetY: 0,
          bold: false,
          italic: false,
        })),
    ),
  );
}
