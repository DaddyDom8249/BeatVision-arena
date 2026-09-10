(()=>{
  const MAX_ENTRY=6000;
  const MAX_LOG=30000;
  const compact=(data)=>{
    if(data==null)return '';
    const raw=typeof data==='string'?data:JSON.stringify(data,null,2);
    return raw.length>MAX_ENTRY?`${raw.slice(0,MAX_ENTRY)}\n… [entry truncated for mobile copy; ${raw.length-MAX_ENTRY} chars omitted]`:raw;
  };
  window.log=function(message,data){
    const el=document.getElementById('log');
    if(!el)return;
    const stamp=new Date().toLocaleTimeString();
    const body=compact(data);
    const line=`[${stamp}] ${message}`+(body?`\n${body}`:'');
    let next=el.value&&el.value!=='Ready.'?`${el.value}\n${line}`:line;
    if(next.length>MAX_LOG)next=`… [older log content trimmed for mobile copy]\n${next.slice(-(MAX_LOG-50))}`;
    el.value=next;
    el.scrollTop=el.scrollHeight;
  };
})();