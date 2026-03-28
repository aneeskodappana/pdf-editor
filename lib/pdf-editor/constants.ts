import type { FontCategory, TextVariant } from "./types";

export const FONT_SIZES: Record<TextVariant, number> = {
  h1: 34,
  h2: 28,
  h3: 24,
  h4: 20,
  h5: 18,
  li: 14,
  p: 14,
};

export const TEXT_LINE_HEIGHTS: Record<TextVariant, number> = {
  h1: 1.08,
  h2: 1.12,
  h3: 1.16,
  h4: 1.18,
  h5: 1.2,
  li: 1.22,
  p: 1.22,
};

export const TEXT_BOX_PADDING = 10;

export const EMPTY_TEXT_STYLE = {
  variant: "p" as TextVariant,
  fontFamily: "serif" as FontCategory,
  bold: false,
  italic: false,
  underline: false,
  strike: false,
  color: "#111827",
};
