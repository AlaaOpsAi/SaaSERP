"""
Turns the customer's blank WEDX forms into app templates, keeping their layout.

    python3 -I make-wedx-templates.py <WEDX contract.docx> <Wedding Details annex.docx> <out dir>

Writes <out>/WEDX_Wedding_Contract_template.docx, <out>/WEDX_Wedding_Annex_template.docx and
<out>/WEDX_annex_checklist.txt (to paste under Admin & IT -> Templates -> annex checklist).

How: only text runs change. Each "____" blank becomes {placeholder}, with the original underscores
kept as the fallback ({#x}{x}{/x}{^x}____{/x}), so an unknown value still prints a line to write on.
The services table repeats one row per service and is topped up with blank rows
({#lines_pad_7}) so the printed form keeps its original number of rows.
"""
from __future__ import annotations

import re
import sys
import zipfile
from pathlib import Path

T = re.compile(r'(<w:t(?: [^>]*)?>)([^<]*)(</w:t>)')


def esc(s: str) -> str:
    return s.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')


# These lines are left-to-right paragraphs that read right-to-left only because all their text
# is Arabic. A Latin name or a number would split them and reorder the line, so each value sits in
# a right-to-left embedding (RLE ... PDF): it stays in its place in the Arabic line, and English
# inside it still reads left-to-right. A phone number is also wrapped left-to-right (LRE ... PDF)
# so its digit groups aren't reversed (with RLM on both sides to keep its place).
RLE, LRE, PDF = '\u202b', '\u202a', '\u202c'
RLM = '\u200f'
LTR_FIELDS = {'client_phone'}


def field(name: str, blank: str, value: str | None = None) -> str:
    """{name} when known, else the original blank (underscores or wording)."""
    inner = value or '{' + name + '}'
    if name in LTR_FIELDS:
        shown = f' {RLM}{LRE}{inner}{PDF}{RLM} '
        return f'{{#{name}}}{shown}{{/{name}}}{{^{name}}}{blank}{{/{name}}}'
    shown = f' {RLE}{inner}{PDF} '
    return f'{{#{name}}}{shown}{{/{name}}}{{^{name}}}{blank}{{/{name}}}'


class Doc:
    def __init__(self, xml: str):
        self.xml = xml

    def tokens(self):
        return list(T.finditer(self.xml))

    def set_tokens(self, changes: dict[int, str]):
        """Replace the text of w:t elements (by index), last first so offsets stay valid."""
        toks = self.tokens()
        for i in sorted(changes, reverse=True):
            m = toks[i]
            open_tag = m.group(1) if 'xml:space' in m.group(1) else '<w:t xml:space="preserve">'
            self.xml = self.xml[:m.start()] + open_tag + changes[i] + m.group(3) + self.xml[m.end():]

    def find(self, label: str, start: int = 0) -> int:
        toks = self.tokens()
        for i in range(start, len(toks)):
            if label in toks[i].group(2):
                return i
        raise SystemExit(f'label not found: {label}')

    def blanks_after(self, label: str, names: list[str | None], values: dict[str, str] | None = None):
        """Fill the next len(names) underscore groups after `label`; None keeps a blank as it is."""
        toks = self.tokens()
        i = self.find(label) + 1
        changes: dict[int, str] = {}
        for name in names:
            while not re.fullmatch(r'_+', toks[i].group(2)):
                i += 1
            group = []
            while i < len(toks) and re.fullmatch(r'_+', toks[i].group(2)):
                group.append(i)
                i += 1
            if name is None:
                continue
            blank = ''.join(toks[j].group(2) for j in group)
            changes[group[0]] = esc(field(name, blank, (values or {}).get(name)))
            for j in group[1:]:
                changes[j] = ''
        self.set_tokens(changes)

    def date_after(self, label: str = 'التاريخ'):
        """The 'yyyy \\ mm \\ dd' date line: the date goes in the year slot, the rest is cleared.
        The form's own digits are printed in white (only the slashes show), so that run is recoloured."""
        i = self.find(label)
        self.set_tokens({i + 2: '{issue_date}', **{i + k: '' for k in range(3, 8)}})
        m = self.tokens()[i + 2]
        run_start = self.xml.rfind('<w:r>', 0, m.start()), self.xml.rfind('<w:r ', 0, m.start())
        k = max(run_start)
        run = self.xml[k:m.start()]
        fixed = re.sub(r'<w:color w:val="FFFFFF"[^>]*/>', '<w:color w:val="auto"/>', run)
        self.xml = self.xml[:k] + fixed + self.xml[m.start():]

    def number_box(self):
        """The '#' box at the top (Word keeps two copies: drawing + fallback)."""
        changes = {i: '# {doc_no}' for i, m in enumerate(self.tokens()) if m.group(2) == '#'}
        if not changes:
            raise SystemExit('# box not found')
        self.set_tokens(changes)

    def replace_text(self, old: str, new: str):
        toks = self.tokens()
        i = self.find(old)
        self.set_tokens({i: esc(toks[i].group(2).replace(old, new))})

    # ---- table -------------------------------------------------------------------------
    def table(self):
        m = re.search(r'<w:tbl>.*?</w:tbl>', self.xml, flags=re.S)
        rows = re.findall(r'<w:tr[ >].*?</w:tr>', m.group(0), flags=re.S)
        return m, rows

    def rebuild_table(self, header: str, rows: list[str]):
        m, _ = self.table()
        head = m.group(0)[:m.group(0).index('<w:tr')]
        self.xml = self.xml[:m.start()] + head + header + ''.join(rows) + '</w:tbl>' + self.xml[m.end():]


def cell_texts(row: str) -> list[str]:
    return [''.join(t.group(2) for t in T.finditer(c)) for c in re.findall(r'<w:tc>.*?</w:tc>', row, flags=re.S)]


def fill_row(row: str, texts: list[str]) -> str:
    """Put one text in each cell (replacing what is there), keeping the cell's formatting."""
    cells = re.findall(r'<w:tc>.*?</w:tc>', row, flags=re.S)
    if len(cells) != len(texts):
        raise SystemExit(f'expected {len(texts)} cells, found {len(cells)}')
    out = row
    for cell, text in zip(cells, texts):
        new = cell
        if T.search(new):
            first = True
            def put(m):
                nonlocal first
                v = esc(text) if first else ''
                first = False
                return '<w:t xml:space="preserve">' + v + m.group(3)
            new = T.sub(put, new)
        else:
            ppr = re.search(r'<w:pPr>.*?</w:pPr>', new, flags=re.S)
            rpr = re.search(r'<w:rPr>.*?</w:rPr>', ppr.group(0), flags=re.S) if ppr else None
            run = f'<w:r>{rpr.group(0) if rpr else ""}<w:t xml:space="preserve">{esc(text)}</w:t></w:r>'
            k = new.rindex('</w:p>')
            new = new[:k] + run + new[k:]
        out = out.replace(cell, new, 1)
    return out


def loop_row(row: str, columns: list[str], loop: str) -> str:
    texts = list(columns)
    texts[0] = '{#' + loop + '}' + texts[0]
    texts[-1] = texts[-1] + '{/' + loop + '}'
    return fill_row(row, texts)


def convert(src: Path, dst: Path, edit):
    with zipfile.ZipFile(src) as zin, zipfile.ZipFile(dst, 'w', zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if item.filename == 'word/document.xml':
                doc = Doc(data.decode('utf-8'))
                edit(doc)
                data = doc.xml.encode('utf-8')
            zout.writestr(item, data)


def contract(doc: Doc):
    doc.number_box()
    doc.date_after()
    doc.blanks_after('الطرف الثاني', ['client_name', 'client_civil_id'])
    doc.blanks_after('العنوان', ['client_address', 'client_phone'])
    doc.blanks_after('عنوان الحفل', ['venue', 'pax', 'event_date'], {'event_date': '{event_day} {event_date}'})
    money = {k: '{' + k + '} {currency}' for k in ('total', 'down_payment', 'remaining')}
    doc.blanks_after('اجمالي المبلغ المتفق عليه', ['total', 'down_payment', 'remaining'], money)
    doc.blanks_after('الملاحظات', ['notes'])
    doc.blanks_after('أدفع أنا', ['client_name', 'total'], money)
    doc.replace_text('(اسم العميل)', field('client_name', '(اسم العميل)'))
    doc.blanks_after('رقم البطاقة المدنية', ['client_civil_id'])
    # الاسم: ___ just before it is the name line of the receipt
    toks = doc.tokens()
    i = doc.find('رقم البطاقة المدنية')
    j = max(k for k in range(i) if toks[k].group(2) == 'الاسم')
    name_blank = next(k for k in range(j, i) if re.fullmatch(r'_+', toks[k].group(2)))
    doc.set_tokens({name_blank: esc(field('client_name', toks[name_blank].group(2)))})

    _, rows = doc.table()
    header = rows[0]
    cols = {'السعر': '{amount}', 'عدد': '{qty}', 'التفاصيل': '{details}', 'نوع العمل': '{work_type}'}
    order = [cols[h.strip()] for h in cell_texts(header)]
    blank_rows = len(rows) - 1
    doc.rebuild_table(header, [
        loop_row(rows[1], order, 'lines'),
        loop_row(rows[2], [''] * len(order), f'lines_pad_{blank_rows}'),
    ])
    print(f'contract: services table keeps {blank_rows} rows')


def annex(doc: Doc, checklist_out: Path):
    doc.number_box()
    doc.date_after()
    doc.blanks_after('العنوان', ['client_address', 'client_phone'])
    doc.blanks_after('عنوان الحفل', ['venue', 'pax', 'event_date'], {'event_date': '{event_day} {event_date}'})

    _, rows = doc.table()
    header = rows[0]
    cols = {'التفاصيل': '{notes}', 'عدد': '{qty}', 'Service': '{service_alt}', 'نوع': '{service}'}
    order = [cols[h.strip().split()[0]] for h in cell_texts(header)]
    # The checklist, in the app's paste format: "Arabic | English", one per line.
    lines = []
    for r in rows[1:]:
        t = dict(zip([h.strip().split()[0] for h in cell_texts(header)], cell_texts(r)))
        ar = t.get('نوع', '').replace('VIP', '').strip()
        en = t.get('Service', '').replace('&amp;', '&').strip()
        if 'VIP' in cell_texts(r)[-1]:
            ar = f'{ar} VIP'
        ar = re.sub(r'\s+', ' ', ar)
        if ar or en:
            lines.append(f'{ar} | {en}' if en else ar)
    checklist_out.write_text('\n'.join(lines) + '\n', encoding='utf-8')
    blank_rows = len(rows) - 1
    # A plain row (no drawings) of the usual height is the one that repeats.
    simple = next(r for r in rows[2:] if '<w:drawing' not in r and '<w:pict' not in r)
    doc.rebuild_table(header, [
        loop_row(simple, order, 'annex'),
        loop_row(rows[-1], [''] * len(order), f'annex_pad_{blank_rows}'),
    ])
    print(f'annex: table keeps {blank_rows} rows; checklist has {len(lines)} services')


if __name__ == '__main__':
    contract_src, annex_src, out = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3])
    out.mkdir(parents=True, exist_ok=True)
    convert(contract_src, out / 'WEDX_Wedding_Contract_template.docx', contract)
    convert(annex_src, out / 'WEDX_Wedding_Annex_template.docx', lambda d: annex(d, out / 'WEDX_annex_checklist.txt'))
