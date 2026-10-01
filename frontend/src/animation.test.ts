import { describe, expect, it } from "vitest";
import { addLayerKeyframe, addWeightKey, analyzeRebake, applyRebake, bakeAction, evaluateWorld, exportAction, layerEnvelope, migrateProject, removeWeightKey, sampleLocal, shortestAngleDelta, updatePose, updateWeightKey, validateProject, weightKeyMultiplier } from "./animation";
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

  it("interpolates weight keys and reflects mid-transition reversals", () => {
    let project = addWeightKey(defaultProject, "layer-wave", 0.15, 0);
    project = addWeightKey(project, "layer-wave", 0.45, 1);
    project = addWeightKey(project, "layer-wave", 0.75, 0.2);
    const layer = project.layers![0];
    expect(weightKeyMultiplier(layer, 0.3)).toBeCloseTo(0.5);
    expect(weightKeyMultiplier(layer, 0.6)).toBeCloseTo(0.6);
    const middle = layer.weight_keys!.find((key) => Math.abs(key.time - 0.45) < 1e-9)!;
    project = updateWeightKey(project, "layer-wave", middle.id, { weight: 0 });
    expect(weightKeyMultiplier(project.layers![0], 0.3)).toBeCloseTo(0);
    project = removeWeightKey(project, "layer-wave", middle.id);
    expect(weightKeyMultiplier(project.layers![0], 0.3)).toBeCloseTo(0.05);
  });

  it("bakes a range into an editable flat action with provenance", () => {
    const bones = defaultProject.skeleton.bones.map((bone) => bone.id);
    const { action } = bakeAction(defaultProject, 0.2, 1.0, bones, "片段");
    expect(action.duration).toBeCloseTo(0.8);
    expect(action.layers).toEqual([]);
    expect(action.source.source_version).toBe(1);
    expect(action.source.range_start).toBe(0.2);
    const projectWithAction = { ...defaultProject, actions: [action] };
    expect(validateProject(projectWithAction)).toHaveLength(0);
    for (let i = 0; i <= Math.round(0.8 * 60); i += 1) {
      const t = Math.min(i / 60, 0.8);
      const sourcePose = sampleLocal(defaultProject, 0.2 + t);
      action.keyframes.forEach(() => undefined);
      const baked = action.keyframes[Math.min(i, action.keyframes.length - 1)].pose;
      bones.forEach((boneId) => {
        expect(Math.abs(shortestAngleDelta(baked[boneId].rotation, sourcePose[boneId].rotation))).toBeLessThan(1e-6);
      });
    }
  });

  it("rejects baking with missing bones or partial layers without partial output", () => {
    expect(() => bakeAction(defaultProject, 0.2, 1.0, ["ghost"], "x")).toThrow("缺失骨骼");
    expect(() => bakeAction(defaultProject, 0.2, 1.0, ["upper_arm_r"], "x")).toThrow("forearm_r");
    expect(defaultProject.actions).toEqual([]);
  });

  it("distinguishes source and baked versions after base edits and migration", () => {
    const bones = defaultProject.skeleton.bones.map((bone) => bone.id);
    const first = bakeAction(defaultProject, 0, 0.6, bones, "v1").action;
    const edited: typeof defaultProject = structuredClone(defaultProject);
    edited.version = 2;
    edited.keyframes[1].pose.spine.rotation = 9;
    edited.actions = [first];
    const second = bakeAction(edited, 0, 0.6, bones, "v2").action;
    expect(second.source.source_version).toBe(2);
    expect(first.source.source_version).toBe(1);
    expect(validateProject({ ...edited, actions: [first, second] })).toHaveLength(0);
    const legacy = migrateProject(structuredClone(defaultProject) as never);
    expect(legacy.version).toBe(1);
    expect(legacy.actions).toEqual([]);
    expect(legacy.layers?.[0].weight_keys).toEqual([]);
  });

  it("bakes layers with smooth weight transition keyframes", () => {
    let project = addWeightKey(defaultProject, "layer-wave", 0.2, 0);
    project = addWeightKey(project, "layer-wave", 0.5, 1);
    project = addWeightKey(project, "layer-wave", 0.9, 0.3);
    const bones = project.skeleton.bones.map((bone) => bone.id);
    const { action } = bakeAction(project, 0.15, 1.05, bones, "过渡");
    expect(validateProject({ ...project, actions: [action] })).toHaveLength(0);
    action.keyframes.forEach((frame) => {
      const sourcePose = sampleLocal(project, 0.15 + frame.time);
      expect(frame.origin).toBe("baked");
      ["upper_arm_r", "forearm_r"].forEach((boneId) => {
        expect(Math.abs(shortestAngleDelta(frame.pose[boneId].rotation, sourcePose[boneId].rotation))).toBeLessThan(1e-6);
      });
    });
  });

  it("analyzes affected segments and applies partial rebake with manual handling", () => {
    const bones = defaultProject.skeleton.bones.map((bone) => bone.id);
    const { action } = bakeAction(defaultProject, 0, 1.2, bones, "片段");
    let project: typeof defaultProject = { ...structuredClone(defaultProject), actions: [action] };
    // manual retouch on the action is flagged via updatePose on the action view
    const actionView = { ...project, duration: action.duration, keyframes: action.keyframes, layers: [] };
    const retouched = updatePose(actionView as never, action.keyframes[10].id, "spine", { rotation: 45 });
    expect(retouched.keyframes[10].origin).toBe("manual");
    const edited = structuredClone(project);
    edited.actions = [{ ...action, keyframes: retouched.keyframes }];
    edited.version = 2;
    edited.keyframes[1].pose.spine.rotation = 9;
    const segments = analyzeRebake(edited, edited.actions![0]);
    expect(segments.length).toBeGreaterThan(0);
    expect(segments.some((segment) => segment.manual)).toBe(true);
    const manualSegment = segments.find((segment) => segment.manual)!;
    const decisions = segments.map((segment) => ({
      segment: { start: segment.start, end: segment.end },
      resolution: (segment === manualSegment ? "keep" : "source") as "keep" | "source",
    }));
    const next = applyRebake(edited, edited.actions![0].id, decisions.filter((d) => d.resolution === "source"));
    const updated = next.actions![0];
    expect(updated.revision).toBe(2);
    expect(updated.previous_versions).toHaveLength(1);
    const kept = updated.keyframes.filter((frame) => frame.origin === "manual");
    expect(kept).toHaveLength(1);
    expect(kept[0].pose.spine.rotation).toBeCloseTo(45);
    updated.keyframes.filter((frame) => frame.origin === "baked").forEach((frame) => {
      const sourcePose = sampleLocal(edited, frame.time);
      expect(Math.abs(shortestAngleDelta(frame.pose.spine.rotation, sourcePose.spine.rotation))).toBeLessThan(1e-6);
    });
    const remaining = analyzeRebake(edited, updated);
    expect(remaining.every((segment) => segment.manual)).toBe(true);
    const final = applyRebake({ ...edited, actions: [updated] }, updated.id, remaining.map((segment) => ({
      segment: { start: segment.start, end: segment.end }, resolution: "source" as const,
    })));
    expect(analyzeRebake(edited, final.actions![0])).toHaveLength(0);
    expect(final.actions![0].source.source_version).toBe(2);
    expect(validateProject(final)).toHaveLength(0);
  });
});
