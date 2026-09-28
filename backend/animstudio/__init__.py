"""角色动画制作台核心包：骨架、姿态、动画与工程存储。"""

from .skeleton import Bone, Skeleton, SkeletonError, validate_skeleton
from .fk import evaluate_world, WorldBone
from .animation import (
    Keyframe,
    AnimationClip,
    shortest_delta,
    lerp_angle,
    evaluate_clip,
    evaluate_pose,
    move_keyframe,
    duplicate_keyframe,
    remove_keyframe,
)
from .characters import default_character
from .export import export_clip
from .project import ProjectStore

__all__ = [
    "Bone",
    "Skeleton",
    "SkeletonError",
    "validate_skeleton",
    "evaluate_world",
    "WorldBone",
    "Keyframe",
    "AnimationClip",
    "shortest_delta",
    "lerp_angle",
    "evaluate_clip",
    "evaluate_pose",
    "move_keyframe",
    "duplicate_keyframe",
    "remove_keyframe",
    "default_character",
    "export_clip",
    "ProjectStore",
]
