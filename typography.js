(() => {
  'use strict';

  const VERSION = '0.16';
  const STORAGE_KEY = 'NeuroProfileWeb.displaySettings.v1';
  const FONT_PRESETS = Object.freeze({
    arial: Object.freeze({ label: 'Arial', stack: 'Arial, Helvetica, sans-serif' }),
    segoe: Object.freeze({ label: 'Segoe UI', stack: '"Segoe UI", Aptos, Calibri, Arial, sans-serif' }),
    trebuchet: Object.freeze({ label: 'Trebuchet MS', stack: '"Trebuchet MS", "Avenir Next", Arial, sans-serif' }),
    georgia: Object.freeze({ label: 'Georgia', stack: 'Georgia, "Times New Roman", serif' }),
    palatino: Object.freeze({ label: 'Palatino', stack: '"Palatino Linotype", Palatino, "Book Antiqua", Georgia, serif' }),
  });
  const DEFAULT_SIZES = Object.freeze({
    title: 31,
    subtitle: 16.5,
    region: 15.5,
    columnHeader: 15.5,
    domain: 16.25,
    score: 16.5,
    legend: 13.5,
    axisTick: 13.5,
    axisTitle: 14.5,
    change: 14.5,
    notes: 13,
  });
  const SIZE_FIELDS = Object.freeze([
    ['title', 'Figure title', 20, 40],
    ['subtitle', 'Subheading', 10, 24],
    ['region', 'Range headings', 10, 22],
    ['columnHeader', 'Column headings', 10, 22],
    ['domain', 'Domain labels', 10, 24],
    ['score', 'Domain scores', 10, 24],
    ['legend', 'Legend text', 10, 20],
    ['axisTick', 'Axis tick labels', 9, 20],
    ['axisTitle', 'Axis title', 10, 22],
    ['change', 'Change indicators', 10, 22],
    ['notes', 'Figure notes', 9, 20],
  ]);
  const BASE_CONTROL_IDS = Object.freeze([
    'showSubtitle', 'showIndividuals', 'showProfileMean',
    'showAveragePercentile', 'showLegend', 'showRangeLegend',
    'showDomainAverageLegend', 'showTestScoreLegend', 'showAssessmentLegend',
    'showNotes', 'showChangeIndicators', 'changeThreshold',
  ]);

  const state = {
    fontKey: 'arial',
    sizes: { ...DEFAULT_SIZES },
    hoverEnabled: true,
    applying: false,
  };

  let theaterIndividuals = null;
  let theaterHover = null;
  let hoverToggle = null;
  let saveStatus = null;

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const numeric = (value, fallback) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  const fontStack = () => (FONT_PRESETS[state.fontKey] || FONT_PRESETS.arial).stack;

  function displayCard() {
    return document.getElementById('displayHeading')?.closest('.card,section') || document.querySelector('.sidebar');
  }

  function largestFigureSvg() {
    const candidates = [...document.querySelectorAll('#chartStage svg, .chart-stage svg')]
      .map((svg) => {
        const values = String(svg.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
        return { svg, area: values.length === 4 && values.every(Number.isFinite) ? values[2] * values[3] : 0 };
      })
      .sort((a, b) => b.area - a.area);
    return candidates[0]?.svg || null;
  }

  function setFontSize(svg, selector, value) {
    svg.querySelectorAll(selector).forEach((element) => {
      element.style.fontSize = `${value}px`;
      element.setAttribute('font-size', String(value));
    });
  }

  function setTspanSpacing(svg, selector, lineHeight) {
    svg.querySelectorAll(selector).forEach((element) => {
      const spans = [...element.querySelectorAll(':scope > tspan')];
      spans.forEach((span, index) => {
        if (index > 0) span.setAttribute('dy', String(Math.round(lineHeight * 100) / 100));
      });
    });
  }

  function layoutLegendRows(svg) {
    const panel = svg.querySelector('.np-legend-panel');
    const rect = panel?.querySelector(':scope > rect');
    if (!panel || !rect) return;
    const rectX = numeric(rect.getAttribute('x'), 0);
    const items = [...panel.querySelectorAll(':scope > .np-legend-component, :scope > .np-assessment-legend-item')];
    if (!items.length) return;
    const rows = new Map();
    items.forEach((item) => {
      item.removeAttribute('transform');
      try {
        const box = item.getBBox();
        const key = Math.round((box.y + box.height / 2) / 8) * 8;
        if (!rows.has(key)) rows.set(key, []);
        rows.get(key).push({ item, box });
      } catch { /* keep original layout */ }
    });
    let maximumRight = rectX + 220;
    [...rows.values()].forEach((row) => {
      row.sort((a, b) => a.box.x - b.box.x);
      let cursor = rectX + 14;
      row.forEach(({ item, box }) => {
        const dx = cursor - box.x;
        item.setAttribute('transform', `translate(${Math.round(dx * 100) / 100} 0)`);
        cursor += box.width + 24;
      });
      maximumRight = Math.max(maximumRight, cursor - 24 + 14);
    });
    rect.setAttribute('width', String(Math.ceil(maximumRight - rectX)));
  }

  function applyFontFamily(svg) {
    const stack = fontStack();
    svg.style.fontFamily = stack;
    svg.setAttribute('font-family', stack);
    svg.querySelectorAll('text').forEach((text) => {
      text.style.fontFamily = stack;
      text.setAttribute('font-family', stack);
    });
    document.documentElement.style.setProperty('--np012-figure-font', stack);
    const tooltip = document.getElementById('chartTooltip');
    if (tooltip) tooltip.style.fontFamily = stack;
  }

  function applyBeforeLayout(svg) {
    if (!svg || state.applying) return;
    state.applying = true;
    try {
      applyFontFamily(svg);
      setFontSize(svg, '.np-title', state.sizes.title);
      setFontSize(svg, '.np-subtitle', state.sizes.subtitle);
      setFontSize(svg, '.np-region', state.sizes.region);
      setFontSize(svg, '.np-column-header', state.sizes.columnHeader);
      setFontSize(svg, '.np-domain', state.sizes.domain);
      setFontSize(svg, '.np-label,.np-missing', state.sizes.score);
      setFontSize(svg, '.np-legend,.np-assessment-legend', state.sizes.legend);
      setFontSize(svg, '.np-tick,.np-secondary-tick,.np-axis-row-label', state.sizes.axisTick);
      setFontSize(svg, '.np-axis-title', state.sizes.axisTitle);
      setFontSize(svg, '.np-change', state.sizes.change);
      setFontSize(svg, '.np-note', state.sizes.notes);
      setTspanSpacing(svg, '.np-title', state.sizes.title * 1.12);
      setTspanSpacing(svg, '.np-subtitle', state.sizes.subtitle * 1.25);
      setTspanSpacing(svg, '.np-region,.np-column-header', state.sizes.region * 1.05);
      setTspanSpacing(svg, '.np-domain', state.sizes.domain * 1.16);
      layoutLegendRows(svg);
      svg.dataset.neuroprofileFont = state.fontKey;
    } finally {
      state.applying = false;
    }
  }

  function expandSvgHeightIfNeeded(svg) {
    const raw = String(svg.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
    if (raw.length !== 4 || !raw.every(Number.isFinite)) return;
    let maxBottom = raw[1] + raw[3];
    svg.querySelectorAll('text').forEach((text) => {
      try {
        const box = text.getBBox();
        maxBottom = Math.max(maxBottom, box.y + box.height + 16);
      } catch { /* ignore */ }
    });
    const currentBottom = raw[1] + raw[3];
    if (maxBottom <= currentBottom) return;
    const newHeight = Math.ceil(maxBottom - raw[1]);
    svg.setAttribute('viewBox', `${raw[0]} ${raw[1]} ${raw[2]} ${newHeight}`);
    if (/^\d/.test(svg.getAttribute('height') || '')) svg.setAttribute('height', String(newHeight));
    svg.querySelectorAll('rect').forEach((rect) => {
      const x = numeric(rect.getAttribute('x'), 0);
      const y = numeric(rect.getAttribute('y'), 0);
      const width = numeric(rect.getAttribute('width'), 0);
      const height = numeric(rect.getAttribute('height'), 0);
      if (x <= 4 && y <= 4 && width >= raw[2] - 8 && height >= raw[3] - 8) {
        rect.setAttribute('height', String(newHeight - 2 * y));
      }
    });
  }

  function applyAfterLayout(svg) {
    if (!svg) return;
    applyFontFamily(svg);
    setFontSize(svg, '.np-generated-axis-tick', state.sizes.axisTick);
    setFontSize(svg, '.np-generated-axis-title', state.sizes.axisTitle);
    setFontSize(svg, '.np-change', state.sizes.change);
    expandSvgHeightIfNeeded(svg);
    svg.dataset.neuroprofileTypography = VERSION;
  }

  function scheduleFigureApply() {
    window.NeuroProfileLayoutController?.schedule?.();
    requestAnimationFrame(() => {
      const svg = largestFigureSvg();
      if (svg) {
        applyBeforeLayout(svg);
        applyAfterLayout(svg);
        window.NeuroProfileColorController?.apply?.(svg);
      }
    });
  }

  function sizeInput(key, labelText, min, max) {
    const label = document.createElement('label');
    label.className = 'np012-size-field';
    label.htmlFor = `np012-font-${key}`;
    const caption = document.createElement('span');
    caption.textContent = labelText;
    const control = document.createElement('span');
    control.className = 'np012-size-control';
    const input = document.createElement('input');
    input.type = 'number';
    input.id = `np012-font-${key}`;
    input.min = String(min);
    input.max = String(max);
    input.step = '0.5';
    input.value = String(state.sizes[key]);
    input.inputMode = 'decimal';
    input.addEventListener('input', () => {
      state.sizes[key] = clamp(numeric(input.value, DEFAULT_SIZES[key]), min, max);
      scheduleFigureApply();
    });
    input.addEventListener('change', () => {
      state.sizes[key] = clamp(numeric(input.value, DEFAULT_SIZES[key]), min, max);
      input.value = String(state.sizes[key]);
      scheduleFigureApply();
    });
    const unit = document.createElement('span');
    unit.className = 'np012-size-unit';
    unit.textContent = 'px';
    control.append(input, unit);
    label.append(caption, control);
    return label;
  }

  function syncTypographyControls() {
    const family = document.getElementById('np012-font-family');
    if (family) family.value = state.fontKey;
    SIZE_FIELDS.forEach(([key]) => {
      const input = document.getElementById(`np012-font-${key}`);
      if (input) input.value = String(state.sizes[key]);
    });
  }

  function setTypography(next) {
    const value = next && typeof next === 'object' ? next : {};
    if (FONT_PRESETS[value.fontKey]) state.fontKey = value.fontKey;
    const incomingSizes = value.sizes && typeof value.sizes === 'object' ? value.sizes : {};
    SIZE_FIELDS.forEach(([key, _label, min, max]) => {
      state.sizes[key] = clamp(numeric(incomingSizes[key], state.sizes[key]), min, max);
    });
    syncTypographyControls();
    scheduleFigureApply();
  }

  function resetTypography() {
    state.fontKey = 'arial';
    state.sizes = { ...DEFAULT_SIZES };
    syncTypographyControls();
    scheduleFigureApply();
  }

  function buildTypographySettings() {
    if (document.getElementById('np012-typography-settings')) return;
    const details = document.createElement('details');
    details.id = 'np012-typography-settings';
    details.className = 'np012-typography-settings';
    const summary = document.createElement('summary');
    summary.textContent = 'Typography';
    const body = document.createElement('div');
    body.className = 'np012-typography-body';
    const familyGroup = document.createElement('div');
    familyGroup.className = 'field-group';
    const familyLabel = document.createElement('label');
    familyLabel.htmlFor = 'np012-font-family';
    familyLabel.textContent = 'Figure font';
    const select = document.createElement('select');
    select.id = 'np012-font-family';
    select.className = 'select-input';
    Object.entries(FONT_PRESETS).forEach(([key, preset]) => {
      const option = document.createElement('option');
      option.value = key;
      option.textContent = preset.label;
      select.appendChild(option);
    });
    select.value = state.fontKey;
    select.addEventListener('change', () => {
      state.fontKey = FONT_PRESETS[select.value] ? select.value : 'arial';
      scheduleFigureApply();
    });
    familyGroup.append(familyLabel, select);
    const grid = document.createElement('div');
    grid.className = 'np012-font-grid';
    SIZE_FIELDS.forEach((field) => grid.appendChild(sizeInput(...field)));
    const actions = document.createElement('div');
    actions.className = 'np012-typography-actions';
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'btn';
    reset.textContent = 'Reset typography';
    reset.addEventListener('click', resetTypography);
    actions.append(reset);
    body.append(familyGroup, grid, actions);
    details.append(summary, body);
    const color = document.getElementById('np011-color-settings');
    const axis = document.getElementById('np010-settings');
    if (color) color.insertAdjacentElement('beforebegin', details);
    else if (axis) axis.insertAdjacentElement('afterend', details);
    else displayCard()?.appendChild(details);
  }

  function hideTooltip() {
    const tooltip = document.getElementById('chartTooltip');
    if (!tooltip) return;
    tooltip.hidden = true;
    tooltip.classList.remove('is-visible');
    tooltip.setAttribute('aria-hidden', 'true');
  }

  function applyHoverState(enabled) {
    state.hoverEnabled = Boolean(enabled);
    const stage = document.getElementById('chartStage');
    stage?.classList.toggle('np012-hover-disabled', !state.hoverEnabled);
    if (hoverToggle) hoverToggle.checked = state.hoverEnabled;
    if (theaterHover) theaterHover.checked = state.hoverEnabled;
    if (!state.hoverEnabled) hideTooltip();
  }

  function buildHoverToggle() {
    if (document.getElementById('np012-hover-bubbles')) return;
    const row = document.createElement('label');
    row.className = 'toggle-row';
    const text = document.createElement('span');
    text.textContent = 'Hover bubbles';
    const toggle = document.createElement('span');
    toggle.className = 'toggle';
    hoverToggle = document.createElement('input');
    hoverToggle.id = 'np012-hover-bubbles';
    hoverToggle.type = 'checkbox';
    hoverToggle.checked = state.hoverEnabled;
    const track = document.createElement('span');
    track.className = 'toggle-track';
    track.setAttribute('aria-hidden', 'true');
    hoverToggle.addEventListener('change', () => applyHoverState(hoverToggle.checked));
    toggle.append(hoverToggle, track);
    row.append(text, toggle);
    const individualRow = document.getElementById('showIndividuals')?.closest('.toggle-row');
    if (individualRow) individualRow.insertAdjacentElement('afterend', row);
    else document.querySelector('.display-toggle-group')?.prepend(row);
  }

  function installHoverInterception() {
    const stage = document.getElementById('chartStage');
    if (!stage || stage.dataset.np012HoverBound === 'true') return;
    stage.dataset.np012HoverBound = 'true';
    ['pointerover', 'pointermove', 'focusin'].forEach((type) => {
      stage.addEventListener(type, (event) => {
        if (state.hoverEnabled) return;
        hideTooltip();
        event.stopImmediatePropagation();
      }, true);
    });
  }

  function theaterToggle(id, labelText, checked, onChange) {
    const label = document.createElement('label');
    label.className = 'np012-theater-toggle';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.id = id;
    input.checked = checked;
    const text = document.createElement('span');
    text.textContent = labelText;
    input.addEventListener('change', () => onChange(input.checked));
    label.append(input, text);
    return { label, input };
  }

  function buildTheaterControls() {
    const card = document.querySelector('.preview-card');
    if (!card || document.getElementById('np012-theater-controls')) return;
    const controls = document.createElement('div');
    controls.id = 'np012-theater-controls';
    controls.className = 'np012-theater-controls';
    const normalIndividuals = document.getElementById('showIndividuals');
    const scores = theaterToggle('np012-theater-individuals', 'Test scores', Boolean(normalIndividuals?.checked), (checked) => {
      if (!normalIndividuals) return;
      normalIndividuals.checked = checked;
      normalIndividuals.dispatchEvent(new Event('change', { bubbles: true }));
    });
    theaterIndividuals = scores.input;
    const hover = theaterToggle('np012-theater-hover', 'Hover details', state.hoverEnabled, applyHoverState);
    theaterHover = hover.input;
    normalIndividuals?.addEventListener('change', () => {
      if (theaterIndividuals) theaterIndividuals.checked = normalIndividuals.checked;
    });
    controls.append(scores.label, hover.label);
    card.appendChild(controls);
  }

  function readControl(id) {
    const control = document.getElementById(id);
    if (!control) return undefined;
    if (control.type === 'checkbox' || control.type === 'radio') return Boolean(control.checked);
    return control.value;
  }

  function writeControl(id, value) {
    const control = document.getElementById(id);
    if (!control || value === undefined) return;
    if (control.type === 'checkbox' || control.type === 'radio') {
      control.checked = Boolean(value);
      control.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      control.value = String(value);
      control.dispatchEvent(new Event(control.type === 'number' ? 'input' : 'change', { bubbles: true }));
      if (control.type === 'number') control.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  function storage() {
    try {
      const testKey = `${STORAGE_KEY}.test`;
      localStorage.setItem(testKey, '1');
      localStorage.removeItem(testKey);
      return localStorage;
    } catch {
      return null;
    }
  }

  function snapshotSettings() {
    const controls = {};
    BASE_CONTROL_IDS.forEach((id) => {
      const value = readControl(id);
      if (value !== undefined) controls[id] = value;
    });
    return {
      schema: 1,
      controls,
      layout: window.NeuroProfileLayoutController?.getState?.() || null,
      colors: {
        preset: window.NeuroProfileColorController?.preset?.() || 'clinical',
        values: window.NeuroProfileColorController?.colors?.() || null,
      },
      typography: { fontKey: state.fontKey, sizes: { ...state.sizes } },
      hoverEnabled: state.hoverEnabled,
    };
  }

  function setSaveStatus(message) {
    if (!saveStatus) return;
    saveStatus.textContent = message;
  }

  function saveSettings() {
    const store = storage();
    if (!store) {
      setSaveStatus('Browser storage is unavailable.');
      return;
    }
    try {
      store.setItem(STORAGE_KEY, JSON.stringify(snapshotSettings()));
      setSaveStatus('Settings saved.');
    } catch {
      setSaveStatus('Settings could not be saved.');
    }
  }

  function applySettings(saved) {
    if (!saved || typeof saved !== 'object') return;
    const controls = saved.controls && typeof saved.controls === 'object' ? saved.controls : {};
    BASE_CONTROL_IDS.forEach((id) => {
      if (Object.prototype.hasOwnProperty.call(controls, id)) writeControl(id, controls[id]);
    });
    if (saved.layout) window.NeuroProfileLayoutController?.setState?.(saved.layout);
    if (saved.colors) {
      const preset = saved.colors.preset;
      if (preset && preset !== 'custom') window.NeuroProfileColorController?.setPreset?.(preset);
      else window.NeuroProfileColorController?.setColors?.(saved.colors.values, 'custom');
    }
    if (saved.typography) setTypography(saved.typography);
    applyHoverState(saved.hoverEnabled !== false);
    scheduleFigureApply();
  }

  function loadSavedSettings() {
    const store = storage();
    if (!store) return;
    const raw = store.getItem(STORAGE_KEY);
    if (!raw) return;
    try {
      applySettings(JSON.parse(raw));
      setSaveStatus('Saved settings loaded.');
    } catch {
      store.removeItem(STORAGE_KEY);
      setSaveStatus('Saved settings were reset.');
    }
  }

  function defaultSettings() {
    return {
      controls: {
        showSubtitle: false,
        showIndividuals: false,
        showProfileMean: true,
        showAveragePercentile: false,
        showLegend: true,
        showRangeLegend: true,
        showDomainAverageLegend: true,
        showTestScoreLegend: true,
        showAssessmentLegend: true,
        showNotes: false,
        showChangeIndicators: true,
        changeThreshold: '1.5',
      },
      layout: {
        axisMetric: 'percentile', percentileSpacing: 'linear', plotScale: 100,
        autoDomainWidth: true, domainWidth: 255, autoScoreWidth: true, scoreWidth: 150,
        autoChangeWidth: true, changeWidth: 150, domainAlign: 'left', scoreAlign: 'right',
        changeAlign: 'center', columnGap: 22,
      },
      colors: { preset: 'clinical', values: null },
      typography: { fontKey: 'arial', sizes: { ...DEFAULT_SIZES } },
      hoverEnabled: true,
    };
  }

  function resetSavedSettings() {
    storage()?.removeItem(STORAGE_KEY);
    applySettings(defaultSettings());
    setSaveStatus('Default settings restored.');
  }

  function buildSavedSettings() {
    if (document.getElementById('np012-saved-settings')) return;
    const details = document.createElement('details');
    details.id = 'np012-saved-settings';
    details.className = 'np012-saved-settings';
    const summary = document.createElement('summary');
    summary.textContent = 'Saved settings';
    const body = document.createElement('div');
    body.className = 'np012-saved-body';
    const actions = document.createElement('div');
    actions.className = 'np012-saved-actions';
    const save = document.createElement('button');
    save.type = 'button';
    save.className = 'btn btn-primary';
    save.textContent = 'Save settings';
    save.addEventListener('click', saveSettings);
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'btn';
    reset.textContent = 'Restore defaults';
    reset.addEventListener('click', resetSavedSettings);
    saveStatus = document.createElement('p');
    saveStatus.className = 'np012-save-status';
    saveStatus.setAttribute('aria-live', 'polite');
    actions.append(save, reset);
    body.append(actions, saveStatus);
    details.append(summary, body);
    const color = document.getElementById('np011-color-settings');
    if (color) color.insertAdjacentElement('afterend', details);
    else displayCard()?.appendChild(details);
  }

  function init() {
    buildHoverToggle();
    buildTypographySettings();
    buildSavedSettings();
    buildTheaterControls();
    installHoverInterception();
    applyHoverState(true);
    loadSavedSettings();
    scheduleFigureApply();
  }

  window.NeuroProfileTypographyController = Object.freeze({
    applyBeforeLayout,
    applyAfterLayout,
    getState: () => ({ fontKey: state.fontKey, sizes: { ...state.sizes } }),
    setState: setTypography,
    reset: resetTypography,
  });
  window.NeuroProfileHoverController = Object.freeze({
    enabled: () => state.hoverEnabled,
    setEnabled: applyHoverState,
  });
  window.NeuroProfileSettingsController = Object.freeze({
    save: saveSettings,
    load: loadSavedSettings,
    reset: resetSavedSettings,
    snapshot: snapshotSettings,
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
