"""动作数据导出。

导出的动作数据是自描述的：包含骨架、帧率和每个采样时刻的世界变换，
播放器或外部系统无需再做插值即可直接使用；世界变换与 evaluate_clip 逐时刻求值
结果逐字段一致。
"""

from __future__ import annotations

from .animation import AnimationClip, evaluate_pose
from .fk import evaluate_world
from .skeleton import Skeleton


def export_clip(
    skeleton: Skeleton,
    clip: AnimationClip,
    fps: int = 30,
) -> dict:
    if fps <= 0:
        raise ValueError("fps 必须为正整数")
    duration = clip.effective_duration()
    frame_count = int(round(duration * fps)) + 1
    frames: list[dict] = []
    for i in range(frame_count):
        t = i / fps
        pose = evaluate_pose(clip, t)
        world = evaluate_world(skeleton, pose)
        frames.append(
            {
                "index": i,
                "time": t,
                "bones": {bid: wb.to_dict() for bid, wb in world.items()},
            }
        )
    return {
        "format": "animstudio.action.v1",
        "fps": fps,
        "duration": duration,
        "frameCount": frame_count,
        "skeleton": skeleton.to_dict(),
        "frames": frames,
    }
