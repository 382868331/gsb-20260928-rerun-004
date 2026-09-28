"""核心验收：播放、逐时刻求值、导出的动作数据必须相互对上。"""

import math

from animstudio import (
    AnimationClip,
    Keyframe,
    ProjectStore,
    default_character,
    evaluate_clip,
    evaluate_pose,
    export_clip,
)
from animstudio.fk import evaluate_world
from animstudio.project import Project


def make_project():
    skel = default_character()
    # 几个关键姿态，包含跨一圈起点的角度
    clip = AnimationClip(
        [
            Keyframe(0.0, {"spine": 0.0, "head": 0.0, "thigh_l": 0.0}),
            Keyframe(0.5, {"spine": 0.2, "head": 6.1, "thigh_l": -0.4}),
            Keyframe(1.0, {"spine": -0.1, "head": 0.2, "thigh_l": 0.5}),
        ],
        duration=1.0,
    )
    return Project("wave", skel, clip)


def test_export_frames_equal_pointwise_evaluation():
    project = make_project()
    fps = 30
    data = export_clip(project.skeleton, project.clip, fps=fps)
    assert data["format"] == "animstudio.action.v1"
    assert data["frameCount"] == 31

    for frame in data["frames"]:
        pointwise = evaluate_clip(project.skeleton, project.clip, frame["time"])
        assert set(frame["bones"]) == set(pointwise)
        for bid, exported in frame["bones"].items():
            expected = pointwise[bid]
            for key in ("x", "y", "angle", "length", "endX", "endY"):
                assert exported[key] == pytest_approx(expected[key])


def pytest_approx(v):
    import pytest

    return pytest.approx(v, abs=1e-12)


def test_export_equals_manual_fk_of_interpolated_pose():
    """三种入口（evaluate_clip / evaluate_pose+FK / export）结果一致。"""
    project = make_project()
    data = export_clip(project.skeleton, project.clip, fps=24)
    for frame in data["frames"][::5]:
        t = frame["time"]
        via_clip = evaluate_clip(project.skeleton, project.clip, t)
        pose = evaluate_pose(project.clip, t)
        via_fk = {bid: wb.to_dict() for bid, wb in evaluate_world(project.skeleton, pose).items()}
        for bid in via_clip:
            assert via_fk[bid]["x"] == pytest_approx(via_clip[bid]["x"])
            assert via_fk[bid]["angle"] == pytest_approx(via_clip[bid]["angle"])


def test_saved_project_plays_back_identical(tmp_path):
    """保存后重新加载再播放，动作不能变样。"""
    store = ProjectStore(tmp_path)
    project = make_project()
    store.save(project)
    loaded = store.load("wave")

    before = export_clip(project.skeleton, project.clip, fps=15)
    after = export_clip(loaded.skeleton, loaded.clip, fps=15)
    assert after["frames"] == before["frames"]

    for t in (0.0, 0.237, 0.5, 0.999, 1.0):
        assert evaluate_clip(project.skeleton, project.clip, t) == evaluate_clip(
            loaded.skeleton, loaded.clip, t
        )


def test_parent_motion_drag_children_in_export():
    """父骨骼转动时子骨骼跟随，且这一关系在导出数据中成立。"""
    project = make_project()
    data = export_clip(project.skeleton, project.clip, fps=10)
    mid = next(f for f in data["frames"] if abs(f["time"] - 0.5) < 1e-9)
    spine = mid["bones"]["spine"]
    head = mid["bones"]["head"]
    # head 挂在 spine 末端方向上：世界角度含 spine 的转动贡献
    assert head["angle"] == pytest_approx(spine["angle"] + project.skeleton.bones["head"].rotation + 6.1)
    # 头的位置就在 spine 末端附近（neck 很短）
    assert math.hypot(head["x"] - spine["endX"], head["y"] - spine["endY"]) < 0.13
