# NS Entry Dialog

A standalone **entry-dialog** for NetSuite client scripts. Renders a
consumer-declared `formLayout` over a plain `data` object and returns the
**full merged data object** from the `success` callback — unlike `ns_inputdialog`,
which returns raw string values. No scheduling/calendar logic; fields read/write
`data[name]`, tables `data[<tableName>]` = row arrays.

It is a **SuiteScript module** (`define([], factory)`, headers
`@NApiVersion 2.0` / `@NModuleScope SameAccount`) loaded via
`require(['nsentrydialog'], function (nsd) { ... })` on a NetSuite client
page. The standalone test page (`nsentrydialog_test.html`) injects a tiny
synchronous AMD shim (`window.define`/`window.require`) so the same `define`
module can be exercised in a plain browser without NetSuite.

---

## Usage

```js
const formLayout = {
  title: 'Edit Task', // optional; editor title bar text (omitted = blank)
  buttons: [          // optional; the ONLY action buttons (none are built in)
    { label: 'Save', result: 1, primary: true },   // result -> commits
    { label: 'Save Draft', result: 3 },
    { label: 'Cancel' },                            // no result -> close only
  ],
  columns: 3,        // grid columns
  view: false,       // true = read-only fields (buttons still caller-declared)
  fields: [ /* Field[] */ ],
};

nsentrydialog.create(formLayout, data, {
  success: function (result, valueObj) {
    // result = a button's `result` when its click commits (defined result);
    //          null on every non-commit close - no-result button / X / backdrop / ESC
    // valueObj = the FULL merged data object on a commit;
    //            a literal empty object {} on every non-commit close
    console.log('Result:', result, valueObj);
  },
  failure: function (reason) { console.error(reason); },
});
```

A test page is provided at `nsentrydialog_test.html` (loads jQuery + the module,
opens the dialog, and logs the returned object on commit).

---

## `formLayout`

Top-level layout properties: `title` (editor title bar text, omitted = blank),
`buttons` (the dialog's action buttons - none are built in; see `### buttons`),
plus the `columns` grid (defaults to `1` when omitted), the `view` read-only flag,
and the `fields` array.

```js
const formLayout = {
  title: 'Edit Task',   // optional; editor title bar text (omitted = blank)
  buttons: [ ... ],     // optional; the only action buttons (see `### buttons`)
  columns: 3,           // grid columns
  view: false,          // true = read-only fields (buttons still caller-declared)
  fields: [ /* Field[] */ ],
};
```

### Field / column descriptor

`name`, `label`, `type` required. Unless noted, each prop is a **static value**
or a **`(ctx) => value`** resolver.

| Prop | Signature | Notes |
| --- | --- | --- |
| `name` | `string` | Field id / data key. |
| `label` | `string` | Display label. |
| `type` | `string` | `text`, `textarea`, `decimal`, `integer`, `currency`, `time`, `date`, `datetime`, `checkbox`, `checkbox-group`, `select`, `multi-select`, `table`. |
| `colspan` | `number \| (ctx) => number` | Top-level fields only. |
| `break` | `boolean` | Top-level only: force a new row. |
| `width` | `number \| (ctx) => number` | Table columns only; flex-fill min-120 if absent. |
| `key` | `string` | Table column data key (defaults to `name`). |
| `defaultValue` | `value \| (ctx) => value` | Seed when no value. |
| `options` | `array \| (ctx) => array` | `select` / `multi-select` / `checkbox-group`; also powers single-select **table columns** (`type: 'select'`). |
| `visible` | `boolean \| (ctx) => boolean` | `false` => rendered **hidden**; the field is revealed when `visible` turns true. A hidden field never gates save. |
| `readonly` | `boolean \| (ctx) => boolean` | static `true` => static text; ctx `true` => dimmed. |
| `required` | `boolean \| (ctx) => boolean` | resolved at runtime (respects `visible` / `readonly`); static `true` => label `*`; gates save. |
| `validate` | `(value, ctx) => boolean` | Acceptance gate; `false` => revert, no `onChange`. |
| `onChange` | `(ctx) => void` | Effect after accepted change; can call `setValue` / `reloadOptions`. |
| `checkboxLabel` | `string` | `checkbox` display text beside the box. |
| `max` | `number` | `checkbox-group` max selectable boxes (over-selection snaps back). |
| `summary` | `string \| (ctx) => string \| [{text, textcolor?, hint?:{color?,textcolor?}}]` | Warning lines (`⚠` first line, all lines in a styled hover tooltip). |
| `use12HourFormat` | `boolean \| (ctx) => boolean` | `time` display (12h vs 24h). |
| `decimalPlaces` | `number` | Currency rounding (default 2, clamp [2,10]). |
| `rowInit` | `(ctx) => object` | Table: seed a newly added row. |
| `validateRow` | `(value, ctx) => boolean` | Table: whole live row; `false` => silent block. |
| `columns` | `Field[]` | Table: nested column descriptors. |

> Table option dropdowns use `type: 'select'` with `options`; there is no
> separate `task` column type.

### `ctx`

```js
ctx = {
  value, values,                       // value = current; values = live snapshot
  getValue(name), setValue(name, v, opts?),
  getTableValue(table, col, index), setTableValue(table, col, v, index),
  reloadOptions(name),                 // select/multi-select ctx ONLY
  table, column, rowIndex,             // table-scoped extras
}
```

Reads via `getValue` / `getTableValue` are the working values; writes only via
`setValue` / `setTableValue`. `reloadOptions` rebuilds a dependent field's options.

### `type` → returned value

- `decimal` / `integer` / `currency` → `Number` (currency rounded to `decimalPlaces`).
- `time` → canonical 24h zero-padded `HH:MM` string.
- `date` / `datetime` → `Date` (table rows serialize to ISO in row JSON).
- `checkbox` → boolean; `multi-select` / `checkbox-group` → `string[]`.
- `select` → string (a searchable single-select drawn from `options`);
  `table` → array of row objects.

---

## Full `formLayout` example

A complete, consumer-declared layout covering every field type and the main
descriptor properties:

```js
// Consumer-owned data used by a dependent dropdown's options resolver.
const machinesForWorkCenter = {
  'WC-1': [{ id: 'M-1', text: 'Machine 1' }, { id: 'M-2', text: 'Machine 2' }],
  'WC-2': [{ id: 'M-3', text: 'Machine 3' }],
};

const formLayout = {
  columns: 2,
  view: false, // true = read-only fields (buttons still caller-declared)
  fields: [
    { name: 'name', label: 'Name', type: 'text', colspan: 2, required: true },
    { name: 'notes', label: 'Notes', type: 'textarea', colspan: 2, break: true },

    { name: 'qty', label: 'Qty', type: 'integer', colspan: 1,
      validate: (value) => value === '' || Number(value) >= 0 },
    { name: 'unitCost', label: 'Unit Cost', type: 'currency', decimalPlaces: 2, colspan: 1,
      validate: (value) => value == null || value === '' || Number(value) <= 200 },
    { name: 'factor', label: 'Factor', type: 'decimal', colspan: 1, break: true },

    { name: 'startTime', label: 'Start Time', type: 'time', use12HourFormat: true, colspan: 1 },
    { name: 'dueDate', label: 'Due Date', type: 'date', colspan: 1 },
    { name: 'endAt', label: 'End At', type: 'datetime', colspan: 1, break: true },

    { name: 'locked', label: 'Locked', type: 'checkbox', checkboxLabel: 'Mark locked', colspan: 1 },
    { name: 'secretNote', label: 'Shown when locked', type: 'text', colspan: 1,
      visible: (ctx) => ctx.getValue('locked') === true,
      required: (ctx) => ctx.getValue('locked') === true },

    { name: 'licenses', label: 'Licenses (max 2)', type: 'checkbox-group', max: 2, colspan: 2, break: true,
      options: [
        { id: 'L1', text: 'License A' },
        { id: 'L2', text: 'License B' },
        { id: 'L3', text: 'License C' },
      ] },

    { name: 'workCenter', label: 'Work Center', type: 'select', colspan: 1, break: true,
      options: [{ id: 'WC-1', text: 'WC-1' }, { id: 'WC-2', text: 'WC-2' }],
      onChange: ({ reloadOptions }) => reloadOptions('machineId') },
    { name: 'machineId', label: 'Machine', type: 'select', colspan: 1,
      options: (ctx) => machinesForWorkCenter[ctx.getValue('workCenter')] || [] },
    { name: 'operators', label: 'Operators', type: 'multi-select', colspan: 2,
      options: [{ id: 'op1', text: 'Operator 1' }, { id: 'op2', text: 'Operator 2' }],
      summary: (ctx) =>
        (ctx.getValue('operators') || []).length ? null : [{ text: 'Select at least one operator', color: '#b91c1c' }] },

    { name: 'deps', label: 'Dependencies', type: 'table', colspan: 2, break: true, allowAdd: true,
      columns: [
        { name: 'id',   label: 'Task', type: 'select',  width: 160, required: true,
          options: [{ id: 'OP-10', text: '10 Op A' }, { id: 'OP-20', text: '20 Op B' }] },
        { name: 'type', label: 'Type', type: 'select',  width: 140, required: true,
          options: [{ id: 'FS', text: 'Finish-to-Start' }, { id: 'SS', text: 'Start-to-Start' }] },
        { name: 'qty',  label: 'Qty',  type: 'integer', width: 80, defaultValue: 1 },
        { name: 'note', label: 'Note', type: 'textarea' },
      ],
      rowInit: () => ({ qty: 1 }),
      validateRow: (value) => value.qty == null || Number(value.qty) >= 1 },
  ],
};
```

> `options` / `summary` / `onChange` resolvers may be functions of `ctx` and can
> close over consumer data (lazily). `workCenter.onChange` calls
> `ctx.reloadOptions('machineId')` to rebuild the dependent dropdown. Table
> option cells use `type: 'select'` — there is no `task` column type.

## Callbacks

| Callback   | Signature                     | Notes |
| ---------- | ----------------------------- | ----- |
| `success`  | `success(result, valueObj)`   | `result` = the clicked commit button's `result` (a button with a defined `result`) -> `valueObj` = full merged object. `result = null` on every non-commit close (no-result button / title-bar **X** / backdrop / ESC) -> `valueObj` = a literal empty object `{}` (edits not persisted). |
| `failure`  | `failure(reason)`             | Called on construction/render error. |

> `title` and `buttons` are declared on `formLayout`, not on `callbacks`. See
> the `formLayout` section above; the `buttons` descriptor is documented below.

### `buttons`

`buttons` is the **only** source of action buttons - no Save / Cancel / Close
are built in. Omit it and the actions bar stays empty (the dialog is then
exited only via X / backdrop / ESC, all of which discard). The optional
`result` decides what a click does:

- **`result` defined** -> commit button: validates (like Save) and merges the
  editor into `valueObj`, then emits `success(result, fullMergedValue)`.
- **`result` omitted / `null`** -> close-only button: does **not** commit and
  does **not** validate; it just closes, emitting `success(null, {})` with a
  literal empty `valueObj`.

| Prop          | Type    | Notes |
| ------------- | ------- | ----- |
| `label`       | `string` | Button text. |
| `result`      | `number` | Code passed to `success(result, valueObj)` on a commit. Omitted / `null` -> the button becomes a close-only action (`success(null, {})`). `0` is a valid commit result. |
| `primary`     | `boolean` | `true` -> primary button styling; otherwise secondary. |
| `color`       | `string` | Optional special-case background color override. |
| `textColor`   | `string` | Optional special-case text color override. |

`color` / `textColor` are layered on top of the `primary`/`secondary` class,
so a plain button (neither special-case) keeps the standard primary/secondary
style.

## Behavior notes

- On **Save** the returned object is a plain copy of `data` merged with each
  field's current value (no injected gantt fields such as `startDate` /
  `endDate` / `dependsOn`). Tables are the committed row arrays; empty numerics
  are `''`.
- Required fields, per-column `required`, `validate`, live per-cell `validate`,
  and `validateRow` gate saving (silent revert / alert). `required` is resolved
  at runtime and respects `visible` / `readonly` - a **hidden** field never
  gates save; a visible+required+empty field alerts.
- Fields with `visible: false` render **hidden** and are revealed when `visible`
  turns true (e.g. by toggling a driver field).
- Every non-commit close - a button with no `result`, the title-bar **X**,
  backdrop, or ESC - fires `success(null, {})` with a literal empty `valueObj`
  (edits are not persisted). The X / backdrop / ESC prompt to discard first
  when there are unsaved changes; a no-result button does not.