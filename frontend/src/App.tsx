import { useEffect, useMemo, useRef, useState } from "react";
import { Copy, Layers, Pause, Play, Repeat, RotateCcw, Save, Scissors, TriangleAlert } from "lucide-react";
import { api } from "./api";
import {
  analyzeRebake,
  applyRebake,
  addWeightKey,
  addLayerKeyframe,
  bakeAction,
  continuityReport,
  createVariant,
  duplicateKeyframe,
  exportAction,
  migrateProject,
  moveKeyframe,
  orderedKeyframes,
  publishVariant,
  removeWeightKey,
  sampleFrames,
  updateWeightKey,
  updateLayer,
  updateLayerPose,
  updatePose,
  validateProject,
  layerEnvelope,
  weightKeyMultiplier,
  sampleLocal,
  shortestAngleDelta,
  withdrawDecision,
  withdrawalPreview,
  type Action,
  type ActionVariant,
  type JointCandidateReport,
  type JointSelection,
  type Project,
  type ReviewBatch,
  type ReviewItem,
  type ReviewSegment,
  type Transform,
  type WithdrawalPreview,
} from "./animation";
import {
  cancelReviewItem,
  createReviewBatch,
  jointCandidateReport,
  publishJointCandidate,
  reviewBatchSummary,
  setReviewItemDecisions,
  submitReviewBatch,
} from "./animation";
import { defaultProject } from "./defaultProject";
import { SkeletonCanvas } from "./SkeletonCanvas";

type ConsistencyReport = { ok: boolean; message: string };

function nearestEditableFrame(project: Project, time: number) {
  return [...project.keyframes].sort((a, b) => Math.abs(a.time - time) - Math.abs(b.time - time))[0];
}

const transformDiffers = (a?: Transform, b?: Transform) => !a || !b
  || Math.abs(a.x - b.x) > 1e-7
  || Math.abs(a.y - b.y) > 1e-7
  || Math.abs(shortestAngleDelta(a.rotation, b.rotation)) > 1e-7;

function ComparePanel({ project, action, time, previewRevision }: {
  project: Project;
  action: Action;
  time: number;
  previewRevision: number | null;
}) {
  const localTime = Math.min(time, action.duration);
  const sourcePose = sampleLocal(project, action.source.range_start + localTime);
  const columns: { id: string; label: string; keyframes: Action["keyframes"] }[] = [
    { id: "current", label: `当前动作 r${action.revision ?? 1}`, keyframes: action.keyframes },
  ];
  if (previewRevision !== null && previewRevision !== (action.revision ?? 1)) {
    const revision = action.previous_versions?.find((item) => item.revision === previewRevision);
    if (revision) columns.push({ id: `rev-${revision.revision}`, label: `旧版本 r${revision.revision}（对应更早源版本）`, keyframes: revision.keyframes });
  }
  (action.variants ?? []).forEach((variant) => columns.push({
    id: variant.id,
    label: `${variant.name}${variant.status === "published" ? "（已发布）" : "（草稿）"}`,
    keyframes: variant.keyframes,
  }));
  const poses = columns.map((column) => sampleFrames(column.keyframes, localTime));
  const activeDecisions = (action.decision_log ?? []).filter((entry) => (entry.status ?? "active") === "active");
  const continuityTargets = [
    { label: "当前动作", keyframes: action.keyframes, variantId: null as string | null },
    ...(action.variants ?? []).filter((variant) => variant.status === "draft")
      .map((variant) => ({ label: variant.name, keyframes: variant.keyframes, variantId: variant.id as string | null })),
  ];
  return <div className="compare-panel">
    <div className="card-title"><h3>方案对比（t = {localTime.toFixed(3)}s）</h3><span>高亮单元格与当前源不同：差异来自人工采用/保留的决定，而非源变化</span></div>
    <table className="compare-table">
      <thead>
        <tr>
          <th>骨骼</th>
          <th>源分层工程 v{project.version}</th>
          {columns.map((column) => <th key={column.id}>{column.label}</th>)}
        </tr>
      </thead>
      <tbody>
        {action.source.bones.map((boneId) => {
          const boneName = project.skeleton.bones.find((bone) => bone.id === boneId)?.name ?? boneId;
          return <tr key={boneId}>
            <td>{boneName}</td>
            <td>{sourcePose[boneId]?.rotation.toFixed(1)}°</td>
            {columns.map((column, columnIndex) => {
              const cell = poses[columnIndex][boneId];
              const diff = transformDiffers(cell, sourcePose[boneId]);
              return <td key={column.id} className={diff ? "diff" : ""}
                title={diff ? "与当前源不同：来自人工采用或保留的决定" : "与当前源一致"}>
                {cell ? `${cell.rotation.toFixed(1)}°` : "—"}
              </td>;
            })}
          </tr>;
        })}
      </tbody>
    </table>
    <div className="continuity-list">
      {continuityTargets.map((target) => {
        const windows = activeDecisions
          .filter((entry) => (entry.variant_id ?? null) === target.variantId)
          .map((entry) => ({ start: entry.segment.start, end: entry.segment.end }));
        const report = continuityReport(target.keyframes, action.duration, windows, action.source.fps, action.source.bones);
        return <span key={target.label} className="continuity-item"
          title="更新区间内 / 区间边界 / 区间外的最大相邻帧姿态差；边界值与两侧相近则过渡连续">
          {target.label}：区间内 Δ{report.maxInsideDelta.toFixed(2)} · 边界 Δ{report.maxBoundaryDelta.toFixed(2)} · 区间外 Δ{report.maxOutsideDelta.toFixed(2)}
        </span>;
      })}
    </div>
  </div>;
}

function BatchReviewPanel({ batch, project, onDecide, onSubmit, onCancelItem, onOpenAction, onJointPublish }: {
  batch: ReviewBatch;
  project: Project;
  onDecide: (item: ReviewItem, resolutions: Record<number, ReviewSegment["resolution"]>) => void;
  onSubmit: () => void;
  onCancelItem: (item: ReviewItem) => void;
  onOpenAction: (actionId: string) => void;
  onJointPublish: (selections: JointSelection[]) => Promise<void>;
}) {
  const [jointChecked, setJointChecked] = useState<Record<string, boolean>>({});
  const [jointReport, setJointReport] = useState<JointCandidateReport | null>(null);
  const decidedCount = batch.items.filter((item) => item.status === "decided" || item.status === "published").length;
  const pendingItems = batch.items.filter((item) => item.status !== "published");
  const jointSelections = batch.items.flatMap((item) => item.segments
    .map((_, index) => ({ action_id: item.action_id, index }))
    .filter((selection) => jointChecked[selection.action_id + ":" + selection.index]));
  const jointKey = (selection: JointSelection) => selection.action_id + ":" + selection.index;
  const runJointCheck = async () => {
    try {
      let report = jointCandidateReport(project, batch.id, jointSelections);
      try {
        const verified = await api<{ report: JointCandidateReport }>("/api/review-batch", {
          method: "POST",
          body: JSON.stringify({ project, op: "joint-report", batch_id: batch.id, selections: jointSelections }),
        });
        report = verified.report;
      } catch {
        // Python unavailable: local report uses the same rules.
      }
      setJointReport(report);
    } catch (error) {
      setJointReport({
        ok: false,
        errors: [error instanceof Error ? error.message : "联合候选检查失败"],
        ranges: [],
        shared_bones: [],
        dependency_closed: false,
      });
    }
  };
  const runJointPublish = async () => {
    await onJointPublish(jointSelections);
    setJointChecked({});
    setJointReport(null);
  };
  return <div className="batch-panel">
    <div className="card-title">
      <h3>{batch.name ?? batch.id}（源 v{batch.source_version}）</h3>
      <span>已明确 {decidedCount}/{batch.items.length} 项；可跨动作勾选区间组成联合候选，只发布批准的闭合范围</span>
    </div>
    {batch.items.map((item) => {
      const action = project.actions?.find((entry) => entry.id === item.action_id);
      const pending = item.segments.filter((segment) => segment.resolution === "pending");
      return <div key={item.action_id} className={item.status === "published" ? "batch-item published" : "batch-item"}>
        <div className="batch-item-head">
          <strong>{action?.name ?? item.action_id}</strong>
          <span className="hint">
            草稿 {item.variant_id} · 
            {item.status === "published" && "已发布"}
            {item.status === "decided" && "逐项已决定，待提交"}
            {item.status === "open" && `${pending.length} 项待定`}
          </span>
          <button onClick={() => onOpenAction(item.action_id)}>打开动作</button>
          {item.status !== "published" && <>
            <button onClick={() => onDecide(item, Object.fromEntries(item.segments.map((_, index) => [index, "source" as const])))}>
              全部采用新源
            </button>
            <button onClick={() => onCancelItem(item)}>取消未发布决定</button>
          </>}
        </div>
        {item.status !== "published" && item.segments.map((segment, index) => {
          const selection = { action_id: item.action_id, index };
          return <div key={index} className="batch-segment">
          <label>
            <input type="checkbox"
              checked={!!jointChecked[jointKey(selection)]}
              disabled={segment.resolution === "pending" || !!segment.joint_published}
              onChange={(event) => {
                setJointChecked((prev) => ({ ...prev, [jointKey(selection)]: event.target.checked }));
                setJointReport(null);
              }} />
            {segment.start.toFixed(2)}~{segment.end.toFixed(2)}s · {segment.bones.join("、")}
            {segment.resolved && <em>（已应用，不再与源有差异）</em>}
            {segment.joint_published && <em>（已作为联合范围发布）</em>}
          </label>
          {segment.basis && segment.basis.length > 0 && <span className="basis">
            依据：{segment.basis.map((entry) =>
              `${entry.id}（${entry.resolution === "keep" ? "保留手工" : "采用源"}·v${entry.source_version ?? "?"}）`,
            ).join("、")}
          </span>}
          <span className="rebake-choice">
            {["source", "keep", "pending"].map((value) => <label key={value}>
              <input type="radio"
                name={`${item.action_id}-${batch.id}-${index}`}
                checked={segment.resolution === value}
                onChange={() => onDecide(item, Object.fromEntries(item.segments.map((current, currentIndex) => [
                  currentIndex,
                  currentIndex === index
                    ? value as ReviewSegment["resolution"]
                    : current.resolution,
                ])))} />
              {value === "source" ? "采用新源" : value === "keep" ? "保留旧依据" : "继续待定"}
            </label>)}
          </span>
        </div>;
        })}
      </div>;
    })}
    <div className="joint-candidate">
      <strong>跨动作共享骨骼协调</strong>
      <span className="hint">相邻区间检查接缝姿态/根位移；重叠区间必须姿态一致。未勾中的依赖区间会导致候选不闭合，冲突必须明确选择或继续待定。</span>
      <button onClick={runJointCheck} disabled={jointSelections.length === 0}>检查联合候选</button>
      <button className="primary" onClick={runJointPublish} disabled={!jointReport?.ok}>批准并发布所选范围</button>
      {jointReport && <div className={jointReport.ok ? "report ok" : "report warn"}>
        {jointReport.ok
          ? "可共同采用 " + jointReport.ranges.length + " 段；共享骨骼：" + jointReport.shared_bones.join("、")
          : jointReport.errors.join("；")}
      </div>}
      {jointReport?.ok && <div className="basis">
        {jointReport.ranges.map((range) => <span key={range.action_id + ":" + range.index}>
          {range.action_name}：源 {range.source_start.toFixed(2)}~{range.source_end.toFixed(2)}s
          （本动作 {range.local_start.toFixed(2)}~{range.local_end.toFixed(2)}s，依据 v{range.source_basis_version}，{range.resolution === "source" ? "采用新源" : "保留旧依据"}）
        </span>)}
      </div>}
    </div>
    <div className="batch-actions">
      <button className="primary bake-btn" onClick={onSubmit} disabled={!batch.items.some((item) => item.status === "decided")}>
        提交批次（只发布明确决定项）
      </button>
      {pendingItems.length > 0 && <span className="hint">{pendingItems.length} 个动作仍有待定项，提交后保留在本批中，保存重开或源再次修订后可继续。</span>}
    </div>
  </div>;
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
  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(null);
  const [withdrawPreview, setWithdrawPreview] = useState<WithdrawalPreview | null>(null);
  const [activeBatchId, setActiveBatchId] = useState<string | null>(null);
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
  const selectedVariant = useMemo<ActionVariant | null>(
    () => activeAction?.variants?.find((variant) => variant.id === selectedVariantId) ?? null,
    [activeAction, selectedVariantId],
  );
  const viewDuration = activeAction?.duration ?? project.duration;
  const viewProject = useMemo<Project>(() => (activeAction ? {
    ...project,
    duration: activeAction.duration,
    keyframes: selectedVariant?.keyframes ?? previewKeyframes ?? activeAction.keyframes,
    layers: activeAction.layers ?? [],
  } : project), [project, activeAction, previewKeyframes, selectedVariant]);
  const affectedActions = useMemo(
    () => (project.actions ?? [])
      .map((action) => ({ action, segments: analyzeRebake(project, action) }))
      .filter((entry) => entry.segments.length > 0),
    [project],
  );
  const sharedSourceKeys = useMemo(() => {
    const counts = new Map<string, number>();
    (project.actions ?? []).forEach((action) => {
      const key = [action.source.range_start, action.source.range_end, ...action.source.bones].join("|");
      counts.set(key, (counts.get(key) ?? 0) + 1);
    });
    return new Set(
      (project.actions ?? [])
        .filter((action) => (counts.get([action.source.range_start, action.source.range_end, ...action.source.bones].join("|")) ?? 0) > 1)
        .map((action) => action.id),
    );
  }, [project.actions]);

  const reviewBatches = useMemo(
    () => (project.review_batches ?? []).map((batch) => reviewBatchSummary(project, batch.id)),
    [project],
  );
  const activeBatch = useMemo<ReviewBatch | null>(
    () => reviewBatches.find((batch) => batch.id === activeBatchId) ?? null,
    [reviewBatches, activeBatchId],
  );

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
    if (selectedVariant) {
      setMessage("正在查看采用方案：方案内容通过返修决定演进，直接编辑请切回当前动作。");
      return;
    }
    if (previewRevision !== null && previewRevision !== (activeAction.revision ?? 1)) {
      setMessage("正在回放旧版本，请先切回当前修订再编辑。");
      return;
    }
    const updatedAction: Action = {
      ...activeAction,
      duration: next.duration,
      keyframes: next.keyframes.map((frame) => (
        frame.origin === "manual" && frame.origin_source_version === undefined
          ? { ...frame, origin_source_version: activeAction.source.source_version }
          : frame
      )),
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
    setSelectedVariantId(null);
    setWithdrawPreview(null);
  };

  const runRebake = async () => {
    if (!activeAction) return;
    const decisions = rebakeSegments
      .map((segment, index) => ({ segment, index }))
      .filter(({ index }) => segmentSelected[index])
      .map(({ segment, index }) => ({
        segment: { start: segment.start, end: segment.end, bones: segment.bones },
        resolution: segment.manual ? (segmentChoices[index] ?? "keep") : "source" as "source" | "keep",
      }));
    if (decisions.length === 0) {
      setMessage("请先勾选要处理的区间；每个区间分别决定采用源动作或保留手工结果。");
      return;
    }
    const targetVariant = selectedVariant?.status === "draft" ? selectedVariant : null;
    try {
      let next = applyRebake(project, activeAction.id, decisions, targetVariant?.id ?? null);
      try {
        const verified = await api<{ action: Action }>("/api/rebake", {
          method: "POST",
          body: JSON.stringify({ project, action_id: activeAction.id, decisions, variant_id: targetVariant?.id ?? null }),
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
      const adoptedCount = decisions.filter((decision) => decision.resolution === "source").length;
      const keptCount = decisions.length - adoptedCount;
      setReport({
        ok: true,
        message: targetVariant
          ? `已在${targetVariant.name}中确认 ${decisions.length} 项决定（采用 ${adoptedCount}、保留手工 ${keptCount}），方案修订升为 r${targetVariant.revision + 1}；当前动作与其他方案不受影响。`
          : `已确认 ${decisions.length} 项决定（采用 ${adoptedCount}、保留手工 ${keptCount}），动作修订号升为 r${updated?.revision ?? "?"}；旧版本仍可在下方回放，撤销只回退本次决定。`,
      });
      setMessage("局部返修完成：未选区间与保留的手工关键帧均未改动，保留结果已记录所依附的源版本。");
    } catch (error) {
      setReport({ ok: false, message: error instanceof Error ? error.message : "返修失败" });
    }
  };

  const runCreateVariant = async () => {
    if (!activeAction) return;
    try {
      let next = createVariant(project, activeAction.id);
      try {
        const verified = await api<{ action: Action }>("/api/variants", {
          method: "POST",
          body: JSON.stringify({ project, action_id: activeAction.id, op: "create" }),
        });
        next = { ...next, actions: (next.actions ?? []).map((item) => (item.id === activeAction.id ? verified.action : item)) };
      } catch {
        setMessage("Python 服务不可用，已使用本地方案；保存前请启动后端核对。");
      }
      const created = next.actions?.find((item) => item.id === activeAction.id)?.variants?.at(-1);
      setHistory((items) => [...items.slice(-49), project]);
      setProject(next);
      setSelectedVariantId(created?.id ?? null);
      setMessage(`已新建${created?.name ?? "方案"}：从当前动作复制，可独立确认采用决定，互不同步。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "新建方案失败");
    }
  };

  const runPublishVariant = async () => {
    if (!activeAction || !selectedVariant || selectedVariant.status !== "draft") return;
    try {
      let next = publishVariant(project, activeAction.id, selectedVariant.id);
      try {
        const verified = await api<{ action: Action }>("/api/variants", {
          method: "POST",
          body: JSON.stringify({ project, action_id: activeAction.id, op: "publish", variant_id: selectedVariant.id }),
        });
        next = { ...next, actions: (next.actions ?? []).map((item) => (item.id === activeAction.id ? verified.action : item)) };
      } catch {
        setMessage("Python 服务不可用，已使用本地发布结果；保存前请启动后端核对。");
      }
      setHistory((items) => [...items.slice(-49), project]);
      setProject(next);
      const updated = next.actions?.find((item) => item.id === activeAction.id);
      setReport({ ok: true, message: `已发布「${selectedVariant.name}」为 r${updated?.revision ?? "?"}；其他方案保持草稿可继续编辑，旧发布版本仍可在回放修订中播放。` });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "发布方案失败");
    }
  };

  const runWithdrawPreview = async (decisionId: string) => {
    if (!activeAction) return;
    try {
      let preview = withdrawalPreview(project, activeAction.id, decisionId);
      try {
        const verified = await api<{ preview: WithdrawalPreview }>("/api/withdraw", {
          method: "POST",
          body: JSON.stringify({ project, action_id: activeAction.id, decision_id: decisionId }),
        });
        preview = verified.preview;
      } catch {
        // backend unavailable: local preview is identical logic
      }
      setWithdrawPreview(preview);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "撤回分析失败");
    }
  };

  const runWithdrawConfirm = async () => {
    if (!activeAction || !withdrawPreview) return;
    const decisionId = withdrawPreview.decision.id;
    try {
      let next = withdrawDecision(project, activeAction.id, decisionId, true);
      try {
        const verified = await api<{ action: Action }>("/api/withdraw", {
          method: "POST",
          body: JSON.stringify({ project, action_id: activeAction.id, decision_id: decisionId, confirm: true }),
        });
        next = { ...next, actions: (next.actions ?? []).map((item) => (item.id === activeAction.id ? verified.action : item)) };
      } catch {
        setMessage("Python 服务不可用，已使用本地撤回结果；保存前请启动后端核对。");
      }
      setHistory((items) => [...items.slice(-49), project]);
      setProject(next);
      setWithdrawPreview(null);
      setReport({ ok: true, message: `已撤回决定 ${decisionId}：仅恢复其自身区间，较晚的无关返修保持不动。` });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "撤回失败");
    }
  };

  const applyBatchProject = async (next: Project) => {
    if (validateProject(next).length > 0) {
      setMessage("批次结果未通过校验，已放弃（工程未修改）。");
      return null;
    }
    setHistory((items) => [...items.slice(-49), project]);
    setProject(next);
    return next;
  };

  const runCreateBatch = async () => {
    try {
      let next = createReviewBatch(project);
      const batch = next.review_batches?.at(-1) ?? null;
      try {
        const verified = await api<{ project: Project }>("/api/review-batch", {
          method: "POST",
          body: JSON.stringify({ project, op: "create" }),
        });
        next = verified.project;
      } catch {
        setMessage("Python 服务不可用，已使用本地批次；保存前请启动后端核对。");
      }
      if ((await applyBatchProject(next)) && batch) {
        setActiveBatchId(batch.id);
        setReport({ ok: true, message: `已开启批次「${batch.name ?? batch.id}」：${batch.items.length} 个受影响动作各自保留独立草稿，可逐项采用新源、保留旧依据或继续待定。` });
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "开启批次审阅失败");
    }
  };

  const runBatchDecide = async (item: ReviewItem, resolutions: Record<number, ReviewSegment["resolution"]>) => {
    if (!activeBatch) return;
    try {
      let next = setReviewItemDecisions(project, activeBatch.id, item.action_id, resolutions);
      try {
        const verified = await api<{ project: Project }>("/api/review-batch", {
          method: "POST",
          body: JSON.stringify({
            project, op: "decide", batch_id: activeBatch.id, action_id: item.action_id,
            resolutions: Object.fromEntries(Object.entries(resolutions).map(([index, value]) => [index, value])),
          }),
        });
        next = verified.project;
      } catch {
        setMessage("Python 服务不可用，已使用本地批次决定；保存前请启动后端核对。");
      }
      if (await applyBatchProject(next)) {
        setMessage(`已记录「${item.action_id}」的逐项决定到草稿；未决定项继续保留，提交前不会发布。`);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "记录批次决定失败");
    }
  };

  const runBatchSubmit = async () => {
    if (!activeBatch) return;
    try {
      let next = submitReviewBatch(project, activeBatch.id);
      try {
        const verified = await api<{ project: Project }>("/api/review-batch", {
          method: "POST",
          body: JSON.stringify({ project, op: "submit", batch_id: activeBatch.id }),
        });
        next = verified.project;
      } catch {
        setMessage("Python 服务不可用，已使用本地批次提交；保存前请启动后端核对。");
      }
      const batchAfter = next.review_batches?.find((item) => item.id === activeBatch.id) ?? null;
      const publishedCount = batchAfter?.items.filter((item) => item.status === "published").length ?? 0;
      const pendingCount = batchAfter?.items.filter((item) => item.status !== "published").length ?? 0;
      if (await applyBatchProject(next)) {
        setReport({
          ok: true,
          message: pendingCount > 0
            ? `本批已发布 ${publishedCount} 个明确决定的动作；${pendingCount} 个未决定动作及其依据已保存，可稍后继续。`
            : `本批 ${publishedCount} 个动作的决定已全部发布。`,
        });
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "提交批次失败");
    }
  };

  const runBatchCancelItem = async (item: ReviewItem) => {
    if (!activeBatch) return;
    try {
      let next = cancelReviewItem(project, activeBatch.id, item.action_id);
      try {
        const verified = await api<{ project: Project }>("/api/review-batch", {
          method: "POST",
          body: JSON.stringify({ project, op: "cancel-item", batch_id: activeBatch.id, action_id: item.action_id }),
        });
        next = verified.project;
      } catch {
        setMessage("Python 服务不可用，已使用本地取消结果；保存前请启动后端核对。");
      }
      if (await applyBatchProject(next)) {
        setReport({ ok: true, message: `已取消「${item.action_id}」未发布的批次决定：草稿恢复原状；其他批次已发布结果不受影响。` });
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "取消批次决定失败");
    }
  };

  const runJointPublish = async (batchId: string, selections: JointSelection[]) => {
    try {
      let next = publishJointCandidate(project, batchId, selections).project;
      try {
        const verified = await api<{ project: Project }>("/api/review-batch", {
          method: "POST",
          body: JSON.stringify({ project, op: "joint-publish", batch_id: batchId, selections }),
        });
        next = verified.project;
      } catch {
        // Backend unavailable: local result is produced from the same rules.
      }
      if (await applyBatchProject(next)) {
        const batchAfter = next.review_batches?.find((item) => item.id === batchId);
        const publishedActions = new Set(selections.map((selection) => selection.action_id));
        setReport({
          ok: true,
          message: "已发布用户批准的联合闭合范围，涉及 " + publishedActions.size + " 个动作；其余草稿和原发布修订均保留。",
        });
        setMessage("联合范围已部分发布：" + (batchAfter?.id ?? batchId));
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "联合候选发布失败");
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
       {!activeAction && affectedActions.length > 0 && <div className="shared-panel">
         <strong>源工程 v{project.version} 更新后，{affectedActions.length} 个整理动作受影响（各自独立决定，不会因源相同而强制同步）：</strong>
         {affectedActions.map(({ action, segments }) => <div key={action.id} className="shared-row">
           <span>
             {action.name}：{segments.length} 个受影响区间
             {sharedSourceKeys.has(action.id) && <em>（与其他动作共享同一段源动作）</em>}
           </span>
           <button onClick={() => switchAction(action.id)}>逐段查看并决定</button>
         </div>)}
       </div>}
        {!activeAction && <>
          {affectedActions.length > 0 && <div className="batch-bar">
            <button className="primary" onClick={runCreateBatch}>把 {affectedActions.length} 个受影响动作放入同一批次审阅</button>
            <span className="hint">每个动作在批次中保留各自草稿：逐项采用新源、保留旧依据或继续待定；保存重开后可继续。</span>
          </div>}
          {reviewBatches.length > 0 && <div className="batch-list">
            <div className="card-title"><h3>审阅批次</h3><span>未提交的待定项随工程保存；提交只发布明确决定的动作</span></div>
            {reviewBatches.map((batch) => {
              const openCount = batch.items.filter((item) => item.status !== "published").length;
              const decidedCount = batch.items.filter((item) => item.status === "decided").length;
              return <div key={batch.id} className={activeBatchId === batch.id ? "batch-row active" : "batch-row"}>
                <button className="chip" onClick={() => setActiveBatchId(activeBatchId === batch.id ? null : batch.id)}>
                  {batch.name ?? batch.id}（{batch.items.length - openCount}/{batch.items.length} 已发布{decidedCount > 0 ? `，${decidedCount} 项待提交` : ""}）
                </button>
                {activeBatchId === batch.id && <BatchReviewPanel
                  batch={batch}
                  project={project}
                  onDecide={runBatchDecide}
                  onSubmit={runBatchSubmit}
                  onCancelItem={runBatchCancelItem}
                  onOpenAction={(actionId) => switchAction(actionId)}
                  onJointPublish={(selections) => runJointPublish(batch.id, selections)}
                />}
              </div>;
            })}
          </div>}
        </>}
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
          <div className="variant-bar">
            <span>采用方案：</span>
            <button className={selectedVariantId === null ? "chip selected" : "chip"}
              onClick={() => setSelectedVariantId(null)}>当前动作 r{activeAction.revision ?? 1}</button>
            {(activeAction.variants ?? []).map((variant) => <button key={variant.id}
              className={selectedVariantId === variant.id ? "chip selected" : "chip"}
              onClick={() => setSelectedVariantId(variant.id)}>
              {variant.name} r{variant.revision}{variant.status === "published" ? "（已发布）" : "（草稿）"}
            </button>)}
            <button className="chip" onClick={runCreateVariant}>＋新建方案</button>
            {selectedVariant?.status === "draft" && <>
              <button className="primary" onClick={runPublishVariant}>发布「{selectedVariant.name}」</button>
              <span className="hint">发布只把该方案固化为动作新修订；其他方案继续可编辑，旧发布动作仍能回放。</span>
            </>}
            {selectedVariant?.status === "published" && <span className="hint">该方案已发布为动作修订，内容只读。</span>}
          </div>
          {rebakeSegments.length > 0 && <div className="rebake-panel">
            <div className="card-title"><h3>源工程已更新：{rebakeSegments.length} 个受影响区间</h3><span>{selectedVariant?.status === "draft" ? `决定将写入「${selectedVariant.name}」` : "决定将写入当前动作"}；人工返修帧需单独决定</span></div>
            {rebakeSegments.map((segment, index) => <div key={index} className={segment.manual ? "rebake-row manual" : "rebake-row"}>
              <label>
                <input type="checkbox" checked={!!segmentSelected[index]}
                  onChange={(event) => setSegmentSelected((prev) => ({ ...prev, [index]: event.target.checked }))} />
                {segment.start.toFixed(2)}~{segment.end.toFixed(2)}s · {segment.bones.join("、")}
              </label>
              {segment.basis.length > 0 && <span className="basis">
                采用依据：{segment.basis.map((entry) =>
                  `${entry.id}（${entry.resolution === "keep" ? "保留手工" : "采用源"}·基于 v${entry.source_version}${entry.variant_id ? "·方案内" : ""}）`
                ).join("、")}
              </span>}
              {segment.manual && <span className="rebake-choice">
                <em>含人工返修关键帧：</em>
                <label><input type="radio" name={"seg-" + index} checked={(segmentChoices[index] ?? "keep") === "keep"}
                  onChange={() => setSegmentChoices((prev) => ({ ...prev, [index]: "keep" }))} />保留手工结果</label>
                <label><input type="radio" name={"seg-" + index} checked={segmentChoices[index] === "source"}
                  onChange={() => setSegmentChoices((prev) => ({ ...prev, [index]: "source" }))} />重新采用源动作</label>
              </span>}
            </div>)}
            <button className="primary bake-btn" onClick={runRebake} disabled={selectedVariant?.status === "published"}>
              <Scissors size={15} />确认所选区间的决定{selectedVariant?.status === "draft" ? `（写入${selectedVariant.name}）` : ""}
            </button>
          </div>}
          <ComparePanel project={project} action={activeAction} time={time}
            previewRevision={previewRevision} />
          {(activeAction.decision_log ?? []).length > 0 && <div className="decision-log">
            <div className="card-title"><h3>已确认采用决定</h3><span>撤回较早决定前会列出依赖关系，较晚的无关返修不会被抹掉</span></div>
            {(activeAction.decision_log ?? []).map((entry) => <div key={entry.id}
              className={entry.status === "withdrawn" ? "decision-row withdrawn" : "decision-row"}>
              <span>
                {entry.id} · r{entry.revision} · {entry.segment.start.toFixed(2)}~{entry.segment.end.toFixed(2)}s
                · {entry.segment.bones.join("、")} · {entry.resolution === "keep" ? "保留手工" : "采用源"}（基于 v{entry.source_version}）
                {entry.variant_id && ` · 方案 ${entry.variant_id}`}
                {entry.status === "withdrawn" && " · 已撤回"}
              </span>
              {(entry.status ?? "active") === "active" && !entry.variant_id
                && <button onClick={() => runWithdrawPreview(entry.id)}>撤回…</button>}
            </div>)}
            {withdrawPreview && <div className="withdraw-preview">
              <strong>撤回 {withdrawPreview.decision.id} 的影响分析：</strong>
              {withdrawPreview.dependents.length > 0
                ? <p className="hint warn">后续 {withdrawPreview.dependents.length} 项决定与其时间/骨骼相交，撤回会一并影响：
                  {withdrawPreview.dependents.map((entry) => entry.id).join("、")}</p>
                : <p className="hint">没有后续决定依赖它。</p>}
              {withdrawPreview.independent.length > 0
                ? <p className="hint">仍可独立保留的较晚结果：{withdrawPreview.independent.map((entry) =>
                    `${entry.id}（${entry.segment.start.toFixed(2)}~${entry.segment.end.toFixed(2)}s）`).join("、")}</p>
                : <p className="hint">没有其他较晚决定。</p>}
              <button className="primary" onClick={runWithdrawConfirm}>确认撤回（保留无关返修）</button>
              <button onClick={() => setWithdrawPreview(null)}>取消</button>
            </div>}
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
