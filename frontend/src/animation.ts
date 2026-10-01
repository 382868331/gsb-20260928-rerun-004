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
  origin?: KeyframeOrigin;
  baked_version?: number;
  manual_bones?: string[];
  repairs?: unknown[];
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
  baked_version?: number;
  created_at: string;
  archive_of?: string;
  archived_for_version?: number;
  last_rework_at?: string;
};
export type RepairRecord = {
  id: string;
  seq: number;
  source_version: number;
  updated_frames: string[];
  kept_manual_frames: string[];
  segments: string[];
  frame_snapshots: Record<string, {
    pose: Record<string, Transform>;
    baked_version?: number;
    manual_bones: string[];
    origin: KeyframeOrigin;
    repairs: unknown[];
  }>;
  snapshot_id?: string | null;
  at: string;
};
export type KeyframeOrigin = "baked" | "manual";
export type Action = {
  id: string;
  name: string;
  duration: number;
  keyframes: Keyframe[];
  layers?: Layer[];
  source: BakedSource;
  readonly?: boolean;
  rework_history?: RepairRecord[];
};
export type ReworkFrame = {
  id: string;
  time: number;
  source_time: number;
  changed_bones: string[];
  manual_bones: string[];
  has_manual: boolean;
};
export type ReworkSegment = {
  id: string;
  start: number;
  end: number;
  frame_ids: string[];
  bones: string[];
  manual_frame_ids: string[];
  has_manual: boolean;
};
export type ReworkAnalysis = {
  action_id: string;
  source_version: number;
  baked_version: number;
  outdated: boolean;
  affected_frames: ReworkFrame[];
  segments: ReworkSegment[];
};
export type ReworkResult = {
  project: Project;
  action: Action;
  analysis: ReworkAnalysis;
  updated_frames: string[];
  kept_manual_frames: string[];
  archived_action_id: string | null;
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

export function validateClipContent(
  clip: { keyframes: Keyframe[]; layers?: Layer[] },
  duration: number,
  bones: Bone[],
  prefix = "",
  requiredBones?: Set<string>,
): string[] {
  const errors: string[] = [];
  const byId = new Map(bones.map((bone) => [bone.id, bone]));
  const times = new Set<number>();
  if (clip.keyframes.length === 0) errors.push(`${prefix}至少需要一个关键姿态`);
  clip.keyframes.forEach((frame) => {
    if (!Number.isFinite(frame.time) || frame.time < 0) errors.push(`${prefix}关键姿态 ${frame.id} 时间必须是非负数字`);
    if (frame.time > duration) errors.push(`${prefix}关键姿态 ${frame.id} 的时间 ${frame.time} 超出动作时长`);
    if (times.has(frame.time)) errors.push(`关键姿态时间不能重复：${frame.time}`);
    times.add(frame.time);
    const required = requiredBones ?? new Set(bones.map((bone) => bone.id));
    bones.forEach((bone) => {
      if (!required.has(bone.id)) return;
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
    errors.push(...validateClipContent(action, action.duration, bones, `${prefix}内`, new Set(source.bones)));
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

const transformsClose = (a: Transform, b: Transform, tolerance = 1e-7) =>
  Math.abs(a.x - b.x) <= tolerance
  && Math.abs(a.y - b.y) <= tolerance
  && Math.abs(shortestAngleDelta(a.rotation, b.rotation)) <= tolerance;

export function manualBones(frame: Keyframe): Set<string> {
  if (Array.isArray(frame.manual_bones)) return new Set(frame.manual_bones);
  if (frame.origin === "manual") return new Set(Object.keys(frame.pose));
  return new Set();
}

export function markFrameManual(frame: Keyframe, boneIds?: string[]): Keyframe {
  const manual = manualBones(frame);
  (boneIds ?? Object.keys(frame.pose)).forEach((boneId) => {
    if (boneId in frame.pose) manual.add(boneId);
  });
  if (manual.size > 0) {
    frame.origin = "manual";
    frame.manual_bones = [...manual].sort();
  }
  return frame;
}

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

  const selected = new Set(selectedBones);
  const coverageProblems: string[] = [];
  (project.layers ?? []).forEach((layer) => {
    const overlaps = Math.min(layer.end, rangeEnd) - Math.max(layer.start, rangeStart);
    if (overlaps <= 0) return;
    const covered = new Set(layer.bones.filter((boneId) => selected.has(boneId)));
    const uncovered = layer.bones.filter((boneId) => !selected.has(boneId));
    if (covered.size > 0 && uncovered.length > 0) {
      coverageProblems.push(`层「${layer.name}」在范围内只选择了部分作用骨骼，已覆盖 ${uncovered.join("、")}，未处理`);
    }
  });
  if (coverageProblems.length > 0) throw new Error(coverageProblems.join("；"));

  const span = rangeEnd - rangeStart;
  const count = Math.round(span * fps) + 1;
  const keyframes: Keyframe[] = [];
  let previous: Record<string, Transform> | null = null;
  const frameKeyframes: Keyframe[] = [];
  const sampleTimes: number[] = [];
  for (let index = 0; index < count; index += 1) {
    const sourceTime = Math.round((rangeStart + Math.min(index / fps, span)) * 1e9) / 1e9;
    sampleTimes.push(sourceTime);
    const pose = sampleLocal(project, sourceTime);
    const selectedPose = Object.fromEntries(selectedBones.map((boneId) => [boneId, {
      x: Math.round(pose[boneId].x * 1e9) / 1e9,
      y: Math.round(pose[boneId].y * 1e9) / 1e9,
      rotation: Math.round(pose[boneId].rotation * 1e9) / 1e9,
    }]));
    if (previous && poseClose(previous, selectedPose, 1e-7) && keyframes.length >= 2) {
      keyframes[keyframes.length - 1].time = Math.round((sourceTime - rangeStart) * 1e9) / 1e9;
    } else {
      keyframes.push({
        id: `baked-kf-${index}`,
        time: Math.round((sourceTime - rangeStart) * 1e9) / 1e9,
        pose: selectedPose,
        origin: "baked" as const,
        baked_version: project.version,
        manual_bones: [],
        repairs: [],
      });
    }
    previous = selectedPose;
    frameKeyframes.push(keyframes[keyframes.length - 1]);
  }
  keyframes[keyframes.length - 1].time = span;

  const existingIds = new Set((project.actions ?? []).map((item) => item.id));
  let idIndex = existingIds.size + 1;
  let id = `action-${idIndex}-${Math.round(rangeStart * 1000)}-${Math.round(rangeEnd * 1000)}`;
  while (existingIds.has(id)) {
    idIndex += 1;
    id = `action-${idIndex}-${Math.round(rangeStart * 1000)}-${Math.round(rangeEnd * 1000)}`;
  }
  const action: Action = {
    id,
    name: name || `整理动作 ${rangeStart}~${rangeEnd}s`,
    duration: span,
    keyframes,
    layers: [],
    source: {
      action_id: "__main__",
      source_version: project.version,
      range_start: rangeStart,
      range_end: rangeEnd,
      bones: selectedBones,
      fps,
      baked_version: project.version,
      created_at: new Date().toISOString(),
    },
  };
  for (let index = 0; index < count; index += 1) {
    const sourceTime = sampleTimes[index];
    const sourcePose = sampleLocal(project, sourceTime);
    const bakedPose = frameKeyframes[index].pose;
    selectedBones.forEach((boneId) => {
      if (!transformsClose(bakedPose[boneId], sourcePose[boneId], 1e-9)) {
        throw new Error(`整理结果在 ${sourceTime}s 的骨骼 ${boneId} 与原工程姿态不一致，已放弃整理`);
      }
    });
  }
  return { action, warnings: [] };
}

export function migrateProject(project: Project): Project {
  const next = structuredClone(project);
  if (!Number.isInteger(next.version)) next.version = 1;
  if (!next.actions) next.actions = [];
  (next.layers ?? []).forEach((layer) => { if (!layer.weight_keys) layer.weight_keys = []; });
  next.actions.forEach((action) => {
    if (!action.source.baked_version) action.source.baked_version = action.source.source_version;
    if (!action.rework_history) action.rework_history = [];
    action.keyframes.forEach((frame) => {
      if (!frame.origin) frame.origin = "baked";
      if (frame.baked_version === undefined) frame.baked_version = action.source.baked_version;
      if (!frame.manual_bones) frame.manual_bones = [];
      if (!frame.repairs) frame.repairs = [];
    });
  });
  return next;
}

const actionById = (project: Project, actionId: string): Action => {
  const action = project.actions?.find((item) => item.id === actionId);
  if (!action) throw new Error(`找不到整理动作 ${actionId}`);
  return action;
};

function segmentKeyframes(action: Action, gap: number): Keyframe[][] {
  const segments: Keyframe[][] = [];
  [...action.keyframes].sort((a, b) => a.time - b.time).forEach((frame) => {
    const last = segments.at(-1);
    if (last && frame.time - last[last.length - 1].time <= gap + 1e-7) last.push(frame);
    else segments.push([frame]);
  });
  return segments;
}

export function reworkAnalysis(project: Project, actionId: string, tolerance = 1e-6): ReworkAnalysis {
  const action = actionById(project, actionId);
  const source = action.source;
  const sourceVersion = project.version;
  const bakedVersion = source.baked_version ?? source.source_version;
  const fps = source.fps;
  const gap = 2.5 / Math.max(fps, 1e-6);
  const boneScope = new Set(source.bones);
  const affectedFrames: ReworkFrame[] = [];
  action.keyframes.forEach((frame) => {
    const sourceTime = source.range_start + frame.time;
    const sourcePose = sampleLocal(project, sourceTime);
    const changedBones: string[] = [];
    boneScope.forEach((boneId) => {
      const current = frame.pose[boneId];
      const expected = sourcePose[boneId];
      if (current && expected && !transformsClose(current, expected, tolerance)) changedBones.push(boneId);
    });
    if (changedBones.length > 0) {
      affectedFrames.push({
        id: frame.id,
        time: Math.round(frame.time * 1e9) / 1e9,
        source_time: Math.round(sourceTime * 1e9) / 1e9,
        changed_bones: changedBones.sort(),
        manual_bones: [...manualBones(frame)].sort(),
        has_manual: manualBones(frame).size > 0,
      });
    }
  });
  const affectedIds = new Set(affectedFrames.map((frame) => frame.id));
  const affectedById = new Map(affectedFrames.map((frame) => [frame.id, frame]));
  const segments: ReworkSegment[] = [];
  segmentKeyframes(action, gap).forEach((group) => {
    const hit = group.filter((frame) => affectedIds.has(frame.id));
    if (hit.length === 0) return;
    const manualFrames = hit.filter((frame) => manualBones(frame).size > 0);
    segments.push({
      id: `seg-${segments.length + 1}`,
      start: Math.round(group[0].time * 1e9) / 1e9,
      end: Math.round(group.at(-1)!.time * 1e9) / 1e9,
      frame_ids: hit.map((frame) => frame.id),
      bones: [...new Set(hit.flatMap((frame) => affectedById.get(frame.id)!.changed_bones))].sort(),
      manual_frame_ids: manualFrames.map((frame) => frame.id),
      has_manual: manualFrames.length > 0,
    });
  });
  return {
    action_id: actionId,
    source_version: sourceVersion,
    baked_version: bakedVersion,
    outdated: sourceVersion !== bakedVersion,
    affected_frames: affectedFrames,
    segments,
  };
}

function verifyReworkSeams(action: Action, updatedFrames: Set<string>): void {
  const ordered = [...action.keyframes].sort((a, b) => a.time - b.time);
  const gap = 2.5 / Math.max(action.source.fps, 1e-6);
  for (let i = 0; i < ordered.length - 1; i += 1) {
    const left = ordered[i];
    const right = ordered[i + 1];
    const span = right.time - left.time;
    if (span <= 0) throw new Error("返修结果出现重复时间关键帧，已放弃");
    if (span > gap + 1e-7 || !updatedFrames.has(left.id) || !updatedFrames.has(right.id)) continue;
    Object.entries(left.pose).forEach(([boneId, leftTransform]) => {
      const rightTransform = right.pose[boneId];
      if (!rightTransform) return;
      const step = Math.abs(shortestAngleDelta(leftTransform.rotation, rightTransform.rotation));
      if (step > 30 + 1e-9) {
        throw new Error(`返修区间衔接处在 ${left.time.toFixed(3)}s 的骨骼 ${boneId} 姿态不连续（单帧旋转 ${step.toFixed(1)}°），已放弃`);
      }
    });
  }
}

export function applyRework(
  project: Project,
  actionId: string,
  segmentIds?: string[],
  decisions?: Record<string, "keep" | "source">,
  tolerance = 1e-6,
): ReworkResult {
  const next = cloneProject(project);
  const analysis = reworkAnalysis(next, actionId, tolerance);
  const action = actionById(next, actionId);
  const validationErrors = validateProject(next);
  if (validationErrors.length) throw new Error(validationErrors.map((e) => `工程存在未解决冲突：${e}`).join("；"));
  const chosen = new Set(segmentIds ?? analysis.segments.map((segment) => segment.id));
  const frameById = new Map(action.keyframes.map((frame) => [frame.id, frame]));
  const snapshot = structuredClone(action);
  const sourceVersion = next.version;
  const updatedFrames: string[] = [];
  const keptManualFrames: string[] = [];
  const frameSnapshots: RepairRecord["frame_snapshots"] = {};
  const repairSeq = (action.rework_history ?? []).length + 1;
  const repairId = `repair-${repairSeq}-v${sourceVersion}-${Date.now()}`;

  analysis.segments.forEach((segment) => {
    if (!chosen.has(segment.id)) return;
    segment.frame_ids.forEach((frameId) => {
      const frame = frameById.get(frameId);
      if (!frame) return;
      const decision = decisions?.[frameId]
        ?? (segment.manual_frame_ids.includes(frameId) ? "keep" : "source");
      if (decision === "keep") {
        if (manualBones(frame).size > 0) keptManualFrames.push(frameId);
        return;
      }
      const sourcePose = sampleLocal(next, action.source.range_start + frame.time);
      frameSnapshots[frameId] = {
        pose: structuredClone(frame.pose),
        baked_version: frame.baked_version,
        manual_bones: structuredClone(frame.manual_bones ?? []),
        origin: frame.origin ?? "baked",
        repairs: structuredClone(frame.repairs ?? []),
      };
      segment.bones.forEach((boneId) => {
        if (sourcePose[boneId] && frame.pose[boneId]) frame.pose[boneId] = { ...sourcePose[boneId] };
      });
      const remainingManual = [...manualBones(frame)].filter((boneId) => !segment.bones.includes(boneId));
      frame.manual_bones = remainingManual.sort();
      frame.origin = remainingManual.length > 0 ? "manual" : "baked";
      frame.baked_version = sourceVersion;
      frame.repairs = [...(frame.repairs ?? []), {
        id: repairId, segment: segment.id, source_version: sourceVersion,
        decided: "source", bones: segment.bones, at: new Date().toISOString(),
      }];
      updatedFrames.push(frameId);
    });
  });

  if (updatedFrames.length === 0 && keptManualFrames.length === 0) {
    throw new Error("没有选择需要返修的区间，工程未改动");
  }
  verifyReworkSeams(action, new Set(updatedFrames));

  let archivedActionId: string | null = null;
  const previousVersion = action.source.baked_version ?? action.source.source_version;
  const alreadyArchived = new Set(
    (next.actions ?? []).map((item) => item.source.archive_of).filter(Boolean),
  );
  if (previousVersion !== sourceVersion && !alreadyArchived.has(actionId)) {
    const archive = structuredClone(snapshot);
    archive.id = `${actionId}-v${previousVersion}`;
    archive.name = `${snapshot.name}（v${previousVersion} 旧版）`;
    archive.readonly = true;
    archive.source = { ...archive.source, archive_of: actionId, archived_for_version: sourceVersion, baked_version: previousVersion };
    next.actions = [...(next.actions ?? []), archive];
    archivedActionId = archive.id;
  }
  action.source.baked_version = sourceVersion;
  action.source.last_rework_at = new Date().toISOString();
  action.rework_history = [...(action.rework_history ?? []), {
    id: repairId,
    seq: repairSeq,
    source_version: sourceVersion,
    updated_frames: updatedFrames,
    kept_manual_frames: keptManualFrames,
    segments: [...chosen].sort(),
    frame_snapshots: frameSnapshots,
    snapshot_id: archivedActionId,
    at: new Date().toISOString(),
  }];
  const verification = validateProject(next);
  if (verification.length) throw new Error(verification.map((e) => `返修后校验失败，已保留分层工程：${e}`).join("；"));
  return { project: next, action, analysis, updated_frames: updatedFrames, kept_manual_frames: keptManualFrames, archived_action_id: archivedActionId };
}

export function revertRework(project: Project, actionId: string, repairId: string): Project {
  const next = cloneProject(project);
  const action = actionById(next, actionId);
  const entries = (action.rework_history ?? []).filter((entry) => entry.id === repairId);
  if (entries.length === 0) throw new Error("找不到可撤回的返修记录");
  entries.forEach((entry) => {
    const laterFrameIds = new Set(
      (action.rework_history ?? [])
        .filter((later) => later.seq > entry.seq)
        .flatMap((later) => [...later.updated_frames, ...later.kept_manual_frames]),
    );
    Object.entries(entry.frame_snapshots).forEach(([frameId, oldData]) => {
      if (laterFrameIds.has(frameId)) return;
      const current = action.keyframes.find((frame) => frame.id === frameId);
      if (!current) return;
      current.pose = structuredClone(oldData.pose);
      current.baked_version = oldData.baked_version;
      current.manual_bones = structuredClone(oldData.manual_bones);
      current.origin = oldData.origin;
      current.repairs = (current.repairs ?? []).filter((item) => (item as { id?: string }).id !== repairId);
    });
  });
  action.rework_history = (action.rework_history ?? []).filter((entry) => entry.id !== repairId);
  const errors = validateProject(next);
  if (errors.length) throw new Error("撤回后校验失败：" + errors.join("；"));
  return next;
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
  if (frame) frame.time = Math.min(Math.max(time, 0), next.duration);
  return next;
}

export function duplicateKeyframe(project: Project, keyframeId: string): Project {
  const next = cloneProject(project);
  const source = next.keyframes.find((item) => item.id === keyframeId);
  if (!source) return next;
  const offset = Math.min(0.1, Math.max(0.01, next.duration / 20));
  const time = source.time + offset >= next.duration ? source.time - offset : source.time + offset;
  next.keyframes.push({ ...structuredClone(source), id: `${source.id}-copy-${Date.now()}`, time });
  return next;
}

export function updatePose(project: Project, frameId: string, boneId: string, patch: Partial<Transform>): Project {
  const next = cloneProject(project);
  const frame = next.keyframes.find((item) => item.id === frameId);
  if (frame) Object.assign(frame.pose[boneId], patch);
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
