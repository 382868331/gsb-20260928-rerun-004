"""API 层测试：直接调用 async FastAPI 路由函数。

当前沙箱里 anyio 默认线程执行器与 Python 3.14 不兼容（请求挂起），
因此不走真实 HTTP；路由函数本身是薄封装，核心逻辑由其余测试套件覆盖。
"""

import asyncio

import pytest
from fastapi import HTTPException

import animstudio.api as api_module
from animstudio.api import (
    BoneModel,
    ClipModel,
    EvaluateBody,
    KeyframeModel,
    ProjectModel,
    evaluate,
    evaluate_inline,
    export_project,
    get_default_character,
    get_project,
    health,
    save_project,
    validate,
)
from animstudio.characters import default_character
from animstudio.project import ProjectStore


@pytest.fixture(autouse=True)
def temp_store(tmp_path, monkeypatch):
    monkeypatch.setattr(api_module, "store", ProjectStore(tmp_path))


def _bone_models():
    return [
        BoneModel(
            id=b.id,
            parent=b.parent,
            length=b.length,
            position=b.position,
            rotation=b.rotation,
        )
        for b in default_character().bones.values()
    ]


def _demo_model():
    return ProjectModel(
        name="demo",
        skeleton=_bone_models(),
        clip=ClipModel(
            duration=1.0,
            keyframes=[
                KeyframeModel(time=0.0, pose={"head": 0.0}),
                KeyframeModel(time=1.0, pose={"head": 0.5}),
            ],
        ),
    )


def test_health_and_default_character():
    assert asyncio.run(health()) == {"ok": True}
    body = asyncio.run(get_default_character())
    ids = [b["id"] for b in body["skeleton"]["bones"]]
    assert "pelvis" in ids and "head" in ids


def test_validate_rejects_bad_skeleton():
    with pytest.raises(HTTPException) as exc:
        asyncio.run(validate([BoneModel(id="a", parent="nope", length=1.0)]))
    assert exc.value.status_code == 422
    assert "冲突" in exc.value.detail


def test_project_save_load_evaluate_export_roundtrip():
    model = _demo_model()
    result = asyncio.run(save_project("demo", model))
    assert result["saved"] is True
    loaded = asyncio.run(get_project("demo"))
    assert loaded["clip"]["keyframes"][1]["pose"]["head"] == 0.5

    ev = asyncio.run(evaluate("demo", 0.5))
    exported = asyncio.run(export_project("demo", fps=2))
    assert exported["frameCount"] == 3
    mid = exported["frames"][1]
    assert mid["bones"]["head"]["angle"] == ev["bones"]["head"]["angle"]

    ev_inline = asyncio.run(evaluate_inline(EvaluateBody(project=model, time=0.25)))
    assert "bones" in ev_inline and ev_inline["time"] == 0.25


def test_save_rejects_unknown_bone_in_pose():
    model = ProjectModel(
        name="bad",
        skeleton=_bone_models(),
        clip=ClipModel(keyframes=[KeyframeModel(time=0.0, pose={"tail": 1.0})]),
    )
    with pytest.raises(HTTPException) as exc:
        asyncio.run(save_project("bad", model))
    assert exc.value.status_code == 422
    assert "tail" in exc.value.detail
