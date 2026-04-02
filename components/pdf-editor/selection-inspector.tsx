"use client";

import { resolveEffectiveFontStyle, resolveEffectiveFontWeight } from "../../lib/pdf-editor/fonts";
import type { Overlay, SourceImage, TextVariant } from "../../lib/pdf-editor/types";
import { getTextVariantMetrics, overlayLabel } from "../../lib/pdf-editor/utils";

export function SelectionInspector({
  selectedOverlay,
  selectedSourceImage,
  onUpdateOverlay,
  onRemoveOverlay,
  onEditTextOverlay,
  onClearSelection,
  onRemoveSourceImage,
  onResizeSourceImage,
  onReplaceSourceImage,
}: {
  selectedOverlay: Overlay | null;
  selectedSourceImage: { pageIndex: number; image: SourceImage } | null;
  onUpdateOverlay: (id: string, patch: Partial<Overlay>) => void;
  onRemoveOverlay: (id: string) => void;
  onEditTextOverlay: (id: string) => void;
  onClearSelection: () => void;
  onRemoveSourceImage: (pageIndex: number, image: SourceImage) => void;
  onResizeSourceImage: (pageIndex: number, image: SourceImage) => void;
  onReplaceSourceImage: (pageIndex: number, image: SourceImage, file: File) => void;
}) {
  if (!selectedOverlay && !selectedSourceImage) return null;

  // Source image inspector (when a PDF-embedded image is selected)
  if (selectedSourceImage && !selectedOverlay) {
    const { pageIndex, image } = selectedSourceImage;
    return (
      <div className="floating-widget floating-inspector">
        <div className="widget-head">
          <strong>PDF Image</strong>
          <button type="button" className="ghost-button widget-close" onClick={onClearSelection}>
            Close
          </button>
        </div>

        <div className="source-image-preview">
          <img
            src={image.dataUrl}
            alt="Selected PDF image"
            style={{ maxWidth: "100%", maxHeight: 160, borderRadius: 8, border: "1px solid var(--line)" }}
          />
        </div>

        <div className="field-stack compact" style={{ marginTop: 12 }}>
          <div className="grid-two">
            <label>
              <span>X</span>
              <input type="number" value={Math.round(image.x)} readOnly />
            </label>
            <label>
              <span>Y</span>
              <input type="number" value={Math.round(image.y)} readOnly />
            </label>
            <label>
              <span>W</span>
              <input type="number" value={Math.round(image.width)} readOnly />
            </label>
            <label>
              <span>H</span>
              <input type="number" value={Math.round(image.height)} readOnly />
            </label>
          </div>

          <div className="source-image-actions">
            <button
              type="button"
              className="ghost-button"
              onClick={() => onResizeSourceImage(pageIndex, image)}
            >
              Resize
            </button>
            <label className="ghost-button replace-image-button">
              Replace
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) {
                    onReplaceSourceImage(pageIndex, image, file);
                  }
                  event.target.value = "";
                }}
              />
            </label>
          </div>
          <button
            type="button"
            className="danger-button"
            onClick={() => onRemoveSourceImage(pageIndex, image)}
          >
            Remove
          </button>
        </div>
      </div>
    );
  }

  if (!selectedOverlay) return null;
  const selectedTextIsBold =
    selectedOverlay.kind === "text"
      ? resolveEffectiveFontWeight(selectedOverlay.cssFontWeight, selectedOverlay.bold) >= 600
      : false;
  const selectedTextIsItalic =
    selectedOverlay.kind === "text"
      ? resolveEffectiveFontStyle(selectedOverlay.cssFontStyle, selectedOverlay.italic) !== "normal"
      : false;

  return (
    <div className="floating-widget floating-inspector">
      <div className="widget-head">
        <strong>{overlayLabel(selectedOverlay)}</strong>
        <button type="button" className="ghost-button widget-close" onClick={onClearSelection}>
          Close
        </button>
      </div>

      <div className="field-stack compact">
        <div className="grid-two">
          <label>
            <span>X</span>
            <input
              type="number"
              value={Math.round(selectedOverlay.x)}
              onChange={(event) =>
                onUpdateOverlay(selectedOverlay.id, {
                  x: Number(event.target.value),
                })
              }
            />
          </label>
          <label>
            <span>Y</span>
            <input
              type="number"
              value={Math.round(selectedOverlay.y)}
              onChange={(event) =>
                onUpdateOverlay(selectedOverlay.id, {
                  y: Number(event.target.value),
                })
              }
            />
          </label>
          <label>
            <span>W</span>
            <input
              type="number"
              value={Math.round(selectedOverlay.width)}
              onChange={(event) =>
                onUpdateOverlay(selectedOverlay.id, {
                  width: Number(event.target.value),
                })
              }
            />
          </label>
          <label>
            <span>H</span>
            <input
              type="number"
              value={Math.round(selectedOverlay.height)}
              onChange={(event) =>
                onUpdateOverlay(selectedOverlay.id, {
                  height: Number(event.target.value),
                })
              }
            />
          </label>
        </div>

        {selectedOverlay.kind === "text" || selectedOverlay.kind === "watermark" ? (
          <>
            {selectedOverlay.kind === "text" ? (
              <button
                type="button"
                className="ghost-button"
                onClick={() => onEditTextOverlay(selectedOverlay.id)}
              >
                Edit
              </button>
            ) : null}
            <label>
              <span>Text</span>
              <textarea
                rows={3}
                value={selectedOverlay.text}
                onChange={(event) =>
                  onUpdateOverlay(selectedOverlay.id, {
                    text: event.target.value,
                  })
                }
              />
            </label>
            <div className="grid-two">
              <label>
                <span>Style</span>
                <select
                  value={selectedOverlay.variant}
                  onChange={(event) => {
                    const variant = event.target.value as TextVariant;
                    const metrics = getTextVariantMetrics(variant);
                    onUpdateOverlay(selectedOverlay.id, {
                      variant,
                      ...(selectedOverlay.kind === "text"
                        ? {
                            fontSize: metrics.fontSize,
                            lineHeight: metrics.lineHeight,
                          }
                        : {}),
                    });
                  }}
                >
                  <option value="h1">H1</option>
                  <option value="h2">H2</option>
                  <option value="h3">H3</option>
                  <option value="h4">H4</option>
                  <option value="h5">H5</option>
                  {selectedOverlay.kind === "text" ? <option value="li">LI</option> : null}
                  <option value="p">P</option>
                </select>
              </label>
              <label>
                <span>Color</span>
                <input
                  type="color"
                  value={selectedOverlay.color}
                  onChange={(event) =>
                    onUpdateOverlay(selectedOverlay.id, {
                      color: event.target.value,
                    })
                  }
                />
              </label>
            </div>
          </>
        ) : null}

        {selectedOverlay.kind === "text" ? (
          <div className="toggle-row compact">
            <label><input
              type="checkbox"
              checked={selectedTextIsBold}
              onChange={(event) =>
                onUpdateOverlay(selectedOverlay.id, {
                  bold: event.target.checked,
                  cssFontWeight: event.target.checked
                    ? Math.max(
                        resolveEffectiveFontWeight(
                          selectedOverlay.cssFontWeight,
                          selectedOverlay.bold,
                        ),
                        700,
                      )
                    : 400,
                })
              }
            />Bold</label>
            <label><input
              type="checkbox"
              checked={selectedTextIsItalic}
              onChange={(event) =>
                onUpdateOverlay(selectedOverlay.id, {
                  italic: event.target.checked,
                  cssFontStyle: event.target.checked
                    ? selectedOverlay.cssFontStyle &&
                      selectedOverlay.cssFontStyle !== "normal"
                      ? selectedOverlay.cssFontStyle
                      : "italic"
                    : "normal",
                })
              }
            />Italic</label>
            <label><input
              type="checkbox"
              checked={selectedOverlay.underline}
              onChange={(event) =>
                onUpdateOverlay(selectedOverlay.id, {
                  underline: event.target.checked,
                })
              }
            />U</label>
            <label><input
              type="checkbox"
              checked={selectedOverlay.strike}
              onChange={(event) =>
                onUpdateOverlay(selectedOverlay.id, {
                  strike: event.target.checked,
                })
              }
            />S</label>
          </div>
        ) : null}

        {selectedOverlay.kind === "image" ? (
          <label>
            <span>Opacity</span>
            <input
              type="range"
              min="0.1"
              max="1"
              step="0.05"
              value={selectedOverlay.opacity}
              onChange={(event) =>
                onUpdateOverlay(selectedOverlay.id, {
                  opacity: Number(event.target.value),
                })
              }
            />
          </label>
        ) : null}

        {selectedOverlay.kind === "mask" ? (
          <label>
            <span>Mask</span>
            <input
              type="color"
              value={selectedOverlay.color}
              onChange={(event) =>
                onUpdateOverlay(selectedOverlay.id, {
                  color: event.target.value,
                })
              }
            />
          </label>
        ) : null}

        {selectedOverlay.kind === "watermark" ? (
          <div className="grid-two">
            <label>
              <span>Opacity</span>
              <input
                type="range"
                min="0.05"
                max="0.6"
                step="0.05"
                value={selectedOverlay.opacity}
                onChange={(event) =>
                  onUpdateOverlay(selectedOverlay.id, {
                    opacity: Number(event.target.value),
                  })
                }
              />
            </label>
            <label>
              <span>Rotate</span>
              <input
                type="number"
                value={selectedOverlay.rotation}
                onChange={(event) =>
                  onUpdateOverlay(selectedOverlay.id, {
                    rotation: Number(event.target.value),
                  })
                }
              />
            </label>
          </div>
        ) : null}

        <button
          type="button"
          className="danger-button"
          onClick={() => onRemoveOverlay(selectedOverlay.id)}
        >
          Remove
        </button>
      </div>
    </div>
  );
}
