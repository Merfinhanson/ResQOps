import {useEffect,useState} from 'react';
import type {FormEvent} from 'react';
import {AlertTriangle,ShieldCheck} from 'lucide-react';
import {api} from './shared';
import type {ClassifiedIncident,SeverityLevel,SeverityOverride} from './types';

const levels:SeverityLevel[]=['LOW','MEDIUM','HIGH','CRITICAL'];
export function SeverityBadge({value}:{value:SeverityLevel}) {
  return <span className={'rq-severity rq-'+value.toLowerCase()}>{value==='CRITICAL'&&<AlertTriangle size={13}/>} {value}</span>;
}

export default function SeverityReview({incident,onChange}:{incident:ClassifiedIncident;onChange:(incident:ClassifiedIncident)=>void}) {
  const [history,setHistory]=useState<SeverityOverride[]|null>(null);
  const [historyError,setHistoryError]=useState('');
  const [severity,setSeverity]=useState<SeverityLevel>(incident.severity);
  const [reason,setReason]=useState('');
  const [confirm,setConfirm]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const endpoint='/admin/incidents/'+incident.id;
  useEffect(()=>{
    let active=true;
    api(endpoint).then(result=>{if(active)setHistory(result.severityHistory??[]);})
      .catch(error=>{if(active)setHistoryError(error.message);});
    return ()=>{active=false;};
  },[endpoint]);
  useEffect(()=>{setSeverity(incident.severity);setConfirm(false);},[incident.severity]);

  async function submit(event:FormEvent) {
    event.preventDefault();
    if (!confirm) { setConfirm(true); return; }
    setBusy(true);setError('');setNotice('');
    try {
      const result=await api(endpoint+'/severity',{method:'PATCH',body:JSON.stringify({severity,reason:reason.trim()})});
      setHistory(result.severityHistory);setHistoryError('');setReason('');setConfirm(false);
      setNotice('Severity updated. Original assessment retained.');
      onChange(result.incident);
    } catch (error) { setError((error as Error).message); }
    finally {setBusy(false);}
  }

  return <section className="rq-assessment" aria-labelledby="classification-title">
    <div className="rq-assessment-heading"><ShieldCheck size={18}/><h3 id="classification-title">Rule-based classification</h3>
      {incident.reviewRequired&&<span className="rq-review">Human review required</span>}</div>
    <div className="rq-assessment-meta"><span>Current <SeverityBadge value={incident.severity}/></span>
      <span>Initial {incident.automatedSeverity?<SeverityBadge value={incident.automatedSeverity}/>:<strong>Unavailable for this legacy record</strong>}</span>
      <code>{incident.classificationVersion}</code></div>
    {incident.classificationReason&&<p>{incident.classificationReason}</p>}
    {incident.severityOverridden&&<p><strong>Current override:</strong> {incident.severityReason}</p>}
    {!!incident.reviewReasons?.length&&<ul>{incident.reviewReasons.map(item=><li key={item}>{item}</li>)}</ul>}
    {incident.classifiedAt&&<small>Assessed {new Date(incident.classifiedAt).toLocaleString()}</small>}
    <details>
      <summary>Override severity</summary>
      <form className="rq-override" onSubmit={submit}>
        <label className="field-label">New severity<select value={severity} disabled={busy} onChange={event=>{setSeverity(event.target.value as SeverityLevel);setConfirm(false);}}>
          {levels.map(level=><option key={level}>{level}</option>)}
        </select></label>
        <label className="field-label">Justification<textarea rows={2} value={reason} required minLength={8} maxLength={500}
          disabled={busy} onChange={event=>{setReason(event.target.value);setConfirm(false);}} placeholder="Explain why the current severity should change."/></label>
        {confirm&&<p role="status">Confirm changing {incident.severity} to {severity}. This will update the queue, metrics, and map.</p>}
        <div className="rq-actions"><button className="button outline" disabled={busy||severity===incident.severity||reason.trim().length<8}>{busy?'Saving…':confirm?'Confirm severity override':'Review override'}</button>
          {confirm&&<button type="button" className="button quiet" disabled={busy} onClick={()=>setConfirm(false)}>Cancel</button>}</div>
        {error&&<p className="api-error" role="alert">{error}</p>}
        {notice&&<p role="status">{notice}</p>}
      </form>
    </details>
    <details open={!!history?.length}>
      <summary>Override history {history?.length ? `(${history.length})` : ''}</summary>
      {historyError&&<p role="alert">{historyError}</p>}
      {!history&&!historyError&&<p>Loading audit history…</p>}
      {history?.length===0&&<p>No audited overrides recorded.</p>}
      <ol>{history?.map(item=><li key={item.id}><strong>{item.previousSeverity} → {item.newSeverity}</strong>
        <p>{item.reason}</p><small>{item.adminId} · {new Date(item.changedAt).toLocaleString()}</small></li>)}</ol>
    </details>
  </section>;
}
