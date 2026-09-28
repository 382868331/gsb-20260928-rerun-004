import type { SkeletonData } from "../types";

const UP = Math.PI / 2;

/** 与后端 animstudio.characters.default_character 保持一致的自带火柴人。 */
export function defaultCharacter(): SkeletonData {
  return {
    bones: [
      { id: "pelvis", parent: null, length: 0, position: [0, 0], rotation: 0 },
      { id: "spine", parent: "pelvis", length: 0.55, position: [0, 0], rotation: UP },
      { id: "neck", parent: "spine", length: 0.12, position: [0.55, 0], rotation: 0 },
      { id: "head", parent: "neck", length: 0.18, position: [0.12, 0], rotation: 0 },
      { id: "upper_arm_l", parent: "spine", length: 0.3, position: [0.5, 0], rotation: 2.6 },
      { id: "forearm_l", parent: "upper_arm_l", length: 0.28, position: [0.3, 0], rotation: 0.3 },
      { id: "upper_arm_r", parent: "spine", length: 0.3, position: [0.5, 0], rotation: -2.6 },
      { id: "forearm_r", parent: "upper_arm_r", length: 0.28, position: [0.3, 0], rotation: -0.3 },
      { id: "thigh_l", parent: "pelvis", length: 0.42, position: [0, 0], rotation: 2.9 },
      { id: "shin_l", parent: "thigh_l", length: 0.42, position: [0.42, 0], rotation: 0.35 },
      { id: "thigh_r", parent: "pelvis", length: 0.42, position: [0, 0], rotation: -2.9 },
      { id: "shin_r", parent: "thigh_r", length: 0.42, position: [0.42, 0], rotation: -0.35 },
    ],
  };
}
