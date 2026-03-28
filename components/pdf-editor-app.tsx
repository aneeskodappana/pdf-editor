"use client";

import {
  type ChangeEvent,
  type DragEvent as ReactDragEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { PDFDocument, degrees } from "pdf-lib";

import { PageEditorCard } from "./pdf-editor/page-editor-card";
import { SelectionInspector } from "./pdf-editor/selection-inspector";
import { SignaturePad } from "./pdf-editor/signature-pad";
import { EMPTY_TEXT_STYLE, FONT_SIZES, TEXT_BOX_PADDING } from "../lib/pdf-editor/constants";
import {
  buildCssFontStack,
  resolveEffectiveFontStyle,
  resolveEffectiveFontWeight,
} from "../lib/pdf-editor/fonts";
import {
  buildOcrTextBlocks,
  buildPagePreview,
  getFontFamily,
  pageToPdfY,
  renderPdfPageImages,
  renderPdfPages,
} from "../lib/pdf-editor/pdf";
import type {
  ImageOverlay,
  OcrBlock,
  Overlay,
  PreviewReplacement,
  RenderedPage,
  SourceTextBlock,
  TextOverlay,
} from "../lib/pdf-editor/types";
import {
  clamp,
  dataUrlToBytes,
  downloadBlob,
  estimateTextBoxSize,
  fitImageSize,
  getImageDimensions,
  getTextVariantMetrics,
  hexToRgb,
  inferTextVariant,
  makeId,
  normalizeTextOverlayFormatting,
  readFileAsDataUrl,
} from "../lib/pdf-editor/utils";

function buildPreviewReplacements(
  pages: RenderedPage[],
  overlays: Overlay[],
) {
  return pages.map((_, pageIndex) =>
    overlays
      .filter(
        (overlay): overlay is TextOverlay =>
          overlay.kind === "text" &&
          overlay.pageIndex === pageIndex &&
          Boolean(overlay.sourceTextId) &&
          Boolean(overlay.backgroundColor),
      )
      .map(
        (overlay): PreviewReplacement => ({
          id: overlay.id,
          x: overlay.x + (overlay.maskOffsetX ?? 0),
          y: overlay.y + (overlay.maskOffsetY ?? 0),
          width: overlay.maskWidth ?? overlay.width,
          height: overlay.maskHeight ?? overlay.height,
          backgroundColor: overlay.backgroundColor,
          text: overlay.text,
          color: overlay.color,
          fontSize: overlay.fontSize,
          fontFamily: buildCssFontStack(overlay.fontFamily, overlay.cssFontFamily),
          fontWeight: resolveEffectiveFontWeight(overlay.cssFontWeight, overlay.bold),
          fontStyle: resolveEffectiveFontStyle(overlay.cssFontStyle, overlay.italic),
          underline: overlay.underline,
          strike: overlay.strike,
          paddingX: overlay.paddingX ?? TEXT_BOX_PADDING,
          paddingY: overlay.paddingY ?? TEXT_BOX_PADDING,
          lineHeight: overlay.lineHeight,
          textOffsetY: overlay.textOffsetY,
          renderText: false,
        }),
      ),
  );
}

export function PdfEditorApp() {
  const [fileName, setFileName] = useState("edited-document.pdf");
  const [pdfBytes, setPdfBytes] = useState<Uint8Array | null>(null);
  const [pages, setPages] = useState<RenderedPage[]>([]);
  const [pagePreviewUrls, setPagePreviewUrls] = useState<string[]>([]);
  const [overlays, setOverlays] = useState<Overlay[]>([]);
  const [removedPages, setRemovedPages] = useState<number[]>([]);
  const [selectedOverlayId, setSelectedOverlayId] = useState<string | null>(null);
  const [signatureDataUrl, setSignatureDataUrl] = useState<string | null>(null);
  const [showTextTargets, setShowTextTargets] = useState(false);
  const [signaturePanelOpen, setSignaturePanelOpen] = useState(false);
  const [editingTextOverlayId, setEditingTextOverlayId] = useState<string | null>(null);
  const [ocrRunningPages, setOcrRunningPages] = useState<number[]>([]);
  const [isDragActive, setIsDragActive] = useState(false);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [draggingOverlayId, setDraggingOverlayId] = useState<string | null>(null);
  const [, setStatusMessage] = useState("Ready");
  const pageRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const dragDepthRef = useRef(0);

  const previewReplacementsByPage = useMemo(
    () => buildPreviewReplacements(pages, overlays),
    [overlays, pages],
  );
  const selectedOverlay = useMemo(
    () => overlays.find((overlay) => overlay.id === selectedOverlayId) ?? null,
    [overlays, selectedOverlayId],
  );

  useEffect(() => {
    if (pages.length === 0) {
      setPagePreviewUrls([]);
      return;
    }

    let cancelled = false;

    async function composePagePreviews() {
      try {
        const nextPreviewUrls = await Promise.all(
          pages.map((page, pageIndex) =>
            buildPagePreview(page, previewReplacementsByPage[pageIndex] ?? []),
          ),
        );

        if (!cancelled) {
          setPagePreviewUrls(nextPreviewUrls);
        }
      } catch (error) {
        console.error(error);
        if (!cancelled) {
          setPagePreviewUrls(pages.map((page) => page.previewUrl));
        }
      }
    }

    void composePagePreviews();

    return () => {
      cancelled = true;
    };
  }, [pages, previewReplacementsByPage]);

  function clearActiveSelection() {
    setSelectedOverlayId(null);
    setEditingTextOverlayId(null);
    setDraggingOverlayId(null);
  }

  async function loadPdfFile(file: File) {
    if (
      file.type &&
      file.type !== "application/pdf" &&
      !file.name.toLowerCase().endsWith(".pdf")
    ) {
      setStatusMessage("PDF only");
      return;
    }

    setLoading(true);
    setStatusMessage("Rendering");

    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const renderBytes = bytes.slice();
      const exportBytes = bytes.slice();
      const renderedPages = await renderPdfPages(renderBytes);

      setPdfBytes(exportBytes);
      setPages(renderedPages);
      setPagePreviewUrls(renderedPages.map((page) => page.previewUrl));
      setOverlays([]);
      setRemovedPages([]);
      clearActiveSelection();
      setShowTextTargets(false);
      setFileName(file.name.replace(/\.pdf$/i, "") + "-edited.pdf");
      setStatusMessage("Loaded");
    } catch (error) {
      console.error(error);
      setStatusMessage("Load failed");
    } finally {
      setLoading(false);
      setIsDragActive(false);
      dragDepthRef.current = 0;
    }
  }

  async function handleFileUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    await loadPdfFile(file);
    event.target.value = "";
  }

  function handleDropzoneDragEnter(event: ReactDragEvent<HTMLElement>) {
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current += 1;
    setIsDragActive(true);
  }

  function handleDropzoneDragOver(event: ReactDragEvent<HTMLElement>) {
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "copy";
    setIsDragActive(true);
  }

  function handleDropzoneDragLeave(event: ReactDragEvent<HTMLElement>) {
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) {
      setIsDragActive(false);
    }
  }

  async function handleDropzoneDrop(event: ReactDragEvent<HTMLElement>) {
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current = 0;
    setIsDragActive(false);
    const file = event.dataTransfer.files?.[0];
    if (!file) return;
    await loadPdfFile(file);
  }

  function addTextOverlay(pageIndex: number) {
    const page = pages[pageIndex];
    const textMetrics = getTextVariantMetrics("p");
    const estimated = estimateTextBoxSize(
      "New text",
      textMetrics.fontSize,
      TEXT_BOX_PADDING,
      TEXT_BOX_PADDING,
      textMetrics.lineHeight,
    );
    const overlay: TextOverlay = {
      id: makeId(),
      kind: "text",
      pageIndex,
      x: 60,
      y: 60,
      width: Math.min(Math.max(estimated.width, 240), page.width - 40),
      height: estimated.height,
      text: "New text",
      fontSize: textMetrics.fontSize,
      ...EMPTY_TEXT_STYLE,
      cssFontFamily: buildCssFontStack(EMPTY_TEXT_STYLE.fontFamily),
      cssFontWeight: 400,
      cssFontStyle: "normal",
      lineHeight: textMetrics.lineHeight,
      textOffsetY: 0,
    };
    setOverlays((current) => [...current, overlay]);
    setSelectedOverlayId(overlay.id);
    setEditingTextOverlayId(overlay.id);
    setStatusMessage("Text added");
  }

  async function addImageOverlay(
    pageIndex: number,
    dataUrl: string,
    label: string,
    sizePreset?: { maxWidth?: number; maxHeight?: number },
  ) {
    const page = pages[pageIndex];
    const { width, height } = await getImageDimensions(dataUrl);
    const frame = fitImageSize(
      width,
      height,
      Math.min(sizePreset?.maxWidth ?? 240, page.width - 80),
      Math.min(sizePreset?.maxHeight ?? 180, page.height - 80),
    );
    const overlay: ImageOverlay = {
      id: makeId(),
      kind: "image",
      pageIndex,
      x: 60,
      y: 60,
      width: frame.width,
      height: frame.height,
      dataUrl,
      label,
      opacity: 1,
    };

    setOverlays((current) => [...current, overlay]);
    setSelectedOverlayId(overlay.id);
    setStatusMessage("Image added");
  }

  function addMaskOverlay(pageIndex: number) {
    const page = pages[pageIndex];
    const overlay: Overlay = {
      id: makeId(),
      kind: "mask",
      pageIndex,
      x: 60,
      y: 60,
      width: Math.min(180, page.width - 80),
      height: 40,
      color: "#111111",
    };

    setOverlays((current) => [...current, overlay]);
    setSelectedOverlayId(overlay.id);
    setStatusMessage("Mask added");
  }

  function addWatermark(pageIndex: number) {
    const page = pages[pageIndex];
    const overlay: Overlay = {
      id: makeId(),
      kind: "watermark",
      pageIndex,
      x: page.width * 0.16,
      y: page.height * 0.38,
      width: page.width * 0.68,
      height: 80,
      text: "CONFIDENTIAL",
      opacity: 0.2,
      rotation: -32,
      color: "#b91c1c",
      variant: "h2",
    };

    setOverlays((current) => [...current, overlay]);
    setSelectedOverlayId(overlay.id);
    setStatusMessage("Watermark added");
  }

  function updateOverlay(id: string, patch: Partial<Overlay>) {
    setOverlays((current) =>
      current.map((overlay) => {
        if (overlay.id !== id) return overlay;

        const nextOverlay = { ...overlay, ...patch } as Overlay;
        if (nextOverlay.kind !== "text") {
          return nextOverlay;
        }

        const normalizedOverlay = normalizeTextOverlayFormatting(nextOverlay);

        const estimated = estimateTextBoxSize(
          normalizedOverlay.text,
          normalizedOverlay.fontSize,
          normalizedOverlay.paddingX ?? TEXT_BOX_PADDING,
          normalizedOverlay.paddingY ?? TEXT_BOX_PADDING,
          normalizedOverlay.lineHeight,
        );

        return {
          ...normalizedOverlay,
          width:
            patch.width === undefined
              ? Math.max(normalizedOverlay.width, estimated.width)
              : normalizedOverlay.width,
          height:
            patch.height === undefined
              ? Math.max(normalizedOverlay.height, estimated.height)
              : normalizedOverlay.height,
        } satisfies TextOverlay;
      }),
    );
  }

  function removeOverlay(id: string) {
    setOverlays((current) => current.filter((overlay) => overlay.id !== id));
    setSelectedOverlayId((current) => (current === id ? null : current));
    setEditingTextOverlayId((current) => (current === id ? null : current));
    setStatusMessage("Removed");
  }

  function togglePageRemoval(pageIndex: number) {
    setRemovedPages((current) =>
      current.includes(pageIndex)
        ? current.filter((entry) => entry !== pageIndex)
        : [...current, pageIndex].sort((left, right) => left - right),
    );
    setStatusMessage("Updated");
  }

  async function onImagePicked(
    event: ChangeEvent<HTMLInputElement>,
    pageIndex: number,
    label: string,
  ) {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const dataUrl = await readFileAsDataUrl(file);
      await addImageOverlay(pageIndex, dataUrl, label);
    } catch (error) {
      console.error(error);
      setStatusMessage("Image failed");
    } finally {
      event.target.value = "";
    }
  }

  async function addSignatureOverlay(pageIndex: number) {
    if (!signatureDataUrl) return;
    await addImageOverlay(pageIndex, signatureDataUrl, "Signature", {
      maxWidth: 220,
      maxHeight: 100,
    });
  }

  function createTextReplacement(pageIndex: number, textBlock: SourceTextBlock) {
    const existingOverlay = overlays.find(
      (overlay): overlay is TextOverlay =>
        overlay.kind === "text" &&
        overlay.pageIndex === pageIndex &&
        overlay.sourceTextId === textBlock.id,
    );

    if (existingOverlay) {
      setOverlays((current) =>
        current.map((overlay) =>
          overlay.id === existingOverlay.id && overlay.kind === "text"
            ? normalizeTextOverlayFormatting({
                ...overlay,
                variant: inferTextVariant(overlay.text, overlay.fontSize),
              })
            : overlay,
        ),
      );
      setSelectedOverlayId(existingOverlay.id);
      setEditingTextOverlayId(existingOverlay.id);
      return;
    }

    const fontSize = textBlock.fontSize;
    const effectiveFontWeight = resolveEffectiveFontWeight(
      textBlock.cssFontWeight,
      textBlock.bold,
    );
    const effectiveFontStyle = resolveEffectiveFontStyle(
      textBlock.cssFontStyle,
      textBlock.italic,
    );
    const estimated = estimateTextBoxSize(
      textBlock.text,
      fontSize,
      0,
      0,
      textBlock.lineHeight,
    );
    const overlay: TextOverlay = normalizeTextOverlayFormatting({
      id: makeId(),
      kind: "text",
      pageIndex,
      x: Math.max(textBlock.x, 0),
      y: Math.max(textBlock.y, 0),
      width: Math.max(textBlock.width + 4, estimated.width),
      height: Math.max(textBlock.height + 4, estimated.height),
      text: textBlock.text,
      variant: inferTextVariant(textBlock.text, textBlock.fontSize),
      fontFamily: textBlock.fontFamily,
      fontSize,
      bold: textBlock.bold || effectiveFontWeight >= 600,
      italic: textBlock.italic || effectiveFontStyle !== "normal",
      underline: false,
      strike: false,
      color: textBlock.color,
      backgroundColor: "#ffffff",
      sourceTextId: textBlock.id,
      maskWidth: textBlock.width + 4,
      maskHeight: textBlock.height + 4,
      maskOffsetX: -2,
      maskOffsetY: -2,
      paddingX: 0,
      paddingY: 0,
      cssFontFamily: buildCssFontStack(textBlock.fontFamily, textBlock.cssFontFamily),
      cssFontWeight: effectiveFontWeight,
      cssFontStyle: effectiveFontStyle,
      lineHeight: textBlock.lineHeight,
      textOffsetY: textBlock.textOffsetY,
    });

    setOverlays((current) => [...current, overlay]);
    setSelectedOverlayId(overlay.id);
    setEditingTextOverlayId(overlay.id);
    setStatusMessage("Text selected");
  }

  function handleOverlayPointerDown(
    event: ReactPointerEvent<HTMLElement>,
    overlay: Overlay,
  ) {
    event.preventDefault();
    event.stopPropagation();
    const pageElement = pageRefs.current[overlay.pageIndex];
    if (!pageElement) return;

    const rect = pageElement.getBoundingClientRect();
    const offsetX = event.clientX - rect.left - overlay.x;
    const offsetY = event.clientY - rect.top - overlay.y;

    if (overlay.kind === "text" || overlay.kind === "watermark") {
      setEditingTextOverlayId(null);
    }

    setSelectedOverlayId(overlay.id);
    setDraggingOverlayId(overlay.id);

    const move = (pointerEvent: PointerEvent) => {
      const currentPageElement = pageRefs.current[overlay.pageIndex];
      if (!currentPageElement) return;
      const pageRect = currentPageElement.getBoundingClientRect();
      const nextX = clamp(
        pointerEvent.clientX - pageRect.left - offsetX,
        0,
        Math.max(currentPageElement.clientWidth - overlay.width, 0),
      );
      const nextY = clamp(
        pointerEvent.clientY - pageRect.top - offsetY,
        0,
        Math.max(currentPageElement.clientHeight - overlay.height, 0),
      );

      updateOverlay(overlay.id, { x: nextX, y: nextY });
    };

    const release = () => {
      setDraggingOverlayId((current) => (current === overlay.id ? null : current));
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", release);
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", release, { once: true });
  }

  function handleCanvasPointerDown(
    event: ReactPointerEvent<HTMLDivElement>,
    pageIndex: number,
  ) {
    const target = event.target as HTMLElement;
    if (target === event.currentTarget || target.tagName === "IMG") {
      clearActiveSelection();
      setStatusMessage(`Page ${pageIndex + 1}`);
    }
  }

  async function runOcr(pageIndex: number) {
    const page = pages[pageIndex];
    if (!page || ocrRunningPages.includes(pageIndex)) return;

    setOcrRunningPages((current) => [...current, pageIndex]);
    setStatusMessage(`OCR ${pageIndex + 1}`);

    try {
      const tesseract = await import("tesseract.js");
      const worker = await tesseract.createWorker("eng");
      const result = await worker.recognize(page.previewUrl, {}, { blocks: true });
      const ocrBlocks = (result.data.blocks ?? []) as OcrBlock[];
      const ocrTextBlocks = buildOcrTextBlocks(ocrBlocks, pageIndex);
      await worker.terminate();

      setPages((current) =>
        current.map((entry, index) =>
          index === pageIndex ? { ...entry, textBlocks: ocrTextBlocks } : entry,
        ),
      );
      setStatusMessage(ocrTextBlocks.length > 0 ? "OCR ready" : "OCR empty");
    } catch (error) {
      console.error(error);
      setStatusMessage("OCR failed");
    } finally {
      setOcrRunningPages((current) => current.filter((entry) => entry !== pageIndex));
    }
  }

  async function exportPdf() {
    if (!pdfBytes) return;

    setExporting(true);
    setStatusMessage("Exporting");

    try {
      const exportPreviewReplacementsByPage = buildPreviewReplacements(pages, overlays).map(
        (replacements) =>
          replacements.map((replacement) => ({
            ...replacement,
            renderText: true,
          })),
      );
      const flattenedPageIndices = exportPreviewReplacementsByPage
        .map((replacements, pageIndex) => (replacements.length > 0 ? pageIndex : -1))
        .filter((pageIndex) => pageIndex >= 0);
      const exportBaseImages = await renderPdfPageImages(pdfBytes, flattenedPageIndices, 3.2);
      const document = await PDFDocument.load(pdfBytes);
      const removed = document
        .getPages()
        .map((_, index) => index)
        .filter((index) => removedPages.includes(index));

      removed
        .slice()
        .sort((left, right) => right - left)
        .forEach((index) => {
          document.removePage(index);
        });

      const pageMap = new Map<number, number>();
      let nextPageIndex = 0;
      pages.forEach((_, index) => {
        if (!removedPages.includes(index)) {
          pageMap.set(index, nextPageIndex);
          nextPageIndex += 1;
        }
      });

      for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
        const targetPageIndex = pageMap.get(pageIndex);
        if (targetPageIndex === undefined) continue;

        const replacements = exportPreviewReplacementsByPage[pageIndex] ?? [];
        if (replacements.length === 0) continue;

        const page = document.getPage(targetPageIndex);
        const pageMeta = pages[pageIndex];
        const exportBaseImage = exportBaseImages.get(pageIndex);
        const previewUrl = await buildPagePreview(pageMeta, replacements, {
          previewUrl: exportBaseImage?.previewUrl,
          width: exportBaseImage?.width,
          height: exportBaseImage?.height,
          coordinateScale:
            exportBaseImage && exportBaseImage.width > 0
              ? exportBaseImage.width / pageMeta.width
              : 1,
        });
        const previewImage = await document.embedPng(dataUrlToBytes(previewUrl));
        page.drawImage(previewImage, {
          x: 0,
          y: 0,
          width: page.getWidth(),
          height: page.getHeight(),
        });
      }

      for (const overlay of overlays) {
        const targetPageIndex = pageMap.get(overlay.pageIndex);
        if (targetPageIndex === undefined) continue;
        if (
          overlay.kind === "text" &&
          overlay.sourceTextId &&
          (exportPreviewReplacementsByPage[overlay.pageIndex]?.length ?? 0) > 0
        ) {
          continue;
        }

        const page = document.getPage(targetPageIndex);
        const pageMeta = pages[overlay.pageIndex];
        const scaleX = page.getWidth() / pageMeta.width;
        const scaleY = page.getHeight() / pageMeta.height;
        const pdfWidth = overlay.width * scaleX;
        const pdfHeight = overlay.height * scaleY;
        const safeX = clamp(overlay.x * scaleX, 0, Math.max(page.getWidth() - pdfWidth, 0));
        const safeY = clamp(overlay.y * scaleY, 0, Math.max(page.getHeight() - pdfHeight, 0));
        const pdfY = pageToPdfY(page, safeY, pdfHeight);

        if (overlay.kind === "mask") {
          page.drawRectangle({
            x: safeX,
            y: pdfY,
            width: pdfWidth,
            height: pdfHeight,
            color: hexToRgb(overlay.color),
          });
          continue;
        }

        if (overlay.kind === "text" || overlay.kind === "watermark") {
          const fontSize =
            overlay.kind === "text"
              ? overlay.fontSize * scaleY
              : FONT_SIZES[overlay.variant] * scaleY;
          const font = await document.embedFont(getFontFamily(overlay));
          const lines = overlay.text.split("\n");
          const color = hexToRgb(overlay.color);
          const lineHeight =
            overlay.kind === "text"
              ? fontSize * overlay.lineHeight
              : fontSize * 1.2;
          const paddingX =
            overlay.kind === "text" ? (overlay.paddingX ?? TEXT_BOX_PADDING) * scaleX : 0;
          const paddingTop =
            overlay.kind === "text"
              ? ((overlay.paddingY ?? TEXT_BOX_PADDING) + overlay.textOffsetY) * scaleY
              : 0;
          const textY = pdfY + pdfHeight - paddingTop - fontSize;

          if (overlay.kind === "text" && overlay.backgroundColor) {
            const maskWidth = (overlay.maskWidth ?? overlay.width) * scaleX;
            const maskHeight = (overlay.maskHeight ?? overlay.height) * scaleY;
            const maskX = safeX + (overlay.maskOffsetX ?? 0) * scaleX;
            const maskY = safeY + (overlay.maskOffsetY ?? 0) * scaleY;
            page.drawRectangle({
              x: maskX,
              y: pageToPdfY(page, maskY, maskHeight),
              width: maskWidth,
              height: maskHeight,
              color: hexToRgb(overlay.backgroundColor),
            });
          }

          lines.forEach((line, index) => {
            const lineWidth = font.widthOfTextAtSize(line, fontSize);
            const currentY = textY - index * lineHeight;
            const textX = safeX + paddingX;

            page.drawText(line, {
              x: textX,
              y: currentY,
              size: fontSize,
              font,
              color,
              rotate:
                overlay.kind === "watermark"
                  ? degrees(overlay.rotation)
                  : degrees(0),
              opacity: overlay.kind === "watermark" ? overlay.opacity : 1,
            });

            if (overlay.kind === "text" && overlay.underline) {
              page.drawLine({
                start: { x: textX, y: currentY - 2 },
                end: { x: textX + lineWidth, y: currentY - 2 },
                thickness: 1.1,
                color,
              });
            }

            if (overlay.kind === "text" && overlay.strike) {
              page.drawLine({
                start: { x: textX, y: currentY + fontSize * 0.35 },
                end: { x: textX + lineWidth, y: currentY + fontSize * 0.35 },
                thickness: 1.1,
                color,
              });
            }
          });

          continue;
        }

        if (overlay.kind === "image") {
          const bytes = dataUrlToBytes(overlay.dataUrl);
          const image = overlay.dataUrl.includes("image/png")
            ? await document.embedPng(bytes)
            : await document.embedJpg(bytes);

          page.drawImage(image, {
            x: safeX,
            y: pdfY,
            width: pdfWidth,
            height: pdfHeight,
            opacity: overlay.opacity,
          });
        }
      }

      const output = await document.save();
      downloadBlob(new Blob([output], { type: "application/pdf" }), fileName);
      setStatusMessage("Downloaded");
    } catch (error) {
      console.error(error);
      setStatusMessage("Export failed");
    } finally {
      setExporting(false);
    }
  }

  return (
    <main className="app-shell minimal-shell">
      <header className="app-header">
        <div className="brand-mark">Papermark</div>
        <div className="header-actions">
          <label className="upload-button compact-upload">
            <input
              type="file"
              accept="application/pdf"
              onChange={(event) => void handleFileUpload(event)}
              disabled={loading}
            />
            {loading ? "Loading" : "Open"}
          </label>
          <button
            type="button"
            className={showTextTargets ? "ghost-button active-toggle" : "ghost-button"}
            onClick={() => setShowTextTargets((current) => !current)}
            disabled={pages.length === 0}
          >
            {showTextTargets ? "Guides on" : "Guides off"}
          </button>
          <button
            type="button"
            className="primary-button"
            onClick={() => void exportPdf()}
            disabled={!pdfBytes || exporting || pages.length === 0}
          >
            {exporting ? "Exporting" : "Export"}
          </button>
        </div>
      </header>

      <section
        className={`pages-column viewer-stage ${pages.length === 0 ? "empty" : ""} ${
          isDragActive ? "drag-active" : ""
        } ${loading ? "busy" : ""}`}
        onDragEnter={handleDropzoneDragEnter}
        onDragOver={handleDropzoneDragOver}
        onDragLeave={handleDropzoneDragLeave}
        onDrop={(event) => void handleDropzoneDrop(event)}
      >
        {pages.length === 0 ? (
          <label
            className={`empty-card minimal-empty upload-dropzone viewer-dropzone ${
              isDragActive ? "active" : ""
            } ${loading ? "busy" : ""}`}
          >
            <input
              type="file"
              accept="application/pdf"
              onChange={(event) => void handleFileUpload(event)}
              disabled={loading}
            />
            <div className="viewer-drop-copy">
              <strong>{isDragActive ? "Release PDF" : "Drop PDF here"}</strong>
              <span>{loading ? "Loading PDF" : "or click to open"}</span>
            </div>
          </label>
        ) : null}

        {pages.map((page, pageIndex) => (
          <PageEditorCard
            key={pageIndex}
            page={page}
            pageIndex={pageIndex}
            pagePreviewUrl={pagePreviewUrls[pageIndex] ?? page.previewUrl}
            pageRef={(element) => {
              pageRefs.current[pageIndex] = element;
            }}
            overlays={overlays.filter((overlay) => overlay.pageIndex === pageIndex)}
            isRemoved={removedPages.includes(pageIndex)}
            showTextTargets={showTextTargets}
            hasSignature={Boolean(signatureDataUrl)}
            ocrRunning={ocrRunningPages.includes(pageIndex)}
            selectedOverlayId={selectedOverlayId}
            editingTextOverlayId={editingTextOverlayId}
            draggingOverlayId={draggingOverlayId}
            onCanvasPointerDown={handleCanvasPointerDown}
            onAddText={() => addTextOverlay(pageIndex)}
            onRunOcr={() => void runOcr(pageIndex)}
            onImagePicked={(event) => void onImagePicked(event, pageIndex, "Image")}
            onAddSignature={() => void addSignatureOverlay(pageIndex)}
            onAddMask={() => addMaskOverlay(pageIndex)}
            onAddWatermark={() => addWatermark(pageIndex)}
            onTogglePageRemoval={() => togglePageRemoval(pageIndex)}
            onCreateTextReplacement={(textBlock) => createTextReplacement(pageIndex, textBlock)}
            onUpdateOverlay={updateOverlay}
            onSelectOverlay={(overlayId) => {
              setSelectedOverlayId(overlayId);
            }}
            onEditOverlay={(overlayId) => {
              setSelectedOverlayId(overlayId);
              setEditingTextOverlayId(overlayId);
            }}
            onStopTextEditing={() => setEditingTextOverlayId(null)}
            onOverlayPointerDown={handleOverlayPointerDown}
          />
        ))}

        {isDragActive && pages.length > 0 ? (
          <div className="viewer-drop-overlay">
            <strong>Release PDF</strong>
          </div>
        ) : null}
      </section>

      <SignaturePad
        onSave={(dataUrl) => {
          setSignatureDataUrl(dataUrl);
          setSignaturePanelOpen(false);
        }}
        isOpen={signaturePanelOpen}
        hasSavedSignature={Boolean(signatureDataUrl)}
        onToggle={() => setSignaturePanelOpen((current) => !current)}
      />

      <SelectionInspector
        selectedOverlay={selectedOverlay}
        onUpdateOverlay={updateOverlay}
        onRemoveOverlay={removeOverlay}
        onEditTextOverlay={(overlayId) => {
          setSelectedOverlayId(overlayId);
          setEditingTextOverlayId(overlayId);
        }}
        onClearSelection={clearActiveSelection}
      />
    </main>
  );
}
