"""前向运动学（FK）：把每根骨骼的本地姿态累加成世界变换。

姿态（pose）只存储每根骨骼相对其静止本地姿态的旋转增量（弧度），
父骨骼旋转时子骨骼通过 FK 自动跟随。
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from .skeleton import Skeleton

Pose = dict[str, float]


@dataclass(frozen=True)
class WorldBone:
    id: str
    parent: str | None
    x: float
    y: float
    angle: float  # 世界方向（弧度）
    length: float

    @property
    def end(self) -> tuple[float, float]:
        return (
            self.x + self.length * math.cos(self.angle),
            self.y + self.length * math.sin(self.angle),
        )

    def to_dict(self) -> dict:
        end_x, end_y = self.end
        return {
            "id": self.id,
            "parent": self.parent,
            "x": self.x,
            "y": self.y,
            "angle": self.angle,
            "length": self.length,
            "endX": end_x,
            "endY": end_y,
        }


def evaluate_world(
    skeleton: Skeleton,
    pose: Pose | None = None,
) -> dict[str, WorldBone]:
    """根据每根骨骼的旋转增量计算世界变换。

    骨骼本地坐标系 = 静止 position（父空间平移）+ 静止 rotation + 动画旋转增量；
    骨骼沿本地 x 轴延伸 length，末端即子骨骼挂点。
    """
    pose = pose or {}
    world: dict[str, WorldBone] = {}
    cos = math.cos
    sin = math.sin

    for bid in skeleton.ordered_ids():
        bone = skeleton.bones[bid]
        local_angle = bone.rotation + pose.get(bid, 0.0)
        if bone.parent is None:
            wx = bone.position[0]
            wy = bone.position[1]
            wa = local_angle
        else:
            parent_world = world[bone.parent]
            ox, oy = bone.position
            pa = parent_world.angle
            wx = parent_world.x + ox * cos(pa) - oy * sin(pa)
            wy = parent_world.y + ox * sin(pa) + oy * cos(pa)
            wa = pa + local_angle
        world[bid] = WorldBone(bid, bone.parent, wx, wy, wa, bone.length)
    return world
