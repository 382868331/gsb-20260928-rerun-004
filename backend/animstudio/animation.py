"""关键帧动画：关键帧容器、最短角度插值、任意时刻求值与编辑操作。"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

from .fk import Pose, evaluate_world
from .skeleton import Skeleton


TAU = 2.0 * math.pi


def shortest_delta(a: float, b: float) -> float:
    """从角度 a 到 b 的最短有向增量，范围 (-pi, pi]。

    角度跨过 0/2pi 一圈起点时，插值走短弧而非远路。
    """
    d = (b - a) % TAU
    if d > math.pi:
        d -= TAU
    return d


def lerp_angle(a: float, b: float, t: float) -> float:
    """沿最短路径对角度插值。"""
    return a + shortest_delta(a, b) * t


@dataclass(frozen=True)
class Keyframe:
    time: float
    pose: Pose = field(default_factory=dict)

    def with_time(self, time: float) -> "Keyframe":
        return Keyframe(time, dict(self.pose))


class AnimationClip:
    """按时间排序的关键帧集合，同一时刻只允许一个关键帧。"""

    def __init__(self, keyframes: list[Keyframe] | None = None, duration: float | None = None):
        self._frames: dict[float, Pose] = {}
        for kf in keyframes or []:
            self._frames[float(kf.time)] = dict(kf.pose)
        self.duration = float(duration) if duration is not None else None

    @property
    def times(self) -> list[float]:
        return sorted(self._frames.keys())

    def __len__(self) -> int:
        return len(self._frames)

    def __iter__(self):
        return iter(self.keyframes)

    @property
    def keyframes(self) -> list[Keyframe]:
        return [Keyframe(t, dict(self._frames[t])) for t in self.times]

    def get(self, time: float) -> Keyframe | None:
        pose = self._frames.get(float(time))
        return Keyframe(float(time), dict(pose)) if pose is not None else None

    def add(self, time: float, pose: Pose) -> Keyframe:
        time = float(time)
        if time < 0:
            raise ValueError("关键帧时间不能为负")
        self._frames[time] = dict(pose)
        return Keyframe(time, dict(pose))

    def remove(self, time: float) -> bool:
        return self._frames.pop(float(time), None) is not None

    def move(self, time: float, new_time: float) -> Keyframe:
        time, new_time = float(time), float(new_time)
        if time not in self._frames:
            raise KeyError(f"时间 {time:g} 处没有关键帧")
        if new_time < 0:
            raise ValueError("关键帧时间不能为负")
        if new_time != time and new_time in self._frames:
            raise ValueError(f"时间 {new_time:g} 已存在关键帧")
        pose = self._frames.pop(time)
        self._frames[new_time] = pose
        return Keyframe(new_time, pose)

    def duplicate(self, time: float, new_time: float) -> Keyframe:
        time, new_time = float(time), float(new_time)
        if time not in self._frames:
            raise KeyError(f"时间 {time:g} 处没有关键帧")
        if new_time < 0:
            raise ValueError("关键帧时间不能为负")
        if new_time in self._frames:
            raise ValueError(f"时间 {new_time:g} 已存在关键帧")
        pose = dict(self._frames[time])
        self._frames[new_time] = pose
        return Keyframe(new_time, pose)

    def effective_duration(self) -> float:
        if self.duration is not None:
            return self.duration
        return self.times[-1] if self._frames else 0.0

    def to_dict(self) -> dict:
        return {
            "duration": self.duration,
            "keyframes": [
                {"time": t, "pose": dict(self._frames[t])} for t in self.times
            ],
        }

    @classmethod
    def from_dict(cls, data: dict) -> "AnimationClip":
        clip = cls(duration=data.get("duration"))
        for raw in data.get("keyframes", []):
            clip.add(float(raw["time"]), {k: float(v) for k, v in raw.get("pose", {}).items()})
        return clip


def _nearest(clip: AnimationClip, time: float) -> tuple[Keyframe | None, Keyframe | None]:
    times = clip.times
    if not times:
        return None, None
    import bisect

    idx = bisect.bisect_left(times, time)
    if idx < len(times) and times[idx] == time:
        kf = clip.get(time)
        return kf, kf
    if idx == 0:
        return None, clip.get(times[0])
    if idx == len(times):
        return clip.get(times[-1]), None
    return clip.get(times[idx - 1]), clip.get(times[idx])


def evaluate_pose(clip: AnimationClip, time: float) -> Pose:
    """求任意时刻的姿态。

    - 关键帧之间：对每根骨骼的旋转增量做最短角度线性插值
    - 首帧之前 / 末帧之后：钳制到首 / 末姿态
    - 空剪辑：零增量静止姿态
    """
    left, right = _nearest(clip, time)
    if left is None and right is None:
        return {}
    if left is None:
        return dict(right.pose)
    if right is None or left is right:
        return dict(left.pose)

    span = right.time - left.time
    t = 0.0 if span <= 0 else (time - left.time) / span
    t = min(1.0, max(0.0, t))
    pose: Pose = {}
    for bid in set(left.pose) | set(right.pose):
        a = left.pose.get(bid, 0.0)
        b = right.pose.get(bid, 0.0)
        pose[bid] = lerp_angle(a, b, t)
    return pose


def evaluate_clip(
    skeleton: Skeleton,
    clip: AnimationClip,
    time: float,
) -> dict[str, dict]:
    """任意时刻求值：插值姿态 + FK，返回每根骨骼的世界变换字典。"""
    pose = evaluate_pose(clip, time)
    world = evaluate_world(skeleton, pose)
    return {bid: wb.to_dict() for bid, wb in world.items()}


# ---- 便捷编辑函数（供 API 与测试使用，返回新数据以便撤销） ----

def move_keyframe(clip: AnimationClip, time: float, new_time: float) -> Keyframe:
    return clip.move(time, new_time)


def duplicate_keyframe(clip: AnimationClip, time: float, new_time: float) -> Keyframe:
    return clip.duplicate(time, new_time)


def remove_keyframe(clip: AnimationClip, time: float) -> bool:
    return clip.remove(time)
