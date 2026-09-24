/**
 * @NApiVersion 2.0
 * @NModuleScope SameAccount
 */
define([], function () {
  'use strict';

  // nsentrydialog - a standalone entry-dialog for editing a plain `data`
  // object. Extracted and adapted from the gantt task editor, then reworked
  // into an nsd/EntryDialog API. Public API is
  // `create(formLayout, data, callbacks)` returning the full merged object.

  const MODULE_NAME = 'nsentrydialog';
  const STYLE_ID = 'nsentrydialog-plugin-styles';
  const EDITOR_COLUMN_WIDTH = 350;
  const FIELD_COLUMN_PADDING = 8; // .nsd-field-col horizontal padding (shared with the action bar alignment)
  const DEFAULT_GRID_COLUMNS = 1; // used when formLayout.columns is omitted
  const TABLE_COLUMN_MIN_WIDTH = 120; // floor for width-less table columns so they never crush
  let instanceCounter = 0;

  // Vertical scrollbar width of the current environment (cached after first
  // measure). Used to widen .nsd-editor-fields so its fixed-px grid always has
  // the full columns*EDITOR_COLUMN_WIDTH available even when a scrollbar shows.
  let _nsdScrollbarWidth = null;
  function measureScrollbarWidth() {
    if (_nsdScrollbarWidth != null) return _nsdScrollbarWidth;
    if (typeof document === 'undefined' || !document.body) return (_nsdScrollbarWidth = 0);
    const probe = document.createElement('div');
    probe.style.cssText = 'position:absolute;left:-9999px;top:-9999px;width:50px;height:50px;overflow:scroll;visibility:hidden;';
    document.body.appendChild(probe);
    _nsdScrollbarWidth = probe.offsetWidth - probe.clientWidth;
    document.body.removeChild(probe);
    return _nsdScrollbarWidth;
  }

  function safeLog(method, title, details) {
    try {
      const c = typeof console !== 'undefined' ? console : null;
      if (!c) return;
      const fn = c[method] && typeof c[method] === 'function' ? c[method].bind(c) : c.log.bind(c);
      if (details !== undefined) fn(`[${title}]`, details);
      else fn(`[${title}]`);
    } catch (e) {
      // no-op
    }
  }

  function toLocalDateStr(date) {
    const d = new Date(date);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function parseZoneDate(value) {
    if (value instanceof Date) return value;
    if (typeof value === 'string') {
      const m = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
      if (m) return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
    }
    return new Date(value);
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  const SAFE_COLOR_RE =
    /^(#[0-9a-fA-F]{3,8}|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(,\s*[\d.]+\s*)?\)|hsla?\(\s*\d{1,3}\s*,\s*\d{1,3}%?\s*,\s*\d{1,3}%?\s*(,\s*[\d.]+\s*)?\)|transparent|inherit|currentcolor)$/i;

  function sanitizeColor(value) {
    if (!value) return '';
    const str = String(value).trim();

    // Reject if too long or contains semicolons (CSS injection vector)
    if (str.length > 50 || str.indexOf(';') !== -1) {
      return '';
    }

    return SAFE_COLOR_RE.test(str) ? str : '';
  }

  // Deep clone for the modal's base-data snapshot (supports Date + nested
  // structures). Used by create() for the discard value object. The copied
  // editor code does not use this; it is modal-specific.
  function deepClone(o) {
    if (o == null) return o;
    if (Array.isArray(o))
      return o.map(function (x) {
        return deepClone(x);
      });
    if (o instanceof Date) return new Date(o.getTime());
    if (typeof o === 'object') {
      const out = {};
      for (let k in o) if (Object.prototype.hasOwnProperty.call(o, k)) out[k] = deepClone(o[k]);
      return out;
    }
    return o;
  }

  // Inline SVG close (X) icon, shared by the editor title-bar close button and
  // the tag-chip remove affordance. Same 30x30 glyph as nsprogressdialog;
  // fill="currentColor" lets each host element's color/opacity drive it. Sized
  // entirely via CSS (the .nsd-close-ico rules), so it carries no width/height.
  const CLOSE_ICO_SVG = `<svg class="nsd-close-ico" fill="currentColor" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 30"><path d="M 7 4 C 6.744125 4 6.4879687 4.0974687 6.2929688 4.2929688 L 4.2929688 6.2929688 C 3.9019687 6.6839688 3.9019687 7.3170313 4.2929688 7.7070312 L 11.585938 15 L 4.2929688 22.292969 C 3.9019687 22.683969 3.9019687 23.317031 4.2929688 23.707031 L 6.2929688 25.707031 C 6.6839688 26.098031 7.3170313 26.098031 7.7070312 25.707031 L 15 18.414062 L 22.292969 25.707031 C 22.682969 26.098031 23.317031 26.098031 23.707031 25.707031 L 25.707031 23.707031 C 26.098031 23.316031 26.098031 22.682969 25.707031 22.292969 L 18.414062 15 L 25.707031 7.7070312 C 26.098031 7.3170312 26.098031 6.6829688 25.707031 6.2929688 L 23.707031 4.2929688 C 23.316031 3.9019687 22.682969 3.9019687 22.292969 4.2929688 L 15 11.585938 L 7.7070312 4.2929688 C 7.5115312 4.0974687 7.255875 4 7 4 z"></path></svg>`;

  // Read-only checkbox glyphs (carbon checked--filled box, interface unchecked
  // outline). fill/stroke use currentColor so each host element's color drives
  // them; sized entirely via CSS (.nsd-readonly-check rules).
  const CHK_ICO_SVG = `<svg class="nsd-readonly-check" fill="currentColor" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><path d="M26,4H6A2,2,0,0,0,4,6V26a2,2,0,0,0,2,2H26a2,2,0,0,0,2-2V6A2,2,0,0,0,26,4ZM14,21.5,9,16.5427,10.5908,15,14,18.3456,21.4087,11l1.5918,1.5772Z"/></svg>`;
  const UNCHK_ICO_SVG = `<svg class="nsd-readonly-check" fill="none" stroke="currentColor" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M4 7.2V16.8C4 17.92 4 18.48 4.218 18.908C4.41 19.284 4.715 19.59 5.092 19.782C5.519 20 6.079 20 7.197 20H16.803C17.921 20 18.48 20 18.907 19.782C19.284 19.59 19.59 19.284 19.782 18.908C20 18.481 20 17.922 20 16.804V7.197C20 6.079 20 5.519 19.782 5.092C19.59 4.715 19.284 4.41 18.907 4.218C18.48 4 17.92 4 16.8 4H7.2C6.08 4 5.52 4 5.092 4.218C4.715 4.41 4.41 4.715 4.218 5.092C4 5.52 4 6.08 4 7.2Z" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

  // Cached source node for _closeIcon(); callers always receive a clone, so the
  // cache stays valid across editor teardown/reopen.
  let _closeSvg = null;

  function _buildCloseSvg() {
    const wrap = document.createElement('span');
    wrap.innerHTML = CLOSE_ICO_SVG;
    return wrap.children[0];
  }

  function _closeIcon() {
    if (!_closeSvg) _closeSvg = _buildCloseSvg();
    return _closeSvg.cloneNode(true);
  }

  const ENTRY_DIALOG_CSS = `
    :root {
      --warn-red: #b91c1c;
      --warn-yellow: #f59e0b;
      --theme: #607799;
      --accent: #0067a0;
      --accent-dark: #004e7a;
      --accent-bg: rgba(0,103,160,.08);
      --code-bg: #eef1f6;
      --border: #c8cdd3;
      --border-light: #e0e0e0;
      --text: #54585e;
      --text-h: #1a1e26;
      --sans: system-ui, -apple-system, Arial, sans-serif;
      font-family: var(--sans);
    }
    .nsd-btn { padding: 6px 16px; border: none; border-radius: 4px; cursor: pointer; font-size: 12px; font-weight: 600; transition: background 0.2s ease; min-width: 76px; box-sizing: border-box; }
    .nsd-btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    .nsd-btn-primary { background: var(--accent); color: white; }
    .nsd-btn-primary:hover { background: var(--accent-dark); }
    .nsd-btn-secondary { background: white; color: var(--text-h); border: 1px solid var(--border); }
    .nsd-btn-secondary:hover { background: #f5f5f5; }
    .nsd-editor { position: fixed; z-index: 2000; background: white; border-radius: 6px; box-shadow: 0 4px 12px rgba(0,0,0,.15); padding: 12px; min-width: 250px; font-family: var(--sans); max-height: calc(90vh - 40px); display: flex; flex-direction: column; }
    .nsd-modal-backdrop { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,.35); z-index: 1999; }
    .nsd-editor-header { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 12px; margin: -12px -12px 12px; background: var(--theme); border-bottom: 1px solid var(--border-light); border-radius: 6px 6px 0 0; font-size: 12px; font-weight: 600; color: var(--text-h); cursor: move; user-select: none; }
    .nsd-editor-controls { display: flex; gap: 6px; flex: none; }
    .nsd-editor-title { font-size: 12px; font-weight: 600; color: white; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .nsd-editor-close { width: 24px; height: 24px; padding: 2px 2px; border-radius: 0; border: 1px solid transparent; background: transparent; color: white; font-size: 16px; line-height: 1; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: background .15s, border-color .15s; }
    .nsd-editor-close:hover { background: var(--code-bg); border-color: var(--border); color: var(--text-h); }
    .nsd-editor-close .nsd-close-ico { width: 12px; height: 12px; display: block; }
    .nsd-editor-label { display: block; font-size: 12px; color: var(--accent); margin-bottom: 2px; text-transform: uppercase; }
    .nsd-number-field { text-align: right; }
    .nsd-editor-field:not(textarea) { height: 32px; box-sizing: border-box; }
    .nsd-editor-fields { flex: 1 1 auto; overflow-y: auto; min-height: 0; }
    .nsd-editor-row-break { flex-basis: 100%; width: 0; height: 0; }
    .nsd-checkbox { display: flex; align-items: center; gap: 6px; font-size: 9pt; }
    .nsd-checkbox-group { display: flex; flex-direction: column; margin: 2px 0; font-size: 9pt; }
    .nsd-cg-item { flex: 1 1 100%; display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-h); }
    .nsd-field-readonly.nsd-cg-item { gap: 6px; }
    .nsd-readonly-check { width: 14px; height: 14px; display: inline-block; vertical-align: middle; flex: none; }
    .nsd-cg-item .nsd-readonly-check { width: 14px; height: 14px; }
    .nsd-checkbox-input { margin: 2px 0; }
    .nsd-table-row.active .nsd-table-cell:has(.nsd-table-checkbox) { padding: 0; display: flex; align-items: center; justify-content: center; }
    .nsd-table-checkbox { height: 35px; margin: 2px 0; }
    .nsd-editor-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 8px; flex: 0 0 auto; }
    .nsd-tag-input-wrapper { position: relative; }
    .nsd-select-label { font-size: 12px; color: var(--text-h); padding: 2px 4px; flex: 1; }
    .nsd-single-select .nsd-select-label { min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .nsd-field-readonly { display: inline-flex; align-items: center; flex-wrap: wrap; gap: 4px; width: 100%; min-height: 32px; box-sizing: border-box; padding-left: 0; }
    .nsd-tag-input { display: flex; flex-wrap: wrap; gap: 4px; padding: 4px; border: 1px solid var(--border); border-radius: 4px; cursor: pointer; box-sizing: border-box; background: white; align-items: center; min-height: 32px; }
    .nsd-tag-input:focus-within { outline: 2px solid var(--accent); outline-offset: -1px; }
    .nsd-tag-chip { display: inline-flex; align-items: center; gap: 4px; padding: 2px 6px; background: var(--accent-bg); border-radius: 3px; font-size: 11px; color: var(--accent-dark); font-weight: 600; white-space: nowrap; }
    .nsd-tag-chip-text { position: relative; top: -1px; }
    .nsd-tag-chip-remove { cursor: pointer; font-size: 12px; line-height: 1; opacity: 0.6; margin-left: 2px; }
    .nsd-tag-chip .nsd-tag-chip-remove { align-self: center; }
    .nsd-tag-chip-remove:hover { opacity: 1; }
    .nsd-tag-chip-remove .nsd-close-ico { width: 10px; height: 10px; display: block; }
    .nsd-tag-placeholder { color: #999; font-size: 12px; padding: 2px 4px; }
    .nsd-tag-dropdown { position: absolute; z-index: 1000; background: white; border: 1px solid var(--border); border-radius: 4px; box-shadow: 0 4px 12px rgba(0,0,0,.15); max-height: 200px; overflow-y: auto; min-width: 200px; left: 0; right: 0; }
    .nsd-tag-option { display: flex; align-items: center; gap: 8px; padding: 6px 10px; cursor: pointer; font-size: 12px; color: var(--text-h); }
    .nsd-tag-option:hover { background: var(--accent-bg); }
    .nsd-tag-option.selected { background: var(--accent-bg); font-weight: 600; }
    .nsd-tag-option.disabled { opacity: 0.5; cursor: default; pointer-events: none; }
    .nsd-field-required { color: #ef4444; }
    .nsd-field-invalid { outline: 2px solid #ef4444; border-radius: 4px; }
    .nsd-date-wrapper { position: relative; display: inline-block; width: 100%; }
    .nsd-date-wrapper input[type="date"], .nsd-date-wrapper input[type="datetime-local"] { width: 100%; box-sizing: border-box; }
    .nsd-date-wrapper input[type="date"]::-webkit-calendar-picker-indicator,
    .nsd-date-wrapper input[type="datetime-local"]::-webkit-calendar-picker-indicator {
      position: absolute; inset: 0; width: 100%; height: 100%;
      opacity: 0; cursor: pointer; margin: 0; padding: 0;
    }
    .nsd-date-icon { position: absolute; right: 6px; top: 50%; transform: translateY(-50%); pointer-events: none; }
    .nsd-table-field { border: 1px solid var(--border); border-radius: 4px; margin-top: 2px; overflow: visible; }
    .nsd-table-scroll { overflow-x: auto; overflow-y: auto; }
    .nsd-table-header { position: sticky; top: 0; z-index: 1; }
    .nsd-table-header .nsd-table-cell { background: var(--code-bg); border-bottom: 1px solid var(--border); font-size: 11px; font-weight: 700; color: var(--text-h); text-transform: uppercase; padding: 3px 12px; }
    .nsd-table-header .nsd-table-cell:first-child { border-radius: 3px 0 0 0; }
    .nsd-table-header .nsd-table-cell:last-child { border-radius: 0 3px 0 0; }
    .nsd-table-row { display: flex; align-items: center; }
    .nsd-table-row-cells { display: flex; align-items: center; }
    .nsd-table-rows .nsd-table-row:not(.active) .nsd-table-row-cells { flex: 1 1 0; }
    .nsd-table-rows .nsd-table-row { border-bottom: 1px solid var(--border-light); cursor: pointer; }
    .nsd-table-rows .nsd-table-row:hover:not(.active) .nsd-table-cell { background: rgba(0,103,160,.06); }
    .nsd-table-field.nsd-table-readonly .nsd-table-row { cursor: default; }
    .nsd-table-field.nsd-table-readonly .nsd-table-row:hover:not(.active) .nsd-table-cell { background: none; }
    .nsd-table-rows .nsd-table-row.active { flex-direction: column; align-items: stretch; }
    .nsd-table-rows .nsd-table-row.active .nsd-table-cell { background: white; }
    .nsd-table-rows .nsd-table-row:last-child { border-bottom: none; }
    .nsd-table-cell { min-width: 0; padding: 3px 4px; box-sizing: border-box; font-size: 12px; }
    .nsd-table-static { display: inline-block; width: 100%; padding: 0 8px; box-sizing: border-box; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .nsd-table-rows .nsd-table-row.active .nsd-table-static { height: 35px; line-height: 32px; margin: -3px 0; }
    .nsd-table-row-actions { display: flex; justify-content: flex-start; align-items: flex-start; gap: 6px; padding: 0 4px 4px 4px; box-sizing: border-box; background: var(--code-bg); border-top: 1px solid var(--border); }
    .nsd-table-row-actions-box { display: inline-flex; align-items: center; gap: 6px; padding: 4px 6px; background: white; border: 1px solid var(--border); border-top: none; border-radius: 0 0 4px 4px; }
    .nsd-table-add-row { text-align: center; padding: 5px; font-size: 12px; color: var(--accent); cursor: pointer; border-top: 1px dashed var(--border); border-radius: 0 0 3px 3px; }
    .nsd-table-empty { padding: 8px 12px; font-size: 12px; color: var(--text); font-style: italic; }
    .nsd-table-add-row:hover { background: var(--accent-bg); }
    .nsd-summary-warn { font-size: 11px; color: #ef4444; padding: 2px 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: help; max-width: 100%; }
    .nsd-tag-option-name { min-width: 0; }
    .nsd-tag-option-name.is-conflict { color: #ef4444; font-weight: 600; }
    .nsd-tag-search { width: 100%; padding: 6px 8px; font-size: 12px; border: none; border-bottom: 1px solid var(--border); box-sizing: border-box; outline: none; background: transparent; }
    .nsd-tag-search:focus { border-bottom-color: var(--accent); }
    .nsd-tag-no-results { padding: 12px 8px; font-size: 12px; color: #999; text-align: center; }
    .nsd-tooltip { position: fixed; background: white; color: var(--text-h); padding: 12px; border-radius: 6px; font-size: 12px; pointer-events: none; z-index: 3000; box-shadow: 0 4px 12px rgba(0,0,0,.3); min-width: 200px; border: 1px solid var(--border); }
    .nsd-tooltip.is-warn, .nsd-tooltip.is-warn-yellow { min-width: 0; max-width: 320px; color: #fff; }
    .nsd-tooltip.is-warn { background: var(--warn-red); border-color: var(--warn-red); }
    .nsd-tooltip.is-warn-yellow { background: var(--warn-yellow); border-color: var(--warn-yellow); }
  `;

  function injectCss() {
    if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) {
      return;
    }
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.type = 'text/css';
    style.appendChild(document.createTextNode(ENTRY_DIALOG_CSS));
    document.head.appendChild(style);
  }

  // Modal-specific editor host. Stands in for the original plugin instance so
  // the copied editor methods below run against a standalone object instead of a
  // chart. It carries exactly the chart state members the editor touches, plus
  // the modal hooks (_pendingResult / _torn). $ is the page's jQuery; the
  // editor/backdrop mount on document.body (position:fixed).
  function EntryDialog(options, $) {
    this.$ = $;
    this.$el = $(document.body);
    this.id = `nsentrydialog-${++instanceCounter}`;
    this.ns = `.nsd.${this.id}`;
    this.options = options || {};

    // Editor state members (mirrors the chart's editor state).
    this._$editor = null;
    this._$backdrop = null;
    this._currentData = null;
    this._dataId = null;
    this._activeFormLayout = null;
    this._editorDirty = false;
    this._editorValues = {};
    this._snapshotCache = null;
    this._fieldChangeVisited = null;
    this._saving = false;

    // Guard flags for document/window handler registration (registered once).
    this._editorEscHandler = false;
    this._editorResizeHandler = false;
    this._editorDragHandler = false;
    this._tagInputDocHandler = false;
    this._tagTooltipDocHandler = false;
    this._editorDragState = null;

    // Modal hooks.
    this._pendingResult = null;
    this._torn = false;
    // create()-supplied customization (formLayout.title / formLayout.buttons).
    this._title = null;
    this._buttons = null;
    // Result code to emit from a commit; set by a custom button click so the
    // shared save pipeline emits that button's code instead of the default 1.
    this._saveEditorResult = null;

    // The editor's option-hint / summary warn tooltip (copied _$showWarnTooltip
    // expects this element, created exactly as the chart does).
    this.$warnTooltip = this.$(
      `<div class="nsd-tooltip is-warn" id="${this.id}-warn-tooltip" style="display:none;"></div>`
    ).appendTo(document.body);
  }

  EntryDialog.prototype.buildEditor = function () {
    if (this._$editor) return;

    const self = this;
    this._$editor = this.$(
      `<div class="nsd-editor" id="${this.id}-editor" style="display:none;">\t\t<div class="nsd-editor-header"><span class="nsd-editor-title"></span><div class="nsd-editor-controls"><button type="button" class="nsd-editor-close" title="Close" aria-label="Close"></button></div></div>\t\t<div class="nsd-editor-fields"></div>\t\t<div class="nsd-editor-actions"></div>\t</div>`
    ).appendTo(this.$el);

    // Icon-only close button; title/aria-label carry the accessible name.
    this._$editor.find('.nsd-editor-close').append(_closeIcon());

    // Modal backdrop below the editor, above the chart (z-index 1999/2000)
    this._$backdrop = this.$(
      `<div class="nsd-modal-backdrop" id="${this.id}-editor-backdrop" style="display:none;"></div>`
    ).appendTo(this.$el);

    // Dirty tracking: any user input in the editor marks unsaved changes. The
    // programmatic .val() writes (e.g. date recomputes) never fire events, so
    // they cannot false-positive.
    this._$editor.on(`input${this.ns} change${this.ns}`, 'input, select, textarea, .nsd-tag-input', function () {
      self._editorDirty = true;
    });

    // Enforce an optional per-group max selection cap: checking past the cap
    // snaps the extra box back off. Unchecking is always allowed. No cap when
    // data-max is unset / 0 / non-positive.
    this._$editor.on(`change${this.ns}`, '.nsd-checkbox-group .nsd-cb-group-item', function (e) {
      const $group = self.$(this).closest('.nsd-checkbox-group');
      const max = parseInt($group.data('max'), 10);
      if (!(max > 0)) return; // no cap (undefined / 0 / NaN)
      if (self.$(this).prop('checked') && $group.find('.nsd-cb-group-item:checked').length > max) {
        self.$(this).prop('checked', false); // reject over-selection, snap back
      }
    });

    // Title-bar close (x): a dismiss affordance - prompts on unsaved changes
    // like ESC/backdrop, and reports the same empty discard as the others.
    this._$editor.on('click', '.nsd-editor-close', function (e) {
      e.stopPropagation();
      self._requestClose(null);
    });

    // Table field (sublist-style): click a read-only row to activate it for
    // editing; OK commits, Cancel discards, Remove deletes the active line.
    this._$editor.on('click', '.nsd-table-rows .nsd-table-row', function (e) {
      // Ignore clicks on the row's own inputs/buttons/dropdowns/actions
      if (
        self.$(e.target).closest('input, select, button, .nsd-tag-input, .nsd-tag-dropdown, .nsd-table-row-actions')
          .length
      ) {
        return;
      }
      const $row = self.$(this);
      const cfg = self._getTableConfig($row);
      if (
        cfg.field &&
        (cfg.field.readonly === true || (self._activeFormLayout && self._activeFormLayout.view === true))
      )
        return; // static table
      // Already editing this row: clicking a non-input cell must not re-render
      // it (rebuilding would reset uncommitted typed values).
      if ($row.hasClass('active')) return;
      // Switching lines: auto-commit the previous line's entered values (like
      // pressing OK); a fully-blank added row is removed instead
      const $active = self._$editor.find('.nsd-table-rows .nsd-table-row.active').first();
      if ($active.length && !$active.is($row)) {
        const read = self._readTableRowInputs($active, self._getTableConfig($active).columns);
        if (!read.anyValue) {
          $active.remove(); // blank added row: discard entirely
        } else if (self._commitTableRow($active) === 'invalid') {
          return; // stay on the invalid row so the user can fix or cancel
        }
      }
      self._rerenderTableRow($row, true);
    });

    this._$editor.on('click', '.nsd-table-row-ok', function (e) {
      e.stopPropagation();
      const $row = self.$(this).closest('.nsd-table-row');
      self._commitTableRow($row);
    });

    this._$editor.on('click', '.nsd-table-row-cancel', function (e) {
      e.stopPropagation();
      const $row = self.$(this).closest('.nsd-table-row');
      // A never-committed row is discarded entirely; a committed row reverts to
      // its last committed values
      const activeVal = self._readTableRowValue($row);
      const hasValue = Object.keys(activeVal).some(function (k) {
        return activeVal[k] !== undefined && activeVal[k] !== '';
      });
      if (!hasValue) {
        $row.remove();
      } else {
        self._rerenderTableRow($row, false);
      }
    });

    this._$editor.on('click', '.nsd-table-row-remove', function (e) {
      e.stopPropagation();
      const $field = self.$(this).closest('.nsd-table-field');
      self.$(this).closest('.nsd-table-row').remove();
      self._editorDirty = true;
      self._$editor.find('.nsd-field-invalid').removeClass('nsd-field-invalid');
      if ($field.length) self._dispatchTableFieldChange($field.data('field-name'));
    });

    this._$editor.on('click', '.nsd-table-add-row', function (e) {
      e.stopPropagation();
      const $field = self.$(this).closest('.nsd-table-field');
      if (!$field.length) return;
      const fieldName = $field.data('field-name');
      const layoutField = (
        self._activeFormLayout && Array.isArray(self._activeFormLayout.fields) ? self._activeFormLayout.fields : []
      ).find(function (f) {
        return f && f.name === fieldName;
      });
      // Switching lines: auto-commit the previous line's entered values (like
      // pressing OK); a fully-blank added row is removed instead
      const $active = self._$editor.find('.nsd-table-rows .nsd-table-row.active').first();
      if ($active.length) {
        const read = self._readTableRowInputs($active, self._getTableConfig($active).columns);
        if (!read.anyValue) {
          $active.remove(); // blank added row: discard entirely
        } else if (self._commitTableRow($active) === 'invalid') {
          return; // stay on the invalid row so the user can fix or cancel
        }
      }
      const nextIndex = $field.find('.nsd-table-rows .nsd-table-row').length;
      let initEntry = null;
      if (layoutField && typeof layoutField.rowInit === 'function') {
        const rowCtx = self._buildCtx({ table: fieldName, rowIndex: nextIndex, value: {} });
        try {
          const initObj = layoutField.rowInit(rowCtx) || {};
          if (initObj && typeof initObj === 'object' && Object.keys(initObj).length) initEntry = initObj;
        } catch (err) {
          safeLog('error', `${MODULE_NAME}:rowInit`, (err && err.message) || err);
        }
      }
      $field
        .find('.nsd-table-rows')
        .append(
          self._buildTableRowHtml((layoutField && layoutField.columns) || [], initEntry, layoutField, true, nextIndex)
        );
      self._editorDirty = true;
      self._$editor.find('.nsd-field-invalid').removeClass('nsd-field-invalid');
    });

    // Scrolling the table closes any open table-cell dropdown (position goes stale)
    this._$editor.on(`scroll${this.ns}`, '.nsd-table-scroll', function () {
      self._$editor.find('.nsd-tag-dropdown:visible').hide();
    });
    // Scrolling the fields area (only the fields scroll) also closes viewport-fixed dropdowns
    this._$editor.on(`scroll${this.ns}`, '.nsd-editor-fields', function () {
      self._$editor.find('.nsd-tag-dropdown:visible').hide();
    });

    this._$backdrop.on('click', function () {
      self._requestClose();
    });

    // ESC closes the editor (with dirty protection) or dismisses a visible dropdown
    if (!this._editorEscHandler) {
      this._editorEscHandler = true;
      this.$(document).on(`keydown${this.ns}-esc`, function (e) {
        if (e.key === 'Escape' || e.keyCode === 27) {
          if (self._$editor && self._$editor.find('.nsd-tag-dropdown:visible').length) {
            self._$editor.find('.nsd-tag-dropdown:visible').hide();
            return;
          }
          if (self._$editor && self._$editor.is(':visible')) {
            self._requestClose();
          }
        }
      });
    }

    // Keep the modal centered on window resize
    if (!this._editorResizeHandler) {
      this._editorResizeHandler = true;
      this.$(window).on(`resize${this.ns}-editor`, function () {
        if (self._$editor && self._$editor.is(':visible')) self._centerEditor();
      });
    }

    // Drag the modal by its title bar (close button excluded); dropdowns close
    // because their fixed positions would go stale as the modal moves
    this._$editor.on(`mousedown${this.ns}`, '.nsd-editor-header', function (e) {
      if (e.button !== 0) return;
      if (self.$(e.target).closest('.nsd-editor-close').length) return;
      if (!self._$editor.is(':visible')) return;
      self._$editor.find('.nsd-tag-dropdown:visible').hide();
      self._editorDragState = {
        startX: e.clientX,
        startY: e.clientY,
        startLeft: parseFloat(self._$editor.css('left')) || 0,
        startTop: parseFloat(self._$editor.css('top')) || 0,
      };
      e.preventDefault(); // avoid text selection while dragging
    });
    if (!this._editorDragHandler) {
      this._editorDragHandler = true;
      this.$(document).on(`mousemove${this.ns}-editor-drag`, function (e) {
        const st = self._editorDragState;
        if (!st) return;
        self._$editor.css({
          left: `${st.startLeft + (e.clientX - st.startX)}px`,
          top: `${st.startTop + (e.clientY - st.startY)}px`,
        });
      });
      this.$(document).on(`mouseup${this.ns}-editor-drag`, function () {
        self._editorDragState = null;
      });
    }

    // ---- Editor-level behaviors (delegated, bound once) ----

    // Single-select: click display area to toggle dropdown
    this._$editor.on('click', '.nsd-single-select .nsd-tag-input', function () {
      const $wrapper = self.$(this).closest('.nsd-tag-input-wrapper');
      const $dropdown = $wrapper.find('.nsd-tag-dropdown');
      self._$editor.find('.nsd-tag-dropdown').not($dropdown).hide();
      const $search = $dropdown.find('.nsd-tag-search');
      $dropdown.toggle();
      if ($dropdown.is(':visible')) {
        // Position the dropdown (downward by default, flip up on the editor
        // popup's bottom edge), clamped within the popup. Fixed positioning
        // escapes scroll/clip containers, so opening never adds a scrollbar or
        // shifts the field layout.
        self._positionDropdown($wrapper, $dropdown);
        $search.focus();
        $dropdown.find('.nsd-tag-option').show();
      }
    });

    // Single-select: option click selects (disabled rows are rejected; the
    // label is read from data-label so the hint glyph never leaks into it)
    this._$editor.on('click', '.nsd-single-select .nsd-tag-option', function () {
      const $option = self.$(this);
      if ($option.hasClass('disabled')) return; // disabled option can't be picked
      const val = $option.data('val');
      const label = $option.data('label') || $option.text();
      const $wrapper = $option.closest('.nsd-tag-input-wrapper');
      const $hidden = $wrapper.find('.nsd-select-value');
      if (String($hidden.val()) !== String(val)) {
        $hidden.val(val).trigger('change');
      }
      $wrapper.find('.nsd-select-label').text(label);
      $wrapper.find('.nsd-tag-option').removeClass('selected');
      $option.addClass('selected');
      $wrapper.find('.nsd-tag-dropdown').hide();
    });

    // Single-select: search filter in dropdown
    this._$editor.on('input', '.nsd-single-select .nsd-tag-search', function () {
      const $input = self.$(this);
      const $dropdown = $input.closest('.nsd-tag-dropdown');
      const q = $input.val().toLowerCase();
      $dropdown.find('.nsd-tag-option').each(function () {
        self.$(this).toggle((self.$(this).data('label') || self.$(this).text()).toLowerCase().indexOf(q) !== -1);
      });
    });

    // ---- Generic field-change dispatch (editor) ----
    // Every user edit flows through _onUserFieldChange: normalize + store the
    // value, auto re-resolve dependent options (with stale pruning), refresh
    // summaries, then fire the field's declared onChange.
    // Single-select (incl. machine) picks write the hidden .nsd-select-value
    // and fire `change` on it (see the single-select option-click handler).
    this._$editor.on(`change${this.ns}-field`, '.nsd-select-value[data-field-name]', function () {
      const $hidden = self.$(this);
      const fieldName = $hidden.data('field-name');
      if (fieldName) self._onUserFieldChange(fieldName, $hidden.val());
    });
    // Multi-select chips: the wrapper fires the custom `fieldchange` event after
    // a chip add/remove syncs the hidden value (see _initTagInputs).
    this._$editor.on(`fieldchange${this.ns}-field`, '.nsd-tag-input-wrapper[data-field-name]', function () {
      const $wrapper = self.$(this);
      const fieldName = $wrapper.data('field-name');
      if (!fieldName) return;
      let vals = [];
      try {
        vals = JSON.parse($wrapper.find('.nsd-tag-value').val() || '[]');
      } catch (e) {
        vals = [];
      }
      self._onUserFieldChange(fieldName, vals);
    });
    // text / textarea / number / date / datetime: commit-time (change/blur).
    this._$editor.on(
      `change${this.ns}-field`,
      'input.nsd-editor-field[data-field-name], textarea.nsd-editor-field[data-field-name]',
      function () {
        const fieldName = self.$(this).data('field-name');
        if (fieldName) self._onUserFieldChange(fieldName, self.$(this).val());
      }
    );
    // checkbox
    this._$editor.on(`change${this.ns}-field`, '.nsd-checkbox-input[data-field-name]', function () {
      const fieldName = self.$(this).data('field-name');
      if (fieldName) self._onUserFieldChange(fieldName, self.$(this).prop('checked'));
    });
    // checkbox-group (committed values; data-max cap enforcement above)
    this._$editor.on(`change${this.ns}-field`, '.nsd-cb-group-item', function () {
      const $group = self.$(this).closest('.nsd-checkbox-group');
      const fieldName = $group.data('field-name');
      if (!fieldName) return;
      const vals = [];
      $group.find('.nsd-cb-group-item:checked').each(function () {
        vals.push(self.$(this).data('val'));
      });
      self._onUserFieldChange(fieldName, vals);
    });

    // Format number fields on blur, show raw on focus
    this._$editor.on('focus', '.nsd-number-field', function () {
      const $input = self.$(this);
      const raw = $input.val().replace(/,/g, '');
      $input.val(raw);
    });

    this._$editor.on('blur', '.nsd-number-field', function () {
      const $input = self.$(this);
      const raw = $input.val();
      if (raw === '' || raw == null) {
        $input.val('');
        return;
      }
      const numType = $input.attr('data-numtype') || 'decimal';
      const field = numType === 'currency' ? { decimalPlaces: $input.attr('data-decimal-places') } : null;
      const parsed = self._parseNumber(raw, numType, field);
      $input.val(parsed === '' ? '' : self._formatNumber(parsed, numType, field));
    });

    // Format time fields on blur (decimal hours or HH:MM am/pm -> display)
    this._$editor.on('blur', '.nsd-time-field', function () {
      const $input = self.$(this);
      const raw = $input.val();
      if (raw === '' || raw == null) {
        $input.val('');
        return;
      }
      const field = self._timeFieldFromInput($input);
      const parsed = self._parseTime(raw, field);
      $input.val(parsed === '' ? '' : self._formatTime(parsed, field));
    });

    // Live per-cell table validation: a column's validate runs the moment a cell
    // is edited (not just on OK). Invalid edits silently revert + flag the row.
    this._$editor.on('change', '.nsd-table-cell input, .nsd-table-cell select, .nsd-table-cell textarea', function () {
      self._validateTableCellLive(self.$(this));
    });
  };

  /**
   * Open the modal editor. The formLayout is declared by the caller at the
   * call site; each field descriptor supports the standard rendering keys plus
   * the generic binding keys:
   *   options:   ({getValue}) => [...] - resolved at editor open and
   *              afterwards ONLY when a declared onChange calls
   *              reloadOptions('<field>') - no automatic re-resolve.
   *              Filtering is plain logic inside the function closing over
   *              the outer host/context and reading live values via
   *              getValue('field').
   *   A reloadOptions rebuild always clears the field's selection first
   *              ('' for select/machine, [] for multi-select) - a changed
   *              dependency empties the field, cascading through triggers.
   *   onChange:  (ctx) => void - fires on user edits AND on effective setValue
   *              cascades (once per field per gesture; cycles cut by the visited
   *              set). ctx = { name, value, getValue(name),
   *              setValue(name, value, { ignoreFieldChange }), reloadOptions(name) }.
   *   summary:   (value, {getValue}) => [{ text, color }] | null - warning
   *              lines
   *              rendered below the field (first line visible, all lines on
   *              hover), refreshed on selection + options changes.
   *   Option metadata for select/multi-select dropdowns: entries may be
   *   { id, text, color?, disabled?, hint?: { text, color? } }; plain strings
   *   still work. hint drives the warn glyph + hover tooltip; disabled rows are
   *   unpickable; color is the option name's foreground.
   */
  EntryDialog.prototype.openEditor = function (formLayout, data) {
    // formLayout is required - no built-in field maps (the editor structure is
    // declared by the caller at the call site). fields may be an array or a
    // function of the data (resolved below).
    if (!formLayout) throw new Error(`${MODULE_NAME}: formLayout is required`);
    if (typeof formLayout.fields !== 'function' && !Array.isArray(formLayout.fields)) {
      throw new Error(`${MODULE_NAME}: formLayout.fields must be an array or a function`);
    }
    // Disable the editor entirely while a save is in progress.
    if (this._saving) return;

    if (!data || typeof data !== 'object') return;

    this.buildEditor();
    this._currentData = data;
    this._dataId = data.id != null ? String(data.id) : '';
    this._activeFormLayout = formLayout;
    this._editorDirty = false;
    // In-editor values map: the single source of truth for options/summary/
    // onChange consumers (merged over the base data in _editorSnapshot).
    // Seeded from the data so the first render and the first edit agree.
    this._editorValues = {};
    this._snapshotCache = null;
    this._fieldChangeVisited = null;
    const seedFields = Array.isArray(formLayout.fields) ? formLayout.fields : [];
    seedFields.forEach(function (f) {
      if (!f || f.name == null) return;
      if (data[f.name] !== undefined) this._editorValues[f.name] = data[f.name];
    }, this);

    // Action buttons: the caller declares the full set via create(); when none
    // are supplied the actions bar stays empty and the dialog is exited only
    // via header X / ESC / backdrop (all discarding).
    const self = this;
    const $actions = this._$editor.find('.nsd-editor-actions');
    $actions.find('.nsd-custom-btn').remove(); // clear stale buttons so reopens never duplicate
    if (Array.isArray(this._buttons) && this._buttons.length) {
      this._buttons.forEach(function (def) {
        const $b = self
          .$('<button type="button" class="nsd-btn nsd-custom-btn"></button>')
          .text(def.label == null ? '' : String(def.label))
          .addClass(def.primary === true ? 'nsd-btn-primary' : 'nsd-btn-secondary');
        const bg = def.color != null && def.color !== '' ? sanitizeColor(def.color) : '';
        const fg = def.textColor != null && def.textColor !== '' ? sanitizeColor(def.textColor) : '';
        if (bg) $b.css('background', bg);
        if (fg) $b.css('color', fg);
        $b.on('click', function (e) {
          e.stopPropagation();
          self._handleCustomAction(def);
        });
        $actions.append($b);
      });
    }

    const title = this._title == null ? '' : String(this._title);
    this._$editor.find('.nsd-editor-title').text(title);

    const fieldsContainer = this._$editor.find('.nsd-editor-fields');
    fieldsContainer.empty().css('display', 'flex').css('flex-wrap', 'wrap');
    // Reserve the scrollbar width symmetrically so the fixed-px grid keeps its
    // full numCols*EDITOR_COLUMN_WIDTH content in every scroll state (never
    // wraps) and stays visually centered. border-box keeps the content-box math
    // correct even under an ambient global box-sizing reset.
    const sb = measureScrollbarWidth();
    const numCols = formLayout.columns || DEFAULT_GRID_COLUMNS;
    const gridWidth = numCols * EDITOR_COLUMN_WIDTH;
    fieldsContainer.css({
      boxSizing: 'border-box',
      width: `${gridWidth + 3 * sb}px`,
      paddingLeft: `${sb}px`,
      paddingRight: `${sb}px`,
    });
    // Mirror the grid's content box on the action bar so its right edge always
    // lands on the right edge of a full-width field input (gridWidth + sb -
    // FIELD_COLUMN_PADDING from the editor's left edge), whatever the column
    // count or scrollbar state. The bar stays narrower than the fields
    // container (2sb vs 3sb), so it never widens the editor.
    $actions.css({
      boxSizing: 'border-box',
      width: `${gridWidth + 2 * sb}px`,
      paddingLeft: `${sb}px`,
      paddingRight: `${sb + FIELD_COLUMN_PADDING}px`,
    });

    // Render the declared fields, then wire tag inputs (function-options fields
    // resolve once against the opened snapshot; later rebuilds are consumer-
    // declared via ctx.reloadOptions).
    this._renderFormFields(fieldsContainer, formLayout, data);
    this._initTagInputs(this._$editor);

    this._centerEditor();
  };

  EntryDialog.prototype.closeEditor = function () {
    if (this._$editor) {
      this._$editor.find('.nsd-tag-dropdown:visible').hide();
      this._$editor.hide();
    }
    if (this._$backdrop) this._$backdrop.hide();
    this._dataId = null;
    this._currentData = null;
    this._activeFormLayout = null;
    this._editorDirty = false;
    this._editorValues = {};
    this._snapshotCache = null;
    this._fieldChangeVisited = null;
  };

  /**
   * Close the modal editor, prompting to discard when there are unsaved
   * changes. Every entry point (title-bar X, backdrop, ESC) reports an
   * unwritten discard as success(null, {}).
   */
  EntryDialog.prototype._requestClose = function () {
    if (this._editorDirty) {
      if (!window.confirm('Discard unsaved changes?')) return; // stay open
    }
    this._pendingResult = [null, {}];
    this.closeEditor();
  };

  /**
   * Center the editor modal over the dimmed backdrop, clamped to the viewport.
   */
  EntryDialog.prototype._centerEditor = function () {
    if (!this._$editor) return;
    this._$editor.css({ display: 'flex', left: 0, top: 0 });
    const w = this._$editor.outerWidth() || 400;
    const h = this._$editor.outerHeight() || 350;
    const left = Math.max(10, Math.round((window.innerWidth - w) / 2));
    const top = Math.max(10, Math.round((window.innerHeight - h) / 2));
    this._$editor.css({ left: `${left}px`, top: `${top}px` });
    if (this._$backdrop) this._$backdrop.css('display', 'block');
  };

  // Remove the modal DOM and the namespaced document/window handlers so repeated
  // create() calls never leak handlers. Safe to call more than once.
  EntryDialog.prototype._teardown = function () {
    if (this._torn) return;
    this._torn = true;
    const $ = this.$;
    $(document).off(`keydown${this.ns}-esc`);
    $(window).off(`resize${this.ns}-editor`);
    $(document).off(`mousemove${this.ns}-editor-drag`).off(`mouseup${this.ns}-editor-drag`);
    $(document).off(`mousedown${this.ns}-tag`);
    if (this._$editor) {
      this._$editor.remove();
      this._$editor = null;
    }
    if (this._$backdrop) {
      this._$backdrop.remove();
      this._$backdrop = null;
    }
    if (this.$warnTooltip) {
      this.$warnTooltip.remove();
      this.$warnTooltip = null;
    }
    this._pendingResult = null;
  };

  /**
   * Render a formLayout's field HTML into $container (the declared structure
   * is consumed here).
   */
  EntryDialog.prototype._renderFormFields = function ($container, formLayout, data) {
    const self = this;
    const numColumns = formLayout.columns || DEFAULT_GRID_COLUMNS;
    const isView = formLayout.view === true;
    let fieldsConfig = Array.isArray(formLayout.fields) ? formLayout.fields : [];

    for (let i = 0; i < fieldsConfig.length; i++) {
      let field = fieldsConfig[i];
      if (typeof field === 'string') field = { name: field, label: field, type: 'text' };

      const ctx = this._buildCtx();
      const visible = field.visible == null ? true : this._resolveProp(field.visible, ctx);
      const isReadonly = this._resolveProp(field.readonly, ctx) === true || isView;
      const required = this._resolveProp(field.required, ctx) === true;

      let fieldName = field.name || '';
      let label = field.label || fieldName;
      let defaultVal = this._resolveProp(field.defaultValue, ctx);
      let value = data[fieldName] != null ? data[fieldName] : defaultVal != null ? defaultVal : '';
      let colspan = Math.min(this._resolveProp(field.colspan, ctx) ?? (field.colspan || 1), numColumns);
      let breakBefore = this._resolveProp(field.break, ctx) === true;
      let wrapperStyle = `width:${colspan * EDITOR_COLUMN_WIDTH}px;box-sizing:border-box;padding:0 ${FIELD_COLUMN_PADDING}px;position:relative;min-width:0;flex-shrink:1;${visible ? '' : 'display:none;'}`;

      // Force a new row in the flex-wrap container (clear:left does nothing on flex items)
      let fieldHtml = breakBefore ? '<div class="nsd-editor-row-break"></div>' : '';
      fieldHtml += `
        <div class="nsd-field-col" style="${wrapperStyle}">
          <div style="margin-bottom:8px;">
            <label class="nsd-editor-label">${escapeHtml(label)}${required && !isReadonly ? ' <span class="nsd-field-required">*</span>' : ''}</label>`;

      if (field.type === 'select') {
        let options = field.options;
        if (typeof options === 'function') options = options({ getValue: (n) => self.getValue(n) });
        if (!options) options = [];
        // Find display text for current selection
        let displayText = value != null ? String(value) : '';
        for (let oi = 0; oi < options.length; oi++) {
          const normalized = this._normalizeOption(options[oi]);
          if (String(value) === normalized.val) {
            displayText = normalized.text;
            break;
          }
        }
        if (isReadonly) {
          // Read-only select: static text (span), same as other simple fields
          fieldHtml += `<span class="nsd-field-readonly nsd-select-label" data-field-name="${escapeHtml(fieldName)}" data-field-type="${escapeHtml(field.type)}">${displayText !== '' && displayText != null ? escapeHtml(displayText) : '&nbsp;'}</span>`;
        } else {
          fieldHtml += `
            <div class="nsd-tag-input-wrapper nsd-single-select" data-field-name="${escapeHtml(fieldName)}" data-field-type="${escapeHtml(field.type)}">
              <input type="hidden" class="nsd-select-value" data-field-name="${escapeHtml(fieldName)}" data-field-type="${escapeHtml(field.type)}" value="${escapeHtml(value)}">
              <div class="nsd-tag-input" tabindex="0">
                <span class="nsd-select-label">${escapeHtml(displayText)}</span>
              </div>
              <div class="nsd-tag-dropdown" style="display:none;">`;
          fieldHtml += `<input type="text" class="nsd-tag-search" placeholder="Search..." style="width:100%;padding:6px 8px;font-size:12px;border:none;border-bottom:1px solid var(--border);box-sizing:border-box;outline:none;background:transparent;">`;
          if (options.length === 0) {
            fieldHtml += '<div class="nsd-tag-no-results">No options available.</div>';
          }
          for (let oi = 0; oi < options.length; oi++) {
            const normalized = this._normalizeOption(options[oi]);
            const selected = String(value) === normalized.val ? ' selected' : '';
            fieldHtml += this._buildOptionRowHtml(options[oi], normalized.val, normalized.text, selected);
          }
          fieldHtml += `</div></div>`;
        }
      } else if (field.type === 'multi-select') {
        // Multi-select chips + dropdown. Option metadata (disabled / color /
        // hint tooltip) and any availability semantics are declared by the
        // consumer's own options/summary functions on the field descriptor; the
        // plugin only renders + dispatches.
        let mOpts = field.options;
        if (typeof mOpts === 'function') mOpts = mOpts({ getValue: (n) => self.getValue(n) });
        if (!mOpts) mOpts = [];
        let valArr = Array.isArray(value) ? value : value ? [value] : [];
        let jsonStr = JSON.stringify(valArr)
          .replace(/'/g, '&#39;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;');
        if (isReadonly) {
          // Read-only multi-select: chips only - no hidden value, placeholder, dropdown, or summary
          fieldHtml += `<span class="nsd-field-readonly nsd-select-label" data-field-name="${escapeHtml(fieldName)}" data-field-type="${escapeHtml(field.type)}">`;
          let chipCount = 0;
          for (let mi = 0; mi < mOpts.length; mi++) {
            const normalized = this._normalizeOption(mOpts[mi]);
            if (valArr.indexOf(normalized.val) !== -1) {
              fieldHtml += `<span class="nsd-tag-chip" data-val="${escapeHtml(normalized.val)}"><span class="nsd-tag-chip-text">${escapeHtml(normalized.text)}</span></span>`;
              chipCount++;
            }
          }
          // Keep the field footprint when there are no selected chips
          if (chipCount === 0) fieldHtml += `&nbsp;`;
          fieldHtml += `</span>`;
        } else {
          fieldHtml += `
            <div class="nsd-tag-input-wrapper" data-field-name="${escapeHtml(fieldName)}" data-field-type="${escapeHtml(field.type)}">
              <input type="hidden" class="nsd-tag-value" data-field-type="${escapeHtml(field.type)}" value="${jsonStr}">
              <div class="nsd-tag-input" tabindex="0">`;
          for (let mi = 0; mi < mOpts.length; mi++) {
            const normalized = this._normalizeOption(mOpts[mi]);
            if (valArr.indexOf(normalized.val) !== -1) {
              fieldHtml += `<span class="nsd-tag-chip" data-val="${escapeHtml(normalized.val)}"><span class="nsd-tag-chip-text">${escapeHtml(normalized.text)}</span><span class="nsd-tag-chip-remove" role="button" tabindex="0" title="Remove" aria-label="Remove">${CLOSE_ICO_SVG}</span></span>`;
            }
          }
          fieldHtml += `
              <span class="nsd-tag-placeholder" style="${valArr.length > 0 ? 'display:none;' : ''}">Click to select...</span>
            </div>
            <div class="nsd-tag-dropdown" style="display:none;">`;
          for (let mi = 0; mi < mOpts.length; mi++) {
            const normalized = this._normalizeOption(mOpts[mi]);
            const mSelected = valArr.indexOf(normalized.val) !== -1;
            fieldHtml += this._buildOptionRowHtml(mOpts[mi], normalized.val, normalized.text, mSelected);
          }
          if (mOpts.length === 0) {
            fieldHtml += '<div class="nsd-tag-no-results">No options available.</div>';
          }
          fieldHtml += `</div></div>`;
        }
      } else if (this._isNumericType(field.type)) {
        const numType = field.type;
        const displayVal = this._formatNumber(value, numType, field);
        const inputMode = numType === 'integer' ? 'numeric' : 'decimal';
        const numTypeAttr = ` data-numtype="${escapeHtml(numType)}"`;
        const placesAttr = numType === 'currency' ? ` data-decimal-places="${this._decimalPlaces(field)}"` : '';
        if (isReadonly) {
          // Read-only numeric: static text (span) of the formatted value
          fieldHtml += `<span class="nsd-field-readonly nsd-select-label" data-field-name="${escapeHtml(fieldName)}">${displayVal !== '' ? escapeHtml(displayVal) : '&nbsp;'}</span>`;
        } else {
          fieldHtml += `<input type="text" inputmode="${inputMode}" class="nsd-editor-field nsd-number-field" data-field-name="${escapeHtml(fieldName)}"${numTypeAttr}${placesAttr}${field.maxlength != null ? ` maxlength="${escapeHtml(String(field.maxlength))}"` : ''} value="${escapeHtml(displayVal)}" style="width:100%;padding:4px 6px;border:1px solid var(--border);border-radius:4px;font-size:12px;box-sizing:border-box;">`;
        }
      } else if (field.type === 'time') {
        const displayTime = this._formatTime(value, field);
        if (isReadonly) {
          fieldHtml += `<span class="nsd-field-readonly nsd-select-label" data-field-name="${escapeHtml(fieldName)}">${displayTime !== '' ? escapeHtml(displayTime) : '&nbsp;'}</span>`;
        } else {
          fieldHtml += `<input type="text" class="nsd-editor-field nsd-time-field" data-field-name="${escapeHtml(fieldName)}" data-field-type="${escapeHtml(field.type)}"${field.maxlength != null ? ` maxlength="${escapeHtml(String(field.maxlength))}"` : ''} value="${escapeHtml(displayTime)}" style="width:100%;padding:4px 6px;border:1px solid var(--border);border-radius:4px;font-size:12px;box-sizing:border-box;">`;
        }
      } else if (field.type === 'date' || field.type === 'datetime') {
        const isDateTime = field.type !== 'date';
        const dateVal = value != null && value !== '' ? parseZoneDate(value) : null;
        const validDate = dateVal && !isNaN(dateVal.getTime());
        const inputVal = validDate ? (isDateTime ? this._toDatetimeLocal(dateVal) : toLocalDateStr(dateVal)) : '';
        if (isReadonly) {
          // Read-only date/datetime: readable static text, &nbsp; keeps the footprint
          const displayDate = validDate ? this.formatDate(dateVal, field.format, { showTime: isDateTime }) : '';
          fieldHtml += `<span class="nsd-field-readonly nsd-select-label" data-field-name="${escapeHtml(fieldName)}">${displayDate !== '' ? escapeHtml(displayDate) : '&nbsp;'}</span>`;
        } else {
          fieldHtml += `<div class="nsd-date-wrapper"><input type="${isDateTime ? 'datetime-local' : 'date'}" class="nsd-editor-field" data-field-name="${escapeHtml(fieldName)}" data-field-type="${escapeHtml(field.type)}" value="${escapeHtml(inputVal)}" style="padding:4px 6px;border:1px solid var(--border);border-radius:4px;font-size:12px;box-sizing:border-box;">${this._dateIconSvg()}</div>`;
        }
      } else if (field.type === 'textarea') {
        if (isReadonly) {
          // Read-only textarea: static text (span) of the value
          fieldHtml += `<span class="nsd-field-readonly nsd-select-label" data-field-name="${escapeHtml(fieldName)}">${value !== '' && value != null ? escapeHtml(value) : '&nbsp;'}</span>`;
        } else {
          fieldHtml += `<textarea class="nsd-editor-field" data-field-name="${escapeHtml(fieldName)}"${field.maxlength != null ? ` maxlength="${escapeHtml(String(field.maxlength))}"` : ''} style="width:100%;min-height:60px;padding:4px 6px;border:1px solid var(--border);border-radius:4px;font-size:12px;box-sizing:border-box;resize:vertical;">${escapeHtml(value)}</textarea>`;
        }
      } else if (field.type === 'checkbox') {
        const checked = value === true || value === 1 || value === '1' || value === 'true' || value === 'T';
        if (isReadonly) {
          // Read-only checkbox: static check glyph
          fieldHtml += `<span class="nsd-field-readonly nsd-cg-item" data-field-name="${escapeHtml(fieldName)}">${checked ? CHK_ICO_SVG : UNCHK_ICO_SVG}${escapeHtml(field.checkboxLabel || '')}</span>`;
        } else {
          fieldHtml += `<label class="nsd-checkbox"><input type="checkbox" class="nsd-checkbox-input" data-field-name="${escapeHtml(fieldName)}"${checked ? ' checked' : ''}> <span>${escapeHtml(field.checkboxLabel || '')}</span></label>`;
        }
      } else if (field.type === 'checkbox-group') {
        let cgOpts = field.options;
        if (typeof cgOpts === 'function') cgOpts = cgOpts(data);
        if (!cgOpts) cgOpts = [];
        const selArr = (Array.isArray(value) ? value : value != null ? [value] : []).map(String);
        if (isReadonly) {
          // Read-only checkbox group: static check glyphs per option
          fieldHtml += `<span class="nsd-field-readonly nsd-select-label" data-field-name="${escapeHtml(fieldName)}">`;
          let marked = 0;
          for (let oi = 0; oi < cgOpts.length; oi++) {
            const opt = cgOpts[oi];
            const oVal = String(typeof opt === 'string' ? opt : opt.id || opt.value);
            const oText = typeof opt === 'string' ? opt : opt.name || opt.text || opt.id || opt.value;
            const isSel = selArr.indexOf(oVal) !== -1;
            fieldHtml += `<span class="nsd-cg-item">${isSel ? CHK_ICO_SVG : UNCHK_ICO_SVG}${escapeHtml(oText)}</span>`;
            if (isSel) marked++;
          }
          if (marked === 0) fieldHtml += '&nbsp;';
          fieldHtml += `</span>`;
        } else {
          const groupMax = field.max != null && Number(field.max) > 0 ? Number(field.max) : '';
          fieldHtml += `<div class="nsd-checkbox-group" data-field-name="${escapeHtml(fieldName)}" data-max="${escapeHtml(String(groupMax))}">`;
          for (let oi = 0; oi < cgOpts.length; oi++) {
            const opt = cgOpts[oi];
            const oVal = String(typeof opt === 'string' ? opt : opt.id || opt.value);
            const oText = typeof opt === 'string' ? opt : opt.name || opt.text || opt.id || opt.value;
            const isSel = selArr.indexOf(oVal) !== -1;
            fieldHtml += `<label class="nsd-checkbox"><input type="checkbox" class="nsd-cb-group-item" data-field-name="${escapeHtml(fieldName)}" data-val="${escapeHtml(oVal)}"${isSel ? ' checked' : ''}> <span>${escapeHtml(oText)}</span></label>`;
          }
          fieldHtml += `</div>`;
        }
      } else if (field.type === 'table') {
        // Generic row-editor for an array-of-objects value (a sub-list).
        const tableCols = Array.isArray(field.columns) ? field.columns : [];
        const isTableReadonly = field.readonly === true || isView;
        const tableWidthStyle = field.width != null ? `width:${Number(field.width)}px;` : 'width:100%;';
        const rowsArr = Array.isArray(value) ? value : [];
        let tableHtml = `<div class="nsd-table-field${isTableReadonly ? ' nsd-table-readonly' : ''}" data-field-name="${escapeHtml(fieldName)}" data-field-type="table" style="${tableWidthStyle}box-sizing:border-box;">`;
        const scrollStyle =
          field.maxHeight != null ? ` style="max-height:${Number(field.maxHeight)}px;overflow-y:auto;"` : '';
        tableHtml += `<div class="nsd-table-scroll"${scrollStyle}>`;
        // Header (sticky within the scroll container)
        tableHtml += `
          <div class="nsd-table-header">
            <div class="nsd-table-row">`;
        for (let ci = 0; ci < tableCols.length; ci++) {
          const hcol = tableCols[ci];
          const colCtx = this._buildCtx();
          const colVisible = hcol.visible == null ? true : this._resolveProp(hcol.visible, colCtx);
          if (!colVisible) continue;
          const colRequired = this._resolveProp(hcol.required, colCtx) === true;
          const hStyle =
            hcol.width != null
              ? `flex:0 0 ${Number(hcol.width)}px;`
              : `flex:1 1 0;min-width:${TABLE_COLUMN_MIN_WIDTH}px;`;
          tableHtml += `
            <div class="nsd-table-cell nsd-table-head" style="${hStyle}${this._isNumericType(hcol.type) ? 'text-align:right;' : ''}${hcol.type === 'checkbox' ? 'text-align:center;' : ''}">
              ${escapeHtml(hcol.label || hcol.key)}${colRequired && !isTableReadonly ? ' <span class="nsd-field-required">*</span>' : ''}
            </div>`;
        }
        tableHtml += `</div></div>`;
        // Rows
        tableHtml += `<div class="nsd-table-rows">`;
        if (rowsArr.length === 0 && (isTableReadonly || field.allowAdd === false)) {
          tableHtml += `<div class="nsd-table-empty">No records available.</div>`;
        }
        for (let ri = 0; ri < rowsArr.length; ri++) {
          tableHtml += this._buildTableRowHtml(tableCols, rowsArr[ri], field, false, ri);
        }
        tableHtml += `</div></div>`;
        if (!isTableReadonly && field.allowAdd !== false) {
          tableHtml += `<div class="nsd-table-add-row">+ Add row</div>`;
        }
        tableHtml += `</div>`;
        fieldHtml += tableHtml;
      } else {
        if (isReadonly) {
          // Read-only text: static text (span) of the value
          fieldHtml += `<span class="nsd-field-readonly nsd-select-label" data-field-name="${escapeHtml(fieldName)}">${value !== '' && value != null ? escapeHtml(value) : '&nbsp;'}</span>`;
        } else {
          fieldHtml += `<input type="text" class="nsd-editor-field" data-field-name="${escapeHtml(fieldName)}"${field.maxlength != null ? ` maxlength="${escapeHtml(String(field.maxlength))}"` : ''} value="${escapeHtml(value)}" style="width:100%;padding:4px 6px;border:1px solid var(--border);border-radius:4px;font-size:12px;box-sizing:border-box;">`;
        }
      }

      // field.summary hook: render warning lines INSIDE the label/control div,
      // directly below the control (first line visible, all lines in the hover
      // tooltip). Appending after the column close would make the summary a
      // flex sibling that renders beside the field and breaks the row.
      if (field.summary != null) {
        fieldHtml += this._renderSummaryHtml(field);
      }
      fieldHtml += `</div></div>`;
      $container.append(fieldHtml);
    }
  };

  /**
   * Render the field.summary hook output: warning lines { text, textcolor?,
   * hint?: { color?, textcolor? } }. The FIRST line is the visible summary
   * (its textcolor applied), all lines are joined with newlines into
   * data-summary-msg for the hover tooltip; data-summary-bg/data-summary-textcolor
   * hold the first line's hint colors for the tooltip. Returns '' when the hook
   * is absent, throws, or returns no lines.
   */
  /**
   * Resolve a field's `summary` hook into a normalized array of warning lines
   * ({ text, textcolor?, hint?: { color?, textcolor? } }) using the supplied
   * ctx. A string summary becomes a single line; an empty / non-array result
   * returns null. Shared by the render and refresh paths.
   */
  EntryDialog.prototype._resolveSummaryLines = function (field, ctx) {
    if (!field || field.summary == null) return null;
    const resolved = this._resolveProp(field.summary, ctx);
    let lines = null;
    if (typeof resolved === 'string') lines = [{ text: resolved }];
    else if (Array.isArray(resolved)) lines = resolved;
    else lines = null;
    if (!Array.isArray(lines) || lines.length === 0) return null;
    return lines;
  };

  EntryDialog.prototype._renderSummaryHtml = function (field) {
    if (!field) return '';
    const lines = this._resolveSummaryLines(field, this._buildCtx());
    if (!lines) return '';
    const text = lines[0] && lines[0].text != null ? String(lines[0].text) : '';
    if (!text) return '';
    const color = sanitizeColor((lines[0] && lines[0].textcolor) || '');
    const bg = sanitizeColor((lines[0] && lines[0].hint && lines[0].hint.color) || '');
    const textC = sanitizeColor((lines[0] && lines[0].hint && lines[0].hint.textcolor) || '');
    const fullMsg = lines
      .map(function (l) {
        return l && l.text != null ? String(l.text) : '';
      })
      .filter(Boolean)
      .join('\n');
    return `<div class="nsd-summary-warn nsd-field-summary" data-summary-for="${escapeHtml(field.name || '')}" data-summary-msg="${escapeHtml(fullMsg)}"${bg ? ` data-summary-bg="${bg}"` : ''}${textC ? ` data-summary-textcolor="${textC}"` : ''} style="${color ? `color:${color};` : ''}">&#x26A0; ${escapeHtml(text)}</div>`;
  };

  /**
   * Re-render an existing field.summary element (created by _renderSummaryHtml)
   * from the current editor snapshot + value. Used after selection changes and
   * after options rebuilds so the summary stays live.
   */
  EntryDialog.prototype._refreshFieldSummary = function (fieldName, value) {
    if (!this._$editor || fieldName == null) return;
    const self = this;
    let found = false;
    this._$editor.find('.nsd-field-summary').each(function () {
      if (self.$(this).data('summary-for') !== String(fieldName)) return;
      found = true;
      const $el = self.$(this);
      const field = self._getLayoutField(fieldName);
      if (!field || field.summary == null) {
        $el.remove();
        return;
      }
      const lines = self._resolveSummaryLines(field, self._buildCtx({ name: fieldName, value: value }));
      if (!lines) {
        $el.remove();
        return;
      }
      const text = lines[0] && lines[0].text != null ? String(lines[0].text) : '';
      if (!text) {
        $el.remove();
        return;
      }
      const color = sanitizeColor((lines[0] && lines[0].textcolor) || '');
      const bg = sanitizeColor((lines[0] && lines[0].hint && lines[0].hint.color) || '');
      const textC = sanitizeColor((lines[0] && lines[0].hint && lines[0].hint.textcolor) || '');
      const fullMsg = lines
        .map(function (l) {
          return l && l.text != null ? String(l.text) : '';
        })
        .filter(Boolean)
        .join('\n');
      // Update via jQuery .data() (not just .attr()) so the delegated tooltip
      // handler, which reads .data('summary-msg'), never sees a stale cached
      // value from first render.
      $el
        .text(`\u26A0 ${text}`)
        .css('color', color || '')
        .data('summary-msg', fullMsg)
        .data('summary-bg', bg)
        .data('summary-textcolor', textC)
        .show();
    });
    if (found) return;
    // No existing summary element for this field - create one if the hook now
    // yields warning lines (e.g. first time a dependency makes the summary
    // non-empty after a reload). Insert inside the label/control div, directly
    // below the control, matching _renderFormFields placement.
    const field = self._getLayoutField(fieldName);
    if (!field || field.summary == null) return;
    const html = self._renderSummaryHtml(field);
    if (!html) return;
    const $fieldEl = self._$editor
      .find('[data-field-name]')
      .filter(function () {
        return this.getAttribute('data-field-name') === String(fieldName);
      })
      .first();
    if ($fieldEl.length) {
      $fieldEl.after(html);
    } else {
      self._$editor.find('.nsd-editor-fields').append(html);
    }
  };

  EntryDialog.prototype._refreshFieldUi = function () {
    if (!this._$editor || !this._activeFormLayout) return;
    const fields = this._activeFormLayout.fields;
    if (!Array.isArray(fields)) return;
    const self = this;
    fields.forEach(function (field) {
      if (!field || !field.name) return;
      const ctx = self._buildCtx({ name: field.name, value: self.getValue(field.name) });
      const visible = field.visible == null ? true : self._resolveProp(field.visible, ctx);
      const $fieldEl = self._$editor
        .find('[data-field-name]')
        .filter(function () {
          return this.getAttribute('data-field-name') === String(field.name);
        })
        .first();
      let $wrapper = null;
      if ($fieldEl.length) {
        $wrapper = $fieldEl.closest('.nsd-field-col');
      }
      if ($wrapper && $wrapper.length) {
        if (!visible) $wrapper.hide();
        else $wrapper.show();
        const isReadonly = self._resolveProp(field.readonly, ctx) === true;
        if (isReadonly)
          $wrapper.find('input, select, textarea, .nsd-tag-input').css('pointer-events', 'none').css('opacity', '0.6');
        else $wrapper.find('input, select, textarea, .nsd-tag-input').css('pointer-events', '').css('opacity', '');
        const $label = $wrapper.find('.nsd-editor-label');
        if ($label.length) {
          const required = self._resolveProp(field.required, ctx) === true;
          let $star = $label.find('.nsd-field-required');
          if (required && !$star.length) $label.append(' <span class="nsd-field-required">*</span>');
          else if (!required && $star.length) $star.remove();
        }
      }
      // table columns visibility handled in table render; skip here
    });
  };

  /**
   * Resolve a field descriptor from the ACTIVE form layout, or null.
   */
  EntryDialog.prototype._getLayoutField = function (fieldName) {
    const layout = this._activeFormLayout;
    let fields = layout && Array.isArray(layout.fields) ? layout.fields : [];
    for (let i = 0; i < fields.length; i++) {
      if (fields[i] && fields[i].name === fieldName) return fields[i];
    }
    return null;
  };

  /**
   * Render one dropdown option row for select/multi-select fields. Accepts a
   * plain string or an option object { id, text, color?, disabled?,
   * hint?: { text, color? } }. The hint drives the ⚠ glyph + is-conflict name
   * class and the delegated hover tooltip (data-hint-msg / data-hint-color);
   * disabled rows render .disabled and the toggle guard rejects them; color is
   * the option name's foreground (sanitized).
   */
  EntryDialog.prototype._buildOptionRowHtml = function (opt, optVal, optText, selected) {
    const meta = opt && typeof opt === 'object' ? opt : null;
    const disabled = !!meta && meta.disabled === true;
    const hint = meta && meta.hint && meta.hint.text ? meta.hint : null;
    const color = sanitizeColor(meta && meta.textcolor ? meta.textcolor : '');
    const hintColor = sanitizeColor(hint && hint.color ? hint.color : '');
    const hintTextColor = sanitizeColor(hint && hint.textcolor ? hint.textcolor : '');
    const cls = `${selected ? ' selected' : ''}${disabled ? ' disabled' : ''}${hint ? ' has-conflict' : ''}`;
    const hintAttr = hint
      ? ` data-hint-msg="${escapeHtml(hint.text)}"${hintColor ? ` data-hint-color="${hintColor}"` : ''}${hintTextColor ? ` data-hint-textcolor="${hintTextColor}"` : ''}`
      : '';
    const nameCls = hint ? ' is-conflict' : '';
    const colorStyle = color ? ` style="color:${color};"` : '';
    return `<div class="nsd-tag-option${cls}" data-val="${escapeHtml(optVal)}" data-label="${escapeHtml(optText)}"${hintAttr}><span class="nsd-tag-option-name${nameCls}"${colorStyle}>${escapeHtml(optText)}</span></div>`;
  };

  /**
   * Normalize one option entry into { val, text, meta }: strings pass through,
   * objects use id/value + name/text, meta keeps the object for metadata reads.
   */
  EntryDialog.prototype._normalizeOption = function (opt) {
    if (typeof opt === 'string' || typeof opt === 'number') {
      return { val: String(opt), text: String(opt), meta: null };
    }
    const val =
      opt != null && typeof opt === 'object'
        ? String(opt.id != null ? opt.id : opt.value != null ? opt.value : '')
        : '';
    const text =
      opt != null && typeof opt === 'object'
        ? String(
            opt.name != null
              ? opt.name
              : opt.text != null
                ? opt.text
                : opt.id != null
                  ? opt.id
                  : opt.value != null
                    ? opt.value
                    : ''
          )
        : String(opt);
    return { val: val, text: text, meta: opt && typeof opt === 'object' ? opt : null };
  };

  /**
   * Build one table-field row's HTML. `field` is the layout field descriptor
   * (carries readonly + columns); entry is the committed array element (null =
   * a new blank row). `active` renders the row as the editable line with an
   * OK/Cancel/Remove action row; otherwise the row is a read-only display.
   */
  EntryDialog.prototype._buildTableRowHtml = function (columns, entry, field, active, rowIndex) {
    const isTableReadonly =
      (field && this._resolveProp(field.readonly, this._buildCtx()) === true) ||
      (this._activeFormLayout && this._activeFormLayout.view === true);
    if (typeof active === 'number' && rowIndex === undefined) {
      rowIndex = active;
      active = false;
    }
    const isActive = active === true && !isTableReadonly;
    const jsonStr = JSON.stringify(entry || {})
      .replace(/'/g, '&#39;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
    let colsTotal = 0;
    let cellsHtml = '';
    for (let ci = 0; ci < columns.length; ci++) {
      const col = columns[ci];
      const colCtxBase = this._buildCtx({
        table: field ? field.name : null,
        column: col.name,
        rowIndex: rowIndex,
        value: entry ? entry[this._colKey(col)] : null,
      });
      const colVisible = col.visible == null ? true : this._resolveProp(col.visible, colCtxBase);
      if (!colVisible) continue;
      let cellValue = entry != null ? entry[this._colKey(col)] : undefined;
      if (cellValue === undefined && col.defaultValue !== undefined) {
        const def = this._resolveProp(
          col.defaultValue,
          this._buildCtx({ table: field ? field.name : null, column: col.name, rowIndex: rowIndex })
        );
        if (def != null) cellValue = def;
      }
      const cellCtx = this._buildCtx({
        table: field ? field.name : null,
        column: col.name,
        rowIndex: rowIndex,
        value: cellValue,
      });
      const colWidth = this._resolveProp(col.width, cellCtx);
      const cellStyle =
        colWidth != null ? `flex:0 0 ${Number(colWidth)}px;` : `flex:1 1 0;min-width:${TABLE_COLUMN_MIN_WIDTH}px;`;
      colsTotal += col && colWidth != null ? Number(colWidth) : TABLE_COLUMN_MIN_WIDTH;
      cellsHtml += `<div class="nsd-table-cell" style="${cellStyle}">`;
      const colReadonly = this._resolveProp(col.readonly, cellCtx) === true;
      cellsHtml += this._buildTableCellHtml(
        col,
        cellValue,
        isActive ? colReadonly : true,
        rowIndex,
        field ? field.name : null
      );
      cellsHtml += `</div>`;
    }
    // The row spans the columns' total width (max with the container) so its
    // border and inner bands cover the full scrolled table, not just 100%
    let rowHtml = `<div class="nsd-table-row${isActive ? ' active' : ''}" style="width:max(100%,${colsTotal}px);"><input type="hidden" class="nsd-table-row-value" value="${jsonStr}"><div class="nsd-table-row-cells">${cellsHtml}</div>`;
    if (isActive) {
      rowHtml += `<div class="nsd-table-row-actions" style="width:max(100%,${colsTotal}px);"><div class="nsd-table-row-actions-box"><button type="button" class="nsd-btn nsd-btn-secondary nsd-table-row-ok">OK</button><button type="button" class="nsd-btn nsd-btn-secondary nsd-table-row-cancel">Cancel</button>`;
      // Remove only makes sense for rows with committed values; a never-committed
      // row is discarded via Cancel instead, and an allowAdd:false table has a
      // fixed row count (no Remove either)
      if (
        field.allowAdd !== false &&
        entry != null &&
        Object.keys(entry).some(function (k) {
          return entry[k] !== undefined && entry[k] !== '';
        })
      ) {
        rowHtml += `<button type="button" class="nsd-btn nsd-btn-secondary nsd-table-row-remove">Remove</button>`;
      }
      rowHtml += `</div></div>`;
    }
    rowHtml += `</div>`;
    return rowHtml;
  };

  /**
   * Build one table cell's HTML for a column type (select/number/text).
   * Readonly columns render static spans carrying data-val so Save still reads
   * the value back.
   */
  EntryDialog.prototype._buildTableCellHtml = function (col, cellValue, fieldReadonly, rowIndex, tableName) {
    // Resolve the data key (key || name) once so every data-col-key below uses it.
    col = Object.assign({}, col);
    col.key = this._colKey(col);
    const colCtx = this._buildCtx({ table: tableName, column: col.name, rowIndex: rowIndex, value: cellValue });
    const colReadonly = this._resolveProp(col.readonly, colCtx) === true || fieldReadonly === true;
    const colType = col.type || 'text';
    const valStr = cellValue != null ? String(cellValue) : '';

    if (colType === 'select') {
      let opts = this._resolveProp(col.options, colCtx);
      if (!opts) opts = [];
      if (!Array.isArray(opts)) opts = [];
      // A blank option always leads the list so the value can be cleared
      let optsHtml = `<div class="nsd-tag-option${valStr === '' ? ' selected' : ''}" data-val="">&nbsp;</div>`;
      let display = valStr;
      for (let oi = 0; oi < opts.length; oi++) {
        const o = opts[oi];
        const oVal = typeof o === 'string' ? o : o.id || o.value;
        const oText = typeof o === 'string' ? o : o.name || o.text || o.id || o.value;
        optsHtml += this._buildOptionRowHtml(o, oVal, oText, valStr === String(oVal));
        if (valStr === String(oVal)) display = oText;
      }
      if (colReadonly) {
        return `<span class="nsd-table-static" data-col-key="${escapeHtml(col.key)}" data-val="${escapeHtml(valStr)}">${display !== '' && display != null ? escapeHtml(display) : '&nbsp;'}</span>`;
      }
      return `
        <div class="nsd-tag-input-wrapper nsd-single-select" data-col-key="${escapeHtml(col.key)}">
          <input type="hidden" class="nsd-select-value" data-col-key="${escapeHtml(col.key)}" value="${escapeHtml(valStr)}">
          <div class="nsd-tag-input" tabindex="0">
            <span class="nsd-select-label">${display !== '' && display != null ? escapeHtml(display) : '&nbsp;'}</span>
          </div>
          <div class="nsd-tag-dropdown" style="display:none;">
            <input type="text" class="nsd-tag-search" placeholder="Search..." style="width:100%;padding:6px 8px;font-size:12px;border:none;border-bottom:1px solid var(--border);box-sizing:border-box;outline:none;background:transparent;">
            ${optsHtml}
          </div>
        </div>`;
    }

    if (this._isNumericType(colType)) {
      const displayNum = this._formatNumber(cellValue, colType, col);
      const inputMode = colType === 'integer' ? 'numeric' : 'decimal';
      const numTypeAttr = ` data-numtype="${escapeHtml(colType)}"`;
      const placesAttr = colType === 'currency' ? ` data-decimal-places="${this._decimalPlaces(col)}"` : '';
      if (colReadonly) {
        return `<span class="nsd-table-static nsd-number-field" data-col-key="${escapeHtml(col.key)}" data-val="${escapeHtml(valStr)}">${displayNum !== '' && displayNum != null ? escapeHtml(displayNum) : '&nbsp;'}</span>`;
      }
      return `<input type="text" inputmode="${inputMode}" class="nsd-editor-field nsd-number-field" data-col-key="${escapeHtml(col.key)}"${numTypeAttr}${placesAttr} value="${escapeHtml(displayNum)}" style="width:100%;padding:4px 6px;border:1px solid var(--border);border-radius:4px;font-size:12px;box-sizing:border-box;">`;
    }

    if (colType === 'checkbox') {
      const checked =
        cellValue === true || cellValue === 1 || cellValue === '1' || cellValue === 'true' || cellValue === 'T';
      if (colReadonly) {
        return `<span class="nsd-table-static" style="text-align:center;" data-col-key="${escapeHtml(col.key)}" data-val="${escapeHtml(String(cellValue == null ? '' : cellValue))}">${checked ? 'Yes' : 'No'}</span>`;
      }
      return `<input type="checkbox" class="nsd-table-checkbox" data-col-key="${escapeHtml(col.key)}"${checked ? ' checked' : ''}>`;
    }

    // date / datetime
    if (colType === 'date' || colType === 'datetime') {
      const isDateTime = colType !== 'date';
      const rawVal = cellValue != null && cellValue !== '' ? cellValue : null;
      const dateVal = rawVal ? parseZoneDate(rawVal) : null;
      const validDate = dateVal && !isNaN(dateVal.getTime()) ? dateVal : null;
      const inpVal = validDate ? (isDateTime ? this._toDatetimeLocal(validDate) : toLocalDateStr(validDate)) : '';
      if (colReadonly) {
        const dispDate = validDate ? this.formatDate(validDate, col.format, { showTime: isDateTime }) : '';
        return `<span class="nsd-table-static" data-col-key="${escapeHtml(col.key)}" data-val="${escapeHtml(String(cellValue == null ? '' : cellValue))}">${dispDate !== '' && dispDate != null ? escapeHtml(dispDate) : '&nbsp;'}</span>`;
      }
      return `<div class="nsd-date-wrapper"><input type="${isDateTime ? 'datetime-local' : 'date'}" class="nsd-editor-field" data-col-key="${escapeHtml(col.key)}" value="${escapeHtml(inpVal)}" style="padding:4px 6px;border:1px solid var(--border);border-radius:4px;font-size:12px;box-sizing:border-box;">${this._dateIconSvg()}</div>`;
    }

    // time
    if (colType === 'time') {
      const displayTime = this._formatTime(cellValue, col);
      if (colReadonly) {
        return `<span class="nsd-table-static" data-col-key="${escapeHtml(col.key)}" data-val="${escapeHtml(valStr)}">${displayTime !== '' && displayTime != null ? escapeHtml(displayTime) : '&nbsp;'}</span>`;
      }
      return `<input type="text" class="nsd-editor-field nsd-time-field" data-col-key="${escapeHtml(col.key)}" value="${escapeHtml(displayTime)}" style="width:100%;padding:4px 6px;border:1px solid var(--border);border-radius:4px;font-size:12px;box-sizing:border-box;">`;
    }

    // textarea (multi-line)
    if (colType === 'textarea') {
      if (colReadonly) {
        return `<span class="nsd-table-static" data-col-key="${escapeHtml(col.key)}" data-val="${escapeHtml(valStr)}">${valStr !== '' && valStr != null ? escapeHtml(valStr) : '&nbsp;'}</span>`;
      }
      return `<textarea class="nsd-editor-field" data-col-key="${escapeHtml(col.key)}" style="width:100%;min-height:44px;padding:4px 6px;border:1px solid var(--border);border-radius:4px;font-size:12px;box-sizing:border-box;resize:vertical;">${escapeHtml(valStr)}</textarea>`;
    }

    // text (default)
    if (colReadonly) {
      return `<span class="nsd-table-static" data-col-key="${escapeHtml(col.key)}" data-val="${escapeHtml(valStr)}">${valStr !== '' && valStr != null ? escapeHtml(valStr) : '&nbsp;'}</span>`;
    }
    return `<input type="text" class="nsd-editor-field" data-col-key="${escapeHtml(col.key)}" value="${escapeHtml(valStr)}" style="width:100%;padding:4px 6px;border:1px solid var(--border);border-radius:4px;font-size:12px;box-sizing:border-box;">`;
  };

  /**
   * Resolve a table column's data key: explicit `key` when set, else `name`
   * (allows spec-style columns declared with `name` only).
   */
  EntryDialog.prototype._colKey = function (col) {
    return col && col.key != null && col.key !== '' ? col.key : col ? col.name : null;
  };

  /** Resolve the layout field descriptor for the row's table field. */
  EntryDialog.prototype._getTableConfig = function ($row) {
    const $field = $row.closest('.nsd-table-field');
    const fieldName = $field.data('field-name');
    const field = (
      this._activeFormLayout && Array.isArray(this._activeFormLayout.fields) ? this._activeFormLayout.fields : []
    ).find(function (f) {
      return f && f.name === fieldName;
    });
    return { field: field, columns: (field && field.columns) || [] };
  };

  /** Parse a row's committed value from its hidden input. */
  EntryDialog.prototype._readTableRowValue = function ($row) {
    let entry = {};
    try {
      entry = JSON.parse($row.find('.nsd-table-row-value').val() || '{}');
    } catch (e) {
      entry = {};
    }
    return entry;
  };

  /** Read the active row's input values into a row object (''/undefined = empty). */
  EntryDialog.prototype._readTableRowInputs = function ($row, columns) {
    const rowObj = {};
    let anyValue = false;
    for (const col of columns) {
      const dk = this._colKey(col);
      const $cell = $row.find(`[data-col-key="${dk}"]`).first();
      let cellVal;
      if (col.type === 'checkbox') {
        cellVal = $cell.is('input[type="checkbox"]')
          ? $cell.prop('checked') === true
          : String($cell.data('val')) === 'true';
      } else if ($cell.hasClass('nsd-tag-input-wrapper')) {
        cellVal = $cell.find('.nsd-select-value').val();
      } else if ($cell.is('input, select, textarea')) {
        cellVal = $cell.val();
      } else {
        cellVal = $cell.data('val');
      }
      if (this._isNumericType(col.type)) {
        cellVal = cellVal === '' || cellVal == null ? undefined : this._parseNumber(cellVal, col.type, col);
      } else if (col.type === 'date' || col.type === 'datetime') {
        cellVal = cellVal === '' || cellVal == null ? undefined : parseZoneDate(cellVal);
      } else if (col.type === 'time') {
        cellVal = cellVal === '' || cellVal == null ? undefined : this._parseTime(cellVal, col);
      }
      rowObj[dk] = cellVal;
      if (cellVal !== undefined && cellVal !== '') anyValue = true;
    }
    return { row: rowObj, anyValue: anyValue };
  };

  /** Re-render a row in the given mode (read-only unless active === true). */
  EntryDialog.prototype._rerenderTableRow = function ($row, active) {
    const cfg = this._getTableConfig($row);
    const entry = this._readTableRowValue($row);
    $row.replaceWith(this._buildTableRowHtml(cfg.columns, entry, cfg.field, active));
  };

  /**
   * Validate and commit an active row's inputs (shared by OK and the row-switch
   * auto-commit). Returns 'invalid' (alert shown, row stays active), 'empty'
   * (no values - nothing committed), or 'committed'.
   */
  EntryDialog.prototype._commitTableRow = function ($row, opts) {
    const cfg = this._getTableConfig($row);
    const read = this._readTableRowInputs($row, cfg.columns);
    const prevEntry = this._readTableRowValue($row);
    const $field = $row.closest('.nsd-table-field');
    const tableName = $field.length ? $field.data('field-name') : cfg.field ? cfg.field.name : null;
    const rowIndex = $field.length ? $field.find('.nsd-table-rows .nsd-table-row').index($row) : -1;
    // Per-column required/validate (visible columns only) - uses ctx with row scope
    for (const col of cfg.columns) {
      const dk = this._colKey(col);
      const colCtx = this._buildCtx({ table: tableName, column: col.name, rowIndex: rowIndex, value: read.row[dk] });
      const colVisible = col.visible == null ? true : this._resolveProp(col.visible, colCtx);
      if (!colVisible) continue;
      const isRequired = this._resolveProp(col.required, colCtx) === true;
      if (isRequired) {
        const v = read.row[dk];
        if (v === undefined || v === '') {
          $row.addClass('nsd-field-invalid');
          const fieldLabel = (cfg.field && (cfg.field.label || cfg.field.name)) || 'Field';
          alert(`${fieldLabel}: ${col.label || dk} is required`);
          return 'invalid';
        }
      }
      if (typeof col.validate === 'function') {
        const v = read.row[dk];
        let ok = true;
        try {
          ok = col.validate(v, colCtx);
        } catch (e) {
          safeLog('error', `${MODULE_NAME}:validate`, (e && e.message) || e);
          ok = true;
        }
        if (!ok) {
          $row.addClass('nsd-field-invalid');
          // revert this cell to previous value
          const prevVal = prevEntry ? prevEntry[dk] : undefined;
          // find cell and revert via DOM helper
          const $cell = $row.find(`[data-col-key="${dk}"]`).first();
          if ($cell.length) {
            if ($cell.is('input, select')) $cell.val(prevVal != null ? String(prevVal) : '');
            else if ($cell.hasClass('nsd-tag-input-wrapper')) {
              $cell.find('.nsd-select-value').val(prevVal != null ? String(prevVal) : '');
            }
          }
          return 'invalid';
        }
      }
    }
    if (!read.anyValue) return 'empty';
    // Whole-row gate: field.validateRow runs on non-blank committed rows, after
    // per-column required/validate. false silently blocks (row stays active +
    // flagged) - no alert - consistent with the per-column validate path.
    if (cfg.field && typeof cfg.field.validateRow === 'function') {
      const rowCtx = this._buildCtx({ table: tableName, rowIndex: rowIndex, value: read.row });
      let rowOk = true;
      try {
        rowOk = cfg.field.validateRow(read.row, rowCtx) !== false;
      } catch (e) {
        safeLog('error', `${MODULE_NAME}:validateRow`, (e && e.message) || e);
        rowOk = true;
      }
      if (!rowOk) {
        $row.addClass('nsd-field-invalid');
        return 'invalid';
      }
    }
    $row.find('.nsd-table-row-value').val(JSON.stringify(read.row));
    this._rerenderTableRow($row, false);
    this._editorDirty = true;
    // Per-column onChange for changed cells
    for (const col of cfg.columns) {
      if (typeof col.onChange !== 'function') continue;
      const dk = this._colKey(col);
      const prevVal = prevEntry ? prevEntry[dk] : undefined;
      const newVal = read.row[dk];
      if (String(prevVal) === String(newVal)) continue;
      const colCtx = this._buildCtx({ table: tableName, column: col.name, rowIndex: rowIndex, value: newVal });
      // extend ctx to have row-scoped helpers already via _buildCtx
      try {
        col.onChange(colCtx);
      } catch (e) {
        safeLog('error', `${MODULE_NAME}:onChange`, (e && e.message) || e);
      }
    }
    // Generic table-field change dispatch (committed row value); the reload
    // path passes { noDispatch: true } and dispatches once itself afterward.
    if ($field.length && !(opts && opts.noDispatch)) {
      this._dispatchTableFieldChange($field.data('field-name'));
    }
    return 'committed';
  };

  /**
   * Run a table column's validate fn live, the moment a cell is edited (blur /
   * enter / change). On failure the cell is silently reverted to its committed
   * value and the row flagged .nsd-field-invalid. Empty values are skipped
   * here - empty is a commit-time / required concern. Single-select cells
   * (no native change) still validate at commit.
   */
  EntryDialog.prototype._validateTableCellLive = function ($el) {
    if (!$el || !$el.length) return;
    const $row = $el.closest('.nsd-table-row');
    if (!$row.length) return;
    const cfg = this._getTableConfig($row);
    if (!cfg || !cfg.field) return;
    const $cell = $el.is('.nsd-table-cell') ? $el : $el.closest('.nsd-table-cell');
    const dk = $el.attr('data-col-key') || ($cell.length ? $cell.attr('data-col-key') : null);
    if (dk == null) return;
    const col = (cfg.columns || []).filter(
      function (c) {
        return this._colKey(c) === dk;
      }.bind(this)
    )[0];
    if (!col) return;
    if (typeof col.validate !== 'function') return;
    const $field = $cell.closest('.nsd-table-field');
    const tableName = $field.length ? $field.data('field-name') : null;
    const rowIndex = $field.length ? $field.find('.nsd-table-rows .nsd-table-row').index($row) : -1;
    const read = this._readTableRowInputs($row, cfg.columns);
    const val = read.row[dk];
    // Empty (or not-yet-entered) non-required values are allowed at edit time;
    // required gates them at commit. Also avoids Number('')-style NaN traps.
    if (val === undefined || val === '') return;
    const colCtx = this._buildCtx({ table: tableName, column: col.name, rowIndex: rowIndex, value: val });
    const colVisible = col.visible == null ? true : this._resolveProp(col.visible, colCtx);
    if (!colVisible) return;
    let ok = true;
    try {
      ok = col.validate(val, colCtx);
    } catch (e) {
      safeLog('error', `${MODULE_NAME}:validate`, (e && e.message) || e);
      ok = true;
    }
    if (ok) return;
    // Revert this cell to its committed value (from the hidden row JSON).
    const prevEntry = this._readTableRowValue($row);
    const prevVal = prevEntry ? prevEntry[dk] : undefined;
    const $ctrl = $el.is('input, select, textarea') ? $el : $cell.find('input, select, textarea').first();
    if ($ctrl.length) {
      if ($ctrl.attr('type') === 'checkbox') {
        $ctrl.prop('checked', prevVal === true || prevVal === 1 || prevVal === '1' || prevVal === 'true');
      } else if ($cell.hasClass('nsd-tag-input-wrapper')) {
        const pv = prevVal != null ? String(prevVal) : '';
        $cell.find('.nsd-select-value').val(pv);
        if (this._syncSelectValue) this._syncSelectValue($cell, pv);
      } else if (this._isNumericType(col.type)) {
        $ctrl.val(prevVal != null && prevVal !== '' ? this._formatNumber(prevVal, col.type, col) : '');
      } else if (col.type === 'date' || col.type === 'datetime') {
        const isDateTime = col.type !== 'date';
        const p = prevVal != null && prevVal !== '' ? parseZoneDate(prevVal) : null;
        const pd = p && !isNaN(p.getTime()) ? p : null;
        $ctrl.val(pd ? (isDateTime ? this._toDatetimeLocal(pd) : toLocalDateStr(pd)) : '');
      } else if (col.type === 'time') {
        $ctrl.val(prevVal != null && prevVal !== '' ? this._formatTime(prevVal, col) : '');
      } else {
        $ctrl.val(prevVal != null ? String(prevVal) : '');
      }
    }
    $row.addClass('nsd-field-invalid');
  };

  /**
   * Read a table field's committed rows (non-empty entries only, like Save)
   * and dispatch a field change so onChange/summary/dependents stay live.
   */
  EntryDialog.prototype._dispatchTableFieldChange = function (fieldName) {
    if (!fieldName) return;
    const self = this;
    const $editor = this._$editor;
    if (!$editor || !$editor.length) return;
    const $field = $editor
      .find('.nsd-table-field')
      .filter(function () {
        return this.getAttribute('data-field-name') === fieldName;
      })
      .first();
    if (!$field.length) return;
    const rows = [];
    $field.find('.nsd-table-rows .nsd-table-row-value').each(function () {
      let entry = {};
      try {
        entry = JSON.parse(self.$(this).val() || '{}');
      } catch (e) {
        entry = {};
      }
      const hasValue = Object.keys(entry).some(function (k) {
        return entry[k] !== undefined && entry[k] !== '';
      });
      if (hasValue) rows.push(entry);
    });
    this._onUserFieldChange(fieldName, rows);
  };

  // ========== Tag Input Multi-Select ==========

  EntryDialog.prototype._initTagInputs = function ($container) {
    let self = this;
    $container.find('.nsd-tag-input-wrapper').each(function () {
      let $wrapper = self.$(this);
      // Skip single-select and read-only wrappers
      if ($wrapper.hasClass('nsd-single-select')) return;
      if ($wrapper.hasClass('nsd-field-readonly')) return;
      let $hidden = $wrapper.find('.nsd-tag-value');
      let $input = $wrapper.find('.nsd-tag-input');
      let $dropdown = $wrapper.find('.nsd-tag-dropdown');
      let $placeholder = $wrapper.find('.nsd-tag-placeholder');

      // Chips are synced via _syncMultiChips (shared with setValue and the
      // options-rebuild path); chip edits fire `fieldchange` on the wrapper so
      // the generic dispatch updates values, dependents, summaries, onChange.

      // Click input → toggle dropdown
      $input.on('click', function (e) {
        // The remove affordance now holds an SVG, so e.target is that child,
        // not the span itself: match the ancestor instead of the target class.
        if (self.$(e.target).closest('.nsd-tag-chip-remove').length) return;
        $dropdown.toggle();
        if ($dropdown.is(':visible')) {
          $input.focus();
          // Close all other dropdowns
          self.$('.nsd-tag-dropdown').not($dropdown).hide();
          self._positionDropdown($wrapper, $dropdown);
          // Add search input on first open
          if (!$dropdown.find('.nsd-tag-search').length && $dropdown.find('.nsd-tag-option').length > 1) {
            let $search = self.$('<input type="text" class="nsd-tag-search" placeholder="Search...">');
            $dropdown.prepend($search);
            $search.on('input', function () {
              let q = self.$(this).val().toLowerCase();
              let visible = 0;
              $dropdown.find('.nsd-tag-option').each(function () {
                // Match the operator name only (data-label) - never the ⚠ glyph or the hidden message
                let match = (self.$(this).data('label') || self.$(this).text()).toLowerCase().indexOf(q) !== -1;
                self.$(this).toggle(match);
                if (match) visible++;
              });
              let $noRes = $dropdown.find('.nsd-tag-no-results-msg');
              if (q.length > 0 && visible === 0) {
                if (!$noRes.length) {
                  $noRes = self.$('<div class="nsd-tag-no-results nsd-tag-no-results-msg">No results</div>');
                  $dropdown.append($noRes);
                }
                $noRes.show();
              } else {
                $noRes.hide();
              }
            });
            $search.focus();
          }
        } else {
          // Reset search when closing
          let $search = $dropdown.find('.nsd-tag-search');
          if ($search.length) {
            $search.val('');
            $dropdown.find('.nsd-tag-option').show();
            $dropdown.find('.nsd-tag-no-results-msg').hide();
          }
        }
      });

      // Multi-select: close dropdown on blur
      // Remove chip click
      $input.on('click', '.nsd-tag-chip-remove', function () {
        let $chip = self.$(this).closest('.nsd-tag-chip');
        let val = $chip.data('val');
        let vals = [];
        try {
          vals = JSON.parse($hidden.val() || '[]');
        } catch (e) {
          vals = [];
        }
        let idx = vals.indexOf(String(val));
        if (idx !== -1) vals.splice(idx, 1);
        $hidden.val(JSON.stringify(vals));
        self._syncMultiChips($wrapper);
        $input.focus();
        $wrapper.trigger('fieldchange');
      });

      // Option click in dropdown
      $dropdown.on('click', '.nsd-tag-option', function () {
        let $opt = self.$(this);
        if ($opt.hasClass('disabled')) return; // on leave, can't toggle
        self._hideWarnTooltip();
        let val = $opt.data('val');
        let vals = [];
        try {
          vals = JSON.parse($hidden.val() || '[]');
        } catch (e) {
          vals = [];
        }
        let idx = vals.indexOf(String(val));
        if (idx !== -1) {
          vals.splice(idx, 1);
        } else {
          vals.push(String(val));
        }
        $hidden.val(JSON.stringify(vals));
        self._syncMultiChips($wrapper);
        $wrapper.trigger('fieldchange');
      });

      // Initial render
      self._syncMultiChips($wrapper);
    });

    // Close dropdowns on click outside
    if (!this._tagInputDocHandler) {
      this._tagInputDocHandler = true;
      this.$(document).on(`mousedown${this.ns}-tag`, function (e) {
        let $target = self.$(e.target);
        if (!$target.closest('.nsd-tag-input-wrapper').length) {
          self.$('.nsd-tag-dropdown').hide();
          self._hideWarnTooltip();
        }
      });
    }

    // Option-hint + summary hover tooltips (display-only; selection unchanged).
    // The dropdown's overflow-y clips CSS tooltips, so reuse the chart $tooltip
    // and position it at the cursor like showTooltip does. Option rows carry
    // data-hint-msg / data-hint-color; field summaries carry data-summary-msg
    // and data-summary-bg/data-summary-textcolor. Delegated, so they survive
    // dropdown rebuilds.
    if (!this._tagTooltipDocHandler) {
      this._tagTooltipDocHandler = true;
      this._$editor.on(`mouseenter${this.ns}-tagtip`, '.nsd-tag-option[data-hint-msg]', function (e) {
        const $opt = self.$(this);
        const msg = $opt.data('hint-msg');
        const color = $opt.data('hint-color') || '';
        const textColor = $opt.data('hint-textcolor') || '';
        if (msg) self._showWarnTooltip(e, msg, color, textColor);
      });
      this._$editor.on(`mouseenter${this.ns}-tagtip`, '.nsd-summary-warn', function (e) {
        const $sum = self.$(this);
        const msg = $sum.data('summary-msg');
        const bg = $sum.data('summary-bg') || '';
        const textColor = $sum.data('summary-textcolor') || '';
        if (msg) self._showWarnTooltip(e, msg, bg, textColor);
      });
      this._$editor.on(`mouseleave${this.ns}-tagtip`, '.nsd-tag-option, .nsd-summary-warn', function () {
        self._hideWarnTooltip();
      });
    }
  };

  /**
   * Position a dropdown when it opens: downward by default, flipping up only
   * when it would cross the editor popup's bottom edge ("bottom edge of the
   * screen"). Clamped left/top within the popup so it never overflows the
   * visible editor area (which avoids adding a scrollbar to
   * .nsd-editor-fields). Fixed positioning escapes any scroll/clip
   * container. Shared by single-select, multi-select and table-cell dropdowns.
   */
  EntryDialog.prototype._positionDropdown = function ($wrapper, $dropdown) {
    const $screen = this._$editor;
    const s = $screen && $screen[0] ? $screen[0].getBoundingClientRect() : null;
    const r = $wrapper[0].getBoundingClientRect();
    const w = Math.max($wrapper.outerWidth() || 0, 200);
    const dh = $dropdown.outerHeight() || 180;
    let left = s ? Math.max(s.left, Math.min(r.left, s.right - w)) : r.left;
    let top;
    if (!s || r.bottom + dh <= s.bottom) {
      top = r.bottom + 2; // downward
    } else {
      top = Math.max(s.top, r.top - dh - 2); // flip up, clamp to popup
    }
    $dropdown.css({ position: 'fixed', left: `${left}px`, top: `${top}px`, width: `${w}px` });
  };

  /**
   * Rebuild the option list + dropdown of a select/machine/multi-select field
   * from its (function) options resolved against the snapshot. The selection
   * is ALWAYS cleared first (a reload follows a changed dependency); the clear
   * fires the field's onChange like any effective setValue (visited-guarded)
   * so declared triggers cascade. Summaries refresh with the new selection.
   */
  EntryDialog.prototype._rebuildFieldOptions = function (field) {
    const fieldName = field.name;
    let options = field.options;
    if (typeof options === 'function') {
      try {
        options = options.call(this.$el && this.$el[0] ? this.$el[0] : null, { getValue: (n) => this.getValue(n) });
      } catch (e) {
        safeLog('error', `${MODULE_NAME}:options`, (e && e.message) || e);
        return;
      }
    }
    if (!Array.isArray(options)) options = [];

    // A reload always clears the field's selection: its options are re-derived
    // from a changed dependency (work center -> machine -> operators), so any
    // prior choice is stale by design. The clear is an effective value change
    // and fires the field's onChange (visited-guarded) so dependent chains
    // empty in turn.
    const current = this.getValue(fieldName);
    const cleared = this._normalizeFieldValue(field, '');
    const valChanged = !this._valuesEqual(current, cleared);
    if (valChanged) {
      this._editorValues[fieldName] = cleared;
      this._snapshotCache = null;
      this._editorDirty = true;
    }

    this._rebuildFieldDropdown(field, options, cleared);

    // The clear is an effective value change - fire onChange like any other
    // (the per-gesture visited set keeps cycles finite).
    if (valChanged && typeof field.onChange === 'function') {
      const visited = this._fieldChangeVisited || (this._fieldChangeVisited = new Set());
      if (!visited.has(String(fieldName))) {
        visited.add(String(fieldName));
        this._runOnChange(field, cleared, {});
      }
    }

    this._refreshFieldSummary(fieldName, cleared);
  };

  /**
   * Re-render a field's dropdown rows + selection in place: existing option
   * nodes are replaced (the dynamic search input and its handlers survive),
   * the hidden value and displayed label/chips sync to `value`.
   */
  EntryDialog.prototype._rebuildFieldDropdown = function (field, options, value) {
    const self = this;
    const $editor = this._$editor;
    if (!$editor || !$editor.length) return;
    const fieldName = field.name;
    const isMulti = field.type === 'multi-select';
    const $wrapper = $editor
      .find(isMulti ? '.nsd-tag-input-wrapper:not(.nsd-single-select)' : '.nsd-tag-input-wrapper.nsd-single-select')
      .filter(function () {
        return this.getAttribute('data-field-name') === fieldName;
      })
      .first();
    if (!$wrapper.length) return;

    const $dd = $wrapper.find('.nsd-tag-dropdown');
    $dd.find('.nsd-tag-option').remove();
    // Clear any previously rendered empty-state row too - a rebuild that now
    // has options must not leave the stale "No options available." message
    // beside the new rows (the transient search "No results" node shares the
    // class and is recreated on demand).
    $dd.find('.nsd-tag-no-results').remove();
    if (options.length === 0) {
      // Empty option list: render the empty-state row so the open dropdown has
      // a clear message instead of collapsing to a ~1px sliver.
      $dd.append('<div class="nsd-tag-no-results">No options available.</div>');
    } else {
      options.forEach(function (opt) {
        const n = self._normalizeOption(opt);
        const isSel = String(value) === n.val;
        $dd.append(
          self.$(
            self._buildOptionRowHtml(
              opt,
              n.val,
              n.text,
              isMulti ? (Array.isArray(value) ? value.indexOf(n.val) !== -1 : false) : isSel
            )
          )
        );
      });
    }

    if (isMulti) {
      const vals = Array.isArray(value) ? value.map(String) : [];
      $wrapper.find('.nsd-tag-value').val(JSON.stringify(vals));
      this._syncMultiChips($wrapper);
    } else {
      this._syncSelectValue($wrapper, value);
    }
  };

  /**
   * Sync the hidden value + displayed label of a single-select wrapper.
   */
  EntryDialog.prototype._syncSelectValue = function ($wrapper, value) {
    const self = this;
    const val = value == null ? '' : String(value);
    $wrapper.find('.nsd-select-value').val(val);
    let display = val;
    $wrapper.find('.nsd-tag-option').each(function () {
      const $opt = self.$(this);
      const isSel = String($opt.data('val')) === val;
      $opt.toggleClass('selected', isSel);
      if (isSel) display = $opt.data('label') || $opt.text().trim();
    });
    $wrapper.find('.nsd-select-label').text(display || '');
  };

  /**
   * Rebuild a multi-select wrapper's chips from its hidden JSON value (chips
   * render in selection order; values absent from the dropdown options render
   * as raw text - defensive, e.g. data carrying an id beyond the current
   * option list). Shared by the tag input initialization and setValue/rebuild
   * paths.
   */
  EntryDialog.prototype._syncMultiChips = function ($wrapper) {
    const self = this;
    const $hidden = $wrapper.find('.nsd-tag-value');
    const $input = $wrapper.find('.nsd-tag-input');
    const $dropdown = $wrapper.find('.nsd-tag-dropdown');
    const $placeholder = $wrapper.find('.nsd-tag-placeholder');
    let vals = [];
    try {
      vals = JSON.parse($hidden.val() || '[]');
    } catch (e) {
      vals = [];
    }
    $input.find('.nsd-tag-chip').remove();
    const optTextByVal = {};
    $dropdown.find('.nsd-tag-option').each(function () {
      const $opt = self.$(this);
      const optVal = String($opt.data('val'));
      optTextByVal[optVal] = $opt.data('label') || $opt.text().trim();
      const isSel = vals.indexOf(optVal) !== -1;
      $opt.toggleClass('selected', isSel);
    });
    vals.forEach(function (val) {
      const raw = String(val);
      // Values absent from the dropdown options (e.g. carried in data)
      // render as raw-text chips.
      const optText = optTextByVal[raw] !== undefined ? optTextByVal[raw] : raw;
      const $chip = self.$(
        `<span class="nsd-tag-chip" data-val="${escapeHtml(raw)}"><span class="nsd-tag-chip-text">${escapeHtml(optText)}</span><span class="nsd-tag-chip-remove" role="button" tabindex="0" title="Remove" aria-label="Remove">${CLOSE_ICO_SVG}</span></span>`
      );
      $input.find('.nsd-tag-placeholder').before($chip);
    });
    $placeholder.toggle(vals.length === 0);
  };

  /**
   * The merged snapshot passed to options/summary/onChange consumers: the
   * editor's base data overlaid with the current in-editor values,
   * so every consumer sees the state as-of-now (e.g. a just-picked machineId).
   */
  EntryDialog.prototype._editorSnapshot = function () {
    // Cache the composed snapshot until an in-editor value changes; each caller
    // receives its own shallow top-level copy (distinct object, shared nested
    // references). Nested refs stay valid because the editor reassigns
    // arrays/dates on change rather than mutating them in place.
    if (this._snapshotCache == null) {
      const base = this._currentData || {};
      const snapshot = this.$.extend({}, base);
      Object.keys(this._editorValues || {}).forEach(function (key) {
        const v = this._editorValues[key];
        if (Array.isArray(v)) snapshot[key] = v.slice();
        else if (v instanceof Date) snapshot[key] = new Date(v.getTime());
        else if (v && typeof v === 'object') snapshot[key] = this.$.extend({}, v);
        else snapshot[key] = v;
      }, this);
      this._snapshotCache = snapshot;
    }
    return this.$.extend({}, this._snapshotCache);
  };

  EntryDialog.prototype.getValue = function (fieldName) {
    if (this._editorValues && this._editorValues[fieldName] !== undefined) {
      const v = this._editorValues[fieldName];
      if (Array.isArray(v)) return v.slice();
      if (v instanceof Date) return new Date(v.getTime());
      return v;
    }
    if (this._currentData && this._currentData[fieldName] !== undefined) {
      return this._currentData[fieldName];
    }
    return null;
  };

  /**
   * Set a field's value programmatically and commit it through the change
   * pipeline (DOM write + values map + dependent options + summary + onChange,
   * unless opts.ignoreFieldChange suppresses the target's own onChange). Works
   * on every field type, including read-only static targets. A no-op when the
   * value is unchanged. Chainable.
   */
  EntryDialog.prototype.setValue = function (fieldName, value, opts) {
    opts = opts || {};
    const field = this._getLayoutField(fieldName);
    if (!field) return this;
    const type = field.type;
    const $editor = this._$editor;
    if (!$editor || !$editor.length) return this;

    const normalized = this._normalizeFieldValue(field, value);
    if (this._valuesEqual(this._editorValues[fieldName], normalized)) return this;

    const self = this;
    const findByName = function ($collection) {
      return $collection.filter(function () {
        return this.getAttribute('data-field-name') === fieldName;
      });
    };

    if (type === 'select') {
      const $wrapper = findByName($editor.find('.nsd-tag-input-wrapper.nsd-single-select')).first();
      if ($wrapper.length) this._syncSelectValue($wrapper, normalized);
    } else if (type === 'multi-select') {
      const $wrapper = findByName($editor.find('.nsd-tag-input-wrapper:not(.nsd-single-select)')).first();
      if ($wrapper.length) {
        const vals = Array.isArray(normalized) ? normalized : [];
        $wrapper.find('.nsd-tag-value').val(JSON.stringify(vals));
        this._syncMultiChips($wrapper);
      }
    } else if (type === 'checkbox') {
      findByName($editor.find('.nsd-checkbox-input')).prop('checked', !!normalized);
    } else if (type === 'checkbox-group') {
      const sel = Array.isArray(normalized) ? normalized.map(String) : [];
      findByName($editor.find('.nsd-cb-group-item')).each(function () {
        self.$(this).prop('checked', sel.indexOf(String(self.$(this).data('val'))) !== -1);
      });
    } else if (type === 'table') {
      const $field = findByName($editor.find('.nsd-table-field')).first();
      if ($field.length) {
        const cols = Array.isArray(field.columns) ? field.columns : [];
        const rowsArr = Array.isArray(normalized) ? normalized : [];
        let rowsHtml = '';
        rowsArr.forEach(function (entry) {
          rowsHtml += this._buildTableRowHtml(cols, entry || {}, field, false);
        }, this);
        $field.find('.nsd-table-rows').html(rowsHtml);
        $field.find('.nsd-field-invalid').removeClass('nsd-field-invalid');
      }
    } else {
      // text / textarea / numeric / date / datetime: write the input value.
      const $input = findByName($editor.find('.nsd-editor-field')).first();
      if ($input.length) {
        let inputVal = normalized;
        if ((type === 'date' || type === 'datetime') && inputVal instanceof Date) {
          inputVal = type === 'date' ? toLocalDateStr(inputVal) : this._toDatetimeLocal(inputVal);
        } else if (type === 'time') {
          inputVal = inputVal !== '' && inputVal != null ? this._formatTime(inputVal, field) : '';
        } else if (this._isNumericType(type) && inputVal !== '' && inputVal != null) {
          inputVal = this._formatNumber(inputVal, type, field);
        }
        $input.val(inputVal == null ? '' : String(inputVal));
      } else {
        // Read-only static target: update the text in place.
        const $static = findByName($editor.find('.nsd-field-readonly')).first();
        if ($static.length) {
          const display =
            normalized == null || normalized === ''
              ? ''
              : Array.isArray(normalized)
                ? normalized.join(', ')
                : String(normalized);
          $static.html(display ? escapeHtml(display) : '&nbsp;');
        }
      }
    }

    this._processFieldChange(fieldName, normalized, { ignoreFieldChange: opts.ignoreFieldChange === true });
    return this;
  };

  /**
   * Rebuild one field's options against the live editor snapshot: re-resolve,
   * clear the selection, re-render the dropdown and refresh the summary. This
   * is the consumer-declared trigger - a driver
   * field's onChange calls reloadOptions('<dependent>') when the dependent
   * options must follow (e.g. machine -> operators).
   */
  EntryDialog.prototype.reloadOptions = function (fieldName) {
    const field = this._getLayoutField(fieldName);
    if (field) {
      this._rebuildFieldOptions(field);
      this._refreshFieldUi();
      return this;
    }
    // table column case
    const fields =
      this._activeFormLayout && Array.isArray(this._activeFormLayout.fields) ? this._activeFormLayout.fields : [];
    for (let i = 0; i < fields.length; i++) {
      const tbl = fields[i];
      if (tbl && tbl.type === 'table' && Array.isArray(tbl.columns)) {
        const col = tbl.columns.find(function (c) {
          return c && c.name === fieldName;
        });
        if (col) {
          this._rerenderTableField(tbl);
          this._refreshFieldUi();
          return this;
        }
      }
    }
    this._refreshFieldUi();
    return this;
  };

  /**
   * Re-render a table field's rows so their options re-resolve against the
   * live snapshot. A still-active row is auto-committed first (like OK / row
   * switch) so its edits are not lost; if it is invalid the row stays active.
   */
  EntryDialog.prototype._rerenderTableField = function (field) {
    if (!this._$editor || !field) return;
    const self = this;
    const $field = this._$editor
      .find('.nsd-table-field')
      .filter(function () {
        return this.getAttribute('data-field-name') === String(field.name);
      })
      .first();
    if (!$field || !$field.length) return;
    const $active = $field.find('.nsd-table-rows .nsd-table-row.active').first();
    if ($active.length) {
      const read = this._readTableRowInputs($active, Array.isArray(field.columns) ? field.columns : []);
      if (!read.anyValue) {
        $active.remove();
      } else if (this._commitTableRow($active, { noDispatch: true }) === 'invalid') {
        return; // keep the invalid row active for the user to fix
      }
    }
    const cols = Array.isArray(field.columns) ? field.columns : [];
    const rows = [];
    $field.find('.nsd-table-rows .nsd-table-row-value').each(function () {
      let entry = {};
      try {
        entry = JSON.parse(self.$(this).val() || '{}');
      } catch (e) {
        entry = {};
      }
      rows.push(entry);
    });
    let rowsHtml = '';
    // Restore the table empty-state when empty and non-addable/readonly (so a
    // reload that empties the table keeps the "No records available." placeholder).
    const isTableReadonly =
      (field && this._resolveProp(field.readonly, this._buildCtx()) === true) ||
      (this._activeFormLayout && this._activeFormLayout.view === true);
    if (rows.length === 0 && (isTableReadonly || field.allowAdd === false)) {
      rowsHtml += '<div class="nsd-table-empty">No records available.</div>';
    }
    rows.forEach(function (entry) {
      rowsHtml += self._buildTableRowHtml(cols, entry || {}, field, false);
    });
    $field.find('.nsd-table-rows').html(rowsHtml);
    $field.find('.nsd-field-invalid').removeClass('nsd-field-invalid');
    // Single dispatch for the whole reload so dependents/summary/onChange see
    // the latest rows; a no-op when the committed rows did not change.
    this._dispatchTableFieldChange(field.name);
  };

  /**
   * Run a field's onChange callback with the consumer context. Any throw is
   * logged and swallowed so one bad handler never breaks the editor. onChange
   * fires on direct user edits AND on effective setValue changes (cascade),
   * guarded by the per-gesture visited set; ignoreFieldChange opts out.
   */
  EntryDialog.prototype._buildCtx = function (extra) {
    const self = this;
    const values = this._editorSnapshot ? this._editorSnapshot() : {};
    const base = {
      values: values,
      value: undefined,
      getValue: function (n) {
        return self.getValue(n);
      },
      setValue: function (n, v, o) {
        return self.setValue(n, v, o);
      },
      getTableValue: function (table, col, idx) {
        const arr = self.getValue(table);
        if (!Array.isArray(arr) || idx < 0 || idx >= arr.length) return null;
        const row = arr[idx];
        return row ? row[col] : null;
      },
      setTableValue: function (table, col, val, idx) {
        const arr = self.getValue(table);
        if (!Array.isArray(arr) || idx < 0 || idx >= arr.length) return self;
        const copy = arr.slice();
        const row = Object.assign({}, copy[idx] || {});
        row[col] = val;
        copy[idx] = row;
        return self.setValue(table, copy);
      },
    };
    // reloadOptions is a select-field-only concern - attach it only when the
    // scoped field is a select/multi-select (resolved by name).
    if (extra && extra.name != null) {
      const fld = this._getLayoutField(extra.name);
      const ftype = fld ? fld.type : null;
      if (ftype === 'select' || ftype === 'multi-select') {
        base.reloadOptions = function (n) {
          return self.reloadOptions(n);
        };
      }
    }
    if (extra) Object.assign(base, extra);
    return base;
  };

  EntryDialog.prototype._resolveProp = function (prop, ctx) {
    if (typeof prop === 'function') {
      try {
        return prop(ctx);
      } catch (e) {
        safeLog('error', `${MODULE_NAME}:resolveProp`, (e && e.message) || e);
        return null;
      }
    }
    return prop;
  };

  EntryDialog.prototype._normalizeFieldValue = function (field, value) {
    const type = field && field.type;
    if (value == null) value = '';
    if (type === 'multi-select' || type === 'checkbox-group') {
      if (Array.isArray(value)) return value.map(String);
      return value ? [String(value)] : [];
    }
    if (type === 'checkbox') {
      return value === true || value === 1 || value === '1' || value === 'true' || value === 'T';
    }
    if (this._isNumericType(type)) {
      return this._parseNumber(value, type, field);
    }
    if (type === 'time') {
      return this._parseTime(value, field);
    }
    if (type === 'table') {
      return Array.isArray(value) ? value : [];
    }
    if (type === 'select') {
      return value == null ? '' : String(value);
    }
    return value;
  };

  /**
   * Deep-ish equality for editor values: primitives by value, Dates by time,
   * arrays/objects by JSON (order-sensitive, which is correct for multi-select
   * selection order and table rows).
   */
  EntryDialog.prototype._valuesEqual = function (a, b) {
    if (a === b) return true;
    if (Array.isArray(a) || Array.isArray(b)) {
      return JSON.stringify(a || []) === JSON.stringify(b || []);
    }
    if (a && b && typeof a === 'object' && typeof b === 'object') {
      if (a instanceof Date || b instanceof Date) {
        const da = a instanceof Date ? a.getTime() : parseZoneDate(a).getTime();
        const db = b instanceof Date ? b.getTime() : parseZoneDate(b).getTime();
        if (!isNaN(da) && !isNaN(db)) return da === db;
      }
      return JSON.stringify(a) === JSON.stringify(b);
    }
    return String(a) === String(b);
  };

  /**
   * Central change pipeline. Every user edit (via the delegated change/fieldchange
   * handlers) and every effective setValue lands here: normalize + store the
   * value, propagate to dependent options (auto re-resolve + stale pruning),
   * refresh summaries, then fire the field's onChange unless suppressed by the
   * gesture's visited set or ignoreFieldChange. No-op when the value did not
   * actually change.
   */
  EntryDialog.prototype._processFieldChange = function (fieldName, rawValue, opts) {
    opts = opts || {};
    const field = this._getLayoutField(fieldName);
    if (!field) return;
    const normalized = this._normalizeFieldValue(field, rawValue);
    const prev = this._editorValues[fieldName];
    if (this._valuesEqual(prev, normalized)) return;

    if (typeof field.validate === 'function') {
      const vCtx = this._buildCtx({ name: fieldName, value: normalized });
      let ok = true;
      try {
        ok = field.validate(normalized, vCtx);
      } catch (e) {
        safeLog('error', `${MODULE_NAME}:validate`, (e && e.message) || e);
        ok = true;
      }
      if (!ok) {
        this._revertFieldDom(fieldName, prev);
        return;
      }
    }

    this._editorValues[fieldName] = normalized;
    this._snapshotCache = null;
    this._editorDirty = true;

    const visited = this._fieldChangeVisited || (this._fieldChangeVisited = new Set());
    const alreadyFired = visited.has(String(fieldName));
    visited.add(String(fieldName));

    // Dependent options are NOT re-resolved here - rebuilds are consumer-owned:
    // a field's onChange calls ctx.reloadOptions('<dependent>') explicitly.
    this._refreshFieldSummary(fieldName, normalized);
    this._refreshFieldUi();

    if (typeof field.onChange === 'function' && !alreadyFired && opts.ignoreFieldChange !== true) {
      this._runOnChange(field, normalized, opts);
    }
  };

  /**
   * Entry point for direct user edits: starts a fresh per-gesture visited set
   * so cascades (setValue -> onChange -> setValue) fire each field at most once
   * per gesture and cycles are cut.
   */
  EntryDialog.prototype._onUserFieldChange = function (fieldName, rawValue) {
    this._fieldChangeVisited = new Set();
    this._processFieldChange(fieldName, rawValue, {});
  };

  EntryDialog.prototype._runOnChange = function (field, value, opts) {
    const ctx = this._buildCtx({ name: field.name, value: value });
    try {
      field.onChange.call(this.$el && this.$el[0] ? this.$el[0] : null, ctx);
    } catch (e) {
      safeLog('error', `${MODULE_NAME}:onChange`, (e && e.message) || e);
    }
  };

  EntryDialog.prototype._revertFieldDom = function (fieldName, prevValue) {
    if (!this._$editor || !this._$editor.length) return;
    const field = this._getLayoutField(fieldName);
    if (!field) return;
    const type = field.type;
    const self = this;
    const $editor = this._$editor;
    const findByName = function ($col) {
      return $col.filter(function () {
        return this.getAttribute('data-field-name') === String(fieldName);
      });
    };
    if (type === 'select') {
      const $w = findByName($editor.find('.nsd-tag-input-wrapper.nsd-single-select')).first();
      if ($w.length) self._syncSelectValue($w, prevValue != null ? String(prevValue) : '');
    } else if (type === 'multi-select') {
      const $w = findByName($editor.find('.nsd-tag-input-wrapper:not(.nsd-single-select)')).first();
      if ($w.length) {
        const arr = Array.isArray(prevValue) ? prevValue : prevValue ? [String(prevValue)] : [];
        $w.find('.nsd-tag-value').val(JSON.stringify(arr.map(String)));
        self._syncMultiChips($w);
      }
    } else if (
      type === 'text' ||
      type === 'textarea' ||
      type === 'date' ||
      type === 'datetime' ||
      type === 'time' ||
      this._isNumericType(type)
    ) {
      const $inp = findByName($editor.find('.nsd-editor-field')).first();
      if ($inp.length) {
        let v = prevValue != null ? String(prevValue) : '';
        if ((type === 'date' || type === 'datetime') && prevValue instanceof Date) {
          v = type === 'date' ? toLocalDateStr(prevValue) : self._toDatetimeLocal(prevValue);
        } else if (type === 'time') {
          v = prevValue != null && prevValue !== '' ? self._formatTime(prevValue, field) : '';
        } else if (this._isNumericType(type) && prevValue !== '' && prevValue != null) {
          v = self._formatNumber(prevValue, type, field);
        }
        $inp.val(v);
      }
    } else if (type === 'checkbox') {
      findByName($editor.find('.nsd-checkbox-input')).prop('checked', !!prevValue);
    } else if (type === 'checkbox-group') {
      const arr = Array.isArray(prevValue) ? prevValue.map(String) : [];
      $editor.find('.nsd-checkbox-group').each(function () {
        if (this.getAttribute('data-field-name') !== String(fieldName)) return;
        self
          .$(this)
          .find('.nsd-cb-group-item')
          .each(function () {
            const v = String(self.$(this).data('val'));
            self.$(this).prop('checked', arr.indexOf(v) !== -1);
          });
      });
    } else if (type === 'table') {
      const $field = findByName($editor.find('.nsd-table-field')).first();
      if ($field.length) {
        const cols = Array.isArray(field.columns) ? field.columns : [];
        let rowsHtml = '';
        const rowsArr = Array.isArray(prevValue) ? prevValue : [];
        rowsArr.forEach(function (entry) {
          rowsHtml += self._buildTableRowHtml(cols, entry || {}, field, false);
        });
        $field.find('.nsd-table-rows').html(rowsHtml);
        if (
          rowsArr.length === 0 &&
          (field.readonly === true ||
            (self._activeFormLayout && self._activeFormLayout.view === true) ||
            field.allowAdd === false)
        ) {
          if (!$field.find('.nsd-table-empty').length)
            $field.find('.nsd-table-rows').html('<div class="nsd-table-empty">No records available.</div>');
        }
      }
    }
  };

  /**
   * Build operator dropdown content: availability check + options + summary.
   * Returns { dropdownHtml, summaryHtml }.
   */
  EntryDialog.prototype._saveEditor = function () {
    const data = this._currentData;
    if (!data) {
      this.closeEditor();
      return;
    }
    // Validate required fields before applying changes (no undo entry on failure)
    const layout = this._activeFormLayout;
    const requiredConfig = layout && Array.isArray(layout.fields) ? layout.fields : [];
    let invalid = null;
    for (const f of requiredConfig) {
      if (!f) continue;
      const fvCtx = this._buildCtx({ name: f.name, value: this.getValue(f.name) });
      // Resolve required/readonly/visible at runtime (functions allowed) so a
      // visible+required+empty field alerts, while a hidden one never gates Save.
      if (this._resolveProp(f.required, fvCtx) !== true) continue;
      if (this._resolveProp(f.readonly, fvCtx) === true) continue;
      if (f.visible != null && this._resolveProp(f.visible, fvCtx) === false) continue;
      const $el = this._$editor.find(`[data-field-name="${f.name}"]`).first();
      let val;
      if ($el.hasClass('nsd-editor-field')) {
        val = $el.val();
      } else if ($el.hasClass('nsd-tag-input-wrapper')) {
        const $tag = $el.find('.nsd-tag-value');
        if ($tag.length) {
          try {
            val = JSON.parse($tag.val() || '[]');
          } catch (e) {
            val = [];
          }
        } else {
          val = $el.find('.nsd-select-value').val();
        }
      } else {
        continue; // element not rendered
      }
      if (val == null || val === '' || (Array.isArray(val) && val.length === 0)) {
        invalid = f;
        break;
      }
    }
    if (invalid) {
      this._$editor.find(`[data-field-name="${invalid.name}"]`).first().addClass('nsd-field-invalid');
      alert(`${invalid.label || invalid.name} is required`);
      return;
    }

    let self = this;

    // Commit a still-active row before reading (its edits live in the inputs)
    const $activeRow = this._$editor.find('.nsd-table-rows .nsd-table-row.active').first();
    if ($activeRow.length) {
      const cfg = this._getTableConfig($activeRow);
      const read = this._readTableRowInputs($activeRow, cfg.columns);
      $activeRow.find('.nsd-table-row-value').val(JSON.stringify(read.row));
    }

    // Validate table fields: field-level `required` (at least one non-empty
    // row) and column-level `required` (every non-empty row fills the column).
    // Fully empty rows are skipped. Rows are read from the committed hidden
    // values (a still-active row was auto-committed just above).
    const tableConfig = (layout && Array.isArray(layout.fields) ? layout.fields : []).filter(function (f) {
      return f && f.type === 'table';
    });
    for (let ti = 0; ti < tableConfig.length; ti++) {
      const tf = tableConfig[ti];
      const $tf = this._$editor.find(`[data-field-name="${tf.name}"].nsd-table-field`).first();
      if (!$tf.length) continue;
      const rows = [];
      $tf.find('.nsd-table-rows .nsd-table-row-value').each(function () {
        let entry = {};
        try {
          entry = JSON.parse(self.$(this).val() || '{}');
        } catch (e) {
          entry = {};
        }
        rows.push(entry);
      });
      const nonEmpty = rows.filter(function (r) {
        return Object.keys(r).some(function (k) {
          return r[k] !== undefined && r[k] !== '';
        });
      });
      let invalid = null;
      for (let ri = 0; ri < nonEmpty.length && !invalid; ri++) {
        for (const col of tf.columns || []) {
          if (col.required === true) {
            const v = nonEmpty[ri][this._colKey(col)];
            if (v === undefined || v === '') {
              invalid = { label: tf.label || tf.name, colLabel: col.label || this._colKey(col) };
              break;
            }
          }
        }
      }
      if (!invalid && tf.required === true && nonEmpty.length === 0) {
        invalid = { label: tf.label || tf.name, colLabel: '' };
      }
      if (invalid) {
        this._$editor.find(`[data-field-name="${tf.name}"].nsd-table-field`).first().addClass('nsd-field-invalid');
        alert(`${invalid.label || tf.name}${invalid.colLabel ? `: ${invalid.colLabel}` : ''} is required`);
        return;
      }
    }

    // Parse number fields (strip formatting); skip read-only static spans (inputs only)
    this._$editor.find('.nsd-number-field').each(function () {
      if (!self.$(this).is('input')) return;
      const $inp = self.$(this);
      const raw = $inp.val();
      const numType = $inp.attr('data-numtype') || 'decimal';
      const field = numType === 'currency' ? { decimalPlaces: $inp.attr('data-decimal-places') } : null;
      const cleaned = self._parseNumber(raw, numType, field);
      $inp.val(cleaned === '' ? '' : self._formatNumber(cleaned, numType, field));
    });

    // Build an updated COPY of the current data - never mutate it in place; the
    // edited field values below are merged onto the copy for the save payload.
    const updatedData = self.$.extend({}, data);

    // Save regular fields (text, number, textarea) and select values (from hidden)
    this._$editor.find('.nsd-editor-field').each(function () {
      // Read-only fields are never written back
      if (self.$(this).prop('readonly')) return;
      let fieldName = self.$(this).data('field-name');
      if (!fieldName) return; // skip table-cell inputs (have no data-field-name)
      let val = self.$(this).val();

      if (self.$(this).data('field-type') === 'date' || self.$(this).data('field-type') === 'datetime') {
        // Date fields: parse the input string back into a Date (empty -> null)
        updatedData[fieldName] = val ? parseZoneDate(val) : null;
      } else if (self.$(this).data('field-type') === 'time') {
        // Time fields: normalize to canonical 24h HH:MM (empty -> '')
        updatedData[fieldName] = self._parseTime(val, self._getLayoutField(fieldName));
      } else {
        updatedData[fieldName] = val;
      }
    });

    // Save single checkbox fields (boolean)
    this._$editor.find('.nsd-checkbox-input').each(function () {
      const fieldName = self.$(this).data('field-name');
      if (fieldName) updatedData[fieldName] = self.$(this).prop('checked') === true;
    });

    // Save checkbox-group fields (array of selected option ids; [] if none)
    this._$editor.find('.nsd-checkbox-group').each(function () {
      const fieldName = self.$(this).data('field-name');
      const vals = [];
      self
        .$(this)
        .find('.nsd-cb-group-item:checked')
        .each(function () {
          vals.push(self.$(this).data('val'));
        });
      updatedData[fieldName] = vals;
    });

    // Save select values from hidden inputs
    this._$editor.find('.nsd-select-value').each(function () {
      const fieldName = self.$(this).data('field-name');
      if (!fieldName) return; // table-cell selects carry only data-col-key
      updatedData[fieldName] = self.$(this).val() || null;
    });

    // Save tag input fields (multi-select / operators)
    this._$editor.find('.nsd-tag-input-wrapper').each(function () {
      if (self.$(this).hasClass('nsd-single-select')) return;
      if (self.$(this).hasClass('nsd-field-readonly')) return;
      let fieldName = self.$(this).data('field-name');
      let $hidden = self.$(this).find('.nsd-tag-value');
      let vals = [];
      try {
        vals = JSON.parse($hidden.val() || '[]');
      } catch (e) {
        vals = [];
      }
      updatedData[fieldName] = vals;
    });

    // Save table fields (arrays of row objects): read the committed hidden row
    // values; rows with no values at all are dropped
    this._$editor.find('.nsd-table-field').each(function () {
      const fieldName = self.$(this).data('field-name');
      const rows = [];
      self
        .$(this)
        .find('.nsd-table-rows .nsd-table-row-value')
        .each(function () {
          let entry = {};
          try {
            entry = JSON.parse(self.$(this).val() || '{}');
          } catch (e) {
            entry = {};
          }
          const hasValue = Object.keys(entry).some(function (k) {
            return entry[k] !== undefined && entry[k] !== '';
          });
          if (hasValue) rows.push(entry);
        });
      updatedData[fieldName] = rows;
    });

    return this._resolveCommit(updatedData);
  };
  // ---- Modal-specific editor hooks ----

  // A custom-button click: the `result` value decides the action.
  //   - With a defined `result` it funnels through the validation + commit
  //     pipeline (reused _saveEditor), emitting success(result, mergedValueObj).
  //   - With no `result` (undefined/null) it does NOT commit - it just closes,
  //     emitting success(null, {}) with an empty valueObj and no validation.
  EntryDialog.prototype._handleCustomAction = function (btnDef) {
    const hasResult = btnDef && btnDef.result != null;
    if (hasResult) {
      this._saveEditorResult = btnDef.result;
      this._saveEditor();
    } else {
      this._pendingResult = [null, {}];
      this.closeEditor();
    }
  };

  // _saveEditor funnels the collected merged object here. It marks the pending
  // result for the closeEditor wrapper, then closes; the wrapper delivers it as
  // success(code, valueObj) and tears the modal down. The code is the custom
  // button's `result` (set in _handleCustomAction before this runs).
  EntryDialog.prototype._resolveCommit = function (result) {
    const code = this._saveEditorResult;
    this._saveEditorResult = null; // reset for next open/commit
    this._pendingResult = [code, result];
    this.closeEditor();
  };

  /**
   * True when a field/column type is one of the supported numeric types.
   */
  EntryDialog.prototype._isNumericType = function (type) {
    return type === 'decimal' || type === 'integer' || type === 'currency';
  };

  /**
   * Resolve a currency field's decimal places (rounding precision): default 2,
   * clamped to [2, 10]. Only consulted by 'currency' fields. The prop name is
   * `decimalPlaces`.
   */
  EntryDialog.prototype._decimalPlaces = function (field) {
    const n = field && field.decimalPlaces != null ? Number(field.decimalPlaces) : NaN;
    const base = Number.isFinite(n) && n > 0 ? n : 2;
    return Math.min(10, Math.max(2, base));
  };

  /**
   * Format a numeric value per type for display:
   *   integer  -> whole number (rounded, no decimals)
   *   decimal  -> preserves typed precision, min 1 / max 10 decimals
   *   currency -> thousands-grouped, NO symbol, rounded to field.decimalPlaces
   * Returns '' for empty/invalid values.
   */
  EntryDialog.prototype._formatNumber = function (value, type, field) {
    const num = value === '' || value == null ? NaN : Number(value);
    if (!Number.isFinite(num)) return '';
    if (type === 'integer') return Math.round(num).toLocaleString(undefined);
    if (type === 'currency') {
      const d = this._decimalPlaces(field);
      return num.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
    }
    // decimal (default)
    return num.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 10 });
  };

  /**
   * Parse a raw string value per type (strips formatting). Empty/NaN -> ''.
   */
  EntryDialog.prototype._parseNumber = function (raw, type, field) {
    if (raw === '' || raw == null) return '';
    const num = Number(String(raw).replace(/[^0-9.\-]/g, ''));
    if (isNaN(num)) return '';
    if (type === 'integer') return Math.round(num);
    if (type === 'currency') {
      const d = this._decimalPlaces(field);
      return Number(num.toFixed(d));
    }
    return num; // decimal
  };

  /**
   * The calendar icon rendered inside editable date/datetime fields
   * (overlay; native WebKit indicator hidden via CSS).
   */
  EntryDialog.prototype._dateIconSvg = function () {
    return `
      <svg class="nsd-date-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">
        <rect x="1" y="1" width="14" height="14" rx="1" fill="#FFFFFF" stroke="#234A73" stroke-width="1.5"/>
        <rect x="1.75" y="1.75" width="12.5" height="3" fill="#4B91C5"/>
        <line x1="1.25" y1="5" x2="14.75" y2="5" stroke="#234A73" stroke-width="0.8"/>
        <line x1="4.5" y1="5" x2="4.5" y2="14.75" stroke="#4B91C5" stroke-width="0.5"/>
        <line x1="8" y1="5" x2="8" y2="14.75" stroke="#4B91C5" stroke-width="0.5"/>
        <line x1="11.5" y1="5" x2="11.5" y2="14.75" stroke="#4B91C5" stroke-width="0.5"/>
        <line x1="1.25" y1="8.25" x2="14.75" y2="8.25" stroke="#4B91C5" stroke-width="0.5"/>
        <line x1="1.25" y1="11.5" x2="14.75" y2="11.5" stroke="#4B91C5" stroke-width="0.5"/>
      </svg>
    `;
  };

  /**
   * Parse a time input to minutes since midnight (0-1439) or null. Accepts a
   * number/string of decimal HOURS (12.5 -> 750; 0.5 -> 30) or a time string
   * (12:30, 0:30, 1:05 pm / 1:05pm / 1:05 PM; am/pm optional, case-insensitive,
   * optional space). 12h strings map via am/pm (12am -> 0, 12pm -> 720).
   */
  EntryDialog.prototype._timeToMinutes = function (value) {
    if (value === '' || value == null) return null;
    if (typeof value === 'number') {
      if (!Number.isFinite(value) || value < 0) return null;
      const mins = Math.round(value * 60) % 1440;
      return (mins + 1440) % 1440;
    }
    const s = String(value).trim();
    if (!s) return null;
    if (/^\d+([.]\d+)?$/.test(s)) {
      const n = Number(s);
      if (!Number.isFinite(n)) return null;
      const mins = Math.round(n * 60) % 1440;
      return (mins + 1440) % 1440;
    }
    const m = s.match(/^(\d{1,2}):(\d{2})\s*(am|pm)?$/i);
    if (!m) return null;
    let h = parseInt(m[1], 10);
    const mm = parseInt(m[2], 10);
    const period = m[3] ? m[3].toLowerCase() : null;
    if (mm > 59) return null;
    if (period) {
      if (h < 1 || h > 12) return null;
      if (period === 'pm' && h !== 12) h += 12;
      if (period === 'am' && h === 12) h = 0;
    } else {
      if (h > 23) return null;
    }
    return h * 60 + mm;
  };

  /**
   * Normalize a time value to its canonical 24-hour zero-padded HH:MM string
   * ('' for empty/invalid). Independent of the field's format option.
   */
  EntryDialog.prototype._parseTime = function (value, field) {
    if (value === '' || value == null) return '';
    const mins = this._timeToMinutes(value);
    if (mins == null) return '';
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `${h < 10 ? '0' : ''}${h}:${m < 10 ? '0' : ''}${m}`;
  };

  /**
   * Format a time value for display from the field's `format` token string
   * (e.g. 'hh:mm' 24h or 'hh:mm a' 12h). Falls back to hh:mm a (12h) when no
   * format is declared. '' for invalid.
   */
  EntryDialog.prototype._formatTime = function (value, field) {
    const mins = this._timeToMinutes(value);
    if (mins == null) return '';
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    const format = field && field.format;
    if (format && typeof format === 'string') {
      return this._renderDateTime(new Date(2000, 0, 1, h, m, 0, 0), format);
    }
    return this._renderDateTime(new Date(2000, 0, 1, h, m, 0, 0), 'hh:mm a');
  };

  /**
   * Resolve the field descriptor a time input belongs to: top-level by
   * data-field-name, otherwise the table column by data-col-key. Returns an
   * object (possibly empty) so _formatTime always has a format carrier.
   */
  EntryDialog.prototype._timeFieldFromInput = function ($inp) {
    const name = $inp.data('field-name');
    if (name) return this._getLayoutField(String(name)) || {};
    const key = $inp.data('col-key');
    const $row = $inp.closest('.nsd-table-row');
    if (key == null || !$row.length) return {};
    const cfg = this._getTableConfig($row);
    if (!cfg || !cfg.columns) return {};
    const cols = cfg.columns;
    for (let i = 0; i < cols.length; i++) {
      if (this._colKey(cols[i]) === key) return cols[i] || {};
    }
    return {};
  };

  /**
   * Render a Date into a display string from a case-sensitive token format:
   * date tokens YYYY / YY / MM / DD / MMM (uppercase) and time tokens hh / mm /
   * a (lowercase). A standalone `a` switches hh to a 12-hour clock and appends
   * lowercase am/pm; without it hh renders 24-hour. Tokens match as whole words
   * (longest token first); every other character passes through literally.
   * Returns '' for a non-string format or an invalid Date.
   */
  EntryDialog.prototype._renderDateTime = function (date, format) {
    if (!(format && typeof format === 'string')) return '';
    const d = new Date(date);
    if (isNaN(d.getTime())) return '';
    const hours = d.getHours();
    const is12 = /(^|[^a-z])a([^a-z]|$)/.test(format);
    return format.replace(/YYYY|YY|MMM|MM|DD|hh|mm|a/g, function (tok) {
      switch (tok) {
        case 'YYYY':
          return String(d.getFullYear());
        case 'YY':
          return String(d.getFullYear() % 100).padStart(2, '0');
        case 'MM':
          return String(d.getMonth() + 1);
        case 'DD':
          return String(d.getDate());
        case 'MMM':
          return d.toLocaleDateString(undefined, { month: 'short' });
        case 'hh':
          return is12 ? String(hours % 12 || 12) : String(hours).padStart(2, '0');
        case 'mm':
          return String(d.getMinutes()).padStart(2, '0');
        case 'a':
          return is12 ? (hours < 12 ? 'am' : 'pm') : 'am';
        default:
          return tok;
      }
    });
  };

  EntryDialog.prototype.formatDate = function (date, format, opts) {
    // A declared `format` token string wins; otherwise the default is
    // MM/DD/YYYY (date) or MM/DD/YYYY hh:mm a (datetime) when showTime is set.
    if (format && typeof format === 'string') {
      return this._renderDateTime(date, format);
    }
    return this._renderDateTime(date, opts && opts.showTime ? 'MM/DD/YYYY hh:mm a' : 'MM/DD/YYYY');
  };

  /**
   * Wall-clock ISO 'YYYY-MM-DDTHH:MM:SS' (no timezone suffix) for a date, in
   * whatever zone the runtime local fields carry. Task dates are plain wall-clock,
   * so this is the representation payloads should use to round-trip cleanly.
   */
  EntryDialog.prototype._toDatetimeLocal = function (date) {
    const d = new Date(date);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const h = String(d.getHours()).padStart(2, '0');
    let min = String(d.getMinutes()).padStart(2, '0');
    return `${y}-${m}-${day}T${h}:${min}`;
  };

  EntryDialog.prototype._showWarnTooltip = function (e, msg, cls, textColor) {
    if (!this.$warnTooltip || !msg) return;
    this.$warnTooltip.removeClass('is-warn is-warn-yellow');
    const safeColor = sanitizeColor(cls || '');
    if (safeColor) {
      this.$warnTooltip.css('background-color', safeColor).css('border-color', safeColor);
    } else {
      this.$warnTooltip.css('background-color', '').css('border-color', '');
      this.$warnTooltip.addClass(cls || 'is-warn');
    }
    const safeText = sanitizeColor(textColor || '');
    this.$warnTooltip.css('color', safeText || '');
    this.$warnTooltip.html(`<div style="max-width:280px;white-space:pre-line;">${escapeHtml(msg)}</div>`);
    this.$warnTooltip.css({ display: 'block', left: 0, top: 0 });
    let tpW = this.$warnTooltip.outerWidth();
    let tpH = this.$warnTooltip.outerHeight();
    let left = e.clientX + 14;
    let top = e.clientY - 10;
    if (left + tpW > window.innerWidth) left = Math.max(10, window.innerWidth - tpW - 10);
    if (top + tpH > window.innerHeight) top = Math.max(10, window.innerHeight - tpH - 10);
    if (left < 0) left = 10;
    if (top < 0) top = 10;
    this.$warnTooltip.css({ left: `${left}px`, top: `${top}px` });
  };

  EntryDialog.prototype._hideWarnTooltip = function () {
    if (this.$warnTooltip) this.$warnTooltip.hide();
  };

  // ------------------------------------------------------------------ create

  /**
   * Open the standalone editor modal, editing the supplied data object.
   * The editor is a verbatim copy of the original Task Editor; only the modal wiring here
   * is nsentrydialog-specific.
   *
   * @param {Object} formLayout  Field layout (title/buttons/columns/view/fields) - declared by the caller.
   *                             title sets the editor title bar (omitted = blank).
   *                             buttons is an array of { label, result?, primary?, color?, textColor? }
   *                             descriptors; it is the ONLY source of action buttons (none are
   *                             built in - omit it and the actions bar stays empty). A button
   *                             with a defined `result` commits (validate + merge) and emits
   *                             success(result, merged). A button with no `result` just closes
   *                             without committing, emitting success(null, {}).
   * @param {Object} data        Plain data object to seed/edit; Save merges edits into a copy.
   * @param {Object} [callbacks] { success(result, valueObj), failure(reason)? }
   *                             valueObj = the FULL merged data object on a commit,
   *                             or unchanged base data on a discard (result null/2),
   *                             or an empty object {} on a no-result button close.
   */
  function create(formLayout, data, callbacks) {
    const cb = callbacks || {};
    const layout = formLayout || {};
    const $ = (typeof window !== 'undefined' && (window.jQuery || window.$)) || null;
    if (!$) throw new Error(`${MODULE_NAME}: jQuery is required`);

    const baseData = deepClone(data == null ? {} : data);
    let done = false;
    const emit = function (result, valueObj) {
      if (done) return;
      done = true;
      if (typeof cb.success === 'function') {
        try {
          cb.success(result, valueObj);
        } catch (e) {
          /* consumer */
        }
      }
    };

    const host = new EntryDialog({}, $);
    host._emitResult = emit;
    host._title = layout.title;
    host._buttons =
      Array.isArray(layout.buttons) && layout.buttons.length ? layout.buttons : null;

    // Discard / commit paths all funnel through closeEditor; wrap it so a
    // pending result (a committed merge, or an unwritten discard) reports its
    // stored code + value, a bare close reports an empty discard
    // success(null, {}), and every close tears the modal down once.
    const protoClose = EntryDialog.prototype.closeEditor;
    host.closeEditor = function () {
      const pending = this._pendingResult;
      if (pending) {
        this._pendingResult = null;
        this._emitResult(pending[0], pending[1]);
      } else {
        this._emitResult(null, {});
      }
      protoClose.call(this);
      this._teardown();
    };

    try {
      injectCss();
      host.buildEditor();
      // create() always supplies a plain object, so openEditor takes the
      // draft/object branch (no chart id lookup).
      host.openEditor(formLayout || {}, baseData);
      return host;
    } catch (e) {
      host._teardown();
      if (typeof cb.failure === 'function') cb.failure(e);
      else throw e;
    }
  }

  return {
    create: create,
  };
});
