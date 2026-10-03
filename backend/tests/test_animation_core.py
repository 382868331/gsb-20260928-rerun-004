import json
import math
import unittest
from copy import deepcopy
from pathlib import Path

from animation_core import (
    analyze_rebake,
    analyze_shared_rebake,
    analyze_withdraw,
    apply_rebake,
    bake_action,
    compare_action_variants,
    create_plan,
    default_project,
    delete_plan,
    evaluate_world,
    export_action,
    layer_envelope,
    load_project,
    migrate_project,
    publish_plan,
    sample_local,
    save_project,
    weight_key_multiplier,
    shortest_angle_delta,
    validate_project,
    withdraw_decision,
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

    def test_bake_allows_smooth_weight_transition_keyframes(self):
        project = default_project()
        project["layers"][0]["weight_keys"] = [
            {"id": "wk-0", "time": 0.2, "weight": 0.0},
            {"id": "wk-1", "time": 0.5, "weight": 1.0},
            {"id": "wk-2", "time": 0.9, "weight": 0.3},
        ]
        bone_ids = [bone["id"] for bone in project["skeleton"]["bones"]]
        action = bake_action(project, 0.15, 1.05, bone_ids, "过渡", action_id="a-w")
        self.assertEqual(validate_project({**project, "actions": [action]}), [])
        for frame in action["keyframes"]:
            source_pose = sample_local(project, 0.15 + frame["time"])
            for bone_id in ("upper_arm_r", "forearm_r"):
                self.assertLessEqual(
                    abs(shortest_angle_delta(frame["pose"][bone_id]["rotation"], source_pose[bone_id]["rotation"])),
                    1e-7,
                )
        self.assertTrue(all(frame["origin"] == "baked" for frame in action["keyframes"]))

    def test_rebake_analysis_and_partial_apply_keep_manual_and_continuity(self):
        project = default_project()
        bone_ids = [bone["id"] for bone in project["skeleton"]["bones"]]
        action = bake_action(project, 0.0, 1.2, bone_ids, "片段", action_id="a1")
        project["actions"] = [action]
        # manual retouch on the action, then a source edit that overlaps it
        project["actions"][0]["keyframes"][10]["pose"]["spine"]["rotation"] = 45.0
        project["actions"][0]["keyframes"][10]["origin"] = "manual"
        project["version"] = 2
        project["keyframes"][1]["pose"]["spine"]["rotation"] = 9.0
        segments = analyze_rebake(project, project["actions"][0])
        self.assertTrue(segments)
        self.assertTrue(any(segment["manual"] for segment in segments))
        self.assertTrue(all("spine" in segment["bones"] for segment in segments))
        manual_segment = next(segment for segment in segments if segment["manual"])
        other_segments = [segment for segment in segments if segment is not manual_segment]
        # keep the manual segment, adopt source for the rest
        decisions = [{"segment": {"start": s["start"], "end": s["end"]}, "resolution": "source"} for s in other_segments]
        decisions.append({"segment": {"start": manual_segment["start"], "end": manual_segment["end"]}, "resolution": "keep"})
        updated = apply_rebake(project, "a1", decisions)
        self.assertEqual(updated["revision"], 2)
        self.assertEqual(len(updated["previous_versions"]), 1)
        kept = [f for f in updated["keyframes"] if f.get("origin") == "manual"]
        self.assertEqual(len(kept), 1)
        self.assertAlmostEqual(kept[0]["pose"]["spine"]["rotation"], 45.0)
        # adopted frames match the source exactly; neighbours were untouched source
        # samples, so segment boundaries stay pose-continuous
        for frame in updated["keyframes"]:
            if frame.get("origin") == "baked":
                source_pose = sample_local(project, frame["time"])
                self.assertLessEqual(
                    abs(shortest_angle_delta(frame["pose"]["spine"]["rotation"], source_pose["spine"]["rotation"])),
                    1e-7,
                )
        # remaining diff is only the kept manual frame
        remaining = analyze_rebake(project, updated)
        self.assertTrue(all(segment["manual"] for segment in remaining))
        # now adopt the source over the manual frame too
        final = apply_rebake(project | {"actions": [updated]}, "a1",
                               [{"segment": {"start": s["start"], "end": s["end"]}, "resolution": "source"} for s in remaining])
        self.assertEqual(analyze_rebake(project, final), [])
        self.assertEqual(final["source"]["source_version"], 2)
        self.assertEqual(len(final["previous_versions"]), 2)
        round_trip = json.loads(json.dumps({**project, "actions": [final]}))
        self.assertEqual(validate_project(round_trip), [])


class SharedSourceRebakeTests(unittest.TestCase):
    def _project_with_two_actions(self):
        project = default_project()
        bone_ids = [bone["id"] for bone in project["skeleton"]["bones"]]
        walk = bake_action(project, 0.0, 1.2, bone_ids, "走路整理", action_id="walk")
        turn = bake_action(project, 0.0, 1.2, bone_ids, "转身整理", action_id="turn")
        # each action already has its own manual retouch on a different bone
        walk["keyframes"][10]["pose"]["spine"]["rotation"] = 45.0
        walk["keyframes"][10]["origin"] = "manual"
        turn["keyframes"][20]["pose"]["upper_arm_r"]["rotation"] = 90.0
        turn["keyframes"][20]["origin"] = "manual"
        project["actions"] = [walk, turn]
        return project, bone_ids

    def test_shared_source_reports_each_action_independently(self):
        project, _ = self._project_with_two_actions()
        project["version"] = 2
        project["keyframes"][1]["pose"]["spine"]["rotation"] = 9.0
        overview = analyze_shared_rebake(project)
        self.assertEqual({item["action_id"] for item in overview}, {"walk", "turn"})
        for item in overview:
            self.assertEqual(item["source_version"], 1)
            self.assertEqual(item["current_source_version"], 2)
            self.assertTrue(all("spine" in segment["bones"] for segment in item["segments"]))
        # adopting on one action must not touch the other
        walk_segments = next(item for item in overview if item["action_id"] == "walk")["segments"]
        decisions = [
            {"segment": {"start": s["start"], "end": s["end"]},
             "resolution": "keep" if s["manual"] else "source"}
            for s in walk_segments
        ]
        updated_walk = apply_rebake(project, "walk", decisions)
        project["actions"][0] = updated_walk
        turn_after = project["actions"][1]
        self.assertEqual(turn_after["revision"], 1)
        self.assertTrue(analyze_rebake(project, turn_after))
        self.assertEqual(len(turn_after["decision_log"]), 0)

    def test_kept_manual_frames_attach_to_source_version_and_reflag_later(self):
        project, _ = self._project_with_two_actions()
        project["version"] = 2
        project["keyframes"][1]["pose"]["spine"]["rotation"] = 9.0
        walk = project["actions"][0]
        manual_segment = next(s for s in analyze_rebake(project, walk) if s["manual"])
        updated = apply_rebake(project, "walk", [
            {"segment": {"start": manual_segment["start"], "end": manual_segment["end"]}, "resolution": "keep"},
        ])
        kept = [f for f in updated["keyframes"] if f.get("origin") == "manual"]
        self.assertTrue(kept)
        self.assertTrue(all(f.get("kept_source_version") == 2 for f in kept))
        acknowledged = analyze_rebake(project, updated)
        self.assertTrue(all(segment["acknowledged"] for segment in acknowledged if segment["manual"]))
        # a newer source edit re-flags the same kept frames as a conflict
        project["actions"][0] = updated
        project["version"] = 3
        project["keyframes"][1]["pose"]["spine"]["rotation"] = 12.0
        reflagged = analyze_rebake(project, project["actions"][0])
        manual_segments = [s for s in reflagged if s["manual"]]
        self.assertTrue(manual_segments)
        self.assertTrue(any(not s["acknowledged"] for s in manual_segments))

    def test_plans_compare_publish_and_keep_other_plan_editable(self):
        project, _ = self._project_with_two_actions()
        project["version"] = 2
        project["keyframes"][1]["pose"]["spine"]["rotation"] = 9.0
        walk = project["actions"][0]
        segments = analyze_rebake(project, walk)
        manual_segment = next(s for s in segments if s["manual"])
        other_segments = [s for s in segments if not s["manual"]]
        # plan A: keep the manual wrist/spine fix, adopt the rest
        plan_a_decisions = [
            {"segment": {"start": s["start"], "end": s["end"]}, "resolution": "source"} for s in other_segments
        ] + [{"segment": {"start": manual_segment["start"], "end": manual_segment["end"]}, "resolution": "keep"}]
        # plan B: adopt the full new source everywhere
        plan_b_decisions = [
            {"segment": {"start": s["start"], "end": s["end"]}, "resolution": "source"} for s in segments
        ]
        walk = create_plan(project, "walk", "保留手工修正", plan_a_decisions)
        project["actions"][0] = walk
        walk = create_plan(project, "walk", "完整新上身", plan_b_decisions)
        project["actions"][0] = walk
        self.assertEqual(len(walk["plans"]), 2)
        self.assertEqual(walk["revision"], 1)  # plans never touch the action
        self.assertEqual(validate_project(project), [])

        report = compare_action_variants(project, "walk")
        self.assertEqual(len([v for v in report["variants"] if v["kind"] == "plan"]), 2)
        plan_diff = next(d for d in report["diffs"] if d["a"] != "current")
        self.assertTrue(plan_diff["frames"])
        # plan A keeps the manual frame: its diff vs current is source-driven only
        plan_a_id = walk["plans"][0]["id"]
        diff_a = next(d for d in report["diffs"] if d["b"] == plan_a_id)
        origins = {entry["origin"] for frame in diff_a["frames"] for entry in frame["bones"]}
        self.assertEqual(origins, {"source"})

        published = publish_plan(project, "walk", plan_a_id)
        self.assertEqual(published["revision"], 2)
        self.assertEqual(len(published["previous_versions"]), 1)
        self.assertEqual(len(published["decision_log"]), 1)
        self.assertEqual(published["decision_log"][0]["plan_id"], plan_a_id)
        self.assertTrue(published["plans"][0]["published"])
        self.assertFalse(published["plans"][1]["published"])  # still editable
        kept = [f for f in published["keyframes"] if f.get("origin") == "manual"]
        self.assertTrue(kept)
        # old published revision still playable
        old = published["previous_versions"][0]
        self.assertEqual(old["revision"], 1)
        self.assertTrue(old["keyframes"])
        with self.assertRaises(ValueError):
            publish_plan({**project, "actions": [published]}, "walk", plan_a_id)
        # deleting the other plan keeps the published one
        cleaned = delete_plan({**project, "actions": [published]}, "walk", walk["plans"][1]["id"])
        self.assertEqual(len(cleaned["plans"]), 1)

    def test_withdraw_shows_dependents_and_preserves_independent(self):
        project, _ = self._project_with_two_actions()
        walk = project["actions"][0]
        # first source revision affects spine around t=0.16
        project["version"] = 2
        project["keyframes"][1]["pose"]["spine"]["rotation"] = 9.0
        segments = analyze_rebake(project, walk)
        non_manual = [s for s in segments if not s["manual"]]
        first = apply_rebake(project, "walk", [
            {"segment": {"start": s["start"], "end": s["end"]}, "resolution": "source"} for s in non_manual
        ])
        project["actions"][0] = first
        # second source revision affects a disjoint bone (head) later in time
        project["version"] = 3
        project["keyframes"][1]["pose"]["head"] = {"x": 5.0, "y": -48.0, "rotation": 30.0}
        second_segments = [s for s in analyze_rebake(project, first) if "head" in s["bones"]]
        self.assertTrue(second_segments)
        second = apply_rebake(project, "walk", [
            {"segment": {"start": s["start"], "end": s["end"]}, "resolution": "source"} for s in second_segments
        ])
        project["actions"][0] = second
        self.assertEqual(len(second["decision_log"]), 2)

        first_id = second["decision_log"][0]["id"]
        preview = analyze_withdraw(project, "walk", first_id)
        self.assertEqual(preview["dependents"], [])  # disjoint time/bones
        self.assertEqual([e["id"] for e in preview["independent"]], [second["decision_log"][1]["id"]])

        withdrawn = withdraw_decision(project, "walk", first_id)
        self.assertEqual(len(withdrawn["decision_log"]), 1)
        self.assertEqual(withdrawn["decision_log"][0]["id"], second["decision_log"][1]["id"])
        self.assertEqual(len(withdrawn["withdrawals"]), 1)
        # the independent later fix is still present: head still follows v3 source
        head_pose = sample_local(project, 0.6)["head"]
        from animation_core import sample_frames
        pose = sample_frames(withdrawn["keyframes"], 0.6)
        self.assertAlmostEqual(pose["head"]["rotation"], head_pose["rotation"], places=7)
        # withdrawing a decision that a later one overlaps pulls the dependent too
        project["version"] = 4
        project["keyframes"][1]["pose"]["spine"]["rotation"] = 20.0
        third_segments = [s for s in analyze_rebake(project, withdrawn) if "spine" in s["bones"] and not s["manual"]]
        if third_segments:
            third = apply_rebake(project, "walk", [
                {"segment": {"start": s["start"], "end": s["end"]}, "resolution": "source"} for s in third_segments
            ])
            project["actions"][0] = third
            earlier = third["decision_log"][0]["id"]
            preview = analyze_withdraw(project, "walk", earlier)
            overlapping = [e for e in third["decision_log"][1:]
                           if any(set(seg["bones"]) & {"spine"} for seg in e["segments"])]
            if overlapping:
                self.assertTrue(preview["dependents"])

    def test_shared_state_survives_save_and_reload(self):
        import tempfile
        project, _ = self._project_with_two_actions()
        project["version"] = 2
        project["keyframes"][1]["pose"]["spine"]["rotation"] = 9.0
        walk = project["actions"][0]
        segments = analyze_rebake(project, walk)
        walk = create_plan(project, "walk", "方案甲", [
            {"segment": {"start": s["start"], "end": s["end"]},
             "resolution": "keep" if s["manual"] else "source"} for s in segments
        ])
        project["actions"][0] = walk
        published = publish_plan(project, "walk", walk["plans"][0]["id"])
        project["actions"][0] = published
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "project.json"
            save_project(path, project)
            loaded = load_project(path)
        loaded_walk = next(a for a in loaded["actions"] if a["id"] == "walk")
        self.assertEqual(loaded_walk["plans"][0]["published"], True)
        self.assertEqual(len(loaded_walk["decision_log"]), 1)
        self.assertEqual(len(loaded_walk["previous_versions"]), 1)
        self.assertEqual(loaded_walk["revision"], 2)
        self.assertEqual(validate_project(loaded), [])
        # withdrawal scope identical after reload
        decision_id = loaded_walk["decision_log"][0]["id"]
        preview = analyze_withdraw(loaded, "walk", decision_id)
        self.assertEqual(preview["withdrawn_ids"], [decision_id])


if __name__ == "__main__":
    unittest.main()
