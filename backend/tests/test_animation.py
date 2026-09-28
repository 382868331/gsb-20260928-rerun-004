import math

import pytest

from animstudio import (
    AnimationClip,
    Keyframe,
    default_character,
    duplicate_keyframe,
    evaluate_pose,
    lerp_angle,
    move_keyframe,
    remove_keyframe,
    shortest_delta,
)


def test_shortest_delta_basic():
    # -0.1 -> 0.1 不跨起点，直接 +0.2
    assert shortest_delta(-0.1, 0.1) == pytest.approx(0.2)


def test_shortest_path_across_zero():
    # 从 6.0 到 0.3：跨过 2pi 起点，应走 ~0.58 的短弧，而不是 -5.7
    d = shortest_delta(6.0, 0.3)
    assert abs(d) < math.pi
    assert d == pytest.approx(0.3 + 2 * math.pi - 6.0, abs=1e-12)
    mid = lerp_angle(6.0, 0.3, 0.5)
    assert abs(shortest_delta(6.0, mid) - d / 2) < 1e-12
    assert abs(shortest_delta(6.0, mid)) < abs(d)


def test_lerp_endpoints():
    assert lerp_angle(6.0, 0.3, 0.0) == pytest.approx(6.0)
    assert lerp_angle(6.0, 0.3, 1.0) == pytest.approx(6.0 + shortest_delta(6.0, 0.3))


def test_pose_clamps_outside_range():
    clip = AnimationClip([Keyframe(1.0, {"a": 0.0}), Keyframe(2.0, {"a": 1.0})])
    assert evaluate_pose(clip, 0.0) == {"a": 0.0}
    assert evaluate_pose(clip, 9.0) == {"a": 1.0}


def test_pose_midpoint_and_sparse_bones():
    clip = AnimationClip(
        [Keyframe(0.0, {"a": 0.0}), Keyframe(2.0, {"a": 1.0, "b": 2.0})]
    )
    pose = evaluate_pose(clip, 1.0)
    assert pose["a"] == pytest.approx(0.5)
    # 左关键帧没有 b，按 0 处理
    assert pose["b"] == pytest.approx(1.0)


def test_move_duplicate_remove():
    clip = AnimationClip([Keyframe(0.0, {"a": 0.1}), Keyframe(1.0, {"a": 0.2})])
    move_keyframe(clip, 1.0, 1.5)
    assert clip.times == [0.0, 1.5]
    duplicate_keyframe(clip, 0.0, 0.5)
    assert clip.get(0.5).pose == {"a": 0.1}
    with pytest.raises(ValueError, match="已存在"):
        clip.move(0.0, 0.5)
    with pytest.raises(KeyError):
        clip.move(9.0, 10.0)
    assert remove_keyframe(clip, 0.5) is True
    assert remove_keyframe(clip, 0.5) is False


def test_default_character_has_expected_parts():
    skel = default_character()
    assert {"head", "spine", "forearm_l", "shin_r"} <= set(skel.bones)
