/**
 * How a canvas image export looks: the on-screen style, or the print style for
 * figures placed on a page (a paper, a report).
 *
 * Print style differs in two ways. The background is transparent, so the
 * figure takes the page's colour. And node names are drawn PRINT_LABEL_SCALE
 * times larger (13 px → 15 px), since a canvas shrunk to a column width makes
 * the on-screen size hard to read.
 *
 * Node names read their size from the CSS variable LABEL_SCALE_VAR
 * (cascade-node.tsx). withPrintStyle sets it on the captured element for the
 * length of one capture, so the canvas on screen never changes.
 */

export interface CaptureOptions {
  /** Transparent background and larger node names. */
  print?: boolean;
}

export const PRINT_LABEL_SCALE = 15 / 13;
export const LABEL_SCALE_VAR = "--cascade-label-scale";

/** The factor node names are drawn at in this export. */
export function labelScale(opts?: CaptureOptions): number {
  return opts?.print ? PRINT_LABEL_SCALE : 1;
}

/** The export's background colour; undefined leaves it transparent. */
export function exportBackground(opts: CaptureOptions | undefined, screen: string): string | undefined {
  return opts?.print ? undefined : screen;
}

/** Runs `capture` with the node names on `root` drawn at this export's scale. */
export async function withPrintStyle<T>(
  root: HTMLElement,
  opts: CaptureOptions | undefined,
  capture: () => Promise<T>,
): Promise<T> {
  if (!opts?.print) return capture();
  root.style.setProperty(LABEL_SCALE_VAR, String(PRINT_LABEL_SCALE));
  try {
    return await capture();
  } finally {
    root.style.removeProperty(LABEL_SCALE_VAR);
  }
}
