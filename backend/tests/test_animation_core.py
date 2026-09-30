import math
import unittest

from copy import deepcopy

from animation_core import (
    default_project,
    evaluate_world,
    export_action,
    layer_weight,
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
        project["keyframes"][0]["pose"]["upper_arm_r"]["rotation"] = 350.0
        project["keyframes"][1]["pose"]["upper_arm_r"]["rotation"] = 350.0
        project["keyframes"][2]["pose"]["upper_arm_r"]["rotation"] = 10.0
        middle = sample_local(project, 0.9)
        normalized = (middle["upper_arm_r"]["rotation"] + 360.0) % 360.0
        self.assertTrue(math.isclose(normalized, 0.0, abs_tol=1e-12))

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

    def test_layer_only_affects_selected_bones_and_weight_grades(self):
        project = default_project()
        layer = project["layers"][0]
        outside_start = sample_local(project, 0.2)
        self.assertAlmostEqual(outside_start["upper_arm_r"]["rotation"], 0.0)
        middle = sample_local(project, 0.65)
        self.assertAlmostEqual(middle["upper_arm_r"]["rotation"], -10.0)
        self.assertAlmostEqual(middle["forearm_l"]["rotation"], 0.0)
        self.assertAlmostEqual(middle["thigh_l"]["rotation"], 15.0, places=6)
        fade_in = sample_local(project, 0.3)
        self.assertAlmostEqual(abs(fade_in["upper_arm_r"]["rotation"]), 1.111111111111, delta=1e-9)
        partial = sample_local(project, 0.5)
        self.assertLess(abs(partial["upper_arm_r"]["rotation"]), abs(middle["upper_arm_r"]["rotation"]))

    def test_layer_angle_crosses_zero_with_shortest_path(self):
        project = default_project()
        pose = sample_local(project, 0.8)
        self.assertTrue(-90.0 <= pose["upper_arm_r"]["rotation"] <= 90.0)

    def test_layer_fade_is_continuous_at_range_boundaries(self):
        project = default_project()
        layer = project["layers"][0]
        self.assertEqual(layer_weight(layer, layer["start"]), 0.0)
        self.assertEqual(layer_weight(layer, layer["end"]), 0.0)
        full = layer_weight(layer, 0.5)
        self.assertAlmostEqual(full, 1.0)
        self.assertAlmostEqual(layer_weight(layer, layer["start"] + layer["fade_in"] / 2), 0.5)
        self.assertAlmostEqual(layer_weight(layer, layer["end"] - layer["fade_out"] / 2), 0.5)
        at_start = sample_local(project, layer["start"])
        self.assertAlmostEqual(at_start["upper_arm_r"]["rotation"], 0.0)
        at_end = sample_local(project, layer["end"])
        self.assertAlmostEqual(at_end["upper_arm_r"]["rotation"], 0.0)

    def test_parent_bone_not_in_layer_does_not_double_rotate_children(self):
        project = default_project()
        layer = project["layers"][0]
        layer["bones"] = ["forearm_r"]
        layer["reference"] = deepcopy(layer["keyframes"][0]["pose"])
        for frame in layer["keyframes"]:
            frame["pose"]["forearm_r"]["rotation"] = 30.0
        for frame in project["keyframes"]:
            frame["pose"]["spine"]["rotation"] = 0.0
        world = evaluate_world(project, 0.65)
        self.assertAlmostEqual(world["upper_arm_r"]["rotation"], 0.0)
        self.assertAlmostEqual(world["forearm_r"]["rotation"], 30.0)

    def test_default_layered_project_validates_and_exports_consistently(self):
        project = default_project()
        self.assertEqual(validate_project(project), [])
        action = export_action(project, fps=24)
        for frame in action["frames"]:
            expected_world = evaluate_world(project, frame["time"])
            for bone_id, expected in expected_world.items():
                actual = frame["world"][bone_id]
                self.assertTrue(math.isclose(actual["rotation"], expected["rotation"], abs_tol=1e-12))


if __name__ == "__main__":
    unittest.main()
