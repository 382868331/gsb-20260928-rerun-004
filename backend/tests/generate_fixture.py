"""生成前后端一致性夹具：后端项目 + 后端导出的动作采样。

运行: python tests/generate_fixture.py > ../frontend/test/fixture.json
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from animstudio import AnimationClip, Keyframe, default_character, evaluate_clip, export_clip
from animstudio.project import Project

if __name__ == "__main__":
    skeleton = default_character()
    clip = AnimationClip(
        [
            Keyframe(0.0, {"spine": 0.0, "head": 0.0, "thigh_l": 0.0, "forearm_r": 6.0}),
            Keyframe(0.5, {"spine": 0.2, "head": 0.3, "thigh_l": -0.4, "forearm_r": 0.3}),
            Keyframe(1.0, {"spine": -0.1, "head": -0.2, "thigh_l": 0.5, "forearm_r": -0.2}),
        ],
        duration=1.0,
    )
    project = Project("fixture", skeleton, clip)
    samples = [evaluate_clip(skeleton, clip, t) for t in (0.0, 0.125, 0.37, 0.5, 0.81, 1.0)]
    exported = export_clip(skeleton, clip, fps=10)
    fixture = {"project": project.to_dict(), "samples": samples, "exported": exported}
    print(json.dumps(fixture, ensure_ascii=False))
