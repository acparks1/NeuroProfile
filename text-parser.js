(function (global) {
  'use strict';

  const VERSION = '0.16';
  const MAX_TEXT_LENGTH = 750000;
  const MAX_ROWS = 10000;
  const MAX_RECORDS = 5000;
  const METRICS = Object.freeze(['T', 'Z', 'Standard', 'Scaled', 'Percentile']);
  const METRIC_PRIORITY = Object.freeze(['T', 'Z', 'Standard', 'Scaled', 'Percentile']);
  const DOMAIN_ORDER = Object.freeze([
    'Premorbid Functioning',
    'Motor Skills',
    'Processing Speed',
    'Attention',
    'Memory: Immediate Recall',
    'Memory: Delayed Recall',
    'Memory',
    'Language',
    'Visuospatial / Construction',
    'Executive Functions',
    'Mood / Behavior',
    'Unassigned',
  ]);

  const DOMAIN_ALIASES = Object.freeze([
    [/^(premorbid|premorbid functioning|estimated premorbid|intellectual estimate|general intellectual ability)$/i, 'Premorbid Functioning'],
    [/^(motor|motor skills|fine motor|motor speed|manual dexterity)$/i, 'Motor Skills'],
    [/^(processing speed|psychomotor speed|speed of processing|visual processing speed)$/i, 'Processing Speed'],
    [/^(attention|attention\/working memory|attention and working memory|attention & working memory|working memory|auditory attention|complex attention)$/i, 'Attention'],
    [/^(memory[:\s-]*immediate recall|immediate memory|immediate recall|learning|verbal learning)$/i, 'Memory: Immediate Recall'],
    [/^(memory[:\s-]*delayed recall|delayed memory|delayed recall|retention|recognition memory)$/i, 'Memory: Delayed Recall'],
    [/^(memory|verbal memory|visual memory|learning and memory|learning & memory|verbal learning and memory|visual learning and memory)$/i, 'Memory'],
    [/^(language|expressive language|verbal abilities)$/i, 'Language'],
    [/^(visuospatial|visuospatial\/construction|visuospatial \/ construction|visuospatial and construction|visuospatial & construction|visual perception and construction|visual perception \/ construction|visual spatial|visual-spatial|construction|constructional praxis|perceptual reasoning)$/i, 'Visuospatial / Construction'],
    [/^(executive|executive functions|executive functioning|reasoning|problem solving|cognitive flexibility)$/i, 'Executive Functions'],
    [/^(mood|behavior|mood\/behavior|mood \/ behavior|emotional functioning|psychological functioning|self-report)$/i, 'Mood / Behavior'],
  ]);

  const TEST_DOMAIN_RULES = Object.freeze([
    { pattern: /\b(hart|topf|test of premorbid|wtar|nart|am[n]?art|word reading|premorbid)\b/i, domain: 'Premorbid Functioning' },
    { pattern: /\b(grooved pegboard|finger tapping|finger oscillation|purdue pegboard|manual dexterity)\b/i, domain: 'Motor Skills' },
    { pattern: /\b(?:trail\s+making\s+test\s*\(\s*tmt\s*\)\s*[:,-]?\s*part\s*a|trail(?:\s+making)?(?:\s+test)?\s*(?:part\s*)?a|tmt[-\s]*a)\b/i, domain: 'Processing Speed' },
    { pattern: /\b(coding\b|symbol search\b|sdmt\b|symbol digit modalities|visual scanning|number sequencing|color naming|word reading|stroop\s+(?:word|color)\b|psychomotor speed)\b/i, domain: 'Processing Speed' },
    { pattern: /\b(digit span|digits? forward|digits? backward|digit sequencing|letter[-\s]number sequencing|symbol span|brief test of attention|continuous performance|cpt[-\s]?\d*|working memory|paced auditory serial addition|pasat)\b/i, domain: 'Attention' },
    { pattern: /\b(delayed recall|delay recall|long delay|short delay|retention|recognition|discrimination|recog(?:nition)?\s*disc|logical memory\s*(?:ii|2)\b|verbal paired associates\s*(?:ii|2)\b|visual reproduction\s*(?:ii|2)\b|bvmt.*delay|hvlt.*delay|cvlt.*delay|ravlt.*delay)\b/i, domain: 'Memory: Delayed Recall' },
    { pattern: /\b(hvlt|cvlt|ravlt|avlt|list learning|logical memory\s*(?:i|1)\b|story learning|verbal paired associates\s*(?:i|1)\b|bvmt.*(?:total|learning|trial)|visual reproduction\s*(?:i|1)\b|immediate recall|total recall|learning slope|learning trials?)\b/i, domain: 'Memory: Immediate Recall' },
    { pattern: /\b(boston naming|naming test|multilingual naming|mints\b|category fluency|semantic fluency|animal fluency|animals\b|supermarket items|vocabulary|information subtest|word knowledge)\b/i, domain: 'Language' },
    { pattern: /\b(rey complex figure|rcft\b|complex figure|block design|visual puzzles|judgment of line orientation|jlo\b|facial recognition|clock drawing|construction|figure copy|hooper visual organization|benton facial)\b/i, domain: 'Visuospatial / Construction' },
    { pattern: /\b(trail(?:\s+making)?(?:\s+test)?\s*(?:part\s*)?b\b|tmt[-\s]*b\b|wcst|m[-\s]?wcst|wisconsin card|set switching|switching|inhibition|interference|color[-\s]word interference|letter fluency|phonemic fluency|cifa letter|f[-\s]?a[-\s]?s\b|cowa\b|verbal fluency.*letter|cognitive estimation|problem solving|tower test|matrix reasoning)\b/i, domain: 'Executive Functions' },
    { pattern: /\b(gds|geriatric depression|bdi|beck depression|phq[-\s]?9|bai|beck anxiety|gad[-\s]?7|gas[-\s]?10|anxiety scale|depression scale|neuropsychiatric inventory|npi[-\s]?q|mood)\b/i, domain: 'Mood / Behavior', exclude: true },
  ]);

  function cleanText(value) {
    return String(value == null ? '' : value)
      .replace(/\u00a0/g, ' ')
      .replace(/[\u200b-\u200d\ufeff]/g, '')
      .trim();
  }

  function cleanToken(value) {
    return cleanText(value)
      .toLowerCase()
      .replace(/%/g, ' percent ')
      .replace(/[–—−]/g, '-')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .replace(/\s+/g, ' ');
  }

  function compactToken(value) {
    return cleanToken(value).replace(/\s+/g, '');
  }

  function normalizeMetric(value) {
    const token = compactToken(value);
    if (!token) return null;
    if (['t', 'tscore', 'tscores'].includes(token)) return 'T';
    if (['z', 'zscore', 'zscores'].includes(token)) return 'Z';
    if (['standard', 'standardscore', 'standardscores', 'stdscore', 'indexscore', 'compositescore'].includes(token)) return 'Standard';
    if (['scaled', 'scaledscore', 'scaledscores'].includes(token)) return 'Scaled';
    if (['percentile', 'percentiles', 'percentilerank', 'percentileranks', 'pr', 'percent', 'ile'].includes(token)) return 'Percentile';
    return null;
  }

  function classifyHeader(value) {
    const token = cleanToken(value);
    const compact = token.replace(/\s+/g, '');
    if (!compact) return null;

    if (/^(raw|rawscore|rawscores)$/.test(compact)) return { kind: 'ignore', subtype: 'raw' };
    if (/^(scorelabel|qualitativelabel|classification|descriptor|range|interpretation)$/.test(compact)) return { kind: 'ignore', subtype: 'label' };
    // Report tables often label standardized-score columns as "Raw T-score" or "Raw z-score".
    // The "Raw" prefix describes the source table, not the metric being used for plotting.
    if (/^raw(?:t|tscore|tscores)$/.test(compact)) return { kind: 'score', metric: 'T', specific: true };
    if (/^raw(?:z|zscore|zscores)$/.test(compact)) return { kind: 'score', metric: 'Z', specific: true };
    if (/^raw(?:standard|standardscore|standardscores)$/.test(compact)) return { kind: 'score', metric: 'Standard', specific: true };
    if (/^raw(?:scaled|scaledscore|scaledscores)$/.test(compact)) return { kind: 'score', metric: 'Scaled', specific: true };
    if (/^raw(?:percentile|percentilerank|percentileranks|percent)$/.test(compact)) return { kind: 'score', metric: 'Percentile', specific: true };
    if (/^(patient|patientid|profile|profileid|case|caseid|participant|participantid)$/.test(compact)) return { kind: 'patient' };
    if (/^(domain|cognitivedomain|domainname|category|construct|abilitydomain)$/.test(compact)) return { kind: 'domain' };
    if (/^(test|testname|measure|measurename|subtest|subtestname|variable|scorename|index|indexname)$/.test(compact)) return { kind: 'measure' };
    if (/^(metric|scoremetric|scoretype|scaletype|normtype|type)$/.test(compact)) return { kind: 'metric' };
    if (/^(include|included|use|display|plot|graph)$/.test(compact)) return { kind: 'include' };
    if (/^(order|domainorder|displayorder|sortorder)$/.test(compact)) return { kind: 'order' };

    if (compact === 'ss') return { kind: 'score', metric: null, specific: false, ambiguous: true };
    const metric = normalizeMetric(value);
    if (metric) return { kind: 'score', metric, specific: true };
    if (/^(score|scorevalue|value|standardizedscore|standardisedscore|normedscore|normativescore|convertedscore)$/.test(compact)) {
      return { kind: 'score', metric: null, specific: false };
    }
    return null;
  }

  function canonicalDomain(value) {
    const text = cleanText(value).replace(/[:\s]+$/g, '');
    if (!text) return null;
    for (const [pattern, domain] of DOMAIN_ALIASES) {
      if (pattern.test(text)) return domain;
    }
    return text;
  }

  function inferDomain(measure) {
    const text = cleanText(measure);
    for (const rule of TEST_DOMAIN_RULES) {
      if (rule.pattern.test(text)) return { domain: rule.domain, exclude: Boolean(rule.exclude), rule: rule.pattern.source };
    }
    return { domain: 'Unassigned', exclude: false, rule: null };
  }

  function isMarkdownSeparatorRow(row) {
    return Array.isArray(row) && row.length > 0 && row.every((cell) => {
      const value = cleanText(cell);
      return !value || /^:?-{3,}:?$/.test(value);
    });
  }

  function parseDelimited(text, delimiter) {
    const rows = [];
    let row = [];
    let field = '';
    let quoted = false;
    for (let index = 0; index < text.length; index += 1) {
      const char = text[index];
      if (quoted) {
        if (char === '"') {
          if (text[index + 1] === '"') {
            field += '"';
            index += 1;
          } else {
            quoted = false;
          }
        } else {
          field += char;
        }
        continue;
      }
      if (char === '"') {
        quoted = true;
      } else if (char === delimiter) {
        row.push(cleanText(field));
        field = '';
      } else if (char === '\n') {
        row.push(cleanText(field));
        rows.push(row);
        row = [];
        field = '';
      } else if (char !== '\r') {
        field += char;
      }
    }
    if (quoted) throw new Error('The pasted table contains an unterminated quoted field.');
    if (field !== '' || row.length) {
      row.push(cleanText(field));
      rows.push(row);
    }
    return rows;
  }

  function parseMarkdown(lines) {
    return lines.map((line) => {
      const raw = line.trim().replace(/^\|/, '').replace(/\|$/, '');
      const cells = [];
      let field = '';
      let escaped = false;
      for (const char of raw) {
        if (escaped) {
          field += char;
          escaped = false;
        } else if (char === '\\') {
          escaped = true;
        } else if (char === '|') {
          cells.push(cleanText(field));
          field = '';
        } else {
          field += char;
        }
      }
      cells.push(cleanText(field));
      return cells;
    }).filter((row) => !isMarkdownSeparatorRow(row));
  }

  function delimiterScore(lines, delimiter) {
    const counts = lines.filter((line) => cleanText(line)).slice(0, 40).map((line) => {
      let count = 0;
      let quoted = false;
      for (let index = 0; index < line.length; index += 1) {
        const char = line[index];
        if (char === '"') quoted = !quoted;
        else if (!quoted && char === delimiter) count += 1;
      }
      return count;
    }).filter((count) => count > 0);
    if (counts.length < 2) return -Infinity;
    const frequencies = new Map();
    counts.forEach((count) => frequencies.set(count, (frequencies.get(count) || 0) + 1));
    const modeCount = [...frequencies.entries()].sort((a, b) => b[1] - a[1])[0];
    return modeCount[1] * 5 + modeCount[0] * 2 - (counts.length - modeCount[1]) * 2;
  }

  function splitFixedWidth(lines) {
    return lines.map((line) => {
      if (!line.trim()) return [];
      const rightTrimmed = line.replace(/\s+$/g, '');
      const cells = rightTrimmed.split(/\t+| {2,}/).map(cleanText);
      while (cells.length && !cells[cells.length - 1]) cells.pop();
      return cells;
    });
  }

  function tokenize(text) {
    const normalized = String(text == null ? '' : text)
      .replace(/^\ufeff/, '')
      .replace(/\r\n?/g, '\n');
    if (!normalized.trim()) throw new Error('Paste a score table before parsing.');
    if (normalized.length > MAX_TEXT_LENGTH) throw new Error(`The pasted text exceeds ${MAX_TEXT_LENGTH.toLocaleString()} characters.`);
    const lines = normalized.split('\n');
    if (lines.length > MAX_ROWS) throw new Error(`The pasted text exceeds ${MAX_ROWS.toLocaleString()} lines.`);

    const nonblank = lines.filter((line) => cleanText(line));
    const markdownLike = nonblank.length >= 2 && nonblank.filter((line) => line.includes('|')).length >= Math.ceil(nonblank.length * 0.6)
      && nonblank.some((line) => /\|?\s*:?-{3,}:?\s*\|/.test(line));
    if (markdownLike) return { rows: parseMarkdown(lines), layout: 'Markdown table', delimiter: '|' };

    if (nonblank.some((line) => line.includes('\t'))) {
      return { rows: lines.map((line) => line.split('\t').map(cleanText)), layout: 'Tab-delimited table', delimiter: '\t' };
    }

    const candidates = [',', ';', '|'].map((delimiter) => ({ delimiter, score: delimiterScore(lines, delimiter) }))
      .sort((a, b) => b.score - a.score);
    if (candidates[0].score >= 10) {
      const label = candidates[0].delimiter === ',' ? 'Comma-delimited table'
        : candidates[0].delimiter === ';' ? 'Semicolon-delimited table'
          : 'Pipe-delimited table';
      return { rows: parseDelimited(normalized, candidates[0].delimiter), layout: label, delimiter: candidates[0].delimiter };
    }

    return { rows: splitFixedWidth(lines), layout: 'Spaced text table', delimiter: 'spacing' };
  }

  function headerAnalysis(row) {
    const descriptors = (row || []).map(classifyHeader);
    const measureIndex = descriptors.findIndex((item) => item && item.kind === 'measure');
    const domainIndex = descriptors.findIndex((item) => item && item.kind === 'domain');
    const metricIndex = descriptors.findIndex((item) => item && item.kind === 'metric');
    const scoreColumns = descriptors.map((item, index) => item && item.kind === 'score' ? { ...item, index } : null).filter(Boolean);
    const recognized = descriptors.filter(Boolean).length;
    const qualifies = measureIndex >= 0 && scoreColumns.length > 0;
    const score = (measureIndex >= 0 ? 8 : 0) + scoreColumns.length * 6 + (domainIndex >= 0 ? 3 : 0)
      + (metricIndex >= 0 ? 2 : 0) + recognized;
    return { descriptors, measureIndex, domainIndex, metricIndex, scoreColumns, recognized, qualifies, score };
  }

  function isBlankRow(row) {
    return !Array.isArray(row) || row.every((cell) => !cleanText(cell));
  }

  function looksNumeric(value) {
    const text = cleanText(value).replace(/[,*†‡]+$/g, '').trim();
    return /^[<>≤≥]?\s*[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:\s*%|\s*(?:st|nd|rd|th))?$/i.test(text);
  }

  function cleanScore(value, metric) {
    let text = cleanText(value);
    if (!text || /^(?:n\/?a|na|--+|—|not available|not administered)$/i.test(text)) return null;
    text = text.replace(/[†‡*]+$/g, '').trim();
    const parenthetical = text.match(/^([<>≤≥]?\s*[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:\s*%|\s*(?:st|nd|rd|th))?)\s*\([^)]*\)\s*$/i);
    if (parenthetical) text = parenthetical[1].trim();
    if (metric === 'Percentile') {
      const match = text.match(/^([<>≤≥]?\s*[+-]?(?:\d+(?:\.\d*)?|\.\d+))(?:\s*%|\s*(?:st|nd|rd|th))?$/i);
      return match ? match[1].replace(/≤/g, '<').replace(/≥/g, '>').trim() : null;
    }
    const match = text.match(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+))(?:\s*[a-z].*)?$/i);
    return match ? match[1] : null;
  }

  function parseInclude(value) {
    const token = compactToken(value);
    if (!token) return true;
    return !['no', 'n', 'false', '0', 'exclude', 'excluded', 'omit', 'omitted'].includes(token);
  }

  function inferGenericMetric(values) {
    const cleaned = values.map(cleanText).filter(Boolean);
    if (!cleaned.length) return null;
    if (cleaned.some((value) => /^[<>≤≥]/.test(value) || /(?:st|nd|rd|th|%)$/i.test(value))) return 'Percentile';
    const numeric = cleaned.map((value) => Number(cleanScore(value, 'T'))).filter(Number.isFinite);
    if (!numeric.length || numeric.length < Math.ceil(cleaned.length * 0.7)) return null;
    const sorted = numeric.slice().sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const minimum = sorted[0];
    const maximum = sorted[sorted.length - 1];
    if (minimum < 0 && minimum >= -5 && maximum <= 5) return 'Z';
    if (maximum > 100 || (minimum >= 40 && maximum <= 160 && median >= 75)) return 'Standard';
    if (minimum >= 1 && maximum <= 19 && median >= 6 && median <= 14 && numeric.every(Number.isInteger)) return 'Scaled';
    return null;
  }

  function metricChoice(scoreColumns, row, mapping, options, genericMetric) {
    const populated = scoreColumns.filter((column) => cleanText(row[column.index]));
    if (!populated.length) return null;
    const preferred = METRICS.includes(options.preferredMetric) ? options.preferredMetric : null;
    if (preferred) {
      const exact = populated.find((column) => column.metric === preferred);
      if (exact) return exact;
    }
    const specific = populated.filter((column) => column.metric);
    for (const metric of METRIC_PRIORITY) {
      const match = specific.find((column) => column.metric === metric);
      if (match) return match;
    }
    const generic = populated.find((column) => !column.metric);
    if (!generic) return populated[0];
    const metricCell = mapping.metricIndex >= 0 ? normalizeMetric(row[mapping.metricIndex]) : null;
    const fixed = METRICS.includes(options.defaultMetric) ? options.defaultMetric : null;
    return { ...generic, metric: metricCell || fixed || genericMetric || null };
  }

  function trailingMeasureAndScore(value, metric) {
    const text = cleanText(value);
    const match = text.match(/^(.*?)\s+([<>≤≥]?\s*[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:\s*%|\s*(?:st|nd|rd|th))?)\s*$/i);
    if (!match || !cleanScore(match[2], metric || 'T')) return null;
    return { measure: cleanText(match[1]), score: cleanText(match[2]) };
  }

  function domainOrder(domain, fallback) {
    const index = DOMAIN_ORDER.indexOf(domain);
    return index >= 0 ? index + 1 : fallback;
  }

  function sectionDomain(row, mapping) {
    const nonempty = (row || []).map(cleanText).filter(Boolean);
    if (!nonempty.length) return null;
    if (mapping && mapping.domainIndex >= 0) {
      const domainValue = cleanText(row[mapping.domainIndex]);
      const otherData = row.some((cell, index) => index !== mapping.domainIndex && cleanText(cell));
      if (domainValue && !otherData) {
        const candidate = canonicalDomain(domainValue);
        if (candidate && DOMAIN_ORDER.includes(candidate)) return candidate;
      }
    }
    if (nonempty.length === 1 && !looksNumeric(nonempty[0])) {
      const candidate = canonicalDomain(nonempty[0]);
      if (candidate && DOMAIN_ORDER.includes(candidate)) return candidate;
      // Combined headings such as "Processing Speed/Attention" should not be
      // forced into a single domain. Let test-name inference determine each row.
    }
    return null;
  }

  function alignShortRow(row, mapping, currentDomain) {
    const headerLength = mapping.descriptors.length;
    if (row.length >= headerLength) return row.slice();
    if (mapping.domainIndex === 0 && mapping.measureIndex === 1 && mapping.scoreColumns.some((column) => column.index === 2)
      && currentDomain && row.length === 2 && looksNumeric(row[1])) {
      return ['', row[0], row[1]];
    }
    const result = row.slice();
    while (result.length < headerLength) result.push('');
    return result;
  }

  function buildRecord(values, context) {
    const measure = cleanText(values.measure);
    if (!measure) return null;
    const metric = normalizeMetric(values.metric) || values.metric;
    if (!METRICS.includes(metric)) return { error: `A score metric could not be determined for ${measure}.` };
    const score = cleanScore(values.score, metric);
    if (score == null) return { error: `The score for ${measure} was not recognized.` };

    let domainSource = 'explicit';
    let domain = canonicalDomain(values.domain);
    let inferred = null;
    if (!domain) {
      inferred = inferDomain(measure);
      domain = context.inferDomains === false ? 'Unassigned' : inferred.domain;
      domainSource = domain === 'Unassigned' ? 'unassigned' : 'inferred';
    }
    if (domain === 'Memory') {
      const refined = inferDomain(measure);
      if (/^Memory:/.test(refined.domain)) {
        domain = refined.domain;
        domainSource = 'inferred';
        inferred = refined;
      }
    }
    const include = parseInclude(values.include) && !(inferred && inferred.exclude) && domain !== 'Mood / Behavior';
    const orderText = cleanText(values.order);
    const orderValue = orderText ? Number(orderText) : NaN;
    const order = Number.isFinite(orderValue) ? orderValue : domainOrder(domain, context.firstSeenOrder);
    const patientId = cleanText(values.patientId) || 'Profile 1';

    return {
      domain,
      measure,
      score,
      metric,
      include,
      order,
      patientId,
      domainSource,
      sourceRow: context.sourceRow,
      scoreSource: values.scoreSource || metric,
      warnings: [],
    };
  }

  function parseRowOriented(matrix, options) {
    const records = [];
    const warnings = [];
    const ignored = [];
    let mapping = null;
    let currentDomain = null;
    let blockGenericMetric = null;
    let headerCount = 0;

    for (let rowIndex = 0; rowIndex < matrix.length; rowIndex += 1) {
      const rawRow = matrix[rowIndex] || [];
      if (isBlankRow(rawRow) || isMarkdownSeparatorRow(rawRow)) continue;
      const header = headerAnalysis(rawRow);
      if (header.qualifies) {
        mapping = header;
        headerCount += 1;
        currentDomain = null;
        const nextRows = [];
        for (let lookahead = rowIndex + 1; lookahead < Math.min(matrix.length, rowIndex + 40); lookahead += 1) {
          const next = matrix[lookahead] || [];
          if (headerAnalysis(next).qualifies) break;
          const generic = header.scoreColumns.find((column) => !column.metric);
          if (generic && cleanText(next[generic.index])) nextRows.push(next[generic.index]);
        }
        blockGenericMetric = inferGenericMetric(nextRows);
        continue;
      }

      if (!mapping) {
        const domain = sectionDomain(rawRow, null);
        if (domain) currentDomain = domain;
        continue;
      }

      const domainHeading = sectionDomain(rawRow, mapping);
      if (domainHeading) {
        currentDomain = domainHeading;
        continue;
      }

      const row = alignShortRow(rawRow, mapping, currentDomain);
      let measure = cleanText(row[mapping.measureIndex]);
      let choice = metricChoice(mapping.scoreColumns, row, mapping, options, blockGenericMetric);
      if (!choice && row.length === 1) {
        const genericMetric = METRICS.includes(options.defaultMetric) ? options.defaultMetric : blockGenericMetric;
        const extracted = trailingMeasureAndScore(row[0], genericMetric);
        if (extracted) {
          measure = extracted.measure;
          choice = { index: -1, metric: genericMetric, extractedScore: extracted.score };
        }
      }
      if (!measure || !choice) {
        if (rawRow.some((cell) => cleanText(cell))) ignored.push({ row: rowIndex + 1, text: rawRow.map(cleanText).filter(Boolean).join(' | ') });
        continue;
      }

      const includeIndex = mapping.descriptors.findIndex((item) => item && item.kind === 'include');
      const orderIndex = mapping.descriptors.findIndex((item) => item && item.kind === 'order');
      const patientIndex = mapping.descriptors.findIndex((item) => item && item.kind === 'patient');
      const values = {
        domain: mapping.domainIndex >= 0 ? cleanText(row[mapping.domainIndex]) || currentDomain : currentDomain,
        measure,
        score: choice.index >= 0 ? row[choice.index] : choice.extractedScore,
        metric: choice.metric,
        include: includeIndex >= 0 ? row[includeIndex] : '',
        order: orderIndex >= 0 ? row[orderIndex] : '',
        patientId: patientIndex >= 0 ? row[patientIndex] : '',
        scoreSource: choice.metric || 'Score',
      };
      const record = buildRecord(values, {
        inferDomains: options.inferDomains,
        sourceRow: rowIndex + 1,
        firstSeenOrder: records.length + 1,
      });
      if (!record) continue;
      if (record.error) warnings.push(`Row ${rowIndex + 1}: ${record.error}`);
      else records.push(record);
      if (records.length > MAX_RECORDS) throw new Error(`The parser found more than ${MAX_RECORDS.toLocaleString()} score rows.`);
    }

    return { records, warnings, ignored, headerCount, orientation: 'rows' };
  }

  function transposedAnalysis(matrix) {
    let best = null;
    const limit = Math.min(matrix.length, 30);
    for (let rowIndex = 0; rowIndex < limit; rowIndex += 1) {
      const row = matrix[rowIndex] || [];
      const descriptor = classifyHeader(row[0]);
      const measureLike = descriptor && descriptor.kind === 'measure';
      if (!measureLike || row.slice(1).filter((cell) => cleanText(cell)).length < 2) continue;
      const descriptors = matrix.map((candidate) => classifyHeader(candidate && candidate[0]));
      const scoreRows = descriptors.map((item, index) => item && item.kind === 'score' ? { ...item, index } : null).filter(Boolean);
      if (!scoreRows.length) continue;
      const domainRow = descriptors.findIndex((item) => item && item.kind === 'domain');
      const score = row.slice(1).filter((cell) => cleanText(cell)).length * 3 + scoreRows.length * 6 + (domainRow >= 0 ? 3 : 0);
      if (!best || score > best.score) best = { measureRow: rowIndex, descriptors, scoreRows, domainRow, score };
    }
    return best;
  }

  function parseTransposed(matrix, options) {
    const analysis = transposedAnalysis(matrix);
    if (!analysis) return { records: [], warnings: [], ignored: [], headerCount: 0, orientation: 'columns' };
    const records = [];
    const warnings = [];
    const measureRow = matrix[analysis.measureRow] || [];
    const metricRowIndex = analysis.descriptors.findIndex((item) => item && item.kind === 'metric');
    const includeRowIndex = analysis.descriptors.findIndex((item) => item && item.kind === 'include');
    const orderRowIndex = analysis.descriptors.findIndex((item) => item && item.kind === 'order');
    const patientRowIndex = analysis.descriptors.findIndex((item) => item && item.kind === 'patient');
    const preferred = METRICS.includes(options.preferredMetric) ? options.preferredMetric : null;
    let selectedScoreRow = null;
    if (preferred) selectedScoreRow = analysis.scoreRows.find((item) => item.metric === preferred) || null;
    if (!selectedScoreRow) {
      for (const metric of METRIC_PRIORITY) {
        selectedScoreRow = analysis.scoreRows.find((item) => item.metric === metric);
        if (selectedScoreRow) break;
      }
    }
    if (!selectedScoreRow) selectedScoreRow = analysis.scoreRows[0];

    const genericValues = selectedScoreRow && !selectedScoreRow.metric
      ? (matrix[selectedScoreRow.index] || []).slice(1) : [];
    const genericMetric = inferGenericMetric(genericValues);
    const maximumColumns = Math.max(...matrix.map((row) => row.length), 0);
    for (let column = 1; column < maximumColumns; column += 1) {
      const measure = cleanText(measureRow[column]);
      if (!measure) continue;
      let metric = selectedScoreRow.metric;
      if (!metric && metricRowIndex >= 0) metric = normalizeMetric(matrix[metricRowIndex] && matrix[metricRowIndex][column]);
      if (!metric && METRICS.includes(options.defaultMetric)) metric = options.defaultMetric;
      if (!metric) metric = genericMetric;
      const values = {
        domain: analysis.domainRow >= 0 ? matrix[analysis.domainRow] && matrix[analysis.domainRow][column] : '',
        measure,
        score: matrix[selectedScoreRow.index] && matrix[selectedScoreRow.index][column],
        metric,
        include: includeRowIndex >= 0 ? matrix[includeRowIndex] && matrix[includeRowIndex][column] : '',
        order: orderRowIndex >= 0 ? matrix[orderRowIndex] && matrix[orderRowIndex][column] : '',
        patientId: patientRowIndex >= 0 ? matrix[patientRowIndex] && matrix[patientRowIndex][column] : '',
        scoreSource: selectedScoreRow.metric || 'Score',
      };
      const record = buildRecord(values, {
        inferDomains: options.inferDomains,
        sourceRow: column + 1,
        firstSeenOrder: records.length + 1,
      });
      if (!record) continue;
      if (record.error) warnings.push(`Column ${column + 1}: ${record.error}`);
      else records.push(record);
    }
    return { records, warnings, ignored: [], headerCount: 1, orientation: 'columns' };
  }

  function deduplicate(records) {
    const seen = new Set();
    const output = [];
    const duplicates = [];
    records.forEach((record) => {
      const key = [record.patientId, record.domain, record.measure, record.metric].map(compactToken).join('|');
      if (seen.has(key)) {
        duplicates.push(record);
        return;
      }
      seen.add(key);
      output.push(record);
    });
    return { records: output, duplicates };
  }

  function resultScore(result) {
    const included = result.records.filter((record) => record.include).length;
    const explicitDomains = result.records.filter((record) => record.domainSource === 'explicit').length;
    const unassigned = result.records.filter((record) => record.domain === 'Unassigned').length;
    return included * 10 + explicitDomains * 2 - unassigned * 2 + result.headerCount * 3;
  }

  function recordsToRows(records) {
    const rows = [['DOMAIN', 'TEST', 'SCORE', 'METRIC', 'INCLUDE', 'ORDER', 'PATIENT ID']];
    records.forEach((record) => {
      rows.push([
        record.domain,
        record.measure,
        record.score,
        record.metric,
        record.include ? 'Yes' : 'No',
        record.order,
        record.patientId,
      ]);
    });
    return rows;
  }

  function summarize(records) {
    const included = records.filter((record) => record.include);
    const domains = [...new Set(included.map((record) => record.domain))];
    return {
      records: records.length,
      included: included.length,
      excluded: records.length - included.length,
      domains: domains.length,
      inferredDomains: included.filter((record) => record.domainSource === 'inferred').length,
      unassignedDomains: included.filter((record) => record.domain === 'Unassigned').length,
    };
  }

  function parse(text, rawOptions) {
    const options = {
      orientation: 'auto',
      defaultMetric: null,
      preferredMetric: null,
      inferDomains: true,
      ...(rawOptions || {}),
    };
    const tokenized = tokenize(text);
    const rowResult = options.orientation === 'columns' ? null : parseRowOriented(tokenized.rows, options);
    const columnResult = options.orientation === 'rows' ? null : parseTransposed(tokenized.rows, options);
    let selected;
    if (rowResult && columnResult) selected = resultScore(columnResult) > resultScore(rowResult) ? columnResult : rowResult;
    else selected = rowResult || columnResult;
    if (!selected || !selected.records.length) {
      const metricHint = options.defaultMetric ? '' : ' If the table uses a generic Score column, select its score metric in Parser options.';
      throw new Error(`No usable score rows were detected. Confirm that the table includes a test-name heading and a supported standardized-score heading.${metricHint}`);
    }

    const deduped = deduplicate(selected.records);
    const warnings = [...selected.warnings];
    if (deduped.duplicates.length) warnings.push(`${deduped.duplicates.length} duplicate score row(s) were ignored.`);
    const summary = summarize(deduped.records);
    if (summary.unassignedDomains) warnings.push(`${summary.unassignedDomains} score(s) could not be assigned to a cognitive domain and were placed in Unassigned.`);
    if (summary.excluded) warnings.push(`${summary.excluded} mood, behavior, or explicitly excluded score row(s) will not be plotted.`);
    if (selected.ignored.length) warnings.push(`${selected.ignored.length} non-score row(s) were ignored.`);

    return {
      version: VERSION,
      rows: recordsToRows(deduped.records),
      records: deduped.records,
      summary,
      warnings: [...new Set(warnings)],
      diagnostics: {
        layout: tokenized.layout,
        orientation: selected.orientation,
        headerBlocks: selected.headerCount,
        ignoredRows: selected.ignored.length,
        delimiter: tokenized.delimiter,
      },
    };
  }

  const api = Object.freeze({
    VERSION,
    MAX_TEXT_LENGTH,
    MAX_RECORDS,
    METRICS,
    DOMAIN_ORDER,
    tokenize,
    classifyHeader,
    normalizeMetric,
    canonicalDomain,
    inferDomain,
    parse,
  });

  global.NeuroProfileTextParser = api;
})(typeof window !== 'undefined' ? window : globalThis);
