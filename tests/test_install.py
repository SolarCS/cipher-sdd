"""Ported 1:1 from install.test.ts."""

from _sdd_core import SourceSkill, detect_drift, managed_by, plan_install, sha256_hex

SKILLS = [
    SourceSkill(name="sdd-size", content="---\nname: sdd-size\n---\ngate"),
    SourceSkill(name="sdd-patch", content="---\nname: sdd-patch\n---\npatch"),
]
DIR = ".cursor/skills"


def kinds(drifts) -> list[str]:
    return [f"{d.kind}:{d.path}" for d in drifts]


managed = managed_by(DIR, [s.name for s in SKILLS], "sdd-")


class TestPlanInstall:
    def test_maps_each_skill_records_content(self):
        files, manifest = plan_install(SKILLS, DIR, "1.0.0")
        assert [f.path for f in files] == [f"{DIR}/sdd-patch/SKILL.md", f"{DIR}/sdd-size/SKILL.md"]
        assert manifest.version == "1.0.0"
        assert files[0].sha256 == sha256_hex(SKILLS[1].content)


class TestDetectDrift:
    files, manifest = plan_install(SKILLS, DIR, "1.0.0")
    clean = {f"{DIR}/{s.name}/SKILL.md": s.content for s in SKILLS}

    def test_silent_when_all_agree(self):
        assert detect_drift(self.manifest, self.clean, self.files, managed) == []

    def test_reports_nothing_when_never_installed(self):
        assert detect_drift(None, self.clean, self.files, managed) == []

    def test_catches_hand_edited_vendored_skill(self):
        edited = dict(self.clean)
        edited[f"{DIR}/sdd-size/SKILL.md"] = "locally tweaked"
        assert kinds(detect_drift(self.manifest, edited, self.files, managed)) == [f"edited:{DIR}/sdd-size/SKILL.md"]

    def test_catches_deleted_vendored_skill(self):
        gone = dict(self.clean)
        del gone[f"{DIR}/sdd-patch/SKILL.md"]
        assert kinds(detect_drift(self.manifest, gone, self.files, managed)) == [f"missing:{DIR}/sdd-patch/SKILL.md"]

    def test_catches_skill_the_kit_has_since_changed(self):
        newer_files, _ = plan_install(
            [SKILLS[0], SourceSkill(name="sdd-patch", content="---\nname: sdd-patch\n---\npatch, revised")], DIR, "1.1.0"
        )
        assert kinds(detect_drift(self.manifest, self.clean, newer_files, managed)) == [f"stale:{DIR}/sdd-patch/SKILL.md"]

    def test_catches_skill_the_kit_has_added_since_this_install(self):
        grown_files, _ = plan_install([*SKILLS, SourceSkill(name="sdd-archive", content="new")], DIR, "1.1.0")
        assert kinds(detect_drift(self.manifest, self.clean, grown_files, managed)) == [f"stale:{DIR}/sdd-archive/SKILL.md"]

    def test_catches_leftover_skill_no_manifest_claims(self):
        leftover = dict(self.clean)
        leftover[f"{DIR}/sdd-sizing/SKILL.md"] = "the old name"
        assert kinds(detect_drift(self.manifest, leftover, self.files, managed)) == [f"unmanaged:{DIR}/sdd-sizing/SKILL.md"]

    def test_ignores_files_outside_managed_directory(self):
        other = dict(self.clean)
        other["docs/notes.md"] = "unrelated"
        assert detect_drift(self.manifest, other, self.files, managed) == []

    def test_leaves_consuming_repos_own_skills_alone(self):
        shared = dict(self.clean)
        shared[f"{DIR}/security-review/SKILL.md"] = "the repo's own skill"
        assert detect_drift(self.manifest, shared, self.files, managed) == []
