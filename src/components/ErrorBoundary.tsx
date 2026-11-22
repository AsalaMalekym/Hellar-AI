import { Component, type ReactNode } from 'react';
export default class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <div className="page-container narrow glass">
        <p className="eyebrow">HELLAR AI</p>
        <h1>Не удалось открыть страницу</h1>
        <p>Обнови страницу. Сохранённые на сервере данные останутся на месте.</p>
        <button className="btn" onClick={() => location.reload()}>
          Обновить
        </button>
      </div>
    ) : (
      this.props.children
    );
  }
}
