import type { Project, Transform } from "./animation";

const bones = [
  { id: "root", name: "骨盆", parent: null, rest: { x: 0, y: 0 } },
  { id: "spine", name: "躯干", parent: "root", rest: { x: 0, y: -55 } },
  { id: "head", name: "头部", parent: "spine", rest: { x: 0, y: -48 } },
  { id: "upper_arm_l", name: "左上臂", parent: "spine", rest: { x: -22, y: -8 } },
  { id: "forearm_l", name: "左前臂", parent: "upper_arm_l", rest: { x: -48, y: 6 } },
  { id: "upper_arm_r", name: "右上臂", parent: "spine", rest: { x: 22, y: -8 } },
  { id: "forearm_r", name: "右前臂", parent: "upper_arm_r", rest: { x: 48, y: 6 } },
  { id: "thigh_l", name: "左大腿", parent: "root", rest: { x: -18, y: 48 } },
  { id: "shin_l", name: "左小腿", parent: "thigh_l", rest: { x: -4, y: 56 } },
  { id: "thigh_r", name: "右大腿", parent: "root", rest: { x: 18, y: 48 } },
  { id: "shin_r", name: "右小腿", parent: "thigh_r", rest: { x: 4, y: 56 } },
] as const;

const makePose = (
  rotations: Partial<Record<(typeof bones)[number]["id"], number>> = {},
): Record<string, Transform> =>
  Object.fromEntries(
    bones.map((bone) => [
      bone.id,
      { x: bone.rest.x, y: bone.rest.y, rotation: rotations[bone.id] ?? 0 },
    ]),
  );

export const defaultProject: Project = {
  name: "简单角色挥手",
  duration: 1.2,
  skeleton: { bones: bones.map((bone) => ({ ...bone })) },
  keyframes: [
    { id: "kf-rest", time: 0, pose: makePose() },
    { id: "kf-wave", time: 0.6, pose: makePose({ upper_arm_r: 350, forearm_r: -35, head: 8 }) },
    { id: "kf-end", time: 1.2, pose: makePose({ upper_arm_r: 10 }) },
  ],
};
