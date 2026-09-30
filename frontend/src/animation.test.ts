import { describe, expect, it } from "vitest";
import { evaluateWorld, exportAction, layerWeight, sampleLocal, shortestAngleDelta, validateProject } from "./animation";
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
    const project = structuredClone(defaultProject);
    project.layers = [];
    project.keyframes[0].pose.upper_arm_r.rotation = 350;
    project.keyframes[1].pose.upper_arm_r.rotation = 350;
    project.keyframes[2].pose.upper_arm_r.rotation = 10;
    const rotation = sampleLocal(project, 0.9).upper_arm_r.rotation;
    expect(((rotation + 360) % 360)).toBeCloseTo(0);
    expect(Math.abs(rotation - 350)).toBeLessThan(45);
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

  it("adds an upper-body layer only to its masked bones with graded weight", () => {
    const middle = sampleLocal(defaultProject, 0.65);
    expect(middle.upper_arm_r.rotation).toBeCloseTo(-10);
    expect(middle.forearm_l.rotation).toBeCloseTo(0);
    const boundary = sampleLocal(defaultProject, 0.2);
    expect(boundary.upper_arm_r.rotation).toBeCloseTo(0);
    const layer = defaultProject.layers![0];
    expect(layerWeight(layer, layer.start)).toBeCloseTo(0);
    expect(layerWeight(layer, layer.start + layer.fade_in / 2)).toBeCloseTo(0.5);
    expect(layerWeight(layer, layer.end)).toBeCloseTo(0);
  });

  it("keeps layer interpolation on the short angular path", () => {
    const pose = sampleLocal(defaultProject, 0.8);
    expect(Math.abs(pose.upper_arm_r.rotation)).toBeLessThan(90);
  });

  it("leaves the parent untouched when only a child bone is masked", () => {
    const project = structuredClone(defaultProject);
    const layer = project.layers![0];
    layer.bones = ["forearm_r"];
    layer.reference = structuredClone(layer.keyframes[0].pose);
    layer.keyframes.forEach((frame) => { frame.pose.forearm_r.rotation = 30; });
    project.keyframes.forEach((frame) => { frame.pose.spine.rotation = 0; });
    const world = evaluateWorld(project, 0.65);
    expect(world.upper_arm_r.rotation).toBeCloseTo(0);
    expect(world.forearm_r.rotation).toBeCloseTo(30);
  });

  it("validates and round-trips layered projects", () => {
    expect(validateProject(structuredClone(defaultProject))).toHaveLength(0);
    const action = exportAction(defaultProject, 24);
    action.frames.forEach((frame) => {
      const expected = evaluateWorld(defaultProject, frame.time);
      defaultProject.skeleton.bones.forEach((bone) => {
        expect(frame.world[bone.id].rotation).toBeCloseTo(expected[bone.id].rotation, 10);
      });
    });
  });
});
