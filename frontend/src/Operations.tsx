import {useEffect,useRef,useState} from 'react';
import type {FormEvent,ReactNode} from 'react';
import {createPortal} from 'react-dom';
import {Link,useNavigate} from 'react-router-dom';
import {api,Brand} from './shared';
import HotspotMap from './HotspotMap';
import type {Incident,ResponseTeam} from './types';
import './operations.css';

const teamCategories = ['Fire', 'Medical', 'Rescue', 'General Emergency'];
const lifecycle = ['Reported', 'Assigned', 'In Progress', 'Resolved'];
type Recommendation = ResponseTeam & {distanceKm:number;reason:string};
type Assignment = {id:string;teamId:string;teamName:string;assignedAt:string;startedAt:string|null;resolvedAt:string|null;status:string};
type DispatchData = {assignments:Assignment[];recommendations:Recommendation[];needsLocation:boolean;assignedTeam:ResponseTeam|null;assignedDistanceKm:number|null};

export function IncidentDrawer({children,onClose}:{children:ReactNode;onClose:()=>void}) {
  const drawer = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const priorFocus = document.activeElement;
    const priorOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    drawer.current?.focus();
    function handleKey(event:KeyboardEvent) {
      if (event.key === 'Escape') close.current();
      if (event.key !== 'Tab') return;
      const controls = Array.from(drawer.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href], summary'
      ) ?? []).filter(control => control.getClientRects().length);
      const first = controls[0], last = controls[controls.length - 1];
      if (!first || !last) { event.preventDefault(); return; }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === drawer.current)) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first.focus();
      }
    }
    document.addEventListener('keydown',handleKey);
    return () => {
      document.body.style.overflow = priorOverflow;
      document.removeEventListener('keydown',handleKey);
      if (priorFocus instanceof HTMLElement) priorFocus.focus();
    };
  },[]);
  return createPortal(<div className="modal-backdrop ops-drawer-backdrop" onClick={event=>{
    if (event.target === event.currentTarget) onClose();
  }}>
    <div ref={drawer} tabIndex={-1} className="incident-modal ops-incident-modal ops-theme" role="dialog" aria-modal="true" aria-label="Incident details">
      {children}
    </div>
  </div>,document.body);
}

function coordinates(form:FormData) {
  return {latitude:Number(form.get('latitude')),longitude:Number(form.get('longitude'))};
}

function CoordinateFields({latitude,longitude}:{latitude?:number|null;longitude?:number|null}) {
  return <>
    <label className="field-label">Latitude<input name="latitude" type="number" step="any" min="-90" max="90" required defaultValue={latitude??''}/></label>
    <label className="field-label">Longitude<input name="longitude" type="number" step="any" min="-180" max="180" required defaultValue={longitude??''}/></label>
  </>;
}

export function TeamsPage() {
  const navigate = useNavigate();
  const [teams,setTeams] = useState<ResponseTeam[]>([]);
  const [editing,setEditing] = useState<ResponseTeam|null>(null);
  const [ready,setReady] = useState(false);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  const [notice,setNotice] = useState('');
  useEffect(() => {
    let active = true;
    api('/admin/teams').then(data => {
      if (active) { setTeams(data.teams); setReady(true); }
    }).catch(e => {
      if (!active) return;
      if (e.message.includes('Authentication')) navigate('/admin/login');
      else setError(e.message);
    });
    return () => { active = false; };
  }, [navigate]);

  async function save(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setBusy(true); setError(''); setNotice('');
    try {
      const {team} = await api(editing ? '/admin/teams/'+editing.id : '/admin/teams', {
        method:editing ? 'PATCH' : 'POST',
        body:JSON.stringify({name:form.get('name'),category:form.get('category'),
          availability:editing?.assignedIncidentId ? 'Busy' : form.get('availability'),...coordinates(form)}),
      });
      setTeams(previous => [...previous.filter(t => t.id !== team.id),team].sort((a,b) => a.name.localeCompare(b.name)));
      setNotice(editing ? 'Team updated.' : 'Team created.');
      formElement.reset();
      setEditing(null);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  async function remove(team:ResponseTeam) {
    if (!window.confirm('Remove '+team.name+' from the active roster?')) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await api('/admin/teams/'+team.id,{method:'DELETE'});
      setTeams(previous => previous.filter(t => t.id !== team.id));
      if (editing?.id === team.id) setEditing(null);
      setNotice('Team removed.');
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  return <main className="operations-page ops-theme">
    <header className="ops-page-header"><Brand/><Link className="button outline" to="/admin">Command Dashboard</Link></header>
    <h1>Response teams</h1>
    <p>Demo roster · Assignments are recorded in ResQOps for the hackathon demonstration.</p>
    {error&&<div className="api-error" role="alert">{error}</div>}
    {notice&&<p role="status">{notice}</p>}
    {ready&&<section className="panel ops-panel">
      <h2>{editing ? 'Edit '+editing.name : 'Create a response team'}</h2>
      <form className="ops-fields" key={editing?.id??'create'} onSubmit={save}>
        <label className="field-label">Team name<input name="name" required minLength={2} maxLength={100} defaultValue={editing?.name}/></label>
        <label className="field-label">Response category<select name="category" defaultValue={editing?.category}>{teamCategories.map(category => <option key={category}>{category}</option>)}</select></label>
        <CoordinateFields latitude={editing?.latitude} longitude={editing?.longitude}/>
        <label className="field-label">Availability<select name="availability" disabled={!!editing?.assignedIncidentId} defaultValue={editing?.availability??'Available'}><option>Available</option><option>Busy</option></select></label>
        <div className="ops-actions"><button className="button primary" disabled={busy}>{editing?'Save team':'Create team'}</button>{editing&&<button type="button" className="button outline" onClick={()=>setEditing(null)}>Cancel</button>}</div>
      </form>
    </section>}
    <section className="panel ops-panel">
      <h2>Team roster</h2>
      {!ready&&!error&&<p>Loading teams…</p>}
      {ready&&!teams.length&&<p>No response teams yet.</p>}
      <div className="ops-roster">{teams.map(team => <article className="ops-team" key={team.id}>
        <div><strong>{team.name}</strong><div>{team.category} · {team.availability}</div>
          <small>{team.id}</small><div>{team.latitude}, {team.longitude}</div>
          {team.assignedIncidentId&&<Link to={'/admin?incident='+team.assignedIncidentId}>Assignment {team.assignedIncidentId}</Link>}</div>
        <div className="ops-actions"><button className="button outline" disabled={busy} onClick={()=>setEditing(team)}>Edit</button>
          <button className="button outline" disabled={busy||!!team.assignedIncidentId} onClick={()=>void remove(team)}>Remove</button></div>
      </article>)}</div>
    </section>
  </main>;
}

export function IncidentDispatch({incident,teams,onUpdate}:{incident:Incident;teams:ResponseTeam[];onUpdate:(incident:Incident)=>void}) {
  const [data,setData] = useState<DispatchData|null>(null);
  const [choice,setChoice] = useState<Recommendation|null>(null);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  const [revision,setRevision] = useState(0);
  const endpoint = '/admin/incidents/'+incident.id;
  useEffect(() => {
    let active = true;
    api(endpoint+'/recommendations').then(value => {
      if (active) setData(value);
    }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  },[endpoint,incident.updatedAt,revision]);
  const assignment = data?.assignments.find(item => !item.resolvedAt);
  const assignedTeam = teams.find(team => team.id === assignment?.teamId) ?? data?.assignedTeam;
  const best = data?.recommendations[0];
  const mapTeam = assignedTeam ?? best;
  const currentStep = lifecycle.indexOf(incident.status === 'Pending' ? 'Reported' : incident.status);

  async function update(path:string,body:object,method='PATCH') {
    setBusy(true); setError('');
    try {
      const result = await api(endpoint+path,{method,body:JSON.stringify(body)});
      setChoice(null);
      onUpdate(result.incident);
      setRevision(value => value+1);
    } catch(e) {
      setError((e as Error).message);
      setChoice(null);
      setRevision(value => value+1);
    } finally { setBusy(false); }
  }

  return <section className="dispatch-panel" aria-label="Response coordination">
    <h3>Response coordination</h3>
    <ol className="ops-stepper">{lifecycle.map((step,index) => <li key={step} className={index===currentStep?'current':index<currentStep?'passed':''} aria-current={index===currentStep?'step':undefined}>{step}</li>)}</ol>
    {incident.priority&&<p className="ops-ranking"><strong>{incident.rank ? '#'+incident.rank+' · ' : ''}{incident.priority.score}/100</strong>
      {' · '}{incident.priority.waitingMinutes} min waiting · Severity {incident.priority.factors.severity}/40 · People {incident.priority.factors.people}/25 · Wait {incident.priority.factors.waiting}/20 · Category {incident.priority.factors.category}/15</p>}
    {error&&<div className="api-error" role="alert">{error}</div>}
    {!data&&!error&&<p>Loading assignments and recommendations…</p>}
    {data?.needsLocation&&<form className="ops-fields" onSubmit={event=>{
      event.preventDefault(); void update('/location',coordinates(new FormData(event.currentTarget)));
    }}><p>Set the incident coordinates to calculate team distances.</p><CoordinateFields/><button className="button outline" disabled={busy}>Save incident location</button></form>}
    {assignment?<div className="ops-team">
      <div><strong>{assignment.teamName}</strong><div>{assignment.status} · {assignedTeam?.availability??'Busy'}{data?.assignedDistanceKm!=null&&' · '+data.assignedDistanceKm.toFixed(2)+' km'}</div></div>
      <button className="button primary" disabled={busy} onClick={()=>void update('/status',{status:assignment.status==='Assigned'?'In Progress':'Resolved'})}>
        {assignment.status==='Assigned'?'Mark In Progress':'Mark Resolved'}
      </button>
    </div>:data&&<>
      <label className="field-label">Incident status<select disabled={busy} value={incident.status} onChange={event=>void update('/status',{status:event.target.value})}>
        {['Reported','Pending','In Progress','Resolved'].map(status=><option key={status}>{status}</option>)}
      </select></label>
      {incident.status!=='Resolved'&&!data.needsLocation&&<div className="ops-recommendations">
        <h4>Suitable available teams</h4>
        {data.recommendations.length===0&&<p>No suitable available team</p>}
        {data.recommendations.map((team,index)=><article className="ops-team" key={team.id}>
          <div><strong>{team.name}{index===0?' · Nearest suitable team':''}</strong>
            <div>{team.category} · {team.availability} · {team.distanceKm.toFixed(2)} km</div><small>{team.reason}</small></div>
          <button className="button outline" disabled={busy} onClick={()=>setChoice(team)}>Assign team</button>
        </article>)}
      </div>}
    </>}
    {choice&&<section className="ops-confirm" aria-label="Confirm team assignment">
      <strong>Assign {choice.name} to {incident.id}?</strong>
      <p>{choice.distanceKm.toFixed(2)} km approximate straight-line distance. This records a demo assignment.</p>
      <div className="ops-actions"><button className="button primary" disabled={busy} onClick={()=>void update('/assign',{teamId:choice.id},'POST')}>Confirm assignment</button>
        <button className="button outline" disabled={busy} onClick={()=>setChoice(null)}>Cancel</button></div>
    </section>}
    {mapTeam&&incident.latitude!=null&&incident.longitude!=null&&<HotspotMap
      incidents={[incident]} teams={assignedTeam?[assignedTeam]:data?.recommendations}
      target={{incident,team:mapTeam}}/>}
    {!!data?.assignments.length&&<details open><summary>Assignment history</summary>
      <ul className="ops-history">{data.assignments.map(item=><li key={item.id}><strong>{item.teamName} · {item.status}</strong>
        <div>Assigned {new Date(item.assignedAt).toLocaleString()}</div>
        {item.startedAt&&<div>Started {new Date(item.startedAt).toLocaleString()}</div>}
        {item.resolvedAt&&<div>Resolved {new Date(item.resolvedAt).toLocaleString()}</div>}</li>)}</ul>
    </details>}
    <small className="ops-demo-note">Rule-based demo prioritization aid. Team assignments are for demonstration only and do not dispatch responders.</small>
  </section>;
}
