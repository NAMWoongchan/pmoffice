import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import Page from './Page';
import NexpharmPage from './NexpharmPage';
import type { NexpharmTemplate } from './lib/nexpharm-production';
import { auth, slug } from './transport';
import './style.css';

const nexpharm = /^nexpharm-[0-9a-f]{12}$/.test(slug);
const center = nexpharm ? '/pms/nexpharm/' : '/pms/';
type Access = { canRead: boolean; canManage?: boolean; viewer: string;
  project?: { title: string; template?: NexpharmTemplate; status?: string } };

function Gate() {
  const [access, setAccess] = useState<Access | null>(null);
  const [message, setMessage] = useState('프로젝트 권한을 확인하고 있습니다.');
  useEffect(() => {
    let live = true, sequence = 0;
    let viewer: string | undefined;
    const check = async () => {
      const id = ++sequence;
      try {
        const { data: sessionData, error: sessionError } = await auth.auth.getSession();
        if (sessionError) throw sessionError;
        const account = sessionData.session?.user.id;
        if (!live || id !== sequence) return;
        viewer = account;
        const { data, error } = account
          ? await auth.rpc(nexpharm ? 'nexpharm_access' : 'pms_access', { p_slug: slug })
          : { data: null, error: null };
        if (live && id === sequence) {
          setAccess(account && !error && data?.canRead === true && (!nexpharm || data.project?.status !== 'draft')
            ? { ...data, viewer: account } : null);
          setMessage(error ? '서비스 연결을 확인해 주세요.' : '프로젝트 열람 권한이 없습니다. 로그인과 회원 권한을 확인해 주세요.');
        }
      } catch {
        if (live && id === sequence) {
          setAccess(null);
          setMessage('연결을 확인할 수 없어 프로젝트를 닫았습니다.');
        }
      }
    };
    check();
    const timer = setInterval(check, 30000);
    const { data } = auth.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT' || session?.user.id !== viewer) { ++sequence; setAccess(null); }
      if (event !== 'SIGNED_OUT') setTimeout(check, 0);
    });
    return () => { live = false; ++sequence; clearInterval(timer); data.subscription.unsubscribe(); };
  }, []);

  if (access?.canRead) return nexpharm && access.project
    ? <NexpharmPage key={access.viewer} title={access.project.title} template={access.project.template} canManage={access.canManage === true}/>
    : <Page/>;
  return <main className="loading"><h1>프로젝트 접근 확인</h1><p>{message}</p>
    <a href={center} target="_top">{nexpharm ? '프로젝트 센터' : '프로젝트 목록'}</a></main>;
}

createRoot(document.getElementById('root')!).render(<Gate/>);
