import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useApp } from '../context';
import { Loading, ErrorBox, Empty } from './ui';
export default function Guard({
  children,
  admin = false,
}: {
  children: ReactNode;
  admin?: boolean;
}) {
  const { user, loading, error } = useApp();
  if (loading) return <Loading />;
  if (error) return <ErrorBox message={error} />;
  if (!user) return <Navigate to="/login" replace />;
  if (admin && user.role !== 'admin')
    return <Empty title="Доступ ограничен">Этот раздел доступен администратору.</Empty>;
  return children;
}
