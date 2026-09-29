export type FontFamily = "sans" | "serif" | "mono";
export type Align = "left" | "center" | "right";

/** A text run detected in the PDF (native text layer or OCR). Coordinates are PDF user space. */
export interface TextItemInfo {
  id: string;
  page: number;
  str: string;
  x: number; // baseline start, PDF user space
  y: number;
  width: number; // advance width along baseline, user space
  size: number; // font size, user space
  angle: number; // radians, counter-clockwise
  fontName: string;
  family: FontFamily;
  bold: boolean;
  italic: boolean;
  color?: string; // exact fill colour from the PDF content stream, when known
  source: "native" | "ocr";
}

export interface TextStyle {
  size: number;
  color: string; // hex
  bold: boolean;
  italic: boolean;
  family: FontFamily;
  align: Align;
}

export interface Edit {
  id: string;
  page: number;
  text: string;
  style: TextStyle;
  bg: string; // hex, used to cover the original glyphs
  x: number;
  y: number;
  angle: number;
  width: number; // original width (cover area); 0 for new text
  original?: TextItemInfo;
  isNew: boolean;
  pristine?: boolean; // opened but not changed yet — skipped on export
}

export type Edits = Record<string, Edit>;
