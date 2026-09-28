import { create } from "zustand";
import type { BoneData, KeyframeData, Pose, ProjectData, SkeletonData } from "./types";
import { defaultCharacter } from "./lib/defaultCharacter";
import { validateSkeleton } from "./lib/anim";

interface Snapshot {
  skeleton: SkeletonData;
  keyframes: KeyframeData[];
  duration: number | null;
}

interface EditorState {
  projectName: string;
  skeleton: SkeletonData;
  keyframes: KeyframeData[];
  duration: number | null;
  currentTime: number;
  playing: boolean;
  selectedBone: string | null;
  selectedKeyTime: number | null;
  dirty: boolean;
  toast: string | null;
  past: Snapshot[];
  future: Snapshot[];

  conflicts: () => ReturnType<typeof validateSkeleton>;
  setSkeleton: (s: SkeletonData) => void;
  setProject: (p: ProjectData) => void;
  setTime: (t: number) => void;
  setPlaying: (p: boolean) => void;
  selectBone: (id: string | null) => void;
  setBoneRotation: (id: string, delta: number) => void;
  updateBone: (id: string, patch: Partial<BoneData>) => void;
  addBone: (bone: BoneData) => void;
  deleteBone: (id: string) => void;
  upsertKeyframe: (time: number, pose: Pose) => void;
  moveKeyframe: (time: number, newTime: number) => void;
  duplicateKeyframe: (time: number, newTime: number) => void;
  removeKeyframe: (time: number) => void;
  selectKey: (t: number | null) => void;
  setDuration: (d: number | null) => void;
  undo: () => void;
  redo: () => void;
  markSaved: () => void;
  setToast: (t: string | null) => void;
}

function snapshot(s: Pick<EditorState, "skeleton" | "keyframes" | "duration">): Snapshot {
  return {
    skeleton: { bones: s.skeleton.bones.map((b) => ({ ...b, position: [...b.position] as [number, number] })) },
    keyframes: s.keyframes.map((k) => ({ time: k.time, pose: { ...k.pose } })),
    duration: s.duration,
  };
}

const sorted = (ks: KeyframeData[]) => [...ks].sort((a, b) => a.time - b.time);

export const useEditor = create<EditorState>((set, get) => {
  const pushHistory = () => {
    const s = get();
    set({ past: [...s.past, snapshot(s)].slice(-100), future: [], dirty: true });
  };

  return {
    projectName: "stickman-demo",
    skeleton: defaultCharacter(),
    keyframes: [
      { time: 0, pose: { spine: 0, head: 0, thigh_l: 0, thigh_r: 0 } },
      { time: 0.5, pose: { spine: 0.15, head: 0.3, thigh_l: 0.3, thigh_r: -0.3 } },
      { time: 1, pose: { spine: 0, head: 0, thigh_l: 0, thigh_r: 0 } },
    ],
    duration: 1,
    currentTime: 0,
    playing: false,
    selectedBone: "head",
    selectedKeyTime: null,
    dirty: false,
    toast: null,
    past: [],
    future: [],

    conflicts: () => validateSkeleton(get().skeleton),

    setSkeleton: (s) => {
      pushHistory();
      set({ skeleton: s });
    },

    setProject: (p) =>
      set({
        projectName: p.name,
        skeleton: p.skeleton,
        keyframes: sorted(p.clip.keyframes),
        duration: p.clip.duration,
        currentTime: 0,
        playing: false,
        selectedBone: null,
        past: [],
        future: [],
        dirty: false,
      }),

    setTime: (t) => set({ currentTime: Math.max(0, t) }),
    setPlaying: (p) => set({ playing: p }),
    selectBone: (id) => set({ selectedBone: id }),

    setBoneRotation: (id, delta) => {
      pushHistory();
      const { skeleton, keyframes, currentTime } = get();
      // 骨架静止旋转也可撤销编辑；姿态增量写回当前时刻关键帧
      const nearest = nearestKey(keyframes, currentTime, 1e-6);
      let nextKeys = keyframes;
      if (nearest) {
        nextKeys = keyframes.map((k) =>
          k.time === nearest.time ? { ...k, pose: { ...k.pose, [id]: (k.pose[id] ?? 0) + delta } } : k,
        );
      } else {
        nextKeys = sorted([...keyframes, { time: currentTime, pose: { [id]: delta } }]);
      }
      set({ skeleton, keyframes: nextKeys });
    },

    updateBone: (id, patch) => {
      pushHistory();
      const skeleton = get().skeleton;
      set({
        skeleton: {
          bones: skeleton.bones.map((b) => (b.id === id ? { ...b, ...patch } : b)),
        },
      });
    },

    addBone: (bone) => {
      pushHistory();
      set({ skeleton: { bones: [...get().skeleton.bones, bone] } });
    },

    deleteBone: (id) => {
      pushHistory();
      set({
        skeleton: { bones: get().skeleton.bones.filter((b) => b.id !== id) },
        selectedBone: get().selectedBone === id ? null : get().selectedBone,
      });
    },

    upsertKeyframe: (time, pose) => {
      pushHistory();
      const existing = get().keyframes.find((k) => k.time === time);
      const rest = get().keyframes.filter((k) => k.time !== time);
      set({
        keyframes: sorted([...rest, { time, pose: existing ? { ...existing.pose, ...pose } : pose }]),
        selectedKeyTime: time,
      });
    },

    moveKeyframe: (time, newTime) => {
      const { keyframes } = get();
      if (!keyframes.some((k) => k.time === time)) return;
      if (newTime < 0 || keyframes.some((k) => k.time === newTime)) return;
      pushHistory();
      set({
        keyframes: sorted(keyframes.map((k) => (k.time === time ? { ...k, time: newTime } : k))),
        selectedKeyTime: newTime,
      });
    },

    duplicateKeyframe: (time, newTime) => {
      const { keyframes } = get();
      const src = keyframes.find((k) => k.time === time);
      if (!src || newTime < 0 || keyframes.some((k) => k.time === newTime)) return;
      pushHistory();
      set({
        keyframes: sorted([...keyframes, { time: newTime, pose: { ...src.pose } }]),
        selectedKeyTime: newTime,
      });
    },

    removeKeyframe: (time) => {
      pushHistory();
      set({
        keyframes: get().keyframes.filter((k) => k.time !== time),
        selectedKeyTime: get().selectedKeyTime === time ? null : get().selectedKeyTime,
      });
    },

    selectKey: (t) => set({ selectedKeyTime: t }),
    setDuration: (d) => {
      pushHistory();
      set({ duration: d });
    },

    undo: () => {
      const { past, future } = get();
      if (past.length === 0) return;
      const previous = past[past.length - 1];
      set({
        past: past.slice(0, -1),
        future: [snapshot(get()), ...future],
        skeleton: previous.skeleton,
        keyframes: previous.keyframes,
        duration: previous.duration,
        dirty: true,
      });
    },

    redo: () => {
      const { past, future } = get();
      if (future.length === 0) return;
      const next = future[0];
      set({
        future: future.slice(1),
        past: [...past, snapshot(get())],
        skeleton: next.skeleton,
        keyframes: next.keyframes,
        duration: next.duration,
        dirty: true,
      });
    },

    markSaved: () => set({ dirty: false }),
    setToast: (t) => set({ toast: t }),
  };
});

function nearestKey(keyframes: KeyframeData[], time: number, eps: number): KeyframeData | null {
  return keyframes.find((k) => Math.abs(k.time - time) <= eps) ?? null;
}
