/** Küçük, bağımlılıksız form parçacıkları. */

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v !== undefined && v !== null && v !== false) node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of [].concat(children)) if (c) node.append(c);
  return node;
}

export function group(title, children, open = true) {
  const body = el('div', { class: 'group-body' }, children);
  return el('details', { class: 'group', ...(open ? { open: true } : {}) }, [
    el('summary', { text: title }),
    body,
  ]);
}

export function hint(text) {
  return el('p', { class: 'hint', text });
}

function labelled(labelText, control, valueNode) {
  const label = el('label', {}, [el('span', { text: labelText })]);
  if (valueNode) label.append(valueNode);
  return el('div', { class: 'field' }, [label, control]);
}

export function slider({ label, value, min, max, step = 1, unit = '', onInput }) {
  const valueNode = el('span', { class: 'value', text: fmt(value, unit) });
  const input = el('input', { type: 'range', min, max, step, value });
  input.addEventListener('input', () => {
    const v = Number(input.value);
    valueNode.textContent = fmt(v, unit);
    onInput(v);
  });
  const field = labelled(label, input, valueNode);
  field.setValue = (v) => { input.value = v; valueNode.textContent = fmt(Number(v), unit); };
  return field;
}

export function number({ label, value, min, max, step = 1, unit = '', onInput }) {
  const input = el('input', { type: 'number', value, min, max, step });
  const commit = () => {
    let v = Number(input.value);
    if (!Number.isFinite(v)) return;
    if (min !== undefined) v = Math.max(min, v);
    if (max !== undefined) v = Math.min(max, v);
    onInput(v);
  };
  input.addEventListener('change', commit);
  input.addEventListener('blur', commit);
  const field = labelled(unit ? `${label} (${unit})` : label, input);
  field.setValue = (v) => { input.value = v; };
  return field;
}

export function textInput({ label, value, placeholder, onInput }) {
  const input = el('input', { type: 'text', value, placeholder: placeholder ?? '' });
  input.addEventListener('input', () => onInput(input.value));
  return labelled(label, input);
}

export function textArea({ label, value, rows = 3, placeholder, onInput }) {
  const input = el('textarea', { rows, placeholder: placeholder ?? '' });
  input.value = value;
  input.addEventListener('input', () => onInput(input.value));
  const field = labelled(label, input);
  field.setValue = (v) => { input.value = v; };
  return field;
}

export function select({ label, value, options, onInput }) {
  const sel = el('select');
  for (const opt of options) {
    const o = el('option', { value: opt.value, text: opt.label });
    if (opt.value === value) o.selected = true;
    sel.append(o);
  }
  sel.addEventListener('change', () => onInput(sel.value));
  const field = labelled(label, sel);
  field.setValue = (v) => { sel.value = v; };
  return field;
}

export function segmented({ label, value, options, onInput }) {
  const wrap = el('div', { class: 'seg' });
  const buttons = options.map((opt) => {
    const b = el('button', { type: 'button', text: opt.label });
    if (opt.value === value) b.classList.add('active');
    b.addEventListener('click', () => {
      wrap.querySelectorAll('button').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      onInput(opt.value);
    });
    wrap.append(b);
    return { b, value: opt.value };
  });
  const field = label ? labelled(label, wrap) : wrap;
  field.setValue = (v) => {
    buttons.forEach(({ b, value: bv }) => b.classList.toggle('active', bv === v));
  };
  return field;
}

export function checkbox({ label, value, onInput }) {
  const input = el('input', { type: 'checkbox' });
  input.checked = !!value;
  input.addEventListener('change', () => onInput(input.checked));
  const field = el('label', { class: 'check' }, [input, el('span', { text: label })]);
  field.setValue = (v) => { input.checked = !!v; };
  return field;
}

export function colorInput({ label, value, onInput }) {
  const input = el('input', { type: 'color', value });
  input.addEventListener('input', () => onInput(input.value));
  return labelled(label, input);
}

export function button({ label, onClick, variant = 'ghost' }) {
  return el('button', { type: 'button', class: variant, text: label, onClick });
}

export function fileButton({ label, accept, onFile }) {
  const input = el('input', { type: 'file', accept });
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (file) onFile(file);
    input.value = '';
  });
  return el('label', { class: 'filebtn' }, [document.createTextNode(label), input]);
}

export function row(children) { return el('div', { class: 'row' }, children); }
export function row3(children) { return el('div', { class: 'row-3' }, children); }

function fmt(v, unit) {
  const s = Math.abs(v) >= 100 || Number.isInteger(v) ? v.toFixed(0) : v.toFixed(2);
  return unit ? `${s} ${unit}` : s;
}
