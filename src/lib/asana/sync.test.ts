import { describe, expect, it } from "vitest";
import { ui } from "@/lib/content";
import {
  SEND_ERROR_STATUS,
  isAssigneeRejection,
  isTaskGid,
  parseSendBody,
  planAsanaSync,
  readSendResponse,
  sendToast,
  taskInProject,
  taskUrl,
} from "./sync";

const ID = "3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e";
const author = { id: "author", isAdmin: false };
const decider = { id: "decider", isAdmin: false };
const admin = { id: "boss", isAdmin: true };
const member = { id: "member", isAdmin: false };
const memo = { authorId: "author", deciderId: "decider", taskGid: null };
const deciderProfile = { email: "lea@boxhero.test", asanaUserGid: null };

describe("parseSendBody", () => {
  it("accepts { memoId: uuid } and lower-cases it", () => {
    expect(parseSendBody({ memoId: ID })).toBe(ID);
    expect(parseSendBody({ memoId: ID.toUpperCase() })).toBe(ID);
  });
  it.each([
    null,
    "x",
    [ID],
    {},
    { memoId: 42 },
    { memoId: "" },
    { memoId: `${ID} ` },
    { memoId: "../tasks" },
    { memoId: ID.slice(0, -1) },
    { id: ID },
  ])("rejects %j", (body) => {
    expect(parseSendBody(body)).toBeNull();
  });
});

describe("planAsanaSync", () => {
  it("lets the author, the decision maker and admins send", () => {
    for (const v of [author, decider, admin]) {
      expect(planAsanaSync(v, memo, deciderProfile)).toEqual({
        ok: true,
        assignee: "lea@boxhero.test",
        existingGid: null,
      });
    }
  });
  it("refuses anyone else, even a team member who can read the memo", () => {
    expect(planAsanaSync(member, memo, deciderProfile)).toEqual({ ok: false, code: "forbidden" });
  });
  it("does not treat a missing decision maker as a match for a viewer", () => {
    expect(planAsanaSync({ id: "", isAdmin: false }, { ...memo, deciderId: null }, null)).toEqual({
      ok: false,
      code: "forbidden",
    });
  });
  it("needs a decision maker", () => {
    expect(planAsanaSync(author, { ...memo, deciderId: null }, null)).toEqual({ ok: false, code: "needDecider" });
    // Decider row not readable / deleted: same answer.
    expect(planAsanaSync(author, memo, null)).toEqual({ ok: false, code: "needDecider" });
    expect(planAsanaSync(author, memo, { email: " ", asanaUserGid: null })).toEqual({
      ok: false,
      code: "needDecider",
    });
  });
  it("assigns to the Asana user gid when known, else the email", () => {
    const plan = planAsanaSync(author, memo, { email: "lea@boxhero.test", asanaUserGid: "1201" });
    expect(plan).toMatchObject({ ok: true, assignee: "1201" });
    const bad = planAsanaSync(author, memo, { email: "lea@boxhero.test", asanaUserGid: "me" });
    expect(bad).toMatchObject({ ok: true, assignee: "lea@boxhero.test" });
  });
  it("only reuses a well-formed stored task gid", () => {
    expect(planAsanaSync(author, { ...memo, taskGid: "1209" }, deciderProfile)).toMatchObject({ existingGid: "1209" });
    expect(planAsanaSync(author, { ...memo, taskGid: "12/../x" }, deciderProfile)).toMatchObject({ existingGid: null });
  });
});

describe("taskInProject", () => {
  it("is true only when one membership is the Memos project", () => {
    expect(taskInProject({ memberships: [{ project: { gid: "9" } }, { project: { gid: "7" } }] }, "7")).toBe(true);
    expect(taskInProject({ memberships: [{ project: { gid: "9" } }] }, "7")).toBe(false);
    expect(taskInProject({ memberships: [] }, "7")).toBe(false);
    expect(taskInProject({}, "7")).toBe(false);
    expect(taskInProject({ memberships: [null, { project: null }] }, "7")).toBe(false);
    expect(taskInProject({ memberships: [{ project: { gid: "" } }] }, "")).toBe(false);
  });
});

describe("isAssigneeRejection", () => {
  it("recognises Asana refusing the assignee", () => {
    expect(isAssigneeRejection({ status: 400, messages: ["assignee: Not a recognized ID: x@y.z"] })).toBe(true);
    expect(isAssigneeRejection({ status: 403, messages: ["The user is not a member of this workspace"] })).toBe(true);
  });
  it("leaves other failures alone", () => {
    expect(isAssigneeRejection({ status: 400, messages: ["projects: Not a recognized ID"] })).toBe(false);
    expect(isAssigneeRejection({ status: 401, messages: ["Not Authorized"] })).toBe(false);
    expect(isAssigneeRejection({ status: 500, messages: ["assignee"] })).toBe(false);
    expect(isAssigneeRejection({ status: 400, messages: [] })).toBe(false);
  });
});

describe("taskUrl", () => {
  it("prefers Asana's permalink", () => {
    expect(taskUrl({ gid: "12", permalink_url: "https://app.asana.com/1/1/task/12" }, "7")).toBe(
      "https://app.asana.com/1/1/task/12",
    );
  });
  it("falls back to the project/task URL, never to a non-https permalink", () => {
    expect(taskUrl({ gid: "12" }, "7")).toBe("https://app.asana.com/0/7/12");
    expect(taskUrl({ gid: "12", permalink_url: "javascript:alert(1)" }, "7")).toBe("https://app.asana.com/0/7/12");
    expect(taskUrl({ gid: "12" }, "")).toBe("https://app.asana.com/0/0/12");
  });
});

describe("readSendResponse / sendToast", () => {
  const ok = { gid: "12", url: "https://app.asana.com/0/7/12", assigned: true, updated: false };
  it("reads a success", () => {
    expect(readSendResponse(true, ok)).toEqual({ ok: true, result: ok });
    expect(sendToast("fr", readSendResponse(true, ok))).toBe(ui("fr").asanaDone);
    expect(sendToast("en", readSendResponse(true, { ...ok, updated: true }))).toBe(ui("en").asanaUpdated);
    expect(sendToast("fr", readSendResponse(true, { ...ok, assigned: false }))).toBe(ui("fr").asanaUnassigned);
    expect(sendToast("fr", readSendResponse(true, { ...ok, assigned: false, updated: true }))).toBe(
      ui("fr").asanaUpdated,
    );
  });
  it("maps errors to messages", () => {
    expect(sendToast("fr", readSendResponse(false, { error: "needDecider" }))).toBe(ui("fr").needDecider);
    expect(sendToast("fr", readSendResponse(false, { error: "forbidden" }))).toBe(ui("fr").notAllowed);
    expect(sendToast("fr", readSendResponse(false, { error: "asanaError" }))).toBe(ui("fr").asanaError);
    expect(sendToast("en", readSendResponse(false, null))).toBe(ui("en").asanaError);
    expect(readSendResponse(false, { error: "toString" })).toEqual({ ok: false, code: "asanaError" });
    expect(sendToast("en", { ok: false, code: "network" })).toBe(ui("en").asanaError);
  });
  it("never trusts a malformed success", () => {
    expect(readSendResponse(true, { ...ok, gid: "x" }).ok).toBe(false);
    expect(readSendResponse(true, { ...ok, url: "javascript:alert(1)" }).ok).toBe(false);
    expect(readSendResponse(false, ok).ok).toBe(false);
  });
});

describe("constants", () => {
  it("gives every error code an HTTP status", () => {
    expect(SEND_ERROR_STATUS).toMatchObject({ unauthorized: 401, forbidden: 403, needDecider: 409, notConfigured: 404 });
  });
  it("validates gids like the database does", () => {
    expect(isTaskGid("1209876543210")).toBe(true);
    expect(isTaskGid("1".repeat(33))).toBe(false);
    expect(isTaskGid("12a")).toBe(false);
    expect(isTaskGid(12)).toBe(false);
  });
});
