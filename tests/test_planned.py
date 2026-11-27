"""Identifiers an open change already holds: allocation counts them, and the check refuses a
register and an open change claiming one number for two things."""

import json
import subprocess

import pytest

from _sdd_core import (
    CheckDeps,
    ConfigError,
    added_by_change,
    allocate,
    change_of,
    check,
    delta_added,
    main,
    parse_config,
    planned_collisions,
    planned_ids,
)

AGENTS = "docs/specs/agents/spec.md"


def catalyst(over: dict | None = None):
    raw = {
        "idGrammar": "catalyst",
        "specRoot": "docs/specs",
        "changesRoot": "docs/changes",
        "registers": [{"scope": "AGT", "file": AGENTS, "format": "table"}],
    }
    raw.update(over or {})
    return parse_config(raw)


def table(*rows: str) -> str:
    return "\n".join(["| ID | Legacy | Status | Requirement |", "| --- | --- | --- | --- |", *rows])


def delta(*sections: tuple[str, list[str]]) -> str:
    out = ["# turn cancel — spec delta"]
    for heading, ids in sections:
        out.append(f"## {heading}")
        out.extend(f"### Requirement: {id_} — MUST do the thing" for id_ in ids)
    return "\n".join(out)


def reader(files: dict[str, str]):
    return lambda path: files.get(path)


class _Deps(CheckDeps):
    def __init__(self, files: dict[str, str]):
        self._files = files

    def read_file(self, path: str):
        return self._files.get(path)

    def list_files(self):
        return list(self._files.keys())


class TestChangeOf:
    def test_names_the_change_directory(self):
        assert change_of("docs/changes/turn-cancel/tasks.md", "docs/changes") == "docs/changes/turn-cancel"

    def test_tolerates_a_trailing_slash_on_the_root(self):
        assert change_of("docs/changes/turn-cancel/spec.md", "docs/changes/") == "docs/changes/turn-cancel"

    def test_a_sibling_sharing_the_prefix_is_not_a_change(self):
        assert change_of("docs/changes-old/x/spec.md", "docs/changes") is None

    def test_a_file_directly_under_the_root_is_no_change(self):
        assert change_of("docs/changes/README.md", "docs/changes") is None

    def test_an_empty_root_disables_it(self):
        assert change_of("x/spec.md", "") is None


class TestDeltaAdded:
    def test_reads_only_added_sections(self):
        source = delta(
            ("ADDED Requirements", ["AGT-70", "AGT-71"]),
            ("MODIFIED Requirements", ["AGT-3"]),
            ("REMOVED Requirements", ["AGT-9"]),
        )
        assert delta_added(source, "catalyst") == ["AGT-70", "AGT-71"]

    def test_reads_added_user_stories(self):
        source = "\n".join(["## ADDED User Stories", "### User Story: ZQS-S4 — a slice (P1)"])
        assert delta_added(source, "sdd") == ["ZQS-S4"]

    def test_skips_a_story_with_no_identifier(self):
        source = "\n".join(["## ADDED User Stories", "### User Story A — a slice (P1)"])
        assert delta_added(source, "catalyst") == []

    def test_ignores_fenced_examples_and_comments(self):
        source = "\n".join(
            [
                "## ADDED Requirements",
                "```markdown",
                "### Requirement: AGT-90 — an example",
                "```",
                "<!--",
                "### Requirement: AGT-91 — guidance",
                "-->",
                "### Requirement: AGT-70 — real",
            ]
        )
        assert delta_added(source, "catalyst") == ["AGT-70"]

    def test_a_subheading_inside_added_keeps_the_section_open(self):
        source = "\n".join(["## ADDED Requirements", "### Authoring", "### Requirement: AGT-1 — MUST create"])
        assert delta_added(source, "catalyst") == ["AGT-1"]


class TestPlannedIds:
    def test_maps_every_id_named_under_changes_root_to_its_change(self):
        files = {
            "docs/changes/turn-cancel/spec.md": delta(("ADDED Requirements", ["AGT-70"])),
            "docs/changes/turn-cancel/tasks.md": "- [ ] T010 cancel — `chat.ts` (AGT-81)",
            "docs/agents.md": "AGT-99 is only mentioned in docs",
        }
        got = planned_ids(catalyst(), files.keys(), reader(files))
        assert got == {
            "AGT-70": frozenset({"docs/changes/turn-cancel"}),
            "AGT-81": frozenset({"docs/changes/turn-cancel"}),
        }

    def test_added_by_change_reads_only_the_delta_spec(self):
        files = {
            "docs/changes/turn-cancel/spec.md": delta(("ADDED Requirements", ["AGT-70"]), ("MODIFIED Requirements", ["AGT-3"])),
            "docs/changes/turn-cancel/tasks.md": "AGT-81",
        }
        assert added_by_change(catalyst(), files.keys(), reader(files)) == {"AGT-70": frozenset({"docs/changes/turn-cancel"})}


class TestAllocate:
    FILES = {
        AGENTS: table("| AGT-68 | — | Building | MUST x |", "| AGT-69 | Withdrawn | | moved |"),
        "docs/changes/turn-cancel/spec.md": delta(("ADDED Requirements", ["AGT-70", "AGT-71"])),
        "docs/changes/turn-cancel/plan.md": "the server cancel (AGT-81)",
    }

    def test_allocates_past_every_planned_number(self):
        new_id, note = allocate(catalyst(), "AGT", "requirement", reader(self.FILES), self.FILES.keys())
        assert new_id == "AGT-82"
        assert note == "past AGT-81, already planned by docs/changes/turn-cancel"

    def test_a_retired_entry_still_holds_its_number(self):
        files = {AGENTS: self.FILES[AGENTS]}
        assert allocate(catalyst(), "AGT", "requirement", reader(files), files.keys()) == ("AGT-70", None)

    def test_ignores_another_scopes_plans(self):
        cfg = catalyst({"registers": [{"scope": "AGT", "file": AGENTS, "format": "table"}, {"scope": "UAR", "file": "u.md", "format": "table"}]})
        files = {AGENTS: self.FILES[AGENTS], "u.md": table("| UAR-1 | — | | x |"), "docs/changes/x/spec.md": "UAR-500"}
        assert allocate(cfg, "AGT", "requirement", reader(files), files.keys())[0] == "AGT-70"

    def test_sdd_grammar_numbers_stories_and_requirements_apart(self):
        cfg = parse_config({"registers": [{"scope": "ZQS", "file": "s.md"}]})
        files = {
            "s.md": "\n".join(["## Requirements", "### Requirement: ZQS-R2 — MUST x", "> Story: ZQS-S1"]),
            "changes/c/spec.md": "\n".join(["## ADDED User Stories", "### User Story: ZQS-S5 — y (P1)"]),
        }
        assert allocate(cfg, "ZQS", "requirement", reader(files), files.keys())[0] == "ZQS-R3"
        assert allocate(cfg, "ZQS", "story", reader(files), files.keys())[0] == "ZQS-S6"

    def test_refuses_an_unknown_scope(self):
        with pytest.raises(ConfigError, match="no register declares scope NOPE"):
            allocate(catalyst(), "NOPE", "requirement", reader(self.FILES), [])

    def test_refuses_a_story_under_the_catalyst_grammar(self):
        with pytest.raises(ConfigError, match="not representable"):
            allocate(catalyst(), "AGT", "story", reader(self.FILES), [])


TURN = "docs/changes/turn-cancel"
OTHER = "docs/changes/sandbox"


def ids(*xs: str) -> dict[str, frozenset[str]]:
    return {"AGT": frozenset(xs)}


def plans(**by_change: list[str]) -> dict[str, frozenset[str]]:
    out: dict[str, set[str]] = {}
    for change, xs in by_change.items():
        for x in xs:
            out.setdefault(x, set()).add(change)
    return {k: frozenset(v) for k, v in out.items()}


def turn(*xs: str) -> dict[str, frozenset[str]]:
    return {x: frozenset({TURN}) for x in xs}


class TestPlannedCollisions:
    def test_flags_a_register_row_taking_a_number_an_open_change_plans(self):
        # The incident: AGT-70 registered by a branch that never looked at turn-cancel.
        got = planned_collisions(ids("AGT-69"), ids("AGT-69"), ids("AGT-69", "AGT-70"), turn("AGT-70"), turn("AGT-70"), [], {})
        assert got == [f"AGT-70 — registered on this branch, but {TURN} already plans it as new"]

    def test_a_change_planned_on_the_trunk_after_the_merge_base_still_counts(self):
        got = planned_collisions(ids(), ids(), ids("AGT-70"), turn("AGT-70"), {}, [], {})
        assert len(got) == 1

    def test_passes_the_branch_implementing_the_change(self):
        got = planned_collisions(ids(), ids(), ids("AGT-70"), turn("AGT-70"), turn("AGT-70"), [TURN], turn("AGT-70"))
        assert got == []

    def test_passes_the_branch_archiving_the_change(self):
        # Archive deletes the directory: it is touched, and gone from the working tree.
        got = planned_collisions(ids(), ids(), ids("AGT-70"), turn("AGT-70"), {}, [TURN], {})
        assert got == []

    def test_passes_a_narrower_change_that_carries_out_part_of_it(self):
        got = planned_collisions(ids(), ids(), ids("AGT-70"), turn("AGT-70"), turn("AGT-70"), [OTHER], {"AGT-70": frozenset({OTHER})})
        assert got == []

    def test_an_id_registered_before_the_branch_is_not_this_branchs_doing(self):
        got = planned_collisions(ids("AGT-70"), ids("AGT-70"), ids("AGT-70"), turn("AGT-70"), turn("AGT-70"), [], {})
        assert got == []

    def test_flags_a_change_newly_adding_an_id_a_register_holds(self):
        got = planned_collisions(ids("AGT-70"), ids("AGT-70"), ids("AGT-70"), {}, turn("AGT-70"), [TURN], turn("AGT-70"))
        assert got == [f"AGT-70 — {TURN} plans it as new on this branch, but a register already holds it"]

    def test_flags_a_plan_reusing_a_number_the_trunk_registered_since_the_merge_base(self):
        got = planned_collisions(ids(), ids("AGT-70"), ids(), {}, turn("AGT-70"), [TURN], turn("AGT-70"))
        assert len(got) == 1

    def test_passes_a_change_that_already_planned_the_id_before_this_branch(self):
        # Its rows were synced into the register earlier; this branch only edits the change.
        got = planned_collisions(ids("AGT-70"), ids("AGT-70"), ids("AGT-70"), turn("AGT-70"), turn("AGT-70"), [TURN], turn("AGT-70"))
        assert got == []

    def test_an_untouched_change_is_never_blamed_for_its_own_plan(self):
        got = planned_collisions(ids("AGT-70"), ids("AGT-70"), ids("AGT-70"), {}, turn("AGT-70"), [], {})
        assert got == []


class TestPlannedTwice:
    def test_fails_two_open_changes_adding_one_id(self):
        files = {
            AGENTS: table("| AGT-1 | — | Building | MUST x |"),
            f"{TURN}/spec.md": delta(("ADDED Requirements", ["AGT-70"])),
            f"{OTHER}/spec.md": delta(("ADDED Requirements", ["AGT-70"])),
            "src/a.test.ts": "AGT-1",
        }
        r = check(catalyst(), _Deps(files))
        twice = [f for f in r.findings if f.check == "planned-id-twice"]
        assert len(twice) == 1
        assert twice[0].detail == (f"AGT-70 — {OTHER}, {TURN}",)

    def test_a_change_modifying_what_another_adds_is_fine(self):
        files = {
            AGENTS: table("| AGT-1 | — | Building | MUST x |"),
            f"{TURN}/spec.md": delta(("ADDED Requirements", ["AGT-70"])),
            f"{OTHER}/spec.md": delta(("MODIFIED Requirements", ["AGT-70"])),
            "src/a.test.ts": "AGT-1",
        }
        assert [f.check for f in check(catalyst(), _Deps(files)).findings] == []


# --- end to end: the real main() against a scratch git repo ------------------------------------

CONFIG = """idGrammar = "catalyst"
specRoot = "docs/specs"
changesRoot = "docs/changes"
trunk = "trunk"
searchRoots = ["docs/specs", "src"]

[[registers]]
scope = "AGT"
file = "docs/specs/agents/spec.md"
format = "table"
"""


def git(repo, *args):
    subprocess.run(
        ["git", "-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false", *args],
        cwd=repo,
        check=True,
        capture_output=True,
    )


@pytest.fixture
def repo(tmp_path, monkeypatch):
    (tmp_path / "docs/specs/agents").mkdir(parents=True)
    (tmp_path / "docs/changes/turn-cancel").mkdir(parents=True)
    (tmp_path / "src").mkdir()
    (tmp_path / "sdd.config.toml").write_text(CONFIG)
    (tmp_path / AGENTS).write_text(table("| AGT-69 | — | Building | MUST x |"))
    (tmp_path / "src/a.test.ts").write_text("AGT-69 AGT-70")
    (tmp_path / "docs/changes/turn-cancel/spec.md").write_text(delta(("ADDED Requirements", ["AGT-70", "AGT-71"])))
    (tmp_path / "docs/changes/turn-cancel/tasks.md").write_text("- [ ] T001 (AGT-81)")
    git(tmp_path, "init", "-q", "-b", "trunk")
    git(tmp_path, "add", "-A")
    git(tmp_path, "commit", "-q", "-m", "base")
    monkeypatch.chdir(tmp_path)
    return tmp_path


def run_check(capsys) -> tuple[int, dict]:
    code = main(["check", "--json"])
    return code, json.loads(capsys.readouterr().out)


def test_next_allocates_past_an_open_changes_plan(repo, capsys):
    assert main(["next", "AGT"]) == 0
    out = capsys.readouterr()
    assert out.out == "AGT-82\n"
    assert "docs/changes/turn-cancel" in out.err


def test_next_counts_a_plan_not_yet_added_to_git(repo, capsys):
    (repo / "docs/changes/later").mkdir()
    (repo / "docs/changes/later/spec.md").write_text(delta(("ADDED Requirements", ["AGT-90"])))
    assert main(["next", "AGT"]) == 0
    assert capsys.readouterr().out == "AGT-91\n"


def test_next_rejects_a_missing_scope(repo, capsys):
    assert main(["next"]) == 2


def test_check_fails_a_branch_registering_a_planned_id(repo, capsys):
    git(repo, "checkout", "-q", "-b", "patch")
    (repo / AGENTS).write_text(table("| AGT-69 | — | Building | MUST x |", "| AGT-70 | — | Building | MUST y |"))
    code, payload = run_check(capsys)
    assert code == 1
    collision = [f for f in payload["findings"] if f["check"] == "planned-id-collision"]
    assert collision and collision[0]["detail"] == [
        "AGT-70 — registered on this branch, but docs/changes/turn-cancel already plans it as new"
    ]


def test_check_passes_the_branch_that_implements_the_change(repo, capsys):
    git(repo, "checkout", "-q", "-b", "apply")
    (repo / AGENTS).write_text(table("| AGT-69 | — | Building | MUST x |", "| AGT-70 | — | Building | MUST y, reworded |"))
    (repo / "docs/changes/turn-cancel/tasks.md").write_text("- [x] T001 (AGT-81)")
    code, payload = run_check(capsys)
    assert [f["check"] for f in payload["findings"]] == []
    assert code == 0


def test_check_passes_the_branch_that_archives_the_change(repo, capsys):
    git(repo, "checkout", "-q", "-b", "archive")
    (repo / AGENTS).write_text(table("| AGT-69 | — | Building | MUST x |", "| AGT-70 | — | Building | MUST y |"))
    git(repo, "rm", "-q", "-r", "docs/changes/turn-cancel")
    code, payload = run_check(capsys)
    assert [f["check"] for f in payload["findings"]] == []
    assert code == 0
