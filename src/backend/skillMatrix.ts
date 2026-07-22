import fs from 'fs';
import path from 'path';
import type {
  MatrixData,
  MatrixLink,
  MatrixMajor,
  MatrixOption,
  MatrixOptions,
} from '../shared/types';

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
  // 列挙用（CSV出現順・id重複排除）
  private readonly skillOptions: MatrixOption[] = [];
  private readonly businessOptions: MatrixOption[] = [];
  // マトリクス用（大項目→小項目 と 関係グラフ）
  private readonly skillMajors: MatrixMajor[] = [];
  private readonly businessMajors: MatrixMajor[] = [];
  private readonly links: MatrixLink[] = [];
  private loaded = false;

  constructor(csvPath: string) {
    this.csvPath = csvPath;
  }

  private ensureLoaded(): void {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const rows = parseCsv(fs.readFileSync(this.csvPath, 'utf-8'));
      const skillMajorIdx = new Map<string, MatrixMajor>();
      const bizMajorIdx = new Map<string, MatrixMajor>();
      const linkSeen = new Set<string>();
      const clean = (s: string): string => s.replace(/\s+/g, ' ').trim();
      // 列: skill_major_id(0) skill_major(1) skill_sub_id(2) skill_sub(3)
      //     business_major_id(4) business_major(5) business_sub_id(6) business_sub(7) level(8)
      for (let i = 1; i < rows.length; i++) {
        const r = rows[i];
        if (r.length < 8) continue;
        const sid = r[2];
        const bid = r[6];
        const validSkill = /^SK-\d{4}$/.test(sid);
        const validBiz = /^BZ-\d{4}$/.test(bid);

        if (validSkill && !this.skill.has(sid)) {
          const label = clean(r[3]);
          this.skill.set(sid, label);
          this.skillOptions.push({ id: sid, label, majorId: r[0], majorLabel: clean(r[1]) });
          let major = skillMajorIdx.get(r[0]);
          if (!major) {
            major = { id: r[0], label: clean(r[1]), subs: [] };
            skillMajorIdx.set(r[0], major);
            this.skillMajors.push(major);
          }
          major.subs.push({ id: sid, label });
        }
        if (validBiz && !this.business.has(bid)) {
          const label = clean(r[7]);
          this.business.set(bid, label);
          this.businessOptions.push({ id: bid, label, majorId: r[4], majorLabel: clean(r[5]) });
          let major = bizMajorIdx.get(r[4]);
          if (!major) {
            major = { id: r[4], label: clean(r[5]), subs: [] };
            bizMajorIdx.set(r[4], major);
            this.businessMajors.push(major);
          }
          major.subs.push({ id: bid, label });
        }
        if (validSkill && validBiz) {
          const key = `${bid}|${sid}`;
          if (!linkSeen.has(key)) {
            linkSeen.add(key);
            const level = parseInt(r[8], 10);
            this.links.push({ b: bid, s: sid, level: Number.isNaN(level) ? 1 : level });
          }
        }
      }
      // 詳細説明（別CSV があれば）を小項目に付与
      this.loadDescriptions('skill_descriptions.csv', this.skillMajors);
      this.loadDescriptions('business_descriptions.csv', this.businessMajors);
    } catch {
      // matrix が読めなくても致命的にはしない（ラベルはIDのまま表示）
    }
  }

  //  説明CSV（列: … 名称 … 内容 …）を読み、ラベル一致で小項目に desc を付与。
  //  ファイルが無ければ何もしない（説明なし＝表示しない）。
  private loadDescriptions(fileName: string, majors: MatrixMajor[]): void {
    const filePath = path.join(path.dirname(this.csvPath), fileName);
    let rows: string[][];
    try {
      rows = parseCsv(fs.readFileSync(filePath, 'utf-8'));
    } catch {
      return; // ファイル無しは無視
    }
    const clean = (s: string): string => s.replace(/\s+/g, ' ').trim();
    // このグループの ラベル集合
    const labels = new Set<string>();
    for (const m of majors) for (const s of m.subs) labels.add(s.label);
    // ラベル → 説明
    const descByLabel = new Map<string, string>();
    for (const r of rows) {
      // 行内で「既知ラベルに一致するセル」を名称、最長の別セルを説明とみなす
      let name = '';
      for (const cell of r) {
        if (labels.has(clean(cell))) {
          name = clean(cell);
          break;
        }
      }
      if (!name) continue;
      let desc = '';
      for (const cell of r) {
        const c = cell.trim();
        if (clean(cell) === name) continue;
        if (c.length > desc.length) desc = c;
      }
      if (desc) descByLabel.set(name, desc);
    }
    for (const m of majors) {
      for (const s of m.subs) {
        const d = descByLabel.get(s.label);
        if (d) s.desc = d;
      }
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

  //  プルダウン用の全候補
  options(): MatrixOptions {
    this.ensureLoaded();
    return { skills: this.skillOptions, business: this.businessOptions };
  }

  //  マトリクス（大項目→小項目 と 業務⇔スキルの関係グラフ）
  getMatrix(): MatrixData {
    this.ensureLoaded();
    return {
      businessMajors: this.businessMajors,
      skillMajors: this.skillMajors,
      links: this.links,
    };
  }

  //  ID妥当性チェック（新規作成の検証用）
  hasSkill(id: string): boolean {
    this.ensureLoaded();
    return this.skill.has(id);
  }

  hasBusiness(id: string): boolean {
    this.ensureLoaded();
    return this.business.has(id);
  }
}
