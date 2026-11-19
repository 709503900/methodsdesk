import assert from "node:assert/strict";
import { test } from "node:test";
import { assessSaturation, guestFigure3, interviewRecord, parseNewCodeCounts } from "../assets/qual.mjs";

test("Guest et al. Fig. 3 uses a fixed baseline and overlapping windows", () => {
  const result = assessSaturation(guestFigure3, 4, 2, 5);

  assert.equal(result.baseCodes, 37);
  assert.deepEqual(result.windows.slice(0, 3), [
    { start: 5, end: 6, newCodes: 7, ratio: 7 / 37, meetsThreshold: false },
    { start: 6, end: 7, newCodes: 4, ratio: 4 / 37, meetsThreshold: false },
    { start: 7, end: 8, newCodes: 1, ratio: 1 / 37, meetsThreshold: true },
  ]);
  assert.equal(result.first.end, 8);
  assert.equal(result.notation, "6+2");
  assert.equal(result.windows.length, 15);
});

test("Guest et al. Fig. 3 reaches the zero-information threshold at 10+2", () => {
  const result = assessSaturation(guestFigure3, 4, 2, 0);

  assert.equal(result.first.end, 12);
  assert.equal(result.notation, "10+2");
  assert.equal(result.first.ratio, 0);
});

test("assess windows with exact proportions including an exact threshold", () => {
  const equal = assessSaturation([20, 1], 1, 1, 5);
  const above = assessSaturation([37, 2], 1, 1, 5);

  assert.equal(equal.windows[0].meetsThreshold, true);
  assert.equal(equal.notation, "1+1");
  assert.equal(above.windows[0].meetsThreshold, false);
  assert.equal(above.first, null);
  assert.equal(above.notation, null);
});

test("reject undefined denominators and incomplete windows", () => {
  assert.throws(() => assessSaturation([0, 0, 0], 2, 1, 0), /无法计算/);
  assert.throws(() => assessSaturation([4, 3, 0], 2, 2, 0), /完整窗口/);
  assert.throws(() => assessSaturation([4, 3, 0], 0, 1, 0), /基准访谈数/);
  assert.throws(() => assessSaturation([4, 3, 0], 2, 0, 0), /窗口长度/);
  assert.throws(() => assessSaturation([4, 3, 0], 2, 1, -1), /阈值/);
});

test("counts accept common delimiters and reject missing or invalid entries", () => {
  assert.deepEqual(parseNewCodeCounts(" 17, 8，5、7\n4\t3\n1 0 "), [17, 8, 5, 7, 4, 3, 1, 0]);
  for (const invalid of ["", "1,,2", "1, -2", "1.5", "2e1", "9007199254740992"]) {
    assert.throws(() => parseNewCodeCounts(invalid), /填写|非负整数/);
  }
});

test("interview record preserves the researcher's plan, rationale and review trigger", () => {
  const values = {
    aim: "理解志愿者的实践经验",
    specificity: "完成两场活动的志愿者",
    theory: "组织参与概念",
    dialogue: "试访演练追问顺序",
    analysis: "比较不同岗位的经历",
    plan: "初拟访谈 10 至 12 人",
    review: "完成第一批访谈后核查岗位覆盖情况",
  };

  const record = interviewRecord(values);
  for (const value of Object.values(values)) assert.ok(record.includes(value));
  assert.match(record, /10\.1177\/1049732315617444/);
  assert.throws(() => interviewRecord({ ...values, review: "  " }), /复核节点/);
});
