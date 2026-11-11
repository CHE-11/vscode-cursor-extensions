import assert from "node:assert/strict";
import { test } from "node:test";
import { extensionMatches, fileExtension, hasDiff, normalizeExtensions } from "./utils";

test("a working tree path counts as a diff, and other paths do not", () => {
  const repository = {
    state: {
      workingTreeChanges: [{ uri: { fsPath: "C:\\repo\\file.ts" } }],
    },
  };
  assert.equal(hasDiff("C:\\repo\\file.ts", repository), true);
  assert.equal(hasDiff("C:\\repo\\other.ts", repository), false);
});

test("the extension is the last dotted segment", () => {
  assert.equal(fileExtension("src\\app.ts"), "ts");
  assert.equal(fileExtension("archive.tar.gz"), "gz");
  assert.equal(fileExtension("README"), "README");
  assert.equal(fileExtension("file."), undefined);
});

test("configured extensions drop a leading dot and follow the case setting", () => {
  assert.deepEqual(normalizeExtensions([".PNG", "pdf"], false), ["png", "pdf"]);
  assert.deepEqual(normalizeExtensions([".PNG", "pdf"], true), ["PNG", "pdf"]);
});

test("matching honors case sensitivity and ignores a file with no extension segment", () => {
  assert.equal(extensionMatches("notes.PDF", [".pdf"], false), true);
  assert.equal(extensionMatches("notes.PDF", ["pdf"], true), false);
  assert.equal(extensionMatches("notes.PDF", ["PDF"], true), true);
  assert.equal(extensionMatches("file.", ["pdf"], false), false);
  assert.equal(extensionMatches("README", ["README"], true), true);
});
