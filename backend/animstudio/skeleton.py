"""2D 骨架定义与结构校验。

每个骨骼在父空间内定义：本地平移（相对父节点挂点）、本地旋转（弧度）与长度。
根骨骼 parent 为 None，position 是世界坐标。旋转采用弧度，允许任意标量值。
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable


class SkeletonError(ValueError):
    """骨架结构非法时抛出，message 指出具体冲突。"""


@dataclass(frozen=True)
class Bone:
    id: str
    parent: str | None
    length: float
    # 静止姿态（bind pose）：根骨骼为世界坐标，其余为父空间内偏移
    position: tuple[float, float] = (0.0, 0.0)
    rotation: float = 0.0


class Skeleton:
    def __init__(self, bones: Iterable[Bone]):
        self.bones: dict[str, Bone] = {}
        for b in bones:
            if b.id in self.bones:
                raise SkeletonError(f"骨骼 id 重复: {b.id!r}")
            self.bones[b.id] = b
        validate_skeleton(self)
        self._order = self._compute_order()

    def _compute_order(self) -> list[str]:
        order: list[str] = []
        visiting: set[str] = set()

        def visit(bid: str, stack: list[str]) -> None:
            if bid in visiting:
                cycle = " -> ".join(stack[stack.index(bid):] + [bid])
                raise SkeletonError(f"父子关系存在环: {cycle}")
            if bid in order:
                return
            visiting.add(bid)
            stack.append(bid)
            parent = self.bones[bid].parent
            if parent is not None:
                visit(parent, stack)
            stack.pop()
            visiting.discard(bid)
            order.append(bid)

        for bid in self.bones:
            visit(bid, [])
        return order

    @property
    def root_ids(self) -> list[str]:
        return [bid for bid in self._order if self.bones[bid].parent is None]

    def children(self, bid: str) -> list[str]:
        return [c for c in self._order if self.bones[c].parent == bid]

    def ordered_ids(self) -> list[str]:
        return list(self._order)

    def to_dict(self) -> dict:
        return {
            "bones": [
                {
                    "id": b.id,
                    "parent": b.parent,
                    "length": b.length,
                    "position": [b.position[0], b.position[1]],
                    "rotation": b.rotation,
                }
                for b in (self.bones[k] for k in self._order)
            ]
        }

    @classmethod
    def from_dict(cls, data: dict) -> "Skeleton":
        bones: list[Bone] = []
        for raw in data.get("bones", []):
            pos = raw.get("position", [0.0, 0.0])
            bones.append(
                Bone(
                    id=str(raw["id"]),
                    parent=raw.get("parent"),
                    length=float(raw["length"]),
                    position=(float(pos[0]), float(pos[1])),
                    rotation=float(raw.get("rotation", 0.0)),
                )
            )
        return cls(bones)


def validate_skeleton(skeleton: Skeleton) -> None:
    """检查骨架结构冲突，逐条收集错误后统一抛出。"""
    errors: list[str] = []
    if not skeleton.bones:
        errors.append("骨架至少需要一个骨骼")

    for bid, bone in skeleton.bones.items():
        if not bid:
            errors.append("存在空 id 的骨骼")
        if bone.parent is not None and bone.parent not in skeleton.bones:
            errors.append(f"骨骼 {bid!r} 的父骨骼 {bone.parent!r} 不存在")
        if bone.parent == bid:
            errors.append(f"骨骼 {bid!r} 不能以自身为父")
        if bone.length < 0:
            errors.append(f"骨骼 {bid!r} 长度不能为负: {bone.length}")

    # 环检测（DFS 三色法）
    WHITE, GRAY, BLACK = 0, 1, 2
    color = {bid: WHITE for bid in skeleton.bones}

    def dfs(bid: str, path: list[str]) -> None:
        color[bid] = GRAY
        path.append(bid)
        parent = skeleton.bones[bid].parent
        if parent is not None and parent in skeleton.bones and parent != bid:
            if color[parent] == GRAY:
                start = path.index(parent)
                errors.append("父子关系存在环: " + " -> ".join(path[start:] + [parent]))
            elif color[parent] == WHITE:
                dfs(parent, path)
        path.pop()
        color[bid] = BLACK

    for bid in skeleton.bones:
        if color[bid] == WHITE:
            dfs(bid, [])

    if errors:
        raise SkeletonError("; ".join(errors))
