import React,{useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import Page from './Page';
import {auth,slug} from './transport';
import './style.css';
function Gate(){
 const [ok,setOk]=useState(false),[message,setMessage]=useState('프로젝트 권한을 확인하고 있습니다.');
 useEffect(()=>{
 let live=true,sequence=0;
 const check=async()=>{const id=++sequence;try{const {data,error}=await auth.rpc('pms_access',{p_slug:slug});if(live&&id===sequence){setOk(!error&&data?.canRead===true);setMessage(error?'서비스 연결을 확인해 주세요.':'프로젝트 열람 권한이 없습니다. 상단에서 Google 로그인과 회원 권한을 확인해 주세요.')}}catch{if(live&&id===sequence){setOk(false);setMessage('연결을 확인할 수 없어 프로젝트를 닫았습니다.')}}};
 check();const timer=setInterval(check,30000);const {data}=auth.auth.onAuthStateChange(e=>{if(e==='SIGNED_OUT'){++sequence;setOk(false)}else setTimeout(check,0)});
 return()=>{live=false;++sequence;clearInterval(timer);data.subscription.unsubscribe()};
 },[]);
 return ok?<Page/>:<main className="loading"><h1>프로젝트 접근 확인</h1><p>{message}</p><a href="/pms/" target="_top">프로젝트 목록</a></main>;
}
createRoot(document.getElementById('root')!).render(<Gate/>);

