import assert from "node:assert/strict";
import test from "node:test";
import { defineSpsPlugin } from "./index.mjs";
import { createSpsWorkerTestHarness } from "./testing.mjs";

test("records Inbox publish, update, and withdrawal evidence from a public Worker", async () => {
  const harness = createSpsWorkerTestHarness(defineSpsPlugin({
    async initialize({ inbox }) {
      await inbox.publish({ companyId: "company-1", externalId: "build-1", category: "build", title: "Build queued", summary: "Waiting" });
      await inbox.update({ companyId: "company-1", externalId: "build-1", category: "build", title: "Build complete", summary: "Ready", severity: "success" });
      await inbox.withdraw({ companyId: "company-1", externalId: "build-1" });
    },
  }));
  await harness.initialize();
  assert.deepEqual(harness.inboxItems, [{
    id: "inbox-1",
    companyId: "company-1",
    externalId: "build-1",
    title: "Build complete",
    withdrawn: true,
  }]);
  await harness.shutdown();
});

test("rejects Inbox entries that Core would reject before sending them to the Host", async () => {
  const cases = [
    { navigationTarget: "relative" },
    { navigationTarget: "//outside.example" },
    { navigationTarget: "/workspace/../settings" },
    { externalId: "x".repeat(201) },
    { category: "x".repeat(101) },
    { title: "x".repeat(201) },
    { summary: "x".repeat(2001) },
    { actionIds: ["NOT-VALID"] },
    { opaqueReference: { payload: "x".repeat(32_769) } },
  ];

  for (const overrides of cases) {
    const harness = createSpsWorkerTestHarness(defineSpsPlugin({
      async initialize({ inbox }) {
        await inbox.publish({
          companyId: "company-1",
          externalId: "build-1",
          category: "build",
          title: "Build queued",
          summary: "Waiting",
          ...overrides,
        });
      },
    }));
    await assert.rejects(() => harness.initialize(), /SPS Inbox|safe absolute SPS route|lowercase letters/);
    assert.deepEqual(harness.inboxItems, []);
    await harness.shutdown();
  }
});

test("normalizes Inbox strings exactly as the Core service does", async () => {
  const harness = createSpsWorkerTestHarness(defineSpsPlugin({
    async initialize({ inbox }) {
      await inbox.publish({
        companyId: "company-1",
        externalId: " build-1 ",
        category: " build ",
        title: " Build queued ",
        summary: " Waiting ",
        navigationTarget: "/workspace",
        actionIds: ["open"],
      });
    },
  }));
  await harness.initialize();
  assert.equal(harness.inboxItems[0].externalId, "build-1");
  await harness.shutdown();
});

test("does not let update or withdraw create an Inbox item in the test Host", async () => {
  for (const operation of ["update", "withdraw"]) {
    const harness = createSpsWorkerTestHarness(defineSpsPlugin({
      async initialize({ inbox }) {
        if (operation === "update") {
          await inbox.update({
            companyId: "company-1",
            externalId: "missing",
            category: "build",
            title: "Missing",
            summary: "Missing",
          });
          return;
        }
        await inbox.withdraw({ companyId: "company-1", externalId: "missing" });
      },
    }));
    await assert.rejects(() => harness.initialize(), /Inbox item not found/);
    assert.deepEqual(harness.inboxItems, []);
    await harness.shutdown();
  }
});
