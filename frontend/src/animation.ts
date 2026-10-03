export type Transform = { x: number; y: number; rotation: number };
export type Bone = {
  id: string;
  name: string;
  parent: string | null;
  rest: { x: number; y: number };
};
export type Keyframe = {
  id: string;
  time: number;
  pose: Record<string, Transform>;
  origin?: "baked" | "manual";
  kept_source_version?: number;
};
export type Layer = {
  id: string;
  name: string;
  weight: number;
  start: number;
  end: number;
  fade_in: number;
  fade_out: number;
  bones: string[];
  weight_keys?: WeightKey[];
  keyframes: Keyframe[];
};
export type WeightKey = { id: string; time: number; weight: number };
export type BakedSource = {
  action_id: string;
  source_version: number;
  range_start: number;
  range_end: number;
  bones: string[];
  fps: number;
  created_at: string;
  updated_at?: string;
};
export type ActionRevision = { revision: number; keyframes: Keyframe[]; saved_at: string };
export type DecisionSegment = {
  start: number;
  end: number;
  resolution: "source" | "keep";
  bones: string[];
  manual: boolean;
};
export type DecisionEntry = {
  id: string;
  revision: number;
  source_version: number;
  applied_at: string;
  segments: DecisionSegment[];
  frames: Keyframe[];
  plan_id?: string;
};
export type RebakePlan = {
  id: string;
  name: string;
  created_at: string;
  base_revision: number;
  source_version: number;
  decisions: DecisionSegment[];
  keyframes: Keyframe[];
  published: boolean;
  published_revision?: number;
};
export type WithdrawalRecord = { withdrawn_ids: string[]; revision: number; at: string };
export type Action = {
  id: string;
  name: string;
  duration: number;
  keyframes: Keyframe[];
  layers?: Layer[];
  revision?: number;
  previous_versions?: ActionRevision[];
  plans?: RebakePlan[];
  decision_log?: DecisionEntry[];
  withdrawals?: WithdrawalRecord[];
  source: BakedSource;
};
export type Project = {
  name: string;
  version: number;
  duration: number;
  skeleton: { bones: Bone[] };
  keyframes: Keyframe[];
  layers?: Layer[];
  actions?: Action[];
};
export type Clip = Pick<Project, "duration" | "keyframes"> & { layers?: Layer[] };

export const shortestAngleDelta = (start: number, end: number) =>
  ((((end - start) % 360) + 540) % 360) - 180;

export function validateClipContent(clip: { keyframes: Keyframe[]; layers?: Layer[] }, duration: number, bones: Bone[], prefix = ""): string[] {
  const errors: string[] = [];
  const byId = new Map(bones.map((bone) => [bone.id, bone]));
  const times = new Set<number>();
  if (clip.keyframes.length === 0) errors.push(`${prefix}至少需要一个关键姿态`);
  clip.keyframes.forEach((frame) => {
    if (!Number.isFinite(frame.time) || frame.time < 0) errors.push(`${prefix}关键姿态 ${frame.id} 时间必须是非负数字`);
    if (frame.time > duration) errors.push(`${prefix}关键姿态 ${frame.id} 的时间 ${frame.time} 超出动作时长`);
    if (times.has(frame.time)) errors.push(`关键姿态时间不能重复：${frame.time}`);
    times.add(frame.time);
    bones.forEach((bone) => {
      const transform = frame.pose[bone.id];
      if (!transform) errors.push(`${prefix}关键姿态 ${frame.id} 缺少骨骼 ${bone.id} 的姿态`);
      else if (![transform.x, transform.y, transform.rotation].every(Number.isFinite)) {
        errors.push(`${prefix}关键姿态 ${frame.id} 中骨骼 ${bone.id} 的 x/y/rotation 必须是数字`);
      }
    });
    Object.keys(frame.pose).forEach((boneId) => {
      if (!byId.has(boneId)) errors.push(`${prefix}关键姿态 ${frame.id} 包含未知骨骼 ${boneId}`);
    });
  });
  clip.layers?.forEach((layer, layerIndex) => {
    const prefix = `第 ${layerIndex + 1} 个动作层`;
    ["weight", "start", "end", "fade_in", "fade_out"].forEach((field) => {
      const value = layer[field as keyof Pick<Layer, "weight" | "start" | "end" | "fade_in" | "fade_out">];
      if (!Number.isFinite(value) || value < 0) errors.push(`${prefix}的 ${field} 必须是非负数字`);
    });
    if (layer.weight > 1) errors.push(`${prefix}的权重不能超过 1`);
    if (layer.start > layer.end) errors.push(`${prefix}的开始时间不能晚于结束时间`);
    if (layer.start > duration || layer.end > duration) errors.push(`${prefix}的时间范围超出动作时长`);
    if (layer.fade_in + layer.fade_out > layer.end - layer.start) errors.push(`${prefix}的淡入淡出总时长不能超过作用时间范围`);
    let lastWeightTime: number | null = null;
    (layer.weight_keys ?? []).forEach((weightKey, weightIndex) => {
      const keyPrefix = `${prefix}第 ${weightIndex + 1} 个权重关键帧`;
      if (!Number.isFinite(weightKey.time) || weightKey.time < 0 || weightKey.time > duration) {
        errors.push(`${keyPrefix}的时间必须在动作时长内`);
      }
      if (!Number.isFinite(weightKey.weight) || weightKey.weight < 0 || weightKey.weight > 1) {
        errors.push(`${keyPrefix}的权重必须在 0~1 之间`);
      }
      if (lastWeightTime !== null && weightKey.time <= lastWeightTime) errors.push(`${prefix}的权重关键帧时间必须严格递增`);
      lastWeightTime = weightKey.time;
    });
    if (layer.bones.length === 0) {
      errors.push(`${prefix}至少选择一根作用骨骼`);
    } else {
      layer.bones.forEach((boneId) => {
        if (!byId.has(boneId)) errors.push(`${prefix}引用了未知骨骼 ${boneId}`);
      });
      if (new Set(layer.bones).size !== layer.bones.length) errors.push(`${prefix}的作用骨骼不能重复`);
    }
    if (layer.keyframes.length === 0) {
      errors.push(`${prefix}至少需要一个关键姿态`);
      return;
    }
    const layerTimes = new Set<number>();
    layer.keyframes.forEach((frame) => {
      if (!Number.isFinite(frame.time) || frame.time < 0) errors.push(`${prefix}关键姿态 ${frame.id} 时间必须是非负数字`);
      if (layerTimes.has(frame.time)) errors.push(`${prefix}关键姿态时间不能重复：${frame.time}`);
      layerTimes.add(frame.time);
      const allowed = new Set(layer.bones);
      Object.entries(frame.pose).forEach(([boneId, transform]) => {
        if (!allowed.has(boneId)) errors.push(`${prefix}关键姿态 ${frame.id} 包含非作用骨骼 ${boneId}`);
        else if (![transform.x, transform.y, transform.rotation].every(Number.isFinite)) {
          errors.push(`${prefix}关键姿态 ${frame.id} 中骨骼 ${boneId} 的 x/y/rotation 必须是数字`);
        }
      });
      layer.bones.forEach((boneId) => {
        if (byId.has(boneId) && !frame.pose[boneId]) errors.push(`${prefix}关键姿态 ${frame.id} 缺少作用骨骼 ${boneId} 的姿态`);
      });
    });
  });
  return errors;
}

export function validateProject(project: Project): string[] {
  const errors: string[] = [];
  if (!Number.isFinite(project.duration) || project.duration <= 0) errors.push("动画时长必须是正数");
  const bones = project.skeleton.bones;
  const byId = new Map<string, Bone>();
  const roots: string[] = [];
  bones.forEach((bone, index) => {
    if (byId.has(bone.id)) errors.push(`骨骼 id 重复：${bone.id}`);
    else byId.set(bone.id, bone);
    if (bone.parent === null) roots.push(bone.id);
    if (bone.parent === bone.id) errors.push(`骨骼 ${bone.id} 不能把自己设为父骨骼`);
    if (!Number.isFinite(bone.rest.x) || !Number.isFinite(bone.rest.y)) {
      errors.push(`第 ${index + 1} 根骨骼的静止坐标必须是数字`);
    }
  });
  if (roots.length !== 1) errors.push(`骨架必须恰好有一个根节点，当前有 ${roots.length} 个`);
  bones.forEach((bone) => {
    if (bone.parent && !byId.has(bone.parent)) errors.push(`骨骼 ${bone.id} 引用了不存在的父骨骼 ${bone.parent}`);
    const seen = new Set<string>();
    let current = bone.parent;
    while (current) {
      if (current === bone.id || seen.has(current)) {
        errors.push(`骨骼层级存在循环：${bone.id}`);
        break;
      }
      seen.add(current);
      current = byId.get(current)?.parent ?? null;
    }
  });
  if (!Number.isInteger(project.version) || project.version < 1) errors.push("工程版本号必须是正整数");

  errors.push(...validateClipContent(project, project.duration, bones));

  const actionIds = new Set<string>();
  (project.actions ?? []).forEach((action, actionIndex) => {
    const prefix = `第 ${actionIndex + 1} 个整理动作`;
    if (actionIds.has(action.id)) errors.push(`${prefix}id 重复：${action.id}`);
    actionIds.add(action.id);
    if (!Number.isFinite(action.duration) || action.duration <= 0) {
      errors.push(`${prefix}的时长必须是正数`);
      return;
    }
    const source = action.source;
    if (!source || !source.action_id) errors.push(`${prefix}缺少来源动作 id（源工程为 __main__）`);
    if (!source || !Number.isInteger(source.source_version) || source.source_version < 1) errors.push(`${prefix}缺少来源版本号`);
    if (!source || !(source.range_end > source.range_start)) errors.push(`${prefix}的整理时间范围无效`);
    if (!source?.bones.length) errors.push(`${prefix}缺少整理骨骼范围`);
    else source.bones.forEach((boneId) => {
      if (!byId.has(boneId)) errors.push(`${prefix}的整理骨骼范围包含未知骨骼 ${boneId}`);
    });
    const planIds = new Set<string>();
    (action.plans ?? []).forEach((plan) => {
      if (!plan.id) errors.push(`${prefix}的方案缺少有效 id`);
      else if (planIds.has(plan.id)) errors.push(`${prefix}的方案 id 重复：${plan.id}`);
      planIds.add(plan.id);
      if (!plan.keyframes?.length) errors.push(`${prefix}的方案 ${plan.id} 缺少预览关键帧`);
    });
    const decisionIds = new Set<string>();
    (action.decision_log ?? []).forEach((entry) => {
      if (!entry.id) errors.push(`${prefix}的采用记录缺少有效 id`);
      else if (decisionIds.has(entry.id)) errors.push(`${prefix}的采用记录 id 重复：${entry.id}`);
      decisionIds.add(entry.id);
    });
    errors.push(...validateClipContent(action, action.duration, bones, `${prefix}内`));
  });
  return errors;
}

export const orderedKeyframes = (project: Project) =>
  [...project.keyframes].sort((a, b) => a.time - b.time);

export function weightKeyMultiplier(layer: Layer, time: number): number {
  const keys = [...(layer.weight_keys ?? [])].sort((a, b) => a.time - b.time);
  if (keys.length === 0) return 1;
  if (time <= keys[0].time) return Math.max(0, Math.min(1, keys[0].weight));
  if (time >= keys[keys.length - 1].time) return Math.max(0, Math.min(1, keys[keys.length - 1].weight));
  for (let i = 0; i < keys.length - 1; i += 1) {
    if (keys[i].time <= time && time <= keys[i + 1].time) {
      const span = keys[i + 1].time - keys[i].time;
      const alpha = span === 0 ? 0 : (time - keys[i].time) / span;
      return Math.max(0, Math.min(1, keys[i].weight + (keys[i + 1].weight - keys[i].weight) * alpha));
    }
  }
  return 1;
}

export function layerEnvelope(layer: Layer, time: number): number {
  if (layer.weight <= 0 || time < layer.start || time > layer.end) return 0;
  let ramp = 1;
  if (layer.fade_in > 0 && time < layer.start + layer.fade_in) ramp = (time - layer.start) / layer.fade_in;
  else if (layer.fade_out > 0 && time > layer.end - layer.fade_out) ramp = (layer.end - time) / layer.fade_out;
  return Math.max(0, Math.min(1, ramp)) * Math.min(layer.weight, 1) * weightKeyMultiplier(layer, time);
}

function blendTransform(base: Transform, overlay: Transform, weight: number): Transform {
  if (weight <= 0) return { ...base };
  if (weight >= 1) return { ...overlay };
  return {
    x: base.x + (overlay.x - base.x) * weight,
    y: base.y + (overlay.y - base.y) * weight,
    rotation: base.rotation + shortestAngleDelta(base.rotation, overlay.rotation) * weight,
  };
}

export function sampleFrames(frames: Keyframe[], time: number): Record<string, Transform> {
  const ordered = [...frames].sort((a, b) => a.time - b.time);
  if (time <= ordered[0].time) return structuredClone(ordered[0].pose);
  if (time >= ordered[ordered.length - 1].time) return structuredClone(ordered[ordered.length - 1].pose);
  let left = ordered[0];
  let right = ordered[ordered.length - 1];
  for (let i = 0; i < ordered.length - 1; i += 1) {
    if (ordered[i].time <= time && time <= ordered[i + 1].time) {
      left = ordered[i];
      right = ordered[i + 1];
      break;
    }
  }
  const alpha = right.time === left.time ? 0 : (time - left.time) / (right.time - left.time);
  return Object.fromEntries(
    Object.entries(left.pose).map(([boneId, a]) => {
      const b = right.pose[boneId] ?? a;
      return [boneId, {
        x: a.x + (b.x - a.x) * alpha,
        y: a.y + (b.y - a.y) * alpha,
        rotation: a.rotation + shortestAngleDelta(a.rotation, b.rotation) * alpha,
      }];
    }),
  );
}

export function sampleLocal(project: Project, time: number): Record<string, Transform> {
  const t = Math.min(Math.max(time, 0), project.duration);
  const result = sampleFrames(project.keyframes, t);
  (project.layers ?? []).forEach((layer) => {
    const weight = layerEnvelope(layer, t);
    if (weight <= 0) return;
    const overlay = sampleFrames(layer.keyframes, t);
    layer.bones.forEach((boneId) => {
      if (result[boneId] && overlay[boneId]) result[boneId] = blendTransform(result[boneId], overlay[boneId], weight);
    });
  });
  return result;
}

export function boneOrder(project: Project): string[] {
  const byId = new Map(project.skeleton.bones.map((bone) => [bone.id, bone]));
  const result: string[] = [];
  const visit = (boneId: string) => {
    if (result.includes(boneId)) return;
    const parent = byId.get(boneId)?.parent;
    if (parent && byId.has(parent)) visit(parent);
    result.push(boneId);
  };
  project.skeleton.bones.forEach((bone) => visit(bone.id));
  return result;
}

export type WorldTransform = Transform;

export function evaluateWorld(project: Project, time: number): Record<string, WorldTransform> {
  const local = sampleLocal(project, time);
  const byId = new Map(project.skeleton.bones.map((bone) => [bone.id, bone]));
  const world: Record<string, WorldTransform> = {};
  boneOrder(project).forEach((boneId) => {
    const current = local[boneId];
    const parent = byId.get(boneId)?.parent;
    if (!parent) {
      world[boneId] = { ...current };
      return;
    }
    const parentWorld = world[parent];
    const angle = (parentWorld.rotation * Math.PI) / 180;
    world[boneId] = {
      x: parentWorld.x + current.x * Math.cos(angle) - current.y * Math.sin(angle),
      y: parentWorld.y + current.x * Math.sin(angle) + current.y * Math.cos(angle),
      rotation: parentWorld.rotation + current.rotation,
    };
  });
  return world;
}

export function exportAction(project: Project, fps = 24) {
  const count = Math.round(project.duration * fps) + 1;
  return {
    name: project.name,
    duration: project.duration,
    fps,
    frames: Array.from({ length: count }, (_, index) => {
      const time = Math.min(index / fps, project.duration);
      return { time, local: sampleLocal(project, time), world: evaluateWorld(project, time) };
    }),
  };
}

export const cloneProject = (project: Project): Project => structuredClone(project);

const poseClose = (a: Record<string, Transform>, b: Record<string, Transform>, tolerance: number) => {
  const aKeys = Object.keys(a);
  if (aKeys.length !== Object.keys(b).length) return false;
  return aKeys.every((boneId) =>
    Math.abs(a[boneId].x - b[boneId].x) <= tolerance
    && Math.abs(a[boneId].y - b[boneId].y) <= tolerance
    && Math.abs(shortestAngleDelta(a[boneId].rotation, b[boneId].rotation)) <= tolerance);
};

export type BakeResult = { action: Action; warnings: string[] };

export function bakeAction(
  project: Project,
  rangeStart: number,
  rangeEnd: number,
  boneIds: string[],
  name: string,
  fps = 60,
): BakeResult {
  const problems: string[] = [];
  if (!Number.isFinite(rangeStart) || !Number.isFinite(rangeEnd)
      || rangeStart < 0 || rangeEnd > project.duration || rangeEnd <= rangeStart) {
    problems.push(`整理时间范围 ${rangeStart}~${rangeEnd}s 无效或超出工程时长 ${project.duration}s`);
  }
  const knownBones = new Set(project.skeleton.bones.map((bone) => bone.id));
  const selectedBones = [...new Set(boneIds)];
  const missing = selectedBones.filter((boneId) => !knownBones.has(boneId));
  if (missing.length) problems.push("缺失骨骼，未处理：" + missing.join("、"));
  if (!selectedBones.some((boneId) => knownBones.has(boneId))) problems.push("骨骼范围为空，无法整理");
  const validationErrors = validateProject(project);
  if (validationErrors.length) problems.push(...validationErrors.map((error) => `工程存在未解决冲突：${error}`));
  if (problems.length) throw new Error(problems.join("；"));

  const warnings: string[] = [];
  const selected = new Set(selectedBones);
  (project.layers ?? []).forEach((layer) => {
    const overlaps = Math.min(layer.end, rangeEnd) - Math.max(layer.start, rangeStart);
    if (overlaps <= 0) return;
    const covered = new Set(layer.bones.filter((boneId) => selected.has(boneId)));
    const uncovered = layer.bones.filter((boneId) => !selected.has(boneId));
    if (covered.size > 0 && uncovered.length > 0) {
      warnings.push(`层「${layer.name}」在范围内只选择了部分作用骨骼，已覆盖 ${uncovered.join("、")}，未处理`);
    }
  });
  if (warnings.length) throw new Error(warnings.join("；"));

  const span = rangeEnd - rangeStart;
  const count = Math.round(span * fps) + 1;
  const keyframes: Keyframe[] = [];
  let previous: Record<string, Transform> | null = null;
  for (let index = 0; index < count; index += 1) {
    const sourceTime = rangeStart + Math.min(index / fps, span);
    const pose = sampleLocal(project, sourceTime);
    const selectedPose = Object.fromEntries(selectedBones.map((boneId) => [boneId, { ...pose[boneId] }]));
    if (previous && poseClose(previous, selectedPose, 1e-7) && keyframes.length >= 2) {
      keyframes[keyframes.length - 1].time = Math.round((sourceTime - rangeStart) * 1e9) / 1e9;
    } else {
      keyframes.push({
        id: `baked-kf-${keyframes.length}`,
        time: Math.round((sourceTime - rangeStart) * 1e9) / 1e9,
        pose: selectedPose,
        origin: "baked",
      });
    }
    previous = selectedPose;
  }
  keyframes[keyframes.length - 1].time = span;

  const id = `action-${(project.actions ?? []).length + 1}-${Math.round(rangeStart * 1000)}-${Math.round(rangeEnd * 1000)}`;
  const action: Action = {
    id,
    name: name || `整理动作 ${rangeStart}~${rangeEnd}s`,
    duration: span,
   keyframes,
    layers: [],
    revision: 1,
    previous_versions: [],
    plans: [],
    decision_log: [],
    withdrawals: [],
    source: {
      action_id: "__main__",
      source_version: project.version,
      range_start: rangeStart,
      range_end: rangeEnd,
      bones: selectedBones,
      fps,
      created_at: new Date().toISOString(),
    },
  };
  for (let index = 0; index < count; index += 1) {
    const sourceTime = rangeStart + Math.min(index / fps, span);
    const sourcePose = sampleLocal(project, sourceTime);
    const bakedPose = keyframes[Math.min(index, keyframes.length - 1)].pose;
    selectedBones.forEach((boneId) => {
      if (Math.abs(shortestAngleDelta(bakedPose[boneId].rotation, sourcePose[boneId].rotation)) > 1e-7) {
        throw new Error(`整理结果在 ${sourceTime}s 的骨骼 ${boneId} 与原工程姿态不一致，已放弃整理`);
      }
    });
  }
  return { action, warnings };
}

export function migrateProject(project: Project): Project {
  const next = structuredClone(project);
  if (!Number.isInteger(next.version)) next.version = 1;
  if (!next.actions) next.actions = [];
  (next.layers ?? []).forEach((layer) => { if (!layer.weight_keys) layer.weight_keys = []; });
 next.actions.forEach((action) => {
   if (!Number.isInteger(action.revision)) action.revision = 1;
   if (!action.previous_versions) action.previous_versions = [];
    if (!action.plans) action.plans = [];
    if (!action.decision_log) action.decision_log = [];
    if (!action.withdrawals) action.withdrawals = [];
 });
  return next;
}

export type RebakeSegment = { start: number; end: number; bones: string[]; manual: boolean; acknowledged?: boolean };

const transformDiffers = (a: Transform, b: Transform, tolerance = 1e-7) =>
  Math.abs(a.x - b.x) > tolerance
  || Math.abs(a.y - b.y) > tolerance
  || Math.abs(shortestAngleDelta(b.rotation, a.rotation)) > tolerance;

export function analyzeRebake(project: Project, action: Action): RebakeSegment[] {
  const { fps, range_start: rangeStart, bones } = action.source;
  const span = action.duration;
  const count = Math.round(span * fps) + 1;
  const keyframeByIndex = new Map(action.keyframes.map((frame) => [Math.round(frame.time * fps), frame]));
  const cells: { index: number; time: number; bones: string[]; manual: boolean; acknowledged: boolean }[] = [];
  for (let index = 0; index < count; index += 1) {
    const localTime = Math.min(index / fps, span);
    const sourcePose = sampleLocal(project, rangeStart + localTime);
    const bakedPose = sampleFrames(action.keyframes, localTime);
    const differing = bones.filter((boneId) => sourcePose[boneId] && bakedPose[boneId]
      && transformDiffers(sourcePose[boneId], bakedPose[boneId]));
    if (differing.length === 0) continue;
    const keyframe = keyframeByIndex.get(index);
    const manual = keyframe?.origin === "manual";
    const acknowledged = manual && keyframe?.kept_source_version === project.version;
    cells.push({ index, time: localTime, bones: differing, manual, acknowledged });
  }
  const segments: (RebakeSegment & { lastIndex: number; ack: boolean })[] = [];
  cells.forEach((cell) => {
    const last = segments[segments.length - 1];
    if (last && cell.index === last.lastIndex + 1 && cell.manual === last.manual) {
      last.lastIndex = cell.index;
      last.end = cell.time;
      last.bones = [...new Set([...last.bones, ...cell.bones])].sort();
      last.ack = last.ack && cell.acknowledged;
    } else {
      segments.push({ lastIndex: cell.index, ack: cell.acknowledged, start: cell.time, end: cell.time, bones: [...cell.bones], manual: cell.manual });
    }
  });
  return segments.map(({ start, end, bones: segmentBones, manual, ack }) => ({ start, end, bones: segmentBones, manual, acknowledged: ack && manual }));
}

export type RebakeDecision = { segment: { start: number; end: number }; resolution: "source" | "keep" };

export function analyzeSharedRebake(project: Project) {
  return (project.actions ?? [])
    .map((action) => ({ action, segments: analyzeRebake(project, action) }))
    .filter((entry) => entry.segments.length > 0)
    .map((entry) => ({
      action_id: entry.action.id,
      name: entry.action.name,
      revision: entry.action.revision ?? 1,
      source_version: entry.action.source.source_version,
      current_source_version: project.version,
      segments: entry.segments,
    }));
}

function normalizeDecisions(project: Project, action: Action, decisions: RebakeDecision[]): DecisionSegment[] {
  const span = action.duration;
  const analysis = analyzeRebake(project, action);
  return decisions.map((decision) => {
    const start = Number(decision.segment.start);
    const end = Number(decision.segment.end);
    if (!(end >= start) || start < -1e-9 || end > span + 1e-9) throw new Error(`返修区间 ${start}~${end}s 无效`);
    const match = analysis.find((segment) => Math.abs(segment.start - start) < 1e-6 && Math.abs(segment.end - end) < 1e-6);
    return {
      start: Math.max(0, start),
      end: Math.min(end, span),
      resolution: decision.resolution,
      bones: match ? [...match.bones] : [...action.source.bones],
      manual: match ? match.manual : false,
    };
  });
}

function computeRebake(
  project: Project,
  action: Action,
  normalized: DecisionSegment[],
  revision: number,
): { keyframes: Keyframe[]; adoptedFrames: Keyframe[] } {
  const { fps, range_start: rangeStart, bones } = action.source;
  const span = action.duration;
  let keyframes = action.keyframes.map((frame) => ({ ...frame, pose: structuredClone(frame.pose) }));
  const adoptedFrames: Keyframe[] = [];
  normalized.forEach((segment) => {
    const { start, end } = segment;
    if (segment.resolution === "keep") {
      if (segment.manual) {
        keyframes.forEach((frame) => {
          if (frame.time >= start - 1e-9 && frame.time <= end + 1e-9 && frame.origin === "manual") {
            frame.kept_source_version = project.version;
          }
        });
      }
      return;
    }
    keyframes = keyframes.filter((frame) => frame.time < start - 1e-9 || frame.time > end + 1e-9);
    const firstIndex = Math.ceil(start * fps - 1e-9);
    const lastIndex = Math.floor(end * fps + 1e-9);
    for (let index = firstIndex; index <= lastIndex; index += 1) {
      const localTime = Math.min(index / fps, span);
      const sourcePose = sampleLocal(project, rangeStart + localTime);
      const frame: Keyframe = {
        id: `${action.id}-r${revision}-kf-${index}`,
        time: Math.round(localTime * 1e9) / 1e9,
        pose: Object.fromEntries(bones.map((boneId) => [boneId, { ...sourcePose[boneId] }])),
        origin: "baked",
      };
      keyframes.push(frame);
      adoptedFrames.push(structuredClone(frame));
    }
  });
  keyframes.sort((a, b) => a.time - b.time);
  return { keyframes, adoptedFrames };
}

export function applyRebake(project: Project, actionId: string, decisions: RebakeDecision[]): Project {
  const action = project.actions?.find((item) => item.id === actionId);
  if (!action) throw new Error(`找不到整理动作 ${actionId}`);
  if (decisions.length === 0) throw new Error("没有需要应用的返修区间");
  const normalized = normalizeDecisions(project, action, decisions);
  const adopted = normalized.filter((segment) => segment.resolution === "source");
  const keeps = normalized.filter((segment) => segment.resolution === "keep" && segment.manual);
  if (adopted.length === 0 && keeps.length === 0) throw new Error("没有需要应用的返修区间");
  const revision = (action.revision ?? 1) + 1;
  const { keyframes, adoptedFrames } = computeRebake(project, action, normalized, revision);
  const updated: Action = {
    ...structuredClone(action),
    keyframes,
    revision,
    previous_versions: [
      ...(action.previous_versions ?? []),
      { revision: action.revision ?? 1, keyframes: structuredClone(action.keyframes), saved_at: new Date().toISOString() },
    ],
    source: { ...action.source, updated_at: new Date().toISOString() },
    decision_log: [
      ...(action.decision_log ?? []),
      {
        id: `${actionId}-d${revision}`,
        revision,
        source_version: project.version,
        applied_at: new Date().toISOString(),
        segments: normalized,
        frames: adoptedFrames,
      },
    ],
  };
  if (analyzeRebake(project, updated).length === 0) updated.source.source_version = project.version;
  return {
    ...project,
    actions: (project.actions ?? []).map((item) => (item.id === actionId ? updated : item)),
  };
}

const replaceAction = (project: Project, updated: Action): Project => ({
  ...project,
  actions: (project.actions ?? []).map((item) => (item.id === updated.id ? updated : item)),
});

const requireAction = (project: Project, actionId: string): Action => {
  const action = project.actions?.find((item) => item.id === actionId);
  if (!action) throw new Error(`找不到整理动作 ${actionId}`);
  return action;
};

export function createPlan(project: Project, actionId: string, name: string, decisions: RebakeDecision[]): Project {
  const action = requireAction(project, actionId);
  if (decisions.length === 0) throw new Error("方案至少需要一条采用决定");
  const normalized = normalizeDecisions(project, action, decisions);
  if (!normalized.some((segment) => segment.resolution === "source" || segment.manual)) {
    throw new Error("方案不含任何采用或保留决定");
  }
  const revision = (action.revision ?? 1) + 1;
  const { keyframes } = computeRebake(project, action, normalized, revision);
  const plans = action.plans ?? [];
  const plan: RebakePlan = {
    id: `${actionId}-plan-${plans.length + 1}`,
    name: name.trim() || `方案 ${plans.length + 1}`,
    created_at: new Date().toISOString(),
    base_revision: action.revision ?? 1,
    source_version: project.version,
    decisions: normalized,
    keyframes,
    published: false,
  };
  return replaceAction(project, { ...structuredClone(action), plans: [...plans, plan] });
}

export function deletePlan(project: Project, actionId: string, planId: string): Project {
  const action = requireAction(project, actionId);
  const plans = action.plans ?? [];
  if (!plans.some((plan) => plan.id === planId)) throw new Error(`找不到方案 ${planId}`);
  return replaceAction(project, { ...structuredClone(action), plans: plans.filter((plan) => plan.id !== planId) });
}

export function publishPlan(project: Project, actionId: string, planId: string): Project {
  const action = requireAction(project, actionId);
  const plan = (action.plans ?? []).find((item) => item.id === planId);
  if (!plan) throw new Error(`找不到方案 ${planId}`);
  if (plan.published) throw new Error(`方案「${plan.name}」已发布过`);
  const revision = (action.revision ?? 1) + 1;
  const adoptedWindows = plan.decisions.filter((segment) => segment.resolution === "source");
  const adoptedFrames = plan.keyframes
    .filter((frame) => adoptedWindows.some((segment) => frame.time >= segment.start - 1e-9 && frame.time <= segment.end + 1e-9))
    .map((frame) => structuredClone(frame));
  const updated: Action = {
    ...structuredClone(action),
    keyframes: structuredClone(plan.keyframes),
    revision,
    previous_versions: [
      ...(action.previous_versions ?? []),
      { revision: action.revision ?? 1, keyframes: structuredClone(action.keyframes), saved_at: new Date().toISOString() },
    ],
    source: { ...action.source, updated_at: new Date().toISOString() },
    decision_log: [
      ...(action.decision_log ?? []),
      {
        id: `${actionId}-d${revision}`,
        revision,
        source_version: plan.source_version,
        applied_at: new Date().toISOString(),
        segments: plan.decisions.map((segment) => ({ ...segment })),
        frames: adoptedFrames,
        plan_id: planId,
      },
    ],
    plans: (action.plans ?? []).map((item) => (item.id === planId ? { ...item, published: true, published_revision: revision } : item)),
  };
  if (analyzeRebake(project, updated).length === 0) updated.source.source_version = project.version;
  return replaceAction(project, updated);
}

const segmentsOverlap = (a: DecisionSegment, b: DecisionSegment) =>
  Math.min(a.end, b.end) - Math.max(a.start, b.start) > 1e-9
  && a.bones.some((boneId) => b.bones.includes(boneId));

function withdrawClosure(log: DecisionEntry[], decisionId: string) {
  const target = log.find((entry) => entry.id === decisionId);
  if (!target) throw new Error(`找不到采用决定 ${decisionId}`);
  const withdrawn = new Set<string>([decisionId]);
  let changed = true;
  while (changed) {
    changed = false;
    log.forEach((entry) => {
      if (withdrawn.has(entry.id) || entry.revision <= target.revision) return;
      const dependent = log.some((other) => withdrawn.has(other.id)
        && entry.segments.some((segA) => other.segments.some((segB) => segmentsOverlap(segA, segB))));
      if (dependent) {
        withdrawn.add(entry.id);
        changed = true;
      }
    });
  }
  const independent = log.filter((entry) => !withdrawn.has(entry.id) && entry.revision > target.revision);
  return { target, withdrawn, independent };
}

export function analyzeWithdraw(project: Project, actionId: string, decisionId: string) {
  const action = requireAction(project, actionId);
  const log = action.decision_log ?? [];
  const { target, withdrawn, independent } = withdrawClosure(log, decisionId);
  return {
    target,
    dependents: log.filter((entry) => withdrawn.has(entry.id) && entry.id !== decisionId),
    independent,
    withdrawn_ids: [...withdrawn].sort(),
    base_revision: target.revision - 1,
  };
}

export function withdrawDecision(project: Project, actionId: string, decisionId: string): Project {
  const action = requireAction(project, actionId);
  const log = action.decision_log ?? [];
  const { target, withdrawn } = withdrawClosure(log, decisionId);
  const baseRevision = target.revision - 1;
  const snapshot = (action.previous_versions ?? []).find((item) => item.revision === baseRevision);
  if (!snapshot) throw new Error(`缺少修订 r${baseRevision} 的快照，无法安全撤回`);
  let keyframes = snapshot.keyframes.map((frame) => ({ ...frame, pose: structuredClone(frame.pose) }));
  log.forEach((entry) => {
    if (withdrawn.has(entry.id) || entry.revision <= baseRevision) return;
    entry.segments.forEach((segment) => {
      if (segment.resolution === "source") {
        keyframes = keyframes.filter((frame) => frame.time < segment.start - 1e-9 || frame.time > segment.end + 1e-9);
        keyframes.push(...entry.frames.map((frame) => structuredClone(frame)));
      } else if (segment.manual) {
        keyframes.forEach((frame) => {
          if (frame.time >= segment.start - 1e-9 && frame.time <= segment.end + 1e-9 && frame.origin === "manual") {
            frame.kept_source_version = entry.source_version;
          }
        });
      }
    });
  });
  keyframes.sort((a, b) => a.time - b.time);
  const revision = (action.revision ?? 1) + 1;
  const updated: Action = {
    ...structuredClone(action),
    keyframes,
    revision,
    previous_versions: [
      ...(action.previous_versions ?? []),
      { revision: action.revision ?? 1, keyframes: structuredClone(action.keyframes), saved_at: new Date().toISOString() },
    ],
    decision_log: log.filter((entry) => !withdrawn.has(entry.id)),
    withdrawals: [
      ...(action.withdrawals ?? []),
      { withdrawn_ids: [...withdrawn].sort(), revision, at: new Date().toISOString() },
    ],
  };
  return replaceAction(project, updated);
}

export type CompareReport = {
  action_id: string;
  fps: number;
  span: number;
  source_version: number;
  variants: { id: string; kind: string; label: string; decisions: DecisionSegment[]; source_version?: number }[];
  diffs: { a: string; b: string; frames: { time: number; bones: { bone: string; origin: "source" | "manual" }[] }[] }[];
  continuity: { variant: string; label: string; boundary: number; bone: string; delta: number }[];
};

export function compareActionVariants(project: Project, actionId: string, planIds?: string[]): CompareReport {
  const action = requireAction(project, actionId);
  const { fps, range_start: rangeStart, bones } = action.source;
  const span = action.duration;
  const count = Math.round(span * fps) + 1;
  type Variant = { id: string; kind: string; label: string; keyframes: Keyframe[]; decisions: DecisionSegment[]; source_version?: number };
  const variants: Variant[] = [{
    id: "current",
    kind: "current",
    label: `当前 r${action.revision ?? 1}`,
    keyframes: action.keyframes,
    decisions: [],
  }];
  (action.previous_versions ?? []).forEach((item) => variants.push({
    id: `r${item.revision}`,
    kind: "revision",
    label: `历史 r${item.revision}`,
    keyframes: item.keyframes,
    decisions: [],
  }));
  (action.plans ?? [])
    .filter((plan) => !planIds || planIds.includes(plan.id))
    .forEach((plan) => variants.push({
      id: plan.id,
      kind: "plan",
      label: plan.name,
      keyframes: plan.keyframes,
      decisions: plan.decisions,
      source_version: plan.source_version,
    }));
  const sourcePoses = Array.from({ length: count }, (_, index) => sampleLocal(project, rangeStart + Math.min(index / fps, span)));
  const variantPoses = new Map(variants.map((variant) => [
    variant.id,
    Array.from({ length: count }, (_, index) => sampleFrames(variant.keyframes, Math.min(index / fps, span))),
  ]));
  const diffFrames = (a: string, b: string) => {
    const posesA = variantPoses.get(a)!;
    const posesB = variantPoses.get(b)!;
    const frames: CompareReport["diffs"][number]["frames"] = [];
    for (let index = 0; index < count; index += 1) {
      const entries: { bone: string; origin: "source" | "manual" }[] = [];
      bones.forEach((boneId) => {
        const pa = posesA[index][boneId];
        const pb = posesB[index][boneId];
        if (!pa || !pb || !transformDiffers(pa, pb)) return;
        const sourcePose = sourcePoses[index][boneId];
        entries.push({ bone: boneId, origin: sourcePose && !transformDiffers(pb, sourcePose) ? "source" : "manual" });
      });
      if (entries.length > 0) frames.push({ time: Math.min(index / fps, span), bones: entries });
    }
    return frames;
  };
  const diffs: CompareReport["diffs"] = variants
    .filter((variant) => variant.id !== "current")
    .map((variant) => ({ a: "current", b: variant.id, frames: diffFrames("current", variant.id) }));
  const planVariants = variants.filter((variant) => variant.kind === "plan");
  if (planVariants.length === 2) {
    diffs.push({ a: planVariants[0].id, b: planVariants[1].id, frames: diffFrames(planVariants[0].id, planVariants[1].id) });
  }
  const continuity: CompareReport["continuity"] = [];
  variants.forEach((variant) => {
    const poses = variantPoses.get(variant.id)!;
    variant.decisions.filter((segment) => segment.resolution === "source").forEach((segment) => {
      [
        { boundary: segment.start, outside: Math.ceil(segment.start * fps - 1e-9) - 1 },
        { boundary: segment.end, outside: Math.floor(segment.end * fps + 1e-9) + 1 },
      ].forEach(({ boundary, outside }) => {
        const inside = boundary === segment.start ? outside + 1 : outside - 1;
        if (outside < 0 || outside >= count || inside < 0 || inside >= count) return;
        (segment.bones.length ? segment.bones : bones).forEach((boneId) => {
          const pin = poses[inside][boneId];
          const pout = poses[outside][boneId];
          if (!pin || !pout) return;
          const delta = Math.max(
            Math.abs(shortestAngleDelta(pout.rotation, pin.rotation)),
            Math.abs(pin.x - pout.x),
            Math.abs(pin.y - pout.y),
          );
          if (delta > 1e-6) continuity.push({ variant: variant.id, label: variant.label, boundary, bone: boneId, delta });
        });
      });
    });
  });
  return {
    action_id: actionId,
    fps,
    span,
    source_version: project.version,
    variants: variants.map(({ keyframes: _keyframes, ...rest }) => rest),
    diffs,
    continuity,
  };
}

export function addWeightKey(project: Project, layerId: string, time: number, weight: number): Project {
  const next = cloneProject(project);
  const layer = next.layers?.find((item) => item.id === layerId);
  if (!layer) return next;
  layer.weight_keys = [...(layer.weight_keys ?? []), { id: `wk-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, time, weight }]
    .sort((a, b) => a.time - b.time);
  return next;
}

export function updateWeightKey(project: Project, layerId: string, keyId: string, patch: Partial<{ time: number; weight: number }>): Project {
  const next = cloneProject(project);
  const key = next.layers?.find((item) => item.id === layerId)?.weight_keys?.find((item) => item.id === keyId);
  if (key) Object.assign(key, patch);
  return next;
}

export function removeWeightKey(project: Project, layerId: string, keyId: string): Project {
  const next = cloneProject(project);
  const layer = next.layers?.find((item) => item.id === layerId);
  if (layer?.weight_keys) layer.weight_keys = layer.weight_keys.filter((item) => item.id !== keyId);
  return next;
}

export function moveKeyframe(project: Project, keyframeId: string, time: number): Project {
  const next = cloneProject(project);
  const frame = next.keyframes.find((item) => item.id === keyframeId);
  if (frame) {
    frame.time = Math.min(Math.max(time, 0), next.duration);
    if (frame.origin) frame.origin = "manual";
  }
  return next;
}

export function duplicateKeyframe(project: Project, keyframeId: string): Project {
  const next = cloneProject(project);
  const source = next.keyframes.find((item) => item.id === keyframeId);
  if (!source) return next;
  const offset = Math.min(0.1, Math.max(0.01, next.duration / 20));
  const time = source.time + offset >= next.duration ? source.time - offset : source.time + offset;
  next.keyframes.push({ ...structuredClone(source), id: `${source.id}-copy-${Date.now()}`, time, origin: source.origin ? "manual" : undefined });
  return next;
}

export function updatePose(project: Project, frameId: string, boneId: string, patch: Partial<Transform>): Project {
  const next = cloneProject(project);
  const frame = next.keyframes.find((item) => item.id === frameId);
  if (frame) {
    Object.assign(frame.pose[boneId], patch);
    if (frame.origin) frame.origin = "manual";
  }
  return next;
}

export function updateLayer(project: Project, layerId: string, patch: Partial<Layer>): Project {
  const next = cloneProject(project);
  const layer = next.layers?.find((item) => item.id === layerId);
  if (layer) Object.assign(layer, patch);
  return next;
}

export function updateLayerPose(
  project: Project,
  layerId: string,
  frameId: string,
  boneId: string,
  patch: Partial<Transform>,
): Project {
  const next = cloneProject(project);
  const frame = next.layers?.find((item) => item.id === layerId)?.keyframes.find((item) => item.id === frameId);
  if (frame?.pose[boneId]) Object.assign(frame.pose[boneId], patch);
  return next;
}

export function addLayerKeyframe(project: Project, layerId: string): Project {
  const next = cloneProject(project);
  const layer = next.layers?.find((item) => item.id === layerId);
  if (!layer || layer.keyframes.length === 0) return next;
  const ordered = [...layer.keyframes].sort((a, b) => a.time - b.time);
  const times = ordered.map((frame) => frame.time);
  const midpoint = (times[0] + times[times.length - 1]) / 2;
  const candidate = [...times, midpoint, 0, project.duration].sort((a, b) => a - b)
    .find((value) => times.every((existing) => Math.abs(existing - value) > 1e-6)) ?? midpoint;
  const pose = Object.fromEntries(layer.bones.map((boneId) => [boneId, { ...(sampleFrames(layer.keyframes, candidate)[boneId]) }]));
  layer.keyframes.push({ id: `${layerId}-kf-${Date.now()}`, time: candidate, pose });
  return next;
}
