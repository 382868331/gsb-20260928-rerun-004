import { useEffect, useMemo, useRef, useState } from "react";
import { Copy, Pause, Play, RotateCcw, Save, TriangleAlert } from "lucide-react";
import { api } from "./api";
import {
  duplicateKeyframe,
  duplicateLayerKeyframe,
  exportAction,
  moveKeyframe,
  moveLayerKeyframe,
  orderedKeyframes,
  orderedLayerKeyframes,
  layerWeight,
  setLayerEnabled,
  toggleLayerBone,
  updateLayer,
  updateLayerPose,
  updatePose,
  validateProject,
  type AnimationLayer,
  type Project,
} from "./animation";
import { defaultProject } from "./defaultProject";
import { SkeletonCanvas } from "./SkeletonCanvas";

type ConsistencyReport = { ok: boolean; message: string };

function nearestEditableFrame(project: Project, time: number) {
  return [...project.keyframes].sort((a, b) => Math.abs(a.time - time) - Math.abs(b.time - time))[0];
}

function nearestLayerFrame(layer: AnimationLayer, time: number) {
  return orderedLayerKeyframes(layer).sort((a, b) => Math.abs(a.time - time) - Math.abs(b.time - time))[0];
}

export default function App() {
  const [project, setProject] = useState<Project>(defaultProject);
  const [history, setHistory] = useState<Project[]>([]);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [selectedBoneId, setSelectedBoneId] = useState("upper_arm_r");
  const [activeLayerId, setActiveLayerId] = useState<string>("base");
  const [message, setMessage] = useState("已载入内置简单角色；可启动 Python 服务后保存。");
  const [report, setReport] = useState<ConsistencyReport | null>(null);
  const frameRef = useRef<number | null>(null);
  const startRef = useRef({ wall: 0, animation: 0 });

  const errors = useMemo(() => validateProject(project), [project]);
  const frames = useMemo(() => orderedKeyframes(project), [project]);
  const activeLayer = useMemo(
    () => (activeLayerId === "base" ? undefined : project.layers?.find((layer) => layer.id === activeLayerId)),
    [activeLayerId, project.layers],
  );
  const editingFrame = useMemo(
    () => (activeLayer ? nearestLayerFrame(activeLayer, time) : nearestEditableFrame(project, time)),
    [activeLayer, project, time],
  );
  const selectedBone = project.skeleton.bones.find((bone) => bone.id === selectedBoneId) ?? project.skeleton.bones[0];
  const boneControlledByLayer = activeLayer && !activeLayer.bones.includes(selectedBone.id);
  const transform = editingFrame?.pose[selectedBone.id];
  const activeWeight = activeLayer ? layerWeight(activeLayer, time) : 1;

  useEffect(() => {
    api<{ project: Project }>("/api/project")
      .then((data) => {
        setProject(data.project);
        setHistory([]);
        setMessage("已从 Python 工程存储载入。");
      })
      .catch(() => undefined);
  }, []);

  const commit = (next: Project, notice?: string) => {
    if (validateProject(next).length > 0) {
      setMessage("存在骨架冲突，请先修正后再继续编辑。");
      return;
    }
    setHistory((items) => [...items.slice(-49), project]);
    setProject(next);
    if (notice) setMessage(notice);
    setReport(null);
  };

  useEffect(() => {
    if (!playing) return;
    startRef.current = { wall: performance.now(), animation: time };
    const tick = (now: number) => {
      const elapsed = (now - startRef.current.wall) / 1000;
      const nextTime = startRef.current.animation + elapsed;
      if (nextTime >= project.duration) {
        setTime(0);
        startRef.current = { wall: performance.now(), animation: 0 };
      } else {
        setTime(nextTime);
      }
      frameRef.current = requestAnimationFrame(tick);
    };
    frameRef.current = requestAnimationFrame(tick);
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    };
  }, [playing, project.duration]);

  const undo = () => {
    const previous = history.at(-1);
    if (!previous) return;
    setProject(previous);
    setHistory((items) => items.slice(0, -1));
    setReport(null);
    setMessage("已撤销上一步编辑。");
  };

  const save = async () => {
    if (errors.length) return;
    try {
      await api("/api/project", { method: "POST", body: JSON.stringify(project) });
      const backendExport = await api<ReturnType<typeof exportAction>>(`/api/export?fps=24`);
      const localExport = exportAction(project, 24);
      const sameFrames = backendExport.frames.length === localExport.frames.length;
      const maxDifference = sameFrames
        ? Math.max(...backendExport.frames.flatMap((frame, index) => {
            const localFrame = localExport.frames[index];
            return project.skeleton.bones.map((bone) => {
              const a = frame.world[bone.id];
              const b = localFrame.world[bone.id];
              return Math.hypot(a.x - b.x, a.y - b.y, a.rotation - b.rotation);
            });
          }))
        : Number.POSITIVE_INFINITY;
      const ok = sameFrames && maxDifference < 1e-9;
      setReport({ ok, message: ok ? `播放、求值与导出一致：${localExport.frames.length} 帧，最大误差 0。` : `导出不一致，最大误差 ${maxDifference}` });
      setMessage("工程已保存；播放数据来自保存后的同一工程。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存失败");
    }
  };

  const downloadExport = () => {
    const blob = new Blob([JSON.stringify(exportAction(project, 24), null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${project.name || "action"}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <main className="app-shell">
      <header>
        <div>
          <p className="eyebrow">Character Animation Desk</p>
          <h1>角色动画制作台</h1>
        </div>
        <div className="header-actions">
          <button onClick={undo} disabled={!history.length || errors.length > 0}><RotateCcw size={16} />撤销</button>
          <button className="primary" onClick={save} disabled={errors.length > 0}><Save size={16} />保存并核对</button>
          <button onClick={downloadExport} disabled={errors.length > 0}>导出动作</button>
        </div>
      </header>

      {errors.length > 0 && (
        <section className="conflicts" role="alert">
          <TriangleAlert size={18} />
          <div><strong>骨架结构冲突</strong><ul>{errors.map((error) => <li key={error}>{error}</li>)}</ul></div>
        </section>
      )}

      <section className="workspace">
        <div className="stage-card card">
          <div className="card-title"><h2>任意时刻求值</h2><span>{project.name}</span></div>
          <SkeletonCanvas project={project} time={time} selectedBoneId={selectedBone.id} onSelectBone={setSelectedBoneId} />
          <div className="transport">
            <button className="play" onClick={() => setPlaying((value) => !value)}>
              {playing ? <Pause size={18} /> : <Play size={18} />}
            </button>
            <input
              type="range"
              min={0}
              max={project.duration}
              step={0.001}
              value={time}
              onChange={(event) => { setPlaying(false); setTime(Number(event.target.value)); }}
            />
            <strong>{time.toFixed(3)}s</strong>
          </div>
        </div>

        <aside className="inspector card">
          <h2>姿态编辑</h2>
          <label>动作层
            <select value={activeLayerId} onChange={(event) => setActiveLayerId(event.target.value)}>
              <option value="base">基础层（全身走路）</option>
              {(project.layers ?? []).map((layer) => <option key={layer.id} value={layer.id}>{layer.name}{layer.enabled ? '' : '（停用）'}</option>)}
            </select>
          </label>
          <label>骨骼
            <select value={selectedBone.id} onChange={(event) => setSelectedBoneId(event.target.value)} disabled={Boolean(boneControlledByLayer)}>
              {project.skeleton.bones.map((bone) => {
                const inLayer = activeLayer?.bones.includes(bone.id);
                return <option key={bone.id} value={bone.id}>{bone.name}{activeLayer ? (inLayer ? ' · 受本层影响' : ' · 非本层骨骼') : ''}</option>;
              })}
            </select>
          </label>
          <p className="hint">
            正在修改最近的关键姿态：<strong>{editingFrame?.time.toFixed(2)}s</strong>。
            {activeLayer
              ? <> 当前时刻层权重 <strong>{activeWeight.toFixed(2)}</strong>；仅作用骨骼叠加到基础层，其余骨骼保持基础层姿态。</>
              : <> 旋转父骨骼会驱动所有子骨骼。</>}
          </p>
          {boneControlledByLayer && <p className="hint warn">该骨骼不在本层作用范围内，请在基础层编辑，或先把该骨骼加入本层。</p>}
          {transform && !boneControlledByLayer && <>
            <label>局部 X 坐标
              <input type="range" min="-120" max="120" step="1" value={transform.x}
                onChange={(event) => commit(activeLayer
                  ? updateLayerPose(project, activeLayer.id, editingFrame.id, selectedBone.id, { x: Number(event.target.value) })
                  : updatePose(project, editingFrame.id, selectedBone.id, { x: Number(event.target.value) }))} />
            </label>
            <label>局部 Y 坐标
              <input type="range" min="-120" max="120" step="1" value={transform.y}
                onChange={(event) => commit(activeLayer
                  ? updateLayerPose(project, activeLayer.id, editingFrame.id, selectedBone.id, { y: Number(event.target.value) })
                  : updatePose(project, editingFrame.id, selectedBone.id, { y: Number(event.target.value) }))} />
            </label>
            <label>局部旋转（叠加层为相对参考姿态的局部旋转增量）
              <input type="range" min="-360" max="360" step="1" value={transform.rotation}
                onChange={(event) => commit(activeLayer
                  ? updateLayerPose(project, activeLayer.id, editingFrame.id, selectedBone.id, { rotation: Number(event.target.value) })
                  : updatePose(project, editingFrame.id, selectedBone.id, { rotation: Number(event.target.value) }))} />
            </label>
            <div className="transform-values"><span>x {transform.x.toFixed(1)}</span><span>y {transform.y.toFixed(1)}</span><span>θ {transform.rotation.toFixed(1)}°</span></div>
          </>}
        </aside>
      </section>

      <section className="timeline card">
        <div className="card-title"><h2>{activeLayer ? `动作层关键姿态 · ${activeLayer.name}` : '基础层关键姿态时间轴'}</h2><span>移动滑块会同时修改时间；复制会保留完整姿态；层内关键帧独立编辑</span></div>
        <div className="keyframe-list">
          {activeLayer
            ? orderedLayerKeyframes(activeLayer).map((frame) => <div key={frame.id} className={frame.id === editingFrame?.id ? "keyframe active" : "keyframe"}>
              <button onClick={() => { setPlaying(false); setTime(frame.time); }}>{frame.time.toFixed(2)}s</button>
              <input type="range" min={activeLayer.start} max={activeLayer.end} step={0.01} value={frame.time}
                onChange={(event) => commit(moveLayerKeyframe(project, activeLayer.id, frame.id, Number(event.target.value)), "层关键姿态已移动。")} />
              <button title="复制关键姿态" onClick={() => commit(duplicateLayerKeyframe(project, activeLayer.id, frame.id), "层关键姿态已复制。")}><Copy size={15} /></button>
            </div>)
            : frames.map((frame) => <div key={frame.id} className={frame.id === editingFrame?.id ? "keyframe active" : "keyframe"}>
              <button onClick={() => { setPlaying(false); setTime(frame.time); }}>{frame.time.toFixed(2)}s</button>
              <input type="range" min={0} max={project.duration} step={0.01} value={frame.time}
                onChange={(event) => commit(moveKeyframe(project, frame.id, Number(event.target.value)), "关键姿态已移动。")} />
              <button title="复制关键姿态" onClick={() => commit(duplicateKeyframe(project, frame.id), "关键姿态已复制。")}><Copy size={15} /></button>
            </div>)}
        </div>
        <div className="duration-row">
          <label>动画时长<input type="number" min={0.1} step={0.1} value={project.duration}
            onChange={(event) => commit({ ...project, duration: Number(event.target.value) }, "动画时长已更新。")} /></label>
          <p className={report?.ok ? "report ok" : "report warn"}>{report?.message ?? message}</p>
        </div>
      </section>

      <section className="layers card">
        <div className="card-title"><h2>动作分层</h2><span>叠加层在局部空间按权重叠加到基础层；父骨骼未选择时，子骨骼只跟随基础层父骨骼旋转，不会产生歧义</span></div>
        <div className="layer-list">
          {(project.layers ?? []).map((layer) => {
            const weightNow = layerWeight(layer, time);
            return <div key={layer.id} className={layer.id === activeLayerId ? "layer-row active" : "layer-row"}>
              <div className="layer-head">
                <button className="layer-name" onClick={() => setActiveLayerId(layer.id)}>{layer.name}</button>
                <label className="enable"><input type="checkbox" checked={layer.enabled}
                  onChange={(event) => commit(setLayerEnabled(project, layer.id, event.target.checked), event.target.checked ? '动作层已启用。' : '动作层已停用，姿态平滑回到基础层。')} />启用</label>
                <span className={weightNow > 0 ? 'weight-pill on' : 'weight-pill'}>当前权重 {weightNow.toFixed(2)}</span>
              </div>
              <div className="layer-controls">
                <label>层权重<input type="range" min={0} max={1} step={0.05} value={layer.weight}
                  onChange={(event) => commit(updateLayer(project, layer.id, { weight: Number(event.target.value) }))} /></label>
                <label>开始<input type="number" min={0} step={0.05} value={layer.start}
                  onChange={(event) => commit(updateLayer(project, layer.id, { start: Number(event.target.value) }))} /></label>
                <label>结束<input type="number" min={0} step={0.05} value={layer.end}
                  onChange={(event) => commit(updateLayer(project, layer.id, { end: Number(event.target.value) }))} /></label>
                <label>淡入<input type="number" min={0} step={0.05} value={layer.fade_in}
                  onChange={(event) => commit(updateLayer(project, layer.id, { fade_in: Number(event.target.value) }))} /></label>
                <label>淡出<input type="number" min={0} step={0.05} value={layer.fade_out}
                  onChange={(event) => commit(updateLayer(project, layer.id, { fade_out: Number(event.target.value) }))} /></label>
              </div>
              <div className="bone-mask">
                <span>作用骨骼：</span>
                {project.skeleton.bones.map((bone) => {
                  const checked = layer.bones.includes(bone.id);
                  return <button key={bone.id} className={checked ? 'mask-chip selected' : 'mask-chip'}
                    onClick={() => commit(toggleLayerBone(project, layer.id, bone.id), checked ? '已从作用骨骼移除。' : '已加入作用骨骼。')}>{bone.name}</button>;
                })}
              </div>
            </div>;
          })}
        </div>
      </section>
    </main>
  );
}
