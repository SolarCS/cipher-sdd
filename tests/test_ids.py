"""Ported 1:1 from ids.test.ts."""

from _sdd_core import (
    format_id,
    is_id,
    kind_of,
    near_miss_pattern,
    next_number,
    reference_pattern,
    scope_of,
)


class TestSddGrammar:
    def test_accepts_story_and_requirement_tells_apart_by_kind_letter(self):
        assert is_id("ZQS-S1", "sdd") is True
        assert is_id("ZQS-R7", "sdd") is True
        assert kind_of("ZQS-S1", "sdd") == "story"
        assert kind_of("ZQS-R7", "sdd") == "requirement"

    def test_refuses_bare_number(self):
        assert is_id("ZQS-7", "sdd") is False
        assert kind_of("ZQS-7", "sdd") is None

    def test_refuses_suffix_lowercase_and_too_long_scope(self):
        for bad in ["ZQS-R1a", "src-r1", "SOURCES-R1", "ZQS-X1", "ZQS-R", "ZQS-1R"]:
            assert is_id(bad, "sdd") is False, bad


class TestCatalystCompatGrammar:
    def test_accepts_plain_form_calls_everything_a_requirement(self):
        assert is_id("ZQA-17", "catalyst") is True
        assert kind_of("ZQA-17", "catalyst") == "requirement"

    def test_rejects_suffixed_subnamespace_as_malformed(self):
        assert is_id("ZQA-US1", "catalyst") is False
        assert near_miss_pattern("ZQA").match("ZQA-US1") is not None

    def test_no_spelling_for_a_story(self):
        assert format_id("ZQA", "story", 1, "catalyst") is None
        assert format_id("ZQA", "requirement", 18, "catalyst") == "ZQA-18"


class TestNearMissDetection:
    def test_matches_bare_broken_token_never_prose(self):
        near = near_miss_pattern("ZQC")
        assert near.match("ZQC-29a") is not None
        assert near.match("zqc-29") is not None
        assert near.match("ZQC-29 rec-4 assertion shape") is None


class TestAllocation:
    def test_reads_highest_number_rather_than_counting(self):
        live = ["ZQS-R1", "ZQS-R3", "ZQS-S1"]
        assert next_number(live, "requirement", "sdd") == 4

    def test_numbers_stories_and_requirements_independently(self):
        ids = ["ZQS-S1", "ZQS-S2", "ZQS-R1"]
        assert next_number(ids, "story", "sdd") == 3
        assert next_number(ids, "requirement", "sdd") == 2

    def test_starts_at_1_for_empty_scope(self):
        assert next_number([], "story", "sdd") == 1

    def test_round_trips_through_format_id(self):
        assert format_id("ZQS", "story", 4, "sdd") == "ZQS-S4"
        assert format_id("ZQS", "requirement", 12, "sdd") == "ZQS-R12"


class TestReferenceScanning:
    def test_finds_every_id_of_known_scope(self):
        re_ = reference_pattern(["ZQS", "ZQB"], "sdd")
        text = 'it("refuses an unsigned record (ZQS-R7)", ...) and see ZQS-S1, ZQB-R2'
        assert re_.findall(text) == ["ZQS-R7", "ZQS-S1", "ZQB-R2"]

    def test_is_word_bounded(self):
        re_ = reference_pattern(["ZQS"], "sdd")
        assert re_.findall("ZQS-R70") == ["ZQS-R70"]

    def test_returns_none_when_no_scope_declared(self):
        assert reference_pattern([], "sdd") is None


class TestScopeOf:
    def test_splits_on_first_hyphen_under_both_grammars(self):
        assert scope_of("ZQS-R7") == "ZQS"
        assert scope_of("ZQA-17") == "ZQA"
