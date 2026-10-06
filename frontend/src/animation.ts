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
  origin_source_version?: number;
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
export type DecisionRecord = {
  id: string;
  revision: number;
  variant_id?: string | null;
  batch_id?: string | null;
  segment: { start: number; end: number; bones: string[] };
  resolution: "source" | "keep";
  source_version: number;
  status?: "active" | "withdrawn";
  created_at?: string;
};
export type ActionVariant = {
  id: string;
  name: string;
  status: "draft" | "published";
  keyframes: Keyframe[];
  revision: number;
  created_at?: string;
  published_at?: string;
};
export type Action = {
  id: string;
  name: string;
  duration: number;
  keyframes: Keyframe[];
  layers?: Layer[];
  revision?: number;
  previous_versions?: ActionRevision[];
  decision_log?: DecisionRecord[];
  variants?: ActionVariant[];
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
  review_batches?: ReviewBatch[];
};
export type ReviewSegment = {
  start: number;
  end: number;
  bones: string[];
  manual: boolean;
  basis?: DecisionBasis[];
  resolution: "source" | "keep" | "pending";
  resolved?: boolean;
  joint_published?: boolean;
};
export type ReviewItem = {
  action_id: string;
  variant_id: string;
  status: "open" | "decided" | "published" | "missing";
  source_version: number;
  segments: ReviewSegment[];
  published_at?: string;
};
export type ReviewBatch = {
  id: string;
  name?: string;
  source_version: number;
  status: "open" | "decided" | "partially_submitted" | "published";
  created_at?: string;
  items: ReviewItem[];
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
    if (frame.origin_source_version !== undefined
        && (!Number.isInteger(frame.origin_source_version) || frame.origin_source_version < 1)) {
      errors.push(`${prefix}关键姿态 ${frame.id} 的 origin_source_version 必须是正整数`);
    }
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
    const decisionIds = new Set<string>();
    (action.decision_log ?? []).forEach((entry, entryIndex) => {
      const entryPrefix = `${prefix}第 ${entryIndex + 1} 条采用决定`;
      if (!entry.id) errors.push(`${entryPrefix}缺少有效 id`);
      else if (decisionIds.has(entry.id)) errors.push(`${entryPrefix}id 重复：${entry.id}`);
      else decisionIds.add(entry.id);
      if (entry.resolution !== "source" && entry.resolution !== "keep") errors.push(`${entryPrefix}的决定必须是 source 或 keep`);
      if (entry.status !== undefined && entry.status !== "active" && entry.status !== "withdrawn") {
        errors.push(`${entryPrefix}的状态必须是 active 或 withdrawn`);
      }
      if (!Number.isInteger(entry.source_version) || entry.source_version < 1) errors.push(`${entryPrefix}缺少采用依据的源版本号`);
      if (!Number.isFinite(entry.segment?.start) || !Number.isFinite(entry.segment?.end)
          || entry.segment.end < entry.segment.start) errors.push(`${entryPrefix}的时间区间无效`);
    });
    const variantIds = new Set<string>();
    (action.variants ?? []).forEach((variant, variantIndex) => {
      const variantPrefix = `${prefix}第 ${variantIndex + 1} 个采用方案`;
      if (!variant.id) errors.push(`${variantPrefix}缺少有效 id`);
      else if (variantIds.has(variant.id)) errors.push(`${variantPrefix}id 重复：${variant.id}`);
      else variantIds.add(variant.id);
      if (!variant.name) errors.push(`${variantPrefix}缺少名称`);
      if (variant.status !== "draft" && variant.status !== "published") errors.push(`${variantPrefix}的状态必须是 draft 或 published`);
      if (!Number.isInteger(variant.revision) || variant.revision < 1) errors.push(`${variantPrefix}的修订号必须是正整数`);
      errors.push(...validateClipContent({ keyframes: variant.keyframes, layers: [] }, action.duration, bones, `${variantPrefix}内`));
    });
    errors.push(...validateClipContent(action, action.duration, bones, `${prefix}内`));
  });
  const batchIds = new Set<string>();
  (project.review_batches ?? []).forEach((batch, batchIndex) => {
    const prefix = `第 ${batchIndex + 1} 个审阅批次`;
    if (!batch.id) errors.push(`${prefix}缺少有效 id`);
    else if (batchIds.has(batch.id)) errors.push(`${prefix}id 重复：${batch.id}`);
    else batchIds.add(batch.id);
    if (!["open", "decided", "partially_submitted", "published"].includes(batch.status)) {
      errors.push(`${prefix}的状态无效`);
    }
    if (batch.items.length === 0) errors.push(`${prefix}至少包含一个受影响动作`);
    batch.items.forEach((item, itemIndex) => {
      const itemPrefix = `${prefix}第 ${itemIndex + 1} 项`;
      if (!actionIds.has(item.action_id)) errors.push(`${itemPrefix}引用了不存在的动作`);
      if (!item.variant_id) errors.push(`${itemPrefix}缺少批次草稿 id`);
      if (!["open", "decided", "published", "missing"].includes(item.status)) errors.push(`${itemPrefix}的状态无效`);
      item.segments.forEach((segment, segmentIndex) => {
        if (!["source", "keep", "pending"].includes(segment.resolution)) {
          errors.push(`${itemPrefix}第 ${segmentIndex + 1} 段必须采用新源、保留旧依据或待定`);
        }
      });
    });
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
    decision_log: [],
    variants: [],
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
    if (!action.decision_log) action.decision_log = [];
    if (!action.variants) action.variants = [];
  });
  if (!next.review_batches) next.review_batches = [];
  return next;
}

export type DecisionBasis = {
  id: string;
  revision?: number;
  resolution?: "source" | "keep";
  source_version?: number;
  variant_id?: string | null;
};
export type RebakeSegment = { start: number; end: number; bones: string[]; manual: boolean; basis: DecisionBasis[] };

const segmentsIntersect = (
  first: { start: number; end: number; bones: string[] },
  second: { start: number; end: number; bones?: string[] },
) => {
  if (first.start > second.end + 1e-9 || second.start > first.end + 1e-9) return false;
  return first.bones.some((boneId) => (second.bones ?? []).includes(boneId));
};

const transformDiffers = (a: Transform, b: Transform, tolerance = 1e-7) =>
  Math.abs(a.x - b.x) > tolerance
  || Math.abs(a.y - b.y) > tolerance
  || Math.abs(shortestAngleDelta(b.rotation, a.rotation)) > tolerance;

export function analyzeRebake(project: Project, action: Action, variantId?: string | null): RebakeSegment[] {
  const { fps, range_start: rangeStart, bones } = action.source;
  const span = action.duration;
  const count = Math.round(span * fps) + 1;
  const variant = variantId == null
    ? null
    : action.variants?.find((item) => item.id === variantId) ?? null;
  if (variantId != null && !variant) throw new Error(`找不到方案 ${variantId}`);
  const compareFrames = variant ? variant.keyframes : action.keyframes;
  const keyframeByIndex = new Map(compareFrames.map((frame) => [Math.round(frame.time * fps), frame]));
  const cells: { index: number; time: number; bones: string[]; manual: boolean }[] = [];
  for (let index = 0; index < count; index += 1) {
    const localTime = Math.min(index / fps, span);
    const sourcePose = sampleLocal(project, rangeStart + localTime);
    const bakedPose = sampleFrames(compareFrames, localTime);
    const differing = bones.filter((boneId) => sourcePose[boneId] && bakedPose[boneId]
      && transformDiffers(sourcePose[boneId], bakedPose[boneId]));
    if (differing.length === 0) continue;
    cells.push({ index, time: localTime, bones: differing, manual: keyframeByIndex.get(index)?.origin === "manual" });
  }
  const segments: (Omit<RebakeSegment, "basis"> & { lastIndex: number })[] = [];
  cells.forEach((cell) => {
    const last = segments[segments.length - 1];
    if (last && cell.index === last.lastIndex + 1 && cell.manual === last.manual) {
      last.lastIndex = cell.index;
      last.end = cell.time;
      last.bones = [...new Set([...last.bones, ...cell.bones])].sort();
    } else {
      segments.push({ lastIndex: cell.index, start: cell.time, end: cell.time, bones: [...cell.bones], manual: cell.manual });
    }
  });
  const activeDecisions = (action.decision_log ?? []).filter((entry) => (entry.status ?? "active") === "active"
    && (variantId == null ? !entry.variant_id : entry.variant_id === variantId));
  return segments.map(({ start, end, bones: segmentBones, manual }) => ({
    start,
    end,
    bones: segmentBones,
    manual,
    basis: activeDecisions
      .filter((entry) => segmentsIntersect({ start, end, bones: segmentBones }, entry.segment))
      .map((entry) => ({
        id: entry.id,
        revision: entry.revision,
        resolution: entry.resolution,
        source_version: entry.source_version,
        variant_id: entry.variant_id ?? null,
      })),
  }));
}

export type RebakeDecision = { segment: { start: number; end: number; bones?: string[] }; resolution: "source" | "keep" };

export function applyRebake(project: Project, actionId: string, decisions: RebakeDecision[], variantId?: string | null, batchId?: string | null): Project {
  const action = project.actions?.find((item) => item.id === actionId);
  if (!action) throw new Error(`找不到整理动作 ${actionId}`);
  const confirmed = decisions.filter((decision) => decision.resolution === "source" || decision.resolution === "keep");
  if (confirmed.length === 0) throw new Error("没有需要应用的返修区间");
  const adopted = confirmed.filter((decision) => decision.resolution === "source");
  const keeps = confirmed.filter((decision) => decision.resolution === "keep");
  const { fps, range_start: rangeStart, bones } = action.source;
  const span = action.duration;
  const variant = variantId == null ? null : action.variants?.find((item) => item.id === variantId) ?? null;
  if (variantId != null && !variant) throw new Error(`找不到方案 ${variantId}`);
  if (variant && variant.status !== "draft") throw new Error(`方案「${variant.name}」已发布，不能再编辑`);
  let keyframes = (variant ? variant.keyframes : action.keyframes).map((frame) => ({ ...frame, pose: structuredClone(frame.pose) }));
  const revision = ((variant ? variant.revision : action.revision) ?? 1) + 1;
  adopted.forEach(({ segment }) => {
    const { start, end } = segment;
    if (!(end >= start) || start < -1e-9 || end > span + 1e-9) throw new Error(`返修区间 ${start}~${end}s 无效`);
    keyframes = keyframes.filter((frame) => frame.time < start - 1e-9 || frame.time > end + 1e-9);
    const firstIndex = Math.ceil(start * fps - 1e-9);
    const lastIndex = Math.floor(end * fps + 1e-9);
    for (let index = firstIndex; index <= lastIndex; index += 1) {
      const localTime = Math.min(index / fps, span);
      const sourcePose = sampleLocal(project, rangeStart + localTime);
      keyframes.push({
        id: `${actionId}-r${revision}-kf-${index}`,
        time: Math.round(localTime * 1e9) / 1e9,
        pose: Object.fromEntries(bones.map((boneId) => [boneId, { ...sourcePose[boneId] }])),
        origin: "baked",
      });
    }
  });
  keeps.forEach(({ segment }) => {
    const { start, end } = segment;
    if (!(end >= start) || start < -1e-9 || end > span + 1e-9) throw new Error(`保留区间 ${start}~${end}s 无效`);
    keyframes.forEach((frame) => {
      if (frame.time >= start - 1e-9 && frame.time <= end + 1e-9 && frame.origin === "manual") {
        frame.origin_source_version = project.version;
      }
    });
  });
  keyframes.sort((a, b) => a.time - b.time);
  const newEntries: DecisionRecord[] = confirmed.map((decision, index) => ({
    id: `${actionId}-d${(action.decision_log ?? []).length + index + 1}`,
    revision,
    variant_id: variantId ?? null,
    batch_id: batchId ?? null,
    segment: {
      start: decision.segment.start,
      end: decision.segment.end,
      bones: [...(decision.segment.bones ?? action.source.bones)],
    },
    resolution: decision.resolution,
    source_version: project.version,
    status: "active",
    created_at: new Date().toISOString(),
  }));
  const decisionLog = [...(action.decision_log ?? []), ...newEntries];
  if (variant) {
    const updatedAction: Action = {
      ...structuredClone(action),
      decision_log: decisionLog,
      variants: (action.variants ?? []).map((item) => (item.id === variant.id
        ? { ...item, keyframes, revision }
        : item)),
    };
    return {
      ...project,
      actions: (project.actions ?? []).map((item) => (item.id === actionId ? updatedAction : item)),
    };
  }
  const updated: Action = {
    ...structuredClone(action),
    keyframes,
    revision,
    decision_log: decisionLog,
    previous_versions: [
      ...(action.previous_versions ?? []),
      { revision: action.revision ?? 1, keyframes: structuredClone(action.keyframes), saved_at: new Date().toISOString() },
    ],
    source: { ...action.source, updated_at: new Date().toISOString() },
  };
  if (analyzeRebake(project, updated).length === 0) updated.source.source_version = project.version;
  return {
    ...project,
    actions: (project.actions ?? []).map((item) => (item.id === actionId ? updated : item)),
  };
}

export function createVariant(project: Project, actionId: string, name = ""): Project {
  const action = project.actions?.find((item) => item.id === actionId);
  if (!action) throw new Error(`找不到整理动作 ${actionId}`);
  const variants = [...(action.variants ?? [])];
  const id = `${actionId}-var-${variants.length + 1}`;
  if (variants.some((item) => item.id === id)) throw new Error(`方案 id 重复：${id}`);
  variants.push({
    id,
    name: name || `方案 ${variants.length + 1}`,
    status: "draft",
    keyframes: structuredClone(action.keyframes),
    revision: 1,
    created_at: new Date().toISOString(),
  });
  const updated: Action = { ...structuredClone(action), variants };
  return { ...project, actions: (project.actions ?? []).map((item) => (item.id === actionId ? updated : item)) };
}

export function publishVariant(project: Project, actionId: string, variantId: string): Project {
  const action = project.actions?.find((item) => item.id === actionId);
  if (!action) throw new Error(`找不到整理动作 ${actionId}`);
  const variant = action.variants?.find((item) => item.id === variantId);
  if (!variant) throw new Error(`找不到方案 ${variantId}`);
  if (variant.status !== "draft") throw new Error(`方案「${variant.name}」已发布过`);
  const updated: Action = {
    ...structuredClone(action),
    keyframes: structuredClone(variant.keyframes),
    revision: (action.revision ?? 1) + 1,
    previous_versions: [
      ...(action.previous_versions ?? []),
      { revision: action.revision ?? 1, keyframes: structuredClone(action.keyframes), saved_at: new Date().toISOString() },
    ],
    variants: (action.variants ?? []).map((item) => (item.id === variantId
      ? { ...item, status: "published" as const, published_at: new Date().toISOString() }
      : item)),
    source: { ...action.source, updated_at: new Date().toISOString() },
  };
  if (analyzeRebake(project, updated).length === 0) updated.source.source_version = project.version;
  return { ...project, actions: (project.actions ?? []).map((item) => (item.id === actionId ? updated : item)) };
}

export type WithdrawalPreview = {
  decision: DecisionRecord;
  dependents: DecisionRecord[];
  independent: DecisionRecord[];
};

export function withdrawalPreview(project: Project, actionId: string, decisionId: string): WithdrawalPreview {
  const action = project.actions?.find((item) => item.id === actionId);
  if (!action) throw new Error(`找不到整理动作 ${actionId}`);
  const log = action.decision_log ?? [];
  const index = log.findIndex((entry) => entry.id === decisionId);
  if (index < 0) throw new Error(`找不到采用决定 ${decisionId}`);
  const decision = log[index];
  if ((decision.status ?? "active") !== "active") throw new Error(`决定 ${decisionId} 已被撤回`);
  const later = log.slice(index + 1).filter((entry) => (entry.status ?? "active") === "active");
  const dependents = later.filter((entry) => segmentsIntersect(decision.segment, entry.segment));
  const independent = later.filter((entry) => !dependents.includes(entry));
  return { decision, dependents, independent };
}

export function withdrawDecision(project: Project, actionId: string, decisionId: string, confirm = false): Project {
  const action = project.actions?.find((item) => item.id === actionId);
  if (!action) throw new Error(`找不到整理动作 ${actionId}`);
  const preview = withdrawalPreview(project, actionId, decisionId);
  const { decision, dependents } = preview;
  if (decision.variant_id) throw new Error("方案内的决定请通过继续编辑该方案处理，不能单独撤回");
  if (dependents.length > 0 && !confirm) {
    throw new Error(`该决定被后续决定依赖（${dependents.map((entry) => entry.id).join("、")}），确认后才会撤回`);
  }
  const { start, end } = decision.segment;
  const snapshot = (action.previous_versions ?? []).find((item) => item.revision === decision.revision - 1);
  if (!snapshot) throw new Error("缺少该决定应用前的版本快照，无法安全撤回");
  const restored = snapshot.keyframes
    .filter((frame) => frame.time >= start - 1e-9 && frame.time <= end + 1e-9)
    .map((frame) => structuredClone(frame));
  const keyframes = [
    ...action.keyframes.filter((frame) => frame.time < start - 1e-9 || frame.time > end + 1e-9)
      .map((frame) => ({ ...frame, pose: structuredClone(frame.pose) })),
    ...restored,
  ].sort((a, b) => a.time - b.time);
  const updated: Action = {
    ...structuredClone(action),
    keyframes,
    revision: (action.revision ?? 1) + 1,
    previous_versions: [
      ...(action.previous_versions ?? []),
      { revision: action.revision ?? 1, keyframes: structuredClone(action.keyframes), saved_at: new Date().toISOString() },
    ],
    decision_log: (action.decision_log ?? []).map((entry) => (entry.id === decisionId
      ? { ...entry, status: "withdrawn" as const }
      : entry)),
    source: { ...action.source, updated_at: new Date().toISOString() },
  };
  return { ...project, actions: (project.actions ?? []).map((item) => (item.id === actionId ? updated : item)) };
}

export type ContinuityReport = {
  maxInsideDelta: number;
  maxBoundaryDelta: number;
  maxOutsideDelta: number;
  boundaries: { time: number; delta: number }[];
};

const segmentKey = (segment: { start: number; end: number; bones?: string[] }) =>
  [segment.start, segment.end, [...(segment.bones ?? [])].sort().join(",")].join("|");

const refreshBatchItem = (project: Project, item: ReviewItem) => {
  const action = project.actions?.find((entry) => entry.id === item.action_id);
  if (!action) {
    item.segments = [];
    item.status = "missing";
    return;
  }
  const fresh = analyzeRebake(project, action, item.variant_id);
  const prior = new Map(
    item.segments
      .filter((segment) => segment.resolution === "source" || segment.resolution === "keep")
      .map((segment) => [segmentKey(segment), segment]),
  );
  const seen = new Set<string>();
  const segments: ReviewSegment[] = fresh.map((segment) => {
    const key = segmentKey(segment);
    seen.add(key);
    const decided = prior.get(key);
    return {
      ...segment,
      basis: segment.basis,
      resolution: decided?.resolution ?? "pending",
      resolved: false,
      joint_published: decided?.joint_published ?? false,
    };
  });
  prior.forEach((decided, key) => {
    if (!seen.has(key)) {
      segments.push({
        start: decided.start, end: decided.end, bones: decided.bones, manual: decided.manual,
        basis: decided.basis, resolution: decided.resolution, resolved: true,
        joint_published: decided.joint_published ?? false,
      });
    }
  });
  segments.sort((a, b) => a.start - b.start || a.end - b.end);
  item.segments = segments;
  item.status = segments.length > 0 && segments.every((segment) => segment.resolution !== "pending")
    ? "decided"
    : "open";
};

const refreshBatch = (project: Project, batch: ReviewBatch) => {
  batch.items.forEach((item) => {
    if (item.status !== "published") refreshBatchItem(project, item);
  });
  batch.status = batch.items.every((item) => item.status === "published")
    ? "published"
    : batch.items.some((item) => item.status === "published")
      ? "partially_submitted"
      : "open";
};

export function reviewBatchSummary(project: Project, batchId: string): ReviewBatch {
  const batch = project.review_batches?.find((item) => item.id === batchId);
  if (!batch) throw new Error(`找不到审阅批次 ${batchId}`);
  const copy = structuredClone(batch);
  refreshBatch(project, copy);
  return copy;
}

export function createReviewBatch(project: Project, actionIds?: string[], batchId?: string, name = ""): Project {
  const next = cloneProject(project);
  const batches = [...(next.review_batches ?? [])];
  const id = batchId ?? `batch-${batches.length + 1}`;
  if (batches.some((item) => item.id === id)) throw new Error(`审阅批次 id 重复：${id}`);
  const items: ReviewItem[] = [];
  (next.actions ?? []).forEach((action) => {
    if (actionIds && !actionIds.includes(action.id)) return;
    const segments = analyzeRebake(next, action);
    if (segments.length === 0) {
      if (actionIds?.includes(action.id)) throw new Error(`动作 ${action.id} 当前没有受源修订影响的区间`);
      return;
    }
    const variants = action.variants ?? [];
    let variantIndex = variants.length + 1;
    let variantId = `${action.id}-${id}-draft`;
    while (variants.some((item) => item.id === variantId)) {
      variantIndex += 1;
      variantId = `${action.id}-${id}-draft-${variantIndex}`;
    }
    variants.push({
      id: variantId,
      name: `批次草稿 ${variantIndex}`,
      status: "draft",
      keyframes: structuredClone(action.keyframes),
      revision: 1,
      created_at: new Date().toISOString(),
    });
    action.variants = variants;
    items.push({
      action_id: action.id,
      variant_id: variantId,
      status: "open",
      source_version: next.version,
      segments: segments.map((segment) => ({
        start: segment.start, end: segment.end, bones: segment.bones,
        manual: segment.manual, basis: segment.basis, resolution: "pending" as const,
      })),
    });
  });
  if (actionIds) {
    const known = new Set((next.actions ?? []).map((action) => action.id));
    const missing = actionIds.filter((actionId) => !known.has(actionId));
    if (missing.length) throw new Error(`以下动作不存在：${missing.join("、")}`);
  }
  if (items.length === 0) throw new Error("没有受源修订影响的整理动作，无法创建审阅批次");
  batches.push({
    id,
    name: name || `源 v${next.version} 批次审阅`,
    source_version: next.version,
    status: "open",
    created_at: new Date().toISOString(),
    items,
  });
  next.review_batches = batches;
  return next;
}

export function setReviewItemDecisions(
  project: Project,
  batchId: string,
  actionId: string,
  resolutions: Record<number, "source" | "keep" | "pending"> | ReviewSegment[],
): Project {
  const next = cloneProject(project);
  const batch = next.review_batches?.find((item) => item.id === batchId);
  if (!batch) throw new Error(`找不到审阅批次 ${batchId}`);
  const item = batch.items.find((entry) => entry.action_id === actionId);
  if (!item) throw new Error(`动作 ${actionId} 不在审阅批次中`);
  if (item.status === "published") throw new Error("该动作的批次决定已发布，不能再修改");
  refreshBatchItem(next, item);
  const choiceOf = (index: number): "source" | "keep" | "pending" => {
    if (Array.isArray(resolutions)) {
      const found = resolutions[index];
      return found?.resolution ?? item.segments[index].resolution;
    }
    return resolutions[index] ?? item.segments[index].resolution;
  };
  const decisions: RebakeDecision[] = [];
  item.segments.forEach((segment, index) => {
    segment.resolution = choiceOf(index);
    if (segment.resolution !== "pending") {
      decisions.push({
        segment: { start: segment.start, end: segment.end, bones: segment.bones },
        resolution: segment.resolution,
      });
    }
  });
  item.status = decisions.length > 0 && decisions.length === item.segments.length ? "decided" : "open";
  if (decisions.length > 0) {
    const action = next.actions?.find((entry) => entry.id === actionId);
    const variant = action?.variants?.find((entry) => entry.id === item.variant_id);
    if (!action || !variant) throw new Error("找不到该动作的批次草稿，无法记录决定");
    variant.keyframes = structuredClone(action.keyframes);
    variant.revision = 1;
    action.decision_log = (action.decision_log ?? [])
      .filter((entry) => !(entry.batch_id === batchId && entry.variant_id === item.variant_id));
    let applied = applyRebake(next, actionId, decisions, item.variant_id, batchId);
    next.actions = applied.actions;
  }
  refreshBatch(next, batch);
  return next;
}

export function submitReviewBatch(project: Project, batchId: string): Project {
  const next = cloneProject(project);
  const batch = next.review_batches?.find((item) => item.id === batchId);
  if (!batch) throw new Error(`找不到审阅批次 ${batchId}`);
  refreshBatch(next, batch);
  const decidedItems = batch.items.filter((item) => item.status !== "published"
    && item.segments.length > 0
    && item.segments.every((segment) => segment.resolution !== "pending"));
  if (decidedItems.length === 0) {
    throw new Error("本批还没有逐项明确决定的动作；未决定项会保存，稍后可继续");
  }
  decidedItems.forEach((item) => {
    let applied = publishVariant(next, item.action_id, item.variant_id);
    next.actions = applied.actions;
    item.status = "published";
    item.published_at = new Date().toISOString();
  });
  refreshBatch(next, batch);
  return next;
}

export function cancelReviewItem(project: Project, batchId: string, actionId: string): Project {
  const next = cloneProject(project);
  const batch = next.review_batches?.find((item) => item.id === batchId);
  if (!batch) throw new Error(`找不到审阅批次 ${batchId}`);
  const item = batch.items.find((entry) => entry.action_id === actionId);
  if (!item) throw new Error(`动作 ${actionId} 不在审阅批次中`);
  if (item.status === "published") throw new Error("已发布的批次结果不能在此取消，请在动作内通过撤回决定处理");
  const action = next.actions?.find((entry) => entry.id === actionId);
  if (action) {
    const draft = action.variants?.find((variant) => variant.id === item.variant_id);
    if (draft) {
      draft.keyframes = structuredClone(action.keyframes);
      draft.revision = 1;
    }
    action.decision_log = (action.decision_log ?? [])
      .filter((entry) => !(entry.batch_id === batchId && entry.variant_id === item.variant_id));
  }
  item.segments.forEach((segment) => { segment.resolution = "pending"; });
  item.status = "open";
  refreshBatch(next, batch);
  return next;
}

export type JointSelection = { action_id: string; index: number };
export type JointCandidateReport = {
  ok: boolean;
  errors: string[];
  ranges: {
    action_id: string;
    action_name: string;
    index: number;
    source_start: number;
    source_end: number;
    local_start: number;
    local_end: number;
    bones: string[];
    resolution: "source" | "keep";
    source_basis_version: number;
  }[];
  shared_bones: string[];
  dependency_closed: boolean;
};

const getJointEntries = (project: Project, batch: ReviewBatch, selections: JointSelection[]) => {
  const entries: {
    action: Action;
    item: ReviewItem;
    variant: ActionVariant;
    segment: ReviewSegment;
    index: number;
  }[] = [];
  const seen = new Set<string>();
  selections.forEach((selection) => {
    const key = selection.action_id + ":" + selection.index;
    if (seen.has(key)) return;
    const item = batch.items.find((entry) => entry.action_id === selection.action_id);
    const action = project.actions?.find((entry) => entry.id === selection.action_id);
    if (!item || !action || selection.index < 0 || selection.index >= item.segments.length) {
      throw new Error("联合候选包含无效区间：" + selection.action_id + "#" + selection.index);
    }
    const segment = item.segments[selection.index];
    if (segment.resolution === "pending") {
      throw new Error(action.name + " 的 " + segment.start + "~" + segment.end + "s 仍待定，不能进入联合候选");
    }
    const variant = action.variants?.find((entry) => entry.id === item.variant_id);
    if (!variant) throw new Error("找不到动作 " + selection.action_id + " 的批次草稿");
    entries.push({ action, item, variant, segment, index: selection.index });
    seen.add(key);
  });
  if (entries.length === 0) throw new Error("请先勾选要组成联合候选的时间区间");
  return entries;
};

const jointSourceWindow = (entry: ReturnType<typeof getJointEntries>[number]) => ({
  start: entry.action.source.range_start + entry.segment.start,
  end: entry.action.source.range_start + entry.segment.end,
  bones: [...entry.segment.bones],
});

const jointBasisVersion = (entry: ReturnType<typeof getJointEntries>[number]) => {
  const decision = [...(entry.action.decision_log ?? [])].reverse().find((item) =>
    item.variant_id === entry.item.variant_id
    && (item.status ?? "active") === "active"
    && segmentsIntersect(entry.segment, item.segment));
  return decision?.source_version ?? entry.action.source.source_version;
};

export function jointCandidateReport(project: Project, batchId: string, selections: JointSelection[]): JointCandidateReport {
  const batch = reviewBatchSummary(project, batchId);
  const entries = getJointEntries(project, batch, selections);
  const windows = entries.map(jointSourceWindow);
  const errors: string[] = [];
  if (new Set(entries.map(jointBasisVersion)).size > 1) {
    errors.push("联合候选中的决定依据了不同源修订，请先统一到同一源修订或保持旧修订范围待定");
  }
  const selectedKeys = new Set(entries.map((entry) => entry.item.action_id + ":" + entry.index));

  batch.items.forEach((item) => {
    const action = project.actions?.find((entry) => entry.id === item.action_id);
    if (!action) return;
    item.segments.forEach((segment, index) => {
      const candidate = {
        start: action.source.range_start + segment.start,
        end: action.source.range_start + segment.end,
        bones: segment.bones,
      };
      entries.forEach((entry, entryIndex) => {
        if (entry.item.action_id === item.action_id && index === entry.index) return;
        if (segmentsIntersect(candidate, windows[entryIndex])
            && !selectedKeys.has(item.action_id + ":" + index)) {
          errors.push("依赖未闭合：" + action.name + " " + segment.start + "~" + segment.end + "s 与已选区间在共享骨骼上相交");
        }
      });
    });
  });

  const rootId = project.skeleton.bones.find((bone) => bone.parent === null)?.id ?? "root";
  const poseAt = (entry: ReturnType<typeof getJointEntries>[number], sourceTime: number) => {
    const localTime = Math.min(
      Math.max(sourceTime - entry.action.source.range_start, 0),
      entry.action.duration,
    );
    return sampleFrames(entry.variant.keyframes, localTime);
  };
  entries.forEach((first, index) => {
    for (let otherIndex = index + 1; otherIndex < entries.length; otherIndex += 1) {
      const second = entries[otherIndex];
      const firstWindow = windows[index];
      const secondWindow = windows[otherIndex];
      const sharedBones = firstWindow.bones.filter((boneId) => secondWindow.bones.includes(boneId)).sort();
      const overlapStart = Math.max(firstWindow.start, secondWindow.start);
      const overlapEnd = Math.min(firstWindow.end, secondWindow.end);
      if (sharedBones.length === 0) continue;
      const touching = Math.abs(firstWindow.end - secondWindow.start) <= 1e-7
        || Math.abs(secondWindow.end - firstWindow.start) <= 1e-7;
      if (touching) {
        const seamTime = Math.abs(firstWindow.end - secondWindow.start) <= 1e-7
          ? secondWindow.start
          : firstWindow.start;
        const firstPose = poseAt(first, seamTime);
        const secondPose = poseAt(second, seamTime);
        sharedBones.forEach((boneId) => {
          if (firstPose[boneId] && secondPose[boneId] && transformDiffers(firstPose[boneId], secondPose[boneId], 1e-6)) {
            errors.push("跨区间接缝 " + seamTime + "s 的共享骨骼 " + boneId + " 姿态不连续");
          }
        });
        const beforePose = poseAt(first, seamTime - 1 / first.action.source.fps);
        const afterPose = poseAt(second, seamTime + 1 / second.action.source.fps);
        if (firstPose[rootId] && secondPose[rootId] && beforePose[rootId] && afterPose[rootId]) {
          const beforeDelta = Math.hypot(
            firstPose[rootId].x - beforePose[rootId].x,
            firstPose[rootId].y - beforePose[rootId].y,
          );
          const afterDelta = Math.hypot(
            afterPose[rootId].x - secondPose[rootId].x,
            afterPose[rootId].y - secondPose[rootId].y,
          );
          if (Math.abs(beforeDelta - afterDelta) > 1e-5) errors.push("跨区间接缝 " + seamTime + "s 的根运动速度不连续");
          if (Math.abs(firstPose[rootId].x - secondPose[rootId].x) > 1e-6
              || Math.abs(firstPose[rootId].y - secondPose[rootId].y) > 1e-6) {
            errors.push("跨区间接缝 " + seamTime + "s 的根位移不连续");
          }
        }
      } else if (overlapStart <= overlapEnd + 1e-9) {
        const poseConflicts: string[] = [];
        const rootConflicts: string[] = [];
        [overlapStart, overlapEnd, (overlapStart + overlapEnd) / 2].forEach((sampleTime) => {
          const firstPose = poseAt(first, sampleTime);
          const secondPose = poseAt(second, sampleTime);
          sharedBones.forEach((boneId) => {
            if (firstPose[boneId] && secondPose[boneId] && transformDiffers(firstPose[boneId], secondPose[boneId], 1e-6)) {
              poseConflicts.push(boneId + "@" + sampleTime.toFixed(3) + "s");
            }
          });
          if (firstPose[rootId] && secondPose[rootId] && (
            Math.abs(firstPose[rootId].x - secondPose[rootId].x) > 1e-6
            || Math.abs(firstPose[rootId].y - secondPose[rootId].y) > 1e-6
          )) {
            rootConflicts.push("根位移@" + sampleTime.toFixed(3) + "s");
          }
        });
        if (poseConflicts.length) errors.push("重叠区间共享骨骼姿态冲突，必须明确只选其一或保持待定：" + [...new Set(poseConflicts)].slice(0, 8).join("、"));
        if (rootConflicts.length) errors.push("重叠区间根运动约束不一致：" + [...new Set(rootConflicts)].slice(0, 8).join("、"));
      }
    }
  });

  const ranges = entries.map((entry, index) => ({
    action_id: entry.item.action_id,
    action_name: entry.action.name,
    index: entry.index,
    source_start: windows[index].start,
    source_end: windows[index].end,
    local_start: entry.segment.start,
    local_end: entry.segment.end,
    bones: entry.segment.bones,
    resolution: entry.segment.resolution as "source" | "keep",
    source_basis_version: jointBasisVersion(entry),
  })).sort((a, b) => a.source_start - b.source_start || a.source_end - b.source_end || a.action_id.localeCompare(b.action_id));
  return {
    ok: errors.length === 0,
    errors,
    ranges,
    shared_bones: [...new Set(windows.flatMap((window) => window.bones))].sort(),
    dependency_closed: errors.length === 0,
  };
}

export function publishJointCandidate(project: Project, batchId: string, selections: JointSelection[]): {
  project: Project;
  batch: ReviewBatch;
  report: JointCandidateReport;
} {
  const report = jointCandidateReport(project, batchId, selections);
  if (!report.ok) throw new Error(report.errors.join("；"));
  let next = cloneProject(project);
  const groups = new Map<string, number[]>();
  selections.forEach((selection) => {
    const indexes = groups.get(selection.action_id) ?? [];
    indexes.push(selection.index);
    groups.set(selection.action_id, indexes);
  });
  groups.forEach((indexes, actionId) => {
    const currentBatch = reviewBatchSummary(next, batchId);
    const item = currentBatch.items.find((entry) => entry.action_id === actionId);
    if (!item) return;
    const decisions = indexes.map((index) => {
      const segment = item.segments[index];
      return {
        segment: { start: segment.start, end: segment.end, bones: segment.bones },
        resolution: segment.resolution as "source" | "keep",
      };
    });
    next = applyRebake(next, actionId, decisions, null, batchId);
  });
  const storedBatch = next.review_batches?.find((batch) => batch.id === batchId);
  const refreshed = reviewBatchSummary(next, batchId);
  if (storedBatch) {
    refreshed.items.forEach((freshItem) => {
      const storedItem = storedBatch.items.find((item) => item.action_id === freshItem.action_id);
      freshItem.segments.forEach((segment, index) => {
        const selected = groups.get(freshItem.action_id)?.includes(index);
        if (selected || storedItem?.segments[index]?.joint_published) {
          segment.joint_published = true;
          segment.resolved = true;
        }
      });
    });
    storedBatch.items = refreshed.items;
    storedBatch.status = refreshed.status;
  }
  return { project: next, batch: reviewBatchSummary(next, batchId), report };
}

const poseDelta = (a: Record<string, Transform>, b: Record<string, Transform>, bones: string[]) =>
  Math.max(...bones.map((boneId) => {
    const first = a[boneId];
    const second = b[boneId];
    if (!first || !second) return 0;
    return Math.max(
      Math.abs(first.x - second.x),
      Math.abs(first.y - second.y),
      Math.abs(shortestAngleDelta(first.rotation, second.rotation)),
    );
  }), 0);

/** Check pose continuity inside, outside and across the edges of update windows. */
export function continuityReport(
  keyframes: Keyframe[],
  duration: number,
  windows: { start: number; end: number }[],
  fps: number,
  bones: string[],
): ContinuityReport {
  const count = Math.round(duration * fps) + 1;
  const poses = Array.from({ length: count }, (_, index) => sampleFrames(keyframes, Math.min(index / fps, duration)));
  const inWindow = (time: number) => windows.some((window) => time >= window.start - 1e-9 && time <= window.end + 1e-9);
  const report: ContinuityReport = { maxInsideDelta: 0, maxBoundaryDelta: 0, maxOutsideDelta: 0, boundaries: [] };
  for (let index = 1; index < count; index += 1) {
    const time = Math.min(index / fps, duration);
    const delta = poseDelta(poses[index - 1], poses[index], bones);
    const wasInside = inWindow(Math.min((index - 1) / fps, duration));
    const isInside = inWindow(time);
    if (wasInside && isInside) report.maxInsideDelta = Math.max(report.maxInsideDelta, delta);
    else if (!wasInside && !isInside) report.maxOutsideDelta = Math.max(report.maxOutsideDelta, delta);
    else {
      report.maxBoundaryDelta = Math.max(report.maxBoundaryDelta, delta);
      report.boundaries.push({ time, delta });
    }
  }
  return report;
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
