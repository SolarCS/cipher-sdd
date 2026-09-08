import { describe, expect, it } from "vitest";

import { collidingSince, droppedSince, idsByScope } from "./permanence.js";
import { parseRegister } from "./registers.js";
import type { RegisterConfig } from "./registers.js";

const parse = (source: string, reg: RegisterConfig) => parseRegister(source, reg, "sdd");

const CONFIG = `
registers:
  - scope: SRC
    file: specs/sources/spec.md
    format: sdd
`;

const specWith = (...ids: string[]) =>
  ["## Requirements", ...ids.map((id) => `### Requirement: ${id} — a promise`)].join("\n");

const reader = (files: Record<string, string>) => (path: string) => files[path] ?? null;

const scopes = (...ids: string[]) => new Map([["SRC", new Set(ids)]]);

describe("idsByScope", () => {
  it("reads a revision's ids keyed by scope, not by path", () => {
    const got = idsByScope(
      CONFIG,
      reader({ "specs/sources/spec.md": specWith("SRC-R1", "SRC-R2") }),
      parse,
    );
    expect([...(got?.get("SRC") ?? [])]).toEqual(["SRC-R1", "SRC-R2"]);
  });

  it("also reads a JSON baseline, since a migration's baseline predates the YAML config", () => {
    const json = JSON.stringify({ registers: [{ scope: "SRC", file: "s.md", format: "sdd" }] });
    const got = idsByScope(json, reader({ "s.md": specWith("SRC-R1") }), parse);
    expect([...(got?.get("SRC") ?? [])]).toEqual(["SRC-R1"]);
  });

  it("applies schema defaults to a baseline register that omits `format`", () => {
    // Regression. Reading the baseline register raw left `format` undefined, which fell back to the
    // TABLE parser, found zero entries in a heading-format spec, and `droppedSince` then excused the
    // empty set as unreadable — so deleting a requirement outright passed the gate. Found by an
    // end-to-end run, not by a unit test, because every unit test named `format` explicitly.
    const noFormat = "registers:\n  - scope: SRC\n    file: s.md\n";
    const got = idsByScope(noFormat, reader({ "s.md": specWith("SRC-R1", "SRC-R2") }), parse);
    expect([...(got?.get("SRC") ?? [])]).toEqual(["SRC-R1", "SRC-R2"]);
  });

  it("skips a baseline register too broken to read, rather than inventing one", () => {
    const got = idsByScope("registers:\n  - notAScope: true\n", reader({}), parse);
    expect(got?.size).toBe(0);
  });

  it("returns null on an unreadable baseline config, so the caller skips rather than fails", () => {
    expect(idsByScope("{{{ not parseable", reader({}), parse)).toBeNull();
  });

  it("skips a register whose file did not exist at that revision", () => {
    const got = idsByScope(CONFIG, reader({}), parse);
    expect(got?.size).toBe(0);
  });
});

describe("droppedSince", () => {
  it("reports an id that vanished — the cheapest way to turn a red gate green", () => {
    const { droppedIds } = droppedSince(scopes("SRC-R1", "SRC-R2"), scopes("SRC-R1"));
    expect(droppedIds).toEqual(["SRC-R2"]);
  });

  it("reports a whole scope that vanished separately, since it defeats every other check", () => {
    const { droppedScopes, droppedIds } = droppedSince(scopes("SRC-R1"), new Map());
    expect(droppedScopes).toEqual(["SRC"]);
    expect(droppedIds).toEqual([]);
  });

  it("says nothing when a retired entry keeps its number", () => {
    // Retirement is not deletion: the id is still declared, so nothing was dropped.
    expect(droppedSince(scopes("SRC-R1"), scopes("SRC-R1")).droppedIds).toEqual([]);
  });

  it("treats an empty baseline scope as unreadable rather than as evidence of loss", () => {
    const { droppedIds } = droppedSince(new Map([["SRC", new Set<string>()]]), scopes("SRC-R1"));
    expect(droppedIds).toEqual([]);
  });

  it("ignores ids added since the baseline, which is the ordinary case", () => {
    expect(droppedSince(scopes("SRC-R1"), scopes("SRC-R1", "SRC-R2")).droppedIds).toEqual([]);
  });
});

describe("collidingSince", () => {
  it("reports a number both sides allocated after they diverged", () => {
    const base = scopes("SRC-R1");
    const trunk = scopes("SRC-R1", "SRC-R2");
    const branch = scopes("SRC-R1", "SRC-R2");
    expect(collidingSince(base, trunk, branch)).toEqual(["SRC-R2"]);
  });

  it("is silent when the id predates the divergence", () => {
    const base = scopes("SRC-R1");
    expect(collidingSince(base, scopes("SRC-R1"), scopes("SRC-R1"))).toEqual([]);
  });

  it("is silent when only this branch allocated it — the ordinary case", () => {
    expect(collidingSince(scopes(), scopes(), scopes("SRC-R9"))).toEqual([]);
  });

  it("is silent when only the trunk allocated it — the trunk moving on", () => {
    expect(collidingSince(scopes(), scopes("SRC-R9"), scopes())).toEqual([]);
  });
});
