export type RequestCounts = {
  used: number;
  chat: number;
  image: number;
  remainingEstimate: number | null;
};
export const requestNumber = (value: number | null | undefined) =>
  value == null ? '—' : value.toLocaleString('ru-RU');

export function RequestStats({ counts, label }: { counts: RequestCounts; label: string }) {
  return (
    <div className="request-stats" aria-label={label}>
      <div>
        <span>Использовано запросов</span>
        <strong>{requestNumber(counts.used)}</strong>
        <small>Текст: {requestNumber(counts.chat)} · Картинки: {requestNumber(counts.image)}</small>
      </div>
      <div>
        <span>Остаток в текстовых запросах</span>
        <strong>{counts.remainingEstimate == null ? '—' : '≈ ' + requestNumber(counts.remainingEstimate)}</strong>
        <small>Оценка по доступным кредитам</small>
      </div>
    </div>
  );
}
