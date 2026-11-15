/** Line diff for the Changes tab (6.44). */

export interface DiffLine {
  kind: '=' | '-' | '+';
  text: string;
  /** 1-based line in `before` for '=' and '-', in `after` for '+'. */
  line: number;
}

export function lineDiff(before: string, after: string): DiffLine[] {
  const A = before.split('\n');
  const B = after.split('\n');
  // common head/tail lines are '=': LCS only runs on the changed middle (n*m table)
  let pre = 0;
  while (pre < A.length && pre < B.length && A[pre] === B[pre]) pre++;
  let suf = 0;
  while (
    suf < A.length - pre &&
    suf < B.length - pre &&
    A[A.length - 1 - suf] === B[B.length - 1 - suf]
  )
    suf++;
  const a = A.slice(pre, A.length - suf);
  const b = B.slice(pre, B.length - suf);
  const n = a.length;
  const m = b.length;
  // lcs[i][j] = LCS length of a[i..] and b[j..]
  const lcs = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      lcs[i]![j] =
        a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
  const out: DiffLine[] = A.slice(0, pre).map((text, k) => ({ kind: '=', text, line: k + 1 }));
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      out.push({ kind: '=', text: a[i]!, line: pre + i + 1 });
      i++;
      j++;
    } else if (j >= m || (i < n && lcs[i + 1]![j]! >= lcs[i]![j + 1]!)) {
      out.push({ kind: '-', text: a[i]!, line: pre + i + 1 });
      i++;
    } else {
      out.push({ kind: '+', text: b[j]!, line: pre + j + 1 });
      j++;
    }
  }
  for (let k = A.length - suf; k < A.length; k++) out.push({ kind: '=', text: A[k]!, line: k + 1 });
  return out;
}

export const whitespaceOnly = (before: string, after: string): boolean =>
  before !== after && before.replace(/\s+/g, '') === after.replace(/\s+/g, '');
