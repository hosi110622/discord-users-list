const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeRecord, normalizeUsername } = require("../server");

test("normalizes cloud records to the supported schema", () => {
  assert.deepEqual(normalizeRecord({
    date: "2026-10-16",
    server: "Guild",
    chromeProfile: "Profile A",
    myUser: "Me",
    otherUser: "Other",
    isAccept: "true",
    replay: 3,
    status: "dead",
    ignored: "field"
  }), {
    date: "2026-10-16",
    server: "Guild",
    chromeProfile: "Profile A",
    myUser: "Me",
    otherUser: "Other",
    isAccept: "true",
    replay: 3,
    status: "dead"
  });
});

test("accepts legacy record field names during import", () => {
  const record = normalizeRecord({
    date: "2026-10-16",
    servername: "Old Guild",
    username: "Old Other"
  });

  assert.equal(record.server, "Old Guild");
  assert.equal(record.otherUser, "Old Other");
  assert.equal(record.isAccept, "false");
  assert.equal(record.replay, 0);
  assert.equal(record.status, "living");
});

test("requires server and other user for a record", () => {
  assert.equal(normalizeRecord({ server: "Guild" }), null);
  assert.equal(normalizeRecord({ otherUser: "Other" }), null);
});

test("normalizes other user keys case-insensitively", () => {
  assert.equal(normalizeUsername("  OTHER User "), "other user");
});
