"""Config-schema behavior not already exercised through check.test.ts's cfg() helper: strict
rejection, scope validation, duplicate-scope detection, and find_config's upward walk. config.ts
has no dedicated TS test file of its own -- it's exercised indirectly everywhere else -- so these
are new, not ported, covering the seam the Python migration touched directly (YAML -> TOML).
"""

import pytest

from _sdd_core import ConfigError, SddConfig, find_config, parse_config, scopes_of


class TestParseConfig:
    def test_applies_defaults_for_an_empty_config(self):
        config = parse_config({})
        assert config == SddConfig()

    def test_rejects_an_unrecognised_top_level_key(self):
        with pytest.raises(ConfigError):
            parse_config({"totallyMadeUp": True})

    def test_rejects_a_lowercase_scope(self):
        with pytest.raises(ConfigError):
            parse_config({"registers": [{"scope": "zqs", "file": "f.md"}]})

    def test_rejects_a_scope_over_five_letters(self):
        with pytest.raises(ConfigError):
            parse_config({"registers": [{"scope": "TOOLONG", "file": "f.md"}]})

    def test_rejects_an_unrecognised_register_key(self):
        with pytest.raises(ConfigError):
            parse_config({"registers": [{"scope": "ZQS", "file": "f.md", "notAField": 1}]})

    def test_register_format_defaults_to_sdd_when_omitted(self):
        config = parse_config({"registers": [{"scope": "ZQS", "file": "f.md"}]})
        assert config.registers[0].format == "sdd"

    def test_gate_and_context_default_to_empty_prose(self):
        config = parse_config({})
        assert config.gate == ""
        assert config.context == ""


class TestScopesOf:
    def test_lists_scopes_in_declaration_order(self):
        config = parse_config({"registers": [{"scope": "ZQB", "file": "a.md"}, {"scope": "ZQA", "file": "b.md"}]})
        assert scopes_of(config) == ["ZQB", "ZQA"]

    def test_raises_on_a_scope_claimed_twice(self):
        config = parse_config({"registers": [{"scope": "ZQS", "file": "a.md"}, {"scope": "ZQS", "file": "b.md"}]})
        with pytest.raises(ConfigError):
            scopes_of(config)


class TestFindConfig:
    def test_finds_config_in_the_starting_directory(self, tmp_path):
        (tmp_path / "sdd.config.toml").write_text("", encoding="utf-8")
        assert find_config(tmp_path) == tmp_path / "sdd.config.toml"

    def test_walks_up_from_a_subdirectory(self, tmp_path):
        (tmp_path / "sdd.config.toml").write_text("", encoding="utf-8")
        sub = tmp_path / "a" / "b" / "c"
        sub.mkdir(parents=True)
        assert find_config(sub) == tmp_path / "sdd.config.toml"

    def test_returns_none_when_no_config_exists(self, tmp_path):
        assert find_config(tmp_path) is None
