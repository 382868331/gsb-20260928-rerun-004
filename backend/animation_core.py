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

    walk_start = rest_pose()
    walk_start["thigh_l"]["rotation"] = -18.0
    walk_start["thigh_r"]["rotation"] = 18.0
    walk_mid = rest_pose()
    walk_mid["thigh_l"]["rotation"] = 18.0
    walk_mid["thigh_r"]["rotation"] = -18.0
    walk_end = rest_pose()
    walk_end["thigh_l"]["rotation"] = -18.0
    walk_end["thigh_r"]["rotation"] = 18.0
    walk_end["spine"]["rotation"] = -2.0

    wave_ready = rest_pose()
    wave_up = rest_pose()
    wave_up["upper_arm_r"]["rotation"] = 350.0
    wave_up["forearm_r"]["rotation"] = -35.0
    wave_down = rest_pose()
    wave_down["upper_arm_r"]["rotation"] = 10.0

    return {
        "name": "走路叠加挥手",
        "duration": 1.2,
        "skeleton": {"bones": bones},
        "keyframes": [
            {"id": "kf-walk-0", "time": 0.0, "pose": walk_start},
            {"id": "kf-walk-mid", "time": 0.6, "pose": walk_mid},
            {"id": "kf-walk-end", "time": 1.2, "pose": walk_end},
        ],
        "layers": [
            {
                "id": "layer-wave",
                "name": "上半身挥手",
                "enabled": True,
                "bones": ["upper_arm_r", "forearm_r"],
                "weight": 1.0,
                "start": 0.2,
                "end": 1.0,
                "fade_in": 0.2,
                "fade_out": 0.3,
                "reference": rest_pose(),
                "keyframes": [
                    {"id": "kf-wave-ready", "time": 0.2, "pose": wave_ready},
                    {"id": "kf-wave-up", "time": 0.65, "pose": wave_up},
                    {"id": "kf-wave-down", "time": 1.0, "pose": wave_down},
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
        errors.append("动作分层 layers 必须是数组")
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
        range_fields = {
            "weight": (0.0, 1.0),
            "start": (0.0, None),
            "end": (0.0, None),
            "fade_in": (0.0, None),
            "fade_out": (0.0, None),
        }
        numeric_values: dict[str, float] = {}
        for field, (lower, upper) in range_fields.items():
            value = layer.get(field, 0.0 if field in {"start", "fade_in", "fade_out"} else 1.0)
            if not isinstance(value, (int, float)) or not math.isfinite(value) or value < lower or (upper is not None and value > upper):
                bound_text = f"{lower}~{upper}" if upper is not None else f"不小于 {lower}"
                errors.append(f"{prefix}的 {field} 必须是 {bound_text} 的数字")
            else:
                numeric_values[field] = float(value)
        if "start" in numeric_values and "end" in numeric_values and numeric_values["end"] < numeric_values["start"]:
            errors.append(f"动作层 {layer_id} 的 end 不能早于 start")
        elif "start" in numeric_values and "end" in numeric_values:
            span = numeric_values["end"] - numeric_values["start"]
            if numeric_values.get("fade_in", 0.0) + numeric_values.get("fade_out", 0.0) > span + 1e-9:
                errors.append(f"动作层 {layer_id} 的淡入淡出时长之和超过时间范围")
        if isinstance(duration, (int, float)):
            if numeric_values.get("end", 0.0) > float(duration) + 1e-9:
                errors.append(f"动作层 {layer_id} 的时间范围超出动画时长")

        affected_bones = layer.get("bones", [])
        if not isinstance(affected_bones, list) or not affected_bones:
            errors.append(f"动作层 {layer_id} 至少需要选择一根作用骨骼")
            affected_bones = []
        bone_set: set[str] = set()
        for affected in affected_bones:
            if not isinstance(affected, str) or affected not in by_id:
                errors.append(f"动作层 {layer_id} 引用了未知骨骼：{affected}")
            elif affected in bone_set:
                errors.append(f"动作层 {layer_id} 的作用骨骼重复：{affected}")
            else:
                bone_set.add(affected)

        reference = layer.get("reference")
        if not isinstance(reference, dict):
            errors.append(f"动作层 {layer_id} 缺少参考姿态 reference")
        else:
            for reference_bone_id, transform in reference.items():
                if reference_bone_id not in by_id:
                    errors.append(f"动作层 {layer_id} 的参考姿态包含未知骨骼 {reference_bone_id}")
                elif not isinstance(transform, dict) or not all(
                    isinstance(transform.get(key), (int, float)) for key in ("x", "y", "rotation")
                ):
                    errors.append(f"动作层 {layer_id} 的参考姿态中骨骼 {reference_bone_id} 数据无效")

        layer_frames = layer.get("keyframes", [])
        if not isinstance(layer_frames, list) or not layer_frames:
            errors.append(f"动作层 {layer_id} 至少需要一个关键姿态")
            continue
        layer_times: list[float] = []
        layer_frame_ids: set[str] = set()
        for frame_index, frame in enumerate(layer_frames):
            frame_prefix = f"动作层 {layer_id} 第 {frame_index + 1} 个关键姿态"
            if not isinstance(frame, dict):
                errors.append(f"{frame_prefix}必须是对象")
                continue
            frame_id = frame.get("id")
            if not isinstance(frame_id, str) or not frame_id.strip():
                errors.append(f"{frame_prefix}缺少有效 id")
            elif frame_id in layer_frame_ids or frame_id in kf_ids:
                errors.append(f"关键姿态 id 重复：{frame_id}")
            else:
                layer_frame_ids.add(frame_id)
            frame_time = frame.get("time")
            if not isinstance(frame_time, (int, float)) or not math.isfinite(frame_time) or frame_time < 0:
                errors.append(f"{frame_prefix}时间必须是非负数字")
            else:
                layer_times.append(float(frame_time))
            pose = frame.get("pose")
            if not isinstance(pose, dict):
                errors.append(f"{frame_prefix}缺少姿态数据")
                continue
            for pose_bone_id, transform in pose.items():
                if pose_bone_id not in by_id:
                    errors.append(f"{frame_prefix}包含未知骨骼 {pose_bone_id}")
                elif not isinstance(transform, dict) or not all(
                    isinstance(transform.get(key), (int, float)) for key in ("x", "y", "rotation")
                ):
                    errors.append(f"{frame_prefix}中骨骼 {pose_bone_id} 的 x/y/rotation 必须是数字")
        if len(layer_times) != len(set(layer_times)):
            errors.append(f"动作层 {layer_id} 的关键姿态时间不能重复")
    return errors


def shortest_angle_delta(start: float, end: float) -> float:
    return (end - start + 180.0) % 360.0 - 180.0


def _number(value: Any, fallback: float = 0.0) -> float:
    return float(value) if isinstance(value, (int, float)) else fallback


def ordered_keyframes(project: dict[str, Any]) -> list[dict[str, Any]]:
    return sorted(project["keyframes"], key=lambda item: float(item["time"]))


def ordered_layer_keyframes(layer: dict[str, Any]) -> list[dict[str, Any]]:
    return sorted(layer["keyframes"], key=lambda item: float(item["time"]))


def _sample_frames(frames: list[dict[str, Any]], time: float) -> dict[str, dict[str, float]]:
    if time <= float(frames[0]["time"]):
        return deepcopy(frames[0]["pose"])
    if time >= float(frames[-1]["time"]):
        return deepcopy(frames[-1]["pose"])
    left = frames[0]
    right = frames[-1]
    for candidate in zip(frames, frames[1:]):
        if float(candidate[0]["time"]) <= time <= float(candidate[1]["time"]):
            left, right = candidate
            break
    span = float(right["time"]) - float(left["time"])
    alpha = 0.0 if span == 0 else (time - float(left["time"])) / span
    result: dict[str, dict[str, float]] = {}
    for bone_id in left["pose"]:
        a = left["pose"][bone_id]
        b = right["pose"][bone_id]
        result[bone_id] = {
            "x": _number(a.get("x")) + (_number(b.get("x")) - _number(a.get("x"))) * alpha,
            "y": _number(a.get("y")) + (_number(b.get("y")) - _number(a.get("y"))) * alpha,
            "rotation": _number(a.get("rotation")) + shortest_angle_delta(_number(a.get("rotation")), _number(b.get("rotation"))) * alpha,
        }
    return result


def layer_weight(layer: dict[str, Any], time: float) -> float:
    """层在指定时刻的实际权重，边界处为 0，淡入淡出为线性渐变。"""
    if layer.get("enabled", True) is False:
        return 0.0
    start = _number(layer.get("start"), 0.0)
    end = _number(layer.get("end"), 0.0)
    if end <= start or time < start or time > end:
        return 0.0
    weight = max(0.0, min(1.0, _number(layer.get("weight"), 1.0)))
    fade_in = max(0.0, _number(layer.get("fade_in"), 0.0))
    fade_out = max(0.0, _number(layer.get("fade_out"), 0.0))
    if fade_in > 0.0 and time < start + fade_in:
        weight *= (time - start) / fade_in
    if fade_out > 0.0 and time > end - fade_out:
        weight *= max(0.0, (end - time) / fade_out)
    return max(0.0, min(1.0, weight))


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
    result = _sample_frames(ordered_keyframes(project), clamped_time)
    layers = project.get("layers") or []
    if not isinstance(layers, list):
        return result
    for layer in layers:
        if not isinstance(layer, dict) or not isinstance(layer.get("keyframes"), list) or not layer["keyframes"]:
            continue
        weight = layer_weight(layer, clamped_time)
        if weight <= 0.0:
            continue
        layer_pose = _sample_frames(ordered_layer_keyframes(layer), clamped_time)
        reference = layer.get("reference") if isinstance(layer.get("reference"), dict) else {}
        affected = layer.get("bones") if isinstance(layer.get("bones"), list) else []
        for bone_id in affected:
            if bone_id not in result or bone_id not in layer_pose or bone_id not in reference:
                continue
            base = result[bone_id]
            overlay = layer_pose[bone_id]
            rest = reference[bone_id]
            base["x"] += (_number(overlay.get("x")) - _number(rest.get("x"))) * weight
            base["y"] += (_number(overlay.get("y")) - _number(rest.get("y"))) * weight
            delta = shortest_angle_delta(_number(rest.get("rotation")), _number(overlay.get("rotation")))
            base["rotation"] += delta * weight
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
