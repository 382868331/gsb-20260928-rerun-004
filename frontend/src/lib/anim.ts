import type {
  BoneData,
  Pose,
  SkeletonData,
  WorldBoneData,
} from "../types";

export const TAU = Math.PI * 2;

/** 从角度 a 到 b 的最短有向增量，范围 (-pi, pi]，跨一圈起点时走短弧。 */
export function shortestDelta(a: number, b: number): number {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d <= -Math.PI) d += TAU;
  return d;
}

export function lerpAngle(a: number, b: number, t: number): number {
  return a + shortestDelta(a, b) * t;
}

export interface BoneConflict {
  type: "missing-parent" | "self-parent" | "duplicate-id" | "cycle" | "negative-length" | "empty";
  message: string;
}

/** 校验骨架结构，返回所有冲突；无冲突时返回空数组。 */
export function validateSkeleton(skeleton: SkeletonData): BoneConflict[] {
  const errors: BoneConflict[] = [];
  const ids = new Set<string>();
  if (skeleton.bones.length === 0) {
    errors.push({ type: "empty", message: "骨架至少需要一个骨骼" });
  }
  for (const b of skeleton.bones) {
    if (!b.id) errors.push({ type: "empty", message: "存在空 id 的骨骼" });
    if (ids.has(b.id)) errors.push({ type: "duplicate-id", message: `骨骼 id 重复: ${b.id}` });
    ids.add(b.id);
  }
  for (const b of skeleton.bones) {
    if (b.parent !== null && !ids.has(b.parent)) {
      errors.push({
        type: "missing-parent",
        message: `骨骼 ${b.id} 的父骨骼 ${b.parent} 不存在`,
      });
    }
    if (b.parent === b.id) {
      errors.push({ type: "self-parent", message: `骨骼 ${b.id} 不能以自身为父` });
    }
    if (b.length < 0) {
      errors.push({ type: "negative-length", message: `骨骼 ${b.id} 长度不能为负: ${b.length}` });
    }
  }
  // 环检测（DFS 三色法）
  const byId = new Map(skeleton.bones.map((b) => [b.id, b]));
  const color = new Map<string, 0 | 1 | 2>();
  for (const b of skeleton.bones) color.set(b.id, 0);
  const dfs = (id: string, path: string[]) => {
    color.set(id, 1);
    path.push(id);
    const bone = byId.get(id);
    const parent = bone?.parent;
    if (parent && parent !== id && byId.has(parent)) {
      if (color.get(parent) === 1) {
        const start = path.indexOf(parent);
        errors.push({
          type: "cycle",
          message: "父子关系存在环: " + path.slice(start).concat(parent).join(" -> "),
        });
      } else if (color.get(parent) === 0) {
        dfs(parent, path);
      }
    }
    path.pop();
    color.set(id, 2);
  };
  for (const b of skeleton.bones) {
    if (color.get(b.id) === 0) dfs(b.id, []);
  }
  return errors;
}

/** 拓扑排序（父先于子）；调用前应确保无结构冲突。 */
export function orderedIds(skeleton: SkeletonData): string[] {
  const byId = new Map(skeleton.bones.map((b) => [b.id, b]));
  const order: string[] = [];
  const done = new Set<string>();
  const visit = (id: string) => {
    if (done.has(id)) return;
    const b = byId.get(id)!;
    if (b.parent) visit(b.parent);
    done.add(id);
    order.push(id);
  };
  for (const b of skeleton.bones) visit(b.id);
  return order;
}

/** FK：每根骨骼的旋转增量 -> 世界变换，父骨骼变化时子骨骼自动跟随。 */
export function evaluateWorld(skeleton: SkeletonData, pose: Pose = {}): Record<string, WorldBoneData> {
  const byId = new Map(skeleton.bones.map((b) => [b.id, b]));
  const world: Record<string, WorldBoneData> = {};
  for (const id of orderedIds(skeleton)) {
    const bone: BoneData = byId.get(id)!;
    const localAngle = bone.rotation + (pose[id] ?? 0);
    let x: number, y: number, angle: number;
    if (bone.parent === null) {
      x = bone.position[0];
      y = bone.position[1];
      angle = localAngle;
    } else {
      const p = world[bone.parent];
      const [ox, oy] = bone.position;
      x = p.x + ox * Math.cos(p.angle) - oy * Math.sin(p.angle);
      y = p.y + ox * Math.sin(p.angle) + oy * Math.cos(p.angle);
      angle = p.angle + localAngle;
    }
    world[id] = {
      id,
      parent: bone.parent,
      x,
      y,
      angle,
      length: bone.length,
      endX: x + bone.length * Math.cos(angle),
      endY: y + bone.length * Math.sin(angle),
    };
  }
  return world;
}

/** 任意时刻的插值姿态：帧间走最短角度，区间外钳制到端帧。 */
export function evaluatePose(times: number[], poses: Map<number, Pose>, time: number): Pose {
  if (times.length === 0) return {};
  const sorted = [...times].sort((a, b) => a - b);
  // 二分找右边界
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < time) lo = mid + 1;
    else hi = mid;
  }
  const idx = lo;
  if (idx >= sorted.length) return { ...poses.get(sorted[sorted.length - 1])! };
  if (sorted[idx] === time) return { ...poses.get(time)! };
  if (idx === 0) return { ...poses.get(sorted[0])! };
  const t0 = sorted[idx - 1];
  const t1 = sorted[idx];
  const p0 = poses.get(t0)!;
  const p1 = poses.get(t1)!;
  const span = t1 - t0;
  const u = span <= 0 ? 0 : Math.min(1, Math.max(0, (time - t0) / span));
  const result: Pose = {};
  for (const id of new Set([...Object.keys(p0), ...Object.keys(p1)])) {
    result[id] = lerpAngle(p0[id] ?? 0, p1[id] ?? 0, u);
  }
  return result;
}

/** 逐时刻求值：插值姿态 + FK，与后端 evaluate_clip 输出一致。 */
export function evaluateAt(skeleton: SkeletonData, keyframes: { time: number; pose: Pose }[], time: number): Record<string, WorldBoneData> {
  const poses = new Map(keyframes.map((k) => [k.time, k.pose]));
  const pose = evaluatePose(
    keyframes.map((k) => k.time),
    poses,
    time,
  );
  return evaluateWorld(skeleton, pose);
}
