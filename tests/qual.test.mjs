import assert from "node:assert/strict";
import { test } from "node:test";
import { assessSaturation, guestFigure3, interviewRecord, parseNewCodeCounts, saturationRecord } from "../assets/qual.mjs";

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
  assert.equal(result.exceedsAfterFirst, 3);
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
  assert.deepEqual(parseNewCodeCounts("３\r\n１\r\n０\r\n"), [3, 1, 0]);
  assert.deepEqual(parseNewCodeCounts("3,\n 1,\n 0"), [3, 1, 0]);
  for (const invalid of ["", "1,,2", "1, -2", "1.5", "2e1", "9007199254740992", "1\n\n2", "1\t\t2"]) {
    assert.throws(() => parseNewCodeCounts(invalid), /填写|非负整数/);
  }
  assert.throws(() => parseNewCodeCounts("1\r\n\r\n0"), /第 2 个位置/);
});

test("spreadsheet paste preserves boundary cells and permits one terminal row delimiter", () => {
  assert.deepEqual(parseNewCodeCounts("1\n0\n"), [1, 0]);
  assert.deepEqual(parseNewCodeCounts("1\r0\r"), [1, 0]);
  assert.deepEqual(parseNewCodeCounts("1\r\n0\r\n"), [1, 0]);
  for (const input of ["\t1\n0", "\n1\n0", "\r\n1\r\n0", " \n1\n0"]) {
    assert.throws(() => parseNewCodeCounts(input), /第 1 个位置/);
  }
  for (const input of ["1\n0\n\n", "1\r\n0\r\n\r\n", "1\n0\t", "1\n0\n  \n"]) {
    assert.throws(() => parseNewCodeCounts(input), /第 3 个位置/);
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

test("a saturation record preserves the ordered counts, parameters, exact ratios and data source", () => {
  const result = assessSaturation(guestFigure3, 4, 2, 5);
  const record = saturationRecord(result, true);

  assert.match(record, /图 3 的示例计数/);
  assert.match(record, /基准访谈数 4 次/);
  assert.match(record, /窗口长度 2 次访谈/);
  assert.match(record, /新增信息阈值 ≤5%/);
  assert.ok(record.includes(result.counts.join(", ")));
  assert.ok(record.includes("5 至 6\t7/37\t18.92%\t否"));
  assert.ok(record.includes("7 至 8\t1/37\t2.7%\t是"));
  assert.ok(record.includes("6+2"));
  assert.match(record, /之后仍有 3 个窗口超过阈值/);
  assert.match(record, /10\.1371\/journal\.pone\.0232076/);
});

test("a user-entered saturation record leaves the threshold unset when no window passes", () => {
  const result = assessSaturation([20, 1], 1, 1, 0);
  const record = saturationRecord(result);

  assert.match(record, /研究者录入的计数/);
  assert.match(record, /均高于设定阈值/);
  assert.ok(record.includes("2\t1/20\t5%\t否"));
  assert.doesNotMatch(record, /图 3|之后仍有/);
});
