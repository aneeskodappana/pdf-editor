"use client";

import type { ChangeEvent, PointerEvent as ReactPointerEvent } from "react";

import {
  buildCssFontStack,
  getCssFontFamily,
  resolveEffectiveFontStyle,
  resolveEffectiveFontWeight,
} from "../../lib/pdf-editor/fonts";
import type { Overlay, RenderedPage, SourceTextBlock, TextOverlay, TextVariant } from "../../lib/pdf-editor/types";
import { getTextVariantMetrics } from "../../lib/pdf-editor/utils";
import { FONT_SIZES, TEXT_BOX_PADDING } from "../../lib/pdf-editor/constants";
import {
  ImageIcon,
  MaskIcon,
  OcrIcon,
  PageRemoveIcon,
  SignatureIcon,
  TextIcon,
  WatermarkIcon,
} from "./icons";
import { PageToolButton } from "./page-tool-button";

export function PageEditorCard({
  page,
  pageIndex,
  pagePreviewUrl,
  pageRef,
  overlays,
  isRemoved,
  showTextTargets,
  hasSignature,
  ocrRunning,
  selectedOverlayId,
  editingTextOverlayId,
  draggingOverlayId,
  onCanvasPointerDown,
  onAddText,
  onRunOcr,
  onImagePicked,
  onAddSignature,
  onAddMask,
  onAddWatermark,
  onTogglePageRemoval,
  onCreateTextReplacement,
  onUpdateOverlay,
  onSelectOverlay,
  onEditOverlay,
  onStopTextEditing,
  onOverlayPointerDown,
}: {
  page: RenderedPage;
  pageIndex: number;
  pagePreviewUrl: string;
  pageRef: (element: HTMLDivElement | null) => void;
  overlays: Overlay[];
  isRemoved: boolean;
  showTextTargets: boolean;
  hasSignature: boolean;
  ocrRunning: boolean;
  selectedOverlayId: string | null;
  editingTextOverlayId: string | null;
  draggingOverlayId: string | null;
  onCanvasPointerDown: (event: ReactPointerEvent<HTMLDivElement>, pageIndex: number) => void;
  onAddText: () => void;
  onRunOcr: () => void;
  onImagePicked: (event: ChangeEvent<HTMLInputElement>) => void;
  onAddSignature: () => void;
  onAddMask: () => void;
  onAddWatermark: () => void;
  onTogglePageRemoval: () => void;
  onCreateTextReplacement: (textBlock: SourceTextBlock) => void;
  onUpdateOverlay: (id: string, patch: Partial<Overlay>) => void;
  onSelectOverlay: (overlayId: string) => void;
  onEditOverlay: (overlayId: string) => void;
  onStopTextEditing: () => void;
  onOverlayPointerDown: (
    event: ReactPointerEvent<HTMLElement>,
    overlay: Overlay,
  ) => void;
}) {
  const replacementPreviewReady = pagePreviewUrl !== page.previewUrl;
  const activeTextOverlay = overlays.find(
    (overlay): overlay is TextOverlay =>
      overlay.kind === "text" &&
      overlay.id === (editingTextOverlayId ?? selectedOverlayId),
  );
  const activeTextIsBold = activeTextOverlay
    ? resolveEffectiveFontWeight(activeTextOverlay.cssFontWeight, activeTextOverlay.bold) >= 600
    : false;
  const activeTextIsItalic = activeTextOverlay
    ? resolveEffectiveFontStyle(activeTextOverlay.cssFontStyle, activeTextOverlay.italic) !== "normal"
    : false;

  return (
    <article className={`page-card ${isRemoved ? "removed" : ""}`}>
      <div className="page-toolbar">
        <div><h2>Page {pageIndex + 1}</h2></div>
        <div className="icon-toolbar">
          <PageToolButton label="Add text" onClick={onAddText}>
            <TextIcon />
          </PageToolButton>
          <PageToolButton
            label={ocrRunning ? "Running OCR" : "Run OCR"}
            onClick={onRunOcr}
            disabled={ocrRunning}
          >
            <OcrIcon />
          </PageToolButton>
          <label
            className="icon-button file-button"
            title="Add image"
            aria-label="Add image"
            data-tooltip="Add image"
          >
            <ImageIcon />
            <span className="sr-only">Add image</span>
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={onImagePicked}
            />
          </label>
          <PageToolButton
            label="Add signature"
            disabled={!hasSignature}
            onClick={onAddSignature}
          >
            <SignatureIcon />
          </PageToolButton>
          <PageToolButton label="Add mask" onClick={onAddMask}>
            <MaskIcon />
          </PageToolButton>
          <PageToolButton label="Add watermark" onClick={onAddWatermark}>
            <WatermarkIcon />
          </PageToolButton>
          <PageToolButton
            label={isRemoved ? "Restore page" : "Remove page"}
            danger={isRemoved}
            onClick={onTogglePageRemoval}
          >
            <PageRemoveIcon />
          </PageToolButton>
        </div>
      </div>

      <div className="page-scroll">
        <div
          className="page-canvas"
          ref={pageRef}
          style={{ width: page.width, height: page.height }}
          onPointerDown={(event) => onCanvasPointerDown(event, pageIndex)}
        >
          <img
            src={pagePreviewUrl}
            alt={`Preview of page ${pageIndex + 1}`}
            width={page.width}
            height={page.height}
          />

          {activeTextOverlay ? (
            <div
              className="floating-text-toolbar"
              style={{
                left: Math.min(Math.max(activeTextOverlay.x, 8), Math.max(page.width - 320, 8)),
                top: Math.max(activeTextOverlay.y - 54, 8),
              }}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <select
                value={activeTextOverlay.variant}
                onChange={(event) => {
                  const variant = event.target.value as TextVariant;
                  const metrics = getTextVariantMetrics(variant);
                  onUpdateOverlay(activeTextOverlay.id, {
                    variant,
                    fontSize: metrics.fontSize,
                    lineHeight: metrics.lineHeight,
                  });
                }}
              >
                <option value="h1">H1</option>
                <option value="h2">H2</option>
                <option value="h3">H3</option>
                <option value="h4">H4</option>
                <option value="h5">H5</option>
                <option value="li">LI</option>
                <option value="p">P</option>
              </select>
              <button
                type="button"
                className={activeTextIsBold ? "active" : ""}
                onClick={() => {
                  const nextBold = !activeTextIsBold;
                  onUpdateOverlay(activeTextOverlay.id, {
                    bold: nextBold,
                    cssFontWeight: nextBold
                      ? Math.max(
                          resolveEffectiveFontWeight(
                            activeTextOverlay.cssFontWeight,
                            activeTextOverlay.bold,
                          ),
                          700,
                        )
                      : 400,
                  });
                }}
              >
                B
              </button>
              <button
                type="button"
                className={activeTextIsItalic ? "active" : ""}
                onClick={() => {
                  const nextItalic = !activeTextIsItalic;
                  onUpdateOverlay(activeTextOverlay.id, {
                    italic: nextItalic,
                    cssFontStyle: nextItalic
                      ? activeTextOverlay.cssFontStyle &&
                        activeTextOverlay.cssFontStyle !== "normal"
                        ? activeTextOverlay.cssFontStyle
                        : "italic"
                      : "normal",
                  });
                }}
              >
                I
              </button>
              <button
                type="button"
                className={activeTextOverlay.underline ? "active" : ""}
                onClick={() =>
                  onUpdateOverlay(activeTextOverlay.id, {
                    underline: !activeTextOverlay.underline,
                  })
                }
              >
                U
              </button>
              <button
                type="button"
                className={activeTextOverlay.strike ? "active" : ""}
                onClick={() =>
                  onUpdateOverlay(activeTextOverlay.id, {
                    strike: !activeTextOverlay.strike,
                  })
                }
              >
                S
              </button>
              <input
                type="color"
                value={activeTextOverlay.color}
                onChange={(event) =>
                  onUpdateOverlay(activeTextOverlay.id, {
                    color: event.target.value,
                  })
                }
              />
            </div>
          ) : null}

          {page.textBlocks.map((textBlock) => (
            <button
              type="button"
              key={textBlock.id}
              className={`source-text-target ${showTextTargets ? "guides-visible" : ""}`}
              style={{
                left: textBlock.x,
                top: textBlock.y,
                width: textBlock.width,
                height: textBlock.height,
              }}
              title={`Replace "${textBlock.text}"`}
              aria-label={`Replace ${textBlock.text}`}
              onDoubleClick={() => onCreateTextReplacement(textBlock)}
            />
          ))}

          {overlays.map((overlay) => {
            const domTextOffsetY =
              overlay.kind === "text"
                ? Math.max(
                    overlay.textOffsetY -
                      ((overlay.lineHeight - 1) * overlay.fontSize) / 2,
                    0,
                  )
                : 0;
            const textMask =
              overlay.kind === "text" &&
              overlay.backgroundColor &&
              (!overlay.sourceTextId ||
                !replacementPreviewReady ||
                editingTextOverlayId === overlay.id) ? (
                  <div
                    key={`${overlay.id}-mask`}
                    className="replacement-mask"
                    style={{
                      left: overlay.x,
                      top: overlay.y,
                      width: overlay.maskWidth ?? overlay.width,
                      height: overlay.maskHeight ?? overlay.height,
                      transform: `translate(${overlay.maskOffsetX ?? 0}px, ${overlay.maskOffsetY ?? 0}px)`,
                      background: overlay.backgroundColor,
                    }}
                  />
                ) : null;
            const resolvedTextFontWeight =
              overlay.kind === "text"
                ? resolveEffectiveFontWeight(overlay.cssFontWeight, overlay.bold)
                : 500;
            const isEditingParagraphBoldText =
              overlay.kind === "text" &&
              editingTextOverlayId === overlay.id &&
              (overlay.variant === "p" || overlay.variant === "li") &&
              resolvedTextFontWeight >= 600;

            const textStyle = {
              left: overlay.x,
              top: overlay.y,
              width: overlay.width,
              height: overlay.height,
              paddingTop:
                overlay.kind === "text"
                  ? (overlay.paddingY ?? TEXT_BOX_PADDING) + domTextOffsetY
                  : 10,
              paddingRight:
                overlay.kind === "text"
                  ? overlay.paddingX ?? TEXT_BOX_PADDING
                  : 10,
              paddingBottom:
                overlay.kind === "text"
                  ? overlay.paddingY ?? TEXT_BOX_PADDING
                  : 10,
              paddingLeft:
                overlay.kind === "text"
                  ? overlay.paddingX ?? TEXT_BOX_PADDING
                  : 10,
              color:
                overlay.kind === "mask"
                  ? "#fff"
                  : overlay.kind === "image"
                      ? "#111827"
                      : overlay.color,
              background:
                overlay.kind === "mask"
                  ? overlay.color
                  : overlay.kind === "image"
                    ? "rgba(255,255,255,0.12)"
                    : "transparent",
              opacity: overlay.kind === "watermark" ? overlay.opacity : 1,
              transform:
                overlay.kind === "watermark"
                  ? `rotate(${overlay.rotation}deg)`
                  : "none",
              fontFamily:
                overlay.kind === "text"
                  ? isEditingParagraphBoldText
                    ? getCssFontFamily(overlay.fontFamily)
                    : buildCssFontStack(overlay.fontFamily, overlay.cssFontFamily)
                  : "inherit",
              fontSize:
                overlay.kind === "text"
                  ? `${overlay.fontSize}px`
                  : overlay.kind === "watermark"
                    ? `${FONT_SIZES[overlay.variant]}px`
                    : "14px",
              lineHeight:
                overlay.kind === "text" ? `${overlay.lineHeight}` : "1.2",
              fontWeight:
                overlay.kind === "text"
                  ? isEditingParagraphBoldText
                    ? Math.max(resolvedTextFontWeight, 800)
                    : resolvedTextFontWeight
                  : overlay.kind === "watermark"
                    ? 700
                    : 500,
              fontStyle:
                overlay.kind === "text"
                  ? resolveEffectiveFontStyle(overlay.cssFontStyle, overlay.italic)
                  : "normal",
              textDecoration:
                overlay.kind === "text"
                  ? [
                      overlay.underline ? "underline" : "",
                      overlay.strike ? "line-through" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")
                  : "none",
            } as const;

            return (
              <div key={overlay.id}>
                {textMask}
                {overlay.kind === "text" ? (
                  <textarea
                    readOnly={editingTextOverlayId !== overlay.id}
                    className={`overlay-item overlay-editor ${
                      selectedOverlayId === overlay.id ? "active" : ""
                    } ${editingTextOverlayId === overlay.id ? "editing" : "readonly"} ${
                      draggingOverlayId === overlay.id ? "dragging" : ""
                    }`}
                    style={textStyle}
                    value={overlay.text}
                    autoFocus={editingTextOverlayId === overlay.id}
                    onClick={() => onSelectOverlay(overlay.id)}
                    onDoubleClick={() => onEditOverlay(overlay.id)}
                    onPointerDown={(event) => {
                      event.stopPropagation();
                      if (editingTextOverlayId !== overlay.id) {
                        onOverlayPointerDown(event, overlay);
                      }
                    }}
                    onChange={(event) => {
                      if (editingTextOverlayId === overlay.id) {
                        onUpdateOverlay(overlay.id, { text: event.target.value });
                      }
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") {
                        onStopTextEditing();
                      }
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    className={`overlay-item ${overlay.kind} ${
                      selectedOverlayId === overlay.id ? "active" : ""
                    } ${draggingOverlayId === overlay.id ? "dragging" : ""}`}
                    style={textStyle}
                    onClick={() => onSelectOverlay(overlay.id)}
                    onPointerDown={(event) => onOverlayPointerDown(event, overlay)}
                  >
                    {overlay.kind === "image" ? (
                      <img
                        src={overlay.dataUrl}
                        alt={overlay.label}
                        width={overlay.width}
                        height={overlay.height}
                      />
                    ) : overlay.kind === "mask" ? (
                      <span>Masked area</span>
                    ) : (
                      <span>{overlay.text}</span>
                    )}
                  </button>
                )}
              </div>
            );
          })}

          {isRemoved ? <div className="page-removed-badge">Removed</div> : null}
        </div>
      </div>

      {overlays.length > 0 ? (
        <div className="overlay-list">
          {overlays.map((overlay) => (
            <button
              type="button"
              key={`${overlay.id}-list`}
              className={`overlay-chip ${selectedOverlayId === overlay.id ? "active" : ""}`}
              onClick={() => {
                onSelectOverlay(overlay.id);
                if (overlay.kind === "text") {
                  onEditOverlay(overlay.id);
                }
              }}
            >
              {overlay.kind}
            </button>
          ))}
        </div>
      ) : null}

      {showTextTargets && page.textBlocks.length > 0 ? (
        <div className="source-text-panel">
          <div className="section-heading">
            <h3>Text blocks</h3>
          </div>
          <div className="source-text-list">
            {page.textBlocks.map((textBlock) => (
              <button
                key={`source-${textBlock.id}`}
                type="button"
                className="source-text-row"
                onClick={() => onCreateTextReplacement(textBlock)}
              >
                {textBlock.text}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </article>
  );
}
