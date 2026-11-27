import { existsSync } from 'fs';
import { dirname, join } from 'path';

/** Kirill va lotin harflari uchun TTF shrift (standart PDF shriftlarida kirill yo'q) */
export function fontPath(
  bold = false,
  italic = false,
  condensed = false,
): string | null {
  const file = `DejaVuSans${condensed ? 'Condensed' : ''}${bold ? '-Bold' : ''}${italic ? (bold ? 'Oblique' : '-Oblique') : ''}.ttf`;
  const candidates: string[] = [];
  if (process.env.VOUCHER_FONT_DIR) {
    candidates.push(join(process.env.VOUCHER_FONT_DIR, file));
  }
  try {
    candidates.push(
      join(
        dirname(require.resolve('dejavu-fonts-ttf/package.json')),
        'ttf',
        file,
      ),
    );
  } catch {
    // paket topilmadi - quyidagi yo'llar sinab ko'riladi
  }
  candidates.push(
    join(process.cwd(), 'node_modules/dejavu-fonts-ttf/ttf', file),
    `/usr/share/fonts/truetype/dejavu/${file}`,
  );
  return candidates.find((p) => existsSync(p)) ?? null;
}
