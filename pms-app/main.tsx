import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import Page from './Page';
import NexpharmPage from './NexpharmPage';
import { auth, slug } from './transport';
import './style.css';

const nexpharm = /^nexpharm-[0-9a-f]{12}$/.test(slug);
const center = nexpharm ? '/pms/nexpharm/' : '/pms/';
type Access = { canRead: boolean; canManage?: boolean; project?: { title: string } };

function Gate() {
  const [access, setAccess] = useState<Access | null>(null);
  const [message, setMessage] = useState('프로젝트 권한을 확인하고 있습니다.');
  useEffect(() => {
    let live = true, sequence = 0;
    const check = async () => {
      const id = ++sequence;
      try {
        const { data, error } = await auth.rpc(nexpharm ? 'nexpharm_access' : 'pms_access', { p_slug: slug });
        if (live && id === sequence) {
          setAccess(!error && data?.canRead === true ? data : null);
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
    const { data } = auth.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') { ++sequence; setAccess(null); }
      else setTimeout(check, 0);
    });
    return () => { live = false; ++sequence; clearInterval(timer); data.subscription.unsubscribe(); };
  }, []);

  if (access?.canRead) return nexpharm && access.project
    ? <NexpharmPage title={access.project.title} canManage={access.canManage === true}/>
    : <Page/>;
  return <main className="loading"><h1>프로젝트 접근 확인</h1><p>{message}</p>
    <a href={center} target="_top">{nexpharm ? '프로젝트 센터' : '프로젝트 목록'}</a></main>;
}

createRoot(document.getElementById('root')!).render(<Gate/>);
