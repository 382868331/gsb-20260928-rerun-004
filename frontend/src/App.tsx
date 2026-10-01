import { useEffect, useMemo, useRef, useState } from "react";
import { Copy, Layers, Pause, Play, Repeat, RotateCcw, Save, Scissors, TriangleAlert } from "lucide-react";
import { api } from "./api";
import {
  analyzeRebake,
  applyRebake,
  addWeightKey,
  addLayerKeyframe,
  bakeAction,
  duplicateKeyframe,
  exportAction,
  migrateProject,
  moveKeyframe,
  orderedKeyframes,
  removeWeightKey,
  updateWeightKey,
  updateLayer,
  updateLayerPose,
  updatePose,
  validateProject,
  layerEnvelope,
  weightKeyMultiplier,
  sampleLocal,
  type Action,
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
  const [loopPlay, setLoopPlay] = useState(true);
  const [selectedBoneId, setSelectedBoneId] = useState("upper_arm_r");
  const [activeLayerId, setActiveLayerId] = useState<string | null>(null);
  const [activeActionId, setActiveActionId] = useState<string>("__main__");
  const [bakeStart, setBakeStart] = useState(0);
  const [bakeEnd, setBakeEnd] = useState(1.2);
  const [bakeBones, setBakeBones] = useState<string[]>([]);
  const [bakeName, setBakeName] = useState("");
  const [message, setMessage] = useState("已载入内置简单角色；可启动 Python 服务后保存。");
  const [report, setReport] = useState<ConsistencyReport | null>(null);
  const [segmentChoices, setSegmentChoices] = useState<Record<number, "source" | "keep">>({});
  const [segmentSelected, setSegmentSelected] = useState<Record<number, boolean>>({});
  const [previewRevision, setPreviewRevision] = useState<number | null>(null);
  const frameRef = useRef<number | null>(null);
  const startRef = useRef({ wall: 0, animation: 0 });

  const errors = useMemo(() => validateProject(project), [project]);

  useEffect(() => {
    api<{ project: Project }>("/api/project")
      .then((data) => {
        const migrated = migrateProject(data.project);
        setProject(migrated);
        setHistory([]);
        setMessage("已从 Python 工程存储载入。");
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    setBakeEnd(project.duration);
    if (bakeBones.length === 0) setBakeBones(project.skeleton.bones.map((bone) => bone.id));
  }, [project.duration]); // eslint-disable-line react-hooks/exhaustive-deps

  const activeAction = useMemo(
    () => (activeActionId === "__main__" ? null : project.actions?.find((action) => action.id === activeActionId) ?? null),
    [project.actions, activeActionId],
  );
  const rebakeSegments = useMemo(
    () => (activeAction ? analyzeRebake(project, activeAction) : []),
    [project, activeAction],
  );
  const previewKeyframes = useMemo(() => {
    if (!activeAction || previewRevision === null) return null;
    if (previewRevision === (activeAction.revision ?? 1)) return activeAction.keyframes;
    return activeAction.previous_versions?.find((item) => item.revision === previewRevision)?.keyframes ?? null;
  }, [activeAction, previewRevision]);
  const viewDuration = activeAction?.duration ?? project.duration;
  const viewProject = useMemo<Project>(() => (activeAction ? {
    ...project,
    duration: activeAction.duration,
    keyframes: previewKeyframes ?? activeAction.keyframes,
    layers: activeAction.layers ?? [],
  } : project), [project, activeAction, previewKeyframes]);

  const frames = useMemo(() => orderedKeyframes(viewProject), [viewProject]);
  const editingFrame = useMemo(() => nearestEditableFrame(viewProject, time), [viewProject, time]);
  const activeLayer = useMemo(
    () => (activeAction ? null : project.layers?.find((layer) => layer.id === activeLayerId) ?? null),
    [project, activeLayerId, activeAction],
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

  const commitChange = (nextView: Project, notice?: string) => {
    if (activeAction) commitAction(nextView, notice);
    else commitBase(nextView, notice);
  };

  useEffect(() => {
    if (!playing) return;
    startRef.current = { wall: performance.now(), animation: time };
    const tick = (now: number) => {
      const elapsed = (now - startRef.current.wall) / 1000;
      const nextTime = startRef.current.animation + elapsed;
      if (nextTime >= viewDuration) {
        if (loopPlay) {
          setTime(nextTime % viewDuration);
          startRef.current = { wall: performance.now(), animation: nextTime % viewDuration };
        } else {
          setTime(viewDuration);
          setPlaying(false);
          return;
        }
      } else {
        setTime(nextTime);
      }
      frameRef.current = requestAnimationFrame(tick);
    };
    frameRef.current = requestAnimationFrame(tick);
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    };
  }, [playing, viewDuration, loopPlay]);

  useEffect(() => {
    if (time > viewDuration) setTime(viewDuration);
  }, [viewDuration]); // eslint-disable-line react-hooks/exhaustive-deps

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
    const blob = new Blob([JSON.stringify(exportAction(viewProject, 24), null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${activeAction?.name || project.name || "action"}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const runBake = async () => {
    try {
      const result = bakeAction(project, bakeStart, bakeEnd, bakeBones, bakeName);
      let action = result.action;
      try {
        const verified = await api<{ action: Action }>("/api/bake", {
          method: "POST",
          body: JSON.stringify({
            project, range_start: bakeStart, range_end: bakeEnd, bones: bakeBones, name: bakeName,
          }),
        });
        action = { ...verified.action, id: action.id, name: action.name };
      } catch {
        setMessage("Python 服务不可用，已使用本地整理结果；保存前请启动后端核对。");
      }
      const next: Project = {
        ...project,
        actions: [...(project.actions ?? []), action],
      };
      if (validateProject(next).length > 0) {
        setMessage("整理结果未通过校验，已放弃（不提交半份结果）。");
        return;
      }
      setHistory((items) => [...items.slice(-49), project]);
      setProject(next);
      setActiveActionId(action.id);
      setTime(0);
      setReport({ ok: true, message: `已整理新动作「${action.name}」：${action.keyframes.length} 个可编辑关键姿态，源分层工程保持不变。` });
      setMessage(`整理成功，来源版本 v${action.source.source_version}；范围外动作与源层均未改动。`);
    } catch (error) {
      setReport({ ok: false, message: error instanceof Error ? error.message : "整理失败" });
      setMessage("整理被拒绝：存在未处理内容，工程未被修改。");
    }
  };

  const bumpVersionOnEdit = (next: Project): Project => {
    if (activeActionId !== "__main__") return next;
    return { ...next, version: next.version + 1 };
  };

  const commitBase = (next: Project, notice?: string) => commit(bumpVersionOnEdit(next), notice);

  const commitAction = (next: Project, notice?: string) => {
    if (!activeAction) return;
    if (previewRevision !== null && previewRevision !== (activeAction.revision ?? 1)) {
      setMessage("正在回放旧版本，请先切回当前修订再编辑。");
      return;
    }
    const updatedAction: Action = {
      ...activeAction,
      duration: next.duration,
      keyframes: next.keyframes,
      layers: next.layers ?? [],
    };
    const full: Project = {
      ...project,
      actions: (project.actions ?? []).map((item) => (item.id === activeAction.id ? updatedAction : item)),
    };
    commit(full, notice);
  };

  const switchAction = (id: string) => {
    setActiveActionId(id);
    setActiveLayerId(null);
    setTime(0);
    setSegmentChoices({});
    setSegmentSelected({});
    setPreviewRevision(null);
  };

  const runRebake = async () => {
    if (!activeAction) return;
    const decisions = rebakeSegments
      .map((segment, index) => ({ segment, index }))
      .filter(({ index }) => segmentSelected[index])
      .map(({ segment, index }) => ({
        segment: { start: segment.start, end: segment.end },
        resolution: segment.manual ? (segmentChoices[index] ?? "keep") : "source" as "source" | "keep",
      }))
      .filter((decision) => decision.resolution === "source");
    if (decisions.length === 0) {
      setMessage("未选择需要采用源动作的区间；保留手工结果无需提交。");
      return;
    }
    try {
      let next = applyRebake(project, activeAction.id, decisions);
      try {
        const verified = await api<{ action: Action }>("/api/rebake", {
          method: "POST",
          body: JSON.stringify({ project, action_id: activeAction.id, decisions }),
        });
        next = { ...next, actions: (next.actions ?? []).map((item) => (item.id === activeAction.id ? verified.action : item)) };
      } catch {
        setMessage("Python 服务不可用，已使用本地返修结果；保存前请启动后端核对。");
      }
      if (validateProject(next).length > 0) {
        setMessage("返修结果未通过校验，已放弃（工程未修改）。");
        return;
      }
      setHistory((items) => [...items.slice(-49), project]);
      setProject(next);
      setSegmentChoices({});
      setSegmentSelected({});
      const updated = next.actions?.find((item) => item.id === activeAction.id);
      setReport({ ok: true, message: `已应用 ${decisions.length} 个返修区间，动作修订号升为 r${updated?.revision ?? "?"}；旧版本仍可在下方回放，撤销只回退本次决定。` });
      setMessage("局部返修完成：未选区间与保留的手工关键帧均未改动。");
    } catch (error) {
      setReport({ ok: false, message: error instanceof Error ? error.message : "返修失败" });
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
          <div className="card-title"><h2>任意时刻求值</h2><span>{activeAction ? activeAction.name : project.name}{activeAction && ` · 整理自 v${activeAction.source.source_version}`}</span></div>
          <SkeletonCanvas project={viewProject} time={time} selectedBoneId={selectedBone.id} onSelectBone={setSelectedBoneId} />
          <div className="transport">
            <button className="play" onClick={() => setPlaying((value) => !value)}>
              {playing ? <Pause size={18} /> : <Play size={18} />}
            </button>
            <button className={loopPlay ? "loop on" : "loop"} title="重复播放" onClick={() => setLoopPlay((value) => !value)}>
              <Repeat size={16} />
            </button>
            <input
              type="range"
              min={0}
              max={viewDuration}
              step={0.001}
              value={time}
              onChange={(event) => { setPlaying(false); setTime(Number(event.target.value)); }}
            />
            <strong>{time.toFixed(3)}s / {viewDuration.toFixed(3)}s</strong>
          </div>
        </div>

        <aside className="inspector card">
          <h2>姿态编辑</h2>
          <label>编辑目标
            <select value={activeLayerId ?? "__base__"} disabled={!!activeAction}
              onChange={(event) => setActiveLayerId(event.target.value === "__base__" ? null : event.target.value)}>
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
          {!activeLayer && <p className="hint">正在修改{activeAction ? "整理动作" : "最近的关键姿态"}：<strong>{frames.find((frame) => frame.id === editingFrame.id)?.time.toFixed(2)}s</strong>。{activeAction ? "编辑只影响新动作，源分层工程与版本不变。" : "旋转父骨骼会驱动所有子骨骼，保存时源版本递增。"}</p>}
          {transform && <>
            <label>局部 X 坐标
              <input type="range" min="-120" max="120" step="1" value={transform.x}
                onChange={(event) => commitChange(activeLayer && layerEditingFrame
                  ? updateLayerPose(project, activeLayer.id, layerEditingFrame.id, selectedBone.id, { x: Number(event.target.value) })
                  : updatePose(viewProject, editingFrame.id, selectedBone.id, { x: Number(event.target.value) }))} />
            </label>
            <label>局部 Y 坐标
              <input type="range" min="-120" max="120" step="1" value={transform.y}
                onChange={(event) => commitChange(activeLayer && layerEditingFrame
                  ? updateLayerPose(project, activeLayer.id, layerEditingFrame.id, selectedBone.id, { y: Number(event.target.value) })
                  : updatePose(viewProject, editingFrame.id, selectedBone.id, { y: Number(event.target.value) }))} />
            </label>
            <label>局部旋转
              <input type="range" min="-360" max="360" step="1" value={transform.rotation}
                onChange={(event) => commitChange(activeLayer && layerEditingFrame
                  ? updateLayerPose(project, activeLayer.id, layerEditingFrame.id, selectedBone.id, { rotation: Number(event.target.value) })
                  : updatePose(viewProject, editingFrame.id, selectedBone.id, { rotation: Number(event.target.value) }))} />
            </label>
            <div className="transform-values"><span>x {transform.x.toFixed(1)}</span><span>y {transform.y.toFixed(1)}</span><span>θ {transform.rotation.toFixed(1)}°</span></div>
          </>}
        </aside>
      </section>

      <section className="actions card">
        <div className="card-title"><h2>动作库与整理</h2><span>源分层工程与整理后的新动作分开保存，各自带版本溯源</span></div>
        <div className="action-tabs">
          <button className={activeActionId === "__main__" ? "chip selected" : "chip"}
            onClick={() => switchAction("__main__")}>
            <Layers size={14} />源分层工程 v{project.version}
          </button>
          {(project.actions ?? []).map((action) => <button key={action.id}
            className={activeActionId === action.id ? "chip selected" : "chip"}
            onClick={() => switchAction(action.id)}>
            {action.name}（源 v{action.source.source_version} · r{action.revision ?? 1}）
          </button>)}
        </div>
        {activeAction && <>
          <div className="provenance hint">
            <strong>{activeAction.name}</strong>：整理自源工程版本 v{activeAction.source.source_version}（当前源 v{project.version}），
           时间 {activeAction.source.range_start.toFixed(2)}~{activeAction.source.range_end.toFixed(2)}s，
           骨骼 {activeAction.source.bones.length} 根，采样 {activeAction.source.fps}fps，
           生成于 {new Date(activeAction.source.created_at).toLocaleString()}，
           当前修订 r{activeAction.revision ?? 1}{activeAction.source.updated_at ? `，最近返修 ${new Date(activeAction.source.updated_at).toLocaleString()}` : ""}。
           修改下方关键帧只影响本动作并标记为人工返修；保存重开后仍与源修订、整理结果区分。
          </div>
          {(activeAction.previous_versions ?? []).length > 0 && <div className="layer-controls">
            <label>回放修订
              <select value={previewRevision ?? (activeAction.revision ?? 1)}
                onChange={(event) => { setPreviewRevision(Number(event.target.value)); setTime(0); }}>
                {(activeAction.previous_versions ?? []).map((item) => (
                  <option key={item.revision} value={item.revision}>旧版本 r{item.revision}（{new Date(item.saved_at).toLocaleString()}）</option>
                ))}
                <option value={activeAction.revision ?? 1}>当前 r{activeAction.revision ?? 1}</option>
              </select>
            </label>
            {previewRevision !== null && previewRevision !== (activeAction.revision ?? 1)
              && <span className="hint warn">正在回放旧版本 r{previewRevision}（只读）；切回当前修订后才能编辑。</span>}
          </div>}
          {rebakeSegments.length > 0 && <div className="rebake-panel">
            <div className="card-title"><h3>源工程已更新：{rebakeSegments.length} 个受影响区间</h3><span>勾选要采用源动作的区间；人工返修帧需单独决定</span></div>
            {rebakeSegments.map((segment, index) => <div key={index} className={segment.manual ? "rebake-row manual" : "rebake-row"}>
              <label>
                <input type="checkbox" checked={!!segmentSelected[index]}
                  onChange={(event) => setSegmentSelected((prev) => ({ ...prev, [index]: event.target.checked }))} />
                {segment.start.toFixed(2)}~{segment.end.toFixed(2)}s · {segment.bones.join("、")}
              </label>
              {segment.manual && <span className="rebake-choice">
                <em>含人工返修关键帧：</em>
                <label><input type="radio" name={"seg-" + index} checked={(segmentChoices[index] ?? "keep") === "keep"}
                  onChange={() => setSegmentChoices((prev) => ({ ...prev, [index]: "keep" }))} />保留手工结果</label>
                <label><input type="radio" name={"seg-" + index} checked={segmentChoices[index] === "source"}
                  onChange={() => setSegmentChoices((prev) => ({ ...prev, [index]: "source" }))} />重新采用源动作</label>
              </span>}
            </div>)}
            <button className="primary bake-btn" onClick={runRebake}><Scissors size={15} />应用所选返修区间（保留其余决定）</button>
          </div>}
        </>}
        {!activeAction && <div className="bake-panel">
          <div className="layer-controls">
            <label>片段开始<input type="number" min={0} max={project.duration} step={0.05} value={bakeStart}
              onChange={(event) => setBakeStart(Math.min(Number(event.target.value), bakeEnd))} /></label>
            <label>片段结束<input type="number" min={0} max={project.duration} step={0.05} value={bakeEnd}
              onChange={(event) => setBakeEnd(Math.max(Number(event.target.value), bakeStart))} /></label>
            <label>新动作名称<input type="text" value={bakeName} placeholder="如：挥手循环" onChange={(event) => setBakeName(event.target.value)} /></label>
          </div>
          <div className="layer-bones">
            <span>整理骨骼：</span>
            <button className={bakeBones.length === project.skeleton.bones.length ? "chip selected" : "chip"}
              onClick={() => setBakeBones(project.skeleton.bones.map((bone) => bone.id))}>全部</button>
            {project.skeleton.bones.map((bone) => {
              const selected = bakeBones.includes(bone.id);
              return <button key={bone.id} className={selected ? "chip selected" : "chip"}
                onClick={() => setBakeBones((items) => selected ? items.filter((id) => id !== bone.id) : [...items, bone.id])}>{bone.name}</button>;
            })}
          </div>
          <button className="primary bake-btn" onClick={runBake}><Scissors size={15} />整理成新动作（保留源分层工程）</button>
        </div>}
      </section>

      {!activeAction && project.layers && project.layers.length > 0 && (
        <section className="layers card">
          <div className="card-title"><h2>动作分层</h2><span>权重关键帧可在过渡中途正反向反复调整</span></div>
          {project.layers.map((layer) => {
            const weightNow = layerEnvelope(layer, time);
            return <div key={layer.id} className={layer.id === activeLayerId ? "layer-row active" : "layer-row"}>
              <div className="layer-head">
                <strong>{layer.name}</strong>
                <span>当前权重 {(weightNow * 100).toFixed(0)}%</span>
                <button onClick={() => setActiveLayerId(layer.id === activeLayerId ? null : layer.id)}>
                  {layer.id === activeLayerId ? "完成编辑" : "编辑此层"}
                </button>
                {layer.id === activeLayerId && <button onClick={() => commitBase(addLayerKeyframe(project, layer.id), "已新增层关键姿态。")}>+ 关键姿态</button>}
              </div>
              <div className="layer-controls">
                <label>权重<input type="number" min={0} max={1} step={0.05} value={layer.weight}
                  onChange={(event) => commitBase(updateLayer(project, layer.id, { weight: Number(event.target.value) }), "层权重已更新。")} /></label>
                <label>开始<input type="number" min={0} max={project.duration} step={0.05} value={layer.start}
                  onChange={(event) => commitBase(updateLayer(project, layer.id, { start: Number(event.target.value) }), "层时间范围已更新。")} /></label>
                <label>结束<input type="number" min={0} max={project.duration} step={0.05} value={layer.end}
                  onChange={(event) => commitBase(updateLayer(project, layer.id, { end: Number(event.target.value) }), "层时间范围已更新。")} /></label>
                <label>淡入<input type="number" min={0} step={0.05} value={layer.fade_in}
                  onChange={(event) => commitBase(updateLayer(project, layer.id, { fade_in: Number(event.target.value) }), "淡入时长已更新。")} /></label>
                <label>淡出<input type="number" min={0} step={0.05} value={layer.fade_out}
                  onChange={(event) => commitBase(updateLayer(project, layer.id, { fade_out: Number(event.target.value) }), "淡出时长已更新。")} /></label>
              </div>
              <div className="weight-keys">
                <span>平滑权重过渡：</span>
                <button className="chip" onClick={() => commitBase(addWeightKey(project, layer.id, time, weightKeyMultiplier(layer, time)), "已在当前时刻加入权重关键帧。")}>+ 当前时刻 {(weightKeyMultiplier(layer, time) * 100).toFixed(0)}%</button>
                {[...(layer.weight_keys ?? [])].sort((a, b) => a.time - b.time).map((key) => <span key={key.id} className="weight-key">
                  <input type="number" min={0} max={project.duration} step={0.01} value={key.time}
                    onChange={(event) => commitBase(updateWeightKey(project, layer.id, key.id, { time: Number(event.target.value) }), "权重帧时间已更新。")} />
                  <input type="range" min={0} max={1} step={0.01} value={key.weight}
                    onChange={(event) => commitBase(updateWeightKey(project, layer.id, key.id, { weight: Number(event.target.value) }), "权重已更新，过渡可中途反向。")} />
                  <strong>{(key.weight * 100).toFixed(0)}%</strong>
                  <button onClick={() => commitBase(removeWeightKey(project, layer.id, key.id), "已删除权重关键帧。")}>×</button>
                </span>)}
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
                    commitBase(updateLayer(project, layer.id, nextLayer), selected ? "已移除作用骨骼。" : "已加入作用骨骼，关键姿态以当前混合姿态为初值。");
                  }}>{bone.name}</button>;
                })}
              </div>
              {layer.id === activeLayerId && <div className="keyframe-list">
                {[...layer.keyframes].sort((a, b) => a.time - b.time).map((frame) => <div key={frame.id} className="keyframe">
                  <button onClick={() => { setPlaying(false); setTime(frame.time); }}>{frame.time.toFixed(2)}s</button>
                  <input type="range" min={0} max={project.duration} step={0.01} value={frame.time}
                    onChange={(event) => commitBase(updateLayer(project, layer.id, { keyframes: layer.keyframes.map((item) => item.id === frame.id ? { ...item, time: Number(event.target.value) } : item) }), "层关键姿态已移动。")} />
                </div>)}
              </div>}
            </div>;
          })}
        </section>
      )}

      <section className="timeline card">
        <div className="card-title"><h2>{activeAction ? "整理动作关键姿态" : "源工程关键姿态时间轴"}</h2><span>{activeAction ? "逐帧烘焙，可继续编辑；源工程不受影响" : "移动滑块会同时修改时间；复制会保留完整姿态"}</span></div>
        <div className="keyframe-list">
          {frames.map((frame) => <div key={frame.id} className={frame.id === editingFrame.id ? "keyframe active" : "keyframe"}>
            <button onClick={() => { setPlaying(false); setTime(frame.time); }}>{frame.time.toFixed(2)}s</button>
            <input type="range" min={0} max={viewDuration} step={0.01} value={frame.time}
              onChange={(event) => commitChange(moveKeyframe(viewProject, frame.id, Number(event.target.value)), "关键姿态已移动。")} />
            <button title="复制关键姿态" onClick={() => commitChange(duplicateKeyframe(viewProject, frame.id), "关键姿态已复制。")}><Copy size={15} /></button>
          </div>)}
        </div>
        <div className="duration-row">
          {!activeAction && <label>动画时长<input type="number" min={0.1} step={0.1} value={project.duration}
            onChange={(event) => commitBase({ ...project, duration: Number(event.target.value) }, "动画时长已更新，源版本递增。")} /></label>}
          <p className={report?.ok ? "report ok" : "report warn"}>{report?.message ?? message}</p>
        </div>
      </section>
    </main>
  );
}
