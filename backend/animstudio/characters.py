"""自带的简单角色：一个带脊柱、头、双臂双腿的火柴人骨架。"""

from __future__ import annotations

from .skeleton import Bone, Skeleton


def default_character() -> Skeleton:
    up = 1.5707963267948966  # pi/2：骨骼沿局部 x 生长，旋转 90° 朝上
    bones = [
        Bone("pelvis", None, 0.0, position=(0.0, 0.0)),
        Bone("spine", "pelvis", 0.55, position=(0.0, 0.0), rotation=up),
        Bone("neck", "spine", 0.12, position=(0.55, 0.0)),
        Bone("head", "neck", 0.18, position=(0.12, 0.0)),
        Bone("upper_arm_l", "spine", 0.3, position=(0.5, 0.0), rotation=2.6),
        Bone("forearm_l", "upper_arm_l", 0.28, position=(0.3, 0.0), rotation=0.3),
        Bone("upper_arm_r", "spine", 0.3, position=(0.5, 0.0), rotation=-2.6),
        Bone("forearm_r", "upper_arm_r", 0.28, position=(0.3, 0.0), rotation=-0.3),
        Bone("thigh_l", "pelvis", 0.42, position=(0.0, 0.0), rotation=2.9),
        Bone("shin_l", "thigh_l", 0.42, position=(0.42, 0.0), rotation=0.35),
        Bone("thigh_r", "pelvis", 0.42, position=(0.0, 0.0), rotation=-2.9),
        Bone("shin_r", "thigh_r", 0.42, position=(0.42, 0.0), rotation=-0.35),
    ]
    return Skeleton(bones)
