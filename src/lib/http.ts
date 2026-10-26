import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { AppError } from './domain';
export function fail(error: unknown) {
  if (error instanceof AppError)
    return NextResponse.json({ error: error.message }, { status: error.status });
  if (error instanceof ZodError)
    return NextResponse.json(
      {
        error:
          'Проверьте поля: ' +
          error.issues.map((i) => i.path.join('.') + ': ' + i.message).join('; '),
      },
      { status: 400 },
    );
  const e = error as { code?: string; message?: string };
  if (e.code === '23505')
    return NextResponse.json(
      { error: 'Такая запись уже существует. Проверьте номер или дубликаты.' },
      { status: 409 },
    );
  if (e.code === '23503')
    return NextResponse.json({ error: 'Связанная запись не найдена' }, { status: 400 });
  console.error('[AdAsset]', e.message);
  return NextResponse.json(
    { error: 'Не удалось выполнить операцию. Данные не изменены. Повторите попытку.' },
    { status: 500 },
  );
}
export const privateHeaders = { 'Cache-Control': 'private, no-store' };
