"""Ported from permanence.test.ts. One case (the TS test reading a JSON baseline, exploiting

YAML 1.2 being a JSON superset) has no TOML equivalent -- TOML is not a JSON superset -- so it's
replaced with the direct TOML-baseline case, which is what idsByScope actually reads post-migration.
"""

from _sdd_core import RegisterEntryConfig, colliding_since, dropped_since, ids_by_scope, parse_register

CONFIG = """
[[registers]]
scope = "ZQS"
file = "specs/sources/spec.md"
format = "sdd"
"""


def parse(source: str, reg: RegisterEntryConfig):
    return parse_register(source, reg, "sdd")


def spec_with(*ids: str) -> str:
    return "\n".join(["## Requirements", *(f"### Requirement: {id_} — a promise" for id_ in ids)])


def reader(files: dict[str, str]):
    def read(path: str):
        return files.get(path)

    return read


def scopes(*ids: str) -> dict[str, frozenset[str]]:
    return {"ZQS": frozenset(ids)}


class TestIdsByScope:
    def test_reads_a_revisions_ids_keyed_by_scope_not_path(self):
        got = ids_by_scope(CONFIG, reader({"specs/sources/spec.md": spec_with("ZQS-R1", "ZQS-R2")}), parse)
        assert sorted(got.get("ZQS", frozenset())) == ["ZQS-R1", "ZQS-R2"]

    def test_applies_schema_defaults_to_baseline_register_omitting_format(self):
        # Regression: a baseline register with no explicit `format` must default to "sdd" (the
        # schema default), never fall back to the table parser and find zero entries in a
        # heading-format spec -- which let a deleted requirement through undetected.
        no_format = '[[registers]]\nscope = "ZQS"\nfile = "s.md"\n'
        got = ids_by_scope(no_format, reader({"s.md": spec_with("ZQS-R1", "ZQS-R2")}), parse)
        assert sorted(got.get("ZQS", frozenset())) == ["ZQS-R1", "ZQS-R2"]

    def test_skips_baseline_register_too_broken_to_read(self):
        got = ids_by_scope('[[registers]]\nnotAScope = true\n', reader({}), parse)
        assert len(got) == 0

    def test_returns_none_on_unreadable_baseline_config(self):
        assert ids_by_scope("not [ valid toml {{{", reader({}), parse) is None

    def test_skips_register_whose_file_did_not_exist_at_that_revision(self):
        got = ids_by_scope(CONFIG, reader({}), parse)
        assert len(got) == 0


class TestDroppedSince:
    def test_reports_an_id_that_vanished(self):
        dropped = dropped_since(scopes("ZQS-R1", "ZQS-R2"), scopes("ZQS-R1"))
        assert list(dropped.droppedIds) == ["ZQS-R2"]

    def test_reports_whole_scope_vanished_separately(self):
        dropped = dropped_since(scopes("ZQS-R1"), {})
        assert list(dropped.droppedScopes) == ["ZQS"]
        assert list(dropped.droppedIds) == []

    def test_says_nothing_when_retired_entry_keeps_its_number(self):
        assert list(dropped_since(scopes("ZQS-R1"), scopes("ZQS-R1")).droppedIds) == []

    def test_treats_empty_baseline_scope_as_unreadable(self):
        dropped = dropped_since({"ZQS": frozenset()}, scopes("ZQS-R1"))
        assert list(dropped.droppedIds) == []

    def test_ignores_ids_added_since_baseline(self):
        assert list(dropped_since(scopes("ZQS-R1"), scopes("ZQS-R1", "ZQS-R2")).droppedIds) == []


class TestCollidingSince:
    def test_reports_number_both_sides_allocated_after_divergence(self):
        base = scopes("ZQS-R1")
        trunk = scopes("ZQS-R1", "ZQS-R2")
        branch = scopes("ZQS-R1", "ZQS-R2")
        assert colliding_since(base, trunk, branch) == ["ZQS-R2"]

    def test_silent_when_id_predates_divergence(self):
        base = scopes("ZQS-R1")
        assert colliding_since(base, scopes("ZQS-R1"), scopes("ZQS-R1")) == []

    def test_silent_when_only_branch_allocated_it(self):
        assert colliding_since(scopes(), scopes(), scopes("ZQS-R9")) == []

    def test_silent_when_only_trunk_allocated_it(self):
        assert colliding_since(scopes(), scopes("ZQS-R9"), scopes()) == []
