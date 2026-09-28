export interface BoneData {
  id: string;
  parent: string | null;
  length: number;
  position: [number, number];
  rotation: number;
}

export interface SkeletonData {
  bones: BoneData[];
}

export interface KeyframeData {
  time: number;
  pose: Record<string, number>;
}

export interface ClipData {
  duration: number | null;
  keyframes: KeyframeData[];
}

export interface ProjectData {
  format?: string;
  name: string;
  skeleton: SkeletonData;
  clip: ClipData;
}

export interface WorldBoneData {
  id: string;
  parent: string | null;
  x: number;
  y: number;
  angle: number;
  length: number;
  endX: number;
  endY: number;
}

export type Pose = Record<string, number>;
