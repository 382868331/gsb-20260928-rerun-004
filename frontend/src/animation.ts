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
export type ReviewChoice = "pending" | "keep" | "source";
export type ReviewBatchItem = {
  action_id: string;
  variant_id: string | null;
  choice: ReviewChoice;
  confirmed_source_version: number;
  status: "pending" | "applied" | "published";
  pre_keyframes?: Keyframe[] | null;
  pre_revision?: number | null;
};
export type ReviewBatch = {
  id: string;
  name: string;
  source_version: number;
  status: "open" | "closed" | "cancelled";
  created_at?: string;
  closed_at?: string;
  items: ReviewBatchItem[];
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
  const actionsById = new Map<string, Action>();
  (project.actions ?? []).forEach((action, actionIndex) => {
    const prefix = `第 ${actionIndex + 1} 个整理动作`;
    if (actionIds.has(action.id)) errors.push(`${prefix}id 重复：${action.id}`);
    actionIds.add(action.id);
    actionsById.set(action.id, action);
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
      if (entry.batch_id !== undefined && entry.batch_id !== null && typeof entry.batch_id !== "string") {
        errors.push(entryPrefix + "的批次 id 必须是字符串");
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
    const prefix = "第 " + (batchIndex + 1) + " 个审阅批次";
    if (!batch.id) errors.push(prefix + "缺少有效 id");
    else if (batchIds.has(batch.id)) errors.push(prefix + "id 重复：" + batch.id);
    else batchIds.add(batch.id);
    if (!batch.name) errors.push(prefix + "缺少名称");
    if (!["open", "closed", "cancelled"].includes(batch.status)) {
      errors.push(prefix + "的状态必须是 open、closed 或 cancelled");
    }
    if (!Number.isInteger(batch.source_version) || batch.source_version < 1) {
      errors.push(prefix + "缺少所审阅的源版本号");
    }
    if (!Array.isArray(batch.items) || batch.items.length === 0) {
      errors.push(prefix + "至少需要一个审阅项");
      return;
    }
    const seenItems = new Set<string>();
    batch.items.forEach((item, itemIndex) => {
      const itemPrefix = prefix + "第 " + (itemIndex + 1) + " 个审阅项";
      const action = actionsById.get(item.action_id);
      if (!action) {
        errors.push(itemPrefix + "引用了未知整理动作 " + item.action_id);
        return;
      }
      if (item.variant_id !== null && !(action.variants ?? []).some((variant) => variant.id === item.variant_id)) {
        errors.push(itemPrefix + "引用了未知方案 " + item.variant_id);
      }
      const itemKey = item.action_id + "|" + (item.variant_id ?? "");
      if (seenItems.has(itemKey)) errors.push(itemPrefix + "重复");
      seenItems.add(itemKey);
      if (!["pending", "keep", "source"].includes(item.choice)) {
        errors.push(itemPrefix + "的选择必须是 pending、keep 或 source");
      }
      if (!["pending", "applied", "published"].includes(item.status)) {
        errors.push(itemPrefix + "的状态必须是 pending、applied 或 published");
      }
      if (!Number.isInteger(item.confirmed_source_version) || item.confirmed_source_version < 1) {
        errors.push(itemPrefix + "缺少确认依据的源版本号");
      }
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
  if (!next.review_batches) next.review_batches = [];
  (next.layers ?? []).forEach((layer) => { if (!layer.weight_keys) layer.weight_keys = []; });
  next.actions.forEach((action) => {
    if (!Number.isInteger(action.revision)) action.revision = 1;
    if (!action.previous_versions) action.previous_versions = [];
    if (!action.decision_log) action.decision_log = [];
    if (!action.variants) action.variants = [];
  });
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

export function analyzeRebake(project: Project, action: Action): RebakeSegment[] {
  const { fps, range_start: rangeStart, bones } = action.source;
  const span = action.duration;
  const count = Math.round(span * fps) + 1;
  const keyframeByIndex = new Map(action.keyframes.map((frame) => [Math.round(frame.time * fps), frame]));
  const cells: { index: number; time: number; bones: string[]; manual: boolean }[] = [];
  for (let index = 0; index < count; index += 1) {
    const localTime = Math.min(index / fps, span);
    const sourcePose = sampleLocal(project, rangeStart + localTime);
    const bakedPose = sampleFrames(action.keyframes, localTime);
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
  const activeDecisions = (action.decision_log ?? []).filter((entry) => (entry.status ?? "active") === "active");
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

export function createReviewBatch(project: Project, entries: { action_id: string; variant_id?: string | null }[], name = ""): Project {
  const batches = [...(project.review_batches ?? [])];
  const id = "batch-" + (batches.length + 1);
  if (batches.some((batch) => batch.id === id)) throw new Error("审阅批次 id 重复：" + id);
  const seen = new Set<string>();
  const items: ReviewBatchItem[] = entries.map((entry) => {
    const action = project.actions?.find((item) => item.id === entry.action_id);
    if (!action) throw new Error("找不到整理动作 " + entry.action_id);
    const variantId = entry.variant_id ?? null;
    const key = entry.action_id + "|" + (variantId ?? "");
    if (seen.has(key)) throw new Error("审阅项重复：" + key);
    seen.add(key);
    if (variantId !== null) {
      const variant = action.variants?.find((item) => item.id === variantId);
      if (!variant) throw new Error("找不到方案 " + variantId);
      if (variant.status !== "draft") throw new Error("方案「" + variant.name + "」已发布，不能加入审阅批次");
    }
    return {
      action_id: entry.action_id,
      variant_id: variantId,
      choice: "pending" as const,
      confirmed_source_version: project.version,
      status: "pending" as const,
      pre_keyframes: null,
      pre_revision: null,
    };
  });
  if (items.length === 0) throw new Error("审阅批次至少需要一个审阅项");
  batches.push({
    id,
    name: name || "审阅批次 " + batches.length,
    source_version: project.version,
    status: "open",
    created_at: new Date().toISOString(),
    items,
  });
  return { ...project, review_batches: batches };
}

const findReviewBatch = (project: Project, batchId: string) => {
  const batch = project.review_batches?.find((item) => item.id === batchId);
  if (!batch) throw new Error("找不到审阅批次 " + batchId);
  return batch;
};

export function setReviewChoice(project: Project, batchId: string, actionId: string, variantId: string | null, choice: ReviewChoice): Project {
  if (!["pending", "keep", "source"].includes(choice)) throw new Error("未知审阅选择 " + choice);
  const next = structuredClone(project);
  const batch = findReviewBatch(next, batchId);
  if (batch.status !== "open") throw new Error("批次已关闭或取消，不能再修改选择");
  const item = batch.items.find((entry) => entry.action_id === actionId && entry.variant_id === variantId);
  if (!item) throw new Error("批次 " + batchId + " 中没有 " + actionId + "/" + (variantId ?? "当前动作") + " 审阅项");
  if (item.status !== "pending") throw new Error("该审阅项已提交，不能再修改选择");
  item.choice = choice;
  item.confirmed_source_version = next.version;
  return next;
}

export type ReviewItemView = {
  action_id: string;
  variant_id: string | null;
  action_name: string;
  variant_name: string | null;
  choice: ReviewChoice;
  status: ReviewBatchItem["status"];
  published: boolean;
  needs_reconfirm: boolean;
  unhandled: RebakeSegment[];
  final_revision: number;
};

const reviewItemView = (project: Project, item: ReviewBatchItem): ReviewItemView => {
  const action = project.actions?.find((entry) => entry.id === item.action_id);
  if (!action) throw new Error("找不到整理动作 " + item.action_id);
  const variant = item.variant_id === null ? null : action.variants?.find((entry) => entry.id === item.variant_id) ?? null;
  if (item.variant_id !== null && !variant) throw new Error("找不到方案 " + item.variant_id);
  const target = variant ?? action;
  const unhandled = analyzeRebake(project, { ...action, keyframes: target.keyframes });
  const published = item.status === "published"
    || (variant !== null && variant.status === "published")
    || (variant === null && item.status === "applied");
  const currentRevision = target.revision ?? 1;
  return {
    action_id: item.action_id,
    variant_id: item.variant_id,
    action_name: action.name,
    variant_name: variant?.name ?? null,
    choice: item.choice,
    status: item.status,
    published,
    needs_reconfirm: !published && item.status === "pending" && item.confirmed_source_version !== project.version,
    unhandled,
    final_revision: item.choice !== "pending" && unhandled.length > 0 && !published ? currentRevision + 1 : currentRevision,
  };
};

export function reviewBatchSummary(project: Project, batchId: string) {
  const batch = findReviewBatch(project, batchId);
  return {
    id: batch.id,
    name: batch.name,
    status: batch.status,
    source_version: batch.source_version,
    items: batch.items.map((item) => reviewItemView(project, item)),
  };
}

export function submitReviewBatch(project: Project, batchId: string): Project {
  const batch = findReviewBatch(project, batchId);
  if (batch.status !== "open") throw new Error("批次已关闭或取消，不能再提交");
  const ready = batch.items.filter((item) => item.status === "pending" && item.choice !== "pending");
  if (ready.length === 0) throw new Error("没有可提交的决定：各项仍为待决定或已处理");
  const stale = ready.filter((item) => item.confirmed_source_version !== project.version);
  if (stale.length > 0) {
    throw new Error("源已再次修订，以下审阅项需重新确认：" + stale.map((item) => item.action_id + "/" + (item.variant_id ?? "当前动作")).join("、"));
  }
  let next = project;
  ready.forEach((item) => {
    const action = next.actions?.find((entry) => entry.id === item.action_id);
    if (!action) throw new Error("找不到整理动作 " + item.action_id);
    const variant = item.variant_id === null ? null : action.variants?.find((entry) => entry.id === item.variant_id) ?? null;
    const target = variant ?? action;
    if (!target) throw new Error("找不到方案 " + item.variant_id);
    const segments = analyzeRebake(next, { ...action, keyframes: target.keyframes });
    const preKeyframes = structuredClone(target.keyframes);
    const preRevision = target.revision ?? 1;
    if (segments.length > 0) {
      next = applyRebake(next, item.action_id, segments.map((segment) => ({
        segment: { start: segment.start, end: segment.end, bones: segment.bones },
        resolution: item.choice as "source" | "keep",
      })), item.variant_id, batchId);
    }
    next = {
      ...next,
      review_batches: (next.review_batches ?? []).map((entry) => entry.id === batchId
        ? {
            ...entry,
            items: entry.items.map((candidate) => candidate.action_id === item.action_id && candidate.variant_id === item.variant_id
              ? {
                  ...candidate,
                  status: (item.variant_id === null ? "published" : "applied") as ReviewBatchItem["status"],
                  pre_keyframes: segments.length > 0 ? preKeyframes : candidate.pre_keyframes ?? null,
                  pre_revision: segments.length > 0 ? preRevision : candidate.pre_revision ?? null,
                }
              : candidate),
          }
        : entry),
    };
  });
  next = {
    ...next,
    review_batches: (next.review_batches ?? []).map((entry) => entry.id === batchId
      ? {
          ...entry,
          status: entry.items.every((item) => item.status !== "pending") ? "closed" as const : entry.status,
         closed_at: entry.items.every((item) => item.status !== "pending") ? new Date().toISOString() : entry.closed_at,
       }
     : entry),
  };
  return next;
}

export function cancelReviewBatch(project: Project, batchId: string): Project {
  const batch = findReviewBatch(project, batchId);
  if (batch.status === "cancelled") throw new Error("批次已取消");
  const next = structuredClone(project);
  const nextBatch = findReviewBatch(next, batchId);
  nextBatch.items.forEach((item) => {
    const action = next.actions?.find((entry) => entry.id === item.action_id);
    if (!action) return;
    const variant = item.variant_id === null ? null : action.variants?.find((entry) => entry.id === item.variant_id) ?? null;
    const published = item.status === "published"
      || (variant !== null && variant.status === "published")
      || (item.variant_id === null && item.status === "applied");
    if (published) return;
    if (variant && item.pre_keyframes) {
      variant.keyframes = structuredClone(item.pre_keyframes);
      variant.revision = item.pre_revision ?? variant.revision;
    }
    action.decision_log = (action.decision_log ?? []).map((entry) =>
      entry.batch_id === batchId && (entry.variant_id ?? null) === item.variant_id && (entry.status ?? "active") === "active"
        ? { ...entry, status: "withdrawn" as const }
        : entry);
    item.status = "pending";
    item.choice = "pending";
    item.pre_keyframes = null;
    item.pre_revision = null;
  });
  nextBatch.status = "cancelled";
  nextBatch.closed_at = new Date().toISOString();
  return next;
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
