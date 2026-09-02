(() => {
  'use strict';

  const VERSION = '0.16';
  const NS = 'http://www.w3.org/2000/svg';
  const state = {
    axisMetric: 'percentile',
    percentileSpacing: 'linear',
    plotScale: 100,
    autoDomainWidth: true,
    domainWidth: 255,
    autoScoreWidth: true,
    scoreWidth: 150,
    autoChangeWidth: true,
    changeWidth: 150,
    domainAlign: 'left',
    scoreAlign: 'right',
    changeAlign: 'center',
    columnGap: 22,
  };

  const originalMap = new WeakMap();
  const rootOriginalMap = new WeakMap();
  let applying = false;
  let scheduled = false;

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const number = (value, fallback = 0) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  const nearly = (a, b, tolerance = 0.8) => Math.abs(a - b) <= tolerance;

  function parseViewBox(svg) {
    const raw = svg.getAttribute('viewBox');
    if (raw) {
      const values = raw.trim().split(/[\s,]+/).map(Number);
      if (values.length === 4 && values.every(Number.isFinite)) {
        return { x: values[0], y: values[1], width: values[2], height: values[3] };
      }
    }
    return {
      x: 0,
      y: 0,
      width: number(svg.getAttribute('width'), 1200),
      height: number(svg.getAttribute('height'), 700),
    };
  }

  function rememberRoot(svg) {
    if (!rootOriginalMap.has(svg)) {
      rootOriginalMap.set(svg, {
        viewBox: svg.getAttribute('viewBox'),
        width: svg.getAttribute('width'),
        height: svg.getAttribute('height'),
        ariaLabel: svg.getAttribute('aria-label'),
      });
    }
  }

  function rememberElement(element) {
    if (originalMap.has(element)) return;
    const attrs = {};
    for (const attribute of element.attributes) attrs[attribute.name] = attribute.value;
    originalMap.set(element, {
      attrs,
      text: element.tagName.toLowerCase() === 'text' || element.tagName.toLowerCase() === 'tspan'
        ? element.textContent
        : null,
    });
  }

  function restore(svg) {
    rememberRoot(svg);
    const root = rootOriginalMap.get(svg);
    if (root.viewBox === null) svg.removeAttribute('viewBox'); else svg.setAttribute('viewBox', root.viewBox);
    if (root.width === null) svg.removeAttribute('width'); else svg.setAttribute('width', root.width);
    if (root.height === null) svg.removeAttribute('height'); else svg.setAttribute('height', root.height);
    if (root.ariaLabel === null) svg.removeAttribute('aria-label'); else svg.setAttribute('aria-label', root.ariaLabel);

    svg.querySelectorAll('[data-np010-generated="true"]').forEach((node) => node.remove());
    svg.querySelectorAll('*').forEach((element) => {
      rememberElement(element);
      const original = originalMap.get(element);
      [...element.attributes].forEach((attribute) => element.removeAttribute(attribute.name));
      Object.entries(original.attrs).forEach(([name, value]) => element.setAttribute(name, value));
      if (original.text !== null && element.children.length === 0) element.textContent = original.text;
    });
  }

  function largestFigureSvg() {
    const candidates = [...document.querySelectorAll('svg')]
      .map((svg) => ({ svg, box: parseViewBox(svg) }))
      .filter(({ box }) => box.width >= 700 && box.height >= 300);
    candidates.sort((a, b) => b.box.width * b.box.height - a.box.width * a.box.height);
    return candidates[0]?.svg || null;
  }

  function numericAttr(element, name) {
    const value = Number(element.getAttribute(name));
    return Number.isFinite(value) ? value : null;
  }

  function findNormativePlot(svg) {
    const vb = parseViewBox(svg);
    const rects = [...svg.querySelectorAll('rect')].map((element) => ({
      element,
      x: numericAttr(element, 'x') ?? 0,
      y: numericAttr(element, 'y') ?? 0,
      width: numericAttr(element, 'width') ?? 0,
      height: numericAttr(element, 'height') ?? 0,
      fill: (element.getAttribute('fill') || '').toLowerCase(),
    })).filter((rect) =>
      rect.x > vb.width * 0.08 &&
      rect.y > 45 &&
      rect.width > 18 &&
      rect.width < vb.width * 0.72 &&
      rect.height > vb.height * 0.24 &&
      rect.height < vb.height * 0.82 &&
      rect.fill !== 'none' &&
      rect.fill !== 'transparent' &&
      rect.fill !== '#fff' &&
      rect.fill !== '#ffffff' &&
      rect.fill !== 'white'
    );

    const groups = new Map();
    for (const rect of rects) {
      const key = `${Math.round(rect.y)}:${Math.round(rect.height)}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(rect);
    }

    let best = null;
    for (const group of groups.values()) {
      if (group.length < 4) continue;
      group.sort((a, b) => a.x - b.x);
      const start = Math.min(...group.map((rect) => rect.x));
      const end = Math.max(...group.map((rect) => rect.x + rect.width));
      const score = (end - start) * group.length;
      if (!best || score > best.score) {
        best = {
          score,
          rects: group,
          start,
          end,
          top: Math.min(...group.map((rect) => rect.y)),
          bottom: Math.max(...group.map((rect) => rect.y + rect.height)),
        };
      }
    }
    return best;
  }

  function erf(x) {
    const sign = x < 0 ? -1 : 1;
    const absolute = Math.abs(x);
    const a1 = 0.254829592;
    const a2 = -0.284496736;
    const a3 = 1.421413741;
    const a4 = -1.453152027;
    const a5 = 1.061405429;
    const p = 0.3275911;
    const t = 1 / (1 + p * absolute);
    const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-absolute * absolute);
    return sign * y;
  }

  function normalCdf(z) {
    return 0.5 * (1 + erf(z / Math.SQRT2));
  }

  function makeXMapper(oldStart, oldEnd, newStart, newEnd) {
    const oldWidth = oldEnd - oldStart;
    const newWidth = newEnd - newStart;
    const percentileLinear = state.axisMetric === 'percentile' && state.percentileSpacing === 'linear';
    const pMin = normalCdf(-3);
    const pMax = normalCdf(3);

    return (x) => {
      if (!Number.isFinite(x)) return x;
      if (x < oldStart - 0.5) return x;
      if (x > oldEnd + 0.5) return x + (newEnd - oldEnd);
      if (nearly(x, oldStart)) return newStart;
      if (nearly(x, oldEnd)) return newEnd;
      let proportion = clamp((x - oldStart) / oldWidth, 0, 1);
      if (percentileLinear) {
        const z = -3 + 6 * proportion;
        proportion = (normalCdf(z) - pMin) / (pMax - pMin);
      }
      return newStart + proportion * newWidth;
    };
  }

  function transformPath(path, mapper) {
    // The generated figure uses polygons for diamonds. This parser handles the
    // absolute path commands that may occur in borders or marker symbols.
    const tokens = path.match(/[A-Za-z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g);
    if (!tokens) return path;
    const output = [];
    let index = 0;
    let command = '';
    const specs = {
      M: [true, false], L: [true, false], T: [true, false],
      H: [true], V: [false],
      C: [true, false, true, false, true, false],
      S: [true, false, true, false], Q: [true, false, true, false],
      A: [false, false, false, false, false, true, false],
    };
    while (index < tokens.length) {
      if (/^[A-Za-z]$/.test(tokens[index])) {
        command = tokens[index++];
        output.push(command);
        if (command === 'Z' || command === 'z') continue;
      }
      const upper = command.toUpperCase();
      const spec = specs[upper];
      if (!spec || command !== upper) return path;
      for (const isX of spec) {
        if (index >= tokens.length || /^[A-Za-z]$/.test(tokens[index])) break;
        const value = Number(tokens[index++]);
        output.push(String(isX ? round(mapper(value)) : round(value)));
      }
    }
    return output.join(' ');
  }

  function round(value) {
    return Math.round(value * 100) / 100;
  }

  function mapElementGeometry(element, mapper, oldStart, oldEnd, newEnd) {
    const tag = element.tagName.toLowerCase();
    if (element.getAttribute('data-np010-generated') === 'true') return;
    if (element.closest?.('.np-legend-panel')) return;

    if (tag === 'rect') {
      const x = numericAttr(element, 'x');
      const width = numericAttr(element, 'width');
      if (x !== null && width !== null) {
        const right = x + width;
        if (right >= oldStart - 0.5 && x <= oldEnd + 0.5) {
          const mappedX = mapper(x);
          const mappedRight = mapper(right);
          element.setAttribute('x', round(Math.min(mappedX, mappedRight)));
          element.setAttribute('width', round(Math.abs(mappedRight - mappedX)));
        } else if (x > oldEnd) {
          element.setAttribute('x', round(mapper(x)));
        }
      }
      return;
    }

    for (const attr of ['x', 'cx', 'x1', 'x2']) {
      const value = numericAttr(element, attr);
      if (value !== null) element.setAttribute(attr, round(mapper(value)));
    }

    if (tag === 'text') {
      element.querySelectorAll('tspan[x]').forEach((tspan) => {
        const x = numericAttr(tspan, 'x');
        if (x !== null) tspan.setAttribute('x', round(mapper(x)));
      });
    }

    if (tag === 'polygon' || tag === 'polyline') {
      const points = element.getAttribute('points');
      if (points) {
        const values = points.trim().split(/[\s,]+/).map(Number);
        if (values.length % 2 === 0 && values.every(Number.isFinite)) {
          const mapped = [];
          for (let i = 0; i < values.length; i += 2) mapped.push(`${round(mapper(values[i]))},${round(values[i + 1])}`);
          element.setAttribute('points', mapped.join(' '));
        }
      }
    }

    if (tag === 'path') {
      const d = element.getAttribute('d');
      if (d) element.setAttribute('d', transformPath(d, mapper));
    }
  }

  function textElementsInArea(svg, predicate) {
    return [...svg.querySelectorAll('text')].filter((element) => {
      try {
        const box = element.getBBox();
        return predicate(element, box);
      } catch {
        return false;
      }
    });
  }

  function setTextPosition(element, x, anchor) {
    element.setAttribute('x', round(x));
    element.setAttribute('text-anchor', anchor);
    element.querySelectorAll('tspan').forEach((tspan) => tspan.setAttribute('x', round(x)));
  }

  function measuredWidth(element) {
    try {
      const box = element.getBBox();
      return Number.isFinite(box.width) ? box.width : 0;
    } catch {
      return 0;
    }
  }

  function findLegendGroup(svg, plotTop) {
    const labels = [...svg.querySelectorAll('text')].filter((text) =>
      ['Score range', 'Domain average', 'Test score'].includes(text.textContent.trim())
    );
    if (!labels.length) return null;
    let node = labels[0].parentElement;
    while (node && node !== svg) {
      if (node.tagName.toLowerCase() === 'g') {
        try {
          const box = node.getBBox();
          const contains = labels.every((label) => node.contains(label));
          if (contains && box.y < plotTop && box.width > 180 && box.height < 150) return node;
        } catch { /* continue */ }
      }
      node = node.parentElement;
    }
    return labels[0].parentElement?.tagName.toLowerCase() === 'g' ? labels[0].parentElement : null;
  }

  function removeNativeTooltips(svg) {
    svg.querySelectorAll('title').forEach((title) => {
      const parent = title.parentElement;
      const text = title.textContent.trim();
      if (parent && text && !parent.hasAttribute('aria-label')) parent.setAttribute('aria-label', text);
      title.remove();
    });
    svg.querySelectorAll('[title]').forEach((element) => {
      const text = element.getAttribute('title');
      if (text && !element.hasAttribute('aria-label')) element.setAttribute('aria-label', text);
      element.removeAttribute('title');
    });
    svg.removeAttribute('title');
    if (!svg.hasAttribute('aria-label')) svg.setAttribute('aria-label', 'Cognitive Test Results figure');
  }

  function svgElement(name, attrs = {}, text = null) {
    const element = document.createElementNS(NS, name);
    element.setAttribute('data-np010-generated', 'true');
    Object.entries(attrs).forEach(([key, value]) => element.setAttribute(key, String(value)));
    if (text !== null) element.textContent = text;
    return element;
  }

  function axisSpec() {
    const equalTicks = [0, 1 / 6, 2 / 6, 3 / 6, 4 / 6, 5 / 6, 1];
    if (state.axisMetric === 'z') {
      return { title: 'z-score', positions: equalTicks, labels: ['−3', '−2', '−1', '0', '1', '2', '3'] };
    }
    if (state.axisMetric === 'standard') {
      return { title: 'Standard score', positions: equalTicks, labels: ['55', '70', '85', '100', '115', '130', '145'] };
    }
    if (state.axisMetric === 'scaled') {
      return { title: 'Scaled score', positions: equalTicks, labels: ['1', '4', '7', '10', '13', '16', '19'] };
    }
    if (state.axisMetric === 'percentile') {
      if (state.percentileSpacing === 'linear') {
        const values = [0, 9, 25, 50, 75, 91, 100];
        return { title: 'Percentile rank', positions: values.map((value) => value / 100), labels: values.map(String) };
      }
      return {
        title: 'Percentile rank (equal-interval placement)',
        positions: equalTicks,
        labels: ['<1', '2', '16', '50', '84', '98', '>99'],
      };
    }
    return { title: 'T-score', positions: equalTicks, labels: ['20', '30', '40', '50', '60', '70', '80'] };
  }

  function drawAxis(svg, plot, start, end) {
    const existingTexts = textElementsInArea(svg, (element, box) => {
      const value = element.textContent.trim();
      const axisText = value === 'T' || value === '%ile' || value === 'T-score (equal interval)' ||
        /^(?:20|30|40|50|60|70|80|<1|2|16|84|98|>99)$/.test(value);
      return axisText && box.y >= plot.bottom - 4 && box.y <= plot.bottom + 110 &&
        box.x + box.width >= start - 90 && box.x <= end + 35;
    });
    existingTexts.forEach((text) => text.setAttribute('opacity', '0'));

    [...svg.querySelectorAll('line')].forEach((line) => {
      const x1 = numericAttr(line, 'x1');
      const x2 = numericAttr(line, 'x2');
      const y1 = numericAttr(line, 'y1');
      const y2 = numericAttr(line, 'y2');
      if ([x1, x2, y1, y2].every((value) => value !== null) &&
          y1 >= plot.bottom - 2 && y2 <= plot.bottom + 28 &&
          x1 >= start - 4 && x1 <= end + 4 && x2 >= start - 4 && x2 <= end + 4) {
        line.setAttribute('opacity', '0');
      }
    });

    const group = svgElement('g', { 'aria-label': `${axisSpec().title} axis` });
    const axisY = plot.bottom + 13;
    const fontFamily = 'Arial, Helvetica, sans-serif';
    const spec = axisSpec();
    group.appendChild(svgElement('line', {
      x1: start, y1: axisY, x2: end, y2: axisY,
      stroke: '#526674', 'stroke-width': 1.7,
    }));
    spec.positions.forEach((position, index) => {
      const x = start + position * (end - start);
      group.appendChild(svgElement('line', {
        x1: x, y1: axisY, x2: x, y2: axisY + 7,
        stroke: '#526674', 'stroke-width': 1.5,
      }));
      group.appendChild(svgElement('text', {
        x, y: axisY + 23, 'text-anchor': 'middle',
        class: 'np-font np-tick np-generated-axis-tick',
        'font-family': fontFamily, 'font-size': 12.5,
        'font-weight': 700, fill: '#334b5c',
      }, spec.labels[index]));
    });
    group.appendChild(svgElement('text', {
      x: (start + end) / 2, y: axisY + 42, 'text-anchor': 'middle',
      class: 'np-font np-axis-title np-generated-axis-title',
      'font-family': fontFamily, 'font-size': 13.5,
      'font-weight': 700, fill: '#334b5c',
    }, spec.title));
    svg.appendChild(group);
  }

  function findOuterRects(svg, originalWidth, originalHeight) {
    return [...svg.querySelectorAll('rect')].filter((rect) => {
      const x = numericAttr(rect, 'x') ?? 0;
      const y = numericAttr(rect, 'y') ?? 0;
      const width = numericAttr(rect, 'width') ?? 0;
      const height = numericAttr(rect, 'height') ?? 0;
      return x <= 4 && y <= 4 && width >= originalWidth - 8 && height >= originalHeight - 8;
    });
  }


  const REGION_HEADER_SPECS = [
    { key: 'very-low', normalized: 'VERYLOW', label: 'Very Low' },
    { key: 'low-average', normalized: 'LOWAVERAGE', label: 'Low Average' },
    { key: 'average', normalized: 'AVERAGE', label: 'Average' },
    { key: 'high-average-plus', normalized: 'HIGHAVERAGE+', label: 'High Average+' },
  ];
  let regionHeaderCanvas = null;

  function normalizedRegionHeaderText(value) {
    return String(value || '').toUpperCase().replace(/[^A-Z+]/g, '');
  }

  function regionHeaderTextWidth(text, fontSize, fontFamily, fontWeight) {
    if (!regionHeaderCanvas) regionHeaderCanvas = document.createElement('canvas');
    const context = regionHeaderCanvas.getContext('2d');
    if (!context) return String(text).length * fontSize * 0.58;
    context.font = `${fontWeight || 700} ${fontSize}px ${fontFamily || 'Arial, Helvetica, sans-serif'}`;
    return context.measureText(String(text)).width;
  }

  function layoutRegionHeaders(svg, plot) {
    const bandRects = plot.rects
      .map((rect) => ({
        element: rect.element,
        x: numericAttr(rect.element, 'x'),
        width: numericAttr(rect.element, 'width'),
      }))
      .filter((rect) => rect.x !== null && rect.width !== null && rect.width > 0)
      .sort((a, b) => a.x - b.x)
      .slice(0, REGION_HEADER_SPECS.length);
    if (bandRects.length !== REGION_HEADER_SPECS.length) return;

    const textNodes = [...svg.querySelectorAll('text')];
    const headers = REGION_HEADER_SPECS.map((spec, index) => {
      const element = textNodes.find((text) => {
        if (normalizedRegionHeaderText(text.textContent) !== spec.normalized) return false;
        try {
          const box = text.getBBox();
          return box.y + box.height <= plot.top + 8 && box.y >= 0;
        } catch {
          return false;
        }
      });
      return element ? { spec, element, band: bandRects[index] } : null;
    }).filter(Boolean);
    if (headers.length !== REGION_HEADER_SPECS.length) return;

    const computed = window.getComputedStyle(headers[0].element);
    const parsedFontSize = parseFloat(computed.fontSize);
    const safeBaseFontSize = clamp(Number.isFinite(parsedFontSize) ? parsedFontSize : 15.5, 9, 30);
    const fontFamily = computed.fontFamily || 'Arial, Helvetica, sans-serif';
    const fontWeight = computed.fontWeight || '700';

    const metrics = headers.map(({ element, band }) => {
      const lineElements = [...element.children].filter((child) => child.tagName.toLowerCase() === 'tspan');
      const lines = lineElements.length ? lineElements : [element];
      const horizontalPadding = clamp(band.width * 0.055, 4, 7);
      const availableWidth = Math.max(14, band.width - horizontalPadding * 2);
      const longestAtBase = Math.max(...lines.map((line) =>
        regionHeaderTextWidth(line.textContent.trim(), safeBaseFontSize, fontFamily, fontWeight)
      ));
      return { lines, availableWidth, longestAtBase };
    });

    const limitingRatio = Math.min(...metrics.map((metric) =>
      metric.longestAtBase > 0 ? metric.availableWidth / metric.longestAtBase : 1
    ));
    const minimumReadableSize = Math.min(safeBaseFontSize, 10.5);
    const sharedFontSize = clamp(safeBaseFontSize * Math.min(1, limitingRatio), minimumReadableSize, safeBaseFontSize);

    headers.forEach(({ spec, element, band }, index) => {
      const center = band.x + band.width / 2;
      const metric = metrics[index];
      element.setAttribute('x', round(center));
      element.setAttribute('text-anchor', 'middle');
      element.setAttribute('aria-label', spec.label);
      element.setAttribute('data-np-region-header', spec.key);
      element.setAttribute('data-np-region-band-start', round(band.x));
      element.setAttribute('data-np-region-band-width', round(band.width));
      element.setAttribute('data-np-region-font-size', round(sharedFontSize));
      element.style.fontSize = `${round(sharedFontSize)}px`;
      element.removeAttribute('textLength');
      element.removeAttribute('lengthAdjust');

      metric.lines.forEach((line) => {
        if (line !== element) line.setAttribute('x', round(center));
        line.removeAttribute('textLength');
        line.removeAttribute('lengthAdjust');
        const measured = regionHeaderTextWidth(
          line.textContent.trim(), sharedFontSize, fontFamily, fontWeight
        );
        if (measured > metric.availableWidth) {
          line.setAttribute('textLength', round(metric.availableWidth));
          line.setAttribute('lengthAdjust', 'spacingAndGlyphs');
        }
      });
    });
  }

  function applyFigureEnhancements() {
    if (applying) return;
    const svg = largestFigureSvg();
    if (!svg) return;
    applying = true;
    try {
      rememberRoot(svg);
      svg.querySelectorAll('*').forEach(rememberElement);
      restore(svg);
      window.NeuroProfileTypographyController?.applyBeforeLayout?.(svg);
      const originalViewBox = parseViewBox(svg);
      const plot = findNormativePlot(svg);
      if (!plot) {
        removeNativeTooltips(svg);
        return;
      }

      const originalStart = plot.start;
      const originalEnd = plot.end;
      const originalPlotWidth = originalEnd - originalStart;
      const domainTexts = textElementsInArea(svg, (_element, box) =>
        box.y + box.height / 2 >= plot.top &&
        box.y + box.height / 2 <= plot.bottom &&
        box.x + box.width <= originalStart - 5 &&
        box.x >= 8
      );
      const leftMargin = domainTexts.length
        ? Math.max(18, Math.min(...domainTexts.map((text) => {
            try { return text.getBBox().x; } catch { return 30; }
          })))
        : 30;
      const measuredDomainWidth = domainTexts.length
        ? Math.max(...domainTexts.map(measuredWidth)) + 12
        : state.domainWidth;
      const domainWidth = state.autoDomainWidth
        ? clamp(Math.ceil(measuredDomainWidth), 170, 390)
        : clamp(state.domainWidth, 160, 420);
      const newStart = leftMargin + domainWidth + state.columnGap;
      const newPlotWidth = originalPlotWidth * clamp(state.plotScale, 75, 140) / 100;
      const newEnd = newStart + newPlotWidth;
      const mapper = makeXMapper(originalStart, originalEnd, newStart, newEnd);

      [...svg.querySelectorAll('*')].forEach((element) => {
        if (element.tagName.toLowerCase() !== 'title') {
          mapElementGeometry(element, mapper, originalStart, originalEnd, newEnd);
        }
      });

      // Recenter and responsively fit the normative range headings after any
      // linear or nonlinear X-axis transformation.
      layoutRegionHeaders(svg, plot);

      // Align the first column after geometry has shifted.
      const domainAnchor = state.domainAlign === 'center' ? 'middle' : state.domainAlign === 'right' ? 'end' : 'start';
      const domainX = state.domainAlign === 'center'
        ? leftMargin + domainWidth / 2
        : state.domainAlign === 'right'
          ? leftMargin + domainWidth
          : leftMargin;
      domainTexts.forEach((text) => setTextPosition(text, domainX, domainAnchor));

      // Find and size the Domain Score column from its visible content.
      const allTexts = [...svg.querySelectorAll('text')];
      const scoreHeading = allTexts.find((text) => text.textContent.trim() === 'Domain Score');
      let scoreTexts = [];
      if (scoreHeading) {
        const headingX = numericAttr(scoreHeading, 'x') ?? newEnd + state.columnGap;
        scoreTexts = allTexts.filter((text) => {
          const x = numericAttr(text, 'x');
          if (x === null) return false;
          let centerY = 0;
          try { const box = text.getBBox(); centerY = box.y + box.height / 2; } catch { return false; }
          return (text === scoreHeading || (centerY >= plot.top - 5 && centerY <= plot.bottom + 5)) &&
            Math.abs(x - headingX) < 38;
        });
      }
      const scoreContentWidth = scoreTexts.length ? Math.max(...scoreTexts.map(measuredWidth)) : 100;
      const scoreWidth = state.autoScoreWidth
        ? clamp(Math.ceil(scoreContentWidth + 22), 108, 300)
        : clamp(state.scoreWidth, 90, 360);
      const scoreStart = newEnd + state.columnGap;
      const scoreAnchor = state.scoreAlign === 'center' ? 'middle' : state.scoreAlign === 'right' ? 'end' : 'start';
      const scoreX = state.scoreAlign === 'center'
        ? scoreStart + scoreWidth / 2
        : state.scoreAlign === 'right'
          ? scoreStart + scoreWidth - 10
          : scoreStart + 10;
      scoreTexts.forEach((text) => setTextPosition(text, scoreX, scoreAnchor));

      // Optional longitudinal change column.
      const changeHeading = allTexts.find((text) => /^Change\s+vs\b/i.test(text.textContent.trim()));
      let changeTexts = [];
      let contentRight = scoreStart + scoreWidth;
      if (changeHeading) {
        const headingX = numericAttr(changeHeading, 'x') ?? contentRight + state.columnGap;
        changeTexts = allTexts.filter((text) => {
          const x = numericAttr(text, 'x');
          if (x === null) return false;
          let centerY = 0;
          try { const box = text.getBBox(); centerY = box.y + box.height / 2; } catch { return false; }
          return (text === changeHeading || (centerY >= plot.top - 5 && centerY <= plot.bottom + 5)) &&
            Math.abs(x - headingX) < 50;
        });
        const changeContentWidth = changeTexts.length ? Math.max(...changeTexts.map(measuredWidth)) : 90;
        const changeWidth = state.autoChangeWidth
          ? clamp(Math.ceil(changeContentWidth + 22), 105, 260)
          : clamp(state.changeWidth, 90, 320);
        const changeStart = contentRight + state.columnGap;
        const changeAnchor = state.changeAlign === 'center' ? 'middle' : state.changeAlign === 'right' ? 'end' : 'start';
        const changeX = state.changeAlign === 'center'
          ? changeStart + changeWidth / 2
          : state.changeAlign === 'right'
            ? changeStart + changeWidth - 10
            : changeStart + 10;
        changeTexts.forEach((text) => setTextPosition(text, changeX, changeAnchor));
        contentRight = changeStart + changeWidth;
      }

      const rightMargin = 20;
      let newWidth = contentRight + rightMargin;

      // Keep the grouped legend in the upper-right corner.
      const legendGroup = findLegendGroup(svg, plot.top);
      if (legendGroup) {
        try {
          const box = legendGroup.getBBox();
          newWidth = Math.max(newWidth, leftMargin + box.width + rightMargin * 2);
          const dx = newWidth - rightMargin - (box.x + box.width);
          const originalTransform = legendGroup.getAttribute('transform') || '';
          legendGroup.setAttribute('transform', `translate(${round(dx)} 0) ${originalTransform}`.trim());
        } catch { /* leave the legend in place */ }
      }

      // Extend or shorten row separators to the actual content edge.
      [...svg.querySelectorAll('line')].forEach((line) => {
        const x1 = numericAttr(line, 'x1');
        const x2 = numericAttr(line, 'x2');
        const y1 = numericAttr(line, 'y1');
        const y2 = numericAttr(line, 'y2');
        if ([x1, x2, y1, y2].every((value) => value !== null) &&
            nearly(y1, y2, 0.2) && y1 >= plot.top - 5 && y1 <= plot.bottom + 5 &&
            x1 < newStart && x2 > newEnd) {
          line.setAttribute('x2', round(newWidth - rightMargin));
        }
      });

      const outerRects = findOuterRects(svg, originalViewBox.width + (newEnd - originalEnd), originalViewBox.height);
      const finalViewBox = { ...originalViewBox, width: round(newWidth) };
      svg.setAttribute('viewBox', `${finalViewBox.x} ${finalViewBox.y} ${finalViewBox.width} ${finalViewBox.height}`);
      if (svg.hasAttribute('width') && /^\d/.test(svg.getAttribute('width'))) svg.setAttribute('width', String(finalViewBox.width));
      outerRects.forEach((rect) => {
        const x = numericAttr(rect, 'x') ?? 0;
        rect.setAttribute('width', round(newWidth - 2 * x));
      });

      drawAxis(svg, { ...plot, start: newStart, end: newEnd }, newStart, newEnd);
      window.NeuroProfileTypographyController?.applyAfterLayout?.(svg);
      const description = svg.querySelector('desc');
      if (description) {
        const spacingText = state.axisMetric === 'percentile' && state.percentileSpacing === 'linear'
          ? 'linear percentile-rank spacing'
          : 'equal-interval spacing';
        description.textContent = `Cognitive profile showing domain averages and observed score ranges on the ${axisSpec().title} axis using ${spacingText}. A detailed calculation table follows the graph in the application.`;
      }
      removeNativeTooltips(svg);
      svg.dataset.neuroprofileVersion = VERSION;
      window.NeuroProfileColorController?.apply?.(svg);
      window.NeuroProfileTheaterController?.refresh?.();
      window.NeuroProfileTextReflowController?.apply?.(svg);
    } finally {
      applying = false;
    }
  }

  function scheduleApply() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      syncConditionalControls();
      applyFigureEnhancements();
    });
  }

  function findDisplayContainer() {
    const headings = [...document.querySelectorAll('h1,h2,h3,h4,legend,summary')];
    const heading = headings.find((node) => node.textContent.trim().toLowerCase() === 'display');
    if (heading) return heading.closest('section,fieldset,.card,.panel,details') || heading.parentElement;
    const fontControl = [...document.querySelectorAll('label')].find((label) => /font size/i.test(label.textContent));
    if (fontControl) return fontControl.closest('section,fieldset,.card,.panel') || fontControl.parentElement;
    return document.querySelector('main') || document.body;
  }

  function field(labelText, control) {
    const wrapper = document.createElement('div');
    wrapper.className = 'np010-field';
    const label = document.createElement('label');
    label.htmlFor = control.id;
    label.textContent = labelText;
    wrapper.append(label, control);
    return wrapper;
  }

  function selectControl(id, options, value) {
    const select = document.createElement('select');
    select.id = id;
    options.forEach(([optionValue, label]) => {
      const option = document.createElement('option');
      option.value = optionValue;
      option.textContent = label;
      select.appendChild(option);
    });
    select.value = value;
    return select;
  }

  function rangeField(id, labelText, min, max, step, value, suffix, onInput) {
    const wrapper = document.createElement('div');
    wrapper.className = 'np010-field';
    const label = document.createElement('label');
    label.htmlFor = id;
    label.textContent = labelText;
    const row = document.createElement('div');
    row.className = 'np010-range-row';
    const input = document.createElement('input');
    input.type = 'range';
    input.id = id;
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(value);
    const output = document.createElement('output');
    output.htmlFor = id;
    output.textContent = `${value}${suffix}`;
    input.addEventListener('input', () => {
      output.textContent = `${input.value}${suffix}`;
      onInput(number(input.value, value));
      scheduleApply();
    });
    row.append(input, output);
    wrapper.append(label, row);
    return { wrapper, input, output };
  }

  function checkbox(id, labelText, checked, onChange) {
    const label = document.createElement('label');
    label.className = 'np010-check';
    label.htmlFor = id;
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.id = id;
    input.checked = checked;
    const span = document.createElement('span');
    span.textContent = labelText;
    input.addEventListener('change', () => {
      onChange(input.checked);
      scheduleApply();
    });
    label.append(input, span);
    return { label, input };
  }

  function setWrapperVisibility(element, visible) {
    if (!element) return;
    element.hidden = !visible;
    element.setAttribute('aria-hidden', String(!visible));
  }

  function syncConditionalControls() {
    const showSubtitle = document.getElementById('showSubtitle');
    const subtitleInput = document.getElementById('subtitleInput');
    setWrapperVisibility(subtitleInput?.closest('.field-group'), Boolean(showSubtitle?.checked));

    const showProfileMean = document.getElementById('showProfileMean');
    const profileAggregation = document.getElementById('profileAggregation');
    setWrapperVisibility(profileAggregation?.closest('.field-group'), Boolean(showProfileMean?.checked));

    const showLegend = document.getElementById('showLegend');
    setWrapperVisibility(document.getElementById('legendOptions'), Boolean(showLegend?.checked));

    const showNotes = document.getElementById('showNotes');
    const notesInput = document.getElementById('notesInput');
    setWrapperVisibility(notesInput?.closest('.field-group'), Boolean(showNotes?.checked));

    const showChangeIndicators = document.getElementById('showChangeIndicators');
    const comparisonGrid = document.querySelector('#longitudinalDisplayControls .compact-field-grid');
    setWrapperVisibility(comparisonGrid, Boolean(showChangeIndicators?.checked));

    const metric = document.getElementById('np010-axis-metric');
    const percentileField = document.getElementById('np010-percentile-spacing')?.closest('.np010-field');
    const percentileVisible = metric?.value === 'percentile';
    setWrapperVisibility(percentileField, percentileVisible);
    const percentileControl = document.getElementById('np010-percentile-spacing');
    if (percentileControl) percentileControl.disabled = !percentileVisible;

    const autoWidthPairs = [
      ['np010-auto-domain', 'np010-domain-width'],
      ['np010-auto-score', 'np010-score-width'],
      ['np010-auto-change', 'np010-change-width'],
    ];
    autoWidthPairs.forEach(([autoId, widthId]) => {
      const auto = document.getElementById(autoId);
      const width = document.getElementById(widthId);
      if (!auto || !width) return;
      const visible = !auto.checked;
      setWrapperVisibility(width.closest('.np010-field'), visible);
      width.disabled = !visible;
    });

    const multipleMode = document.getElementById('multipleAssessmentsMode');
    const showLongitudinalColumns = Boolean(multipleMode?.checked);
    ['np010-auto-change', 'np010-change-align'].forEach((id) => {
      const control = document.getElementById(id);
      const wrapper = control?.closest('.np010-check, .np010-field');
      setWrapperVisibility(wrapper, showLongitudinalColumns);
    });
    const changeWidth = document.getElementById('np010-change-width');
    if (changeWidth && !showLongitudinalColumns) {
      setWrapperVisibility(changeWidth.closest('.np010-field'), false);
      changeWidth.disabled = true;
    }
  }

  function installConditionalDisclosure() {
    const ids = [
      'showSubtitle', 'showProfileMean', 'showLegend', 'showNotes',
      'showChangeIndicators', 'singleAssessmentMode', 'multipleAssessmentsMode',
    ];
    ids.forEach((id) => document.getElementById(id)?.addEventListener('change', () => {
      syncConditionalControls();
      scheduleApply();
    }));
    syncConditionalControls();
  }

  function buildSettings() {
    if (document.getElementById('np010-settings')) return;
    const details = document.createElement('details');
    details.id = 'np010-settings';
    details.className = 'np010-settings';
    const summary = document.createElement('summary');
    summary.textContent = 'Axis and figure columns';
    const body = document.createElement('div');
    body.className = 'np010-settings-body';

    const axisGrid = document.createElement('div');
    axisGrid.className = 'np010-grid';
    const metric = selectControl('np010-axis-metric', [
      ['t', 'T-score'],
      ['z', 'z-score'],
      ['standard', 'Standard score'],
      ['scaled', 'Scaled score'],
      ['percentile', 'Percentile rank'],
    ], state.axisMetric);
    const spacing = selectControl('np010-percentile-spacing', [
      ['equal', 'Equal-interval placement'],
      ['linear', 'Linear percentile-rank spacing'],
    ], state.percentileSpacing);
    const metricField = field('X-axis metric', metric);
    const spacingField = field('Percentile spacing', spacing);
    metric.addEventListener('change', () => {
      state.axisMetric = metric.value;
      syncConditionalControls();
      scheduleApply();
    });
    spacing.addEventListener('change', () => {
      state.percentileSpacing = spacing.value;
      scheduleApply();
    });
    axisGrid.append(metricField, spacingField);
    const plotScale = rangeField('np010-plot-scale', 'Plot width', 75, 140, 5, state.plotScale, '%', (value) => {
      state.plotScale = value;
    });
    axisGrid.append(plotScale.wrapper);
    body.append(axisGrid);
    const axisHelp = document.createElement('p');
    axisHelp.className = 'np010-help';
    axisHelp.textContent = 'T-scores, z-scores, standard scores, and scaled scores use equal-interval spacing. Percentile ranks can use equal-interval placement or a linear 0–100 percentile scale.';
    body.append(axisHelp);

    const columns = document.createElement('div');
    columns.className = 'np010-subgroup';
    const title = document.createElement('p');
    title.className = 'np010-subgroup-title';
    title.textContent = 'Column layout';
    const grid = document.createElement('div');
    grid.className = 'np010-grid';

    const autoDomain = checkbox('np010-auto-domain', 'Auto-fit domain labels', state.autoDomainWidth, (checked) => {
      state.autoDomainWidth = checked;
      syncConditionalControls();
    });
    const domainWidth = rangeField('np010-domain-width', 'Domain label width', 160, 420, 10, state.domainWidth, '', (value) => {
      state.domainWidth = value;
    });
    domainWidth.input.disabled = state.autoDomainWidth;
    domainWidth.wrapper.hidden = state.autoDomainWidth;
    const domainAlign = selectControl('np010-domain-align', [['left', 'Left'], ['center', 'Center'], ['right', 'Right']], state.domainAlign);
    domainAlign.addEventListener('change', () => { state.domainAlign = domainAlign.value; scheduleApply(); });
    const domainAlignField = field('Domain label alignment', domainAlign);

    const autoScore = checkbox('np010-auto-score', 'Auto-fit Domain Score', state.autoScoreWidth, (checked) => {
      state.autoScoreWidth = checked;
      syncConditionalControls();
    });
    const scoreWidth = rangeField('np010-score-width', 'Domain Score width', 90, 360, 10, state.scoreWidth, '', (value) => {
      state.scoreWidth = value;
    });
    scoreWidth.input.disabled = state.autoScoreWidth;
    scoreWidth.wrapper.hidden = state.autoScoreWidth;
    const scoreAlign = selectControl('np010-score-align', [['left', 'Left'], ['center', 'Center'], ['right', 'Right']], state.scoreAlign);
    scoreAlign.addEventListener('change', () => { state.scoreAlign = scoreAlign.value; scheduleApply(); });
    const scoreAlignField = field('Domain Score alignment', scoreAlign);

    const autoChange = checkbox('np010-auto-change', 'Auto-fit change column', state.autoChangeWidth, (checked) => {
      state.autoChangeWidth = checked;
      syncConditionalControls();
    });
    const changeWidth = rangeField('np010-change-width', 'Change column width', 90, 320, 10, state.changeWidth, '', (value) => {
      state.changeWidth = value;
    });
    changeWidth.input.disabled = state.autoChangeWidth;
    changeWidth.wrapper.hidden = state.autoChangeWidth;
    const changeAlign = selectControl('np010-change-align', [['left', 'Left'], ['center', 'Center'], ['right', 'Right']], state.changeAlign);
    changeAlign.addEventListener('change', () => { state.changeAlign = changeAlign.value; scheduleApply(); });
    const changeAlignField = field('Change alignment', changeAlign);

    const gap = rangeField('np010-column-gap', 'Column spacing', 10, 48, 2, state.columnGap, '', (value) => {
      state.columnGap = value;
    });

    grid.append(
      autoDomain.label,
      domainWidth.wrapper,
      domainAlignField,
      autoScore.label,
      scoreWidth.wrapper,
      scoreAlignField,
      autoChange.label,
      changeWidth.wrapper,
      changeAlignField,
      gap.wrapper,
    );
    columns.append(title, grid);
    body.append(columns);
    details.append(summary, body);

    const container = findDisplayContainer();
    container.appendChild(details);
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function cleanExportClone(svg) {
    const clone = svg.cloneNode(true);
    clone.querySelectorAll('[data-np010-generated="true"]').forEach((element) => element.removeAttribute('data-np010-generated'));
    clone.querySelectorAll('[tabindex]').forEach((element) => element.removeAttribute('tabindex'));
    clone.querySelectorAll('.is-focused,:focus').forEach((element) => element.classList.remove('is-focused'));
    clone.setAttribute('xmlns', NS);
    removeNativeTooltips(clone);
    return clone;
  }

  function exportFilename(extension) {
    const titleText = [...document.querySelectorAll('input,textarea')]
      .find((input) => /figure title/i.test(input.labels?.[0]?.textContent || ''))?.value || 'Cognitive Test Results';
    const safe = titleText.trim().replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '') || 'Cognitive_Test_Results';
    return `${safe}.${extension}`;
  }

  function exportSvg() {
    applyFigureEnhancements();
    const svg = largestFigureSvg();
    if (!svg) return;
    const clone = cleanExportClone(svg);
    const source = `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(clone)}`;
    downloadBlob(new Blob([source], { type: 'image/svg+xml;charset=utf-8' }), exportFilename('svg'));
  }

  function exportPng() {
    applyFigureEnhancements();
    const svg = largestFigureSvg();
    if (!svg) return;
    const clone = cleanExportClone(svg);
    const viewBox = parseViewBox(clone);
    const scale = Math.min(4, 3000 / Math.max(viewBox.width, 1));
    const width = Math.max(1, Math.round(viewBox.width * scale));
    const height = Math.max(1, Math.round(viewBox.height * scale));
    clone.setAttribute('width', String(width));
    clone.setAttribute('height', String(height));
    const source = new XMLSerializer().serializeToString(clone);
    const url = URL.createObjectURL(new Blob([source], { type: 'image/svg+xml;charset=utf-8' }));
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, width, height);
      context.drawImage(image, 0, 0, width, height);
      URL.revokeObjectURL(url);
      canvas.toBlob((blob) => {
        if (blob) downloadBlob(blob, exportFilename('png'));
      }, 'image/png');
    };
    image.onerror = () => URL.revokeObjectURL(url);
    image.src = url;
  }

  function interceptExports() {
    document.addEventListener('click', (event) => {
      const button = event.target.closest('button,a');
      if (!button) return;
      const text = `${button.textContent || ''} ${button.getAttribute('aria-label') || ''}`.trim().toLowerCase();
      const looksLikeExport = /download|export|save/.test(text);
      if (looksLikeExport && /\bsvg\b/.test(text)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        exportSvg();
      } else if (looksLikeExport && /\bpng\b/.test(text)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        exportPng();
      }
    }, true);
  }

  function syncLayoutControlsFromState() {
    const values = {
      'np010-axis-metric': state.axisMetric,
      'np010-percentile-spacing': state.percentileSpacing,
      'np010-plot-scale': state.plotScale,
      'np010-domain-width': state.domainWidth,
      'np010-score-width': state.scoreWidth,
      'np010-change-width': state.changeWidth,
      'np010-domain-align': state.domainAlign,
      'np010-score-align': state.scoreAlign,
      'np010-change-align': state.changeAlign,
      'np010-column-gap': state.columnGap,
    };
    Object.entries(values).forEach(([id, value]) => {
      const control = document.getElementById(id);
      if (!control) return;
      control.value = String(value);
      const output = control.closest('.np010-field')?.querySelector('output');
      if (output && control.type === 'range') output.textContent = `${control.value}${id === 'np010-plot-scale' ? '%' : ''}`;
    });
    const checks = {
      'np010-auto-domain': state.autoDomainWidth,
      'np010-auto-score': state.autoScoreWidth,
      'np010-auto-change': state.autoChangeWidth,
    };
    Object.entries(checks).forEach(([id, checked]) => {
      const control = document.getElementById(id);
      if (control) control.checked = Boolean(checked);
    });
    syncConditionalControls();
  }

  function setLayoutState(next) {
    const value = next && typeof next === 'object' ? next : {};
    if (['t', 'z', 'standard', 'scaled', 'percentile'].includes(value.axisMetric)) state.axisMetric = value.axisMetric;
    if (['equal', 'linear'].includes(value.percentileSpacing)) state.percentileSpacing = value.percentileSpacing;
    state.plotScale = clamp(number(value.plotScale, state.plotScale), 75, 140);
    state.autoDomainWidth = value.autoDomainWidth === undefined ? state.autoDomainWidth : Boolean(value.autoDomainWidth);
    state.domainWidth = clamp(number(value.domainWidth, state.domainWidth), 160, 420);
    state.autoScoreWidth = value.autoScoreWidth === undefined ? state.autoScoreWidth : Boolean(value.autoScoreWidth);
    state.scoreWidth = clamp(number(value.scoreWidth, state.scoreWidth), 90, 360);
    state.autoChangeWidth = value.autoChangeWidth === undefined ? state.autoChangeWidth : Boolean(value.autoChangeWidth);
    state.changeWidth = clamp(number(value.changeWidth, state.changeWidth), 90, 320);
    if (['left', 'center', 'right'].includes(value.domainAlign)) state.domainAlign = value.domainAlign;
    if (['left', 'center', 'right'].includes(value.scoreAlign)) state.scoreAlign = value.scoreAlign;
    if (['left', 'center', 'right'].includes(value.changeAlign)) state.changeAlign = value.changeAlign;
    state.columnGap = clamp(number(value.columnGap, state.columnGap), 10, 48);
    syncLayoutControlsFromState();
    scheduleApply();
  }

  window.NeuroProfileLayoutController = Object.freeze({
    getState: () => ({ ...state }),
    setState: setLayoutState,
    apply: applyFigureEnhancements,
    schedule: scheduleApply,
  });

  function init() {
    buildSettings();
    installConditionalDisclosure();
    interceptExports();
    const observer = new MutationObserver((records) => {
      if (applying) return;
      const relevant = records.some((record) =>
        record.type === 'childList' ||
        (record.type === 'attributes' && record.target.closest?.('svg'))
      );
      if (relevant) scheduleApply();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    scheduleApply();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();

