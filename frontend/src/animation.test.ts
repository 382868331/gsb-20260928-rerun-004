import { describe, expect, it } from "vitest";
import { addLayerKeyframe, actionIsCurrent, consolidateLayers, ConsolidationError, evaluateWorld, exportAction, layerEnvelope, layerWeightAt, resolveAction, sampleLocal, shortestAngleDelta, sourceFingerprint, validateProject } from "./animation";
import { defaultProject } from "./defaultProject";

describe("animation core", () => {
  it("chooses the short path across the angle wrap point", () => {
    expect(shortestAngleDelta(350, 10)).toBe(20);
    expect(shortestAngleDelta(10, 350)).toBe(-20);
  });

  it("makes child bones follow parent rotation", () => {
    const project = structuredClone(defaultProject);
    project.keyframes[0].pose.spine.rotation = 90;
    const world = evaluateWorld(project, 0);
    expect(world.head.x).toBeCloseTo(48);
    expect(world.head.y).toBeCloseTo(-55);
    expect(world.head.rotation).toBeCloseTo(90);
  });

  it("samples arbitrary intermediate times without taking the long angular path", () => {
    const baseOnly = structuredClone(defaultProject);
    baseOnly.layers = [{
      ...defaultProject.layers![0],
      start: 0, end: 1.2, fade_in: 0, fade_out: 0, weight: 1,
      keyframes: [
        { id: "a", time: 0.6, pose: { upper_arm_r: { x: 22, y: -8, rotation: 350 }, forearm_r: { x: 48, y: 6, rotation: 0 } } },
        { id: "b", time: 1.2, pose: { upper_arm_r: { x: 22, y: -8, rotation: 10 }, forearm_r: { x: 48, y: 6, rotation: 0 } } },
      ],
    }];
    const rotation = sampleLocal(baseOnly, 0.9).upper_arm_r.rotation;
    expect(((rotation + 360) % 360)).toBeCloseTo(0);
    expect(Math.abs(rotation - 350)).toBeLessThan(45);
  });

  it("restricts a layer to its bones and applies its weight envelope", () => {
    const outside = sampleLocal(defaultProject, 0);
    expect(outside.upper_arm_r.rotation).toBeCloseTo(0);
    const layer = defaultProject.layers![0];
    expect(layerEnvelope(layer, 0.15)).toBeCloseTo(0);
    expect(layerEnvelope(layer, 0.5)).toBeCloseTo(1);
    expect(layerEnvelope(layer, 1.05)).toBeCloseTo(0);
    const active = sampleLocal(defaultProject, 0.6);
    expect(active.thigh_r.rotation).toBeCloseTo(-18);
    expect(active.upper_arm_r.rotation).toBeCloseTo(355);
    expect(active.forearm_r.rotation).toBeCloseTo(-30);
  });

  it("blends across zero degrees with the shortest path during fade", () => {
    const faded = sampleLocal(defaultProject, 0.25);
    expect(faded.upper_arm_r.rotation).toBeCloseTo(5.4166667, 5);
    expect(faded.forearm_r.rotation).toBeGreaterThan(-17.5);
    expect(faded.forearm_r.rotation).toBeLessThan(0);
  });

  it("keeps parent/child meaning explicit when the parent bone is outside a layer", () => {
    const project = structuredClone(defaultProject);
    project.keyframes[0].pose.spine.rotation = 30;
    project.layers = [{
      id: "aim", name: "右臂瞄准", weight: 1, start: 0, end: 1.2, fade_in: 0, fade_out: 0,
      bones: ["upper_arm_r"],
      keyframes: [
        { id: "aim-0", time: 0, pose: { upper_arm_r: { x: 22, y: -8, rotation: 90 } } },
        { id: "aim-1", time: 1.2, pose: { upper_arm_r: { x: 22, y: -8, rotation: 90 } } },
      ],
    }];
    const world = evaluateWorld(project, 0);
    expect(world.upper_arm_r.rotation).toBeCloseTo(120);
    expect(world.forearm_r.rotation).toBeCloseTo(120);
  });

  it("validates layer ranges, fades and bone lists", () => {
    const bad = structuredClone(defaultProject);
    bad.layers![0].bones.push("ghost");
    expect(validateProject(bad).join("\n")).toContain("未知骨骼 ghost");
    const badFade = structuredClone(defaultProject);
    badFade.layers![0].fade_in = 1;
    badFade.layers![0].fade_out = 1;
    expect(validateProject(badFade).join("\n")).toContain("淡入淡出");
  });

  it("creates layer keyframes containing only the layer bones", () => {
    const next = addLayerKeyframe(defaultProject, "layer-wave");
    const layer = next.layers![0];
    expect(layer.keyframes).toHaveLength(4);
    expect(Object.keys(layer.keyframes.at(-1)!.pose).sort()).toEqual(["forearm_r", "upper_arm_r"]);
    expect(validateProject(next)).toHaveLength(0);
  });

  it("keeps exported frames identical to point-in-time evaluation", () => {
    const action = exportAction(defaultProject, 24);
    expect(action.frames).toHaveLength(30);
    action.frames.forEach((frame) => {
      const expected = evaluateWorld(defaultProject, frame.time);
      defaultProject.skeleton.bones.forEach((bone) => {
        expect(frame.world[bone.id].x).toBeCloseTo(expected[bone.id].x, 10);
        expect(frame.world[bone.id].y).toBeCloseTo(expected[bone.id].y, 10);
      });
    });
  });

  it("reports invalid skeleton hierarchy", () => {
    const broken = structuredClone(defaultProject);
    broken.skeleton.bones[1].parent = "missing";
    expect(validateProject(broken).join("\n")).toContain("不存在的父骨骼");
  });

  it("matches the Python source fingerprint byte-for-byte", () => {
    expect(sourceFingerprint(defaultProject)).toBe("50e12c8e");
  });

  it("supports smooth weight transitions with reverse scrub and repeat", () => {
    const layer = {
      ...defaultProject.layers![0],
      weight_keyframes: [
        { time: 0.2, weight: 0, easing: "smooth" as const },
        { time: 0.6, weight: 1, easing: "smooth" as const },
      ],
    };
    expect(layerWeightAt(layer, 0.2)).toBeCloseTo(0);
    expect(layerWeightAt(layer, 0.6)).toBeCloseTo(1);
    const midpoint = layerWeightAt(layer, 0.4);
    expect(layerWeightAt(layer, 0.4)).toBeCloseTo(midpoint);
    expect(layerWeightAt(layer, 0.4)).toBeCloseTo(midpoint);
  });

  it("consolidates layers into an editable action matching the source pose", () => {
    const source = structuredClone(defaultProject);
    const before = structuredClone(source.layers);
    const { project: baked, action } = consolidateLayers(source, {
      start: 0.2, end: 1, bones: ["upper_arm_r", "forearm_r"], name: "挥手整理",
    });
    expect(source.layers).toEqual(before);
    expect(source.actions).toBeUndefined();
    expect(actionIsCurrent(baked, action)).toBe(true);
    expect(resolveAction(baked, action.id)?.id).toBe(action.id);
    action.keyframes.forEach((frame) => {
      const expected = sampleLocal(source, frame.time);
      const actual = sampleLocal(baked, frame.time, action.id);
      action.bones.forEach((boneId) => {
        const delta = Math.abs(shortestAngleDelta(expected[boneId].rotation, actual[boneId].rotation));
        expect(delta).toBeLessThan(1e-8);
        expect(actual[boneId].x).toBeCloseTo(expected[boneId].x, 10);
      });
    });
    [0, 0.1, 1.05, 1.2].forEach((probe) => {
      expect(sampleLocal(baked, probe, action.id)).toEqual(sampleLocal(source, probe));
    });
    let worst = 0;
    for (let i = 0; i <= 100; i += 1) {
      const probe = 0.2 + (0.8 * i) / 100;
      const expected = sampleLocal(source, probe);
      const actual = sampleLocal(baked, probe, action.id);
      action.bones.forEach((boneId) => {
        worst = Math.max(worst, Math.abs(shortestAngleDelta(expected[boneId].rotation, actual[boneId].rotation)));
      });
    }
    expect(worst).toBeLessThan(0.05);
    expect(validateProject(baked)).toHaveLength(0);
  });

  it("rejects missing bones and incompatible layers without partial results", () => {
    const project = structuredClone(defaultProject);
    expect(() => consolidateLayers(project, { start: 0, end: 1, bones: ["ghost"] })).toThrow(ConsolidationError);
    expect(project.actions).toBeUndefined();
    const broken = structuredClone(defaultProject);
    delete (broken.layers![0].keyframes[1].pose as Record<string, unknown>).forearm_r;
    try {
      consolidateLayers(broken, { start: 0.2, end: 1, bones: ["forearm_r"] });
      throw new Error("should have rejected");
    } catch (error) {
      expect(error).toBeInstanceOf(ConsolidationError);
      expect((error as ConsolidationError).errors.join("\n")).toContain("forearm_r");
    }
  });

  it("marks baked actions stale after source keyframes change", () => {
    const { project: baked, action } = consolidateLayers(structuredClone(defaultProject), {
      start: 0.2, end: 1, bones: ["upper_arm_r"],
    });
    expect(actionIsCurrent(baked, action)).toBe(true);
    const changed = structuredClone(baked);
    changed.keyframes[1].pose.spine.rotation = 42;
    expect(actionIsCurrent(changed, action)).toBe(false);
  });
});
