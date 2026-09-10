"""Ported 1:1 from io.test.ts, against a real throwaway git repository."""

import subprocess

import pytest

from _sdd_core import list_tracked_files, make_reader, make_revision_reader, resolve_revisions


def run(repo, *args: str) -> None:
    subprocess.run(["git", *args], cwd=repo, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)


@pytest.fixture(scope="module")
def repo(tmp_path_factory):
    root = tmp_path_factory.mktemp("sdd-io")
    run(root, "init", "-q", ".")
    run(root, "config", "user.email", "t@t")
    run(root, "config", "user.name", "t")
    (root / "src").mkdir(parents=True)
    (root / "src" / "tracked.ts").write_text("// names ZQS-R1\n", encoding="utf-8")
    # A PNG-like file: a NUL inside the first bytes, then something that looks like an identifier.
    (root / "src" / "logo.png").write_bytes(
        bytes([0x89, 0x50, 0x4E, 0x47, 0x00]) + b"ZQS-R9 looks like a reference but is image bytes"
    )
    run(root, "add", "-A")
    run(root, "commit", "-qm", "init")
    # Untracked AFTER the commit, so `git ls-files` will not list it.
    (root / "src" / "untracked.ts").write_text("// also names ZQS-R1\n", encoding="utf-8")
    return root


class TestMakeReader:
    def test_reads_a_text_file(self, repo):
        assert "ZQS-R1" in make_reader(repo)("src/tracked.ts")

    def test_none_for_missing_file(self, repo):
        assert make_reader(repo)("src/nope.ts") is None

    def test_refuses_binary_file(self, repo):
        assert make_reader(repo)("src/logo.png") is None

    def test_caches(self, repo):
        read = make_reader(repo)
        assert read("src/tracked.ts") is read("src/tracked.ts")


class TestListTrackedFiles:
    def test_lists_tracked_files_under_search_roots(self, repo):
        assert "src/tracked.ts" in list_tracked_files(repo, ["src"])

    def test_omits_untracked_file(self, repo):
        assert "src/untracked.ts" not in list_tracked_files(repo, ["src"])

    def test_empty_list_outside_a_repository(self, tmp_path_factory):
        not_a_repo = tmp_path_factory.mktemp("sdd-nogit")
        assert list_tracked_files(not_a_repo, ["."]) == []


class TestResolveRevisions:
    def test_none_when_trunk_cannot_be_resolved(self, repo):
        assert resolve_revisions(repo, "origin/does-not-exist") is None

    def test_resolves_base_and_tip_when_trunk_exists(self, repo):
        branch = subprocess.run(
            ["git", "rev-parse", "--abbrev-ref", "HEAD"], cwd=repo, capture_output=True, text=True, check=True
        ).stdout.strip()
        revisions = resolve_revisions(repo, branch)
        assert revisions is not None
        import re

        assert re.match(r"^[0-9a-f]{40}$", revisions.base)
        assert re.match(r"^[0-9a-f]{40}$", revisions.tip)


class TestMakeRevisionReader:
    def _head(self, repo) -> str:
        return subprocess.run(["git", "rev-parse", "HEAD"], cwd=repo, capture_output=True, text=True, check=True).stdout.strip()

    def test_reads_a_file_as_of_a_revision(self, repo):
        head = self._head(repo)
        assert "ZQS-R1" in make_revision_reader(repo, head)("src/tracked.ts")

    def test_none_for_path_absent_at_that_revision(self, repo):
        head = self._head(repo)
        assert make_revision_reader(repo, head)("src/untracked.ts") is None
