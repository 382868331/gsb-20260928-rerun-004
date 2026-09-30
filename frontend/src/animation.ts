export type Transform = { x: number; y: number; rotation: number };
export type Bone = {
  id: string;
  name: string;
  parent: string | null;
  rest: { x: number; y: number };
};
export type Keyframe = { id: string; time: number; pose: Record<string, Transform> };
export type Layer = {
  id: string;
  name: string;
  weight: number;
  start: number;
  end: number;
  fade_in: number;
  fade_out: number;
  bones: string[];
  keyframes: Keyframe[];
  weight_keyframes?: WeightKeyframe[];
};
export type WeightKeyframe = { time: number; weight: number; easing: "linear" | "smooth" };
export type BakedAction = {
  id: string;
  name: string;
  kind: "baked";
  start: number;
  end: number;
  bones: string[];
  fps: number;
  created_at: string;
  source_fingerprint: string;
  source_name: string;
  keyframes: Keyframe[];
};
export type Project = {
  name: string;
  duration: number;
  skeleton: { bones: Bone[] };
  keyframes: Keyframe[];
  layers?: Layer[];
  actions?: BakedAction[];
  active_action_id?: string | null;
};

export class ConsolidationError extends Error {
  errors: string[];
  constructor(errors: string[]) {
    super(errors.join("; "));
    this.errors = errors;
  }
}

export const shortestAngleDelta = (start: number, end: number) =>
  ((((end - start) % 360) + 540) % 360) - 180;

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

  if (project.keyframes.length === 0) errors.push("至少需要一个关键姿态");
  const times = new Set<number>();
  project.keyframes.forEach((frame) => {
    if (!Number.isFinite(frame.time) || frame.time < 0) errors.push(`关键姿态 ${frame.id} 时间必须是非负数字`);
    if (frame.time > project.duration) errors.push(`关键姿态 ${frame.id} 的时间 ${frame.time} 超出动画时长`);
    if (times.has(frame.time)) errors.push(`关键姿态时间不能重复：${frame.time}`);
    times.add(frame.time);
    bones.forEach((bone) => {
      const transform = frame.pose[bone.id];
      if (!transform) errors.push(`关键姿态 ${frame.id} 缺少骨骼 ${bone.id} 的姿态`);
      else if (![transform.x, transform.y, transform.rotation].every(Number.isFinite)) {
        errors.push(`关键姿态 ${frame.id} 中骨骼 ${bone.id} 的 x/y/rotation 必须是数字`);
      }
    });
    Object.keys(frame.pose).forEach((boneId) => {
      if (!byId.has(boneId)) errors.push(`关键姿态 ${frame.id} 包含未知骨骼 ${boneId}`);
    });
  });
  project.layers?.forEach((layer, layerIndex) => {
    const prefix = `第 ${layerIndex + 1} 个动作层`;
    ["weight", "start", "end", "fade_in", "fade_out"].forEach((field) => {
      const value = layer[field as keyof Pick<Layer, "weight" | "start" | "end" | "fade_in" | "fade_out">];
      if (!Number.isFinite(value) || value < 0) errors.push(`${prefix}的 ${field} 必须是非负数字`);
    });
    if (layer.weight > 1) errors.push(`${prefix}的权重不能超过 1`);
    if (layer.start > layer.end) errors.push(`${prefix}的开始时间不能晚于结束时间`);
    if (layer.start > project.duration || layer.end > project.duration) errors.push(`${prefix}的时间范围超出动画时长`);
    if (layer.fade_in + layer.fade_out > layer.end - layer.start) errors.push(`${prefix}的淡入淡出总时长不能超过作用时间范围`);
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
    const weightTimes = new Set<number>();
    (layer.weight_keyframes ?? []).forEach((point) => {
      if (!Number.isFinite(point.time) || point.time < 0) errors.push(`${prefix}权重过渡点时间必须是非负数字`);
      else if (point.time > project.duration) errors.push(`${prefix}权重过渡点时间超出动画时长`);
      else if (weightTimes.has(point.time)) errors.push(`${prefix}权重过渡时间不能重复`);
      else weightTimes.add(point.time);
      if (!Number.isFinite(point.weight) || point.weight < 0 || point.weight > 1) errors.push(`${prefix}权重过渡值必须在 0 到 1 之间`);
      if (point.easing !== "linear" && point.easing !== "smooth") errors.push(`${prefix}权重过渡缓动必须是 linear 或 smooth`);
    });
  });
  (project.actions ?? []).forEach((action, actionIndex) => {
    const prefix = `第 ${actionIndex + 1} 个整理动作`;
    if (!(action.start >= 0) || !(action.end >= action.start)) errors.push(`${prefix}时间范围无效`);
    if (!action.bones.length) errors.push(`${prefix}至少包含一根骨骼`);
    action.bones.forEach((boneId) => {
      if (!byId.has(boneId)) errors.push(`${prefix}引用了未知骨骼 ${boneId}`);
    });
    if (new Set(action.bones).size !== action.bones.length) errors.push(`${prefix}的骨骼不能重复`);
    if (!action.keyframes.length) errors.push(`${prefix}至少需要一个关键姿态`);
    const actionTimes = new Set<number>();
    action.keyframes.forEach((frame) => {
      if (!Number.isFinite(frame.time)) errors.push(`${prefix}关键姿态时间必须是数字`);
      else if (actionTimes.has(frame.time)) errors.push(`${prefix}关键姿态时间不能重复`);
      else actionTimes.add(frame.time);
      const allowed = new Set(action.bones);
      Object.entries(frame.pose).forEach(([boneId, transform]) => {
        if (!allowed.has(boneId)) errors.push(`${prefix}关键姿态包含非整理骨骼 ${boneId}`);
        else if (![transform.x, transform.y, transform.rotation].every(Number.isFinite)) {
          errors.push(`${prefix}中骨骼 ${boneId} 的 x/y/rotation 必须是数字`);
        }
      });
    });
  });
  if (project.active_action_id != null && !project.actions?.some((action) => action.id === project.active_action_id)) {
    errors.push("当前应用的整理动作不存在");
  }
  return errors;
}

export const orderedKeyframes = (project: Project) =>
  [...project.keyframes].sort((a, b) => a.time - b.time);

export function layerEnvelope(layer: Layer, time: number): number {
  const weight = layerWeightAt(layer, time);
  if (weight <= 0 || time < layer.start || time > layer.end) return 0;
  let ramp = 1;
  if (layer.fade_in > 0 && time < layer.start + layer.fade_in) ramp = (time - layer.start) / layer.fade_in;
  else if (layer.fade_out > 0 && time > layer.end - layer.fade_out) ramp = (layer.end - time) / layer.fade_out;
  return Math.max(0, Math.min(1, ramp)) * Math.min(weight, 1);
}

const smoothstep = (value: number) => {
  const clamped = Math.max(0, Math.min(1, value));
  return clamped * clamped * (3 - 2 * clamped);
};

export function layerWeightAt(layer: Layer, time: number): number {
  const points = [...(layer.weight_keyframes ?? [])].sort((a, b) => a.time - b.time);
  if (points.length === 0) return Math.max(0, Math.min(1, layer.weight));
  if (time <= points[0].time) return Math.max(0, Math.min(1, points[0].weight));
  if (time >= points[points.length - 1].time) return Math.max(0, Math.min(1, points[points.length - 1].weight));
  let left = points[0];
  let right = points[points.length - 1];
  for (let i = 0; i < points.length - 1; i += 1) {
    if (points[i].time <= time && time <= points[i + 1].time) {
      left = points[i];
      right = points[i + 1];
      break;
    }
  }
  const span = right.time - left.time;
  const alpha = span === 0 ? 0 : (time - left.time) / span;
  const ramp = left.easing === "linear" && right.easing === "linear" ? alpha : smoothstep(alpha);
  return Math.max(0, Math.min(1, left.weight + (right.weight - left.weight) * ramp));
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

export function resolveAction(project: Project, actionId?: string | null): BakedAction | null {
  const targetId = actionId === undefined ? project.active_action_id : actionId;
  if (typeof targetId !== "string") return null;
  return project.actions?.find((action) => action.id === targetId) ?? null;
}

export function sampleLocal(project: Project, time: number, actionId?: string | null): Record<string, Transform> {
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
  const action = resolveAction(project, actionId);
  if (action && t >= action.start && t <= action.end) {
    const baked = sampleFrames(action.keyframes, t);
    action.bones.forEach((boneId) => {
      if (baked[boneId]) result[boneId] = { ...baked[boneId] };
    });
  }
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

export function evaluateWorld(project: Project, time: number, actionId?: string | null): Record<string, WorldTransform> {
  const local = sampleLocal(project, time, actionId);
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

export function exportAction(project: Project, fps = 24, actionId?: string | null) {
  const count = Math.round(project.duration * fps) + 1;
  return {
    name: project.name,
    duration: project.duration,
    fps,
    frames: Array.from({ length: count }, (_, index) => {
      const time = Math.min(index / fps, project.duration);
      return { time, local: sampleLocal(project, time, actionId), world: evaluateWorld(project, time, actionId) };
    }),
  };
}

export const cloneProject = (project: Project): Project => structuredClone(project);

export function sourceFingerprint(project: Project): string {
  const canonicalNumber = (value: number): string => {
    if (Object.is(value, -0)) return "-0";
    if (value === 0) return "0";
    const exponent = Math.floor(Math.log10(Math.abs(value)));
    if (exponent < -4 || exponent >= 10) return value.toExponential(9).replace(/\.?0+e/, "e");
    return `${Number(value.toPrecision(10))}`;
  };
  const stableStringify = (value: unknown): string => {
    if (typeof value === "number") return canonicalNumber(value);
    if (typeof value === "boolean") return value ? "true" : "false";
    if (value === null) return "null";
    if (typeof value !== "object") return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined && item !== null)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(",")}}`;
  };
  const source = stableStringify({
    skeleton: project.skeleton,
    keyframes: project.keyframes,
    layers: project.layers ?? [],
  });
  let hash = 2166136261;
  new TextEncoder().encode(source).forEach((byte) => {
    hash = Math.imul((hash ^ byte) >>> 0, 16777619) >>> 0;
  });
  return hash.toString(16).padStart(8, "0");
}

export function actionIsCurrent(project: Project, action: BakedAction): boolean {
  return action.source_fingerprint === sourceFingerprint(project);
}

function layerPiecewiseTimes(layer: Layer, start: number, end: number, fps: number): number[] {
  const points = [start, end];
  points.push(Math.max(start, Math.min(end, Math.ceil(start * fps) / fps)));
  points.push(Math.max(start, Math.min(end, Math.floor(end * fps) / fps)));
  points.push(layer.fade_in > 0 ? layer.start + layer.fade_in : layer.start);
  points.push(layer.fade_out > 0 ? layer.end - layer.fade_out : layer.end);
  (layer.weight_keyframes ?? []).forEach((point) => points.push(point.time));
  layer.keyframes.forEach((frame) => points.push(frame.time));
  return points.filter((point) => point >= start - 1e-9 && point <= end + 1e-9);
}

export type ConsolidateOptions = {
  start: number;
  end: number;
  bones: string[];
  name?: string;
  fps?: number;
  actionId?: string;
};

export function consolidateLayers(
  project: Project,
  options: ConsolidateOptions,
): { project: Project; action: BakedAction; notices: string[] } {
  const errors = validateProject(project);
  const { start, end, bones } = options;
  const name = options.name ?? "整理动作";
  const fps = options.fps ?? 24;
  if (errors.length) throw new ConsolidationError(errors);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end > project.duration || start >= end) {
    throw new ConsolidationError([`整理时间范围必须落在 0 到 ${project.duration} 秒内，且开始早于结束`]);
  }
  if (!bones.length) throw new ConsolidationError(["至少选择一根需要整理的骨骼"]);
  if (new Set(bones).size !== bones.length) throw new ConsolidationError(["整理骨骼不能重复"]);
  const knownBones = new Set(project.skeleton.bones.map((bone) => bone.id));
  const missing = bones.filter((boneId) => !knownBones.has(boneId));
  if (missing.length) throw new ConsolidationError([`以下骨骼在当前骨架中缺失，未做整理：${missing.join(", ")}`]);

  const incompatibilities: string[] = [];
  (project.layers ?? []).forEach((layer) => {
    if (layer.end < start || layer.start > end) return;
    const layerBones = new Set(layer.bones);
    const overlapping = bones.filter((boneId) => layerBones.has(boneId));
    if (overlapping.length === 0) return;
    if (!layer.keyframes.length) incompatibilities.push(`动作层「${layer.name}」没有关键姿态，未参与整理`);
    layer.keyframes.forEach((frame) => {
      const absent = overlapping.filter((boneId) => !frame.pose[boneId]);
      if (absent.length) {
        incompatibilities.push(`动作层「${layer.name}」的关键姿态 ${frame.id} 缺少骨骼 ${absent.join(", ")}，未参与整理`);
      }
    });
  });
  if (incompatibilities.length) throw new ConsolidationError(incompatibilities);

  const breakpoints = new Set<number>();
  project.keyframes.forEach((frame) => {
    if (frame.time >= start - 1e-9 && frame.time <= end + 1e-9) breakpoints.add(frame.time);
  });
  (project.layers ?? []).forEach((layer) => {
    if (layer.end >= start && layer.start <= end) layerPiecewiseTimes(layer, start, end, fps).forEach((point) => breakpoints.add(point));
  });
  for (let index = Math.ceil(start * fps); index <= Math.floor(end * fps); index += 1) {
    const gridTime = index / fps;
    if (gridTime >= start && gridTime <= end) breakpoints.add(gridTime);
  }
  let orderedTimes = [...new Set([...breakpoints].map((point) => Math.max(start, Math.min(end, point))))]
    .sort((a, b) => a - b);

  const rotationDistance = (boneId: string, leftTime: number, rightTime: number, atTime: number) => {
    const leftPose = sampleLocal(project, leftTime)[boneId];
    const rightPose = sampleLocal(project, rightTime)[boneId];
    const actual = sampleLocal(project, atTime)[boneId];
    const alpha = rightTime === leftTime ? 0 : (atTime - leftTime) / (rightTime - leftTime);
    const interpolated = leftPose.rotation + shortestAngleDelta(leftPose.rotation, rightPose.rotation) * alpha;
    return Math.abs(shortestAngleDelta(interpolated, actual.rotation));
  };
  const tolerance = 0.05;
  for (let iteration = 0; iteration < 8; iteration += 1) {
    const refined: number[] = [];
    let splitCount = 0;
    for (let i = 0; i < orderedTimes.length - 1; i += 1) {
      const leftTime = orderedTimes[i];
      const rightTime = orderedTimes[i + 1];
      refined.push(leftTime);
      const midpoint = (leftTime + rightTime) / 2;
      const worst = Math.max(...bones.map((boneId) => rotationDistance(boneId, leftTime, rightTime, midpoint)));
      if (worst > tolerance && rightTime - leftTime > 1e-6) {
        refined.push(midpoint);
        splitCount += 1;
      }
    }
    refined.push(orderedTimes[orderedTimes.length - 1]);
    orderedTimes = refined;
    if (splitCount === 0) break;
  }
  const dedupedTimes = orderedTimes.filter((point, index) => index === 0 || Math.abs(point - orderedTimes[index - 1]) > 1e-6)
    .map((point) => Math.round(point * 1e9) / 1e9);

  const anchors: Record<string, number> = {};
  const bakedFrames: Keyframe[] = dedupedTimes.map((point, index) => {
    const localPose = sampleLocal(project, point);
    const pose: Record<string, Transform> = {};
    bones.forEach((boneId) => {
      let rotation = localPose[boneId].rotation;
      if (anchors[boneId] !== undefined) rotation = anchors[boneId] + shortestAngleDelta(anchors[boneId], rotation);
      else anchors[boneId] = rotation;
      pose[boneId] = { x: localPose[boneId].x, y: localPose[boneId].y, rotation };
    });
    return { id: `bake-${index}`, time: point, pose };
  });

  const actions = project.actions ?? [];
  const actionId = options.actionId ?? `action-${actions.length + 1}-${Math.round((start + end) * 1000)}`;
  if (actions.some((action) => action.id === actionId)) throw new ConsolidationError([`整理动作 id 已存在：${actionId}`]);
  const action: BakedAction = {
    id: actionId,
    name,
    kind: "baked",
    start,
    end,
    bones,
    fps,
    created_at: `source:${sourceFingerprint(project)}`,
    source_fingerprint: sourceFingerprint(project),
    source_name: project.name,
    keyframes: bakedFrames,
  };
  const nextProject: Project = {
    ...structuredClone(project),
    actions: [...structuredClone(actions), action],
    active_action_id: actionId,
  };
  return {
    project: nextProject,
    action,
    notices: [`已整理 ${bones.length} 根骨骼、${bakedFrames.length} 个可编辑关键姿态；原动作层完整保留。`],
  };
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

export function addWeightKeyframe(project: Project, layerId: string, time: number): Project {
  const next = cloneProject(project);
  const layer = next.layers?.find((item) => item.id === layerId);
  if (!layer) return next;
  const points = layer.weight_keyframes ?? [];
  if (points.some((point) => Math.abs(point.time - time) < 1e-6)) return next;
  layer.weight_keyframes = [...points, { time, weight: layerWeightAt(layer, time), easing: "smooth" as const }]
    .sort((a, b) => a.time - b.time);
  return next;
}

export function updateWeightKeyframe(
  project: Project,
  layerId: string,
  index: number,
  patch: Partial<WeightKeyframe>,
): Project {
  const next = cloneProject(project);
  const layer = next.layers?.find((item) => item.id === layerId);
  const point = layer?.weight_keyframes?.[index];
  if (point) Object.assign(point, patch);
  if (layer?.weight_keyframes) layer.weight_keyframes.sort((a, b) => a.time - b.time);
  return next;
}

export function removeWeightKeyframe(project: Project, layerId: string, index: number): Project {
  const next = cloneProject(project);
  const layer = next.layers?.find((item) => item.id === layerId);
  if (layer?.weight_keyframes) layer.weight_keyframes.splice(index, 1);
  return next;
}

export function setActiveAction(project: Project, actionId: string | null): Project {
  return { ...cloneProject(project), active_action_id: actionId };
}

export function removeBakedAction(project: Project, actionId: string): Project {
  const next = cloneProject(project);
  next.actions = (next.actions ?? []).filter((action) => action.id !== actionId);
  if (next.active_action_id === actionId) next.active_action_id = null;
  return next;
}

export function undoConsolidation(project: Project): Project {
  return { ...cloneProject(project), active_action_id: null };
}
