import { useId } from "react";
import { planePoints, type PlanePoint } from "@progress-island/shared";

export function PlaneFigure({ given }: { given: string[] }) {
  const markerId = useId().replace(/:/g, "");
  const points = planePoints(given);
  if (points.length < 2) return null;
  const byName = new Map(points.map((point) => [point.name, point]));
  const origin = byName.get("C") ?? points[0];
  const facing = byName.get("A");
  const goal = byName.get("B");
  const frame = frameOf(points, origin, facing, goal);
  const to = (point: PlanePoint) => frame.project(point.x, point.y);
  const turn = origin && facing && goal ? arc(origin, facing, goal, frame) : null;
  return (
    <figure className="exam-figure">
      <svg viewBox={`0 0 ${frame.width} ${frame.height}`} role="img" aria-label="The cart at C faces A, turns toward B, then travels from C to B.">
        <title>The cart at C faces A, turns toward B, then travels from C to B.</title>
        <defs>
          <marker id={markerId} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
            <path d="M 0 0 L 8 4 L 0 8 z" fill="var(--accent)" />
          </marker>
        </defs>
        {turn && <path d={turn.d} fill="none" stroke="var(--clay)" strokeWidth="2.5" />}
        {origin && facing && <Facing origin={origin} facing={facing} project={frame.project} markerId={markerId} />}
        {origin && goal && (
          <line x1={to(origin).x} y1={to(origin).y} x2={to(goal).x} y2={to(goal).y} stroke="var(--moss)" strokeWidth="3" />
        )}
        {points.map((point) => {
          const at = to(point);
          return (
            <g key={point.name}>
              <circle cx={at.x} cy={at.y} r="4.5" fill="var(--ink)" />
              <text x={at.x + 8} y={at.y - 8} fill="var(--ink)" fontSize="16">
                {point.name}
              </text>
            </g>
          );
        })}
        {turn && (
          <text x={turn.labelX} y={turn.labelY} fill="var(--clay)" fontSize="16">
            turn
          </text>
        )}
      </svg>
      <figcaption>
        The arrow is the direction the cart faces at the start. The arc is the smaller turn until it faces B. The green
        segment is the straight path it then travels.
      </figcaption>
    </figure>
  );
}

function Facing({
  origin,
  facing,
  project,
  markerId,
}: {
  origin: PlanePoint;
  facing: PlanePoint;
  project: (x: number, y: number) => { x: number; y: number };
  markerId: string;
}) {
  const dx = facing.x - origin.x;
  const dy = facing.y - origin.y;
  const length = Math.hypot(dx, dy) || 1;
  const reach = Math.min(length * 0.45, Math.max(length - 0.6, length * 0.45));
  const tip = project(origin.x + (dx / length) * reach, origin.y + (dy / length) * reach);
  const start = project(origin.x, origin.y);
  return (
    <line x1={start.x} y1={start.y} x2={tip.x} y2={tip.y} stroke="var(--accent)" strokeWidth="2.5" markerEnd={`url(#${markerId})`} />
  );
}

function arc(
  origin: PlanePoint,
  facing: PlanePoint,
  goal: PlanePoint,
  frame: { project: (x: number, y: number) => { x: number; y: number }; scale: number },
): { d: string; labelX: number; labelY: number } | null {
  const start = Math.atan2(facing.y - origin.y, facing.x - origin.x);
  const end = Math.atan2(goal.y - origin.y, goal.x - origin.x);
  let sweep = end - start;
  while (sweep > Math.PI) sweep -= 2 * Math.PI;
  while (sweep < -Math.PI) sweep += 2 * Math.PI;
  if (Math.abs(sweep) < 1e-4) return null;
  const nearest = Math.min(
    Math.hypot(facing.x - origin.x, facing.y - origin.y),
    Math.hypot(goal.x - origin.x, goal.y - origin.y),
  );
  const radius = Math.max(nearest * 0.32, 0.7);
  const at = (angle: number) => frame.project(origin.x + radius * Math.cos(angle), origin.y + radius * Math.sin(angle));
  const from = at(start);
  const to = at(start + sweep);
  const mid = at(start + sweep / 2);
  const pixel = radius * frame.scale;
  const flag = sweep > 0 ? 0 : 1;
  return {
    d: `M ${from.x} ${from.y} A ${pixel} ${pixel} 0 0 ${flag} ${to.x} ${to.y}`,
    labelX: mid.x + 8,
    labelY: mid.y + 4,
  };
}

function frameOf(points: PlanePoint[], origin?: PlanePoint, facing?: PlanePoint, goal?: PlanePoint) {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  let minX = Math.min(...xs);
  let maxX = Math.max(...xs);
  let minY = Math.min(...ys);
  let maxY = Math.max(...ys);
  if (origin && facing && goal) {
    const radius =
      Math.min(Math.hypot(facing.x - origin.x, facing.y - origin.y), Math.hypot(goal.x - origin.x, goal.y - origin.y)) * 0.32;
    minX = Math.min(minX, origin.x - radius);
    maxX = Math.max(maxX, origin.x + radius);
    minY = Math.min(minY, origin.y - radius);
    maxY = Math.max(maxY, origin.y + radius);
  }
  const span = Math.max(maxX - minX, maxY - minY, 1);
  const padWorld = span * 0.2;
  minX -= padWorld;
  maxX += padWorld;
  minY -= padWorld;
  maxY += padWorld;
  const width = 560;
  const height = 340;
  const margin = 28;
  const scale = Math.min((width - margin * 2) / (maxX - minX), (height - margin * 2) / (maxY - minY));
  const usedW = (maxX - minX) * scale;
  const usedH = (maxY - minY) * scale;
  const offsetX = (width - usedW) / 2;
  const offsetY = (height - usedH) / 2;
  return {
    width,
    height,
    scale,
    project: (x: number, y: number) => ({
      x: offsetX + (x - minX) * scale,
      y: offsetY + (maxY - y) * scale,
    }),
  };
}
