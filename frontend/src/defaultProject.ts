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
  name: "走路与上半身挥手分层",
  version: 1,
  duration: 1.2,
  skeleton: { bones: bones.map((bone) => ({ ...bone })) },
  keyframes: [
    { id: "kf-rest", time: 0, pose: makePose() },
    { id: "kf-walk-mid", time: 0.6, pose: makePose({ thigh_l: 18, thigh_r: -18, shin_l: -12, shin_r: 22, spine: -3 }) },
    { id: "kf-walk-end", time: 1.2, pose: makePose({ thigh_l: -18, thigh_r: 18, shin_l: 22, shin_r: -12, spine: 3 }) },
  ],
  layers: [
    {
      id: "layer-wave",
      name: "右手挥手",
      weight: 1,
      start: 0.15,
      end: 1.05,
      fade_in: 0.2,
      fade_out: 0.2,
      bones: ["upper_arm_r", "forearm_r"],
      weight_keys: [],
      keyframes: [
        { id: "wave-0", time: 0, pose: { upper_arm_r: { x: 22, y: -8, rotation: 350 }, forearm_r: { x: 48, y: 6, rotation: -35 } } },
        { id: "wave-1", time: 0.3, pose: { upper_arm_r: { x: 22, y: -8, rotation: 15 }, forearm_r: { x: 48, y: 6, rotation: -25 } } },
        { id: "wave-2", time: 0.6, pose: { upper_arm_r: { x: 22, y: -8, rotation: 355 }, forearm_r: { x: 48, y: 6, rotation: -30 } } },
      ],
    },
  ],
  actions: [],
};
