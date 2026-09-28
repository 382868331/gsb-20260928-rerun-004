"""工程文件存储：骨架 + 动画片段的 JSON 持久化。"""

from __future__ import annotations

import json
import tempfile
from dataclasses import dataclass
from pathlib import Path

from .animation import AnimationClip
from .skeleton import Skeleton


@dataclass
class Project:
    name: str
    skeleton: Skeleton
    clip: AnimationClip

    def to_dict(self) -> dict:
        return {
            "format": "animstudio.project.v1",
            "name": self.name,
            "skeleton": self.skeleton.to_dict(),
            "clip": self.clip.to_dict(),
        }

    @classmethod
    def from_dict(cls, data: dict) -> "Project":
        return cls(
            name=str(data.get("name", "untitled")),
            skeleton=Skeleton.from_dict(data["skeleton"]),
            clip=AnimationClip.from_dict(data.get("clip", {})),
        )


class ProjectStore:
    def __init__(self, root: str | Path):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)

    def _path(self, name: str) -> Path:
        if not name or Path(name).name != name or name in (".", ".."):
            raise ValueError(f"非法工程名: {name!r}")
        return self.root / f"{name}.json"

    def list_projects(self) -> list[str]:
        return sorted(p.stem for p in self.root.glob("*.json"))

    def save(self, project: Project) -> Path:
        path = self._path(project.name)
        # 原子写：先写临时文件再替换，避免保存中断产生损坏工程
        fd, tmp_name = tempfile.mkstemp(dir=self.root, suffix=".tmp")
        try:
            with open(fd, "w", encoding="utf-8") as f:
                json.dump(project.to_dict(), f, ensure_ascii=False, indent=2)
            Path(tmp_name).replace(path)
        except BaseException:
            Path(tmp_name).unlink(missing_ok=True)
            raise
        return path

    def load(self, name: str) -> Project:
        path = self._path(name)
        with open(path, "r", encoding="utf-8") as f:
            return Project.from_dict(json.load(f))

    def exists(self, name: str) -> bool:
        return self._path(name).exists()

    def delete(self, name: str) -> bool:
        path = self._path(name)
        if path.exists():
            path.unlink()
            return True
        return False
