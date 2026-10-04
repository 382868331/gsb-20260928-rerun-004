import json
import math
import unittest
from copy import deepcopy
from pathlib import Path

from animation_core import (
    analyze_rebake,
    apply_rebake,
    bake_action,
    cancel_review_item,
    create_review_batch,
    create_variant,
    default_project,
    evaluate_world,
    export_action,
    layer_envelope,
    load_project,
    migrate_project,
    publish_variant,
    review_batch_summary,
    sample_local,
    set_review_item_decisions,
    submit_review_batch,
    weight_key_multiplier,
    shortest_angle_delta,
    validate_project,
    withdraw_decision,
    withdrawal_preview,
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

    def _project_with_shared_source_actions(self):
        project = default_project()
        bone_ids = [bone["id"] for bone in project["skeleton"]["bones"]]
        walk = bake_action(project, 0.0, 1.2, bone_ids, "走路上身", action_id="walk")
        turn = bake_action(project, 0.0, 1.2, bone_ids, "转身上身", action_id="turn")
        project["actions"] = [walk, turn]
        return project, bone_ids

    def test_shared_source_actions_are_not_force_synchronised(self):
        project, _ = self._project_with_shared_source_actions()
        project["version"] = 2
        project["keyframes"][1]["pose"]["spine"]["rotation"] = 9.0
        walk, turn = project["actions"]
        walk_segments = analyze_rebake(project, walk)
        turn_segments = analyze_rebake(project, turn)
        self.assertTrue(walk_segments and turn_segments)
        decisions = [
            {"segment": {"start": s["start"], "end": s["end"], "bones": s["bones"]}, "resolution": "source"}
            for s in walk_segments
        ]
        updated_walk = apply_rebake(project, "walk", decisions)
        self.assertEqual(analyze_rebake(project, updated_walk), [])
        # the sibling action sharing the same source is untouched and still pending
        self.assertEqual(turn["revision"], 1)
        self.assertEqual(analyze_rebake(project, turn), turn_segments)

    def test_variants_keep_manual_with_source_version_and_publish_independently(self):
        project, _ = self._project_with_shared_source_actions()
        project["actions"][0]["keyframes"][10]["pose"]["spine"]["rotation"] = 45.0
        project["actions"][0]["keyframes"][10]["origin"] = "manual"
        project["version"] = 2
        project["keyframes"][1]["pose"]["spine"]["rotation"] = 9.0

        action = create_variant(project, "walk", "保留手腕")
        project["actions"][0] = action
        variant_id = action["variants"][0]["id"]
        action = create_variant(project, "walk", "完整新上身")
        project["actions"][0] = action
        other_id = action["variants"][1]["id"]

        segments = analyze_rebake(project, action)
        decisions = [
            {
                "segment": {"start": s["start"], "end": s["end"], "bones": s["bones"]},
                "resolution": "keep" if s["manual"] else "source",
            }
            for s in segments
        ]
        updated = apply_rebake(project, "walk", decisions, variant_id)
        # the variant evolved; the action itself and the second variant did not
        self.assertEqual(updated["revision"], 1)
        self.assertEqual(updated["variants"][0]["revision"], 2)
        self.assertEqual(updated["variants"][1]["revision"], 1)
        kept = [f for f in updated["variants"][0]["keyframes"] if f.get("origin") == "manual"]
        self.assertEqual(len(kept), 1)
        self.assertEqual(kept[0]["origin_source_version"], 2)
        log = updated["decision_log"]
        self.assertTrue(all(entry["variant_id"] == variant_id for entry in log))
        self.assertTrue(all(entry["source_version"] == 2 for entry in log))
        self.assertTrue(any(entry["resolution"] == "keep" for entry in log))

        # second variant adopts the full new source instead
        project["actions"][0] = updated
        adopt_all = [
            {"segment": {"start": s["start"], "end": s["end"], "bones": s["bones"]}, "resolution": "source"}
            for s in segments
        ]
        updated = apply_rebake(project, "walk", adopt_all, other_id)
        self.assertEqual(
            [f for f in updated["variants"][1]["keyframes"] if f.get("origin") == "manual"],
            [],
        )

        published = publish_variant({**project, "actions": [updated]}, "walk", variant_id)
        self.assertEqual(published["revision"], 2)
        self.assertEqual(published["keyframes"], published["variants"][0]["keyframes"])
        self.assertEqual(published["variants"][0]["status"], "published")
        self.assertEqual(published["variants"][1]["status"], "draft")
        self.assertEqual(len(published["previous_versions"]), 1)
        # publishing one variant must not lock the other
        again = apply_rebake({**project, "actions": [published]}, "walk", adopt_all, other_id)
        self.assertEqual(again["variants"][1]["revision"], 3)
        with self.assertRaises(ValueError):
            apply_rebake({**project, "actions": [published]}, "walk", adopt_all, variant_id)
        round_trip = json.loads(json.dumps({**project, "actions": [again]}))
        self.assertEqual(validate_project(round_trip), [])

    def test_decision_basis_and_withdrawal_preserve_later_independent_rework(self):
        project, _ = self._project_with_shared_source_actions()
        project["version"] = 2
        # edit the wave layer's first keyframe: affects only the early window
        project["layers"][0]["keyframes"][0]["pose"]["upper_arm_r"]["rotation"] = 300.0
        first_segments = analyze_rebake(project, project["actions"][0])
        self.assertEqual(len(first_segments), 1)
        first = first_segments[0]
        apply = lambda proj, segs: apply_rebake(proj, "walk", [
            {"segment": {"start": s["start"], "end": s["end"], "bones": s["bones"]}, "resolution": "source"}
            for s in segs
        ])
        step1 = apply(project, first_segments)
        # a second, later source revision affects a disjoint later window
        project["version"] = 3
        project["layers"][0]["keyframes"][2]["pose"]["upper_arm_r"]["rotation"] = 20.0
        last_segments = analyze_rebake(project, step1)
        self.assertEqual(len(last_segments), 1)
        last = last_segments[0]
        self.assertLess(first["end"], last["start"])
        step2 = apply({**project, "actions": [step1]}, last_segments)
        project["actions"][0] = step2
        log = step2["decision_log"]
        self.assertEqual(len(log), 2)

        # a later source revision intersecting the first window reports its basis
        project["version"] = 4
        project["layers"][0]["keyframes"][0]["pose"]["upper_arm_r"]["rotation"] = 310.0
        pending = analyze_rebake(project, project["actions"][0])
        basis_ids = [entry["id"] for segment in pending for entry in segment["basis"]]
        self.assertIn(log[0]["id"], basis_ids)

        preview = withdrawal_preview(project, "walk", log[0]["id"])
        self.assertEqual([entry["id"] for entry in preview["independent"]], [log[1]["id"]])
        self.assertEqual(preview["dependents"], [])

        withdrawn = withdraw_decision(project, "walk", log[0]["id"])
        statuses = {entry["id"]: entry["status"] for entry in withdrawn["decision_log"]}
        self.assertEqual(statuses[log[0]["id"]], "withdrawn")
        self.assertEqual(statuses[log[1]["id"]], "active")
        # the first window is back to the pre-decision (v1) poses...
        for frame in withdrawn["keyframes"]:
            if first["start"] - 1e-9 <= frame["time"] <= first["end"] + 1e-9:
                original = next(
                    item for item in project["actions"][0]["previous_versions"][0]["keyframes"]
                    if abs(item["time"] - frame["time"]) < 1e-9
                )
                self.assertAlmostEqual(frame["pose"]["spine"]["rotation"], original["pose"]["spine"]["rotation"])
        # ...while the later unrelated rework in the second window is untouched
        for frame in withdrawn["keyframes"]:
            if last["start"] - 1e-9 <= frame["time"] <= last["end"] + 1e-9:
                source_pose = sample_local(project, frame["time"])
                self.assertAlmostEqual(
                    frame["pose"]["upper_arm_r"]["rotation"],
                    source_pose["upper_arm_r"]["rotation"],
                )
        round_trip = json.loads(json.dumps({**project, "actions": [withdrawn]}))
        self.assertEqual(validate_project(round_trip), [])

    def test_withdrawal_requires_confirmation_when_later_decisions_depend(self):
        project, _ = self._project_with_shared_source_actions()
        project["version"] = 2
        project["layers"][0]["keyframes"][0]["pose"]["upper_arm_r"]["rotation"] = 300.0
        segments = analyze_rebake(project, project["actions"][0])
        first = segments[0]
        apply = lambda proj, segs: apply_rebake(proj, "walk", [
            {"segment": {"start": s["start"], "end": s["end"], "bones": s["bones"]}, "resolution": "source"}
            for s in segs
        ])
        step1 = apply(project, [first])
        project["actions"][0] = step1
        project["version"] = 3
        project["layers"][0]["keyframes"][0]["pose"]["upper_arm_r"]["rotation"] = 320.0
        overlapping = [s for s in analyze_rebake(project, step1)
                       if s["start"] <= first["end"] + 1e-9]
        self.assertTrue(overlapping)
        step2 = apply(project, overlapping[:1])
        project["actions"][0] = step2
        log = step2["decision_log"]
        preview = withdrawal_preview(project, "walk", log[0]["id"])
        self.assertEqual([entry["id"] for entry in preview["dependents"]], [log[1]["id"]])
        with self.assertRaises(ValueError):
            withdraw_decision(project, "walk", log[0]["id"])
        withdrawn = withdraw_decision(project, "walk", log[0]["id"], confirm=True)
        self.assertEqual(withdrawn["decision_log"][0]["status"], "withdrawn")


    def test_review_batch_covers_two_shared_actions_with_independent_drafts(self):
        project, _ = self._project_with_shared_source_actions()
        project["version"] = 2
        project["keyframes"][1]["pose"]["spine"]["rotation"] = 9.0

        opened = create_review_batch(project, batch_id="b1")
        batch = opened["review_batches"][-1]
        self.assertEqual(batch["status"], "open")
        self.assertEqual([item["action_id"] for item in batch["items"]], ["walk", "turn"])
        walk_draft = batch["items"][0]["variant_id"]
        turn_draft = batch["items"][1]["variant_id"]
        self.assertNotEqual(walk_draft, turn_draft)
        # two independent drafts for two actions sharing the same source
        walk_action = next(item for item in opened["actions"] if item["id"] == "walk")
        turn_action = next(item for item in opened["actions"] if item["id"] == "turn")
        self.assertTrue(any(item["id"] == walk_draft for item in walk_action["variants"]))
        self.assertTrue(any(item["id"] == turn_draft for item in turn_action["variants"]))
        self.assertTrue(all(item["status"] == "open" for item in batch["items"]))
        self.assertTrue(all(segment["resolution"] == "pending" for item in batch["items"] for segment in item["segments"]))

        # decide only the walk item; turn stays pending and the project is saved
        walk_segments = batch["items"][0]["segments"]
        decided = set_review_item_decisions(
            opened, "b1", "walk",
            {str(index): "source" for index in range(len(walk_segments))},
        )
        batch = next(item for item in decided["review_batches"] if item["id"] == "b1")
        self.assertEqual(batch["items"][0]["status"], "decided")
        self.assertEqual(batch["items"][1]["status"], "open")
        walk_action = next(item for item in decided["actions"] if item["id"] == "walk")
        self.assertEqual(walk_action["revision"], 1)
        walk_variant = next(item for item in walk_action["variants"] if item["id"] == walk_draft)
        self.assertEqual(walk_variant["revision"], len(walk_segments) + 1)
        self.assertTrue(all(entry["batch_id"] == "b1" for entry in walk_action["decision_log"]))

        # submit publishes only the decided item; pending turn draft survives
        submitted = submit_review_batch(decided, "b1")
        batch = next(item for item in submitted["review_batches"] if item["id"] == "b1")
        self.assertEqual(batch["status"], "partially_submitted")
        self.assertEqual([item["status"] for item in batch["items"]], ["published", "open"])
        walk_action = next(item for item in submitted["actions"] if item["id"] == "walk")
        turn_action = next(item for item in submitted["actions"] if item["id"] == "turn")
        self.assertEqual(walk_action["revision"], 2)
        self.assertEqual(turn_action["revision"], 1)
        self.assertTrue(any(item["id"] == walk_draft and item["status"] == "published" for item in walk_action["variants"]))
        turn_draft_variant = next(item for item in turn_action["variants"] if item["id"] == turn_draft)
        self.assertEqual(turn_draft_variant["status"], "draft")
        self.assertTrue(any(segment["resolution"] == "pending" for segment in batch["items"][1]["segments"]))

        # save/reload keeps the batch open for the pending item
        round_trip = json.loads(json.dumps(submitted))
        self.assertEqual(validate_project(round_trip), [])
        resumed = review_batch_summary(
            migrate_project(round_trip), "b1",
        )
        self.assertEqual(resumed["items"][0]["status"], "published")
        self.assertTrue(resumed["items"][1]["segments"])

    def test_review_batch_resumes_after_another_source_revision_and_cancel(self):
        project, _ = self._project_with_shared_source_actions()
        project["version"] = 2
        project["keyframes"][1]["pose"]["spine"]["rotation"] = 9.0
        opened = create_review_batch(project, batch_id="b1")
        walk_segments = opened["review_batches"][-1]["items"][0]["segments"]
        turn_segments = opened["review_batches"][-1]["items"][1]["segments"]
        decided = set_review_item_decisions(
            opened, "b1", "walk",
            {str(index): "source" for index in range(len(walk_segments))},
        )
        submitted = submit_review_batch(decided, "b1")
        walk_after = next(item for item in submitted["actions"] if item["id"] == "walk")
        walk_published_revision = walk_after["revision"]

        # source revised again: the still-pending turn item gains more segments
        # (bases from the first revision remain), and the batch can continue
        submitted["version"] = 3
        submitted["layers"][0]["keyframes"][0]["pose"]["upper_arm_r"]["rotation"] = 300.0
        resumed = review_batch_summary(submitted, "b1")
        turn_item = resumed["items"][1]
        self.assertTrue(all(segment["resolution"] == "pending" for segment in turn_item["segments"]))
        self.assertTrue(len(turn_item["segments"]) >= 1)

        # make a decision on turn, then cancel it: draft resets, decision log
        # entries for this batch item disappear, but walk's published result and
        # its other-batch/published decisions remain intact
        with_choice = set_review_item_decisions(
            submitted, "b1", "turn",
            {str(index): "source" for index in range(len(turn_item["segments"]))},
        )
        turn_action = next(item for item in with_choice["actions"] if item["id"] == "turn")
        self.assertTrue(turn_action["decision_log"])
        cancelled = cancel_review_item(with_choice, "b1", "turn")
        turn_action = next(item for item in cancelled["actions"] if item["id"] == "turn")
        turn_draft = next(
            item for item in cancelled["review_batches"][-1]["items"] if item["action_id"] == "turn"
        )["variant_id"]
        draft = next(item for item in turn_action["variants"] if item["id"] == turn_draft)
        self.assertEqual(draft["revision"], 1)
        self.assertEqual(draft["keyframes"], turn_action["keyframes"])
        self.assertFalse(any(entry.get("batch_id") == "b1" for entry in turn_action["decision_log"]))
        self.assertTrue(all(segment["resolution"] == "pending" for segment in cancelled["review_batches"][-1]["items"][1]["segments"]))
        walk_action = next(item for item in cancelled["actions"] if item["id"] == "walk")
        self.assertEqual(walk_action["revision"], walk_published_revision)
        self.assertTrue(any(entry["batch_id"] == "b1" for entry in walk_action["decision_log"]))

    def test_review_batch_keeps_keep_decisions_and_their_basis_pending(self):
        project, _ = self._project_with_shared_source_actions()
        walk = project["actions"][0]
        walk["keyframes"][10]["pose"]["spine"]["rotation"] = 45.0
        walk["keyframes"][10]["origin"] = "manual"
        project["version"] = 2
        project["keyframes"][1]["pose"]["spine"]["rotation"] = 9.0
        opened = create_review_batch(project, batch_id="b1")
        segments = opened["review_batches"][-1]["items"][0]["segments"]
        manual_index = next(index for index, segment in enumerate(segments) if segment["manual"])
        resolutions = {
            str(index): ("keep" if index == manual_index else "source")
            for index in range(len(segments))
        }
        decided = set_review_item_decisions(opened, "b1", "walk", resolutions)
        walk_item = next(item for item in decided["review_batches"][-1]["items"] if item["action_id"] == "walk")
        self.assertEqual(walk_item["segments"][manual_index]["resolution"], "keep")
        walk_action = next(item for item in decided["actions"] if item["id"] == "walk")
        draft_id = walk_item["variant_id"]
        draft = next(item for item in walk_action["variants"] if item["id"] == draft_id)
        kept = [frame for frame in draft["keyframes"] if frame.get("origin") == "manual"]
        self.assertTrue(kept)
        self.assertTrue(all(frame["origin_source_version"] == 2 for frame in kept))
        self.assertEqual(walk_action["revision"], 1)
        # pending sibling prevents submit-without-decision errors but walk can publish
        submitted = submit_review_batch(decided, "b1")
        walk_action = next(item for item in submitted["actions"] if item["id"] == "walk")
        self.assertEqual(walk_action["revision"], 2)
        self.assertEqual(
            [frame for frame in walk_action["keyframes"] if frame.get("origin") == "manual"],
            kept,
        )


if __name__ == "__main__":
    unittest.main()
