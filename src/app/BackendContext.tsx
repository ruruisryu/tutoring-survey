import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { getBackend, type BackendState } from '../lib/backend';
import type { Backend } from '../lib/backend/types';
import { T } from '../copy/ko';
import { LoadingBlock } from '../components/ui';
import { ParentLayout } from '../parent/ParentLayout';
import { StatusView } from '../parent/StatusView';

const Ctx = createContext<Backend | null>(null);

export function useBackend(): Backend {
  const b = useContext(Ctx);
  if (!b) throw new Error('BackendProvider 밖에서 사용할 수 없습니다.');
  return b;
}

export function BackendProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<BackendState | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    getBackend().then(setState, (e) => {
      console.error(e);
      setFailed(true);
    });
  }, []);
  if (failed) {
    return (
      <ParentLayout>
        <StatusView title={T.parent.status.loadError.title} body={T.parent.status.loadError.body} />
      </ParentLayout>
    );
  }
  if (!state) return <LoadingBlock />;
  if (state.status === 'unconfigured') {
    return (
      <ParentLayout>
        <StatusView title={T.setup.title} body={T.setup.body} />
      </ParentLayout>
    );
  }
  return (
    <Ctx.Provider value={state.backend}>
      {state.backend.kind === 'localdb' && (
        <p role="note" className="bg-warn-soft px-4 py-2 text-center text-[14px] font-medium text-warn">
          {T.devBanner}
        </p>
      )}
      {children}
    </Ctx.Provider>
  );
}
