// Fast csv-reader 1.0.0-compatible reader.
//
// Semantics (identical to csv-reader 1.0.0, make.fun's own reader):
//  - U+FEFF at the very start is dropped.
//  - A record ends at LF or CRLF; a line with no characters is no record.
//  - Outside quotes a CR not followed by LF is dropped (error stray_cr).
//  - A field opening with a quote runs to the next non-doubled quote; ""
//    inside it is one quote; CRLF / lone CR inside it is read as LF.
//    What follows the closing quote up to the next comma or line break is
//    appended as it stands (error quote_junk when the field ends, if
//    anything was appended). A quote that never closes is a literal
//    character and the text after it is read again as unquoted
//    (error unterminated_quote).
//  - A quote inside an unquoted field is a literal character.
//  - Fields stay strings, never trimmed or converted.
//  - columns is the first record when header is true, else null; rows are
//    padded with "" (short_row, fields: count) or cut (long_row, extra:
//    the cut fields) to the first record's width.
//  - Each error is {code, line, row}, in the order met; line is the
//    1-based line its record starts on, row its record's index in rows
//    (null for the header); short_row/long_row are recorded when the
//    record ends.
//
// Speed: a record whose line holds no quote and no CR takes a native fast
// path: one indexOf('\n') to find the line, one slice, and
// String.split(','). Anything with a quote or a CR (most records in the
// generator's mix) takes the slow path, which still works field-by-field
// with indexOf/slice instead of a character-at-a-time loop, so no
// semantics change with the path taken.

const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  const n = text.length;
  let pos = 0;
  let line = 1;
  if (n > 0 && text.charCodeAt(0) === 0xfeff) pos = 1;

  // Record a finished record's fields (already a fresh array) into
  // columns/rows, applying the width rule. `lastQuoted` is whether the
  // record's last field was quoted: a record of one empty unquoted field
  // (a line holding only stray CRs) is no record at all.
  // Returns nothing; the caller re-reads `columns`/`width` as needed.
  function finishRecord(fields, lastQuoted, recordLine, recordRow) {
    if (fields.length === 1 && fields[0] === '' && !lastQuoted) return;
    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      return;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }

  // Count '\n' in s (s is a quoted-field chunk already converted so every
  // line break inside it is '\n').
  function countLF(s) {
    let c = 0;
    let i = -1;
    while ((i = s.indexOf('\n', i + 1)) !== -1) c++;
    return c;
  }

  // Read an unquoted field starting at `pos`, with `value` already built
  // ('' for a fresh field, the quoted content for quote junk, '"' for an
  // unterminated quote re-read). `recordLine`/`recordRow` are the current
  // record's, for stray_cr errors. Returns {value, ended, added} where
  // `added` counts the characters kept by this call. Updates pos/line.
  function readUnquoted(value, recordLine, recordRow) {
    // Fast attempt (the common case: no stray CR in this field). Only two
    // native scans: the next comma and the next LF. A CR can only matter
    // before the nearer of those two, so it is checked on the short slice
    // itself instead of with an unbounded indexOf('\r') — in LF files the
    // next CR can be thousands of characters away. A CRLF end is detected
    // by the char before the LF. If the slice does hold a CR, fall through
    // to the general loop below, which handles stray CRs exactly.
    const cm = text.indexOf(',', pos);
    const nl = text.indexOf('\n', pos);
    let end;
    let kind; // 0 comma, 1 LF, 2 EOF
    if (cm !== -1 && (nl === -1 || cm < nl)) { end = cm; kind = 0; }
    else if (nl !== -1) { end = nl; kind = 1; }
    else { end = n; kind = 2; }
    let sliceEnd = end;
    if (kind === 1 && end > pos && text.charCodeAt(end - 1) === 13) sliceEnd = end - 1; // CRLF
    const seg = text.slice(pos, sliceEnd);
    if (seg.indexOf('\r') === -1) {
      pos = kind === 2 ? n : end + 1;
      if (kind === 1) line += 1;
      return { value: value + seg, ended: kind === 0 ? COMMA : kind === 1 ? LINE_BREAK : END, added: seg.length };
    }
    let added = 0;
    let parts = null; // only allocated if a stray CR forces a join
    while (pos < n) {
      const nl = text.indexOf('\n', pos);
      const cm = text.indexOf(',', pos);
      const cr = text.indexOf('\r', pos);
      // Nearest of comma / LF / CR (each -1 means absent).
      let end = -1;
      let kind = -1; // 0 comma, 1 LF, 2 CR
      if (cm !== -1 && (end === -1 || cm < end)) { end = cm; kind = 0; }
      if (nl !== -1 && (end === -1 || nl < end)) { end = nl; kind = 1; }
      if (cr !== -1 && (end === -1 || cr < end)) { end = cr; kind = 2; }
      if (end === -1) {
        const tail = text.slice(pos);
        if (parts === null) {
          value += tail;
        } else {
          parts.push(tail);
          value = parts.join('');
          parts = null;
        }
        added += tail.length;
        pos = n;
        return { value, ended: END, added };
      }
      if (kind === 0) {
        const seg = text.slice(pos, end);
        if (parts === null) value += seg; else parts.push(seg);
        added += seg.length;
        pos = end + 1;
        if (parts !== null) value = parts.join('');
        return { value, ended: COMMA, added };
      }
      if (kind === 1) {
        const seg = text.slice(pos, end);
        if (parts === null) value += seg; else parts.push(seg);
        added += seg.length;
        pos = end + 1;
        line += 1;
        if (parts !== null) value = parts.join('');
        return { value, ended: LINE_BREAK, added };
      }
      // kind === 2: CR.
      if (text.charCodeAt(end + 1) === 10) {
        const seg = text.slice(pos, end);
        if (parts === null) value += seg; else parts.push(seg);
        added += seg.length;
        pos = end + 2;
        line += 1;
        if (parts !== null) value = parts.join('');
        return { value, ended: LINE_BREAK, added };
      }
      // Stray CR: dropped, error recorded, field continues past it.
      errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
      if (parts === null) { parts = [value]; value = ''; }
      parts.push(text.slice(pos, end));
      added += end - pos;
      pos = end + 1;
    }
    if (parts !== null) value = parts.join('');
    return { value, ended: END, added };
  }

  // Read a quoted field whose opening quote is at `pos`. Returns
  // {value, ended}. Updates pos/line. `recordLine`/`recordRow` are the
  // current record's, for unterminated_quote / quote_junk / stray_cr.
  function readQuoted(recordLine, recordRow) {
    const open = pos;
    const openLine = line;
    let value = '';
    let parts = null; // chunks, only when a doubled quote forces a join
    let search = pos + 1;
    while (true) {
      const q = text.indexOf('"', search);
      if (q === -1) {
        // Never closes: literal quote, text after it re-read unquoted.
        pos = open + 1;
        line = openLine;
        errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
        return readUnquoted('"', recordLine, recordRow);
      }
      if (text.charCodeAt(q + 1) === 34) {
        // Doubled quote: chunk up to q, plus one quote, keep scanning.
        let chunk = text.slice(search, q);
        if (chunk.indexOf('\r') !== -1) {
          chunk = chunk.replace(/\r\n?/g, '\n');
          line += countLF(chunk);
        } else {
          line += countLF(chunk);
        }
        if (parts === null) { parts = [value]; value = ''; }
        parts.push(chunk);
        parts.push('"');
        search = q + 2;
        continue;
      }
      // Closing quote at q.
      let chunk = text.slice(search, q);
      if (chunk.indexOf('\r') !== -1) {
        chunk = chunk.replace(/\r\n?/g, '\n');
        line += countLF(chunk);
      } else {
        line += countLF(chunk);
      }
      if (parts === null) value = chunk;
      else { parts.push(chunk); value = parts.join(''); }
      pos = q + 1;
      if (pos >= n) return { value, ended: END };
      const c = text.charCodeAt(pos);
      if (c === 44) { // ','
        pos += 1;
        return { value, ended: COMMA };
      }
      if (c === 10) { // '\n'
        pos += 1;
        line += 1;
        return { value, ended: LINE_BREAK };
      }
      if (c === 13 && text.charCodeAt(pos + 1) === 10) { // CRLF
        pos += 2;
        line += 1;
        return { value, ended: LINE_BREAK };
      }
      // Junk after the closing quote, appended as it stands.
      const junk = readUnquoted(value, recordLine, recordRow);
      if (junk.added > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
      return junk;
    }
  }

  while (true) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    const recordLine = line;
    const recordRow = header && columns === null ? null : rows.length;

    // ---- Fast path: a clean physical line (no quote, no CR). ----
    // A quoted field can span lines, so this is only valid when the line
    // holds no '"' at all; a stray CR would also need the slow path.
    const lineEnd = text.indexOf('\n', pos);
    const segEnd = lineEnd === -1 ? n : lineEnd;
    let seg = text.slice(pos, segEnd);
    // A trailing CR is a CRLF only when the line really ends with '\n'
    // (lineEnd !== -1). At EOF a trailing CR is a lone CR: stray_cr, so
    // it must take the slow path instead of being stripped silently.
    if (lineEnd !== -1 && seg.charCodeAt(seg.length - 1) === 13) seg = seg.slice(0, -1); // CRLF
    if (seg.indexOf('"') === -1 && seg.indexOf('\r') === -1) {
      const fields = seg === '' ? [''] : seg.split(',');
      // A truly empty segment cannot reach here (blank lines are skipped
      // above), but seg === '' is kept for safety: it is one empty
      // unquoted field, i.e. no record.
      finishRecord(fields, false, recordLine, recordRow);
      if (lineEnd === -1) { pos = n; break; }
      pos = lineEnd + 1;
      line += 1;
      continue;
    }

    // ---- Slow path: the record holds a quote or a CR. ----
    // The unquoted fast attempt is inlined here (it is the common field);
    // quoted fields and stray-CR fields go through the helpers.
    const fields = [];
    let lastQuoted = false;
    let ended = COMMA;
    do {
      lastQuoted = text.charCodeAt(pos) === 34;
      if (lastQuoted) {
        const field = readQuoted(recordLine, recordRow);
        fields.push(field.value);
        ended = field.ended;
      } else {
        const cm = text.indexOf(',', pos);
        const nl = text.indexOf('\n', pos);
        let end;
        let kind;
        if (cm !== -1 && (nl === -1 || cm < nl)) { end = cm; kind = 0; }
        else if (nl !== -1) { end = nl; kind = 1; }
        else { end = n; kind = 2; }
        let sliceEnd = end;
        if (kind === 1 && end > pos && text.charCodeAt(end - 1) === 13) sliceEnd = end - 1;
        const seg = text.slice(pos, sliceEnd);
        if (seg.indexOf('\r') === -1) {
          pos = kind === 2 ? n : end + 1;
          if (kind === 1) line += 1;
          fields.push(seg);
          ended = kind === 0 ? COMMA : kind === 1 ? LINE_BREAK : END;
        } else {
          const field = readUnquoted('', recordLine, recordRow);
          fields.push(field.value);
          ended = field.ended;
        }
      }
    } while (ended === COMMA);
    finishRecord(fields, lastQuoted, recordLine, recordRow);
  }

  return { columns: header ? (columns ?? []) : null, rows, errors };
}
