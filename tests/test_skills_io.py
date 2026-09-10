"""Ported 1:1 from skills-io.test.ts, using pytest's tmp_path instead of mkdtempSync."""

import json

from _sdd_core import MANIFEST_NAME, SourceSkill, plan_install, read_manifest, read_vendored_skills, write_skills

SKILLS = [
    SourceSkill(name="sdd-size", content="---\nname: sdd-size\n---\nthe gate"),
    SourceSkill(name="sdd-patch", content="---\nname: sdd-patch\n---\nthe patch tier"),
]
DIR = ".cursor/skills"


class TestWriteSkills:
    def test_creates_tree_writes_each_skill_and_manifest(self, tmp_path):
        _, manifest = plan_install(SKILLS, DIR, "1.2.3")
        written = write_skills(tmp_path, DIR, SKILLS, manifest)

        assert f"{DIR}/sdd-size/SKILL.md" in written
        assert f"{DIR}/{MANIFEST_NAME}" in written
        assert (tmp_path / DIR / "sdd-size" / "SKILL.md").read_text(encoding="utf-8") == SKILLS[0].content
        assert read_manifest(tmp_path, DIR).version == "1.2.3"

    def test_overwrites_wholesale_never_merged(self, tmp_path):
        _, manifest = plan_install(SKILLS, DIR, "1.0.0")
        write_skills(tmp_path, DIR, SKILLS, manifest)
        (tmp_path / DIR / "sdd-size" / "SKILL.md").write_text("hand-edited", encoding="utf-8")

        write_skills(tmp_path, DIR, SKILLS, manifest)
        assert (tmp_path / DIR / "sdd-size" / "SKILL.md").read_text(encoding="utf-8") == SKILLS[0].content


class TestReadVendoredSkills:
    def test_empty_map_when_nothing_installed(self, tmp_path):
        assert len(read_vendored_skills(tmp_path, DIR)) == 0

    def test_skips_directory_carrying_no_skill_md(self, tmp_path):
        _, manifest = plan_install(SKILLS, DIR, "1.0.0")
        write_skills(tmp_path, DIR, SKILLS, manifest)
        (tmp_path / DIR / "not-a-skill").mkdir(parents=True)

        found = read_vendored_skills(tmp_path, DIR)
        assert f"{DIR}/not-a-skill/SKILL.md" not in found
        assert len(found) == len(SKILLS)


class TestReadManifest:
    def test_none_when_no_manifest(self, tmp_path):
        assert read_manifest(tmp_path, DIR) is None

    def test_none_on_malformed_manifest(self, tmp_path):
        (tmp_path / DIR).mkdir(parents=True)
        (tmp_path / DIR / MANIFEST_NAME).write_text("{ not json", encoding="utf-8")
        assert read_manifest(tmp_path, DIR) is None

    def test_none_when_entry_is_not_an_entry(self, tmp_path):
        (tmp_path / DIR).mkdir(parents=True)
        (tmp_path / DIR / MANIFEST_NAME).write_text(
            json.dumps({"version": "1.0.0", "entries": ["not an object"]}), encoding="utf-8"
        )
        assert read_manifest(tmp_path, DIR) is None

    def test_none_when_valid_json_wrong_shape(self, tmp_path):
        (tmp_path / DIR).mkdir(parents=True)
        (tmp_path / DIR / MANIFEST_NAME).write_text(json.dumps({"version": 3}), encoding="utf-8")
        assert read_manifest(tmp_path, DIR) is None
