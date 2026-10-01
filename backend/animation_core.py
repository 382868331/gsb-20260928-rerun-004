from __future__ import annotations

import json
import math
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def default_project() -> dict[str, Any]:
    bones = [
        {"id": "root", "name": "骨盆", "parent": None, "rest": {"x": 0, "y": 0}},
        {"id": "spine", "name": "躯干", "parent": "root", "rest": {"x": 0, "y": -55}},
        {"id": "head", "name": "头部", "parent": "spine", "rest": {"x": 0, "y": -48}},
        {"id": "upper_arm_l", "name": "左上臂", "parent": "spine", "rest": {"x": -22, "y": -8}},
        {"id": "forearm_l", "name": "左前臂", "parent": "upper_arm_l", "rest": {"x": -48, "y": 6}},
        {"id": "upper_arm_r", "name": "右上臂", "parent": "spine", "rest": {"x": 22, "y": -8}},
        {"id": "forearm_r", "name": "右前臂", "parent": "upper_arm_r", "rest": {"x": 48, "y": 6}},
        {"id": "thigh_l", "name": "左大腿", "parent": "root", "rest": {"x": -18, "y": 48}},
        {"id": "shin_l", "name": "左小腿", "parent": "thigh_l", "rest": {"x": -4, "y": 56}},
        {"id": "thigh_r", "name": "右大腿", "parent": "root", "rest": {"x": 18, "y": 48}},
        {"id": "shin_r", "name": "右小腿", "parent": "thigh_r", "rest": {"x": 4, "y": 56}},
    ]

    def rest_pose() -> dict[str, dict[str, float]]:
        return {
            bone["id"]: {"x": float(bone["rest"]["x"]), "y": float(bone["rest"]["y"]), "rotation": 0.0}
            for bone in bones
        }

    walk_mid = rest_pose()
    walk_mid["thigh_l"]["rotation"] = 18.0
    walk_mid["thigh_r"]["rotation"] = -18.0
    walk_mid["shin_l"]["rotation"] = -12.0
    walk_mid["shin_r"]["rotation"] = 22.0
    walk_mid["spine"]["rotation"] = -3.0
    walk_end = rest_pose()
    walk_end["thigh_l"]["rotation"] = -18.0
    walk_end["thigh_r"]["rotation"] = 18.0
    walk_end["shin_l"]["rotation"] = 22.0
    walk_end["shin_r"]["rotation"] = -12.0
    walk_end["spine"]["rotation"] = 3.0

    def wave_pose(upper_rotation: float, forearm_rotation: float) -> dict[str, dict[str, float]]:
        return {
            "upper_arm_r": {"x": 22.0, "y": -8.0, "rotation": upper_rotation},
            "forearm_r": {"x": 48.0, "y": 6.0, "rotation": forearm_rotation},
        }

    wave_start = wave_pose(350.0, -35.0)
    wave_peak = wave_pose(15.0, -25.0)
    wave_end = wave_pose(355.0, -30.0)

    return {
        "name": "走路与上半身挥手分层",
        "version": 1,
        "duration": 1.2,
        "skeleton": {"bones": bones},
        "keyframes": [
            {"id": "kf-rest", "time": 0.0, "pose": rest_pose()},
            {"id": "kf-walk-mid", "time": 0.6, "pose": walk_mid},
            {"id": "kf-walk-end", "time": 1.2, "pose": walk_end},
        ],
        "layers": [
            {
                "id": "layer-wave",
                "name": "右手挥手",
                "weight": 1.0,
                "start": 0.15,
                "end": 1.05,
                "fade_in": 0.2,
                "fade_out": 0.2,
                "bones": ["upper_arm_r", "forearm_r"],
                "weight_keys": [],
                "keyframes": [
                    {"id": "wave-0", "time": 0.0, "pose": wave_start},
                    {"id": "wave-1", "time": 0.3, "pose": wave_peak},
                    {"id": "wave-2", "time": 0.6, "pose": wave_end},
                ],
            }
        ],
        "actions": [],
    }


def validate_clip(
    project: dict[str, Any],
    duration: Any = None,
    skeleton: dict[str, Any] | None = None,
    prefix: str = "",
    required_bones: set[str] | None = None,
) -> list[str]:
    """Validate a keyframes/layers container against the shared skeleton/duration."""
    if duration is None:
        duration = project.get("duration")
    if skeleton is None:
        skeleton = project.get("skeleton", {})
    errors: list[str] = []
    duration_value = duration if isinstance(duration, (int, float)) and math.isfinite(duration) and duration > 0 else 1.0
    if not isinstance(skeleton, dict):
        return [f"{prefix}缺少骨架数据"]
    bones = skeleton.get("bones")
    if not isinstance(bones, list) or not bones:
        return [f"{prefix}骨架至少需要一根骨骼"]
    by_id: dict[str, dict[str, Any]] = {}
    for bone in bones:
        if isinstance(bone, dict) and isinstance(bone.get("id"), str):
            by_id[bone["id"]] = bone

    keyframes = project.get("keyframes")
    if not isinstance(keyframes, list) or not keyframes:
        errors.append(f"{prefix}至少需要一个关键姿态")
        return errors

    times: list[float] = []
    kf_ids: set[str] = set()
    for index, keyframe in enumerate(keyframes):
        frame_prefix = f"{prefix}第 {index + 1} 个关键姿态"
        if not isinstance(keyframe, dict):
            errors.append(f"{frame_prefix}必须是对象")
            continue
        kf_id = keyframe.get("id")
        if not isinstance(kf_id, str) or not kf_id.strip():
            errors.append(f"{frame_prefix}缺少有效 id")
        elif kf_id in kf_ids:
            errors.append(f"{frame_prefix}id 重复：{kf_id}")
        else:
            kf_ids.add(kf_id)
        time = keyframe.get("time")
        if not isinstance(time, (int, float)) or not math.isfinite(time) or time < 0:
            errors.append(f"{frame_prefix}时间必须是非负数字")
        else:
            if time > duration_value:
                errors.append(f"{frame_prefix}的时间 {time} 超出动作时长")
            times.append(float(time))
        pose = keyframe.get("pose")
        if not isinstance(pose, dict):
            errors.append(f"{frame_prefix}缺少姿态数据")
            continue
        for pose_bone_id, transform in pose.items():
            if pose_bone_id not in by_id:
                errors.append(f"{frame_prefix}包含未知骨骼 {pose_bone_id}")
                continue
            if not isinstance(transform, dict) or not all(
                isinstance(transform.get(key), (int, float)) for key in ("x", "y", "rotation")
            ):
                errors.append(f"{frame_prefix}中骨骼 {pose_bone_id} 的 x/y/rotation 必须是数字")
        required = by_id if required_bones is None else (required_bones & set(by_id))
        for bone_id in required:
            if bone_id not in pose:
                errors.append(f"{frame_prefix}缺少骨骼 {bone_id} 的姿态")

    if len(times) != len(set(times)):
        errors.append(f"{prefix}关键姿态时间不能重复")

    layers = project.get("layers", [])
    if layers is None:
        layers = []
    if not isinstance(layers, list):
        errors.append(f"{prefix}动作层必须是数组")
        return errors

    layer_ids: set[str] = set()
    for layer_index, layer in enumerate(layers):
        layer_prefix = f"{prefix}第 {layer_index + 1} 个动作层"
        if not isinstance(layer, dict):
            errors.append(f"{layer_prefix}必须是对象")
            continue
        layer_id = layer.get("id")
        if not isinstance(layer_id, str) or not layer_id.strip():
            errors.append(f"{layer_prefix}缺少有效 id")
        elif layer_id in layer_ids:
            errors.append(f"{layer_prefix}id 重复：{layer_id}")
        else:
            layer_ids.add(layer_id)

        for field_name in ("weight", "start", "end", "fade_in", "fade_out"):
            value = layer.get(field_name, 0.0)
            if not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0:
                errors.append(f"{layer_prefix}的 {field_name} 必须是非负数字")
        weight = layer.get("weight", 0.0)
        if isinstance(weight, (int, float)) and weight > 1.0 + 1e-9:
            errors.append(f"{layer_prefix}的权重不能超过 1")
        start = layer.get("start")
        end = layer.get("end")
        fade_in = layer.get("fade_in", 0.0)
        fade_out = layer.get("fade_out", 0.0)
        if isinstance(start, (int, float)) and isinstance(end, (int, float)):
            if start > end:
                errors.append(f"{layer_prefix}的开始时间不能晚于结束时间")
            if start > duration_value or end > duration_value:
                errors.append(f"{layer_prefix}的时间范围超出动作时长")
            active_span = end - start
            if isinstance(fade_in, (int, float)) and isinstance(fade_out, (int, float)) and fade_in + fade_out > active_span + 1e-9:
                errors.append(f"{layer_prefix}的淡入淡出总时长不能超过作用时间范围")

        weight_keys = layer.get("weight_keys", [])
        if weight_keys is None:
            weight_keys = []
        if not isinstance(weight_keys, list):
            errors.append(f"{layer_prefix}的权重关键帧必须是数组")
        else:
            last_weight_time: float | None = None
            for weight_index, weight_key in enumerate(weight_keys):
                key_prefix = f"{layer_prefix}第 {weight_index + 1} 个权重关键帧"
                if not isinstance(weight_key, dict):
                    errors.append(f"{key_prefix}必须是对象")
                    continue
                key_time = weight_key.get("time")
                key_weight = weight_key.get("weight")
                if not isinstance(key_time, (int, float)) or not math.isfinite(key_time) or key_time < 0 or key_time > duration_value:
                    errors.append(f"{key_prefix}的时间必须在动作时长内")
                if not isinstance(key_weight, (int, float)) or not math.isfinite(key_weight) or key_weight < 0 or key_weight > 1.0 + 1e-9:
                    errors.append(f"{key_prefix}的权重必须在 0~1 之间")
                if isinstance(key_time, (int, float)):
                    if last_weight_time is not None and key_time <= last_weight_time:
                        errors.append(f"{layer_prefix}的权重关键帧时间必须严格递增")
                    last_weight_time = float(key_time)

        layer_bones = layer.get("bones")
        if not isinstance(layer_bones, list) or not layer_bones:
            errors.append(f"{layer_prefix}至少选择一根作用骨骼")
        else:
            for layer_bone_id in layer_bones:
                if not isinstance(layer_bone_id, str) or layer_bone_id not in by_id:
                    errors.append(f"{layer_prefix}引用了未知骨骼 {layer_bone_id}")
            if len(set(layer_bones)) != len(layer_bones):
                errors.append(f"{layer_prefix}的作用骨骼不能重复")

        layer_frames = layer.get("keyframes")
        if not isinstance(layer_frames, list) or not layer_frames:
            errors.append(f"{layer_prefix}至少需要一个关键姿态")
            continue
        layer_times: list[float] = []
        layer_kf_ids: set[str] = set()
        for frame_index, frame in enumerate(layer_frames):
            frame_prefix = f"{layer_prefix}第 {frame_index + 1} 个关键姿态"
            if not isinstance(frame, dict):
                errors.append(f"{frame_prefix}必须是对象")
                continue
            frame_id = frame.get("id")
            if not isinstance(frame_id, str) or not frame_id.strip():
                errors.append(f"{frame_prefix}缺少有效 id")
            elif frame_id in layer_kf_ids:
                errors.append(f"{frame_prefix}id 重复：{frame_id}")
            else:
                layer_kf_ids.add(frame_id)
            frame_time = frame.get("time")
            if not isinstance(frame_time, (int, float)) or not math.isfinite(frame_time) or frame_time < 0:
                errors.append(f"{frame_prefix}时间必须是非负数字")
            else:
                layer_times.append(float(frame_time))
            pose = frame.get("pose")
            if not isinstance(pose, dict):
                errors.append(f"{frame_prefix}缺少姿态数据")
                continue
            allowed_bones = set(layer_bones) if isinstance(layer_bones, list) else set()
            for pose_bone_id, transform in pose.items():
                if pose_bone_id not in allowed_bones:
                    errors.append(f"{frame_prefix}包含非作用骨骼 {pose_bone_id}")
                    continue
                if not isinstance(transform, dict) or not all(
                    isinstance(transform.get(key), (int, float)) for key in ("x", "y", "rotation")
                ):
                    errors.append(f"{frame_prefix}中骨骼 {pose_bone_id} 的 x/y/rotation 必须是数字")
            for bone_id in allowed_bones:
                if bone_id in by_id and bone_id not in pose:
                    errors.append(f"{frame_prefix}缺少作用骨骼 {bone_id} 的姿态")
        if len(layer_times) != len(set(layer_times)):
            errors.append(f"{layer_prefix}的关键姿态时间不能重复")

    return errors


def validate_project(project: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    if not isinstance(project, dict):
        return ["工程必须是 JSON 对象"]

    duration = project.get("duration")
    if not isinstance(duration, (int, float)) or not math.isfinite(duration) or duration <= 0:
        errors.append("动画时长必须是正数")

    skeleton = project.get("skeleton", {})
    bones = skeleton.get("bones") if isinstance(skeleton, dict) else None
    if not isinstance(bones, list) or not bones:
        return errors + ["骨架至少需要一根骨骼"]

    by_id: dict[str, dict[str, Any]] = {}
    roots: list[str] = []
    for index, bone in enumerate(bones):
        prefix = f"第 {index + 1} 根骨骼"
        if not isinstance(bone, dict):
            errors.append(f"{prefix}必须是对象")
            continue
        bone_id = bone.get("id")
        if not isinstance(bone_id, str) or not bone_id.strip():
            errors.append(f"{prefix}缺少有效 id")
            continue
        if bone_id in by_id:
            errors.append(f"骨骼 id 重复：{bone_id}")
            continue
        by_id[bone_id] = bone
        parent = bone.get("parent")
        if parent is None:
            roots.append(bone_id)
        elif not isinstance(parent, str):
            errors.append(f"骨骼 {bone_id} 的 parent 必须是字符串或 null")
        rest = bone.get("rest", {})
        if not (isinstance(rest, dict) and isinstance(rest.get("x"), (int, float)) and isinstance(rest.get("y"), (int, float))):
            errors.append(f"骨骼 {bone_id} 的 rest.x/rest.y 必须是数字")

    if len(roots) != 1:
        errors.append(f"骨架必须恰好有一个根节点，当前有 {len(roots)} 个")

    for bone_id, bone in by_id.items():
        parent = bone.get("parent")
        if isinstance(parent, str) and parent not in by_id:
            errors.append(f"骨骼 {bone_id} 引用了不存在的父骨骼 {parent}")
        elif parent == bone_id:
            errors.append(f"骨骼 {bone_id} 不能把自己设为父骨骼")

    for bone_id in by_id:
        seen: set[str] = set()
        current = by_id[bone_id].get("parent")
        while isinstance(current, str):
            if current == bone_id or current in seen:
                errors.append(f"骨骼层级存在循环：{bone_id}")
                break
            seen.add(current)
            current = by_id.get(current, {}).get("parent") if current in by_id else None

    version = project.get("version", 1)
    if not isinstance(version, int) or version < 1:
        errors.append("工程版本号必须是正整数")

    errors.extend(validate_clip(project, duration, skeleton))

    actions = project.get("actions", [])
    if actions is None:
        actions = []
    if not isinstance(actions, list):
        errors.append("整理动作必须是数组")
        return errors

    action_ids: set[str] = set()
    for action_index, action in enumerate(actions):
        prefix = f"第 {action_index + 1} 个整理动作"
        if not isinstance(action, dict):
            errors.append(f"{prefix}必须是对象")
            continue
        action_id = action.get("id")
        if not isinstance(action_id, str) or not action_id.strip():
            errors.append(f"{prefix}缺少有效 id")
        elif action_id in action_ids:
            errors.append(f"{prefix}id 重复：{action_id}")
        else:
            action_ids.add(action_id)
        action_duration = action.get("duration")
        if not isinstance(action_duration, (int, float)) or not math.isfinite(action_duration) or action_duration <= 0:
            errors.append(f"{prefix}的时长必须是正数")
            continue
        source = action.get("source")
        if not isinstance(source, dict):
            errors.append(f"{prefix}缺少来源溯源信息")
        else:
            if not isinstance(source.get("action_id"), str) or not source["action_id"].strip():
                errors.append(f"{prefix}缺少来源动作 id（源工程为 __main__）")
            source_version = source.get("source_version")
            if not isinstance(source_version, int) or source_version < 1:
                errors.append(f"{prefix}缺少来源版本号")
            if not isinstance(source.get("range_start"), (int, float)) or not isinstance(source.get("range_end"), (int, float)):
                errors.append(f"{prefix}缺少整理时间范围")
            elif source["range_end"] <= source["range_start"]:
                errors.append(f"{prefix}的整理时间范围无效")
            if not isinstance(source.get("bones"), list) or not source["bones"]:
                errors.append(f"{prefix}缺少整理骨骼范围")
            elif any(not isinstance(item, str) or item not in by_id for item in source["bones"]):
                errors.append(f"{prefix}的整理骨骼范围包含未知骨骼")
        source_bones = set(source.get("bones", [])) if isinstance(source, dict) else None
        errors.extend(validate_clip(
            action, action_duration, skeleton,
            prefix=prefix + "内", required_bones=source_bones,
        ))

    return errors


def shortest_angle_delta(start: float, end: float) -> float:
    return (end - start + 180.0) % 360.0 - 180.0


def _number(value: Any, fallback: float = 0.0) -> float:
    return float(value) if isinstance(value, (int, float)) else fallback


def ordered_keyframes(project: dict[str, Any]) -> list[dict[str, Any]]:
    return sorted(project["keyframes"], key=lambda item: float(item["time"]))


def ordered_frames(frames: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return sorted(frames, key=lambda item: float(item["time"]))


def weight_key_multiplier(layer: dict[str, Any], time: float) -> float:
    """Animated weight multiplier from weight keys; keys can be adjusted in either direction."""
    weight_keys = layer.get("weight_keys") or []
    if not weight_keys:
        return 1.0
    ordered = sorted(weight_keys, key=lambda item: float(item["time"]))
    if time <= float(ordered[0]["time"]):
        return max(0.0, min(1.0, _number(ordered[0].get("weight"))))
    if time >= float(ordered[-1]["time"]):
        return max(0.0, min(1.0, _number(ordered[-1].get("weight"))))
    for left, right in zip(ordered, ordered[1:]):
        left_time = float(left["time"])
        right_time = float(right["time"])
        if left_time <= time <= right_time:
            span = right_time - left_time
            alpha = 0.0 if span == 0.0 else (time - left_time) / span
            value = _number(left.get("weight")) + (_number(right.get("weight")) - _number(left.get("weight"))) * alpha
            return max(0.0, min(1.0, value))
    return 1.0


def layer_envelope(layer: dict[str, Any], time: float) -> float:
    weight = _number(layer.get("weight"))
    if weight <= 0.0:
        return 0.0
    start = _number(layer.get("start"))
    end = _number(layer.get("end"))
    fade_in = max(0.0, _number(layer.get("fade_in")))
    fade_out = max(0.0, _number(layer.get("fade_out")))
    if time < start or time > end:
        return 0.0
    if fade_in > 0.0 and time < start + fade_in:
        ramp = (time - start) / fade_in
    elif fade_out > 0.0 and time > end - fade_out:
        ramp = (end - time) / fade_out
    else:
        ramp = 1.0
    ramp = max(0.0, min(1.0, ramp))
    return ramp * min(weight, 1.0) * weight_key_multiplier(layer, time)


def blend_transform(base: dict[str, float], overlay: dict[str, float], weight: float) -> dict[str, float]:
    if weight <= 0.0:
        return {"x": float(base["x"]), "y": float(base["y"]), "rotation": float(base["rotation"])}
    if weight >= 1.0:
        return {"x": float(overlay["x"]), "y": float(overlay["y"]), "rotation": float(overlay["rotation"])}
    return {
        "x": base["x"] + (overlay["x"] - base["x"]) * weight,
        "y": base["y"] + (overlay["y"] - base["y"]) * weight,
        "rotation": base["rotation"] + shortest_angle_delta(base["rotation"], overlay["rotation"]) * weight,
    }


def sample_frames(frames: list[dict[str, Any]], time: float) -> dict[str, dict[str, float]]:
    ordered = ordered_frames(frames)
    clamped_time = float(time)
    if clamped_time <= float(ordered[0]["time"]):
        return deepcopy(ordered[0]["pose"])
    if clamped_time >= float(ordered[-1]["time"]):
        return deepcopy(ordered[-1]["pose"])

    left, right = ordered[0], ordered[-1]
    for candidate in zip(ordered, ordered[1:]):
        if float(candidate[0]["time"]) <= clamped_time <= float(candidate[1]["time"]):
            left, right = candidate
            break

    span = float(right["time"]) - float(left["time"])
    alpha = 0.0 if span == 0 else (clamped_time - float(left["time"])) / span
    result: dict[str, dict[str, float]] = {}
    for bone_id in left["pose"]:
        a = left["pose"][bone_id]
        b = right["pose"].get(bone_id, a)
        result[bone_id] = {
            "x": _number(a.get("x")) + (_number(b.get("x")) - _number(a.get("x"))) * alpha,
            "y": _number(a.get("y")) + (_number(b.get("y")) - _number(a.get("y"))) * alpha,
            "rotation": _number(a.get("rotation")) + shortest_angle_delta(_number(a.get("rotation")), _number(b.get("rotation"))) * alpha,
        }
    return result


def bone_order(project: dict[str, Any]) -> list[str]:
    bones = project["skeleton"]["bones"]
    by_id = {bone["id"]: bone for bone in bones}
    result: list[str] = []
    visiting: set[str] = set()

    def visit(bone_id: str) -> None:
        if bone_id in result or bone_id in visiting:
            return
        visiting.add(bone_id)
        parent = by_id[bone_id].get("parent")
        if isinstance(parent, str) and parent in by_id:
            visit(parent)
        visiting.remove(bone_id)
        result.append(bone_id)

    for bone in bones:
        visit(bone["id"])
    return result


def bake_action(
    project: dict[str, Any],
    range_start: float,
    range_end: float,
    bone_ids: list[str],
    name: str,
    action_id: str | None = None,
    fps: float = 60.0,
    tolerance: float = 1e-7,
) -> dict[str, Any]:
    """Collapse a layered time/bone range into one editable flat action.

    Raises ValueError with a list of human-readable reasons if anything in the
    request cannot be fully processed; the project is never partially modified.
    """
    problems: list[str] = []
    if not isinstance(range_start, (int, float)) or not isinstance(range_end, (int, float)):
        problems.append("整理时间范围必须是数字")
    elif range_start < 0 or range_end > float(project["duration"]) or range_end <= range_start:
        problems.append(f"整理时间范围 {range_start:g}~{range_end:g}s 无效或超出工程时长 {float(project['duration']):g}s")
    known_bones = {bone["id"] for bone in project["skeleton"]["bones"]}
    selected_bones = [bone_id for bone_id in dict.fromkeys(bone_ids) if isinstance(bone_id, str)]
    missing = [bone_id for bone_id in selected_bones if bone_id not in known_bones]
    if missing:
        problems.append("缺失骨骼，未处理：" + "、".join(missing))
    if not selected_bones or not [bone_id for bone_id in selected_bones if bone_id in known_bones]:
        problems.append("骨骼范围为空，无法整理")

    validation_errors = validate_project(project)
    if validation_errors:
        problems.extend(f"工程存在未解决冲突：{error}" for error in validation_errors)
    if problems:
        raise ValueError("；".join(problems))

    incompatible = _range_incompatibility_notes(project, range_start, range_end, selected_bones)
    if incompatible:
        raise ValueError("；".join(incompatible))

    span = float(range_end) - float(range_start)
    count = int(round(span * float(fps))) + 1
    sample_times = [
        round(float(range_start) + min(index / float(fps), span), 9)
        for index in range(count)
    ]
    keyframes: list[dict[str, Any]] = []
    previous: dict[str, dict[str, float]] | None = None
    frame_keyframes: list[dict[str, Any]] = []
    for sample_time in sample_times:
        pose = sample_local(project, sample_time)
        frame_index = len(keyframes)
        selected_pose = {
            bone_id: {
                "x": round(float(pose[bone_id]["x"]), 9),
                "y": round(float(pose[bone_id]["y"]), 9),
                "rotation": round(float(pose[bone_id]["rotation"]), 9),
            }
            for bone_id in selected_bones
        }
        # Drop only an exact duplicate of the previous pose; curved motion needs
        # every sample so linear playback reproduces the composed source pose.
        if previous is not None and _pose_close(previous, selected_pose, tolerance) \
                and len(keyframes) >= 2:
            keyframes[-1]["time"] = round(sample_time - float(range_start), 9)
        else:
            new_frame = {
                "id": f"{action_id or 'baked'}-kf-{frame_index}",
                "time": round(sample_time - float(range_start), 9),
                "pose": selected_pose,
                "origin": "baked",
                "baked_version": int(project.get("version", 1)),
                "manual_bones": [],
                "repairs": [],
            }
            keyframes.append(new_frame)
        previous = selected_pose
        frame_keyframes.append(keyframes[-1])
    keyframes[-1]["time"] = span

    # Frame-accurate verification at every baked sample (playback steps by fps,
    # so intermediate interpolation is never used for repeated playback).
    for verify_index, verify_time in enumerate(sample_times):
        source_pose = sample_local(project, verify_time)
        baked_pose = frame_keyframes[verify_index]["pose"]
        for bone_id in selected_bones:
            a = source_pose[bone_id]
            b = baked_pose[bone_id]
            if not _transforms_close(a, b, tolerance=1e-9):
                raise ValueError(f"整理结果在 {verify_time:g}s 的骨骼 {bone_id} 与原工程姿态不一致，已放弃整理")

    existing_ids = {item.get("id") for item in project.get("actions", []) if isinstance(item, dict)}
    new_id = action_id
    if not new_id:
        candidate_index = len(existing_ids) + 1
        new_id = f"action-{candidate_index}-{int(range_start * 1000)}-{int(range_end * 1000)}"
        while new_id in existing_ids:
            candidate_index += 1
            new_id = f"action-{candidate_index}-{int(range_start * 1000)}-{int(range_end * 1000)}"
    source_version = int(project.get("version", 1))
    action = {
        "id": new_id,
        "name": name or f"整理动作 {range_start:g}~{range_end:g}s",
        "duration": span,
        "keyframes": keyframes,
        "layers": [],
        "source": {
            "action_id": "__main__",
            "source_version": source_version,
            "range_start": float(range_start),
            "range_end": float(range_end),
            "bones": list(selected_bones),
            "fps": float(fps),
            "baked_version": source_version,
            "created_at": _utc_now_iso(),
        },
    }
    return action


def _utc_now_iso() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _manual_bones(frame: dict[str, Any]) -> set[str]:
    """Bones whose pose on this baked frame was hand-edited after baking."""
    manual = frame.get("manual_bones")
    if isinstance(manual, list):
        return {bone_id for bone_id in manual if isinstance(bone_id, str)}
    if frame.get("origin") == "manual":
        return set(frame.get("pose", {}).keys())
    return set()


def mark_frame_manual(frame: dict[str, Any], bone_ids: list[str] | set[str] | None = None) -> dict[str, Any]:
    """Flag baked-frame bones as manually repaired; returns the mutated frame."""
    pose = frame.get("pose", {}) if isinstance(frame, dict) else {}
    manual = _manual_bones(frame)
    if bone_ids is None:
        bone_ids = list(pose.keys())
    manual.update(bone_id for bone_id in bone_ids if bone_id in pose)
    if manual:
        frame["origin"] = "manual"
        frame["manual_bones"] = sorted(manual)
    return frame


def _transforms_close(a: dict[str, float], b: dict[str, float], tolerance: float = 1e-7) -> bool:
    return (
        abs(float(a["x"]) - float(b["x"])) <= tolerance
        and abs(float(a["y"]) - float(b["y"])) <= tolerance
        and abs(shortest_angle_delta(float(a.get("rotation", 0.0)), float(b.get("rotation", 0.0)))) <= tolerance
    )


def _pose_close(a: dict[str, dict[str, float]], b: dict[str, dict[str, float]], tolerance: float) -> bool:
    if set(a) != set(b):
        return False
    for bone_id in a:
        if abs(a[bone_id]["x"] - b[bone_id]["x"]) > tolerance:
            return False
        if abs(a[bone_id]["y"] - b[bone_id]["y"]) > tolerance:
            return False
        if abs(shortest_angle_delta(a[bone_id]["rotation"], b[bone_id]["rotation"])) > tolerance:
            return False
    return True


def _range_incompatibility_notes(
    project: dict[str, Any],
    range_start: float,
    range_end: float,
    selected_bones: list[str],
) -> list[str]:
    """Explain content that overlaps the range but cannot be baked as requested."""
    notes: list[str] = []
    selected = set(selected_bones)
    for layer in project.get("layers", []) or []:
        layer_start = _number(layer.get("start"))
        layer_end = _number(layer.get("end"))
        overlaps = min(layer_end, float(range_end)) - max(layer_start, float(range_start))
        if overlaps <= 1e-9:
            continue
        layer_bone_set = set(layer.get("bones", []))
        covered = layer_bone_set & selected
        uncovered = layer_bone_set - selected
        partial = bool(covered and uncovered)
        if partial:
            notes.append(
                f"层「{layer.get('name', layer.get('id'))}」在范围内只选择了部分作用骨骼，已覆盖 "
                + "、".join(sorted(uncovered)) + "，未处理"
            )
    return notes


def sample_local(project: dict[str, Any], time: float) -> dict[str, dict[str, float]]:
    duration = float(project.get("duration", 0.0))
    clamped_time = min(max(float(time), 0.0), duration)
    result = sample_frames(project["keyframes"], clamped_time)
    layers = project.get("layers") or []
    for layer in layers:
        weight = layer_envelope(layer, clamped_time)
        if weight <= 0.0:
            continue
        overlay = sample_frames(layer["keyframes"], clamped_time)
        for bone_id in layer.get("bones", []):
            if bone_id in result and bone_id in overlay:
                result[bone_id] = blend_transform(result[bone_id], overlay[bone_id], weight)
    return result


def _action_by_id(project: dict[str, Any], action_id: str) -> dict[str, Any]:
    for action in project.get("actions", []) or []:
        if action.get("id") == action_id:
            return action
    raise ValueError(f"找不到整理动作 {action_id}")


def _segment_keyframes(action: dict[str, Any], gap: float) -> list[list[dict[str, Any]]]:
    """Group consecutive ordered frames (gap <= one sample period) into segments."""
    segments: list[list[dict[str, Any]]] = []
    for frame in sorted(action.get("keyframes", []), key=lambda item: float(item["time"])):
        if segments and float(frame["time"]) - float(segments[-1][-1]["time"]) <= gap + 1e-7:
            segments[-1].append(frame)
        else:
            segments.append([frame])
    return segments


def rework_analysis(
    project: dict[str, Any],
    action_id: str,
    tolerance: float = 1e-6,
) -> dict[str, Any]:
    """Report which times/bones of a baked action drift from the current source.

    Source revisions, baked output and manual repairs are distinguished per
    frame via ``origin`` / ``baked_version`` / ``manual_bones``.
    """
    action = _action_by_id(project, action_id)
    source = action.get("source")
    if not isinstance(source, dict):
        raise ValueError("整理动作缺少来源溯源信息")
    source_version = int(project.get("version", 1))
    baked_version = int(source.get("baked_version", source.get("source_version", source_version)))
    fps = float(source.get("fps", 60.0))
    range_start = float(source["range_start"])
    bone_scope = [bone_id for bone_id in source.get("bones", []) if bone_id in {b["id"] for b in project["skeleton"]["bones"]}]
    gap = 2.5 / max(fps, 1e-6)

    affected_frames: list[dict[str, Any]] = []
    for frame in action.get("keyframes", []):
        source_time = range_start + float(frame["time"])
        source_pose = sample_local(project, source_time)
        changed: list[str] = []
        manual = sorted(_manual_bones(frame))
        for bone_id in bone_scope:
            current = frame.get("pose", {}).get(bone_id)
            expected = source_pose.get(bone_id)
            if current is None or expected is None:
                continue
            if not _transforms_close(current, expected, tolerance=tolerance):
                changed.append(bone_id)
        if changed:
            affected_frames.append({
                "id": frame.get("id"),
                "time": round(float(frame["time"]), 9),
                "source_time": round(source_time, 9),
                "changed_bones": sorted(changed),
                "manual_bones": manual,
                "has_manual": bool(manual),
            })

    affected_ids = {item["id"] for item in affected_frames}
    segments: list[dict[str, Any]] = []
    for group in _segment_keyframes(action, gap):
        hit = [frame for frame in group if frame.get("id") in affected_ids]
        if not hit:
            continue
        manual_frames = [frame for frame in hit if _manual_bones(frame)]
        segments.append({
            "id": f"seg-{len(segments) + 1}",
            "start": round(float(group[0]["time"]), 9),
            "end": round(float(group[-1]["time"]), 9),
            "frame_ids": [frame.get("id") for frame in hit],
            "bones": sorted({bone_id for frame in hit for bone_id in next(
                item["changed_bones"] for item in affected_frames if item["id"] == frame.get("id"))}),
            "manual_frame_ids": [frame.get("id") for frame in manual_frames],
            "has_manual": bool(manual_frames),
        })

    return {
        "action_id": action_id,
        "source_version": source_version,
        "baked_version": baked_version,
        "outdated": source_version != baked_version,
        "affected_frames": affected_frames,
        "segments": segments,
    }


def _verify_rework_seams(action: dict[str, Any], updated_frames: set[str], tolerance: float = 1e-6) -> None:
    """Adjacent source-adopted rework ranges must keep a continuous seam pose.

    Frames whose manual result the user explicitly keeps are not part of the
    continuity check: their discontinuity was authored deliberately.
    """
    ordered = sorted(action.get("keyframes", []), key=lambda item: float(item["time"]))
    gap = 2.5 / float(action.get("source", {}).get("fps", 60.0))
    for left, right in zip(ordered, ordered[1:]):
        span = float(right["time"]) - float(left["time"])
        if span <= 0.0:
            raise ValueError("返修结果出现重复时间关键帧，已放弃")
        if span > gap + 1e-7 or left.get("id") not in updated_frames or right.get("id") not in updated_frames:
            continue
        for bone_id, left_transform in left.get("pose", {}).items():
            right_transform = right.get("pose", {}).get(bone_id)
            if right_transform is None:
                continue
            rotation_step = abs(shortest_angle_delta(float(left_transform.get("rotation", 0.0)),
                                                     float(right_transform.get("rotation", 0.0))))
            if rotation_step > 30.0 + 1e-9:
                raise ValueError(
                    f"返修区间衔接处在 {float(left['time']):g}s 的骨骼 {bone_id} 姿态不连续"
                    f"（单帧旋转 {rotation_step:g}°），已放弃"
                )


def apply_rework(
    project: dict[str, Any],
    action_id: str,
    segment_ids: list[str] | None = None,
    decisions: dict[str, str] | None = None,
    tolerance: float = 1e-6,
) -> dict[str, Any]:
    """Re-sample chosen affected segments from the current source project.

    ``decisions`` maps frame id -> "keep" (keep manual result) or "source"
    (re-adopt the source pose).  Default is "source" for untouched frames and
    "keep" for frames containing manual repairs; manual work is never silently
    overwritten.
    The source project itself is never modified.
    """
    analysis = rework_analysis(project, action_id, tolerance=tolerance)
    action = _action_by_id(project, action_id)
    source = action["source"]
    if analysis["segments"] and not analysis["segments"][0].get("frame_ids"):
        raise ValueError("返修区间无效，已放弃")
    chosen = set(segment_ids) if segment_ids is not None else {item["id"] for item in analysis["segments"]}
    frame_decisions = decisions or {}
    frame_by_id = {frame.get("id"): frame for frame in action.get("keyframes", [])}

    validation_errors = validate_project(project)
    if validation_errors:
        raise ValueError("；".join(f"工程存在未解决冲突：{error}" for error in validation_errors))

    snapshot = deepcopy(action)
    source_version = int(project.get("version", 1))
    range_start = float(source["range_start"])
    updated_frames: list[str] = []
    kept_manual_frames: list[str] = []
    frame_snapshots: dict[str, dict[str, Any]] = {}
    repair_seq = len(action.get("rework_history", [])) + 1
    repair_id = f"repair-{repair_seq}-v{source_version}-{datetime.now(timezone.utc).strftime('%H%M%S%f')}"

    for segment in analysis["segments"]:
        if segment["id"] not in chosen:
            continue
        for frame_id in segment["frame_ids"]:
            frame = frame_by_id.get(frame_id)
            if frame is None:
                continue
            decision = frame_decisions.get(frame_id)
            if decision not in ("keep", "source"):
                decision = "keep" if frame_id in set(segment.get("manual_frame_ids", [])) else "source"
            if decision == "keep":
                if _manual_bones(frame):
                    kept_manual_frames.append(frame_id)
                continue
            source_pose = sample_local(project, range_start + float(frame["time"]))
            frame_snapshots[frame_id] = {
                "pose": deepcopy(frame.get("pose")),
                "baked_version": frame.get("baked_version"),
                "manual_bones": deepcopy(frame.get("manual_bones", [])),
                "origin": frame.get("origin", "baked"),
                "repairs": deepcopy(frame.get("repairs", [])),
            }
            for bone_id in segment["bones"]:
                if bone_id in source_pose and bone_id in frame.get("pose", {}):
                    frame["pose"][bone_id] = {
                        "x": float(source_pose[bone_id]["x"]),
                        "y": float(source_pose[bone_id]["y"]),
                        "rotation": float(source_pose[bone_id]["rotation"]),
                    }
            remaining_manual = _manual_bones(frame) - set(segment["bones"])
            frame["manual_bones"] = sorted(remaining_manual)
            frame["origin"] = "manual" if remaining_manual else "baked"
            frame["baked_version"] = source_version
            frame.setdefault("repairs", []).append({
                "id": repair_id,
                "segment": segment["id"],
                "source_version": source_version,
                "decided": "source",
                "bones": list(segment["bones"]),
                "at": _utc_now_iso(),
            })
            updated_frames.append(frame_id)

    if not updated_frames and not kept_manual_frames:
        raise ValueError("没有选择需要返修的区间，工程未改动")

    try:
        _verify_rework_seams(action, set(updated_frames), tolerance=tolerance)
    except ValueError:
        action["keyframes"] = snapshot["keyframes"]
        raise

    archived: list[str] = []
    actions = project.setdefault("actions", [])
    already_archived = {
        item.get("source", {}).get("archive_of")
        for item in actions if isinstance(item, dict) and isinstance(item.get("source"), dict)
    }
    previous_version = int(source.get("baked_version", source.get("source_version", source_version)))
    if previous_version != source_version and action_id not in already_archived:
        archive = deepcopy(snapshot)
        archive["id"] = f"{action_id}-v{previous_version}"
        archive["name"] = f"{snapshot.get('name', action_id)}（v{previous_version} 旧版）"
        archive.setdefault("source", {})["archive_of"] = action_id
        archive["source"]["archived_for_version"] = source_version
        archive["source"]["baked_version"] = previous_version
        archive["readonly"] = True
        actions.append(archive)
        archived.append(archive["id"])

    source["baked_version"] = source_version
    source["last_rework_at"] = _utc_now_iso()
    action.setdefault("rework_history", []).append({
        "id": repair_id,
        "seq": repair_seq,
        "source_version": source_version,
        "updated_frames": updated_frames,
        "kept_manual_frames": kept_manual_frames,
        "segments": sorted(chosen),
        "frame_snapshots": frame_snapshots,
        "snapshot_id": archived[0] if archived else None,
        "at": _utc_now_iso(),
    })

    verification = validate_project(project)
    if verification:
        raise ValueError("；".join(f"返修后校验失败，已保留分层工程：{error}" for error in verification))

    return {
        "action": action,
        "analysis": analysis,
        "updated_frames": updated_frames,
        "kept_manual_frames": kept_manual_frames,
        "archived_action_id": archived[0] if archived else None,
    }


def revert_rework(project: dict[str, Any], action_id: str, repair_id: str) -> dict[str, Any]:
    """Undo one confirmed rework decision without touching other decisions."""
    action = _action_by_id(project, action_id)
    history = [entry for entry in action.get("rework_history", []) if entry.get("id") == repair_id]
    if not history:
        raise ValueError("找不到可撤回的返修记录")
    for entry in history:
        later_frame_ids = {
            frame_id
            for later_entry in action.get("rework_history", [])
            if later_entry.get("seq", 0) > entry.get("seq", 0)
            for frame_id in (later_entry.get("updated_frames", []) + later_entry.get("kept_manual_frames", []))
        }
        for frame_id, old_data in entry.get("frame_snapshots", {}).items():
            current = next((frame for frame in action.get("keyframes", []) if frame.get("id") == frame_id), None)
            if current is None:
                continue
            if frame_id in later_frame_ids:
                continue
            current["pose"] = deepcopy(old_data["pose"])
            current["baked_version"] = old_data.get("baked_version")
            current["manual_bones"] = deepcopy(old_data.get("manual_bones", []))
            current["origin"] = old_data.get("origin", "baked")
            current["repairs"] = [item for item in current.get("repairs", []) if item.get("id") != repair_id]
    action["rework_history"] = [entry for entry in action.get("rework_history", []) if entry.get("id") != repair_id]
    errors = validate_project(project)
    if errors:
        raise ValueError("撤回后校验失败：" + "；".join(errors))
    return {"action": action, "reverted": repair_id}



def evaluate_world(project: dict[str, Any], time: float) -> dict[str, dict[str, float]]:
    local_pose = sample_local(project, time)
    by_id = {bone["id"]: bone for bone in project["skeleton"]["bones"]}
    world: dict[str, dict[str, float]] = {}
    for bone_id in bone_order(project):
        local = local_pose[bone_id]
        parent = by_id[bone_id].get("parent")
        if parent is None:
            world[bone_id] = {"x": float(local["x"]), "y": float(local["y"]), "rotation": float(local["rotation"])}
        else:
            parent_world = world[parent]
            angle = math.radians(parent_world["rotation"])
            x = float(local["x"])
            y = float(local["y"])
            world[bone_id] = {
                "x": parent_world["x"] + x * math.cos(angle) - y * math.sin(angle),
                "y": parent_world["y"] + x * math.sin(angle) + y * math.cos(angle),
                "rotation": parent_world["rotation"] + float(local["rotation"]),
            }
    return world


def export_action(project: dict[str, Any], fps: float = 24.0) -> dict[str, Any]:
    if not isinstance(fps, (int, float)) or fps <= 0:
        raise ValueError("fps 必须是正数")
    duration = float(project["duration"])
    count = int(round(duration * float(fps))) + 1
    frames = []
    for index in range(count):
        time = min(index / float(fps), duration)
        frames.append({"time": time, "local": sample_local(project, time), "world": evaluate_world(project, time)})
    return {
        "name": project.get("name", "未命名动作"),
        "duration": duration,
        "fps": float(fps),
        "frames": frames,
    }


def load_project(path: str | Path) -> dict[str, Any]:
    project_path = Path(path)
    if not project_path.exists():
        project = default_project()
        save_project(project_path, project)
        return project
    with project_path.open("r", encoding="utf-8") as stream:
        project = json.load(stream)
    return migrate_project(project)


def migrate_project(project: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(project, dict):
        return project
    project.setdefault("version", 1)
    project.setdefault("actions", [])
    for layer in project.get("layers", []) or []:
        if isinstance(layer, dict):
            layer.setdefault("weight_keys", [])
    for action in project.get("actions", []) or []:
        if not isinstance(action, dict):
            continue
        source = action.setdefault("source", {})
        source.setdefault("baked_version", source.get("source_version", project.get("version", 1)))
        action.setdefault("rework_history", [])
        for frame in action.get("keyframes", []) or []:
            if not isinstance(frame, dict):
                continue
            frame.setdefault("origin", "baked")
            frame.setdefault("baked_version", source["baked_version"])
            frame.setdefault("manual_bones", [])
            frame.setdefault("repairs", [])
    return project


def save_project(path: str | Path, project: dict[str, Any]) -> None:
    project_path = Path(path)
    project_path.parent.mkdir(parents=True, exist_ok=True)
    temporary = project_path.with_suffix(".tmp")
    with temporary.open("w", encoding="utf-8") as stream:
        json.dump(project, stream, ensure_ascii=False, indent=2)
        stream.write("\n")
    temporary.replace(project_path)
