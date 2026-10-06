import { useCallback, useEffect, useState } from 'react';
import type { ListSubmission } from '../lib/types';
import { useAdminData } from './AdminData';

export function useSubmissions() {
  const { call } = useAdminData();
  const [list, setList] = useState<ListSubmission[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const reload = useCallback(async () => {
    setError(null);
    try {
      setList(await call<ListSubmission[]>('admin_list_submissions'));
    } catch (e) {
      setError(e);
    }
  }, [call]);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { list, error, reload };
}
