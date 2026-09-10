"""Ported 1:1 from registers.test.ts."""

from _sdd_core import RegisterEntryConfig, parse_register, parse_spec_register, parse_table_register

ZQS = RegisterEntryConfig(scope="ZQS", file="specs/sources/spec.md", format="sdd")


def spec(body: str, reg: RegisterEntryConfig = ZQS):
    return parse_spec_register(body, reg, "sdd")


def kinds(result):
    return [p.kind for p in result.problems]


class TestTableFormatLegacy:
    ZQB = RegisterEntryConfig(scope="ZQB", file="legacy/x/spec.md")

    def test_reads_rows_ignores_non_rows(self):
        r = parse_table_register(
            "\n".join(["prose", "| ZQB-1 | — | Building | MUST verify. |", "| not a row"]),
            self.ZQB,
            "catalyst",
        )
        assert [e.id for e in r.entries] == ["ZQB-1"]
        assert r.entries[0].kind == "requirement"

    def test_treats_whole_cell_withdrawn_as_retirement_never_prose(self):
        r = parse_table_register(
            "\n".join(
                [
                    "| ZQB-1 | — | Building | MUST refuse a grant that has been withdrawn. |",
                    "| ZQB-2 | — | Withdrawn | Superseded by ZQB-1. |",
                ]
            ),
            self.ZQB,
            "catalyst",
        )
        by_id = {e.id: e for e in r.entries}
        assert by_id["ZQB-1"].withdrawn is False
        assert by_id["ZQB-2"].withdrawn is True

    def test_reports_near_miss_row_rather_than_dropping(self):
        r = parse_table_register("| ZQB-1a | — | Building | broken |", self.ZQB, "catalyst")
        assert r.entries == ()
        assert list(r.malformed) == ["ZQB-1a"]


class TestSddFormatSectionsDecideState:
    def test_reads_stories_and_requirements_out_of_one_document(self):
        r = spec(
            "\n".join(
                [
                    "## User Stories",
                    "### User Story: ZQS-S1 — Register a path pattern",
                    "## Requirements",
                    "### Requirement: ZQS-R1 — MUST accept a param segment",
                    "> Story: ZQS-S1",
                ]
            )
        )
        assert [(e.id, e.kind) for e in r.entries] == [("ZQS-S1", "story"), ("ZQS-R1", "requirement")]
        assert list(r.entries[1].stories) == ["ZQS-S1"]
        assert r.problems == ()

    def test_marks_proposed_not_gated_retired_as_withdrawn(self):
        r = spec(
            "\n".join(
                [
                    "## Proposed Requirements",
                    "### Requirement: ZQS-R2 — MUST rank literal over param",
                    "## Retired Requirements",
                    "### Requirement: ZQS-R3 — replaced by a whole-grant read",
                    "> Retired 2026-09-04 by `af8b0690`.",
                ]
            )
        )
        by_id = {e.id: e for e in r.entries}
        assert by_id["ZQS-R2"].proposed is True
        assert by_id["ZQS-R2"].withdrawn is False
        assert by_id["ZQS-R3"].withdrawn is True
        assert r.problems == ()

    def test_demands_dated_record_on_retired_entry(self):
        r = spec("\n".join(["## Retired Requirements", "### Requirement: ZQS-R3 — gone with no reason"]))
        assert kinds(r) == ["retired-no-record"]

    def test_flags_misspelt_retired_heading(self):
        r = spec("\n".join(["## Retired requirement", "### Requirement: ZQS-R3 — filed under a typo"]))
        assert "retired-heading-spelling" in kinds(r)

    def test_flags_entry_outside_known_section(self):
        r = spec("\n".join(["## Notes", "### Requirement: ZQS-R9 — orphaned"]))
        assert kinds(r) == ["orphan"]
        assert r.entries == ()


class TestSddFormatKindMustAgree:
    def test_flags_requirement_filed_under_user_stories(self):
        r = spec("\n".join(["## User Stories", "### Requirement: ZQS-R1 — misfiled"]))
        assert kinds(r) == ["kind-section-mismatch"]
        assert r.entries == ()

    def test_flags_heading_keyword_id_disagreement(self):
        r = spec("\n".join(["## User Stories", "### User Story: ZQS-R4 — heading says story"]))
        assert kinds(r) == ["kind-id-mismatch"]
        assert r.entries == ()


class TestSddFormatLooksLikeADeclaration:
    def test_ignores_requirement_inside_fenced_block(self):
        r = spec(
            "\n".join(
                [
                    "## Requirements",
                    "```markdown",
                    "### Requirement: ZQS-R99 — an example in the docs",
                    "```",
                    "### Requirement: ZQS-R1 — the real one",
                ]
            )
        )
        assert [e.id for e in r.entries] == ["ZQS-R1"]

    def test_closes_fence_only_on_same_char_and_length(self):
        r = spec(
            "\n".join(
                [
                    "## Requirements",
                    "````",
                    "```",
                    "### Requirement: ZQS-R99 — still fenced",
                    "````",
                    "### Requirement: ZQS-R1 — after the real close",
                ]
            )
        )
        assert [e.id for e in r.entries] == ["ZQS-R1"]

    def test_ignores_commented_requirement_across_lines(self):
        r = spec(
            "\n".join(
                [
                    "## Requirements",
                    "<!--",
                    "### Requirement: ZQS-R99 — the scaffold's worked example",
                    "-->",
                    "### Requirement: ZQS-R1 — live",
                ]
            )
        )
        assert [e.id for e in r.entries] == ["ZQS-R1"]

    def test_clarification_flagged_live_tolerated_proposed(self):
        live = spec(
            "\n".join(["## Requirements", "### Requirement: ZQS-R1 — MUST accept [NEEDS CLARIFICATION: which encodings?]"])
        )
        assert kinds(live) == ["clarification"]

        proposed = spec(
            "\n".join(["## Proposed Requirements", "### Requirement: ZQS-R1 — MUST accept [NEEDS CLARIFICATION: which encodings?]"])
        )
        assert kinds(proposed) == []


class TestSddFormatScenarios:
    strict = RegisterEntryConfig(scope=ZQS.scope, file=ZQS.file, format=ZQS.format, requireScenarios=True)

    def test_demands_when_and_then(self):
        r = parse_spec_register(
            "\n".join(
                [
                    "## Requirements",
                    "### Requirement: ZQS-R1 — MUST match one segment",
                    "#### Scenario: a bare param",
                    "- **GIVEN** a registered pattern",
                    "- **WHEN** a request arrives",
                ]
            ),
            self.strict,
            "sdd",
        )
        assert kinds(r) == ["scenario-no-then"]

    def test_demands_scenario_per_live_requirement_never_retired(self):
        r = parse_spec_register(
            "\n".join(
                [
                    "## Requirements",
                    "### Requirement: ZQS-R1 — no scenario at all",
                    "## Retired Requirements",
                    "### Requirement: ZQS-R2 — retired, exempt",
                    "> Retired 2026-09-04 by `abc1234`.",
                ]
            ),
            self.strict,
            "sdd",
        )
        assert kinds(r) == ["no-scenario"]


class TestStoryLinks:
    def test_reads_several_stories_off_one_line(self):
        r = spec("\n".join(["## Requirements", "### Requirement: ZQS-R1 — serves two slices", "> Story: ZQS-S1, ZQS-S2"]))
        assert list(r.entries[0].stories) == ["ZQS-S1", "ZQS-S2"]

    def test_leaves_stories_empty_when_line_absent(self):
        r = spec("\n".join(["## Requirements", "### Requirement: ZQS-R1 — orphan behaviour"]))
        assert list(r.entries[0].stories) == []


class TestTableFormatLifecycleStatus:
    ZQB = RegisterEntryConfig(scope="ZQB", file="legacy/x/spec.md", format="table")

    def read(self, body: str):
        return parse_table_register(body, self.ZQB, "catalyst").status

    def test_reads_draft_building_shipped(self):
        for want in ["Draft", "Building", "Shipped"]:
            assert self.read(f"> **Status:** Spec — {want}\n\n| ZQB-1 | — | x | y |") == want

    def test_reads_first_match_only(self):
        body = "\n".join(
            [
                "> **Status:** Spec — Shipped",
                "",
                "The contract requires an opening line reading:",
                "",
                "> **Status:** Spec — Draft",
            ]
        )
        assert self.read(body) == "Shipped"

    def test_reports_no_status_when_none_declared(self):
        assert self.read("| ZQB-1 | — | x | y |") is None

    def test_tolerates_hyphen_for_em_dash(self):
        assert self.read("> **Status:** Spec - Building\n\n| ZQB-1 | — | x | y |") == "Building"


class TestFormatDispatch:
    def test_defaults_to_table_format(self):
        r = parse_register("| ZQB-1 | — | Building | x |", RegisterEntryConfig(scope="ZQB", file="f"), "catalyst")
        assert [e.id for e in r.entries] == ["ZQB-1"]

    def test_reports_unknown_format_rather_than_fallback(self):
        r = parse_register(
            "anything",
            RegisterEntryConfig(scope="ZQB", file="f", format="openspec"),  # type: ignore[arg-type]
            "catalyst",
        )
        assert r.unknownFormat == "openspec"
        assert r.entries == ()
