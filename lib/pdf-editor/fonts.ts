import type { FontCategory } from "./types";

export function inferFontTraits(fontName = "", declaredFamily = "") {
  const haystack = `${fontName} ${declaredFamily}`.toLowerCase();
  let fontFamily: FontCategory = "serif";

  if (
    haystack.includes("mono") ||
    haystack.includes("courier") ||
    haystack.includes("typewriter")
  ) {
    fontFamily = "mono";
  } else if (
    haystack.includes("sans-serif") ||
    haystack.includes("helvetica") ||
    haystack.includes("arial") ||
    haystack.includes("gothic") ||
    haystack.includes("sans ")
  ) {
    fontFamily = "sans";
  } else if (
    haystack.includes("serif") ||
    haystack.includes("times") ||
    haystack.includes("georgia") ||
    haystack.includes("garamond") ||
    haystack.includes("palatino") ||
    haystack.includes("roman")
  ) {
    fontFamily = "serif";
  }

  return {
    fontFamily,
    bold: /(bold|black|heavy|semibold|demi)/.test(haystack),
    italic: /(italic|oblique|slanted)/.test(haystack),
  };
}

export function getCssFontFamily(fontFamily: FontCategory) {
  if (fontFamily === "mono") return "\"Courier New\", Courier, monospace";
  if (fontFamily === "sans") return "Arial, \"Helvetica Neue\", Helvetica, sans-serif";
  return "Georgia, \"Times New Roman\", serif";
}

export function normalizeCssFontFamily(fontFamily?: string) {
  if (!fontFamily) return undefined;
  if (fontFamily.startsWith("\"") || fontFamily.startsWith("'") || fontFamily.includes(",")) {
    return fontFamily;
  }
  return /[\s()]/.test(fontFamily) ? `"${fontFamily}"` : fontFamily;
}

export function sanitizeCssFontFamily(fontFamily?: string) {
  if (!fontFamily) return undefined;
  const trimmed = fontFamily.trim();

  if (
    trimmed.includes(":") ||
    trimmed.includes(";") ||
    trimmed.includes("{") ||
    trimmed.includes("}") ||
    /url\s*\(/i.test(trimmed) ||
    /@\w+/.test(trimmed)
  ) {
    return undefined;
  }

  return normalizeCssFontFamily(trimmed);
}

export function buildCssFontStack(fontFamily: FontCategory, preferredFamily?: string) {
  const fallback = getCssFontFamily(fontFamily);
  const sanitized = sanitizeCssFontFamily(preferredFamily);

  if (!sanitized) {
    return fallback;
  }

  if (/(serif|sans-serif|monospace)\b/i.test(sanitized)) {
    return sanitized;
  }

  return `${sanitized}, ${fallback}`;
}

export function parseCssFontWeight(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) return parsed;
    if (value.toLowerCase() === "bold") return 700;
  }
  return undefined;
}

export function resolveEffectiveFontWeight(cssFontWeight?: number, bold = false) {
  const baseWeight = cssFontWeight ?? 400;
  return bold ? Math.max(baseWeight, 700) : baseWeight;
}

export function resolveEffectiveFontStyle(cssFontStyle?: string, italic = false) {
  if (italic && (!cssFontStyle || cssFontStyle === "normal")) {
    return "italic";
  }
  return cssFontStyle ?? "normal";
}

export function resolvePdfFont(
  commonObjs: {
    has: (objId: string) => boolean;
    get: (objId: string) => unknown;
  },
  fontName: string,
  declaredFamily = "",
) {
  if (!commonObjs.has(fontName)) return null;

  try {
    const fontObj = commonObjs.get(fontName) as {
      loadedName?: string;
      bold?: boolean;
      black?: boolean;
      italic?: boolean;
      systemFontInfo?: {
        css?: string;
        style?: {
          fontWeight?: number | string;
        };
      };
      cssFontInfo?: {
        fontFamily?: string;
        fontWeight?: number | string;
        italicAngle?: number;
      };
    };
    const familyHint =
      fontObj.systemFontInfo?.css ||
      fontObj.cssFontInfo?.fontFamily ||
      fontObj.loadedName ||
      declaredFamily;
    const traits = inferFontTraits(fontName, familyHint);
    const parsedFontWeight =
      fontObj.black
        ? 900
        : fontObj.bold
          ? 700
          : parseCssFontWeight(
              fontObj.cssFontInfo?.fontWeight ?? fontObj.systemFontInfo?.style?.fontWeight,
            ) ?? 400;
    const italicAngle = Number(fontObj.cssFontInfo?.italicAngle ?? 0);
    const parsedFontStyle =
      italicAngle !== 0
        ? `oblique ${italicAngle}deg`
        : fontObj.italic
          ? "italic"
          : "normal";
    const bold = fontObj.black || fontObj.bold || parsedFontWeight >= 600 || traits.bold;
    const italic = parsedFontStyle !== "normal" || fontObj.italic || traits.italic;
    const cssFontWeight = resolveEffectiveFontWeight(parsedFontWeight, bold);
    const cssFontStyle = resolveEffectiveFontStyle(parsedFontStyle, italic);

    return {
      fontFamily: traits.fontFamily,
      cssFontFamily:
        buildCssFontStack(
          traits.fontFamily,
          fontObj.systemFontInfo?.css ||
            fontObj.cssFontInfo?.fontFamily ||
            fontObj.loadedName ||
            declaredFamily,
        ),
      cssFontWeight,
      cssFontStyle,
      bold,
      italic,
    };
  } catch {
    return null;
  }
}
