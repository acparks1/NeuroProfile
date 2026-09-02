(() => {
  'use strict';

  const VERSION = '0.16';
  const SVG_NS = 'http://www.w3.org/2000/svg';

  const COLOR_FIELDS = Object.freeze([
    ['figureBackground', 'Figure background'],
    ['text', 'Primary text'],
    ['secondaryText', 'Secondary text'],
    ['veryLowBand', 'Very Low band'],
    ['lowAverageBand', 'Low Average band'],
    ['averageBand', 'Average band'],
    ['highAverageBand', 'High Average+ band'],
    ['scoreRange', 'Score range'],
    ['veryLow', 'Very Low score'],
    ['lowAverage', 'Low Average score'],
    ['average', 'Average score'],
    ['highAverage', 'High Average+ score'],
    ['testScore', 'Test score outline'],
    ['grid', 'Band boundaries and axis'],
    ['separator', 'Row separators'],
    ['border', 'Figure border'],
    ['legendBorder', 'Legend border'],
    ['increase', 'Increase indicator'],
    ['decrease', 'Decrease indicator'],
    ['current', 'Current assessment'],
    ['prior1', 'Prior assessment 1'],
    ['prior2', 'Prior assessment 2'],
    ['prior3', 'Prior assessment 3'],
    ['prior4', 'Prior assessment 4'],
    ['prior5', 'Prior assessment 5'],
  ]);

  const PRESETS = Object.freeze({
    clinical: Object.freeze({
      figureBackground: '#ffffff', text: '#172631', secondaryText: '#40525f',
      veryLowBand: '#f8e8e8', lowAverageBand: '#fbf2e3', averageBand: '#f1f5f8', highAverageBand: '#e5f2f0',
      scoreRange: '#6c7a85', veryLow: '#a33d46', lowAverage: '#9f5d14', average: '#245f78', highAverage: '#19766f',
      testScore: '#4d5c68', grid: '#c4d0d8', separator: '#d1d9df', border: '#000000', legendBorder: '#6f7f8a',
      increase: '#176b57', decrease: '#93333c',
      current: '#1f667f', prior1: '#5d77a0', prior2: '#7c6488', prior3: '#896b4f', prior4: '#4f796d', prior5: '#6d717c',
    }),
    colorblind: Object.freeze({
      figureBackground: '#ffffff', text: '#18242c', secondaryText: '#435764',
      veryLowBand: '#f6e7e0', lowAverageBand: '#fff3d8', averageBand: '#edf3f7', highAverageBand: '#e3f1ed',
      scoreRange: '#687783', veryLow: '#c43b2f', lowAverage: '#a45b00', average: '#0072b2', highAverage: '#007a68',
      testScore: '#4c5c67', grid: '#bccbd4', separator: '#d0d9de', border: '#000000', legendBorder: '#657783',
      increase: '#007a68', decrease: '#c43b2f',
      current: '#0072b2', prior1: '#d55e00', prior2: '#009e73', prior3: '#cc79a7', prior4: '#7a5aa6', prior5: '#8a6a2f',
    }),
    highContrast: Object.freeze({
      figureBackground: '#ffffff', text: '#0d151a', secondaryText: '#263944',
      veryLowBand: '#f5d9dc', lowAverageBand: '#f8e5bd', averageBand: '#e7eef3', highAverageBand: '#d5ebe6',
      scoreRange: '#42535e', veryLow: '#8f1f2b', lowAverage: '#814800', average: '#174f69', highAverage: '#0a645a',
      testScore: '#263943', grid: '#8fa3af', separator: '#aebdc6', border: '#000000', legendBorder: '#394d59',
      increase: '#0a645a', decrease: '#8f1f2b',
      current: '#0d5c7a', prior1: '#3d6398', prior2: '#714d83', prior3: '#7d5432', prior4: '#356d5d', prior5: '#525865',
    }),
    grayscale: Object.freeze({
      figureBackground: '#ffffff', text: '#111111', secondaryText: '#3f3f3f',
      veryLowBand: '#eeeeee', lowAverageBand: '#e2e2e2', averageBand: '#f7f7f7', highAverageBand: '#d6d6d6',
      scoreRange: '#555555', veryLow: '#111111', lowAverage: '#2f2f2f', average: '#4a4a4a', highAverage: '#000000',
      testScore: '#222222', grid: '#8a8a8a', separator: '#bdbdbd', border: '#000000', legendBorder: '#555555',
      increase: '#111111', decrease: '#111111',
      current: '#111111', prior1: '#303030', prior2: '#505050', prior3: '#707070', prior4: '#8a8a8a', prior5: '#a0a0a0',
    }),
  });

  const state = {
    preset: 'clinical',
    colors: { ...PRESETS.clinical },
    pendingApply: false,
  };

  let theaterDialog = null;
  let previewPlaceholder = null;
  let previewCard = null;
  let theaterButton = null;
  let focusBeforeTheater = null;

  const isHex = (value) => /^#[0-9a-f]{6}$/i.test(String(value || '').trim());
  const normalizedHex = (value, fallback) => isHex(value) ? String(value).trim().toLowerCase() : fallback;

  function parseViewBox(svg) {
    const raw = svg?.getAttribute('viewBox');
    if (!raw) return null;
    const values = raw.trim().split(/[\s,]+/).map(Number);
    if (values.length !== 4 || !values.every(Number.isFinite)) return null;
    return { x: values[0], y: values[1], width: values[2], height: values[3] };
  }

  function largestFigureSvg() {
    const candidates = [...document.querySelectorAll('#chartStage svg, .chart-stage svg')]
      .map((svg) => ({ svg, box: parseViewBox(svg) }))
      .filter(({ box }) => box && box.width >= 650 && box.height >= 280)
      .sort((a, b) => b.box.width * b.box.height - a.box.width * a.box.height);
    return candidates[0]?.svg || null;
  }

  function numericAttr(element, name) {
    const value = Number(element?.getAttribute(name));
    return Number.isFinite(value) ? value : null;
  }

  function setFill(element, color) {
    if (!element) return;
    element.setAttribute('fill', color);
    element.style.fill = color;
  }

  function setStroke(element, color) {
    if (!element) return;
    element.setAttribute('stroke', color);
    element.style.stroke = color;
  }

  function performanceRole(labelText) {
    const label = String(labelText || '').split('·')[0].trim().toLowerCase();
    if (label.startsWith('exceptionally low') || label.startsWith('below average')) return 'veryLow';
    if (label.startsWith('low average')) return 'lowAverage';
    if (label === 'average') return 'average';
    return 'highAverage';
  }

  function findBandRects(svg) {
    const box = parseViewBox(svg);
    if (!box) return [];
    const candidates = [...svg.querySelectorAll('rect')].map((element) => ({
      element,
      x: numericAttr(element, 'x') ?? 0,
      y: numericAttr(element, 'y') ?? 0,
      width: numericAttr(element, 'width') ?? 0,
      height: numericAttr(element, 'height') ?? 0,
    })).filter((rect) =>
      rect.x > box.width * 0.08 &&
      rect.y > 35 &&
      rect.width > 12 &&
      rect.width < box.width * 0.72 &&
      rect.height > box.height * 0.24 &&
      rect.height < box.height * 0.86
    );

    const groups = new Map();
    candidates.forEach((rect) => {
      const key = `${Math.round(rect.y)}:${Math.round(rect.height)}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(rect);
    });

    let best = [];
    let bestSpan = 0;
    groups.forEach((group) => {
      if (group.length < 4) return;
      const sorted = [...group].sort((a, b) => a.x - b.x).slice(0, 4);
      const span = sorted[3].x + sorted[3].width - sorted[0].x;
      if (span > bestSpan) {
        best = sorted;
        bestSpan = span;
      }
    });
    return best;
  }

  function visibleAssessmentIds(svg) {
    const ids = [];
    svg.querySelectorAll('.np-assessment-legend-item[data-assessment-id]').forEach((item) => {
      const id = item.getAttribute('data-assessment-id');
      if (id && !ids.includes(id)) ids.push(id);
    });
    svg.querySelectorAll('.np-assessment-row[data-assessment-id]').forEach((item) => {
      const id = item.getAttribute('data-assessment-id');
      if (id && !ids.includes(id)) ids.push(id);
    });
    return ids;
  }

  function assessmentColor(index) {
    if (index <= 0) return state.colors.current;
    return state.colors[`prior${Math.min(5, index)}`] || state.colors.prior5;
  }

  function recolorAssessmentGroup(group, color) {
    group.querySelectorAll('.np-range-line').forEach((line) => setStroke(line, color));
    group.querySelectorAll('.np-domain-average').forEach((marker) => {
      setFill(marker, color);
      setStroke(marker, state.colors.figureBackground);
    });
    group.querySelectorAll('.np-test-score').forEach((marker) => {
      setFill(marker, state.colors.figureBackground);
      setStroke(marker, color);
    });
    group.querySelectorAll('circle:not(.np-tooltip-target):not(.np-test-score)').forEach((endpoint) => setFill(endpoint, color));
    group.querySelectorAll('polygon:not(.np-domain-average)').forEach((endpoint) => setFill(endpoint, color));
    group.querySelectorAll('.np-label').forEach((label) => setFill(label, color));
  }

  function recolorSingleAssessmentRow(group) {
    const label = group.querySelector('.np-label');
    const role = performanceRole(label?.textContent);
    const markerColor = state.colors[role];
    group.querySelectorAll('.np-range-line').forEach((line) => setStroke(line, state.colors.scoreRange));
    group.querySelectorAll('.np-domain-average').forEach((marker) => {
      setFill(marker, markerColor);
      setStroke(marker, state.colors.figureBackground);
    });
    group.querySelectorAll('.np-test-score').forEach((marker) => {
      setFill(marker, state.colors.figureBackground);
      setStroke(marker, state.colors.testScore);
    });
    group.querySelectorAll('circle:not(.np-tooltip-target):not(.np-test-score)').forEach((endpoint) => setFill(endpoint, state.colors.scoreRange));
    group.querySelectorAll('polygon:not(.np-domain-average)').forEach((endpoint) => setFill(endpoint, state.colors.scoreRange));
    group.querySelectorAll('line:not(.np-range-line):not(.np-tooltip-target)').forEach((line) => {
      const original = String(line.getAttribute('stroke') || '').toLowerCase();
      const savedRole = line.dataset.np011Accent;
      if (savedRole === 'veryLow' || original === '#b6454c' || original === '#a33d46') {
        line.dataset.np011Accent = 'veryLow';
        setStroke(line, state.colors.veryLow);
      } else if (savedRole === 'highAverage' || original === '#247b74' || original === '#19766f') {
        line.dataset.np011Accent = 'highAverage';
        setStroke(line, state.colors.highAverage);
      }
    });
    if (label) setFill(label, markerColor);
  }

  function applyColors(svg = largestFigureSvg()) {
    if (!svg) return;
    if (document.getElementById('grayscale')?.checked) return;

    const box = parseViewBox(svg);
    if (!box) return;

    const outerRects = [...svg.querySelectorAll('rect')].filter((rect) => {
      const x = numericAttr(rect, 'x') ?? 0;
      const y = numericAttr(rect, 'y') ?? 0;
      const width = numericAttr(rect, 'width') ?? 0;
      const height = numericAttr(rect, 'height') ?? 0;
      return x <= 4 && y <= 4 && width >= box.width - 8 && height >= box.height - 8;
    });
    outerRects.forEach((rect) => {
      if (rect.classList.contains('np-figure-border') || rect.getAttribute('fill') === 'none') setStroke(rect, state.colors.border);
      else setFill(rect, state.colors.figureBackground);
    });

    const bands = findBandRects(svg);
    [state.colors.veryLowBand, state.colors.lowAverageBand, state.colors.averageBand, state.colors.highAverageBand]
      .forEach((color, index) => setFill(bands[index]?.element, color));

    svg.querySelectorAll('.np-title,.np-domain,.np-profile-domain').forEach((text) => setFill(text, state.colors.text));
    svg.querySelectorAll('.np-subtitle,.np-region,.np-column-header,.np-tick,.np-secondary-tick,.np-axis-row-label,.np-axis-title,.np-note,.np-legend,.np-assessment-legend,.np-missing')
      .forEach((text) => setFill(text, state.colors.secondaryText));

    svg.querySelectorAll('.np-domain-separator').forEach((line) => setStroke(line, state.colors.separator));
    svg.querySelectorAll('.np-figure-border').forEach((rect) => setStroke(rect, state.colors.border));

    const legendPanel = svg.querySelector('.np-legend-panel');
    if (legendPanel) {
      const panelRect = legendPanel.querySelector(':scope > rect');
      setFill(panelRect, state.colors.figureBackground);
      setStroke(panelRect, state.colors.legendBorder);
      legendPanel.querySelectorAll('[data-legend-component="range"] line').forEach((line) => setStroke(line, state.colors.scoreRange));
      legendPanel.querySelectorAll('[data-legend-component="average"] polygon').forEach((marker) => {
        setFill(marker, state.colors.average);
        setStroke(marker, state.colors.figureBackground);
      });
      legendPanel.querySelectorAll('[data-legend-component="test"] circle').forEach((marker) => {
        setFill(marker, state.colors.figureBackground);
        setStroke(marker, state.colors.testScore);
      });
    }

    const assessmentIds = visibleAssessmentIds(svg);
    const isMultiple = svg.querySelector('.np-prior-assessment-row') !== null || assessmentIds.length > 1;
    if (isMultiple) {
      assessmentIds.forEach((id, index) => {
        const color = assessmentColor(index);
        svg.querySelectorAll(`.np-assessment-row[data-assessment-id="${CSS.escape(id)}"]`).forEach((group) => recolorAssessmentGroup(group, color));
        svg.querySelectorAll(`.np-assessment-legend-item[data-assessment-id="${CSS.escape(id)}"]`).forEach((item) => {
          item.querySelectorAll('line').forEach((line) => setStroke(line, color));
          item.querySelectorAll('polygon').forEach((marker) => {
            setFill(marker, color);
            setStroke(marker, state.colors.figureBackground);
          });
          item.querySelectorAll('text').forEach((text) => setFill(text, color));
        });
      });
    } else {
      svg.querySelectorAll('.np-assessment-row').forEach(recolorSingleAssessmentRow);
    }

    svg.querySelectorAll('.np-change').forEach((text) => {
      const upward = /^[▲△]/.test(text.textContent.trim());
      setFill(text, upward ? state.colors.increase : state.colors.decrease);
    });

    const axisGroups = [...svg.querySelectorAll('g[aria-label$=" axis"]')];
    axisGroups.forEach((group) => {
      group.querySelectorAll('line').forEach((line) => setStroke(line, state.colors.grid));
      group.querySelectorAll('text').forEach((text) => setFill(text, state.colors.secondaryText));
    });

    const plotBands = findBandRects(svg);
    if (plotBands.length === 4) {
      const plotTop = plotBands[0].y;
      const plotBottom = plotTop + plotBands[0].height;
      const plotStart = plotBands[0].x;
      const plotEnd = plotBands[3].x + plotBands[3].width;
      svg.querySelectorAll('line').forEach((line) => {
        if (line.closest('.np-assessment-row,.np-legend-panel,g[aria-label$=" axis"]')) return;
        const x1 = numericAttr(line, 'x1');
        const x2 = numericAttr(line, 'x2');
        const y1 = numericAttr(line, 'y1');
        const y2 = numericAttr(line, 'y2');
        if ([x1, x2, y1, y2].some((value) => value === null)) return;
        if (Math.abs(x1 - x2) < .5 && y1 <= plotTop + 2 && y2 >= plotBottom - 2 && x1 >= plotStart - 2 && x1 <= plotEnd + 2) {
          setStroke(line, state.colors.grid);
        }
      });
    }

    svg.dataset.neuroprofileColors = state.preset;
  }

  function scheduleColorApply() {
    if (state.pendingApply) return;
    state.pendingApply = true;
    requestAnimationFrame(() => {
      state.pendingApply = false;
      applyColors();
      refreshTheaterButton();
    });
  }

  function findDisplayCard() {
    return document.getElementById('displayHeading')?.closest('.card,section') || document.querySelector('.sidebar');
  }

  function makeSelect(id, options, value) {
    const select = document.createElement('select');
    select.id = id;
    select.className = 'select-input';
    options.forEach(([optionValue, label]) => {
      const option = document.createElement('option');
      option.value = optionValue;
      option.textContent = label;
      select.appendChild(option);
    });
    select.value = value;
    return select;
  }

  function setColorFieldValue(key, color) {
    const picker = document.getElementById(`np011-color-${key}`);
    const text = document.getElementById(`np011-hex-${key}`);
    if (picker) picker.value = color;
    if (text) text.value = color.toUpperCase();
  }

  function syncColorControls() {
    COLOR_FIELDS.forEach(([key]) => setColorFieldValue(key, state.colors[key]));
    const preset = document.getElementById('np011-color-preset');
    if (preset) preset.value = state.preset;
  }

  function applyPreset(name) {
    const preset = PRESETS[name] || PRESETS.clinical;
    state.preset = PRESETS[name] ? name : 'clinical';
    state.colors = { ...preset };
    syncColorControls();
    scheduleColorApply();
  }

  function setColorState(nextColors, presetName) {
    if (presetName && PRESETS[presetName] && (!nextColors || presetName !== 'custom')) {
      applyPreset(presetName);
      return;
    }
    const incoming = nextColors && typeof nextColors === 'object' ? nextColors : {};
    const colors = { ...PRESETS.clinical };
    COLOR_FIELDS.forEach(([key]) => {
      colors[key] = normalizedHex(incoming[key], colors[key]);
    });
    state.colors = colors;
    state.preset = 'custom';
    syncColorControls();
    scheduleColorApply();
  }

  function updateCustomColor(key, value) {
    const fallback = state.colors[key] || PRESETS.clinical[key];
    const color = normalizedHex(value, fallback);
    state.colors[key] = color;
    state.preset = 'custom';
    const preset = document.getElementById('np011-color-preset');
    if (preset) preset.value = 'custom';
    setColorFieldValue(key, color);
    scheduleColorApply();
  }

  function colorField(key, labelText) {
    const label = document.createElement('label');
    label.className = 'np011-color-field';
    const caption = document.createElement('span');
    caption.textContent = labelText;
    const control = document.createElement('span');
    control.className = 'np011-color-control';
    const picker = document.createElement('input');
    picker.type = 'color';
    picker.id = `np011-color-${key}`;
    picker.value = state.colors[key];
    picker.setAttribute('aria-label', `${labelText} color`);
    const hex = document.createElement('input');
    hex.type = 'text';
    hex.id = `np011-hex-${key}`;
    hex.value = state.colors[key].toUpperCase();
    hex.maxLength = 7;
    hex.pattern = '#[0-9A-Fa-f]{6}';
    hex.spellcheck = false;
    hex.autocomplete = 'off';
    hex.setAttribute('aria-label', `${labelText} hexadecimal color`);
    picker.addEventListener('input', () => updateCustomColor(key, picker.value));
    hex.addEventListener('change', () => updateCustomColor(key, hex.value));
    hex.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        updateCustomColor(key, hex.value);
        hex.blur();
      }
    });
    control.append(picker, hex);
    label.append(caption, control);
    return label;
  }

  function addColorSection(body, titleText, keys) {
    const section = document.createElement('section');
    section.className = 'np011-color-section';
    const title = document.createElement('h3');
    title.className = 'np011-color-section-title';
    title.textContent = titleText;
    const grid = document.createElement('div');
    grid.className = 'np011-color-grid';
    keys.forEach((key) => {
      const field = COLOR_FIELDS.find(([fieldKey]) => fieldKey === key);
      if (field) grid.appendChild(colorField(field[0], field[1]));
    });
    section.append(title, grid);
    body.appendChild(section);
  }

  function buildColorSettings() {
    if (document.getElementById('np011-color-settings')) return;
    const details = document.createElement('details');
    details.id = 'np011-color-settings';
    details.className = 'np011-color-settings';
    const summary = document.createElement('summary');
    summary.textContent = 'Color scheme';
    const body = document.createElement('div');
    body.className = 'np011-color-body';

    const toolbar = document.createElement('div');
    toolbar.className = 'np011-color-toolbar';
    const presetField = document.createElement('div');
    presetField.className = 'field-group';
    const presetLabel = document.createElement('label');
    presetLabel.htmlFor = 'np011-color-preset';
    presetLabel.textContent = 'Color preset';
    const preset = makeSelect('np011-color-preset', [
      ['clinical', 'Clinical default'],
      ['colorblind', 'Color-vision friendly'],
      ['highContrast', 'High contrast'],
      ['grayscale', 'Grayscale'],
      ['custom', 'Custom'],
    ], state.preset);
    preset.addEventListener('change', () => {
      if (preset.value !== 'custom') applyPreset(preset.value);
      else state.preset = 'custom';
    });
    presetField.append(presetLabel, preset);
    const reset = document.createElement('button');
    reset.id = 'np011-reset-colors';
    reset.type = 'button';
    reset.className = 'btn np011-reset-colors';
    reset.textContent = 'Reset colors';
    reset.addEventListener('click', () => applyPreset('clinical'));
    toolbar.append(presetField, reset);
    body.appendChild(toolbar);

    addColorSection(body, 'Normative regions', ['veryLowBand', 'lowAverageBand', 'averageBand', 'highAverageBand']);
    addColorSection(body, 'Scores and labels', ['scoreRange', 'veryLow', 'lowAverage', 'average', 'highAverage', 'testScore', 'increase', 'decrease']);
    addColorSection(body, 'Longitudinal assessments', ['current', 'prior1', 'prior2', 'prior3', 'prior4', 'prior5']);
    addColorSection(body, 'Figure structure', ['figureBackground', 'text', 'secondaryText', 'grid', 'separator', 'legendBorder', 'border']);

    details.append(summary, body);
    const displayCard = findDisplayCard();
    const axisSettings = document.getElementById('np010-settings');
    if (axisSettings?.parentElement === displayCard) axisSettings.insertAdjacentElement('afterend', details);
    else displayCard?.appendChild(details);
  }

  function theaterIcon(expanded) {
    return expanded
      ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5"/><path d="M4 4l6 6M20 4l-6 6M4 20l6-6M20 20l-6-6"/></svg>'
      : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5"/></svg>';
  }

  function refreshTheaterButton() {
    if (!theaterButton) return;
    theaterButton.disabled = !largestFigureSvg();
  }

  function restorePreviewCard() {
    if (!previewCard || !previewPlaceholder?.parentNode) return;
    previewPlaceholder.parentNode.insertBefore(previewCard, previewPlaceholder);
    previewPlaceholder.remove();
    previewPlaceholder = null;
  }

  function theaterCloseIcon() {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  }

  function setTheaterButtonState(active) {
    if (!theaterButton) return;
    theaterButton.setAttribute('aria-pressed', active ? 'true' : 'false');
    theaterButton.setAttribute('aria-label', active ? 'Close Theater Mode' : 'Open Theater Mode');
    theaterButton.innerHTML = active
      ? theaterCloseIcon()
      : `${theaterIcon(false)}<span>Theater Mode</span>`;
  }

  function closeTheater() {
    if (!theaterDialog) return;
    if (theaterDialog.open && typeof theaterDialog.close === 'function') theaterDialog.close();
    else {
      theaterDialog.removeAttribute('open');
      restorePreviewCard();
      document.body.classList.remove('np011-theater-open');
      setTheaterButtonState(false);
      focusBeforeTheater?.focus?.();
    }
  }

  function openTheater() {
    if (!previewCard || !largestFigureSvg() || !theaterDialog) return;
    focusBeforeTheater = document.activeElement;
    previewPlaceholder = document.createComment('NeuroProfile theater mode placeholder');
    previewCard.parentNode.insertBefore(previewPlaceholder, previewCard);
    theaterDialog.appendChild(previewCard);
    document.body.classList.add('np011-theater-open');
    setTheaterButtonState(true);
    if (typeof theaterDialog.showModal === 'function') theaterDialog.showModal();
    else theaterDialog.setAttribute('open', '');
    requestAnimationFrame(() => {
      theaterButton?.focus();
      scheduleColorApply();
    });
  }

  function toggleTheater() {
    if (theaterDialog?.open) closeTheater();
    else openTheater();
  }

  function buildTheaterMode() {
    previewCard = document.querySelector('.preview-card');
    if (!previewCard || document.getElementById('np011-theater-button')) return;

    const bar = document.createElement('div');
    bar.className = 'np011-theater-bar';
    theaterButton = document.createElement('button');
    theaterButton.id = 'np011-theater-button';
    theaterButton.type = 'button';
    theaterButton.className = 'np011-theater-button';
    theaterButton.setAttribute('aria-pressed', 'false');
    theaterButton.innerHTML = `${theaterIcon(false)}<span>Theater Mode</span>`;
    theaterButton.addEventListener('click', toggleTheater);
    bar.appendChild(theaterButton);
    previewCard.insertBefore(bar, previewCard.firstChild);

    theaterDialog = document.createElement('dialog');
    theaterDialog.id = 'np011-theater-dialog';
    theaterDialog.className = 'np011-theater-dialog';
    theaterDialog.setAttribute('aria-label', 'Cognitive profile theater mode');
    theaterDialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      closeTheater();
    });
    theaterDialog.addEventListener('close', () => {
      restorePreviewCard();
      document.body.classList.remove('np011-theater-open');
      setTheaterButtonState(false);
      focusBeforeTheater?.focus?.();
      focusBeforeTheater = null;
      scheduleColorApply();
    });
    document.body.appendChild(theaterDialog);
    refreshTheaterButton();
  }

  function init() {
    buildTheaterMode();
    buildColorSettings();
    const observer = new MutationObserver((records) => {
      if (records.some((record) => record.type === 'childList' || record.type === 'attributes')) scheduleColorApply();
    });
    const chartStage = document.getElementById('chartStage');
    if (chartStage) observer.observe(chartStage, { childList: true, subtree: true });
    document.getElementById('grayscale')?.addEventListener('change', scheduleColorApply);
    scheduleColorApply();
  }

  window.NeuroProfileColorController = Object.freeze({
    apply: applyColors,
    colors: () => ({ ...state.colors }),
    preset: () => state.preset,
    setPreset: applyPreset,
    setColors: setColorState,
  });
  window.NeuroProfileTheaterController = Object.freeze({
    open: openTheater,
    close: closeTheater,
    refresh: refreshTheaterButton,
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();

