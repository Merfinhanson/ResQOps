import {useState} from 'react';
import {Link,NavLink} from 'react-router-dom';
import {Activity,ArrowRight,ArrowUpRight,LocateFixed,ShieldCheck,UsersRound} from 'lucide-react';
import {Brand,Notice,categories,categoryMeta} from './shared';

const preview = [
  {label:'Intake', step:'01', title:'A clear report, quickly.', detail:'Share what happened, add a landmark or coordinates, and receive a reference with the initial severity.', to:'/report', action:'Open reporting'},
  {label:'Triage', step:'02', title:'See what needs attention.', detail:'Operators compare severity, affected population, wait time, and category in the priority queue.', to:'/admin', action:'Open command centre'},
  {label:'Response', step:'03', title:'Coordinate with the right team.', detail:'The command centre ranks available, compatible teams by straight-line distance. An operator confirms the assignment.', to:'/admin/teams', action:'Open team management'},
];

export default function Home() {
  const [index,setIndex]=useState(0);
  const mode=preview[index];
  return <div className="rq-home">
    <header className="rq-public-header"><Brand/><nav aria-label="Main navigation">
      <NavLink to="/" end>Overview</NavLink><NavLink to="/report">Report incident</NavLink><NavLink to="/circles">Circles</NavLink>
      <Link className="button outline" to="/admin"><ShieldCheck size={16}/> Command Centre</Link>
    </nav></header>
    <main className="rq-public-main">
      <section className="rq-hero">
        <div>
          <span className="rq-kicker"><Activity size={15}/> Emergency operations platform</span>
          <h1>Every Second<br/>Matters<span>.</span></h1>
          <p>Intelligent emergency reporting, response coordination, and incident management — connected in one platform.</p>
          <div className="rq-actions"><Link className="button primary" to="/report">Report Emergency <ArrowRight size={16}/></Link>
            <Link className="button outline" to="/admin">Open Command Centre <ArrowUpRight size={16}/></Link></div>
          <div className="rq-hero-note"><ShieldCheck size={16}/> Reports receive an explainable, rule-based severity assessment.</div>
        </div>
        <aside className="rq-preview" aria-label="Interactive platform preview">
          <div className="rq-preview-header"><span><LocateFixed size={16}/> OPERATIONS WORKFLOW</span><span className="rq-tag">PREVIEW</span></div>
          <div className="rq-preview-switch" aria-label="Preview stage">{preview.map((step,i)=>
            <button key={step.label} aria-pressed={index===i} onClick={()=>setIndex(i)}><span>{step.step}</span>{step.label}</button>)}</div>
          <div className="rq-preview-body" key={mode.label}>
            <span className="rq-preview-number">{mode.step}</span>
            <h2>{mode.title}</h2><p>{mode.detail}</p><Link to={mode.to}>{mode.action} <ArrowUpRight size={15}/></Link>
          </div>
          <div className="rq-preview-footer">REPORT <span/> PRIORITIZE <span/> COORDINATE</div>
        </aside>
      </section>
      <section className="rq-section" aria-labelledby="category-title">
        <div className="rq-section-head"><div><span className="rq-kicker">Public reporting</span><h2 id="category-title">Start with the incident type.</h2></div>
          <p>Pick a category to prefill the report. You can change it before submitting.</p></div>
        <div className="rq-category-grid">{categories.map(category=>{
          const Icon=categoryMeta[category].icon;
          return <Link key={category} to={'/report?category='+encodeURIComponent(category)}>
            <Icon size={22}/><strong>{category}</strong><ArrowUpRight size={15}/></Link>;
        })}</div>
      </section>
      <section className="rq-section" aria-labelledby="workflow-title">
        <div className="rq-section-head"><div><span className="rq-kicker">How it works</span><h2 id="workflow-title">From report to response.</h2></div></div>
        <div className="rq-workflow">{preview.map(step=><article key={step.step}><span>{step.step} / {step.label}</span><h3>{step.title}</h3><p>{step.detail}</p></article>)}</div>
      </section>
      <section className="rq-connect"><UsersRound size={30}/><div><span className="rq-kicker">Family & Community Connect</span>
        <h2>Keep your circle informed.</h2><p>Share safety check-ins and alerts with people in your private circles.</p></div>
        <Link className="button outline" to="/circles">Open Circles <ArrowRight size={16}/></Link></section>
      <Notice/>
    </main>
    <footer className="rq-public-footer"><Brand/><span>ResQOps · Code Clash 2026 demonstration</span></footer>
  </div>;
}
