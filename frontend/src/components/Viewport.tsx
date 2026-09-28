import { useMemo } from "react";
import { useEditor } from "../store";
import { evaluateAt } from "../lib/anim";

const SCALE = 220;
const CX = 300;
const CY = 360;

/** 数学坐标（y 朝上）转 SVG 坐标（y 朝下）。 */
function tx(x: number) {
  return CX + x * SCALE;
}
function ty(y: number) {
  return CY - y * SCALE;
}

export function Viewport() {
  const skeleton = useEditor((s) => s.skeleton);
  const keyframes = useEditor((s) => s.keyframes);
  const time = useEditor((s) => s.currentTime);
  const selected = useEditor((s) => s.selectedBone);
  const selectBone = useEditor((s) => s.selectBone);
  const setBoneRotation = useEditor((s) => s.setBoneRotation);

  const world = useMemo(
    () => evaluateAt(skeleton, keyframes, time),
    [skeleton, keyframes, time],
  );

  const bones = Object.values(world);

  return (
    <div className="viewport">
      <svg viewBox="0 0 600 520" role="img" aria-label="角色视口">
        <line x1={0} y1={CY} x2={600} y2={CY} stroke="#e3e8ef" />
        <line x1={CX} y1={0} x2={CX} y2={520} stroke="#e3e8ef" />
        {bones.map((b) => {
          const isSel = b.id === selected;
          return (
            <g key={b.id} className="bone" onClick={() => selectBone(b.id)}>
              {b.length > 0 && (
                <line
                  x1={tx(b.x)}
                  y1={ty(b.y)}
                  x2={tx(b.endX)}
                  y2={ty(b.endY)}
                  stroke={isSel ? "#e8590c" : "#364fc7"}
                  strokeWidth={isSel ? 7 : 5}
                  strokeLinecap="round"
                />
              )}
              <circle
                cx={tx(b.x)}
                cy={ty(b.y)}
                r={b.length === 0 ? 6 : 4}
                fill={isSel ? "#e8590c" : "#1c2b4a"}
              />
              {isSel && (
                <text x={tx(b.x) + 10} y={ty(b.y) - 10} className="bone-label">
                  {b.id}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {selected && (
        <div className="viewport-controls">
          <span>旋转 {selected}：</span>
          <button onClick={() => setBoneRotation(selected, -0.1)}>⟲ -0.1</button>
          <button onClick={() => setBoneRotation(selected, 0.1)}>⟳ +0.1</button>
          <button onClick={() => selectBone(null)}>取消选择</button>
        </div>
      )}
    </div>
  );
}
