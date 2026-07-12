import fs from 'fs';

// ------------------------------------------------------------------ //
//  matrix/uchu_skill_business_map.csv から SK-xxxx / BZ-xxxx のラベルを解決する。
//  一部フィールドが引用符・改行を含むため、RFC 4180 準拠の簡易パーサを用意する。
// ------------------------------------------------------------------ //
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (c !== '\r') {
      field += c;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export default class SkillMatrix {
  private readonly csvPath: string;
  private readonly skill = new Map<string, string>();
  private readonly business = new Map<string, string>();
  private loaded = false;

  constructor(csvPath: string) {
    this.csvPath = csvPath;
  }

  private ensureLoaded(): void {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const rows = parseCsv(fs.readFileSync(this.csvPath, 'utf-8'));
      // 列: skill_sub_id(2), skill_sub(3), business_sub_id(6), business_sub(7)
      for (let i = 1; i < rows.length; i++) {
        const r = rows[i];
        if (r.length < 8) continue;
        const sid = r[2];
        const bid = r[6];
        if (/^SK-\d{4}$/.test(sid) && !this.skill.has(sid)) {
          this.skill.set(sid, r[3].replace(/\s+/g, ' ').trim());
        }
        if (/^BZ-\d{4}$/.test(bid) && !this.business.has(bid)) {
          this.business.set(bid, r[7].replace(/\s+/g, ' ').trim());
        }
      }
    } catch {
      // matrix が読めなくても致命的にはしない（ラベルはIDのまま表示）
    }
  }

  //  未解決のIDはそのままラベルとして返す
  skillLabel(id: string): string {
    this.ensureLoaded();
    return this.skill.get(id) ?? id;
  }

  businessLabel(id: string): string {
    this.ensureLoaded();
    return this.business.get(id) ?? id;
  }
}
