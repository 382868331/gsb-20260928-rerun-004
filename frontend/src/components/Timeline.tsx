import { useRef } from "react";
import { useEditor } from "../store";

const TRACK_COLORS = ["#364fc7", "#0b7285", "#2b8a3e", "#c92a2a", "#862e9c", "#d9480f"];

export function Timeline() {
  const keyframes = useEditor((s) => s.keyframes);
  const duration = useEditor((s) => s.duration);
  const time = useEditor((s) => s.currentTime);
  const setTime = useEditor((s) => s.setTime);
  const selectedKey = useEditor((s) => s.selectedKeyTime);
  const selectKey = useEditor((s) => s.selectKey);
  const moveKeyframe = useEditor((s) => s.moveKeyframe);
  const duplicateKeyframe = useEditor((s) => s.duplicateKeyframe);
  const removeKeyframe = useEditor((s) => s.removeKeyframe);
  const upsertKeyframe = useEditor((s) => s.upsertKeyframe);
  const trackRef = useRef<HTMLDivElement>(null);

  const total = duration ?? Math.max(1, ...keyframes.map((k) => k.time), 1);
  const pct = (t: number) => `${(t / total) * 100}%`;

  const timeFromEvent = (clientX: number) => {
    const rect = trackRef.current!.getBoundingClientRect();
    return Math.min(total, Math.max(0, ((clientX - rect.left) / rect.width) * total));
  };

  const onScrub = (e: React.MouseEvent) => {
    selectKey(null);
    setTime(timeFromEvent(e.clientX));
  };

  const startDrag = (t: number) => (e: React.MouseEvent) => {
    e.stopPropagation();
    selectKey(t);
    const move = (ev: MouseEvent) => {
      const nt = Math.round(timeFromEvent(ev.clientX) * 1000) / 1000;
      moveKeyframe(t, nt);
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  const allBones = new Set<string>();
  keyframes.forEach((k) => Object.keys(k.pose).forEach((b) => allBones.add(b)));
  const boneList = [...allBones].sort();

  return (
    <div className="timeline">
      <div className="timeline-row" ref={trackRef} onMouseDown={onScrub}>
        {Array.from({ length: 11 }, (_, i) => (
          <span key={i} className="tick" style={{ left: `${i * 10}%` }}>
            {((i / 10) * total).toFixed(1)}
          </span>
        ))}
        <div className="playhead" style={{ left: pct(time) }} />
        {keyframes.map((k) => (
          <button
            key={k.time}
            className={`key-dot ${selectedKey === k.time ? "selected" : ""}`}
            style={{ left: pct(k.time) }}
            title={`t=${k.time.toFixed(3)}
左键拖动移动；双击复制到当前播放头；右键删除`}
            onMouseDown={startDrag(k.time)}
            onDoubleClick={(e) => {
              e.stopPropagation();
              duplicateKeyframe(k.time, Math.round(time * 1000) / 1000);
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              removeKeyframe(k.time);
            }}
          />
        ))}
      </div>
      <div className="timeline-actions">
        <button onClick={() => upsertKeyframe(Math.round(time * 1000) / 1000, {})}>
          ◆ 在 {time.toFixed(2)} 打关键帧
        </button>
        <span className="hint">拖动移动 · 双击复制 · 右键删除</span>
        <span className="time-readout">t = {time.toFixed(3)}s</span>
      </div>
      <div className="tracks">
        {boneList.map((b, i) => (
          <div className="track" key={b}>
            <span className="track-name" style={{ color: TRACK_COLORS[i % TRACK_COLORS.length] }}>
              {b}
            </span>
            {keyframes
              .filter((k) => b in k.pose)
              .map((k) => (
                <i
                  key={k.time}
                  className="track-seg"
                  style={{ left: pct(k.time), background: TRACK_COLORS[i % TRACK_COLORS.length] }}
                />
              ))}
          </div>
        ))}
      </div>
    </div>
  );
}
