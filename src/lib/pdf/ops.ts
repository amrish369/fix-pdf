/**
 * Reads the page content stream (operator list) to recover the *exact* fill colour
 * and font used for each drawn text run. Canvas pixel sampling averages antialiased
 * edges (pure black reads as grey, white as pink), so the content stream is the only
 * reliable source for small text.
 */

export interface DrawnRun {
  color: string; // hex
  fontName: string;
  size: number;
}

type M = [number, number, number, number, number, number];

const mul = (a: M, b: M): M => [
  a[0] * b[0] + a[1] * b[2],
  a[0] * b[1] + a[1] * b[3],
  a[2] * b[0] + a[3] * b[2],
  a[2] * b[1] + a[3] * b[3],
  a[4] * b[0] + a[5] * b[2] + b[4],
  a[4] * b[1] + a[5] * b[3] + b[5],
];

const chan = (v: number) => {
  const n = v <= 1 && !Number.isInteger(v) ? Math.round(v * 255) : Math.round(v);
  return Math.max(0, Math.min(255, n));
};
const hex = (r: number, g: number, b: number) =>
  "#" + [chan(r), chan(g), chan(b)].map((n) => n.toString(16).padStart(2, "0")).join("");

/** Position key used to join a content-stream run with a text-layer item. */
export const runKey = (x: number, y: number) => `${Math.round(x * 2)}:${Math.round(y * 2)}`;

type OpsLike = Record<string, number>;

export async function collectDrawnRuns(
  page: { getOperatorList: () => Promise<{ fnArray: number[]; argsArray: unknown[][] }> },
  OPS: OpsLike,
): Promise<Map<string, DrawnRun>> {
  const out = new Map<string, DrawnRun>();
  let ops: { fnArray: number[]; argsArray: unknown[][] };
  try {
    ops = await page.getOperatorList();
  } catch {
    return out;
  }

  let ctm: M = [1, 0, 0, 1, 0, 0];
  const stack: { ctm: M; color: string; mode: number }[] = [];
  let color = "#000000";
  let mode = 0;
  let tm: M = [1, 0, 0, 1, 0, 0];
  let tlm: M = [1, 0, 0, 1, 0, 0];
  let leading = 0;
  let fontName = "";
  let fontSize = 0;

  const record = () => {
    const trm = mul(tm, ctm);
    const key = runKey(trm[4], trm[5]);
    // fill+stroke render modes (2, 6) are "faux bold"
    const bold = mode === 2 || mode === 6;
    if (!out.has(key)) out.set(key, { color, fontName, size: fontSize, bold });
  };

  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i];
    const a = ops.argsArray[i] as number[];
    switch (fn) {
      case OPS["save"]:
        stack.push({ ctm, color, mode });
        break;
      case OPS["setTextRenderingMode"]:
        mode = Number(a[0]) || 0;
        break;
      case OPS["restore"]: {
        const s = stack.pop();
        if (s) { ctm = s.ctm; color = s.color; }
        break;
      }
      case OPS["transform"]:
        ctm = mul([a[0], a[1], a[2], a[3], a[4], a[5]], ctm);
        break;
      case OPS["setFillRGBColor"]:
        color = hex(a[0], a[1], a[2]);
        break;
      case OPS["setFillGray"]:
        color = hex(a[0] * 255, a[0] * 255, a[0] * 255);
        break;
      case OPS["setFillCMYKColor"]: {
        const [c, m, y, k] = a;
        color = hex(255 * (1 - c) * (1 - k), 255 * (1 - m) * (1 - k), 255 * (1 - y) * (1 - k));
        break;
      }
      case OPS["setFont"]:
        fontName = String(a[0]);
        fontSize = Math.abs(Number(a[1])) || fontSize;
        break;
      case OPS["setLeading"]:
        leading = a[0];
        break;
      case OPS["setLeadingMoveText"]:
        leading = -a[1];
        tlm = mul([1, 0, 0, 1, a[0], a[1]], tlm);
        tm = tlm;
        break;
      case OPS["beginText"]:
        tm = [1, 0, 0, 1, 0, 0];
        tlm = tm;
        break;
      case OPS["setTextMatrix"]:
        tm = [a[0], a[1], a[2], a[3], a[4], a[5]];
        tlm = tm;
        break;
      case OPS["moveText"]:
        tlm = mul([1, 0, 0, 1, a[0], a[1]], tlm);
        tm = tlm;
        break;
      case OPS["nextLine"]:
        tlm = mul([1, 0, 0, 1, 0, -leading], tlm);
        tm = tlm;
        break;
      case OPS["showText"]:
      case OPS["showSpacedText"]:
        record();
        break;
      case OPS["nextLineShowText"]:
        tlm = mul([1, 0, 0, 1, 0, -leading], tlm);
        tm = tlm;
        record();
        break;
      case OPS["nextLineSetSpacingShowText"]:
        tlm = mul([1, 0, 0, 1, 0, -leading], tlm);
        tm = tlm;
        record();
        break;
      default:
        break;
    }
  }
  return out;
}
