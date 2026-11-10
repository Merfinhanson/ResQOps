import {useCallback,useEffect,useRef,useState} from 'react';
import {Link,useLocation,useNavigate} from 'react-router-dom';
import {Activity,AlertTriangle,ArrowRight,BarChart3,Bell,CheckCircle2,ChevronDown,Clock3,LayoutDashboard,ListOrdered,LogOut,MapPin,Menu,PanelLeftClose,Plus,RefreshCw,Search,Settings,Shield,Trash2,Truck,UsersRound,X} from 'lucide-react';
import type {LucideIcon} from 'lucide-react';
import {Bar,BarChart,CartesianGrid,Cell,Pie,PieChart,ResponsiveContainer,Tooltip,XAxis,YAxis} from 'recharts';
import {api,Brand,categories} from './shared';
import HotspotMap from './HotspotMap';
import {IncidentDispatch,IncidentDrawer} from './Operations';
import SeverityReview,{SeverityBadge} from './SeverityReview';
import type {ClassifiedIncident,ResponseTeam} from './types';

const levels=['CRITICAL','HIGH','MEDIUM','LOW'];
const severityColors=['#EF4444','#F97316','#EAB308','#22C55E'];
const statuses=['Reported','Pending','Assigned','In Progress','Resolved'];
type Analytics = {
  total:number; critical:number; availableTeams:number; busyTeams:number; assigned:number; resolved:number;
  awaitingStart:number; responding:number; completedAssignments:number; unmapped:number;
  categories:{category:string;count:number}[]; severities:{severity:string;count:number}[]; statuses:{status:string;count:number}[];
};
const navigation=[
  {label:'Overview', id:'overview', Icon:LayoutDashboard},
  {label:'Emergency Incidents', id:'recent-incidents', Icon:Activity},
  {label:'Incident Priority Queue', id:'incident-list', Icon:ListOrdered},
  {label:'Team Assignments', id:'assignments', Icon:Shield},
  {label:'Interactive Map', id:'incident-map', Icon:MapPin},
  {label:'Analytics', id:'analytics', Icon:BarChart3},
];
const timestamp=(value:string)=>new Date(value).toLocaleString(undefined,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
const chartTooltip={background:'#111E33',border:'1px solid #263852',color:'#F8FAFC'};

function StatusBadge({value}:{value:string}) {
  return <span className={'rq-status rq-status-'+value.toLowerCase().replace(' ','-')}><i/>{value}</span>;
}

function Metric({label,value,Icon,tone}:{label:string;value?:number;Icon:LucideIcon;tone:string}) {
  return <article className={'rq-metric rq-tone-'+tone}><div><span>{label}</span><Icon size={18}/></div>
    {value===undefined?<div className="rq-skeleton" aria-label={'Loading '+label}/>:<strong>{value.toLocaleString()}</strong>}</article>;
}

function Charts({stats,error,motion}:{stats:Analytics|null;error:string;motion:boolean}) {
  const categoryData=categories.map(category=>({name:category.replace(' Emergency','').replace(' Emergencies',''),count:stats?.categories.find(item=>item.category===category)?.count??0}));
  const severityData=levels.map((severity,index)=>({name:severity,count:stats?.severities.find(item=>item.severity===severity)?.count??0,color:severityColors[index]}));
  return <section id="analytics" className="rq-admin-section" aria-labelledby="analytics-title">
    <div className="rq-panel-heading"><div><span className="rq-kicker">Operational analytics</span><h2 id="analytics-title">Incident intelligence</h2></div></div>
    <div className="rq-chart-grid">
      <article className="rq-panel"><h3>Incidents by category</h3>{stats?.total?
        <div className="rq-chart"><ResponsiveContainer width="100%" height="100%"><BarChart data={categoryData} margin={{left:-22,right:12,bottom:12}}>
          <CartesianGrid vertical={false} stroke="#263852"/><XAxis dataKey="name" tick={{fill:'#94A3B8',fontSize:10}} interval={0}/><YAxis allowDecimals={false} tick={{fill:'#94A3B8',fontSize:10}}/>
          <Tooltip contentStyle={chartTooltip} itemStyle={{color:'#F8FAFC'}} cursor={{fill:'#172740'}}/><Bar dataKey="count" name="Incidents" fill="#38BDF8" radius={[4,4,0,0]} maxBarSize={36} animationDuration={260} isAnimationActive={motion}/>
        </BarChart></ResponsiveContainer></div>:<p className="rq-empty">{error?'Analytics unavailable.':stats?'No reports yet.':'Loading category distribution…'}</p>}</article>
      <article className="rq-panel"><h3>Severity distribution</h3>{stats?.total?<><div className="rq-chart rq-donut">
        <ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={severityData} dataKey="count" nameKey="name" innerRadius="57%" outerRadius="85%" animationDuration={260} isAnimationActive={motion}>
          {severityData.map(item=><Cell key={item.name} fill={item.color} stroke="#111E33"/>)}
        </Pie><Tooltip contentStyle={chartTooltip} itemStyle={{color:'#F8FAFC'}}/></PieChart></ResponsiveContainer>
      </div><ul className="rq-chart-legend">{severityData.map(item=><li key={item.name}><i style={{background:item.color}}/>{item.name}<strong>{item.count}</strong></li>)}</ul></>:<p className="rq-empty">{error?'Analytics unavailable.':stats?'No severity data yet.':'Loading severity distribution…'}</p>}</article>
      <article className="rq-panel"><h3>Status distribution</h3>{stats?<ul className="rq-status-chart">{statuses.map(status=>{
        const count=stats.statuses?.find(item=>item.status===status)?.count??0;
        return <li key={status}><div><StatusBadge value={status}/><strong>{count}</strong></div><progress value={count} max={Math.max(1,stats.total)} aria-label={status}/></li>;
      })}</ul>:<p className="rq-empty">{error?'Analytics unavailable.':'Loading status distribution…'}</p>}</article>
    </div>
  </section>;
}

export default function Dashboard() {
  const navigate=useNavigate();
  const location=useLocation();
  const requestVersion=useRef(0);
  const [all,setAll]=useState<ClassifiedIncident[]>([]);
  const [queue,setQueue]=useState<ClassifiedIncident[]>([]);
  const [teams,setTeams]=useState<ResponseTeam[]>([]);
  const [stats,setStats]=useState<Analytics|null>(null);
  const [selected,setSelected]=useState<ClassifiedIncident|null>(null);
  const [query,setQuery]=useState('');
  const [category,setCategory]=useState('');
  const [severity,setSeverity]=useState('');
  const [status,setStatus]=useState('');
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [toast,setToast]=useState('');
  const [mobileOpen,setMobileOpen]=useState(false);
  const [compact,setCompact]=useState(()=>localStorage.getItem('resqops-compact')==='true');
  const [reduced,setReduced]=useState(()=>localStorage.getItem('resqops-reduced')==='true');
  const [systemReduced,setSystemReduced]=useState(()=>matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [activeNav,setActiveNav]=useState('overview');
  const [username,setUsername]=useState('');
  useEffect(()=>{
    const preference=matchMedia('(prefers-reduced-motion: reduce)');
    const update=()=>setSystemReduced(preference.matches);
    preference.addEventListener('change',update);
    return ()=>preference.removeEventListener('change',update);
  },[]);
  useEffect(()=>{localStorage.setItem('resqops-compact',String(compact));},[compact]);
  useEffect(()=>{
    localStorage.setItem('resqops-reduced',String(reduced));
    document.body.classList.toggle('rq-reduced',reduced);
    return ()=>document.body.classList.remove('rq-reduced');
  },[reduced]);

  const load=useCallback(async(background=false)=>{
    const version=++requestVersion.current;
    if(!background)setLoading(true);
    try {
      const filters=new URLSearchParams({search:query,category,severity,status});
      const [analytics,filtered,incidents,roster]=await Promise.all([
        api('/admin/analytics'),api('/admin/priority-queue?'+filters),api('/admin/incidents'),api('/admin/teams')
      ]);
      if(version!==requestVersion.current)return;
      setStats(analytics);setQueue(filtered.incidents);setAll(incidents.incidents);setTeams(roster.teams);setError('');
      setSelected(current=>current?(incidents.incidents.find((row:ClassifiedIncident)=>row.id===current.id)??null):null);
    } catch(error) {
      if(version!==requestVersion.current)return;
      const message=(error as Error).message;
      if(message.includes('Authentication'))navigate('/admin/login',{replace:true});else setError(message);
    } finally {if(version===requestVersion.current)setLoading(false);}
  },[query,category,severity,status,navigate]);
  useEffect(()=>{
    const debounce=window.setTimeout(()=>void load(),query?200:0);
    const poll=window.setInterval(()=>{if(!document.hidden)void load(true);},15000);
    return ()=>{window.clearTimeout(debounce);window.clearInterval(poll);requestVersion.current++;};
  },[load,query]);
  useEffect(()=>{api('/admin/session').then(result=>setUsername(result.username??'')).catch(()=>{});},[]);
  useEffect(()=>{
    const incidentId=new URLSearchParams(location.search).get('incident');
    if(!incidentId||!all.length)return;
    const incident=all.find(row=>row.id===incidentId);
    if(incident) {setSelected(incident);navigate('/admin',{replace:true});}
  },[all,location.search,navigate]);
  useEffect(()=>{
    if(!toast)return;
    const timer=window.setTimeout(()=>setToast(''),4500);
    return ()=>window.clearTimeout(timer);
  },[toast]);

  const recent=[...all].sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,5);
  const review=all.filter(row=>row.status!=='Resolved'&&row.reviewRequired);
  const unmapped=all.filter(row=>row.latitude==null||row.longitude==null);
  const assignable=all.find(row=>row.status==='Reported'||row.status==='Pending');
  const available=teams.filter(team=>team.availability==='Available');
  const busy=teams.filter(team=>team.availability==='Busy');
  function updateIncident(incident:ClassifiedIncident) {
    setSelected(incident);void load(true);
  }
  async function logout() {
    try {await api('/admin/logout',{method:'POST'});navigate('/admin/login');}
    catch(error){setToast((error as Error).message);}
  }
  async function removeIncident(incident:ClassifiedIncident) {
    if(!window.confirm('Delete '+incident.id+'?'))return;
    try {await api('/admin/incidents/'+incident.id,{method:'DELETE'});setSelected(null);setToast('Incident deleted.');void load(true);}
    catch(error){setToast((error as Error).message);}
  }
  function chooseSection(id:string){setActiveNav(id);setMobileOpen(false);}

  return <div className={'rq-command ops-theme'+(compact?' rq-compact':'')} id="overview">
    {mobileOpen&&<button className="rq-sidebar-scrim" aria-label="Close navigation" onClick={()=>setMobileOpen(false)}/>}
    <aside className={'rq-sidebar'+(mobileOpen?' open':'')}>
      <div className="rq-sidebar-brand"><Brand/><button className="icon-button rq-collapse" aria-label={compact?'Expand sidebar':'Collapse sidebar'} onClick={()=>setCompact(!compact)}><PanelLeftClose size={17}/></button></div>
      <span className="rq-nav-caption">OPERATIONS</span>
      <nav aria-label="Command Centre navigation">{navigation.map(({label,id,Icon})=><a key={id} href={'#'+id} title={label}
        className={activeNav===id?'active':''} aria-current={activeNav===id?'location':undefined} onClick={()=>chooseSection(id)}><Icon size={17}/><span>{label}</span></a>)}
        <Link to="/admin/teams" title="Response Teams"><Truck size={17}/><span>Response Teams</span></Link>
        <Link to="/circles" title="Family and Community Circles"><UsersRound size={17}/><span>Family & Community Circles</span></Link>
        <a href="#settings" title="Settings" className={activeNav==='settings'?'active':''} aria-current={activeNav==='settings'?'location':undefined}
          onClick={()=>chooseSection('settings')}><Settings size={17}/><span>Settings</span></a>
      </nav>
      <div className="rq-sidebar-bottom"><span>CODE CLASH 2026</span><small>ROUND 2 · DEMO WORKSPACE</small></div>
    </aside>
    <div className="rq-command-main">
      <header className="rq-command-header">
        <div className="rq-heading-group"><button className="icon-button rq-mobile-toggle" aria-expanded={mobileOpen} aria-label="Toggle navigation" onClick={()=>setMobileOpen(!mobileOpen)}><Menu size={19}/></button>
          <div><span className="rq-kicker">RESQOPS / OPERATIONS</span><h1>Command Centre</h1></div></div>
        <div className="rq-header-controls">
          <Link className="button primary" to="/report"><Plus size={16}/> New Report</Link>
          <button className="icon-button" aria-label="Refresh dashboard" onClick={()=>void load(true)}><RefreshCw size={17}/></button>
          <details className="rq-menu"><summary aria-label="Incident notifications"><Bell size={18}/>{review.length>0&&<b>{review.length}</b>}</summary>
            <div className="rq-menu-popover"><strong>Needs review</strong>{review.length?review.slice(0,6).map(row=><button key={row.id} onClick={event=>{event.currentTarget.closest('details')?.removeAttribute('open');setSelected(row);}}>{row.title}</button>):<p>No open reports flagged for review.</p>}</div></details>
          <details className="rq-menu"><summary aria-label="Administrator profile"><span className="rq-avatar">{username.slice(0,2).toUpperCase()||'AD'}</span><ChevronDown size={13}/></summary>
            <div className="rq-menu-popover"><strong>{username||'Administrator'}</strong><small>Command Centre operator</small><button onClick={()=>void logout()}><LogOut size={15}/> Sign out</button></div></details>
        </div>
      </header>
      <main className="rq-command-content">
        <section className="rq-command-intro"><div><span className="rq-kicker">INCIDENT COORDINATION</span><h2>Operations overview</h2>
          <p>Review reports, coordinate response teams, and track each assignment.</p></div>
          <div className="rq-actions"><Link className="button outline" to="/admin/teams">Manage teams</Link>
            <button className="button outline" disabled={!assignable} onClick={()=>setSelected(assignable??null)}>Assign team <ArrowRight size={15}/></button></div></section>
        {error&&<div className="api-error" role="alert">{error} <button onClick={()=>void load()}>Retry</button></div>}
        <section className="rq-metrics" aria-label="Key metrics">
          <Metric label="Total Incidents" value={stats?.total} Icon={Activity} tone="blue"/>
          <Metric label="Critical Incidents" value={stats?.critical} Icon={AlertTriangle} tone="red"/>
          <Metric label="Available Teams" value={stats?.availableTeams} Icon={Truck} tone="green"/>
          <Metric label="Busy Teams" value={stats?.busyTeams} Icon={Clock3} tone="amber"/>
          <Metric label="Assigned Incidents" value={stats?.assigned} Icon={Shield} tone="blue"/>
          <Metric label="Resolved Incidents" value={stats?.resolved} Icon={CheckCircle2} tone="green"/>
        </section>
        <div className="rq-operations-grid">
          <section id="incident-list" className="rq-panel rq-queue" aria-labelledby="queue-title">
            <div className="rq-panel-heading"><div><span className="rq-kicker">RESPONSE ORDER</span><h2 id="queue-title">Priority Queue <span className="rq-tag">{queue.length}</span></h2></div></div>
            <div className="rq-filters">
              <label className="rq-search"><Search size={16}/><input aria-label="Search incidents" value={query} onChange={event=>setQuery(event.target.value)} placeholder="Search incident, ID, location…"/></label>
              <select aria-label="Filter by category" value={category} onChange={event=>setCategory(event.target.value)}><option value="">All categories</option>{categories.map(item=><option key={item}>{item}</option>)}</select>
              <select aria-label="Filter by severity" value={severity} onChange={event=>setSeverity(event.target.value)}><option value="">All severities</option>{levels.map(item=><option key={item}>{item}</option>)}</select>
              <select aria-label="Filter by status" value={status} onChange={event=>setStatus(event.target.value)}><option value="">Active incidents</option>{statuses.map(item=><option key={item}>{item}</option>)}</select>
            </div>
            {loading?<div className="rq-skeleton-stack" aria-label="Loading incidents"><div/><div/><div/></div>:queue.length===0?
              <p className="rq-empty">{error?'Queue unavailable.':'No incidents match these filters.'}</p>:
              <table className="rq-queue-table">
                <thead><tr><th>Incident</th><th>Severity</th><th>Priority</th><th>Status</th></tr></thead>
                <tbody>{queue.map(row=><tr key={row.id} className={row.severity==='CRITICAL'?'rq-critical-row':''}>
                  <td><button className="rq-incident-link" onClick={()=>setSelected(row)}><strong>{row.title}</strong><code>{row.id}</code></button>
                    <small>{row.category} · {row.location}</small></td>
                  <td data-label="Severity"><SeverityBadge value={row.severity}/>{row.reviewRequired&&<small className="rq-review">Needs review</small>}</td>
                  <td data-label="Priority"><strong>{row.priority?.score??'—'}/100</strong><small>{row.rank?'#'+row.rank+' · ':''}{row.priority?.waitingMinutes??'—'} min</small></td>
                  <td data-label="Status"><StatusBadge value={row.status}/></td>
                </tr>)}</tbody>
              </table>}
            <small className="rq-panel-note">Severity measures seriousness. Priority also accounts for people affected, time waiting, and category.</small>
          </section>
          <div id="incident-map" className="rq-map-column"><HotspotMap incidents={all} teams={teams} onOpen={incident=>setSelected(all.find(row=>row.id===incident.id)??null)}/>
            <details className="rq-panel rq-unmapped"><summary>Incidents without coordinates ({unmapped.length})</summary>
              {unmapped.length===0?<p>No unmapped incidents.</p>:unmapped.map(row=><button key={row.id} className="rq-text-button" onClick={()=>setSelected(row)}>{row.title} · {row.id}</button>)}
            </details></div>
        </div>
        <div className="rq-secondary-grid">
          <section id="recent-incidents" className="rq-panel"><div className="rq-panel-heading"><div><span className="rq-kicker">LATEST REPORTS</span><h2>Recent incidents</h2></div></div>
            {recent.length?recent.map(row=><button className="rq-recent-row" key={row.id} onClick={()=>setSelected(row)}><div><strong>{row.title}</strong><code>{timestamp(row.createdAt)}</code></div><SeverityBadge value={row.severity}/></button>):
              <p className="rq-empty">{error?'Recent incidents unavailable.':loading?'Loading recent incidents…':'No reports yet.'}</p>}
          </section>
          <section id="assignments" className="rq-panel"><div className="rq-panel-heading"><div><span className="rq-kicker">RESPONSE CAPACITY</span><h2>Teams & assignments</h2></div><Link to="/admin/teams">View roster <ArrowRight size={14}/></Link></div>
            <div className="rq-team-counts"><span><i/> {stats?available.length:'—'} Available</span><span><i/> {stats?busy.length:'—'} Busy</span></div>
            <ul className="rq-assignment-counts"><li>Awaiting start <strong>{stats?.awaitingStart??'—'}</strong></li><li>Responding <strong>{stats?.responding??'—'}</strong></li><li>Completed assignments <strong>{stats?.completedAssignments??'—'}</strong></li></ul>
            {teams.filter(team=>team.assignedIncidentId).slice(0,5).map(team=><button key={team.id} className="rq-text-button" onClick={()=>setSelected(all.find(row=>row.id===team.assignedIncidentId)??null)}>{team.name} · {team.assignedIncidentId}</button>)}
          </section>
        </div>
        <Charts stats={stats} error={error} motion={!reduced&&!systemReduced}/>
        <section className="rq-panel rq-admin-section rq-settings" id="settings" aria-labelledby="settings-title">
          <span className="rq-kicker">Workspace preferences</span><h2 id="settings-title">Settings</h2>
          <label><input type="checkbox" checked={compact} onChange={event=>setCompact(event.target.checked)}/> Compact desktop navigation</label>
          <label><input type="checkbox" checked={reduced} onChange={event=>setReduced(event.target.checked)}/> Reduce workspace motion</label>
        </section>
        <p className="rq-demo-footer"><Shield size={15}/> Demonstration workspace. Assignments are recorded in ResQOps.</p>
      </main>
    </div>
    {selected&&<IncidentDrawer onClose={()=>setSelected(null)}>
      <div className="modal-head"><div><span className="rq-kicker">INCIDENT RECORD</span><h2>{selected.title}</h2><code>{selected.id}</code></div>
        <button className="icon-button" aria-label="Close incident details" onClick={()=>setSelected(null)}><X size={18}/></button></div>
      <div className="rq-drawer-tags"><SeverityBadge value={selected.severity}/><StatusBadge value={selected.status}/>{selected.reviewRequired&&<span className="rq-review">Needs review</span>}</div>
      <p className="rq-description">{selected.description}</p>
      <dl className="rq-detail-grid">
        <div><dt>Category</dt><dd>{selected.category}</dd></div><div><dt>People affected</dt><dd>{selected.peopleAffected}</dd></div>
        <div><dt>Location</dt><dd>{selected.location}</dd></div><div><dt>Coordinates</dt><dd><code>{selected.latitude!=null&&selected.longitude!=null?`${selected.latitude}, ${selected.longitude}`:'Not provided'}</code></dd></div>
        <div><dt>Reported</dt><dd><code>{timestamp(selected.createdAt)}</code></dd></div><div><dt>Updated</dt><dd><code>{timestamp(selected.updatedAt)}</code></dd></div>
        <div><dt>Reporter</dt><dd>{selected.reporterName||'Not provided'}</dd></div><div><dt>Contact</dt><dd>{selected.contactPhone||'Not provided'}</dd></div>
      </dl>
      <SeverityReview key={'classification-'+selected.id} incident={selected} onChange={updateIncident}/>
      <IncidentDispatch key={'dispatch-'+selected.id} incident={selected} teams={teams} onUpdate={incident=>updateIncident({...selected,...incident})}/>
      <button className="button outline rq-delete" onClick={()=>void removeIncident(selected)}><Trash2 size={16}/> Delete incident</button>
    </IncidentDrawer>}
    {toast&&<div className="toast rq-toast" role="status">{toast}<button aria-label="Dismiss notification" onClick={()=>setToast('')}><X size={15}/></button></div>}
  </div>;
}
