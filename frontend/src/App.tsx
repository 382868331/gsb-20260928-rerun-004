import { useEffect, useMemo, useRef, useState } from "react";
import { Copy, Pause, Play, RotateCcw, Save, TriangleAlert, Wand2, Trash2 } from "lucide-react";
import { api } from "./api";
import {
  addLayerKeyframe,
  actionIsCurrent,
  addWeightKeyframe,
  consolidateLayers,
  duplicateKeyframe,
  exportAction,
  moveKeyframe,
  orderedKeyframes,
  removeBakedAction,
  removeWeightKeyframe,
  setActiveAction,
  updateLayer,
  updateLayerPose,
  updateWeightKeyframe,
  updatePose,
  validateProject,
  layerEnvelope,
  sampleLocal,
  layerWeightAt,
  type Project,
} from "./animation";
import { defaultProject } from "./defaultProject";
import { SkeletonCanvas } from "./SkeletonCanvas";

type ConsistencyReport = { ok: boolean; message: string };

function nearestEditableFrame(project: Project, time: number) {
  return [...project.keyframes].sort((a, b) => Math.abs(a.time - time) - Math.abs(b.time - time))[0];
}

export default function App() {
  const [project, setProject] = useState<Project>(defaultProject);
  const [history, setHistory] = useState<Project[]>([]);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [selectedBoneId, setSelectedBoneId] = useState("upper_arm_r");
  const [activeLayerId, setActiveLayerId] = useState<string | null>(null);
  const [message, setMessage] = useState("已载入内置简单角色；可启动 Python 服务后保存。");
  const [report, setReport] = useState<ConsistencyReport | null>(null);
  const [consolidateStart, setConsolidateStart] = useState(0);
  const [consolidateEnd, setConsolidateEnd] = useState(defaultProject.duration);
  const [consolidateBones, setConsolidateBones] = useState<string[]>([]);
  const frameRef = useRef<number | null>(null);
  const startRef = useRef({ wall: 0, animation: 0 });

  const errors = useMemo(() => validateProject(project), [project]);
  const frames = useMemo(() => orderedKeyframes(project), [project]);
  const editingFrame = useMemo(() => nearestEditableFrame(project, time), [project, time]);
  const activeLayer = useMemo(
    () => project.layers?.find((layer) => layer.id === activeLayerId) ?? null,
    [project, activeLayerId],
  );
  const layerEditingFrame = useMemo(() => {
    if (!activeLayer) return null;
    return [...activeLayer.keyframes].sort((a, b) => Math.abs(a.time - time) - Math.abs(b.time - time))[0];
  }, [activeLayer, time]);
  const selectedBone = project.skeleton.bones.find((bone) => bone.id === selectedBoneId) ?? project.skeleton.bones[0];
  const layerOwnsBone = activeLayer?.bones.includes(selectedBone.id) ?? false;
  const transform = activeLayer
    ? (layerOwnsBone ? layerEditingFrame?.pose[selectedBone.id] : undefined)
    : editingFrame?.pose[selectedBone.id];
  const layerWeightNow = activeLayer ? layerEnvelope(activeLayer, time) : 0;

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
      const activeActionId = project.active_action_id ?? undefined;
      const backendExport = await api<ReturnType<typeof exportAction>>(`/api/export?fps=24${activeActionId ? `&action_id=${encodeURIComponent(activeActionId)}` : ""}`);
      const localExport = exportAction(project, 24, activeActionId);
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

  const runConsolidate = async () => {
    try {
      const result = consolidateLayers(project, {
        start: consolidateStart,
        end: consolidateEnd,
        bones: consolidateBones,
        name: `整理 ${consolidateStart.toFixed(2)}-${consolidateEnd.toFixed(2)}s`,
      });
      try {
        await api("/api/consolidate", {
          method: "POST",
          body: JSON.stringify({ start: consolidateStart, end: consolidateEnd, bones: consolidateBones, name: `整理 ${consolidateStart.toFixed(2)}-${consolidateEnd.toFixed(2)}s`, fps: 24 }),
        });
      } catch {
        // 后端不可用时仍保留本地整理结果，保存按钮之后会提示。
      }
      setHistory((items) => [...items.slice(-49), project]);
      setProject(result.project);
      setMessage(result.notices[0]);
      setReport(null);
    } catch (error) {
      const messages = error instanceof Error && "errors" in error ? (error as { errors: string[] }).errors : [String(error)];
      setMessage(`未提交整理结果：${messages.join("；")}`);
    }
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
          <label>编辑目标
            <select value={activeLayerId ?? "__base__"} onChange={(event) => setActiveLayerId(event.target.value === "__base__" ? null : event.target.value)}>
              <option value="__base__">基础动作（全身）</option>
              {project.layers?.map((layer) => <option key={layer.id} value={layer.id}>{layer.name}</option>)}
            </select>
          </label>
          <label>骨骼
            <select value={selectedBone.id} onChange={(event) => setSelectedBoneId(event.target.value)}
              disabled={!!activeLayer && !layerOwnsBone}>
              {project.skeleton.bones.map((bone) => <option key={bone.id} value={bone.id}>{bone.name}</option>)}
            </select>
          </label>
          {activeLayer && !layerOwnsBone && <p className="hint warn">骨骼「{selectedBone.name}」不在层「{activeLayer.name}」的作用范围，该骨骼保持基础动作结果；要编辑请切回基础动作。</p>}
          {activeLayer && layerOwnsBone && <p className="hint">正在修改层关键姿态：<strong>{layerEditingFrame?.time.toFixed(2)}s</strong>；当前时刻层权重 <strong>{(layerWeightNow * 100).toFixed(0)}%</strong>。仅覆盖层内骨骼的局部姿态，子骨骼再按父子旋转累积。</p>}
          {!activeLayer && <p className="hint">正在修改最近的关键姿态：<strong>{frames.find((frame) => frame.id === editingFrame.id)?.time.toFixed(2)}s</strong>。旋转父骨骼会驱动所有子骨骼。</p>}
          {transform && <>
            <label>局部 X 坐标
              <input type="range" min="-120" max="120" step="1" value={transform.x}
                onChange={(event) => commit(activeLayer && layerEditingFrame
                  ? updateLayerPose(project, activeLayer.id, layerEditingFrame.id, selectedBone.id, { x: Number(event.target.value) })
                  : updatePose(project, editingFrame.id, selectedBone.id, { x: Number(event.target.value) }))} />
            </label>
            <label>局部 Y 坐标
              <input type="range" min="-120" max="120" step="1" value={transform.y}
                onChange={(event) => commit(activeLayer && layerEditingFrame
                  ? updateLayerPose(project, activeLayer.id, layerEditingFrame.id, selectedBone.id, { y: Number(event.target.value) })
                  : updatePose(project, editingFrame.id, selectedBone.id, { y: Number(event.target.value) }))} />
            </label>
            <label>局部旋转
              <input type="range" min="-360" max="360" step="1" value={transform.rotation}
                onChange={(event) => commit(activeLayer && layerEditingFrame
                  ? updateLayerPose(project, activeLayer.id, layerEditingFrame.id, selectedBone.id, { rotation: Number(event.target.value) })
                  : updatePose(project, editingFrame.id, selectedBone.id, { rotation: Number(event.target.value) }))} />
            </label>
            <div className="transform-values"><span>x {transform.x.toFixed(1)}</span><span>y {transform.y.toFixed(1)}</span><span>θ {transform.rotation.toFixed(1)}°</span></div>
          </>}
        </aside>
      </section>

      {project.layers && project.layers.length > 0 && (
        <section className="layers card">
          <div className="card-title"><h2>动作分层</h2><span>层在局部姿态空间按权重覆盖作用骨骼，再做父子旋转求值</span></div>
          {project.layers.map((layer) => {
            const weightNow = layerEnvelope(layer, time);
            return <div key={layer.id} className={layer.id === activeLayerId ? "layer-row active" : "layer-row"}>
              <div className="layer-head">
                <strong>{layer.name}</strong>
                <span>当前权重 {(weightNow * 100).toFixed(0)}%</span>
                <button onClick={() => setActiveLayerId(layer.id === activeLayerId ? null : layer.id)}>
                  {layer.id === activeLayerId ? "完成编辑" : "编辑此层"}
                </button>
                {layer.id === activeLayerId && <button onClick={() => commit(addLayerKeyframe(project, layer.id), "已新增层关键姿态。")}>+ 关键姿态</button>}
              </div>
              <div className="layer-controls">
                <label>权重<input type="number" min={0} max={1} step={0.05} value={layer.weight}
                  onChange={(event) => commit(updateLayer(project, layer.id, { weight: Number(event.target.value) }), "层权重已更新。")} /></label>
                <label>开始<input type="number" min={0} max={project.duration} step={0.05} value={layer.start}
                  onChange={(event) => commit(updateLayer(project, layer.id, { start: Number(event.target.value) }), "层时间范围已更新。")} /></label>
                <label>结束<input type="number" min={0} max={project.duration} step={0.05} value={layer.end}
                  onChange={(event) => commit(updateLayer(project, layer.id, { end: Number(event.target.value) }), "层时间范围已更新。")} /></label>
                <label>淡入<input type="number" min={0} step={0.05} value={layer.fade_in}
                  onChange={(event) => commit(updateLayer(project, layer.id, { fade_in: Number(event.target.value) }), "淡入时长已更新。")} /></label>
                <label>淡出<input type="number" min={0} step={0.05} value={layer.fade_out}
                  onChange={(event) => commit(updateLayer(project, layer.id, { fade_out: Number(event.target.value) }), "淡出时长已更新。")} /></label>
              </div>
              <div className="weight-transitions">
                <div className="weight-head">
                  <span>平滑权重过渡（支持中途反向拖动与重复播放）</span>
                  <button onClick={() => commit(addWeightKeyframe(project, layer.id, time), "已在当前时刻加入权重过渡点。")}>+ 过渡点 @{time.toFixed(2)}s</button>
                </div>
                {(layer.weight_keyframes ?? []).length === 0 && <p className="hint">当前使用固定权重 {layer.weight}；加入过渡点后层权重将在关键点间平滑插值。</p>}
                {(layer.weight_keyframes ?? []).map((point, index) => <div key={`${point.time}-${index}`} className="weight-row">
                  <label>时间<input type="number" min={0} max={project.duration} step={0.05} value={point.time}
                    onChange={(event) => commit(updateWeightKeyframe(project, layer.id, index, { time: Number(event.target.value) }), "过渡点时间已更新。")} /></label>
                  <label>权重<input type="range" min={0} max={1} step={0.01} value={point.weight}
                    onChange={(event) => commit(updateWeightKeyframe(project, layer.id, index, { weight: Number(event.target.value) }), "过渡权重已更新。")} /></label>
                  <label>缓动
                    <select value={point.easing} onChange={(event) => commit(updateWeightKeyframe(project, layer.id, index, { easing: event.target.value as "linear" | "smooth" }), "缓动方式已更新。")}>
                      <option value="smooth">平滑</option>
                      <option value="linear">线性</option>
                    </select>
                  </label>
                  <strong>{(point.weight * 100).toFixed(0)}%</strong>
                  <button onClick={() => commit(removeWeightKeyframe(project, layer.id, index), "已删除权重过渡点。")}><Trash2 size={14} /></button>
                </div>)}
                <p className="hint">当前时刻实际权重 <strong>{(layerWeightAt(layer, time) * 100).toFixed(0)}%</strong>（含淡入淡出）。</p>
              </div>
              <div className="layer-bones">
                <span>作用骨骼：</span>
                {project.skeleton.bones.map((bone) => {
                  const selected = layer.bones.includes(bone.id);
                  return <button key={bone.id} className={selected ? "chip selected" : "chip"} onClick={() => {
                    const nextBones = selected ? layer.bones.filter((id) => id !== bone.id) : [...layer.bones, bone.id];
                    const nextLayer = nextBones.length === 0 ? layer : {
                      ...layer,
                      bones: nextBones,
                      keyframes: layer.keyframes.map((frame) => {
                        const pose = { ...frame.pose };
                        if (selected) delete pose[bone.id];
                        else if (!pose[bone.id]) {
                          pose[bone.id] = { ...sampleLocal(project, frame.time)[bone.id] };
                        }
                        return { ...frame, pose };
                      }),
                    };
                    if (nextBones.length === 0) return;
                    commit(updateLayer(project, layer.id, nextLayer), selected ? "已移除作用骨骼。" : "已加入作用骨骼，关键姿态以当前混合姿态为初值。");
                  }}>{bone.name}</button>;
                })}
              </div>
              {layer.id === activeLayerId && <div className="keyframe-list">
                {[...layer.keyframes].sort((a, b) => a.time - b.time).map((frame) => <div key={frame.id} className="keyframe">
                  <button onClick={() => { setPlaying(false); setTime(frame.time); }}>{frame.time.toFixed(2)}s</button>
                  <input type="range" min={0} max={project.duration} step={0.01} value={frame.time}
                    onChange={(event) => commit(updateLayer(project, layer.id, { keyframes: layer.keyframes.map((item) => item.id === frame.id ? { ...item, time: Number(event.target.value) } : item) }), "层关键姿态已移动。")} />
                </div>)}
              </div>}
            </div>;
          })}
        </section>
      )}

      <section className="consolidate card">
        <div className="card-title"><h2>整理多层动作</h2><span>烘焙所选时间/骨骼的叠加结果为新动作；原动作层完整保留</span></div>
        <div className="consolidate-controls">
          <label>开始时间<input type="number" min={0} max={project.duration} step={0.05} value={consolidateStart}
            onChange={(event) => setConsolidateStart(Math.min(Number(event.target.value), consolidateEnd))} /></label>
          <label>结束时间<input type="number" min={0} max={project.duration} step={0.05} value={consolidateEnd}
            onChange={(event) => setConsolidateEnd(Math.max(Number(event.target.value), consolidateStart))} /></label>
          <button className="primary" onClick={runConsolidate} disabled={consolidateBones.length === 0 || errors.length > 0}>
            <Wand2 size={16} />整理为新动作
          </button>
        </div>
        <div className="layer-bones">
          <span>整理骨骼：</span>
          {project.skeleton.bones.map((bone) => {
            const selected = consolidateBones.includes(bone.id);
            return <button key={bone.id} className={selected ? "chip selected" : "chip"}
              onClick={() => setConsolidateBones((ids) => selected ? ids.filter((id) => id !== bone.id) : [...ids, bone.id])}>
              {bone.name}
            </button>;
          })}
        </div>
        {(project.actions ?? []).length > 0 && <div className="action-list">
          {project.actions!.map((action) => {
            const current = actionIsCurrent(project, action);
            const active = project.active_action_id === action.id;
            return <div key={action.id} className={active ? "action-row active" : "action-row"}>
              <div className="action-head">
                <strong>{action.name}</strong>
                <span className={current ? "version ok" : "version stale"}>{current ? "源版本一致" : "源动作已修改：版本过期"}</span>
                <span>{action.start.toFixed(2)}s–{action.end.toFixed(2)}s · {action.bones.length} 根骨骼 · {action.keyframes.length} 帧</span>
                <button onClick={() => commit(setActiveAction(project, active ? null : action.id), active ? "已暂时关闭整理动作。" : "已应用整理动作预览。")}>
                  {active ? "关闭应用" : "应用"}
                </button>
                <button title="撤销该次整理" onClick={() => commit(removeBakedAction(project, action.id), "已撤销整理动作，源分层工程不变。")}><Trash2 size={15} /></button>
              </div>
              <p className="hint">来源：{action.source_name}（指纹 {action.source_fingerprint.slice(0, 8)}）；范围外骨骼与时间段不受影响。</p>
            </div>;
          })}
        </div>}
      </section>

      <section className="timeline card">
        <div className="card-title"><h2>关键姿态时间轴</h2><span>移动滑块会同时修改时间；复制会保留完整姿态</span></div>
        <div className="keyframe-list">
          {frames.map((frame) => <div key={frame.id} className={frame.id === editingFrame.id ? "keyframe active" : "keyframe"}>
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
    </main>
  );
}
