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
        origin_source_version = keyframe.get("origin_source_version")
        if origin_source_version is not None and (
            not isinstance(origin_source_version, int) or origin_source_version < 1
        ):
            errors.append(f"{frame_prefix}的 origin_source_version 必须是正整数")
        for pose_bone_id, transform in pose.items():
            if pose_bone_id not in by_id:
                errors.append(f"{frame_prefix}包含未知骨骼 {pose_bone_id}")
                continue
            if not isinstance(transform, dict) or not all(
                isinstance(transform.get(key), (int, float)) for key in ("x", "y", "rotation")
            ):
                errors.append(f"{frame_prefix}中骨骼 {pose_bone_id} 的 x/y/rotation 必须是数字")
        for bone_id in by_id:
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
        revision = action.get("revision", 1)
        if not isinstance(revision, int) or revision < 1:
            errors.append(f"{prefix}的修订号必须是正整数")
        previous_versions = action.get("previous_versions", [])
        if not isinstance(previous_versions, list):
            errors.append(f"{prefix}的历史版本必须是数组")
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
        decision_log = action.get("decision_log", [])
        if decision_log is None:
            decision_log = []
        if not isinstance(decision_log, list):
            errors.append(f"{prefix}的采用决定记录必须是数组")
        else:
            decision_ids: set[str] = set()
            for decision_index, entry in enumerate(decision_log):
                entry_prefix = f"{prefix}第 {decision_index + 1} 条采用决定"
                if not isinstance(entry, dict):
                    errors.append(f"{entry_prefix}必须是对象")
                    continue
                entry_id = entry.get("id")
                if not isinstance(entry_id, str) or not entry_id.strip():
                    errors.append(f"{entry_prefix}缺少有效 id")
                elif entry_id in decision_ids:
                    errors.append(f"{entry_prefix}id 重复：{entry_id}")
                else:
                    decision_ids.add(entry_id)
                if entry.get("resolution") not in ("source", "keep"):
                    errors.append(f"{entry_prefix}的决定必须是 source 或 keep")
                if entry.get("status", "active") not in ("active", "withdrawn"):
                    errors.append(f"{entry_prefix}的状态必须是 active 或 withdrawn")
                entry_version = entry.get("source_version")
                if not isinstance(entry_version, int) or entry_version < 1:
                    errors.append(f"{entry_prefix}缺少采用依据的源版本号")
                segment = entry.get("segment")
                if not isinstance(segment, dict) or not isinstance(segment.get("start"), (int, float)) \
                        or not isinstance(segment.get("end"), (int, float)) or segment["end"] < segment["start"]:
                    errors.append(f"{entry_prefix}的时间区间无效")
        variants = action.get("variants", [])
        if variants is None:
            variants = []
        if not isinstance(variants, list):
            errors.append(f"{prefix}的采用方案必须是数组")
        else:
            variant_ids: set[str] = set()
            for variant_index, variant in enumerate(variants):
                variant_prefix = f"{prefix}第 {variant_index + 1} 个采用方案"
                if not isinstance(variant, dict):
                    errors.append(f"{variant_prefix}必须是对象")
                    continue
                variant_id = variant.get("id")
                if not isinstance(variant_id, str) or not variant_id.strip():
                    errors.append(f"{variant_prefix}缺少有效 id")
                elif variant_id in variant_ids:
                    errors.append(f"{variant_prefix}id 重复：{variant_id}")
                else:
                    variant_ids.add(variant_id)
                if not isinstance(variant.get("name"), str) or not variant["name"].strip():
                    errors.append(f"{variant_prefix}缺少名称")
                if variant.get("status") not in ("draft", "published"):
                    errors.append(f"{variant_prefix}的状态必须是 draft 或 published")
                variant_revision = variant.get("revision", 1)
                if not isinstance(variant_revision, int) or variant_revision < 1:
                    errors.append(f"{variant_prefix}的修订号必须是正整数")
                errors.extend(validate_clip(
                    {"keyframes": variant.get("keyframes", []), "layers": []},
                    action_duration,
                    skeleton,
                    prefix=f"{variant_prefix}内",
                ))
        errors.extend(validate_clip(action, action_duration, skeleton, prefix=prefix + "内"))

    review_batches = project.get("review_batches", [])
    if review_batches is None:
        review_batches = []
    if not isinstance(review_batches, list):
        errors.append("审阅批次必须是数组")
    else:
        batch_ids: set[str] = set()
        for batch_index, batch in enumerate(review_batches):
            batch_prefix = f"第 {batch_index + 1} 个审阅批次"
            if not isinstance(batch, dict):
                errors.append(f"{batch_prefix}必须是对象")
                continue
            batch_id = batch.get("id")
            if not isinstance(batch_id, str) or not batch_id.strip():
                errors.append(f"{batch_prefix}缺少有效 id")
            elif batch_id in batch_ids:
                errors.append(f"{batch_prefix}id 重复：{batch_id}")
            else:
                batch_ids.add(batch_id)
            if batch.get("status") not in ("open", "decided", "partially_submitted", "published"):
                errors.append(f"{batch_prefix}的状态无效")
            items = batch.get("items", [])
            if not isinstance(items, list) or not items:
                errors.append(f"{batch_prefix}至少包含一个受影响动作")
                continue
            for item_index, item in enumerate(items):
                item_prefix = f"{batch_prefix}第 {item_index + 1} 项"
                if not isinstance(item, dict):
                    errors.append(f"{item_prefix}必须是对象")
                    continue
                if item.get("action_id") not in action_ids:
                    errors.append(f"{item_prefix}引用了不存在的动作")
                if not isinstance(item.get("variant_id"), str) or not item["variant_id"].strip():
                    errors.append(f"{item_prefix}缺少批次草稿 id")
                if item.get("status") not in ("open", "decided", "published", "missing"):
                    errors.append(f"{item_prefix}的状态无效")
                segments = item.get("segments", [])
                if not isinstance(segments, list):
                    errors.append(f"{item_prefix}的区间必须是数组")
                    continue
                for segment_index, segment in enumerate(segments):
                    segment_prefix = f"{item_prefix}第 {segment_index + 1} 段"
                    if not isinstance(segment, dict):
                        errors.append(f"{segment_prefix}必须是对象")
                        continue
                    if segment.get("resolution") not in ("source", "keep", "pending"):
                        errors.append(f"{segment_prefix}必须采用新源、保留旧依据或待定")
                    if not isinstance(segment.get("bones"), list):
                        errors.append(f"{segment_prefix}缺少骨骼列表")

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
    sample_times = [float(range_start) + min(index / float(fps), span) for index in range(count)]
    keyframes: list[dict[str, Any]] = []
    previous: dict[str, dict[str, float]] | None = None
    for sample_time in sample_times:
        pose = sample_local(project, sample_time)
        selected_pose = {
            bone_id: {"x": float(pose[bone_id]["x"]), "y": float(pose[bone_id]["y"]), "rotation": float(pose[bone_id]["rotation"])}
            for bone_id in selected_bones
        }
        # Drop only an exact duplicate of the previous pose; curved motion needs
        # every sample so linear playback reproduces the composed source pose.
        if previous is not None and _pose_close(previous, selected_pose, tolerance) \
                and len(keyframes) >= 2:
            keyframes[-1]["time"] = round(sample_time - float(range_start), 9)
        else:
            keyframes.append({
                "id": f"{action_id or 'baked'}-kf-{len(keyframes)}",
                "time": round(sample_time - float(range_start), 9),
                "pose": selected_pose,
                "origin": "baked",
            })
        previous = selected_pose
    keyframes[-1]["time"] = span

    # Frame-accurate verification at every baked sample (playback steps by fps,
    # so intermediate interpolation is never used for repeated playback).
    for verify_index, verify_time in enumerate(sample_times):
        source_pose = sample_local(project, verify_time)
        baked_pose = keyframes[min(verify_index, len(keyframes) - 1)]["pose"]
        for bone_id in selected_bones:
            a = source_pose[bone_id]
            b = baked_pose[bone_id]
            if abs(a["x"] - b["x"]) > 1e-9 or abs(a["y"] - b["y"]) > 1e-9 \
                    or abs(shortest_angle_delta(b["rotation"], a["rotation"])) > 1e-9:
                raise ValueError(f"整理结果在 {verify_time:g}s 的骨骼 {bone_id} 与原工程姿态不一致，已放弃整理")

    new_id = action_id or f"action-{len(project.get('actions', [])) + 1}-{int(range_start * 1000)}-{int(range_end * 1000)}"
    source_version = int(project.get("version", 1))
    action = {
        "id": new_id,
        "name": name or f"整理动作 {range_start:g}~{range_end:g}s",
        "duration": span,
        "keyframes": keyframes,
        "layers": [],
        "revision": 1,
        "previous_versions": [],
        "decision_log": [],
        "variants": [],
        "source": {
            "action_id": "__main__",
            "source_version": source_version,
            "range_start": float(range_start),
            "range_end": float(range_end),
            "bones": list(selected_bones),
            "fps": float(fps),
            "created_at": _utc_now_iso(),
        },
    }
    return action


def _utc_now_iso() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


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


def _transform_differs(a: dict[str, float], b: dict[str, float], tolerance: float = 1e-7) -> bool:
    return (
        abs(float(a["x"]) - float(b["x"])) > tolerance
        or abs(float(a["y"]) - float(b["y"])) > tolerance
        or abs(shortest_angle_delta(float(b["rotation"]), float(a["rotation"]))) > tolerance
    )


def analyze_rebake(
    project: dict[str, Any],
    action: dict[str, Any],
    variant_id: str | None = None,
) -> list[dict[str, Any]]:
    """Compare a baked action against the current source project.

    Returns affected segments in action-local time. Each segment lists the
    bones whose baked pose no longer matches the source, and flags segments
    containing keyframes the user manually retouched on the action.
    """
    source = action.get("source") or {}
    fps = float(source.get("fps", 60.0))
    range_start = float(source.get("range_start", 0.0))
    span = float(action["duration"])
    bones = [bone_id for bone_id in source.get("bones", []) if isinstance(bone_id, str)]
    count = int(round(span * fps)) + 1
    if variant_id is not None:
        variant = next(
            (item for item in action.get("variants", []) or [] if item.get("id") == variant_id),
            None,
        )
        if variant is None:
            raise ValueError(f"找不到方案 {variant_id}")
        compare_frames = variant.get("keyframes", [])
    else:
        compare_frames = action.get("keyframes", [])
    keyframe_by_index = {
        int(round(float(frame["time"]) * fps)): frame for frame in compare_frames
    }
    cells: list[dict[str, Any]] = []
    for index in range(count):
        local_time = min(index / fps, span)
        source_pose = sample_local(project, range_start + local_time)
        baked_pose = sample_frames(compare_frames, local_time)
        differing = [
            bone_id for bone_id in bones
            if bone_id in source_pose and bone_id in baked_pose
            and _transform_differs(source_pose[bone_id], baked_pose[bone_id])
        ]
        if not differing:
            continue
        keyframe = keyframe_by_index.get(index)
        cells.append({
            "index": index,
            "time": local_time,
            "bones": differing,
            "manual": bool(keyframe is not None and keyframe.get("origin") == "manual"),
        })
    segments: list[dict[str, Any]] = []
    for cell in cells:
        if segments and cell["index"] == segments[-1]["_last_index"] + 1 \
                and cell["manual"] == segments[-1]["manual"]:
            segment = segments[-1]
            segment["_last_index"] = cell["index"]
            segment["end"] = cell["time"]
            segment["bones"] = sorted(set(segment["bones"]) | set(cell["bones"]))
            segment["manual"] = segment["manual"] or cell["manual"]
        else:
            segments.append({
                "_last_index": cell["index"],
                "start": cell["time"],
                "end": cell["time"],
                "bones": list(cell["bones"]),
                "manual": cell["manual"],
            })
    for segment in segments:
        segment.pop("_last_index")
    active_decisions = [
        entry for entry in action.get("decision_log", []) or []
        if isinstance(entry, dict) and entry.get("status", "active") == "active"
        and (
            (entry.get("variant_id") == variant_id)
            if variant_id is not None
            else not entry.get("variant_id")
        )
    ]
    for segment in segments:
        segment["basis"] = [
            {
                "id": entry["id"],
                "revision": entry.get("revision"),
                "resolution": entry.get("resolution"),
                "source_version": entry.get("source_version"),
                "variant_id": entry.get("variant_id"),
            }
            for entry in active_decisions
            if _segments_intersect(
                {"start": segment["start"], "end": segment["end"], "bones": segment["bones"]},
                entry.get("segment") or {},
            )
        ]
    return segments


def _segments_intersect(first: dict[str, Any], second: dict[str, Any]) -> bool:
    """Two decision/analysis segments intersect when time windows and bones overlap."""
    try:
        first_start = float(first.get("start", 0.0))
        first_end = float(first.get("end", 0.0))
        second_start = float(second.get("start", 0.0))
        second_end = float(second.get("end", 0.0))
    except (TypeError, ValueError):
        return False
    if first_start > second_end + 1e-9 or second_start > first_end + 1e-9:
        return False
    first_bones = set(first.get("bones") or [])
    second_bones = set(second.get("bones") or [])
    return bool(first_bones & second_bones)


def _next_decision_id(action: dict[str, Any]) -> str:
    return f"{action['id']}-d{len(action.get('decision_log', []) or []) + 1}"


def apply_rebake(
    project: dict[str, Any],
    action_id: str,
    decisions: list[dict[str, Any]],
    variant_id: str | None = None,
    batch_id: str | None = None,
) -> dict[str, Any]:
    """Apply per-segment rebake decisions to one action; returns the new action.

    Each decision is {"segment": {"start", "end"}, "resolution": "source"|"keep"}.
    "source" re-bakes that window from the current source project (replacing any
    manual keyframes inside it); "keep" leaves the window untouched and stamps
    the kept manual keyframes with the source version they were confirmed
    against, so later source edits can still detect the conflict. Adjacent
    untouched frames still equal the source pose, so neighbouring segments stay
    pose-continuous. Every confirmed decision is appended to the action's
    decision_log with the source version it is based on.

    With variant_id the decisions are applied to that draft variant's keyframes
    instead of the action itself, so two adoption plans for the same source
    revision stay independently editable until one is published. Without
        variant_id the previous keyframes are snapshotted so older revisions remain
        playable after save/reload. batch_id tags the decisions as belonging to a
        review batch, so cancelling an unpublished batch decision can remove only
        that batch's entries.
    """
    action = next((item for item in project.get("actions", []) if item.get("id") == action_id), None)
    if action is None:
        raise ValueError(f"找不到整理动作 {action_id}")
    source = action["source"]
    fps = float(source.get("fps", 60.0))
    range_start = float(source["range_start"])
    span = float(action["duration"])
    bones = list(source["bones"])

    confirmed = [
        d for d in decisions
        if isinstance(d, dict) and d.get("resolution") in ("source", "keep")
    ]
    if not confirmed:
        raise ValueError("没有需要应用的返修区间")
    adopted = [d for d in confirmed if d.get("resolution") == "source"]
    keeps = [d for d in confirmed if d.get("resolution") == "keep"]

    variant: dict[str, Any] | None = None
    if variant_id is not None:
        variant = next(
            (item for item in action.get("variants", []) or [] if item.get("id") == variant_id),
            None,
        )
        if variant is None:
            raise ValueError(f"找不到方案 {variant_id}")
        if variant.get("status") != "draft":
            raise ValueError(f"方案「{variant.get('name', variant_id)}」已发布，不能再编辑")

    base_frames = variant["keyframes"] if variant is not None else action["keyframes"]
    keyframes = [dict(frame, pose=deepcopy(frame["pose"])) for frame in base_frames]
    target_revision = int((variant if variant is not None else action).get("revision", 1)) + 1
    source_version = int(project.get("version", 1))
    for decision in adopted:
        window = decision.get("segment") or {}
        start = float(window.get("start", 0.0))
        end = float(window.get("end", 0.0))
        if end < start or start < -1e-9 or end > span + 1e-9:
            raise ValueError(f"返修区间 {start:g}~{end:g}s 无效")
        keyframes = [
            frame for frame in keyframes
            if float(frame["time"]) < start - 1e-9 or float(frame["time"]) > end + 1e-9
        ]
        first_index = int(math.ceil(start * fps - 1e-9))
        last_index = int(math.floor(end * fps + 1e-9))
        for index in range(first_index, last_index + 1):
            local_time = min(index / fps, span)
            source_pose = sample_local(project, range_start + local_time)
            keyframes.append({
                "id": f"{action_id}-r{target_revision}-kf-{index}",
                "time": round(local_time, 9),
                "pose": {
                    bone_id: {
                        "x": float(source_pose[bone_id]["x"]),
                        "y": float(source_pose[bone_id]["y"]),
                        "rotation": float(source_pose[bone_id]["rotation"]),
                    }
                    for bone_id in bones
                },
                "origin": "baked",
            })
    for decision in keeps:
        window = decision.get("segment") or {}
        start = float(window.get("start", 0.0))
        end = float(window.get("end", 0.0))
        if end < start or start < -1e-9 or end > span + 1e-9:
            raise ValueError(f"保留区间 {start:g}~{end:g}s 无效")
        for frame in keyframes:
            if start - 1e-9 <= float(frame["time"]) <= end + 1e-9 \
                    and frame.get("origin") == "manual":
                # The kept manual result is explicitly attached to the source
                # version it was confirmed against.
                frame["origin_source_version"] = source_version
    keyframes.sort(key=lambda frame: float(frame["time"]))

    decision_log = list(action.get("decision_log", []) or [])
    segment_bones = {
        id(decision): list((decision.get("segment") or {}).get("bones") or bones)
        for decision in confirmed
    }
    for decision in confirmed:
        window = decision.get("segment") or {}
        decision_log.append({
            "id": _next_decision_id({**action, "decision_log": decision_log}),
            "revision": target_revision,
            "variant_id": variant_id,
            "segment": {
                "start": float(window.get("start", 0.0)),
                "end": float(window.get("end", 0.0)),
                "bones": segment_bones[id(decision)],
            },
            "resolution": decision["resolution"],
            "source_version": source_version,
            "batch_id": batch_id,
            "status": "active",
            "created_at": _utc_now_iso(),
        })

    updated = deepcopy(action)
    updated["decision_log"] = decision_log
    if variant is not None:
        updated_variants = []
        for item in updated.get("variants", []):
            if item.get("id") == variant_id:
                item = {**item, "keyframes": keyframes, "revision": target_revision}
            updated_variants.append(item)
        updated["variants"] = updated_variants
    else:
        updated["keyframes"] = keyframes
        updated["revision"] = target_revision
        previous_versions = list(action.get("previous_versions", []))
        previous_versions.append({
            "revision": int(action.get("revision", 1)),
            "keyframes": deepcopy(action["keyframes"]),
            "saved_at": _utc_now_iso(),
        })
        updated["previous_versions"] = previous_versions
        updated["source"] = {**source, "updated_at": _utc_now_iso()}
        if not analyze_rebake(project, updated):
            updated["source"]["source_version"] = source_version
    return updated


def create_variant(
    project: dict[str, Any],
    action_id: str,
    name: str = "",
    variant_id: str | None = None,
) -> dict[str, Any]:
    """Fork the action's current keyframes into a new editable adoption variant."""
    action = next((item for item in project.get("actions", []) if item.get("id") == action_id), None)
    if action is None:
        raise ValueError(f"找不到整理动作 {action_id}")
    variants = list(action.get("variants", []) or [])
    new_id = variant_id or f"{action_id}-var-{len(variants) + 1}"
    if any(item.get("id") == new_id for item in variants):
        raise ValueError(f"方案 id 重复：{new_id}")
    variants.append({
        "id": new_id,
        "name": name or f"方案 {len(variants) + 1}",
        "status": "draft",
        "keyframes": deepcopy(action["keyframes"]),
        "revision": 1,
        "created_at": _utc_now_iso(),
    })
    updated = deepcopy(action)
    updated["variants"] = variants
    return updated


def publish_variant(project: dict[str, Any], action_id: str, variant_id: str) -> dict[str, Any]:
    """Publish one adoption variant as the action's new revision.

    Only this variant's result becomes the action; other variants stay draft
    and editable, and the previously published action remains playable via
    previous_versions.
    """
    action = next((item for item in project.get("actions", []) if item.get("id") == action_id), None)
    if action is None:
        raise ValueError(f"找不到整理动作 {action_id}")
    variant = next(
        (item for item in action.get("variants", []) or [] if item.get("id") == variant_id),
        None,
    )
    if variant is None:
        raise ValueError(f"找不到方案 {variant_id}")
    if variant.get("status") != "draft":
        raise ValueError(f"方案「{variant.get('name', variant_id)}」已发布过")
    updated = deepcopy(action)
    updated["keyframes"] = deepcopy(variant["keyframes"])
    updated["revision"] = int(action.get("revision", 1)) + 1
    previous_versions = list(action.get("previous_versions", []))
    previous_versions.append({
        "revision": int(action.get("revision", 1)),
        "keyframes": deepcopy(action["keyframes"]),
        "saved_at": _utc_now_iso(),
    })
    updated["previous_versions"] = previous_versions
    updated["variants"] = [
        {**item, "status": "published", "published_at": _utc_now_iso()}
        if item.get("id") == variant_id else item
        for item in updated.get("variants", [])
    ]
    updated["source"] = {**updated["source"], "updated_at": _utc_now_iso()}
    if not analyze_rebake(project, updated):
        updated["source"]["source_version"] = int(project.get("version", 1))
    return updated


def withdrawal_preview(project: dict[str, Any], action_id: str, decision_id: str) -> dict[str, Any]:
    """Explain what withdrawing one confirmed decision would affect.

    Later decisions whose time/bone window intersects the withdrawn one depend
    on it; later decisions that do not intersect stay independently keepable
    and are never erased by the withdrawal.
    """
    action = next((item for item in project.get("actions", []) if item.get("id") == action_id), None)
    if action is None:
        raise ValueError(f"找不到整理动作 {action_id}")
    log = [entry for entry in action.get("decision_log", []) or [] if isinstance(entry, dict)]
    index = next((i for i, entry in enumerate(log) if entry.get("id") == decision_id), None)
    if index is None:
        raise ValueError(f"找不到采用决定 {decision_id}")
    decision = log[index]
    if decision.get("status", "active") != "active":
        raise ValueError(f"决定 {decision_id} 已被撤回")
    later = [entry for entry in log[index + 1:] if entry.get("status", "active") == "active"]
    dependents = [entry for entry in later if _segments_intersect(decision.get("segment") or {}, entry.get("segment") or {})]
    independent = [entry for entry in later if entry not in dependents]
    return {"decision": decision, "dependents": dependents, "independent": independent}


def withdraw_decision(
    project: dict[str, Any],
    action_id: str,
    decision_id: str,
    confirm: bool = False,
) -> dict[str, Any]:
    """Withdraw one earlier action-level decision, restoring its window only.

    The window is restored from the snapshot taken just before that decision;
    later unrelated rework outside the window is left untouched. When later
    dependent decisions overlap the window, confirm=True is required because
    their effect inside the window is replaced as well.
    """
    action = next((item for item in project.get("actions", []) if item.get("id") == action_id), None)
    if action is None:
        raise ValueError(f"找不到整理动作 {action_id}")
    preview = withdrawal_preview(project, action_id, decision_id)
    decision = preview["decision"]
    if decision.get("variant_id"):
        raise ValueError("方案内的决定请通过继续编辑该方案处理，不能单独撤回")
    if preview["dependents"] and not confirm:
        names = "、".join(entry["id"] for entry in preview["dependents"])
        raise ValueError(f"该决定被后续决定依赖（{names}），确认后才会撤回")
    window = decision.get("segment") or {}
    start = float(window.get("start", 0.0))
    end = float(window.get("end", 0.0))
    snapshot = next(
        (item for item in action.get("previous_versions", [])
         if item.get("revision") == int(decision.get("revision", 1)) - 1),
        None,
    )
    if snapshot is None:
        raise ValueError("缺少该决定应用前的版本快照，无法安全撤回")
    restored = [
        deepcopy(frame) for frame in snapshot["keyframes"]
        if start - 1e-9 <= float(frame["time"]) <= end + 1e-9
    ]
    keyframes = [
        dict(frame, pose=deepcopy(frame["pose"])) for frame in action["keyframes"]
        if float(frame["time"]) < start - 1e-9 or float(frame["time"]) > end + 1e-9
    ]
    keyframes.extend(restored)
    keyframes.sort(key=lambda frame: float(frame["time"]))

    updated = deepcopy(action)
    updated["keyframes"] = keyframes
    updated["revision"] = int(action.get("revision", 1)) + 1
    previous_versions = list(action.get("previous_versions", []))
    previous_versions.append({
        "revision": int(action.get("revision", 1)),
        "keyframes": deepcopy(action["keyframes"]),
        "saved_at": _utc_now_iso(),
    })
    updated["previous_versions"] = previous_versions
    updated["decision_log"] = [
        {**entry, "status": "withdrawn"} if entry.get("id") == decision_id else entry
        for entry in updated.get("decision_log", [])
    ]
    updated["source"] = {**updated["source"], "updated_at": _utc_now_iso()}
    return updated


def _get_batch(project: dict[str, Any], batch_id: str) -> dict[str, Any]:
    batch = next(
        (item for item in project.get("review_batches", []) or [] if item.get("id") == batch_id),
        None,
    )
    if batch is None:
        raise ValueError(f"找不到审阅批次 {batch_id}")
    return batch


def _get_batch_item(batch: dict[str, Any], action_id: str) -> dict[str, Any]:
    item = next(
        (entry for entry in batch.get("items", []) if entry.get("action_id") == action_id),
        None,
    )
    if item is None:
        raise ValueError(f"动作 {action_id} 不在审阅批次中")
    return item


def _segment_key(segment: dict[str, Any]) -> tuple[float, float, tuple[str, ...]]:
    return (
        round(float(segment.get("start", 0.0)), 9),
        round(float(segment.get("end", 0.0)), 9),
        tuple(sorted(segment.get("bones") or [])),
    )


def _refresh_batch_item(project: dict[str, Any], item: dict[str, Any]) -> None:
    """Recompute affected segments for one open batch item; keep decisions/basis.

    Segments already carrying an explicit decision keep it. Segments newly
    introduced by a later source revision enter as "pending" together with the
    earlier confirmed decisions (their basis) that intersect them.
    """
    action_id = item["action_id"]
    variant_id = item.get("variant_id")
    action = next(
        (entry for entry in project.get("actions", []) or [] if entry.get("id") == action_id),
        None,
    )
    if action is None:
        item["segments"] = []
        item["status"] = "missing"
        return
    fresh = analyze_rebake(project, action, variant_id)
    prior: dict[Any, dict[str, Any]] = {
        _segment_key(segment): segment
        for segment in item.get("segments", [])
        if isinstance(segment, dict) and segment.get("resolution") in ("source", "keep")
    }
    segments: list[dict[str, Any]] = []
    seen_keys: set[Any] = set()
    for segment in fresh:
        key = _segment_key(segment)
        seen_keys.add(key)
        decided = prior.get(key)
        segments.append({
            "start": segment["start"],
            "end": segment["end"],
            "bones": list(segment["bones"]),
            "manual": segment["manual"],
            "basis": segment.get("basis", []),
            "resolution": decided["resolution"] if decided is not None else "pending",
            "resolved": False,
        })
    for key, decided in prior.items():
        if key in seen_keys:
            continue
        segments.append({
            "start": decided["start"],
            "end": decided["end"],
            "bones": list(decided.get("bones", [])),
            "manual": decided.get("manual", False),
            "basis": decided.get("basis", []),
            "resolution": decided["resolution"],
            "resolved": True,
        })
    segments.sort(key=lambda segment: (float(segment["start"]), float(segment["end"])))
    item["segments"] = segments
    explicit = [segment for segment in segments if segment["resolution"] in ("source", "keep")]
    if explicit and all(segment["resolution"] in ("source", "keep") for segment in segments):
        item["status"] = "decided"
    else:
        item["status"] = "open"


def _refresh_batch(project: dict[str, Any], batch: dict[str, Any]) -> None:
    for item in batch.get("items", []):
        if item.get("status") != "published":
            _refresh_batch_item(project, item)
    if all(item.get("status") == "published" for item in batch.get("items", [])):
        batch["status"] = "published"
    elif any(item.get("status") == "published" for item in batch.get("items", [])):
        batch["status"] = "partially_submitted"
    else:
        batch["status"] = "open"


def review_batch_summary(project: dict[str, Any], batch_id: str) -> dict[str, Any]:
    """Return one batch with freshly recomputed pending segments (not persisted)."""
    batch = deepcopy(_get_batch(project, batch_id))
    _refresh_batch(project, batch)
    return batch


def create_review_batch(
    project: dict[str, Any],
    action_ids: list[str] | None = None,
    batch_id: str | None = None,
    name: str = "",
) -> dict[str, Any]:
    """Open one review batch covering every affected action of a source revision.

    Each action gets its own draft variant so two actions sharing the same
    source keep two independent drafts in the same batch. Nothing is published
    until submit_review_batch; the batch (with pending items) is saved with the
    project and can be resumed after reload.
    """
    updated = deepcopy(project)
    batches = list(updated.get("review_batches", []) or [])
    new_id = batch_id or f"batch-{len(batches) + 1}"
    if any(item.get("id") == new_id for item in batches):
        raise ValueError(f"审阅批次 id 重复：{new_id}")
    candidates: list[dict[str, Any]] = []
    requested = list(action_ids) if action_ids else None
    for action in updated.get("actions", []) or []:
        if requested is not None and action.get("id") not in requested:
            continue
        segments = analyze_rebake(updated, action)
        if not segments:
            if requested is not None and action.get("id") in requested:
                raise ValueError(f"动作 {action.get('id')} 当前没有受源修订影响的区间")
            continue
        variants = action.setdefault("variants", [])
        variant_index = len(variants) + 1
        variant_id = f"{action['id']}-{new_id}-draft"
        while any(item.get("id") == variant_id for item in variants):
            variant_index += 1
            variant_id = f"{action['id']}-{new_id}-draft-{variant_index}"
        variants.append({
            "id": variant_id,
            "name": f"批次草稿 {variant_index}",
            "status": "draft",
            "keyframes": deepcopy(action.get("keyframes", [])),
            "revision": 1,
            "created_at": _utc_now_iso(),
        })
        candidates.append({
            "action_id": action["id"],
            "variant_id": variant_id,
            "status": "open",
            "source_version": int(updated.get("version", 1)),
            "segments": [
                {
                    "start": segment["start"],
                    "end": segment["end"],
                    "bones": list(segment["bones"]),
                    "manual": segment["manual"],
                    "basis": segment.get("basis", []),
                    "resolution": "pending",
                }
                for segment in segments
            ],
        })
    if not candidates:
        raise ValueError("没有受源修订影响的整理动作，无法创建审阅批次")
    missing = sorted(set(requested or []) - {item["action_id"] for item in candidates})
    if missing:
        raise ValueError("以下动作不存在：" + "、".join(missing))
    batch = {
        "id": new_id,
        "name": name or f"源 v{updated.get('version', 1)} 批次审阅",
        "source_version": int(updated.get("version", 1)),
        "status": "open",
        "created_at": _utc_now_iso(),
        "items": candidates,
    }
    batches.append(batch)
    updated["review_batches"] = batches
    return updated


def set_review_item_decisions(
    project: dict[str, Any],
    batch_id: str,
    action_id: str,
    resolutions: dict[str, str] | list[dict[str, Any]],
) -> dict[str, Any]:
    """Record per-segment decisions for one batch item without publishing.

    Explicit source/keep decisions are applied onto the item's private draft
    variant; pending entries stay untouched. The batch and its bases are saved
    with the project, so review can continue after reload or after the source is
    revised again.
    """
    updated = deepcopy(project)
    batch = _get_batch(updated, batch_id)
    item = _get_batch_item(batch, action_id)
    if item.get("status") == "published":
        raise ValueError("该动作的批次决定已发布，不能再修改")
    _refresh_batch_item(updated, item)
    if isinstance(resolutions, dict):
        choices = {
            str(index): value
            for index, value in resolutions.items()
            if value in ("source", "keep", "pending")
        }
    else:
        choices = {}
        for entry in resolutions or []:
            if not isinstance(entry, dict):
                continue
            index = entry.get("index")
            value = entry.get("resolution")
            if value in ("source", "keep", "pending") and index is not None:
                choices[str(index)] = value
    decisions: list[dict[str, Any]] = []
    for index, segment in enumerate(item["segments"]):
        resolution = choices.get(str(index), segment.get("resolution", "pending"))
        segment["resolution"] = resolution
        if resolution in ("source", "keep"):
            decisions.append({
                "segment": {
                    "start": segment["start"],
                    "end": segment["end"],
                    "bones": segment["bones"],
                },
                "resolution": resolution,
            })
    item["status"] = "decided" if decisions and len(decisions) == len(item["segments"]) else "open"
    if decisions:
        # Rebase the draft from the action and replay every explicit decision
        # recorded for this batch item, so editing one choice never duplicates
        # an older application.
        action = next(
            (entry for entry in updated.get("actions", []) if entry.get("id") == action_id),
            None,
        )
        variant_id = item.get("variant_id")
        variant = next(
            (entry for entry in (action or {}).get("variants", []) if entry.get("id") == variant_id),
            None,
        )
        if action is None or variant is None:
            raise ValueError("找不到该动作的批次草稿，无法记录决定")
        variant["keyframes"] = deepcopy(action.get("keyframes", []))
        variant["revision"] = 1
        action["decision_log"] = [
            entry for entry in (action.get("decision_log") or [])
            if not (entry.get("batch_id") == batch_id and entry.get("variant_id") == variant_id)
        ]
        action = apply_rebake(updated, action_id, decisions, variant_id, batch_id=batch_id)
        updated["actions"] = [
            action if entry.get("id") == action_id else entry
            for entry in updated.get("actions", [])
        ]
    _refresh_batch(updated, batch)
    return updated


def submit_review_batch(project: dict[str, Any], batch_id: str) -> dict[str, Any]:
    """Publish only fully decided batch items; pending items remain saved.

    Each decided item's private draft becomes that action's new revision.
    Pending items (and their segments/bases) are preserved in the batch and can
    be reviewed after reload or another source revision.
    """
    updated = deepcopy(project)
    batch = _get_batch(updated, batch_id)
    _refresh_batch(updated, batch)
    decided_items = [
        item for item in batch.get("items", [])
        if item.get("status") != "published"
        and item.get("segments")
        and all(segment.get("resolution") in ("source", "keep") for segment in item["segments"])
    ]
    if not decided_items:
        raise ValueError("本批还没有逐项明确决定的动作；未决定项会保存，稍后可继续")
    for item in decided_items:
        action_id = item["action_id"]
        updated_action = publish_variant(updated, action_id, item["variant_id"])
        updated["actions"] = [
            updated_action if entry.get("id") == action_id else entry
            for entry in updated.get("actions", [])
        ]
        item["status"] = "published"
        item["published_at"] = _utc_now_iso()
    _refresh_batch(updated, batch)
    return updated


def cancel_review_item(
    project: dict[str, Any],
    batch_id: str,
    action_id: str,
) -> dict[str, Any]:
    """Cancel one item's unpublished batch decisions.

    The item's private draft returns to its original keyframes and the batch's
    decision entries are removed; the action itself and decisions published by
    other batches (or directly) are never reverted.
    """
    updated = deepcopy(project)
    batch = _get_batch(updated, batch_id)
    item = _get_batch_item(batch, action_id)
    if item.get("status") == "published":
        raise ValueError("已发布的批次结果不能在此取消，请在动作内通过撤回决定处理")
    action = next(
        (entry for entry in updated.get("actions", []) if entry.get("id") == action_id),
        None,
    )
    variant_id = item.get("variant_id")
    if action is not None and variant_id:
        for variant in action.get("variants", []) or []:
            if variant.get("id") == variant_id:
                variant["keyframes"] = deepcopy(action.get("keyframes", []))
                variant["revision"] = 1
        action["decision_log"] = [
            entry for entry in (action.get("decision_log") or [])
            if not (entry.get("batch_id") == batch_id and entry.get("variant_id") == variant_id)
        ]
    for segment in item.get("segments", []):
        segment["resolution"] = "pending"
    item["status"] = "open"
    _refresh_batch(updated, batch)
    return updated


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
    project.setdefault("review_batches", [])
    for layer in project.get("layers", []) or []:
        if isinstance(layer, dict):
            layer.setdefault("weight_keys", [])
    for action in project.get("actions", []) or []:
        if isinstance(action, dict):
            action.setdefault("decision_log", [])
            action.setdefault("variants", [])
    return project


def save_project(path: str | Path, project: dict[str, Any]) -> None:
    project_path = Path(path)
    project_path.parent.mkdir(parents=True, exist_ok=True)
    temporary = project_path.with_suffix(".tmp")
    with temporary.open("w", encoding="utf-8") as stream:
        json.dump(project, stream, ensure_ascii=False, indent=2)
        stream.write("\n")
    temporary.replace(project_path)
