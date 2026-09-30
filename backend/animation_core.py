from __future__ import annotations

import json
import math
from copy import deepcopy
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
                "keyframes": [
                    {"id": "wave-0", "time": 0.0, "pose": wave_start},
                    {"id": "wave-1", "time": 0.3, "pose": wave_peak},
                    {"id": "wave-2", "time": 0.6, "pose": wave_end},
                ],
            }
        ],
    }


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
    valid_transform_bones = set()
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
        if isinstance(rest, dict) and isinstance(rest.get("x"), (int, float)) and isinstance(rest.get("y"), (int, float)):
            valid_transform_bones.add(bone_id)
        else:
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

    keyframes = project.get("keyframes")
    if not isinstance(keyframes, list) or not keyframes:
        errors.append("至少需要一个关键姿态")
        return errors

    times: list[float] = []
    kf_ids: set[str] = set()
    for index, keyframe in enumerate(keyframes):
        prefix = f"第 {index + 1} 个关键姿态"
        if not isinstance(keyframe, dict):
            errors.append(f"{prefix}必须是对象")
            continue
        kf_id = keyframe.get("id")
        if not isinstance(kf_id, str) or not kf_id.strip():
            errors.append(f"{prefix}缺少有效 id")
        elif kf_id in kf_ids:
            errors.append(f"关键姿态 id 重复：{kf_id}")
        else:
            kf_ids.add(kf_id)
        time = keyframe.get("time")
        if not isinstance(time, (int, float)) or not math.isfinite(time) or time < 0:
            errors.append(f"{prefix}时间必须是非负数字")
        else:
            if isinstance(duration, (int, float)) and time > duration:
                errors.append(f"关键姿态 {kf_id} 的时间 {time} 超出动画时长")
            times.append(float(time))
        pose = keyframe.get("pose")
        if not isinstance(pose, dict):
            errors.append(f"{prefix}缺少姿态数据")
            continue
        for pose_bone_id, transform in pose.items():
            if pose_bone_id not in by_id:
                errors.append(f"关键姿态 {kf_id} 包含未知骨骼 {pose_bone_id}")
                continue
            if not isinstance(transform, dict) or not all(
                isinstance(transform.get(key), (int, float)) for key in ("x", "y", "rotation")
            ):
                errors.append(f"关键姿态 {kf_id} 中骨骼 {pose_bone_id} 的 x/y/rotation 必须是数字")
        for bone_id in by_id:
            if bone_id not in pose:
                errors.append(f"关键姿态 {kf_id} 缺少骨骼 {bone_id} 的姿态")

    if len(times) != len(set(times)):
        errors.append("关键姿态时间不能重复")

    layers = project.get("layers", [])
    if layers is None:
        layers = []
    if not isinstance(layers, list):
        errors.append("动作层必须是数组")
        return errors

    layer_ids: set[str] = set()
    for layer_index, layer in enumerate(layers):
        prefix = f"第 {layer_index + 1} 个动作层"
        if not isinstance(layer, dict):
            errors.append(f"{prefix}必须是对象")
            continue
        layer_id = layer.get("id")
        if not isinstance(layer_id, str) or not layer_id.strip():
            errors.append(f"{prefix}缺少有效 id")
        elif layer_id in layer_ids:
            errors.append(f"动作层 id 重复：{layer_id}")
        else:
            layer_ids.add(layer_id)

        for field_name in ("weight", "start", "end", "fade_in", "fade_out"):
            value = layer.get(field_name, 0.0)
            if not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0:
                errors.append(f"{prefix}的 {field_name} 必须是非负数字")
        weight = layer.get("weight", 0.0)
        if isinstance(weight, (int, float)) and weight > 1.0 + 1e-9:
            errors.append(f"{prefix}的权重不能超过 1")
        start = layer.get("start")
        end = layer.get("end")
        fade_in = layer.get("fade_in", 0.0)
        fade_out = layer.get("fade_out", 0.0)
        if isinstance(start, (int, float)) and isinstance(end, (int, float)):
            if start > end:
                errors.append(f"{prefix}的开始时间不能晚于结束时间")
            if isinstance(duration, (int, float)) and (start > duration or end > duration):
                errors.append(f"{prefix}的时间范围超出动画时长")
            active_span = end - start
            if isinstance(fade_in, (int, float)) and isinstance(fade_out, (int, float)) and fade_in + fade_out > active_span + 1e-9:
                errors.append(f"{prefix}的淡入淡出总时长不能超过作用时间范围")

        layer_bones = layer.get("bones")
        if not isinstance(layer_bones, list) or not layer_bones:
            errors.append(f"{prefix}至少选择一根作用骨骼")
        else:
            for layer_bone_id in layer_bones:
                if not isinstance(layer_bone_id, str) or layer_bone_id not in by_id:
                    errors.append(f"{prefix}引用了未知骨骼 {layer_bone_id}")
            if len(set(layer_bones)) != len(layer_bones):
                errors.append(f"{prefix}的作用骨骼不能重复")

        layer_frames = layer.get("keyframes")
        if not isinstance(layer_frames, list) or not layer_frames:
            errors.append(f"{prefix}至少需要一个关键姿态")
            continue
        layer_times: list[float] = []
        layer_kf_ids: set[str] = set()
        for frame_index, frame in enumerate(layer_frames):
            frame_prefix = f"{prefix}第 {frame_index + 1} 个关键姿态"
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
            errors.append(f"{prefix}的关键姿态时间不能重复")

    return errors


def shortest_angle_delta(start: float, end: float) -> float:
    return (end - start + 180.0) % 360.0 - 180.0


def _number(value: Any, fallback: float = 0.0) -> float:
    return float(value) if isinstance(value, (int, float)) else fallback


def ordered_keyframes(project: dict[str, Any]) -> list[dict[str, Any]]:
    return sorted(project["keyframes"], key=lambda item: float(item["time"]))


def ordered_frames(frames: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return sorted(frames, key=lambda item: float(item["time"]))


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
    return max(0.0, min(1.0, ramp)) * min(weight, 1.0)


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


def sample_local(project: dict[str, Any], time: float) -> dict[str, dict[str, float]]:
    clamped_time = min(max(float(time), 0.0), float(project["duration"]))
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
        return json.load(stream)


def save_project(path: str | Path, project: dict[str, Any]) -> None:
    project_path = Path(path)
    project_path.parent.mkdir(parents=True, exist_ok=True)
    temporary = project_path.with_suffix(".tmp")
    with temporary.open("w", encoding="utf-8") as stream:
        json.dump(project, stream, ensure_ascii=False, indent=2)
        stream.write("\n")
    temporary.replace(project_path)
