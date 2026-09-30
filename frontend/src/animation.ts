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
};
export type Project = {
  name: string;
  duration: number;
  skeleton: { bones: Bone[] };
  keyframes: Keyframe[];
  layers?: Layer[];
};

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
  });
  return errors;
}

export const orderedKeyframes = (project: Project) =>
  [...project.keyframes].sort((a, b) => a.time - b.time);

export function layerEnvelope(layer: Layer, time: number): number {
  if (layer.weight <= 0 || time < layer.start || time > layer.end) return 0;
  let ramp = 1;
  if (layer.fade_in > 0 && time < layer.start + layer.fade_in) ramp = (time - layer.start) / layer.fade_in;
  else if (layer.fade_out > 0 && time > layer.end - layer.fade_out) ramp = (layer.end - time) / layer.fade_out;
  return Math.max(0, Math.min(1, ramp)) * Math.min(layer.weight, 1);
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
