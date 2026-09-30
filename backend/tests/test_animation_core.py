import json
import math
import unittest

from animation_core import (
    default_project,
    evaluate_world,
    export_action,
    layer_envelope,
    sample_local,
    shortest_angle_delta,
    validate_project,
)


class AnimationCoreTests(unittest.TestCase):
    def test_shortest_angle_does_not_take_long_way(self):
        self.assertEqual(shortest_angle_delta(350.0, 10.0), 20.0)
        self.assertEqual(shortest_angle_delta(10.0, 350.0), -20.0)

    def test_parent_transform_drives_child(self):
        project = default_project()
        frame = project["keyframes"][0]
        frame["pose"]["spine"]["rotation"] = 90.0
        world = evaluate_world(project, 0.0)
        self.assertAlmostEqual(world["spine"]["x"], 0.0)
        self.assertAlmostEqual(world["spine"]["y"], -55.0)
        self.assertAlmostEqual(world["head"]["x"], 48.0)
        self.assertAlmostEqual(world["head"]["y"], -55.0)
        self.assertAlmostEqual(world["head"]["rotation"], 90.0)

    def test_interpolation_uses_shortest_angular_path(self):
        project = default_project()
        project["layers"] = []
        middle = sample_local(project, 0.9)
        normalized = (middle["upper_arm_r"]["rotation"] + 360.0) % 360.0
        self.assertTrue(math.isclose(normalized, 0.0, abs_tol=1e-12))

    def test_layer_only_overrides_listed_bones_with_weight(self):
        project = default_project()
        outside = sample_local(project, 0.0)
        self.assertAlmostEqual(outside["upper_arm_r"]["rotation"], 0.0)
        active = sample_local(project, 0.6)
        self.assertAlmostEqual(active["thigh_r"]["rotation"], -18.0)
        self.assertAlmostEqual(active["upper_arm_r"]["rotation"], 355.0)
        self.assertAlmostEqual(active["forearm_r"]["rotation"], -30.0)

    def test_layer_fade_uses_shortest_angle_path(self):
        project = default_project()
        faded = sample_local(project, 0.25)
        overlay_rotation = 350.0 + shortest_angle_delta(350.0, 15.0) * (0.25 / 0.3)
        self.assertAlmostEqual(faded["upper_arm_r"]["rotation"], shortest_angle_delta(0.0, overlay_rotation) * 0.5, places=6)
        self.assertTrue(-17.5 < faded["forearm_r"]["rotation"] < 0.0)
        self.assertAlmostEqual(sample_local(project, 0.15)["upper_arm_r"]["rotation"], 0.0, places=9)
        self.assertTrue(math.isclose(layer_envelope(project["layers"][0], 0.15), 0.0))
        self.assertTrue(math.isclose(layer_envelope(project["layers"][0], 0.35), 1.0))
        self.assertTrue(math.isclose(layer_envelope(project["layers"][0], 1.05), 0.0))

    def test_child_of_rotating_unselected_parent_keeps_unambiguous_local_space(self):
        project = default_project()
        project["layers"] = []
        project["keyframes"][0]["pose"]["spine"]["rotation"] = 30.0
        project["layers"] = [{
            "id": "aim",
            "name": "右臂瞄准",
            "weight": 1.0,
            "start": 0.0,
            "end": 1.2,
            "fade_in": 0.0,
            "fade_out": 0.0,
            "bones": ["upper_arm_r"],
            "keyframes": [
                {"id": "aim-0", "time": 0.0, "pose": {"upper_arm_r": {"x": 22.0, "y": -8.0, "rotation": 90.0}}},
                {"id": "aim-1", "time": 1.2, "pose": {"upper_arm_r": {"x": 22.0, "y": -8.0, "rotation": 90.0}}},
            ],
        }]
        world = evaluate_world(project, 0.0)
        self.assertAlmostEqual(world["upper_arm_r"]["rotation"], 120.0)
        self.assertAlmostEqual(world["forearm_r"]["rotation"], 120.0)

    def test_layers_round_trip_and_export_matches_evaluation(self):
        saved = json.loads(json.dumps(default_project()))
        self.assertEqual(validate_project(saved), [])
        action = export_action(saved, fps=24)
        for frame in action["frames"]:
            expected = evaluate_world(saved, frame["time"])
            for bone_id, transform in expected.items():
                self.assertTrue(math.isclose(frame["world"][bone_id]["rotation"], transform["rotation"], abs_tol=1e-12))

    def test_layer_validation_reports_bad_bone_and_fade(self):
        project = default_project()
        project["layers"][0]["bones"] = ["upper_arm_r", "ghost"]
        errors = validate_project(project)
        self.assertTrue(any("未知骨骼 ghost" in error for error in errors))
        project = default_project()
        project["layers"][0]["fade_in"] = 1.0
        project["layers"][0]["fade_out"] = 1.0
        errors = validate_project(project)
        self.assertTrue(any("淡入淡出" in error for error in errors))

    def test_export_frames_match_evaluation(self):
        project = default_project()
        action = export_action(project, fps=24)
        self.assertEqual(len(action["frames"]), round(project["duration"] * 24) + 1)
        for frame in action["frames"]:
            expected_world = evaluate_world(project, frame["time"])
            for bone_id, expected in expected_world.items():
                actual = frame["world"][bone_id]
                self.assertTrue(math.isclose(actual["x"], expected["x"], abs_tol=1e-12))
                self.assertTrue(math.isclose(actual["y"], expected["y"], abs_tol=1e-12))
                self.assertTrue(math.isclose(actual["rotation"], expected["rotation"], abs_tol=1e-12))

    def test_broken_parent_references_are_reported(self):
        project = default_project()
        project["skeleton"]["bones"][1]["parent"] = "missing"
        errors = validate_project(project)
        self.assertTrue(any("不存在的父骨骼" in error for error in errors))

    def test_parent_cycle_is_reported(self):
        project = default_project()
        project["skeleton"]["bones"][2]["parent"] = "head"
        errors = validate_project(project)
        self.assertIn("骨骼 head 不能把自己设为父骨骼", errors)


if __name__ == "__main__":
    unittest.main()
