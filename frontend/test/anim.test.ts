import { describe, expect, it } from "vitest";
import {
  evaluateAt,
  evaluatePose,
  lerpAngle,
  orderedIds,
  shortestDelta,
  validateSkeleton,
} from "../src/lib/anim";
import type { BoneData, SkeletonData } from "../src/types";
import fixture from "./fixture.json";

describe("最短角度插值", () => {
  it("跨过一圈起点时走短弧", () => {
    const d = shortestDelta(6.0, 0.3);
    expect(Math.abs(d)).toBeLessThan(Math.PI);
    expect(d).toBeCloseTo(0.3 + 2 * Math.PI - 6, 10);
    expect(lerpAngle(6.0, 0.3, 0.5)).toBeCloseTo(6.0 + d / 2, 10);
  });

  it("普通区间正常插值", () => {
    expect(lerpAngle(0, 1, 0.25)).toBeCloseTo(0.25, 10);
    expect(shortestDelta(-0.1, 0.1)).toBeCloseTo(0.2, 10);
  });
});

describe("FK 父子跟随", () => {
  it("父骨骼旋转后子骨骼世界变换跟着转动", () => {
    const bones: BoneData[] = [
        { id: "a", parent: null, length: 1, position: [0, 0] as [number, number], rotation: 0 },
        { id: "b", parent: "a", length: 1, position: [1, 0] as [number, number], rotation: 0 },
      ];
    const skeleton: SkeletonData = { bones };
    const rest = evaluateAt(skeleton, [], 0);
    expect(rest.b.x).toBeCloseTo(1, 10);
    const posed = evaluateAt(skeleton, [], 0);
    const world = evaluateAt(skeleton, [{ time: 0, pose: { a: Math.PI / 2 } }], 0);
    expect(world.b.x).toBeCloseTo(0, 10);
    expect(world.b.y).toBeCloseTo(1, 10);
    expect(posed).toBeDefined();
  });

  it("报告缺父、自引用与环冲突", () => {
    const pos: [number, number] = [0, 0];
    const mk = (id: string, parent: string | null): BoneData => ({
      id, parent, length: 1, position: pos, rotation: 0,
    });
    const bones: BoneData[] = [
      mk("a", "c"),
      mk("b", "a"),
      mk("c", "b"),
      mk("d", "ghost"),
      mk("a", "c"),
      ];
    const errors = validateSkeleton({ bones }).map((e) => e.type);
    expect(errors).toContain("cycle");
    expect(errors).toContain("missing-parent");
    expect(errors).toContain("duplicate-id");
    expect(orderedIds(fixture.project.skeleton as SkeletonData).length).toBeGreaterThan(5);
  });
});

describe("前后端一致性", () => {
  const skeleton = fixture.project.skeleton as SkeletonData;
  const keyframes = fixture.project.clip.keyframes as { time: number; pose: Record<string, number> }[];

  it("前端任意时刻求值 == 后端逐时刻求值", () => {
    const times = [0.0, 0.125, 0.37, 0.5, 0.81, 1.0];
    fixture.samples.forEach((sample: Record<string, unknown>, i: number) => {
      const local = evaluateAt(skeleton, keyframes, times[i]);
      for (const [id, remote] of Object.entries(sample)) {
        const w = local[id];
        const r = remote as { x: number; y: number; angle: number; endX: number; endY: number };
        expect(w.x).toBeCloseTo(r.x, 9);
        expect(w.y).toBeCloseTo(r.y, 9);
        expect(w.angle).toBeCloseTo(r.angle, 9);
        expect(w.endX).toBeCloseTo(r.endX, 9);
        expect(w.endY).toBeCloseTo(r.endY, 9);
      }
    });
  });

  it("前端插值姿态与后端导出的每一帧对齐", () => {
    const { exported } = fixture;
    expect(exported.format).toBe("animstudio.action.v1");
    for (const frame of exported.frames) {
      const local = evaluateAt(skeleton, keyframes, frame.time);
      for (const [id, remote] of Object.entries(frame.bones)) {
        const r = remote as { x: number; y: number; angle: number };
        expect(local[id].x).toBeCloseTo(r.x, 9);
        expect(local[id].y).toBeCloseTo(r.y, 9);
        expect(local[id].angle).toBeCloseTo(r.angle, 9);
      }
    }
  });

  it("播放区间外钳制到端帧", () => {
    const before = evaluatePose(
      keyframes.map((k: { time: number }) => k.time),
      new Map(keyframes.map((k: { time: number; pose: Record<string, number> }) => [k.time, k.pose])),
      -5,
    );
    expect(before.head).toBe(keyframes[0].pose.head);
  });
});
