import math

import pytest

from animstudio import (
    Bone,
    Skeleton,
    SkeletonError,
    evaluate_world,
)


def make_chain():
    # root 在原点沿 x 轴，两根长度 1 的骨骼串成链
    return Skeleton(
        [
            Bone("a", None, 1.0),
            Bone("b", "a", 1.0, position=(1.0, 0.0)),
            Bone("c", "b", 1.0, position=(1.0, 0.0)),
        ]
    )


def test_bind_pose_chain():
    skel = make_chain()
    world = evaluate_world(skel)
    assert world["a"].x == 0 and world["a"].y == 0
    assert world["b"].x == pytest.approx(1.0)
    assert world["c"].x == pytest.approx(2.0)


def test_child_follows_parent_rotation():
    skel = make_chain()
    world = evaluate_world(skel, {"a": math.pi / 2})
    # 整链向上：b 起点在 (0,1)，c 起点在 (0,2)
    assert world["b"].x == pytest.approx(0.0, abs=1e-12)
    assert world["b"].y == pytest.approx(1.0, abs=1e-12)
    assert world["c"].x == pytest.approx(0.0, abs=1e-12)
    assert world["c"].y == pytest.approx(2.0, abs=1e-12)
    assert world["c"].angle == pytest.approx(math.pi / 2)


def test_rotations_accumulate():
    skel = make_chain()
    world = evaluate_world(skel, {"a": 0.5, "b": 0.25, "c": -0.75})
    assert world["a"].angle == pytest.approx(0.5)
    assert world["b"].angle == pytest.approx(0.75)
    assert world["c"].angle == pytest.approx(0.0)


def test_missing_parent_conflict():
    with pytest.raises(SkeletonError, match="父骨骼"):
        Skeleton([Bone("a", "ghost", 1.0)])


def test_cycle_conflict():
    with pytest.raises(SkeletonError, match="环"):
        Skeleton(
            [
                Bone("a", "c", 1.0),
                Bone("b", "a", 1.0),
                Bone("c", "b", 1.0),
            ]
        )


def test_duplicate_id_conflict():
    with pytest.raises(SkeletonError, match="重复"):
        Skeleton([Bone("a", None, 1.0), Bone("a", None, 1.0)])


def test_self_parent_conflict():
    with pytest.raises(SkeletonError, match="自身"):
        Skeleton([Bone("a", "a", 1.0)])
