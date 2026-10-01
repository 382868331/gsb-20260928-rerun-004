import json
import math
import unittest
from copy import deepcopy
from pathlib import Path

from animation_core import (
    apply_rework,
    bake_action,
    default_project,
    evaluate_world,
    export_action,
    layer_envelope,
    load_project,
    mark_frame_manual,
    migrate_project,
    rework_analysis,
    revert_rework,
    sample_local,
    weight_key_multiplier,
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

    def test_weight_keys_interpolate_and_support_reverse_adjustment(self):
        project = default_project()
        layer = project["layers"][0]
        layer["weight_keys"] = [
            {"id": "wk-0", "time": 0.15, "weight": 0.0},
            {"id": "wk-1", "time": 0.45, "weight": 1.0},
            {"id": "wk-2", "time": 0.75, "weight": 0.2},
        ]
        self.assertAlmostEqual(weight_key_multiplier(layer, 0.30), 0.5, places=9)
        self.assertAlmostEqual(weight_key_multiplier(layer, 0.60), 0.6, places=9)
        # reverse the key mid-transition: envelope immediately follows new values
        layer["weight_keys"][1]["weight"] = 0.0
        self.assertAlmostEqual(weight_key_multiplier(layer, 0.30), 0.0, places=9)
        bad = deepcopy(project)
        bad["layers"][0]["weight_keys"] = [{"id": "x", "time": 0.4, "weight": 2.0}]
        self.assertTrue(any("0~1" in error for error in validate_project(bad)))

    def test_bake_preserves_composed_pose_over_range_and_bones(self):
        project = default_project()
        bone_ids = [bone["id"] for bone in project["skeleton"]["bones"]]
        action = bake_action(project, 0.2, 1.0, bone_ids, "片段", action_id="a1")
        self.assertEqual(validate_project({**project, "actions": [action]}), [])
        self.assertAlmostEqual(action["duration"], 0.8)
        self.assertEqual(action["source"]["source_version"], 1)
        self.assertEqual(action["source"]["range_start"], 0.2)
        self.assertEqual(action["layers"], [])
        frame_count = int(round(0.8 * 60)) + 1
        for index in range(frame_count):
            source_time = 0.2 + min(index / 60, 0.8)
            baked_time = min(index / 60, 0.8)
            source_pose = sample_local(project, source_time)
            baked_pose = sample_local(action, baked_time)
            for bone_id in bone_ids:
                # exact at frame times; tiny linear-interpolation error between them
                self.assertLessEqual(abs(shortest_angle_delta(baked_pose[bone_id]["rotation"], source_pose[bone_id]["rotation"])), 0.05)
                self.assertTrue(math.isclose(baked_pose[bone_id]["x"], source_pose[bone_id]["x"], abs_tol=0.05))
        for index, frame in enumerate(action["keyframes"]):
            source_pose = sample_local(project, 0.2 + frame["time"])
            for bone_id in bone_ids:
                self.assertLessEqual(abs(shortest_angle_delta(frame["pose"][bone_id]["rotation"], source_pose[bone_id]["rotation"])), 1e-7)

    def test_bake_is_rejected_without_partial_result(self):
        project = default_project()
        with self.assertRaises(ValueError) as context:
            bake_action(project, 0.2, 1.0, ["upper_arm_r", "ghost"], "片段", fps=24)
        self.assertIn("缺失骨骼", str(context.exception))
        self.assertEqual(project.get("actions", []), [])
        project["layers"][0]["bones"] = ["upper_arm_r", "forearm_r"]
        with self.assertRaises(ValueError) as context:
            bake_action(project, 0.2, 1.0, ["upper_arm_r"], "片段", fps=24)
        self.assertIn("forearm_r", str(context.exception))

    def test_baked_action_keeps_source_provenance_for_re_baking_and_round_trip(self):
        project = default_project()
        bone_ids = [bone["id"] for bone in project["skeleton"]["bones"]]
        first = bake_action(project, 0.0, 0.6, bone_ids, "v1", action_id="a1")
        project["actions"] = [first]
        # modify base keyframes, then re-bake: provenance records the new source version
        project["version"] = 2
        project["keyframes"][1]["pose"]["spine"]["rotation"] = 9.0
        second = bake_action(project, 0.0, 0.6, bone_ids, "v2", action_id="a2")
        self.assertEqual(second["source"]["source_version"], 2)
        self.assertNotAlmostEqual(
            second["keyframes"][1]["pose"]["spine"]["rotation"],
            first["keyframes"][1]["pose"]["spine"]["rotation"],
        )
        round_trip = json.loads(json.dumps({**project, "actions": [first, second]}))
        self.assertEqual(validate_project(round_trip), [])

    def test_load_project_migrates_legacy_fields(self):
        import tempfile
        legacy = {"name": "old", "duration": 1.0, "skeleton": default_project()["skeleton"],
                  "keyframes": deepcopy(default_project()["keyframes"]), "layers": []}
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "project.json"
            path.write_text(json.dumps(legacy), encoding="utf-8")
            loaded = load_project(path)
        self.assertEqual(loaded["version"], 1)
        self.assertEqual(loaded["actions"], [])

    def test_bake_accepts_smooth_three_key_weight_transition(self):
        project = default_project()
        layer = project["layers"][0]
        layer["weight_keys"] = [
            {"id": "wk-0", "time": 0.15, "weight": 0.0},
            {"id": "wk-1", "time": 0.45, "weight": 1.0},
            {"id": "wk-2", "time": 0.75, "weight": 0.2},
        ]
        bone_ids = [bone["id"] for bone in project["skeleton"]["bones"]]
        action = bake_action(project, 0.2, 1.0, bone_ids, "片段", action_id="a1")
        self.assertEqual(action["source"]["baked_version"], 1)
        count = round(0.8 * 60) + 1
        for index in range(count):
            sample_time = round(0.2 + min(index / 60, 0.8), 9)
            local_time = round(sample_time - 0.2, 9)
            frame = min(action["keyframes"], key=lambda item: abs(item["time"] - local_time))
            source_pose = sample_local(project, sample_time)
            for bone_id in bone_ids:
                self.assertLessEqual(abs(shortest_angle_delta(
                    frame["pose"][bone_id]["rotation"], source_pose[bone_id]["rotation"],
                )), 1e-6)
                self.assertAlmostEqual(frame["pose"][bone_id]["x"], source_pose[bone_id]["x"], places=6)
                self.assertAlmostEqual(frame["pose"][bone_id]["y"], source_pose[bone_id]["y"], places=6)

    def test_partial_bone_bake_is_supported(self):
        project = default_project()
        action = bake_action(project, 0.0, 0.6, ["upper_arm_r", "forearm_r"], "手臂", action_id="arm")
        bundled = {**project, "actions": [action]}
        self.assertEqual(validate_project(bundled), [])

    def test_rework_reports_ranges_preserves_manual_and_reverts_independently(self):
        project = default_project()
        bone_ids = [bone["id"] for bone in project["skeleton"]["bones"]]
        action = bake_action(project, 0.0, 1.2, bone_ids, "全片段", action_id="a1")
        project["actions"] = [action]
        project["version"] = 2
        project["keyframes"][1]["pose"]["spine"]["rotation"] = 9.0
        first = apply_rework(project, "a1")
        self.assertTrue(first["archived_action_id"].endswith("-v1"))
        self.assertGreaterEqual(len(first["updated_frames"]), 1)

        frame = action["keyframes"][round(0.31 * 60)]
        frame["pose"]["spine"]["rotation"] = 77.0
        mark_frame_manual(frame, ["spine"])
        project["version"] = 3
        project["keyframes"][1]["pose"]["spine"]["rotation"] = 12.0

        analysis = rework_analysis(project, "a1")
        self.assertTrue(any(segment["has_manual"] for segment in analysis["segments"]))
        second = apply_rework(project, "a1")
        self.assertIn(frame["id"], second["kept_manual_frames"])
        self.assertEqual(frame["pose"]["spine"]["rotation"], 77.0)
        self.assertEqual(frame["manual_bones"], ["spine"])

        manual_segment = next(segment["id"] for segment in analysis["segments"] if frame["id"] in segment["manual_frame_ids"])
        third = apply_rework(project, "a1", [manual_segment], {frame["id"]: "source"})
        self.assertNotAlmostEqual(frame["pose"]["spine"]["rotation"], 77.0)
        self.assertEqual(frame["manual_bones"], [])

        latest_id = action["rework_history"][-1]["id"]
        revert_rework(project, "a1", latest_id)
        self.assertEqual(frame["pose"]["spine"]["rotation"], 77.0)
        first_id = action["rework_history"][0]["id"]
        revert_rework(project, "a1", first_id)
        self.assertEqual(frame["pose"]["spine"]["rotation"], 77.0)
        self.assertEqual(validate_project(project), [])
        archive = next(item for item in project["actions"] if item.get("readonly"))
        self.assertEqual(archive["source"]["archive_of"], "a1")

    def test_rework_failure_keeps_layer_project_intact(self):
        project = default_project()
        bone_ids = [bone["id"] for bone in project["skeleton"]["bones"]]
        action = bake_action(project, 0.0, 1.2, bone_ids, "全片段", action_id="a1")
        action_id_before = id(action)
        project["actions"] = [action]
        project["version"] = 2
        project["keyframes"][1]["pose"]["spine"]["rotation"] = 9.0
        project["skeleton"]["bones"][1]["parent"] = "ghost"
        with self.assertRaises(ValueError):
            apply_rework(project, "a1")
        self.assertEqual(len(project["actions"]), 1)
        self.assertEqual(id(project["actions"][0]), action_id_before)


if __name__ == "__main__":
    unittest.main()
