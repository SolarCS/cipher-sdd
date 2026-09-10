"""Ported 1:1 from check.test.ts."""

from _sdd_core import CheckDeps, check, parse_config

SPEC = "specs/sources/spec.md"


def cfg(over: dict | None = None):
    raw = {"registers": [{"scope": "ZQS", "file": SPEC}]}
    raw.update(over or {})
    return parse_config(raw)


class _Deps(CheckDeps):
    def __init__(self, files: dict[str, str]):
        self._files = files

    def read_file(self, path: str):
        return self._files.get(path)

    def list_files(self):
        return list(self._files.keys())


def deps(files: dict[str, str]) -> _Deps:
    return _Deps(files)


def spec(*blocks: str) -> str:
    return "\n".join(blocks)


def story(id_: str, title: str = "a slice of value") -> str:
    return f"### User Story: {id_} — {title}"


def requirement(id_: str, story_id: str, title: str = "MUST do the thing") -> str:
    return "\n".join([f"### Requirement: {id_} — {title}", f"> Story: {story_id}"])


def names(r) -> list[str]:
    return [f.check for f in r.findings]


HEALTHY = spec("## User Stories", story("ZQS-S1"), "## Requirements", requirement("ZQS-R1", "ZQS-S1"))


class TestAHealthyRepo:
    def test_passes_when_every_gated_id_is_named(self):
        r = check(
            cfg(),
            deps({SPEC: HEALTHY, "src/sources.test.ts": 'it("accepts a param segment (ZQS-R1)", ...); describe("ZQS-S1", ...)'}),
        )
        assert names(r) == []
        assert r.stats.stories == 1
        assert r.stats.requirements == 1
        assert r.stats.gated == 2
        assert r.stats.covered == 2


class TestCoverage:
    def test_fails_uncovered_live_identifier(self):
        r = check(cfg(), deps({SPEC: HEALTHY}))
        assert "uncovered" in names(r)
        detail = next(f for f in r.findings if f.check == "uncovered").detail
        assert any("ZQS-R1" in d for d in detail)

    def test_does_not_count_registers_own_declaration_as_coverage(self):
        r = check(cfg(), deps({SPEC: HEALTHY}))
        assert r.stats.covered == 0

    def test_never_gates_proposed_or_retired(self):
        source = spec(
            "## User Stories",
            story("ZQS-S1"),
            "## Requirements",
            requirement("ZQS-R1", "ZQS-S1"),
            "## Proposed Requirements",
            requirement("ZQS-R2", "ZQS-S1"),
            "## Retired Requirements",
            "### Requirement: ZQS-R3 — gone",
            "> Retired 2026-09-04 by `abc1234`.",
        )
        r = check(cfg(), deps({SPEC: source, "t.test.ts": "ZQS-R1 ZQS-S1"}))
        assert names(r) == []

    def test_lets_document_cite_without_covering(self):
        r = check(
            cfg({"coverageExcludeRoots": ["docs/"]}),
            deps({SPEC: HEALTHY, "docs/backfill.md": "ZQS-R1 and ZQS-S1 are explained here"}),
        )
        assert "uncovered" in names(r)

    def test_skips_whole_file_excluded_from_scan(self):
        r = check(
            cfg({"excludeFromScan": ["README.md"]}),
            deps({SPEC: HEALTHY, "README.md": "for example ZQS-R1", "t.test.ts": "ZQS-R1 ZQS-S1"}),
        )
        assert names(r) == []


class TestRatchetBothDirections:
    def test_accepts_carried_debt_with_reason(self):
        r = check(
            cfg({"knownDebt": {"ZQS-R1": "covered by a manual runbook step, tracked in AIO-120"}}),
            deps({SPEC: HEALTHY, "t.test.ts": "ZQS-S1"}),
        )
        assert names(r) == []

    def test_fails_debt_with_no_reason(self):
        r = check(cfg({"knownDebt": {"ZQS-R1": "  "}}), deps({SPEC: HEALTHY, "t.test.ts": "ZQS-S1"}))
        assert "debt-no-reason" in names(r)

    def test_fails_debt_that_suppresses_nothing(self):
        r = check(
            cfg({"knownDebt": {"ZQS-R1": "stale — it is covered now"}}),
            deps({SPEC: HEALTHY, "t.test.ts": "ZQS-R1 ZQS-S1"}),
        )
        assert "debt-stale" in names(r)

    def test_fails_dead_scan_exclusion(self):
        r = check(cfg({"excludeFromScan": ["docs/deleted.md"]}), deps({SPEC: HEALTHY, "t.test.ts": "ZQS-R1 ZQS-S1"}))
        assert "dead-scan-exclusion" in names(r)

    def test_fails_dead_coverage_exclusion(self):
        r = check(cfg({"coverageExcludeRoots": ["docs"]}), deps({SPEC: HEALTHY, "t.test.ts": "ZQS-R1 ZQS-S1"}))
        assert "dead-coverage-root" in names(r)


class TestStoriesAndRequirementsAccountForEachOther:
    def test_fails_live_requirement_no_story(self):
        source = spec("## Requirements", "### Requirement: ZQS-R1 — behaviour nobody asked for")
        r = check(cfg(), deps({SPEC: source, "t.test.ts": "ZQS-R1"}))
        assert "requirement-no-story" in names(r)

    def test_fails_live_story_no_requirement(self):
        source = spec("## User Stories", story("ZQS-S1"), story("ZQS-S2"), "## Requirements", requirement("ZQS-R1", "ZQS-S1"))
        r = check(cfg(), deps({SPEC: source, "t.test.ts": "ZQS-R1 ZQS-S1 ZQS-S2"}))
        assert "story-no-requirement" in names(r)

    def test_fails_requirement_naming_nonexistent_story(self):
        source = spec("## User Stories", story("ZQS-S1"), "## Requirements", requirement("ZQS-R1", "ZQS-S9"))
        r = check(cfg(), deps({SPEC: source, "t.test.ts": "ZQS-R1 ZQS-S1"}))
        assert "dangling-story-link" in names(r)

    def test_does_not_demand_stories_under_catalyst(self):
        table = "| ZQA-1 | — | Building | MUST refuse an unsigned record. |"
        r = check(
            parse_config({"idGrammar": "catalyst", "registers": [{"scope": "ZQA", "file": SPEC, "format": "table"}]}),
            deps({SPEC: table, "t.test.ts": "ZQA-1"}),
        )
        assert names(r) == []


class TestProposedEntriesDeclaredNotLive:
    def test_no_story_link_demanded_from_proposed_requirement(self):
        source = spec(
            "## User Stories",
            story("ZQS-S1"),
            "## Requirements",
            requirement("ZQS-R1", "ZQS-S1"),
            "## Proposed Requirements",
            "### Requirement: ZQS-R2 — MUST do a thing nobody has linked yet",
        )
        r = check(cfg(), deps({SPEC: source, "t.test.ts": "ZQS-R1 ZQS-S1"}))
        assert names(r) == []

    def test_no_requirement_demanded_beneath_proposed_story(self):
        source = spec(
            "## User Stories",
            story("ZQS-S1"),
            "## Proposed User Stories",
            story("ZQS-S2", "a slice still being shaped"),
            "## Requirements",
            requirement("ZQS-R1", "ZQS-S1"),
        )
        r = check(cfg(), deps({SPEC: source, "t.test.ts": "ZQS-R1 ZQS-S1"}))
        assert names(r) == []


class TestDogfoodingFixes:
    def test_does_not_gate_spec_still_in_draft(self):
        draft = "\n".join(["> **Status:** Spec — Draft", "", "| ZQB-1 | — | Draft | MUST do a thing nobody has committed to yet. |"])
        r = check(
            parse_config({"idGrammar": "catalyst", "registers": [{"scope": "ZQB", "file": SPEC, "format": "table"}]}),
            deps({SPEC: draft}),
        )
        assert names(r) == []
        assert r.stats.gated == 0

    def test_gates_same_spec_once_it_leaves_draft(self):
        building = "\n".join(["> **Status:** Spec — Building", "", "| ZQB-1 | — | Building | MUST do a thing now committed to. |"])
        r = check(
            parse_config({"idGrammar": "catalyst", "registers": [{"scope": "ZQB", "file": SPEC, "format": "table"}]}),
            deps({SPEC: building}),
        )
        assert "uncovered" in names(r)
        assert r.stats.gated == 1

    def test_register_may_talk_about_its_own_identifiers(self):
        source = spec(
            "## User Stories",
            story("ZQS-S1"),
            "## Requirements",
            requirement("ZQS-R1", "ZQS-S1"),
            "",
            "Prose in the same document mentioning a number not yet allocated: ZQS-R9.",
        )
        r = check(cfg(), deps({SPEC: source, "t.test.ts": "ZQS-R1 ZQS-S1"}))
        assert names(r) == []

    def test_still_reports_unknown_when_different_file_names_it(self):
        source = spec("## User Stories", story("ZQS-S1"), "## Requirements", requirement("ZQS-R1", "ZQS-S1"))
        r = check(cfg(), deps({SPEC: source, "t.test.ts": "ZQS-R1 ZQS-S1 ZQS-R9"}))
        assert "unknown-id" in names(r)


class TestStructuralFaults:
    def test_fails_register_parsed_to_zero_entries(self):
        r = check(cfg(), deps({SPEC: "# Sources\n\nprose only"}))
        assert "empty-register" in names(r)

    def test_fails_register_whose_file_does_not_exist(self):
        r = check(cfg(), deps({}))
        assert "missing-register" in names(r)

    def test_fails_reserved_scope(self):
        r = check(cfg({"reservedScopes": ["ZQS"]}), deps({SPEC: HEALTHY, "t.test.ts": "ZQS-R1 ZQS-S1"}))
        assert "reserved-scope" in names(r)

    def test_surfaces_parser_problem_with_file_and_line(self):
        source = spec("## Retired Requirements", "### Requirement: ZQS-R3 — no dated record")
        r = check(cfg(), deps({SPEC: source}))
        assert "spec.retired-no-record" in names(r)
        assert f"{SPEC}:2" in r.findings[0].detail[0]

    def test_fails_reference_to_undeclared_identifier(self):
        r = check(cfg(), deps({SPEC: HEALTHY, "t.test.ts": "ZQS-R1 ZQS-S1 and a typo ZQS-R7"}))
        assert "unknown-id" in names(r)
