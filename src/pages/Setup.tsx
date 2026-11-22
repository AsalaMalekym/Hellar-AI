import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { Button, ErrorBox } from '../components/ui';
export default function Setup() {
  const [error,setError]=useState(''), [done,setDone]=useState(false), [busy,setBusy]=useState(false);
  async function submit(e:FormEvent<HTMLFormElement>) {
    e.preventDefault();setBusy(true);setError('');
    const form=e.currentTarget, data=Object.fromEntries(new FormData(form));
    try {
      if(data.password!==data.confirmPassword) throw Error('Пароли не совпадают.');
      await api('/setup',{method:'POST',headers:{'X-Setup-Token':String(data.setupToken)},body:JSON.stringify({name:data.name,email:data.email,password:data.password})});
      form.reset();setDone(true);
    } catch(e) {setError((e as Error).message);} finally {setBusy(false);}
  }
  return <section className="page-container narrow"><div className="glass auth-card">
    <h1>Первый запуск Hellar</h1><p>Создай аккаунт владельца. После этого ты сможешь выдавать приглашения.</p>
    <ErrorBox message={error}/>
    {done ? <p>Аккаунт создан. <Link className="text-link" to="/login">Перейти ко входу →</Link></p> :
      <form onSubmit={submit} className="form-stack">
        <label>Ключ первоначальной настройки<input name="setupToken" type="password" required minLength={32} autoComplete="off"/></label>
        <label>Имя<input name="name" required minLength={2} maxLength={60} autoComplete="name"/></label>
        <label>Почта<input name="email" type="email" required autoComplete="email"/></label>
        <label>Пароль<input name="password" type="password" required minLength={12} maxLength={128} autoComplete="new-password"/></label>
        <label>Повтори пароль<input name="confirmPassword" type="password" required minLength={12} maxLength={128} autoComplete="new-password"/></label>
        <Button disabled={busy}>{busy?'Создаём аккаунт…':'Создать аккаунт владельца'}</Button>
      </form>}
  </div></section>;
}
