"""FastAPI 服务：工程增删改查、逐时刻求值、导出。"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from .animation import AnimationClip, Keyframe, evaluate_clip
from .characters import default_character
from .export import export_clip
from .project import Project, ProjectStore
from .skeleton import Bone, Skeleton, SkeletonError

STORE_ROOT = Path(os.environ.get("ANIMSTUDIO_STORE", Path(__file__).resolve().parent.parent / "data"))
store = ProjectStore(STORE_ROOT)

app = FastAPI(title="角色动画制作台 API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class BoneModel(BaseModel):
    id: str
    parent: Optional[str] = None
    length: float = 0.0
    position: tuple[float, float] = (0.0, 0.0)
    rotation: float = 0.0


class KeyframeModel(BaseModel):
    time: float = Field(ge=0)
    pose: dict[str, float] = {}


class ClipModel(BaseModel):
    duration: Optional[float] = Field(default=None, ge=0)
    keyframes: list[KeyframeModel] = []


class ProjectModel(BaseModel):
    name: str
    skeleton: list[BoneModel]
    clip: ClipModel = ClipModel()


def _build_skeleton(bones: list[BoneModel]) -> Skeleton:
    try:
        return Skeleton(
            Bone(b.id, b.parent, b.length, b.position, b.rotation) for b in bones
        )
    except SkeletonError as exc:
        raise HTTPException(status_code=422, detail=f"骨架结构冲突: {exc}") from exc


def _build_project(model: ProjectModel) -> Project:
    skeleton = _build_skeleton(model.skeleton)
    clip = AnimationClip(
        [Keyframe(k.time, k.pose) for k in model.clip.keyframes],
        duration=model.clip.duration,
    )
    # 关键帧姿态引用的骨骼必须存在
    for kf in clip.keyframes:
        unknown = set(kf.pose) - set(skeleton.bones)
        if unknown:
            raise HTTPException(
                status_code=422,
                detail=f"关键帧 t={kf.time:g} 引用了不存在的骨骼: {sorted(unknown)}",
            )
    return Project(name=model.name, skeleton=skeleton, clip=clip)

@app.get("/api/health")
async def health():
    return {"ok": True}


@app.get("/api/character/default")
async def get_default_character():
    skeleton = default_character()
    return {"name": "stickman", "skeleton": skeleton.to_dict()}


@app.post("/api/skeleton/validate")
async def validate(bones: list[BoneModel]):
    _build_skeleton(bones)
    return {"valid": True}


@app.get("/api/projects")
async def list_projects():
    return {"projects": store.list_projects()}


@app.put("/api/projects/{name}")
async def save_project(name: str, model: ProjectModel):
    if name != model.name:
        raise HTTPException(status_code=400, detail="URL 工程名与请求体不一致")
    project = _build_project(model)
    # 在线程池不可用的环境下退化为异步文件写入
    path = store.save(project)
    return {"saved": True, "path": str(path), "keyframes": len(project.clip)}


@app.get("/api/projects/{name}")
async def get_project(name: str):
    try:
        project = store.load(name)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"工程 {name!r} 不存在")
    return project.to_dict()


@app.delete("/api/projects/{name}")
async def delete_project(name: str):
    return {"deleted": store.delete(name)}


@app.post("/api/projects/{name}/evaluate")
async def evaluate(name: str, time: float):
    try:
        project = store.load(name)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"工程 {name!r} 不存在")
    return {"time": time, "bones": evaluate_clip(project.skeleton, project.clip, time)}


class EvaluateBody(BaseModel):
    project: ProjectModel
    time: float


@app.post("/api/evaluate")
async def evaluate_inline(body: EvaluateBody):
    project = _build_project(body.project)
    return {"time": body.time, "bones": evaluate_clip(project.skeleton, project.clip, body.time)}


@app.post("/api/projects/{name}/export")
async def export_project(name: str, fps: int = 30):
    try:
        project = store.load(name)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"工程 {name!r} 不存在")
    return export_clip(project.skeleton, project.clip, fps=fps)
