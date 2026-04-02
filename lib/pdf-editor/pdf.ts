import {
  PDFArray,
  PDFDict,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  StandardFonts,
  type PDFDocument,
  type PDFPage,
} from "pdf-lib";

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
  SourceImage,
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
  const margin = 6;
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

  // Collect all valid sampled pixel colors
  const samples: [number, number, number][] = [];

  for (const [sampleX, sampleY] of samplePoints) {
    const px = Math.round(clamp(sampleX, 0, context.canvas.width - 1));
    const py = Math.round(clamp(sampleY, 0, context.canvas.height - 1));
    const data = context.getImageData(px, py, 1, 1).data;
    if (data[3] === 0) continue;
    samples.push([data[0], data[1], data[2]]);
  }

  if (samples.length === 0) return "#ffffff";

  // Pick the LIGHTEST sample — most likely to be actual background
  // rather than text or other content near the edges
  let best = samples[0];
  let bestLuma = best[0] * 0.299 + best[1] * 0.587 + best[2] * 0.114;

  for (let i = 1; i < samples.length; i++) {
    const luma =
      samples[i][0] * 0.299 + samples[i][1] * 0.587 + samples[i][2] * 0.114;
    if (luma > bestLuma) {
      best = samples[i];
      bestLuma = luma;
    }
  }

  return rgbToHex(best[0], best[1], best[2]);
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
  const backgroundHex = sampleMaskColor(context, safeX, safeY, safeWidth, safeHeight);
  const hexMatch = backgroundHex.match(/^#([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
  const background: [number, number, number] = hexMatch
    ? [
        parseInt(hexMatch[1], 16),
        parseInt(hexMatch[2], 16),
        parseInt(hexMatch[3], 16),
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

// ---------------------------------------------------------------------------
// Direct PDF text replacement via content stream manipulation
// ---------------------------------------------------------------------------

async function inflateBytes(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream("deflate");
  const blob = new Blob([data.slice().buffer]);
  const stream = blob.stream().pipeThrough(ds);
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

async function deflateBytes(data: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream("deflate");
  const blob = new Blob([data.slice().buffer]);
  const stream = blob.stream().pipeThrough(cs);
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

/** Encode a JS string to bytes suitable for a PDF literal string body. */
function toPdfStringBytes(text: string): Uint8Array {
  const parts: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    if (ch === 0x28 /* ( */) {
      parts.push(0x5c, 0x28);
    } else if (ch === 0x29 /* ) */) {
      parts.push(0x5c, 0x29);
    } else if (ch === 0x5c /* \ */) {
      parts.push(0x5c, 0x5c);
    } else {
      parts.push(ch & 0xff);
    }
  }
  return new Uint8Array(parts);
}

/**
 * Search for a PDF literal string `(text)` inside raw content-stream bytes,
 * handling escape sequences. Returns the start index & length of the full
 * `(…)` token (including parens) or null.
 */
function findPdfLiteralString(
  haystack: Uint8Array,
  needle: Uint8Array,
  startFrom = 0,
): { start: number; length: number } | null {
  for (let i = startFrom; i < haystack.length; i++) {
    if (haystack[i] !== 0x28 /* ( */) continue;

    // Walk the literal-string body respecting escapes & nested parens
    let depth = 1;
    let j = i + 1;
    let matched = true;
    let needleIdx = 0;

    while (j < haystack.length && depth > 0) {
      const b = haystack[j];
      if (b === 0x5c /* \ */) {
        // Escaped pair — compare the escaped char
        j++;
        if (j >= haystack.length) break;
        const escaped = haystack[j];
        // Map escape to actual byte for comparison
        let actual: number;
        if (escaped === 0x6e) actual = 0x0a; // \n
        else if (escaped === 0x72) actual = 0x0d; // \r
        else if (escaped === 0x74) actual = 0x09; // \t
        else actual = escaped; // \(  \)  \\  and others

        if (matched && needleIdx < needle.length) {
          if (needle[needleIdx] === 0x5c && needleIdx + 1 < needle.length) {
            // needle also has an escape
            matched = needle[needleIdx + 1] === escaped;
            needleIdx += 2;
          } else {
            matched = needle[needleIdx] === actual;
            needleIdx += 1;
          }
        } else if (needleIdx >= needle.length) {
          matched = false;
        }
        j++;
        continue;
      }
      if (b === 0x28) {
        depth++;
      } else if (b === 0x29) {
        depth--;
        if (depth === 0) break;
      }
      if (depth > 0) {
        if (matched && needleIdx < needle.length) {
          matched = needle[needleIdx] === b;
          needleIdx++;
        } else if (needleIdx >= needle.length) {
          matched = false;
        }
      }
      j++;
    }

    if (depth === 0 && matched && needleIdx === needle.length) {
      return { start: i, length: j - i + 1 }; // +1 for closing ')'
    }
  }
  return null;
}

/**
 * Replace text directly in a PDF's content streams.
 * Returns the set of replacement keys (overlay IDs) that were handled.
 */
export async function replaceTextInPdf(
  pdfDoc: PDFDocument,
  targetPageIndex: number,
  replacements: { id: string; oldText: string; newText: string }[],
): Promise<Set<string>> {
  const handled = new Set<string>();
  if (replacements.length === 0) return handled;

  const context = pdfDoc.context;

  try {
    const page = pdfDoc.getPage(targetPageIndex);
    const contentsEntry = page.node.get(PDFName.of("Contents"));
    if (!contentsEntry) return handled;

    // Collect stream references
    const streamRefs: PDFRef[] = [];
    if (contentsEntry instanceof PDFRef) {
      streamRefs.push(contentsEntry);
    } else if (contentsEntry instanceof PDFArray) {
      for (let i = 0; i < contentsEntry.size(); i++) {
        const entry = contentsEntry.get(i);
        if (entry instanceof PDFRef) streamRefs.push(entry);
      }
    }

    // Build a work-list of text we still need to replace
    const pending = replacements.map((r) => ({
      ...r,
      needleBytes: toPdfStringBytes(r.oldText),
      replacementBytes: toPdfStringBytes(r.newText),
    }));

    for (const ref of streamRefs) {
      if (pending.every((p) => handled.has(p.id))) break;

      const streamObj = context.lookup(ref);
      if (
        !streamObj ||
        !(streamObj instanceof PDFRawStream || (streamObj as { dict?: unknown }).dict)
      )
        continue;

      const rawStream = streamObj as PDFRawStream;
      const dict = rawStream.dict as PDFDict;

      // Decode the stream content
      const rawBytes: Uint8Array =
        typeof rawStream.getContents === "function"
          ? rawStream.getContents()
          : (rawStream as unknown as { contents: Uint8Array }).contents;

      const filterValue = dict.get(PDFName.of("Filter"));
      const isFlate =
        filterValue !== undefined &&
        (filterValue.toString().includes("FlateDecode") ||
          (filterValue instanceof PDFName &&
            filterValue.decodeText().includes("FlateDecode")));

      let contentBytes: Uint8Array;
      try {
        contentBytes = isFlate ? await inflateBytes(rawBytes) : new Uint8Array(rawBytes);
      } catch {
        continue;
      }

      let modified = false;

      for (const rep of pending) {
        if (handled.has(rep.id)) continue;

        const found = findPdfLiteralString(contentBytes, rep.needleBytes);
        if (!found) continue;

        // Build replacement: `(replacementText)`
        const newToken = new Uint8Array(rep.replacementBytes.length + 2);
        newToken[0] = 0x28; // (
        newToken.set(rep.replacementBytes, 1);
        newToken[newToken.length - 1] = 0x29; // )

        // Splice the bytes
        const before = contentBytes.slice(0, found.start);
        const after = contentBytes.slice(found.start + found.length);
        const result = new Uint8Array(before.length + newToken.length + after.length);
        result.set(before, 0);
        result.set(newToken, before.length);
        result.set(after, before.length + newToken.length);
        contentBytes = result;

        handled.add(rep.id);
        modified = true;
      }

      if (!modified) continue;

      // Re-encode and replace the stream object
      const finalBytes = isFlate ? await deflateBytes(contentBytes) : contentBytes;

      const newDict = PDFDict.withContext(context);
      // Copy existing dictionary entries, updating Length
      for (const [key, val] of dict.entries()) {
        if (key === PDFName.of("Length")) {
          newDict.set(key, PDFNumber.of(finalBytes.length));
        } else {
          newDict.set(key, val);
        }
      }
      if (!newDict.has(PDFName.of("Length"))) {
        newDict.set(PDFName.of("Length"), PDFNumber.of(finalBytes.length));
      }

      const newStream = PDFRawStream.of(newDict, finalBytes);
      context.assign(ref, newStream);
    }
  } catch (error) {
    console.warn("Direct text replacement failed:", error);
  }

  return handled;
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

async function extractPageImages(
  page: { getOperatorList: () => Promise<{ fnArray: number[]; argsArray: unknown[][] }>; objs: { get: (name: string) => unknown }; commonObjs: { get: (name: string) => unknown } },
  viewport: { transform: number[]; width: number; height: number },
  pdfjsLib: { OPS: Record<string, number>; Util: { transform: (a: number[], b: number[]) => number[] } },
  pageIndex: number,
): Promise<SourceImage[]> {
  const images: SourceImage[] = [];

  try {
    const ops = await page.getOperatorList();
    const OPS = pdfjsLib.OPS;

    // Walk through operations looking for transforms followed by image paints
    let currentTransform = viewport.transform;
    const transformStack: number[][] = [currentTransform];

    for (let i = 0; i < ops.fnArray.length; i++) {
      const fn = ops.fnArray[i];
      const args = ops.argsArray[i];

      if (fn === OPS.save) {
        transformStack.push(currentTransform);
        continue;
      }

      if (fn === OPS.restore) {
        currentTransform = transformStack.pop() ?? viewport.transform;
        continue;
      }

      if (fn === OPS.transform) {
        const m = args as unknown as number[];
        currentTransform = pdfjsLib.Util.transform(currentTransform, m);
        continue;
      }

      if (fn === OPS.paintImageXObject || fn === OPS.paintImageXObjectRepeat) {
        const imageName = args[0] as string;
        if (!imageName) continue;

        // Image objects are stored in page.objs or page.commonObjs
        type PdfImageData = { width: number; height: number; data: Uint8ClampedArray; bitmap?: undefined } | { width: number; height: number; bitmap: ImageBitmap; data?: undefined };
        let imageData: PdfImageData | null = null;
        try {
          const raw = page.objs.get(imageName);
          if (raw && typeof raw === "object" && ("data" in raw || "bitmap" in raw)) {
            imageData = raw as PdfImageData;
          }
        } catch {
          try {
            const raw = page.commonObjs.get(imageName);
            if (raw && typeof raw === "object" && ("data" in raw || "bitmap" in raw)) {
              imageData = raw as PdfImageData;
            }
          } catch {
            continue;
          }
        }

        if (!imageData) continue;

        // The transform maps a unit square [0,0]-[1,1] to the image position
        // currentTransform = [a, b, c, d, e, f] where:
        //   a = scaleX, d = scaleY (can be negative), e = translateX, f = translateY
        const t = currentTransform;
        const imgWidth = Math.abs(t[0]) || Math.abs(t[1]);
        const imgHeight = Math.abs(t[3]) || Math.abs(t[2]);

        // Skip tiny images (likely artifacts, icons, or borders)
        if (imgWidth < 20 || imgHeight < 20) continue;

        // Compute top-left corner
        const x = t[4];
        // PDF.js may set negative scaleY, adjusting y accordingly
        const y = t[3] < 0 ? t[5] - imgHeight : t[5];

        // Extract image pixels to a data URL
        let dataUrl = "";
        try {
          const canvas = document.createElement("canvas");
          const sourceWidth = imageData.bitmap?.width ?? imageData.width ?? 1;
          const sourceHeight = imageData.bitmap?.height ?? imageData.height ?? 1;
          canvas.width = sourceWidth;
          canvas.height = sourceHeight;
          const ctx = canvas.getContext("2d");
          if (!ctx) continue;

          if (imageData.bitmap) {
            ctx.drawImage(imageData.bitmap, 0, 0);
          } else if (imageData.data && imageData.width && imageData.height) {
            const imgData = ctx.createImageData(imageData.width, imageData.height);
            // PDF.js image data may be RGB (3 channels) or RGBA (4 channels)
            const srcData = imageData.data;
            const dstData = imgData.data;
            if (srcData.length === imageData.width * imageData.height * 4) {
              dstData.set(srcData);
            } else if (srcData.length === imageData.width * imageData.height * 3) {
              for (let p = 0, d = 0; p < srcData.length; p += 3, d += 4) {
                dstData[d] = srcData[p];
                dstData[d + 1] = srcData[p + 1];
                dstData[d + 2] = srcData[p + 2];
                dstData[d + 3] = 255;
              }
            } else {
              continue;
            }
            ctx.putImageData(imgData, 0, 0);
          } else {
            continue;
          }

          dataUrl = canvas.toDataURL("image/png");
        } catch {
          continue;
        }

        if (!dataUrl) continue;

        images.push({
          id: `img-${pageIndex}-${images.length}`,
          x: clamp(x, 0, viewport.width),
          y: clamp(y, 0, viewport.height),
          width: clamp(imgWidth, 1, viewport.width),
          height: clamp(imgHeight, 1, viewport.height),
          dataUrl,
        });
      }
    }
  } catch (error) {
    console.warn("Image extraction failed for page", pageIndex, error);
  }

  return images;
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
          sampledBgColor: sampleMaskColor(context, x, y, width, fontHeight),
          lineHeight,
          textOffsetY,
          bold,
          italic,
        };
      });

    const sourceImages = await extractPageImages(
      page as unknown as Parameters<typeof extractPageImages>[0],
      viewport,
      pdfjsLib as unknown as Parameters<typeof extractPageImages>[2],
      index - 1,
    );

    pages.push({
      pdfWidth: baseViewport.width,
      pdfHeight: baseViewport.height,
      width: viewport.width,
      height: viewport.height,
      previewUrl: canvas.toDataURL("image/png"),
      textBlocks,
      sourceImages,
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
    const bleedX = Math.max(1 * coordinateScale, Math.min(fontSize * 0.08, 4 * coordinateScale));
    const bleedY = Math.max(2 * coordinateScale, Math.min(fontSize * 0.12, 5 * coordinateScale));
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

    context.fillStyle = sampleMaskColor(sourceContext, x, y, width, height);
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
          sampledBgColor: "#ffffff",
          lineHeight: 1.12,
          textOffsetY: 0,
          bold: false,
          italic: false,
        })),
    ),
  );
}
