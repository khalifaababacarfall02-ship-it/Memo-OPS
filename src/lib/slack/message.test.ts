import { describe, expect, it } from "vitest";
import { escapeMrkdwn, slackDate, slackMessage } from "./message";
import { readSlackResponse, slackToasts } from "./result";

describe("slackMessage", () => {
  it("builds the text, the date token, the hint and the button", () => {
    const m = slackMessage({
      title: "Plan *Q4*",
      lang: "en",
      team: "growth",
      author: "Mattéo",
      startsAt: "2026-10-05T08:30:00Z",
      url: "https://memo.test/memos/1",
    });
    expect(m.text).toBe("Mattéo shared a memo for the call: Plan Q4");
    const json = JSON.stringify(m.blocks);
    expect(json).toContain("*Mattéo* shared a memo for the call on <!date^1791189000^{date_short_pretty} {time}|2026-10-05 08:30 UTC>: *Plan *Q4**");
    expect(json).toContain("Read it before the call. · Growth");
    expect(json).toContain('"url":"https://memo.test/memos/1"');
  });

  it("leaves the date out when the call has none, and names untitled memos", () => {
    const m = slackMessage({ title: " ", lang: "fr", team: "ops", author: "A", startsAt: null, url: "u" });
    expect(JSON.stringify(m.blocks)).toContain("*A* te partage un mémo pour l’appel : *");
    expect(m.text).not.toContain("<!date");
  });
});

describe("escapeMrkdwn / slackDate", () => {
  it("escapes Slack control characters", () => {
    expect(escapeMrkdwn("a < b & c > d")).toBe("a &lt; b &amp; c &gt; d");
  });
  it("refuses an invalid date", () => {
    expect(slackDate("nope")).toBeNull();
  });
});

describe("readSlackResponse / slackToasts", () => {
  it("reads a result and says what happened", () => {
    const o = readSlackResponse(true, { sent: ["a@x.fr", "b@x.fr"], missing: ["c@x.fr"], failed: [] });
    expect(slackToasts("fr", o, (e) => e.toUpperCase())).toEqual([
      "Envoyé sur Slack à 2 personnes.",
      "Pas trouvé sur Slack : C@X.FR.",
    ]);
    expect(slackToasts("en", readSlackResponse(true, { sent: ["a"], missing: [], failed: [] }))).toEqual(["Sent on Slack to 1 person."]);
  });
  it("maps errors to messages", () => {
    expect(slackToasts("fr", readSlackResponse(false, { error: "notConfigured" }))[0]).toMatch(/pas encore connecté/);
    expect(slackToasts("fr", readSlackResponse(false, { error: "nobody" }))[0]).toMatch(/Ajoute d’abord/);
    expect(slackToasts("fr", readSlackResponse(false, { error: "weird" }))[0]).toMatch(/échoué/);
    expect(slackToasts("fr", readSlackResponse(false, null))[0]).toMatch(/échoué/);
  });
});
