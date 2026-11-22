import copy
import json
import tempfile
import unittest
from pathlib import Path
from PIL import Image
from spritepipe.core import PipelineError, init_project, build_project, check_project, load_profile, write_json, indexed, palette_rgb, canonical


class PipelineTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name) / "project"
        self.profile = init_project(self.root, demo=True)

    def tearDown(self):
        self.temp.cleanup()

    def built(self):
        return build_project(self.root)

    def codes(self):
        r = check_project(self.root)
        return {e["code"] for row in r["results"] for e in row["errors"]}

    def test_demo_roundtrip_and_review_statuses_remain_pending(self):
        r = self.built()
        self.assertEqual(r["status"], "TECHNICAL_VERIFIED")
        self.assertEqual(r["visual_review"], "pending")
        self.assertEqual(r["engine_review"], "pending")
        self.assertTrue((self.root / "output/index.html").is_file())

    def test_unfrozen_palette_blocks_build(self):
        self.profile["palette"]["status"] = "pending"
        write_json(self.root / "profile.json", self.profile)
        with self.assertRaisesRegex(PipelineError, "Freeze the palette"):
            self.built()

    def test_duplicate_palette_is_rejected(self):
        self.profile["palette"]["colors"].append("#FFD166")
        write_json(self.root / "profile.json", self.profile)
        with self.assertRaises(PipelineError): load_profile(self.root)

    def test_source_path_traversal_is_rejected(self):
        self.profile["actions"]["idle"]["source"] = "../private.png"
        write_json(self.root / "profile.json", self.profile)
        with self.assertRaisesRegex(PipelineError, "escapes"):
            self.built()

    def test_source_clipping_cannot_be_hidden_by_output_padding(self):
        path = self.root / "source/idle.png"
        im = Image.open(path).convert("RGBA")
        im.putpixel((0, 0), (255, 209, 102, 255))
        im.save(path)
        with self.assertRaisesRegex(PipelineError, "source pose touches"):
            self.built()

    def test_negative_whole_frame_translation_cannot_clip_visible_pixels(self):
        self.profile["actions"]["idle"]["offsets"][0] = [-20, 8]
        write_json(self.root / "profile.json", self.profile)
        with self.assertRaisesRegex(PipelineError, "safety margin"):
            self.built()

    def test_non_binary_alpha_is_detected_after_export(self):
        self.built()
        p = self.root / "output/idle/frames/00.png"
        im = Image.open(p).convert("RGBA")
        im.putpixel((20, 20), (255, 209, 102, 128))
        im.save(p)
        self.assertIn("non_binary_alpha", self.codes())

    def test_atlas_pixels_must_match_frames(self):
        self.built()
        p = self.root / "output/idle/atlas.png"
        im = Image.open(p).convert("RGBA")
        im.putpixel((20, 20), (94, 217, 221, 255))
        im.save(p)
        self.assertIn("atlas_pixels", self.codes())

    def test_wrong_disposal_is_caught_by_full_gif_timeline(self):
        self.built()
        d = self.root / "output/idle"
        colors = palette_rgb(self.profile)
        frames = [indexed(Image.open(d / ("frames/%02d.png" % i)).convert("RGBA").resize((192, 192), Image.Resampling.NEAREST), colors) for i in range(4)]
        frames[0].save(d / "preview.gif", save_all=True, append_images=frames[1:], duration=[160, 80, 80, 160], loop=0, transparency=0, disposal=1, optimize=False)
        self.assertIn("gif_pixels_timing_or_disposal", self.codes())

    def test_root_motion_and_pivot_tampering_is_detected(self):
        self.built()
        p = self.root / "output/idle/animation.json"
        c = json.loads(p.read_text())
        c["frames"][1]["root_motion"] = [5, 0]
        c["frames"][1]["pivot"] = [0, 0]
        write_json(p, c)
        self.assertIn("pivot_or_root_motion", self.codes())

    def test_changed_source_or_transform_requires_rebuild(self):
        self.built()
        self.profile["actions"]["idle"]["alpha_threshold"] = 200
        write_json(self.root / "profile.json", self.profile)
        p = self.root / "source/idle.png"
        im = Image.open(p).convert("RGBA")
        im.putpixel((12, 10), (255, 255, 255, 255))
        im.save(p)
        self.assertTrue({"source_changed_since_build", "manifest_alpha_threshold"} <= self.codes())

    def test_force_archives_prior_output(self):
        self.built()
        old = (self.root / "output/idle/atlas.png").read_bytes()
        with self.assertRaisesRegex(PipelineError, "Output exists"):
            self.built()
        build_project(self.root, force=True)
        archived = list((self.root / "archive").glob("idle-*/atlas.png"))
        self.assertEqual(len(archived), 1)
        self.assertEqual(archived[0].read_bytes(), old)

    def test_larger_canvas_preserves_native_pose_size_and_relative_pivot(self):
        a = copy.deepcopy(self.profile["actions"]["idle"])
        a["frame_size"], a["pivot"] = [64, 64], [32, 48]
        a["offsets"] = [[16, 16]] * 4
        self.profile["actions"]["wide"] = a
        write_json(self.root / "profile.json", self.profile)
        self.assertEqual(self.built()["status"], "TECHNICAL_VERIFIED")
        normal = Image.open(self.root / "output/idle/frames/00.png").convert("RGBA")
        wide = Image.open(self.root / "output/wide/frames/00.png").convert("RGBA")
        self.assertEqual(canonical(normal), canonical(wide.crop((8, 8, 56, 56))))

    def test_invalid_strike_index_and_sub_gif_unit_are_rejected(self):
        self.profile["actions"]["idle"]["events"] = {"strikes": [99]}
        write_json(self.root / "profile.json", self.profile)
        with self.assertRaisesRegex(PipelineError, "zero-based"):
            self.built()
        self.profile["actions"]["idle"]["events"] = {}
        self.profile["actions"]["idle"]["durations_ms"][0] = 15
        write_json(self.root / "profile.json", self.profile)
        with self.assertRaisesRegex(PipelineError, "multiples"):
            self.built()


if __name__ == "__main__":
    unittest.main()
