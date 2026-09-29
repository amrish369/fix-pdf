export type Mat = number[];

export function mul(m1: Mat, m2: Mat): Mat {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

/** Map a baseline-anchored text run (PDF space) into CSS pixels for a given viewport transform. */
export function screenBox(vt: Mat, e: { x: number; y: number; size: number; angle: number; width: number }) {
  const c = Math.cos(e.angle), s = Math.sin(e.angle);
  const m = mul(vt, [c * e.size, s * e.size, -s * e.size, c * e.size, e.x, e.y]);
  const fontH = Math.hypot(m[2], m[3]);
  const k = fontH / e.size;
  const angle = Math.atan2(m[1], m[0]);
  const ascent = 0.9 * fontH;
  return {
    left: m[4],
    top: m[5] - ascent,
    baselineX: m[4],
    baselineY: m[5],
    fontH,
    ascent,
    height: fontH * 1.25,
    width: e.width * k,
    angle,
    k,
  };
}

export function invert(m: Mat): Mat {
  const d = m[0] * m[3] - m[1] * m[2];
  return [m[3] / d, -m[1] / d, -m[2] / d, m[0] / d, (m[2] * m[5] - m[3] * m[4]) / d, (m[1] * m[4] - m[0] * m[5]) / d];
}

export function apply(m: Mat, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}
