import { useBlocker } from 'react-router';
import { T } from '../copy/ko';
import { Button, Dialog, useBeforeUnload } from '../components/ui';

/** 저장하지 않은 내용이 있을 때 화면 이동·새로고침을 막고 확인한다 */
export function UnsavedGuard({ dirty, message = T.admin.unsavedLeave }: { dirty: boolean; message?: string }) {
  useBeforeUnload(dirty);
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname);
  return (
    <Dialog
      open={blocker.state === 'blocked'}
      onClose={() => blocker.reset?.()}
      title="저장하지 않은 내용이 있습니다"
      footer={
        <>
          <Button variant="secondary" onClick={() => blocker.reset?.()}>
            계속 작성하기
          </Button>
          <Button variant="danger" onClick={() => blocker.proceed?.()}>
            저장하지 않고 이동
          </Button>
        </>
      }
    >
      <p className="text-[15px] leading-relaxed">{message}</p>
    </Dialog>
  );
}
