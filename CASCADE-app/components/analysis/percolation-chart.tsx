"use client";

import type { PercolationPoint } from "@/lib/topological-analysis";
import { brandColor } from "@/lib/brand";

interface PercolationChartProps {
  curve: PercolationPoint[];
  title?: string;
}

/** Simple SVG line chart for the percolation robustness curve. */
export function PercolationChart({ curve, title = "Percolation Robustness" }: PercolationChartProps) {
  if (curve.length < 2) return null;

  const W = 320;
  const H = 160;
  const PAD = { top: 16, right: 8, bottom: 32, left: 36 };
  const chartW = W - PAD.left - PAD.right;
  const chartH = H - PAD.top - PAD.bottom;

  const toX = (v: number) => PAD.left + v * chartW;
  const toY = (v: number) => PAD.top + (1 - v) * chartH;

  const pathD = curve
    .map((p, i) => `${i === 0 ? "M" : "L"} ${toX(p.fractionRemoved).toFixed(1)} ${toY(p.giantComponentFraction).toFixed(1)}`)
    .join(" ");

  // Area fill
  const areaD = `${pathD} L ${toX(curve[curve.length - 1].fractionRemoved).toFixed(1)} ${toY(0).toFixed(1)} L ${toX(0).toFixed(1)} ${toY(0).toFixed(1)} Z`;

  // Axis tick labels
  const xTicks = [0, 0.25, 0.5, 0.75, 1.0];
  const yTicks = [0, 0.25, 0.5, 0.75, 1.0];

  // Robustness index R = area under curve (trapezoid approx)
  let R = 0;
  for (let i = 1; i < curve.length; i++) {
    const dx = curve[i].fractionRemoved - curve[i - 1].fractionRemoved;
    R += dx * (curve[i].giantComponentFraction + curve[i - 1].giantComponentFraction) / 2;
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-zinc-600 dark:text-zinc-300">{title}</span>
        <span className="rounded bg-blue-50 px-2 py-0.5 text-[10px] font-mono text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
          R = {R.toFixed(3)}
        </span>
      </div>

      <svg width={W} height={H} className="w-full" viewBox={`0 0 ${W} ${H}`}>
        {/* Grid lines */}
        {yTicks.map((t) => (
          <line
            key={t}
            x1={PAD.left} y1={toY(t)}
            x2={PAD.left + chartW} y2={toY(t)}
            stroke={brandColor("neutral", 200)} strokeWidth={0.5}
          />
        ))}

        {/* Area fill */}
        <path d={areaD} fill="rgb(224,231,255)" opacity={0.5} />

        {/* Line */}
        <path d={pathD} fill="none" stroke="rgb(49,46,129)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />

        {/* X-axis */}
        <line x1={PAD.left} y1={PAD.top + chartH} x2={PAD.left + chartW} y2={PAD.top + chartH} stroke={brandColor("neutral", 400)} strokeWidth={1} />
        {xTicks.map((t) => (
          <text key={t} x={toX(t)} y={PAD.top + chartH + 14} textAnchor="middle" fontSize={9} fill={brandColor("neutral", 400)}>
            {Math.round(t * 100)}%
          </text>
        ))}

        {/* Y-axis */}
        <line x1={PAD.left} y1={PAD.top} x2={PAD.left} y2={PAD.top + chartH} stroke={brandColor("neutral", 400)} strokeWidth={1} />
        {yTicks.map((t) => (
          <text key={t} x={PAD.left - 4} y={toY(t) + 3} textAnchor="end" fontSize={9} fill={brandColor("neutral", 400)}>
            {Math.round(t * 100)}%
          </text>
        ))}

        {/* Axis labels */}
        <text x={PAD.left + chartW / 2} y={H - 2} textAnchor="middle" fontSize={9} fill={brandColor("neutral", 500)}>
          Fraction removed
        </text>
        <text
          x={10} y={PAD.top + chartH / 2}
          textAnchor="middle" fontSize={9} fill={brandColor("neutral", 500)}
          transform={`rotate(-90, 10, ${PAD.top + chartH / 2})`}
        >
          Giant component
        </text>
      </svg>
    </div>
  );
}
