/**
 * The hero's background atmosphere: a crack of failure forking down through
 * the dark band behind the text, like lightning striking and its afterglow
 * lingering — the same "falls like a waterfall" reading the mark itself
 * carries (docs/brand.md), rendered as current rather than as a diagram.
 *
 * WHY A BACKGROUND EFFECT RATHER THAN A FOREGROUND DIAGRAM: an earlier version
 * of this figure was a literal network-of-nodes illustration sitting beside
 * the copy — legible, but it read as a product screenshot rather than as
 * atmosphere, and it fought the copy for attention. This one sits behind
 * everything, is purely decorative (`aria-hidden`), and its only job is to
 * make the hero band feel like something is actively failing without asking
 * the reader to parse a diagram before they have read a word.
 *
 * MOTION: one strike, three branches, each on its own delay so the crack reads
 * as forking rather than as three lines animating in lockstep. A strike draws
 * on fast, flickers once, glows dim for a while, fades, and a long dark pause
 * follows before the next one — real lightning is irregular and mostly dark,
 * and irregularity here is what keeps it from feeling like a UI spinner.
 * Keyframes live in globals.css beside the tour ring; colour is the ramp's red,
 * never a literal from this file.
 */

const TRUNK =
  "M 300,-10 L 265,45 L 305,75 L 235,115 L 280,150 L 205,185 L 250,220 L 190,255 L 220,300";
const BRANCH_A = "M 235,115 L 150,140 L 175,175 L 95,200 L 130,240 L 60,280";
const BRANCH_B = "M 250,220 L 350,205 L 320,245 L 390,265 L 360,310";

function CrackPath({ d, delay }: { d: string; delay: string }) {
  return (
    <path
      d={d}
      pathLength={1}
      className="hero-crack-path"
      style={{ animationDelay: delay }}
    />
  );
}

export function HeroCrack() {
  return (
    // Capped to the text block's own height rather than the whole hero band:
    // the band also carries the tall demo screenshot below, and stretching a
    // fixed-proportion crack across that full height (a `preserveAspectRatio:
    // none` SVG scales x and y independently) turned it into one thin,
    // over-elongated diagonal — the jaggedness that reads as "crack" needs a
    // roughly-square-ish area to survive the stretch.
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-x-0 top-0 h-[340px] overflow-hidden sm:h-[480px] lg:h-[560px]"
    >
      <svg
        viewBox="0 0 460 340"
        preserveAspectRatio="none"
        className="h-full w-full"
      >
        <CrackPath d={TRUNK} delay="0s" />
        <CrackPath d={BRANCH_A} delay="0.12s" />
        <CrackPath d={BRANCH_B} delay="0.2s" />
      </svg>
    </div>
  );
}
