"""End-to-end: `sdd install` actually writes to config-chosen coreDir/templatesDir, not always the
repo root. Runs the real `main()` entry point against a scratch consumer, chdir'd into it, exercising
the same code path a real `install.sh` invocation does -- not a unit test of pieces in isolation.
"""

from _sdd_core import main


def test_core_files_and_templates_land_at_repo_root_by_default(tmp_path, monkeypatch):
    (tmp_path / "sdd.config.toml").write_text('idGrammar = "sdd"\n', encoding="utf-8")
    monkeypatch.chdir(tmp_path)

    exit_code = main(["install"])

    assert exit_code == 0
    assert (tmp_path / "sdd.py").is_file()
    assert (tmp_path / "_sdd_core.py").is_file()
    assert (tmp_path / "sdd-templates" / "spec.md").is_file()
    assert (tmp_path / "sdd.py").stat().st_mode & 0o111  # executable


def test_core_files_and_templates_nest_under_a_configured_directory(tmp_path, monkeypatch):
    (tmp_path / "sdd.config.toml").write_text(
        'idGrammar = "sdd"\ncoreDir = ".cursor/sdd"\ntemplatesDir = ".cursor/sdd/templates"\n',
        encoding="utf-8",
    )
    monkeypatch.chdir(tmp_path)

    exit_code = main(["install"])

    assert exit_code == 0
    assert not (tmp_path / "sdd.py").exists()
    assert not (tmp_path / "_sdd_core.py").exists()
    assert not (tmp_path / "sdd-templates").exists()
    assert (tmp_path / ".cursor" / "sdd" / "sdd.py").is_file()
    assert (tmp_path / ".cursor" / "sdd" / "_sdd_core.py").is_file()
    assert (tmp_path / ".cursor" / "sdd" / "templates" / "spec.md").is_file()
    # Skills are unaffected by coreDir -- they stay under the independent skillsDir default.
    assert (tmp_path / ".cursor" / "skills" / "sdd-apply" / "SKILL.md").is_file()
