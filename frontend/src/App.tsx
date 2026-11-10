import {useState} from 'react';
import {Link,Route,Routes,useNavigate} from 'react-router-dom';
import {Activity,ArrowRight,BarChart3,ShieldCheck} from 'lucide-react';
import Dashboard from './Dashboard';
import Home from './Home';
import Report from './Report';
import Circles from './Circles';
import CircleChat from './CircleChat';
import {api,Brand} from './shared';
import {TeamsPage} from './Operations';

function Login(){const [error,setError]=useState(''),[busy,setBusy]=useState(false);const nav=useNavigate();const submit=async(e:React.FormEvent<HTMLFormElement>)=>{e.preventDefault();setBusy(true);setError('');const fd=new FormData(e.currentTarget);try{await api('/admin/login',{method:'POST',body:JSON.stringify({username:fd.get('username'),password:fd.get('password')})});nav('/admin')}catch(e){setError((e as Error).message)}finally{setBusy(false)}};return <div className="login-shell rq-auth"><div className="login-left"><Brand/><div><div className="eyebrow">RESQOPS ADMINISTRATION</div><h1>See the full<br/>incident picture.</h1><p>Secure access for authorized incident administrators.</p><div className="login-points"><span><ShieldCheck size={17}/> Protected incident records</span><span><BarChart3 size={17}/> Live database statistics</span><span><Activity size={17}/> Incident status management</span></div></div><small>ResQOps demonstration platform · 2026</small></div><div className="login-right"><Link to="/" className="back-link">← Return to overview</Link><div className="login-card"><span className="login-icon"><ShieldCheck size={23}/></span><div className="eyebrow muted">ADMIN PORTAL</div><h2>Welcome back.</h2><p>Sign in to manage incident reports.</p><form onSubmit={submit}><label className="field-label">Username<input name="username" required autoComplete="username" placeholder="Admin username"/></label><label className="field-label">Password<input name="password" required type="password" autoComplete="current-password" placeholder="Your password"/></label>{error&&<div className="api-error">{error}</div>}<button disabled={busy} className="button primary submit-button">{busy?'Signing in…':<>Sign in securely <ArrowRight size={17}/></>}</button></form><div className="secure-note"><ShieldCheck size={14}/> Session protected with an HTTP-only cookie</div></div></div></div>}

export default function App(){return <Routes><Route path="/" element={<Home/>}/><Route path="/report" element={<Report/>}/><Route path="/circles" element={<Circles/>}/><Route path="/circles/:id" element={<CircleChat/>}/><Route path="/admin/login" element={<Login/>}/><Route path="/admin" element={<Dashboard/>}/><Route path="/admin/teams" element={<TeamsPage/>}/><Route path="*" element={<Home/>}/></Routes>}
