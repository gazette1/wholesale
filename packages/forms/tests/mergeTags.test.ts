import { describe, it, expect } from "vitest";
import { choiceLabels, mergeTagKeys, renderMergeTags } from "../src";
import { sample } from "./helpers";

describe("renderMergeTags", () => {
  it("replaces tags with answers", () => {
    expect(renderMergeTags("Welcome {{form.first_name}}, you start on {{ form.start_date }}.", { first_name: "Ous", start_date: "2026-10-12" }))
      .toBe("Welcome Ous, you start on 2026-10-12.");
  });

  it("escapes HTML by default", () => {
    expect(renderMergeTags("<p>{{form.note}}</p>", { note: `<script>alert("x")</script> & 'y'` }))
      .toBe("<p>&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;y&#39;</p>");
  });

  it("can skip escaping for plain text output", () => {
    expect(renderMergeTags("{{form.note}}", { note: "a < b" }, { escapeHtml: false })).toBe("a < b");
  });

  it("joins arrays, writes booleans as Yes and No, and leaves missing values empty", () => {
    expect(renderMergeTags("{{form.tags}}|{{form.ok}}|{{form.no}}|{{form.missing}}|{{form.n}}", { tags: ["a", "b"], ok: true, no: false, n: 0 }))
      .toBe("a, b|Yes|No||0");
  });

  it("uses choice labels when given", () => {
    const labels = choiceLabels(sample());
    expect(renderMergeTags("{{form.color}} / {{form.tags}}", { color: "red", tags: ["x", "z"] }, { labels })).toBe("Red / X, Z");
  });

  it("leaves other braces alone and lists tag keys", () => {
    expect(renderMergeTags("{{other.key}} {{form.a}}", { a: "1" })).toBe("{{other.key}} 1");
    expect(mergeTagKeys("{{form.a}} {{form.b}} {{form.a}}")).toEqual(["a", "b"]);
  });
});
