#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const context = { globalThis: {}, console };
context.window = context.globalThis;
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'text-parser.js'), 'utf8'), context);
const Parser = context.globalThis.NeuroProfileTextParser;

function parse(text, options = {}) {
  return Parser.parse(text, options);
}

function included(result) {
  return Array.from(result.records).filter((row) => row.include);
}

function eq(actual, expected) {
  assert.deepStrictEqual(JSON.parse(JSON.stringify(actual)), expected);
}

// 1. Tab-delimited table with several standardized score columns. T-score is preferred by default.
{
  const result = parse(`Cognitive Domain\tTest Name\tRaw Score\tT-score\tPercentile\nProcessing Speed\tTrail Making Test Part A\t31\t45\t31\nAttention\tDigit Span Forward\t8\t40\t16\nMemory: Delayed Recall\tHVLT-R Delayed Recall\t6\t35\t7`);
  assert.strictEqual(result.diagnostics.layout, 'Tab-delimited table');
  assert.strictEqual(result.summary.included, 3);
  eq(included(result).map((row) => row.metric), ['T', 'T', 'T']);
  eq(included(result).map((row) => row.order), [3, 4, 6]);
}

// 2. Markdown table without a domain column. Domains are inferred from test names.
{
  const result = parse(`| Test | Scaled Score | Percentile |\n|---|---:|---:|\n| Digit Span | 8 | 25 |\n| Boston Naming Test | 11 | 63 |\n| Trail Making Test Part B | 7 | 16 |`);
  assert.strictEqual(result.diagnostics.layout, 'Markdown table');
  assert.strictEqual(result.summary.inferredDomains, 3);
  eq(included(result).map((row) => row.domain), ['Attention', 'Language', 'Executive Functions']);
  eq(included(result).map((row) => row.metric), ['Scaled', 'Scaled', 'Scaled']);
}

// 3. Fixed-width text with domain section headings and percentile suffixes.
{
  const result = parse(`Test Name                    Percentile\nProcessing Speed\nTrail Making Test Part A      31st\nCoding                        63rd\n\nAttention\nDigit Span                    25th`);
  assert.strictEqual(result.diagnostics.layout, 'Spaced text table');
  assert.strictEqual(result.summary.domains, 2);
  eq(included(result).map((row) => row.domain), ['Processing Speed', 'Processing Speed', 'Attention']);
  eq(included(result).map((row) => row.score), ['31', '63', '25']);
}

// 4. Transposed table with tests in columns and standard scores in a row.
{
  const result = parse(`Test Name,WAIS-V Vocabulary,WAIS-V Block Design,WAIS-V Coding\nDomain,Language,Visuospatial / Construction,Processing Speed\nStandard Score,105,95,90`);
  assert.strictEqual(result.diagnostics.orientation, 'columns');
  assert.strictEqual(result.summary.included, 3);
  eq(included(result).map((row) => row.metric), ['Standard', 'Standard', 'Standard']);
}

// 5. Generic Score plus row-level Metric columns.
{
  const result = parse(`Domain | Test | Score | Metric\nAttention | Digit Span | 8 | Scaled\nLanguage | Boston Naming | 45 | T-score`);
  eq(included(result).map((row) => [row.score, row.metric]), [['8', 'Scaled'], ['45', 'T']]);
}

// 6. Blank domain cells carry forward the most recent supplied domain.
{
  const result = parse(`Domain\tTest\tT Score\nProcessing Speed\tTrail Making Test Part A\t42\n\tCoding\t55\nAttention\tDigit Span\t47`);
  eq(included(result).map((row) => row.domain), ['Processing Speed', 'Processing Speed', 'Attention']);
}

// 7. Test-only table. Mood scores are recognized but excluded from the graph.
{
  const result = parse(`Test Name\tT-score\nTrail Making Test Part A\t41\nHVLT-R Total Recall\t38\nHVLT-R Delayed Recall\t32\nBoston Naming Test\t44\nGDS-15\t60`);
  assert.strictEqual(result.summary.records, 5);
  assert.strictEqual(result.summary.included, 4);
  assert.strictEqual(result.summary.excluded, 1);
  assert.strictEqual(result.records.at(-1).domain, 'Mood / Behavior');
  assert.strictEqual(result.records.at(-1).include, false);
}

// 8. Ambiguous SS headings are resolved from the numeric range.
{
  const scaled = parse(`Test Name\tSS\nDigit Span\t8\nBoston Naming Test\t11`);
  eq(included(scaled).map((row) => row.metric), ['Scaled', 'Scaled']);
  const standard = parse(`Test Name\tSS\nGeneral Ability Index\t105\nVerbal Comprehension Index\t98`);
  eq(included(standard).map((row) => row.metric), ['Standard', 'Standard']);
}

// 9. Generic scores that cannot be safely identified require the user's selected metric.
{
  const text = `Test Name\tScore\nTrail Making Test Part A\t45\nDigit Span\t50`;
  assert.throws(() => parse(text), /select its score metric/i);
  const result = parse(text, { defaultMetric: 'T' });
  eq(included(result).map((row) => row.metric), ['T', 'T']);
}

// 10. Repeated header blocks and duplicate rows are handled predictably.
{
  const result = parse(`Domain\tTest\tT-score\nProcessing Speed\tCoding\t52\nDomain\tTest\tT-score\nAttention\tDigit Span\t44\nAttention\tDigit Span\t46`);
  assert.strictEqual(result.diagnostics.headerBlocks, 2);
  assert.strictEqual(result.summary.included, 2);
  assert(result.warnings.some((warning) => /duplicate score row/i.test(warning)));
}


// 11. A report-style neuropsychology table with section headings, raw scores, T-scores, percentiles, and labels.
{
  const result = parse(`Test Name                                      Raw Score   T-score   Percentile   Score Label
Premorbid Functioning
HART-B                                         24          48        42           Average
Motor Skills
Grooved Pegboard: Dominant Hand                73          39        14           Low Average
Processing Speed
Trail Making Test (TMT): Part A                31          45        31           Average
Attention
Digit Span: Longest Span Forward                6          44        27           Average
Memory: Immediate Recall
HVLT-R: Total Recall                            21          34        5            Below Average
Memory: Delayed Recall
HVLT-R: Delayed Recall                           6          37        10           Low Average
Language
Boston Naming Test (BNT-30)                    27          50        50           Average
Executive Functions
Trail Making Test (TMT): Part B                 89          46        34           Average`);
  assert.strictEqual(result.summary.included, 8);
  eq(included(result).map((row) => row.metric), ['T', 'T', 'T', 'T', 'T', 'T', 'T', 'T']);
  assert.strictEqual(included(result)[4].domain, 'Memory: Immediate Recall');
  assert.strictEqual(included(result)[5].domain, 'Memory: Delayed Recall');
}

// 12. Inclusion, order, and patient fields are retained. A legacy Weight column is ignored.
{
  const result = parse(`Patient ID,Domain,Test,Score,Metric,Include,Weight,Order
A1,Processing Speed,Coding,52,T,Yes,2,3
A1,Attention,Digit Span,44,T,No,1,4
A1,Language,Boston Naming,11,Scaled,Yes,1.5,8`);
  assert.strictEqual(result.summary.records, 3);
  assert.strictEqual(result.summary.included, 2);
  assert.strictEqual(result.summary.excluded, 1);
  assert.strictEqual(result.records[0].patientId, 'A1');
  assert.strictEqual(Object.prototype.hasOwnProperty.call(result.records[0], 'weight'), false);
  assert.strictEqual(result.records[2].order, 8);
  eq(result.rows[0], ['DOMAIN', 'TEST', 'SCORE', 'METRIC', 'INCLUDE', 'ORDER', 'PATIENT ID']);
}

console.log(JSON.stringify({
  status: 'passed',
  parser_version: Parser.VERSION,
  datasets: 12,
  layouts: ['tab', 'markdown', 'fixed-width', 'transposed', 'pipe', 'repeated headers'],
  metrics: Array.from(Parser.METRICS),
  legacy_weight_column_ignored: true,
}, null, 2));



// Regression: common clinical report layout with separate Raw, T-score, Percentile, and Score Label columns.
const reportLayout = `Test\tRaw\tT-score\tPercentile\tScore Label
Processing Speed/Attention
Trail Making Test (TMT): Part A\t53\t41\t18
Low Average
Digit Span: Longest Span Forward\t6\t44\t27\tAverage
Digit Span: Longest Span Backward\t4\t40\t16\tLow Average`;
const reportResult = Parser.parse(reportLayout, {});
assert.equal(reportResult.records.length, 3, 'clinical report layout should yield three score rows');
assert.equal(reportResult.records[0].metric, 'T', 'T-score should be recognized as T');
assert.equal(reportResult.records[0].score, '41', 'T-score should be selected instead of raw score or percentile');
assert.equal(reportResult.records[0].domain, 'Processing Speed', 'TMT Part A should infer Processing Speed');
assert.equal(reportResult.records[1].score, '44', 'Digit Span Forward should use T-score');
assert.equal(reportResult.records[2].score, '40', 'Digit Span Backward should use T-score');
