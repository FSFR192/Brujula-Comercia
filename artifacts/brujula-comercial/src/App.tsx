import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { Route, Switch, useLocation, Router as WouterRouter, Link } from 'wouter';
import { useAssistantRespond } from '@workspace/api-client-react';
import { MapContainer, TileLayer, CircleMarker, Popup, Polyline } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import {
  Activity, ArrowDownRight, ArrowRight, ArrowUpRight, BarChart3, Bell, BookOpen,
  Calculator, Check, ChevronDown, ChevronRight, CircleHelp, Compass,
  FileText, Gauge, Layers3, Map, Menu, MessageCircle,
  RefreshCw, Route as RouteIcon, Search, Send, Settings2, ShieldCheck, SlidersHorizontal,
  Sparkles, Target, Users, X,
} from 'lucide-react';
import { createModel, estimateIncentive, fmt, money, summarizeIncentives, type Assumptions, type Zone } from './data';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Line,
  Legend, PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar, RadarChart,
  ResponsiveContainer, Tooltip as ChartTooltip, XAxis, YAxis,
} from 'recharts';

const queryClient = new QueryClient();
const navGroups: { label: string; items: [string, string, typeof Gauge][] }[] = [
  { label: 'CICLO COMERCIAL', items: [
    ['/', 'Inicio', Gauge], ['/supuestos', 'Supuestos', Settings2],
  ]},
  { label: 'OPORTUNIDAD', items: [
    ['/radar', 'Radar territorial', Map], ['/radar/segmentos', 'Segmentos', Layers3], ['/radar/rutas', 'Rutas y equidad', RouteIcon],
  ]},
  { label: 'INCENTIVOS', items: [
    ['/incentivos/constructor', 'Constructor', SlidersHorizontal], ['/incentivos/desempeno', 'Desempeño', BarChart3],
    ['/incentivos/conducta', 'Conducta', Activity], ['/incentivos/comparador', 'Comparador', Calculator],
  ]},
  { label: 'DECISIÓN', items: [
    ['/puente', 'Puente de inclusión', ArrowRight], ['/asistente', 'Asistente', MessageCircle], ['/limites', 'Límites y fuentes', BookOpen],
  ]},
];
const routeTitles: Record<string, [string, string]> = {
  '/': ['Resumen del ciclo', 'INICIO'],
  '/supuestos': ['Supuestos del modelo', 'CONFIGURACIÓN'],
  '/radar': ['Radar de oportunidades', 'OPORTUNIDAD TERRITORIAL'],
  '/radar/segmentos': ['Perfiles de oportunidad', 'OPORTUNIDAD TERRITORIAL'],
  '/radar/rutas': ['Rutas y equidad', 'OPORTUNIDAD TERRITORIAL'],
  '/incentivos/constructor': ['Constructor de incentivos', 'DISEÑO DE INCENTIVOS'],
  '/incentivos/desempeno': ['Desempeño observado', 'DISEÑO DE INCENTIVOS'],
  '/incentivos/conducta': ['Volumen vs. equilibrio', 'DISEÑO DE INCENTIVOS'],
  '/incentivos/comparador': ['Comparador de escenarios', 'DISEÑO DE INCENTIVOS'],
  '/puente': ['Puente de inclusión', 'ANÁLISIS DE IMPACTO'],
  '/asistente': ['Asistente comercial', 'CONSULTA DE ESCENARIOS'],
  '/limites': ['Límites y fuentes', 'TRANSPARENCIA'],
};
const defaultAssumptions: Assumptions = { noise: 22, ruralPar: 7.8, tenureQuality: 5.2, matureNewClient: 12, volumeParDelta: 1.2, volumeConcentrationDelta: 12 };
const initialWeights = [35, 25, 15, 10, 15];
const weightNames = ['Productividad', 'Calidad de cartera', 'Colaboración', 'Desarrollo profesional', 'Inclusión territorial'];
const weightDescriptions = ['Volumen comercial sostenible', 'Control de PAR30 observado', 'Referidos y horas de mentoría', 'Horas de capacitación', 'Clientes captados en zonas ciegas'];
const months = ['May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic', 'Ene', 'Feb', 'Mar', 'Abr'];
const red = '#D6001C';
const tooltipContent = (text: string) => <span className="formula-tip" title={text} aria-label={text}><CircleHelp size={14} /></span>;

function readStore<T>(key: string, fallback: T): T {
  try {
    const saved = localStorage.getItem(key);
    if (!saved) return fallback;
    const parsed = JSON.parse(saved) as T;
    if (fallback && parsed && typeof fallback === 'object' && typeof parsed === 'object' && !Array.isArray(fallback) && !Array.isArray(parsed)) {
      return { ...fallback, ...parsed };
    }
    return parsed;
  } catch { return fallback; }
}
function useLocalValue<T>(key: string, fallback: T) {
  const [value, setValue] = useState<T>(() => readStore(key, fallback));
  useEffect(() => { localStorage.setItem(key, JSON.stringify(value)); }, [key, value]);
  return [value, setValue] as const;
}

function App() {
  return <QueryClientProvider client={queryClient}><TooltipProvider><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><Router /></WouterRouter><Toaster /></TooltipProvider></QueryClientProvider>;
}
function Router() {
  return <RoutedErrorBoundary><Switch>
    {Object.keys(routeTitles).map(path => <Route key={path} path={path} component={Workspace} />)}
    <Route component={NotFound} />
  </Switch></RoutedErrorBoundary>;
}
function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function Workspace() {
  const [path] = useLocation();
  const [mobileNav, setMobileNav] = useState(false);
  const [seed, setSeed] = useLocalValue('brujula-seed', 84217);
  const [assumptions, setAssumptions] = useLocalValue<Assumptions>('brujula-assumptions', defaultAssumptions);
  const [weights, setWeights] = useLocalValue<number[]>('brujula-weights-v2', initialWeights);
  const [gate, setGate] = useLocalValue('brujula-gates', { soft: 9, hard: 14, cap: 1.25, pool: 84000 });
  const [selectedZoneId, setSelectedZoneId] = useState('Z-01');
  const model = useMemo(() => createModel(seed, assumptions), [seed, assumptions]);
  const selectedZone = model.zones.find(z => z.id === selectedZoneId) ?? model.zones[0];
  const header = routeTitles[path] ?? routeTitles['/'];
  return <div className="app-shell">
    <aside className={`sidebar ${mobileNav ? 'sidebar-open' : ''}`}>
      <div className="brand"><div className="brand-mark"><Compass size={21} strokeWidth={2.5} /></div><div><strong>BRÚJULA</strong><small>COMERCIAL</small></div><button className="mobile-close" onClick={() => setMobileNav(false)} aria-label="Cerrar navegación"><X size={18} /></button></div>
      <div className="cycle-pill"><span className="cycle-dot" /><span>CICLO ABR · 2025</span><ChevronDown size={14} /></div>
      <nav className="main-nav" aria-label="Navegación principal">{navGroups.map(group => <section key={group.label} className="nav-group"><p>{group.label}</p>{group.items.map(([href, label, Icon]) => <Link key={href as string} href={href as string} className={`nav-link ${path === href ? 'active' : ''}`} onClick={() => setMobileNav(false)} data-testid={`link-nav-${String(href).replaceAll('/', '-').replace(/^-/, 'inicio')}`}><Icon size={17} strokeWidth={1.8} /><span>{label as string}</span>{path === href && <span className="nav-current" />}</Link>)}</section>)}</nav>
      <div className="sidebar-bottom"><div className="cycle-health"><div className="health-icon"><ShieldCheck size={17} /></div><div><b>Modelo local</b><small>Semilla {seed}</small></div><span className="health-dot" /></div><div className="sidebar-foot">Caja Trujillo <span>·</span> Comité Comercial</div></div>
    </aside>
    {mobileNav && <button className="nav-backdrop" aria-label="Cerrar menú" onClick={() => setMobileNav(false)} />}
    <main className="main-area">
      <header className="topbar"><button className="mobile-menu" onClick={() => setMobileNav(true)} aria-label="Abrir navegación" data-testid="button-open-navigation"><Menu size={20} /></button><div className="crumb">BRÚJULA COMERCIAL <ChevronRight size={13} /> <span>{header[1]}</span></div><div className="top-actions"><span className="top-cycle"><span className="cycle-dot" /> Ciclo activo</span><span className="icon-button" aria-label="Avisos"><Bell size={17} /><i /></span><div className="avatar">CC</div></div></header>
      <div className="content-wrap">
        <div className="safety-banner" data-testid="notice-synthetic"><ShieldCheck size={16} /><span><b>Entorno de demostración:</b> datos sintéticos, agregados y locales. No conectado a sistemas reales ni incluye datos personales.</span><span className="safety-divider" /><span>La prioridad expresa potencial estimado; <b>no es capacidad de pago ni elegibilidad crediticia.</b></span></div>
        <div className="page-heading"><div><p className="eyebrow">{header[1]}</p><h1>{header[0]}</h1><p className="page-subtitle">{subtitleFor(path)}</p></div><div className="heading-actions"><span className="seed-tag"><span className="cycle-dot" /> SEMILLA {seed}</span>{path !== '/asistente' && <button className="btn btn-outline" onClick={() => { setSeed((s: number) => s + 7919); }} data-testid="button-regenerate"><RefreshCw size={15} /> Regenerar</button>}</div></div>
        <PageContent path={path} model={model} seed={seed} setSeed={setSeed} assumptions={assumptions} setAssumptions={setAssumptions} weights={weights} setWeights={setWeights} gate={gate} setGate={setGate} selectedZone={selectedZone} selectedZoneId={selectedZoneId} setSelectedZoneId={setSelectedZoneId} />
        <footer className="app-footer"><span>BRÚJULA COMERCIAL <span className="footer-sep">/</span> PROTOTIPO DE TRABAJO</span><span>Fórmulas ejecutadas en este navegador <span className="footer-sep">·</span> S/. en formato es-PE</span></footer>
      </div>
    </main>
  </div>;
}
function subtitleFor(path: string) {
  const t: Record<string, string> = {
    '/': 'Una lectura equilibrada de potencial territorial y desempeño comercial.',
    '/supuestos': 'Ajusta los parámetros del escenario; todos los cambios ocurren en este navegador.',
    '/radar': 'Demanda potencial, cobertura y brechas de atención en La Libertad.',
    '/radar/segmentos': 'Agrupaciones sintéticas para describir contextos distintos, no perfiles de personas.',
    '/radar/rutas': 'Una propuesta territorial de visita y una lectura comparativa de acceso.',
    '/incentivos/constructor': 'Explora una fórmula transparente con métricas comerciales y de calidad.',
    '/incentivos/desempeno': 'Observado frente a esperado, con contexto territorial explícito.',
    '/incentivos/conducta': 'Qué cambia cuando el volumen deja de ser la única señal.',
    '/incentivos/comparador': 'Contrasta tres esquemas antes de llevar pesos al constructor.',
    '/puente': 'Observa cómo evoluciona el balance al ponderar inclusión territorial.',
    '/asistente': 'Consulta escenarios agregados; la respuesta no modifica el esquema de pago.',
    '/limites': 'Alcances, fuentes de referencia y decisiones que este modelo no toma.',
  };
  return t[path] ?? '';
}
type SharedProps = {
  path: string; model: ReturnType<typeof createModel>; seed: number; setSeed: (fn: (v: number) => number) => void;
  assumptions: Assumptions; setAssumptions: (v: Assumptions) => void; weights: number[]; setWeights: (v: number[]) => void;
  gate: { soft: number; hard: number; cap: number; pool: number }; setGate: (v: { soft: number; hard: number; cap: number; pool: number }) => void;
  selectedZone: Zone; selectedZoneId: string; setSelectedZoneId: (id: string) => void;
};
function PageContent(props: SharedProps) {
  switch (props.path) {
    case '/': return <HomePage {...props} />;
    case '/supuestos': return <AssumptionsPage {...props} />;
    case '/radar': return <RadarPage {...props} />;
    case '/radar/segmentos': return <SegmentsPage {...props} />;
    case '/radar/rutas': return <RoutesPage {...props} />;
    case '/incentivos/constructor': return <ConstructorPage {...props} />;
    case '/incentivos/desempeno': return <PerformancePage {...props} />;
    case '/incentivos/conducta': return <ConductPage {...props} />;
    case '/incentivos/comparador': return <ComparePage {...props} />;
    case '/puente': return <BridgePage {...props} />;
    case '/asistente': return <AssistantPage {...props} />;
    default: return <LimitsPage />;
  }
}
function Card({ children, className = '', testid }: { children: ReactNode; className?: string; testid?: string }) {
  return <section className={`panel ${className}`} data-testid={testid}>{children}</section>;
}
function CardTitle({ kicker, title, note, right }: { kicker?: string; title: string; note?: string; right?: ReactNode }) {
  return <div className="panel-head"><div>{kicker && <p className="eyebrow">{kicker}</p>}<h2>{title}</h2>{note && <p className="panel-note">{note}</p>}</div>{right}</div>;
}
function KPI({ label, value, change, detail, icon: Icon, color = 'red' }: { label: string; value: string; change?: string; detail?: string; icon: typeof Target; color?: string }) {
  return <Card className="kpi-card"><div className={`kpi-icon ${color}`}><Icon size={18} /></div><p className="kpi-label">{label}</p><div className="kpi-value" data-testid={`kpi-${label.toLowerCase().replaceAll(' ', '-')}`}>{value}</div><div className="kpi-foot">{change && <span className="positive"><ArrowUpRight size={13} />{change}</span>}<span>{detail}</span></div></Card>;
}
function ChartTip({ active, payload, label }: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return <div className="chart-tooltip"><strong>{label}</strong>{payload.map((p, i) => <div key={i}><span style={{ background: p.color }} />{p.name}: <b>{p.value}</b></div>)}</div>;
}
function distanceKm(a: Zone, b: Zone) {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const lat = radians(b.lat - a.lat);
  const lng = radians(b.lng - a.lng);
  const arc = Math.sin(lat / 2) ** 2 + Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(lng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(arc), Math.sqrt(1 - arc));
}
function HomePage({ model, weights, gate }: SharedProps) {
  const { zones, analysts } = model;
  const highPriority = zones.filter(z => z.priority >= 60).length;
  const monthly = months.map((month, i) => ({
    month, observado: Math.round(analysts.reduce((s, a) => s + a.disbursements[i], 0) / 12),
    clientes: Math.round(analysts.reduce((s, a) => s + a.newClients[i], 0) / 12),
  }));
  const areaData = zones.slice(0, 10).map(z => ({ name: z.province.slice(0, 7), brecha: z.gap, potencial: z.priority }));
  const topZones = [...zones].sort((a, b) => b.priority - a.priority).slice(0, 5);
  return <div className="page-stack">
    <div className="welcome-line"><div className="period-chip"><span className="cycle-dot" /> ABRIL — JUNIO 2025</div><span className="muted-small">Actualizado al iniciar esta sesión <span className="mono">·</span> universo simulado</span></div>
    <div className="kpi-grid">
      <KPI label="Zonas con brecha alta" value={fmt(highPriority)} detail="de 60 zonas modeladas" icon={Map} />
      <KPI label="Analistas simulados" value={fmt(analysts.length)} detail="12 meses de actividad" icon={Users} color="teal" />
      <KPI label="Potencial estimado" value={fmt(zones.reduce((a, z) => a + z.businesses, 0))} detail="negocios en zonas del radar" icon={Target} color="gold" />
      <KPI label="Pool referencial" value={money(gate.pool)} detail="monto configurable, no asignado" icon={Calculator} color="blue" />
    </div>
    <div className="content-grid overview-grid">
      <Card className="chart-panel"><CardTitle kicker="TRACCIÓN COMERCIAL" title="Ritmo del ciclo" note="Serie sintética agregada por analista, promedio mensual." right={<span className="select-like">12 meses <ChevronDown size={14} /></span>} />
        <div className="chart-legend"><span><i className="legend-dot red-dot" /> Desembolsos promedio <b>S/. {fmt(monthly.reduce((a, m) => a + m.observado, 0) / monthly.length)} mil</b></span><span><i className="legend-dot teal-dot" /> Nuevos clientes</span></div>
        <div className="chart-area"><ResponsiveContainer width="100%" height="100%"><AreaChart data={monthly} margin={{ top: 12, right: 8, left: -14, bottom: 0 }}><defs><linearGradient id="redFade" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={red} stopOpacity={.16} /><stop offset="100%" stopColor={red} stopOpacity={0} /></linearGradient></defs><CartesianGrid vertical={false} stroke="#e8e9eb" strokeDasharray="3 3" /><XAxis dataKey="month" tickLine={false} axisLine={false} tick={{ fill: '#9298a0', fontSize: 11 }} /><YAxis tickLine={false} axisLine={false} tick={{ fill: '#9298a0', fontSize: 10 }} /><ChartTooltip content={<ChartTip />} /><Area type="monotone" dataKey="observado" name="Desembolsos (S/. mil)" stroke={red} strokeWidth={2.5} fill="url(#redFade)" /><Line type="monotone" dataKey="clientes" name="Clientes nuevos" stroke="#368e7c" strokeWidth={2} dot={false} /></AreaChart></ResponsiveContainer></div>
      </Card>
      <Card className="priority-card"><CardTitle kicker="LECTURA TERRITORIAL" title="Señal de oportunidad" note="Potencial aproximado, no aptitud crediticia." right={<span className="metric-badge">60 zonas</span>} />
        <div className="priority-score"><div className="priority-number">{fmt(Math.round(zones.reduce((a, z) => a + z.priority, 0) / zones.length))}<span>/100</span></div><div className="priority-caption">Índice medio de prioridad estimada</div></div>
        <div className="bar-line"><div><span>Demanda potencial</span><b>{fmt(Math.round(zones.reduce((a, z) => a + z.demand, 0) / zones.length))}</b></div><div className="progress-track"><i style={{ width: '72%' }} /></div></div>
        <div className="bar-line"><div><span>Cobertura estimada</span><b>{fmt(Math.round(zones.reduce((a, z) => a + z.coverage, 0) / zones.length))}</b></div><div className="progress-track neutral"><i style={{ width: '46%' }} /></div></div>
        <div className="mini-callout"><span className="callout-mark"><ArrowDownRight size={17} /></span><span><b>{highPriority} zonas</b> combinan brecha elevada y acceso limitado.</span><Link href="/radar" className="text-link" data-testid="link-view-radar">Ver radar <ArrowRight size={14} /></Link></div>
      </Card>
    </div>
    <div className="content-grid lower-grid">
      <Card><CardTitle kicker="PRIORIDAD SINTÉTICA" title="Zonas para explorar" note="Ordenadas por brecha, acceso y perfil de actividad." right={<Link href="/radar" className="text-link" data-testid="link-explore-radar">Explorar radar <ArrowRight size={14} /></Link>} />
        <div className="table-wrap"><table><thead><tr><th>Zona</th><th>Provincia</th><th>Segmento</th><th>Índice <span>{tooltipContent('La prioridad combina demanda estimada, cobertura, distancia de acceso y segmento. No mide capacidad de pago ni elegibilidad.')}</span></th><th>Brecha</th></tr></thead><tbody>{topZones.map((z, i) => <tr key={z.id} data-testid={`row-zone-${z.id}`}><td><span className="rank-number">{String(i + 1).padStart(2, '0')}</span><b>{z.name}</b></td><td>{z.province}</td><td><span className="soft-tag">{z.segment}</span></td><td><div className="table-score"><span className="score-track"><i style={{ width: `${z.priority}%` }} /></span><b>{z.priority}</b></div></td><td className="mono">{z.gap}</td></tr>)}</tbody></table></div>
      </Card>
      <Card className="weights-summary"><CardTitle kicker="ESQUEMA VIGENTE" title="Balance de incentivos" note="Ponderaciones actuales del escenario." right={<Link href="/incentivos/constructor" className="icon-link" aria-label="Editar pesos" data-testid="link-edit-weights"><Settings2 size={16} /></Link>} />
        <div className="weight-bars">{weightNames.map((name, i) => <div className="weight-row" key={name}><div><span>{name}</span><b>{weights[i]}%</b></div><div className="progress-track"><i className={`weight-fill fill-${i}`} style={{ width: `${weights[i]}%` }} /></div></div>)}</div>
        <div className="balance-note"><ShieldCheck size={15} /><span>5 dimensiones, con calidad e inclusión explícitas.</span></div>
      </Card>
    </div>
  </div>;
}
function AssumptionsPage({ assumptions, setAssumptions, seed, setSeed, model }: SharedProps) {
  const fields: [keyof Assumptions, string, string, number, number, number][] = [
    ['noise', 'Ruido del generador', 'Variación relativa entre observaciones', 0, 50, 1],
    ['ruralPar', 'PAR30 base rural', 'Referencia simulada en puntos porcentuales', 3, 16, .1],
    ['tenureQuality', 'Efecto de antigüedad', 'Reducción relativa de PAR30 con experiencia', 0, 10, .1],
    ['matureNewClient', 'Madurez y captación', 'Menos nuevos clientes en carteras maduras', 0, 28, .5],
    ['volumeParDelta', 'Aumento PAR30 por volumen', 'Supuesto de conducta en el escenario solo volumen', 0, 5, .1],
    ['volumeConcentrationDelta', 'Concentración al cierre', 'Puntos porcentuales adicionales en el escenario solo volumen', 0, 30, .5],
  ];
  return <div className="page-stack">
    <div className="notice-card"><div className="notice-symbol"><Settings2 size={19} /></div><div><b>El modelo se recalcula en tu navegador.</b><p>Los valores se guardan en este dispositivo. Restablecer vuelve a los supuestos de referencia del prototipo.</p></div></div>
    <div className="content-grid assumptions-grid"><Card><CardTitle kicker="PARÁMETROS" title="Contexto sintético" note="Edita y observa el nuevo escenario en todo el prototipo." />
      <div className="assumption-list">{fields.map(([key, title, desc, min, max, step]) => <label className="assumption-field" key={key}><div className="assumption-copy"><b>{title} {tooltipContent(desc)}</b><span>{desc}</span></div><div className="assumption-control"><input type="range" min={min} max={max} step={step} value={assumptions[key]} onChange={e => setAssumptions({ ...assumptions, [key]: Number(e.target.value) })} data-testid={`range-${key}`} /><div className="value-input"><input type="number" min={min} max={max} step={step} value={assumptions[key]} onChange={e => setAssumptions({ ...assumptions, [key]: Number(e.target.value) })} data-testid={`input-${key}`} /><span>{key === 'noise' || key === 'matureNewClient' ? '%' : 'pp'}</span></div></div></label>)}</div>
      <div className="form-actions"><button className="btn btn-outline" onClick={() => setAssumptions(defaultAssumptions)} data-testid="button-reset-assumptions">Restablecer supuestos</button><button className="btn btn-primary" onClick={() => setSeed((s: number) => s + 7919)} data-testid="button-generate-data"><RefreshCw size={15} /> Regenerar datos</button></div>
    </Card><div className="page-stack"><Card className="seed-card"><div className="seed-eyebrow">SEMILLA ACTUAL</div><div className="seed-number">{seed}</div><div className="seed-info">Datos recreables con el mismo número. Regenerar cambia esta semilla.</div><div className="seed-foot"><span><span className="cycle-dot" /> Activo</span><span>Guardado localmente</span></div></Card><Card><CardTitle kicker="UNIVERSO" title="Tamaño del escenario" /><div className="count-grid"><div><b>{model.zones.length}</b><span>zonas ficticias</span></div><div><b>{model.analysts.length}</b><span>analistas simulados</span></div><div><b>12</b><span>meses de datos</span></div></div></Card></div></div>
  </div>;
}
function RadarPage({ model, selectedZone, selectedZoneId, setSelectedZoneId }: SharedProps) {
  const [province, setProvince] = useState('Todas');
  const [segment, setSegment] = useState('Todos');
  const [activity, setActivity] = useState('Todas');
  const [metric, setMetric] = useState<'priority' | 'demand' | 'gap'>('priority');
  const [query, setQuery] = useState('');
  const shown = model.zones.filter(z => (province === 'Todas' || z.province === province) && (segment === 'Todos' || z.segment === segment) && (activity === 'Todas' || z.activity === activity) && z.name.toLowerCase().includes(query.toLowerCase()));
  const provinces = [...new Set(model.zones.map(z => z.province))];
  const activities = [...new Set(model.zones.map(z => z.activity))];
  return <div className="page-stack">
    <div className="radar-toolbar"><label className="search-field"><Search size={15} /><input placeholder="Buscar distrito o zona" value={query} onChange={e => setQuery(e.target.value)} data-testid="input-radar-search" /></label><select value={province} onChange={e => setProvince(e.target.value)} data-testid="select-province"><option>Todas</option>{provinces.map(p => <option key={p}>{p}</option>)}</select><select value={segment} onChange={e => setSegment(e.target.value)} data-testid="select-segment"><option>Todos</option>{[...new Set(model.zones.map(z => z.segment))].map(s => <option key={s}>{s}</option>)}</select><select value={activity} onChange={e => setActivity(e.target.value)} data-testid="select-activity"><option>Todas</option>{activities.map(a => <option key={a}>{a}</option>)}</select><div className="metric-switch" aria-label="Métrica de mapa">{(['priority', 'demand', 'gap'] as const).map((m, i) => <button className={metric === m ? 'selected' : ''} key={m} onClick={() => setMetric(m)} data-testid={`button-map-${m}`}>{['Prioridad', 'Demanda', 'Brecha'][i]}</button>)}</div></div>
    <div className="radar-formulas"><span>Demanda: PEA + negocios + actividad + señal digital {tooltipContent('Índice normalizado que combina población económicamente activa, negocios, actividad dominante y señal digital pública simulada.')}</span><span>Cobertura: puntos + cercanía {tooltipContent('Índice normalizado por puntos de atención ficticios y distancia aproximada al punto más cercano.')}</span><span>Brecha: demanda − cobertura {tooltipContent('Diferencia normalizada entre demanda potencial y cobertura financiera estimada; un valor alto indica menor cobertura relativa.')}</span><span>Prioridad: brecha + acceso {tooltipContent('Brecha ponderada por distancia, señal digital y segmento; representa potencial estimado, nunca capacidad de pago.')}</span></div>
    <div className="radar-layout"><Card className="map-panel"><div className="map-heading"><div><b>La Libertad</b><span>{shown.length} de 60 zonas · {metric === 'priority' ? 'índice de prioridad potencial' : metric === 'demand' ? 'señal de demanda estimada' : 'brecha estimada'}</span></div><div className="map-legend"><i /> Menor <span /> Mayor</div></div>
      {shown.length ? <MapContainer center={[-7.95, -78.8]} zoom={7} scrollWheelZoom={false} className="leaflet-map"><TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />{shown.map(z => { const val = z[metric]; return <CircleMarker key={z.id} center={[z.lat, z.lng]} radius={6 + val / 30} pathOptions={{ color: val > 68 ? '#b00019' : val > 42 ? '#dc695f' : '#e9a59f', fillColor: val > 68 ? red : val > 42 ? '#e47568' : '#efb4ad', fillOpacity: .78, weight: z.id === selectedZoneId ? 3 : 1 }} eventHandlers={{ click: () => setSelectedZoneId(z.id) }}><Popup><b>{z.name}</b><br />Índice potencial: {z.priority} / 100<br />Segmento: {z.segment}</Popup></CircleMarker>; })}</MapContainer> : <div className="map-empty"><Search size={25} /><b>Sin zonas para estos filtros</b><span>Prueba con otro distrito o segmento.</span></div>}
      <div className="map-foot"><span><span className="map-dot" /> Zonas modeladas de referencia</span><span>Teselas OpenStreetMap</span></div>
    </Card><Card className="zone-details"><div className="panel-head"><div><p className="eyebrow">FICHA DE ZONA</p><h2>{selectedZone.name}</h2><p className="panel-note">{selectedZone.province} · {selectedZone.segment}</p></div><span className="zone-rank">{selectedZone.priority}<small>/100</small></span></div>
      <div className="selected-zone-activity"><span className="activity-mark"><Activity size={18} /></span><div><b>{selectedZone.activity}</b><small>Actividad dominante estimada</small></div></div>
      <div className="zone-stat-grid"><div><span>PEA estimada</span><b>{fmt(selectedZone.pea)}</b></div><div><span>Negocios</span><b>{fmt(selectedZone.businesses)}</b></div><div><span>Señal digital</span><b>{selectedZone.digital}<small>/100</small></b></div><div><span>Puntos de atención</span><b>{selectedZone.points}</b></div><div><span>Distancia más cercana</span><b>{selectedZone.distance}<small> km</small></b></div><div><span>Brecha estimada</span><b>{selectedZone.gap}<small>/100</small></b></div></div>
      <div className="zone-explanation"><b>¿Por qué aparece?</b><p>El índice combina una señal de demanda agregada con cobertura estimada, distancia y segmento territorial. No predice comportamiento individual.</p></div>
      <Link href="/radar/segmentos" className="btn btn-outline btn-block" data-testid="link-view-segments">Ver perfiles agrupados <ArrowRight size={15} /></Link>
    </Card></div>
  </div>;
}
function SegmentsPage({ model }: SharedProps) {
  const productBySegment: Record<string, string> = {
    'Frontera de inclusión': 'Visita exploratoria y orientación financiera básica.',
    'Agro rural': 'Capital de campaña estacional y canal de atención móvil.',
    'Servicios emergentes': 'Financiamiento para capital de trabajo y pagos digitales.',
    'Nodos de mercado': 'Crédito para inventario y acompañamiento comercial.',
    'Comercio urbano': 'Capital de trabajo y pagos para pequeños negocios.',
  };
  const cards = [...new Set(model.zones.map(z => z.segment))].map((name, i) => {
    const zones = model.zones.filter(z => z.segment === name);
    return { name, count: zones.length, avgDemand: Math.round(zones.reduce((s, z) => s + z.demand, 0) / zones.length), avgCoverage: Math.round(zones.reduce((s, z) => s + z.coverage, 0) / zones.length), avgPriority: Math.round(zones.reduce((s, z) => s + z.priority, 0) / zones.length), businesses: zones.reduce((s, z) => s + z.businesses, 0), color: ['#d6001c', '#328773', '#d59a3a', '#6481a5', '#886c9d'][i] };
  }).sort((a, b) => b.avgPriority - a.avgPriority);
  const ranked = [...model.zones].sort((a, b) => b.priority - a.priority).slice(0, 8);
  return <div className="page-stack"><div className="segment-intro"><div className="segment-symbol"><Layers3 size={24} /></div><div><b>5 perfiles territoriales</b><p>Agrupación descriptiva tipo k-means simplificado sobre actividad, acceso, señal digital y escala.</p></div><span className="soft-tag">No representa personas</span></div>
    <div className="segment-grid">{cards.map((s, i) => <Card className="segment-card" key={s.name}><div className="segment-card-head"><span className="segment-number" style={{ color: s.color }}>0{i + 1}</span><span className="segment-count">{s.count} zonas</span></div><h3>{s.name}</h3><div className="segment-scale"><span>Prioridad media</span><b>{s.avgPriority}<small>/100</small></b></div><div className="segment-meter"><i style={{ width: `${s.avgPriority}%`, background: s.color }} /></div><div className="segment-traits"><div><span>Demanda</span><b>{s.avgDemand}</b></div><div><span>Cobertura</span><b>{s.avgCoverage}</b></div><div><span>Negocios</span><b>{fmt(s.businesses)}</b></div></div><div className="segment-summary">{s.avgCoverage < 35 ? 'Cobertura limitada; evaluar acceso territorial.' : 'Mayor conectividad y cobertura de referencia.'}</div><div className="product-suggestion"><b>Producto/canal a validar</b><p>{productBySegment[s.name] ?? 'Canal y producto por explorar con el comité.'} No representa aprobación ni elegibilidad crediticia.</p></div></Card>)}</div>
    <Card><CardTitle kicker="ORDEN DE EXPLORACIÓN" title="Ranking de zonas" note="Motivos visibles para cada prioridad, no recomendaciones de crédito." right={<span className="metric-badge">Top 8</span>} /><div className="table-wrap"><table><thead><tr><th>Posición</th><th>Zona / provincia</th><th>Perfil</th><th>Índice</th><th>Motivo dominante</th></tr></thead><tbody>{ranked.map((z, i) => <tr key={z.id}><td><span className="rank-number">{String(i + 1).padStart(2, '0')}</span></td><td><b>{z.name}</b><small className="table-sub">{z.province}</small></td><td><span className="soft-tag">{z.segment}</span></td><td><b className="priority-value">{z.priority}</b></td><td>{z.distance > 15 ? 'Brecha de acceso y baja cobertura' : z.demand > z.coverage ? 'Demanda potencial supera cobertura' : 'Señal de actividad y escala local'}</td></tr>)}</tbody></table></div></Card>
  </div>;
}
function RoutesPage({ model }: SharedProps) {
  const [analystId, setAnalystId] = useState(model.analysts[0].id);
  const [maxDistance, setMaxDistance] = useState(120);
  const analyst = model.analysts.find(a => a.id === analystId) ?? model.analysts[0];
  const candidates = [...model.zones].filter(z => z.province === analyst.province).sort((a, b) => b.priority - a.priority).slice(0, 12);
  let current: Zone = model.zones.find(z => z.name === analyst.base) ?? candidates[0] ?? model.zones[0];
  const routeOrigin = current;
  const routeZones: Zone[] = [];
  let routeDistance = 0;
  while (candidates.length && routeZones.length < 6) {
    let nearestIndex = 0;
    let nearestDistance = Number.POSITIVE_INFINITY;
    candidates.forEach((z, i) => {
      const distance = Math.hypot(z.lat - current.lat, z.lng - current.lng);
      if (distance < nearestDistance) { nearestDistance = distance; nearestIndex = i; }
    });
    const nextZone = candidates[nearestIndex];
    const legDistance = distanceKm(current, nextZone);
    if (routeDistance + legDistance > maxDistance) break;
    routeDistance += legDistance;
    current = candidates.splice(nearestIndex, 1)[0];
    routeZones.push(current);
  }
  const provinces = [...new Set(model.zones.map(z => z.province))].map(province => ({ province, count: model.zones.filter(z => z.province === province).length, rural: model.zones.filter(z => z.province === province && z.rural).length, score: Math.round(model.zones.filter(z => z.province === province).reduce((s, z) => s + z.priority, 0) / model.zones.filter(z => z.province === province).length) }));
  return <div className="page-stack"><div className="route-toolbar"><div><p className="eyebrow">PLAN DE RECORRIDO</p><h2>Vecino más cercano · propuesta diaria</h2></div><label>Analista <select value={analystId} onChange={e => setAnalystId(e.target.value)} data-testid="select-analyst">{model.analysts.map(a => <option value={a.id} key={a.id}>{a.name} · {a.province}</option>)}</select></label><label>Límite de distancia <select value={maxDistance} onChange={e => setMaxDistance(Number(e.target.value))} data-testid="select-route-distance">{[60, 120, 180, 240].map(distance => <option key={distance} value={distance}>{distance} km</option>)}</select></label></div>
    <div className="content-grid route-layout"><Card><CardTitle kicker="SECUENCIA SUGERIDA" title={`${analyst.name} · ${analyst.province}`} note={`Recorrido por proximidad entre puntos sintéticos; distancia estimada ${routeDistance.toFixed(1)} km.`} right={<span className="metric-badge"><RouteIcon size={13} /> {routeZones.length} paradas</span>} />
      {routeZones.length > 0 && <div className="route-map"><MapContainer center={[routeZones[0].lat, routeZones[0].lng]} zoom={8} scrollWheelZoom={false} className="leaflet-map"><TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" /><Polyline positions={[routeOrigin, ...routeZones].map(z => [z.lat, z.lng] as [number, number])} pathOptions={{ color: red, weight: 3, opacity: .8 }} />{routeZones.map((z, i) => <CircleMarker key={z.id} center={[z.lat, z.lng]} radius={8} pathOptions={{ color: '#ffffff', fillColor: red, fillOpacity: 1, weight: 2 }}><Popup>{i + 1}. {z.name} · Prioridad {z.priority}</Popup></CircleMarker>)}</MapContainer></div>}
      <div className="route-timeline">{routeZones.map((z, i) => <div className="route-stop" key={z.id}><div className="route-stop-number">{i + 1}</div><div className="route-stop-body"><div><b>{z.name}</b><span>{z.segment}</span></div><div className="route-stop-meta"><span>{z.distance} km a punto de atención</span><span className="priority-pill">{z.priority} prioridad</span></div></div></div>)}</div><div className="route-note"><CircleHelp size={15} /> Secuencia aproximada basada en cercanía geográfica; no es navegación ni agenda real. Máximo de seis visitas sugeridas.</div></Card>
    <Card><CardTitle kicker="EQUIDAD PROVINCIAL" title="Distribución de prioridades" note="Las 12 provincias del modelo, con cobertura y prioridad media estimada." /><div className="equity-list">{provinces.map((p, i) => <div className="equity-row" key={p.province}><div className="equity-label"><b>{p.province}</b><span>{p.rural} rurales de {p.count}</span></div><div className="equity-track"><i style={{ width: `${Math.max(12, p.score)}%` }} /></div><b className="equity-score">{p.score}</b></div>)}</div><div className="equity-bottom"><span><i className="legend-dot teal-dot" /> Prioridad media 0–100</span><span>Señala provincias a revisar por posible exclusión</span></div></Card></div>
  </div>;
}
function WeightEditor({ weights, setWeights }: { weights: number[]; setWeights: (v: number[]) => void }) {
  const change = (idx: number, raw: number) => {
    const next = [...weights]; const diff = raw - next[idx]; next[idx] = raw;
    const others = next.map((_, i) => i).filter(i => i !== idx);
    const budget = 100 - raw;
    let assigned = 0;
    const totalOthers = others.reduce((s, i) => s + weights[i], 0);
    others.forEach((i, n) => { const v = n === others.length - 1 ? budget - assigned : Math.round((totalOthers ? weights[i] / totalOthers : 1 / others.length) * budget); next[i] = Math.max(0, v); assigned += next[i]; });
    const sum = next.reduce((s, n) => s + n, 0); next[others[others.length - 1]] += 100 - sum;
    setWeights(next);
  };
  return <div className="weight-editor">{weightNames.map((name, i) => <div className="builder-weight" key={name}><div className="builder-weight-top"><div><b>{name}</b><span>{weightDescriptions[i]}</span></div><label><input type="number" min="0" max="100" value={weights[i]} onChange={e => change(i, Math.max(0, Math.min(100, Number(e.target.value))))} data-testid={`input-weight-${i}`} /><small>%</small></label></div><input className="weight-range" type="range" min="0" max="80" value={weights[i]} onChange={e => change(i, Number(e.target.value))} aria-label={`${name} porcentaje`} data-testid={`range-weight-${i}`} /></div>)}</div>;
}
function ConstructorPage({ weights, setWeights, gate, setGate, model }: SharedProps) {
  const poolShares = weights;
  const avgPar = model.analysts.reduce((s, a) => s + a.par30[11], 0) / model.analysts.length;
  const eligible = model.analysts.filter(a => a.par30[11] < gate.hard).length;
  const summary = summarizeIncentives(model.analysts, model.zones, weights, gate);
  return <div className="page-stack"><div className="builder-summary"><div><span className="builder-summary-label">ESQUEMA DE REFERENCIA</span><b>Balance integral · ciclo simulado</b><small>Vista de simulación; no aplica remuneración real.</small></div><div className="sum-meter"><div><span>Suma de ponderaciones</span><b data-testid="text-weight-sum">{weights.reduce((a, b) => a + b, 0)}<small>%</small></b></div><div className="sum-track"><i style={{ width: `${weights.reduce((a, b) => a + b, 0)}%` }} /></div></div><button className="btn btn-ghost" onClick={() => setWeights(initialWeights)} data-testid="button-reset-weights">Restaurar valores <RefreshCw size={14} /></button></div>
    <div className="kpi-grid compact"><KPI label="Costo simulado" value={money(summary.cost)} detail={`tope ${money(gate.pool)}`} icon={Calculator} /><KPI label="PAR30 promedio" value={`${summary.averagePar30.toFixed(1)}%`} detail="métrica agregada" icon={ShieldCheck} color="teal" /><KPI label="Bono máximo" value={money(summary.maxBonus)} detail={`límite ${money(700 * gate.cap)}`} icon={Target} color="gold" /><KPI label="Tope del pool" value={summary.poolCompliant ? 'Cumple' : 'Supera'} detail={summary.poolCompliant ? 'dentro del presupuesto' : 'revisar pesos y límites'} icon={summary.poolCompliant ? Check : ArrowDownRight} color={summary.poolCompliant ? 'blue' : 'red'} /></div>
    <div className="content-grid builder-layout"><Card className="builder-main"><CardTitle kicker="PONDERACIÓN DINÁMICA" title="Cinco señales, un puntaje" note="Los pesos se redistribuyen proporcionalmente para mantener 100%." right={<span className="metric-badge">Σ {weights.reduce((a, b) => a + b, 0)}%</span>} /><WeightEditor weights={weights} setWeights={setWeights} /><div className="formula-box"><div className="formula-icon"><Calculator size={17} /></div><div><b>Fórmula base</b><p>Score = Σ (peso × métrica normalizada) × compuerta de calidad. Se calcula sobre datos agregados simulados.</p></div>{tooltipContent('Cada dimensión se normaliza a 0–100. La compuerta limita el resultado bajo el PAR30 definido.')}</div></Card>
      <div className="page-stack"><Card className="gates-card"><CardTitle kicker="REGLAS DE PROTECCIÓN" title="Compuertas y límites" note="Diales informativos para probar sensibilidades." />
        <div className="gate-field"><div><b>PAR30 blanda</b><span>Reducción gradual desde este valor</span></div><label><input type="number" min="0" max="30" step=".5" value={gate.soft} onChange={e => setGate({ ...gate, soft: Number(e.target.value) })} data-testid="input-par-soft" /><small>%</small></label></div>
        <div className="gate-field"><div><b>PAR30 dura</b><span>Score excluido por encima del límite</span></div><label><input type="number" min="0" max="40" step=".5" value={gate.hard} onChange={e => setGate({ ...gate, hard: Number(e.target.value) })} data-testid="input-par-hard" /><small>%</small></label></div>
        <div className="gate-field"><div><b>Tope por analista</b><span>Máximo relativo al incentivo base</span></div><label><input type="number" min=".5" max="3" step=".05" value={gate.cap} onChange={e => setGate({ ...gate, cap: Number(e.target.value) })} data-testid="input-cap" /><small>x</small></label></div>
        <div className="gate-field"><div><b>Pool simulado</b><span>Bolsa total de referencia</span></div><label className="pool-input"><small>S/.</small><input type="number" min="0" step="1000" value={gate.pool} onChange={e => setGate({ ...gate, pool: Number(e.target.value) })} data-testid="input-pool" /></label></div>
      </Card><div className="gate-status"><div className="status-icon"><ShieldCheck size={18} /></div><div><b>{eligible} analistas bajo el PAR30 duro</b><span>PAR30 promedio: {avgPar.toFixed(1)}% · compuerta: 50% desde la blanda y 0% sobre la dura</span></div></div></div></div>
    {!summary.poolCompliant && <div className="chat-error" data-testid="status-pool-limit">El costo estimado supera el tope del pool. Ajusta los pesos o el límite; el sistema no aplica pagos.</div>}
    <div className="content-grid"><Card><CardTitle kicker="DISTRIBUCIÓN ILUSTRATIVA" title="Participación del pool" note="Asignación proporcional por score de ejemplo, con tope configurado." /><div className="pool-chart"><ResponsiveContainer width="100%" height="100%"><BarChart data={weightNames.map((n, i) => ({ name: n, valor: Math.round(gate.pool * poolShares[i] / 100) }))} layout="vertical" margin={{ left: 20, right: 20, top: 0, bottom: 0 }}><CartesianGrid horizontal={false} stroke="#e7e8eb" /><XAxis type="number" tickLine={false} axisLine={false} tick={{ fill: '#9298a0', fontSize: 10 }} /><YAxis type="category" dataKey="name" width={165} tickLine={false} axisLine={false} tick={{ fill: '#6d737b', fontSize: 11 }} /><ChartTooltip content={<ChartTip />} /><Bar dataKey="valor" name="Pool de referencia S/." fill={red} radius={[0, 5, 5, 0]} barSize={15} /></BarChart></ResponsiveContainer></div></Card><Card className="gate-why"><div className="large-shield"><ShieldCheck size={23} /></div><h3>Primero la calidad</h3><p>Las compuertas protegen contra señales desequilibradas y ayudan a observar efectos no deseados. Los valores son ajustables y no tienen efecto fuera de esta simulación.</p><div className="why-line"><Check size={15} /> Sin cambios de pago en sistemas</div><div className="why-line"><Check size={15} /> Cálculo local y reproducible</div></Card></div>
  </div>;
}
function PerformancePage({ model }: SharedProps) {
  const { analysts } = model;
  const zoneByName = new Map(model.zones.map(zone => [zone.name, zone]));
  const observedRows = analysts.map(a => {
    const territory = zoneByName.get(a.base);
    const productivity = Math.min(100, a.disbursements[11] / 180 * 100);
    const quality = Math.max(0, 100 - a.par30[11] * 4);
    const collaboration = Math.min(100, (a.referrals[11] + a.mentoring[11] * 1.5) * 5);
    const inclusion = Math.min(100, a.blindClients[11] / 12 * 100);
    const observed = productivity * .35 + Math.min(100, a.newClients[11] / 40 * 100) * .2 + quality * .25 + collaboration * .1 + inclusion * .1;
    const expected = Math.max(25, 42 + a.maturity * .1 + a.tenure * .08 + a.training * .04 + (territory?.priority ?? 50) * .1 - (territory?.rural ? 5 : 0));
    return { ...a, observed, expected, valueAdded: observed / expected * 100 };
  });
  const rawRanks = [...observedRows].sort((a, b) => b.observed - a.observed);
  const rawRankById = new Map(rawRanks.map((a, index) => [a.id, index + 1]));
  const rows = [...observedRows].sort((a, b) => b.valueAdded - a.valueAdded)
    .map((a, index) => ({ ...a, rawRank: rawRankById.get(a.id) ?? index + 1, adjustedRank: index + 1 }));
  const data = rows.slice(0, 10).map((a, i) => ({ name: `A${i + 1}`, observado: Math.round(a.observed), esperado: Math.round(a.expected) }));
  const averageObserved = observedRows.reduce((sum, row) => sum + row.observed, 0) / observedRows.length;
  const averageValueAdded = observedRows.reduce((sum, row) => sum + row.valueAdded, 0) / observedRows.length;
  const averagePar = analysts.reduce((s, a) => s + a.par30[11], 0) / analysts.length;
  return <div className="page-stack"><div className="kpi-grid compact"><KPI label="Score medio observado" value={averageObserved.toFixed(1)} detail="métricas comerciales y de calidad" icon={Activity} /><KPI label="Valor agregado medio" value={`${averageValueAdded.toFixed(1)}%`} detail="real ÷ esperado contextual" icon={ArrowDownRight} color="gold" /><KPI label="PAR30 medio" value={`${averagePar.toFixed(1)}%`} detail="métrica agregada, sin evaluación" icon={ShieldCheck} color="teal" /><KPI label="Muestra" value={fmt(analysts.length)} detail="analistas sintéticos" icon={Users} color="blue" /></div>
    <div className="content-grid"><Card><CardTitle kicker="CONTEXTO" title="Desempeño observado vs esperado" note="Referencia lineal descriptiva; no es predicción individual." right={tooltipContent('Esperado se calcula con madurez, antigüedad y contexto territorial normalizados.')}/><div className="chart-area medium"><ResponsiveContainer width="100%" height="100%"><BarChart data={data} margin={{ top: 12, right: 10, left: -16, bottom: 0 }}><CartesianGrid vertical={false} stroke="#e8e9eb" strokeDasharray="3 3" /><XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: '#858b93' }} /><YAxis tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: '#858b93' }} /><ChartTooltip content={<ChartTip />} /><Bar dataKey="observado" name="Observado" fill={red} radius={[4, 4, 0, 0]} /><Bar dataKey="esperado" name="Esperado contextual" fill="#93b6aa" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></div><div className="chart-footnote"><span className="legend-dot red-dot" /> Resultado sintético <span className="legend-dot teal-dot" /> Contexto calculado</div></Card>
    <Card><CardTitle kicker="MODELO EXPLICABLE" title="Variables de contexto" note="Relación ilustrativa, no causal." /><div className="context-bars">{[['Antigüedad', 74, 'Calidad +'], ['Madurez cartera', 61, 'Captación −'], ['Capacitación', 56, 'Conducta +'], ['Ruralidad', 42, 'PAR30 base +']].map(([label, val, sign]) => <div className="context-row" key={String(label)}><div><b>{label}</b><span>{sign}</span></div><div className="progress-track"><i style={{ width: `${val}%` }} /></div></div>)}</div><div className="formula-box compact-formula"><div className="formula-icon"><Activity size={16} /></div><p>Regresión de contexto sintética, coeficientes editables en supuestos. Interpretar con cautela.</p></div></Card></div>
    <Card><CardTitle kicker="REFERENCIA AJUSTADA" title="Ranking bruto vs. contextual" note="Valor agregado = observado ÷ esperado. La variación de puestos es una señal para revisar, no un orden de compensación." right={<span className="metric-badge">muestra 120</span>} /><div className="table-wrap"><table><thead><tr><th>Rango ajustado</th><th>Analista</th><th>Provincia</th><th>Observado</th><th>Esperado</th><th>PAR30</th><th>Valor agregado</th><th>Movimiento</th></tr></thead><tbody>{rows.slice(0, 12).map(a => { const movement = a.rawRank - a.adjustedRank; return <tr key={a.id}><td><span className="rank-number">{String(a.adjustedRank).padStart(2, '0')}</span></td><td><b>{a.name}</b></td><td>{a.province}</td><td>{Math.round(a.observed)}</td><td>{Math.round(a.expected)}</td><td>{a.par30[11].toFixed(1)}%</td><td><b className="priority-value">{a.valueAdded.toFixed(0)}%</b></td><td className={movement > 0 ? 'good-status' : movement < 0 ? 'bad-status' : ''}>{movement > 0 ? `Sube ${movement}` : movement < 0 ? `Baja ${Math.abs(movement)}` : 'Sin cambio'}</td></tr>; })}</tbody></table></div></Card>
  </div>;
}
function ConductPage({ model, assumptions }: SharedProps) {
  const [balanced, setBalanced] = useState(true);
  const acts = model.analysts.slice(0, 48).map(a => ({ volumen: Math.round(a.disbursements[11]), equilibrado: Math.round(a.disbursements[11] * .44 + a.newClients[11] * 1.5 + a.referrals[11] * 1.3 + a.mentoring[11] * 1.8 + a.training * .1 - a.par30[11] * 2.1), par: Number(a.par30[11].toFixed(1)) }));
  const avg = acts.reduce((s, a) => s + (balanced ? a.equilibrado : a.volumen), 0) / acts.length;
  const scoreData = acts.slice(0, 14).map((a, i) => ({ name: `A${i + 1}`, score: balanced ? a.equilibrado : a.volumen }));
  const avgPar30 = model.analysts.reduce((sum, a) => sum + a.par30[11], 0) / model.analysts.length;
  const avgConcentration = model.analysts.reduce((sum, a) => sum + a.concentration[11], 0) / model.analysts.length;
  const riskData = [
    { name: 'PAR30 promedio', volumen: avgPar30 + assumptions.volumeParDelta, equilibrado: avgPar30 },
    { name: 'Cierres fin de mes', volumen: avgConcentration + assumptions.volumeConcentrationDelta, equilibrado: avgConcentration },
  ];
  return <div className="page-stack"><div className="conduct-toggle"><div><p className="eyebrow">SIMULACIÓN DE CONDUCTA</p><h2>¿Qué se reconoce?</h2><p>Compara el énfasis del esquema, no remuneraciones reales.</p></div><div className="segmented-control"><button className={!balanced ? 'selected' : ''} onClick={() => setBalanced(false)} data-testid="button-volume-only">Solo volumen</button><button className={balanced ? 'selected' : ''} onClick={() => setBalanced(true)} data-testid="button-balanced">Equilibrado</button></div></div>
    <div className="content-grid"><Card><CardTitle kicker={balanced ? 'BALANCE AMPLIADO' : 'REFERENCIA DE VOLUMEN'} title={balanced ? 'Conductas reconocidas' : 'Volumen domina la señal'} note={balanced ? 'Calidad, colaboración, desarrollo e inclusión comparten espacio con resultados.' : 'Desembolsos concentran el peso; otras dimensiones pierden peso.'} /><div className="behavior-list">{(balanced ? [['Productividad', 'Volumen sostenible', 66, red], ['Calidad de cartera', 'PAR30 controlado', 76, '#378c7a'], ['Colaboración', 'Referidos y mentoría', 45, '#886c9d'], ['Desarrollo profesional', 'Capacitación aplicada', 53, '#d59a3a'], ['Inclusión territorial', 'Atención en zonas ciegas', 58, '#6481a5']] : [['Productividad', 'Desembolsos', 92, red], ['Calidad de cartera', 'PAR30 sin compuerta', 18, '#bbc1c7'], ['Colaboración', 'Sin peso directo', 10, '#bbc1c7'], ['Desarrollo profesional', 'Sin peso directo', 8, '#bbc1c7'], ['Inclusión territorial', 'Sin peso directo', 5, '#bbc1c7']]).map(([a, b, val, color]) => <div className="behavior-row" key={String(a)}><div><span className="behavior-marker" style={{ background: String(color) }} /><div><b>{a}</b><small>{b}</small></div></div><div className="behavior-track"><i style={{ width: `${val}%`, background: String(color) }} /></div><b>{val}%</b></div>)}</div></Card>
    <Card><CardTitle kicker="DISTRIBUCIÓN SIMULADA" title={balanced ? 'Índice más compuesto' : 'Resultado concentrado'} note="Muestra ilustrativa de 48 analistas." /><div className="mini-stat"><b>{avg.toFixed(1)}</b><span>score medio de ejemplo</span></div><div className="chart-area small"><ResponsiveContainer width="100%" height="100%"><BarChart data={scoreData} margin={{ left: -22, right: 0, top: 10, bottom: 0 }}><CartesianGrid vertical={false} stroke="#ececee" strokeDasharray="3 3" /><XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fontSize: 9, fill: '#878d95' }} /><YAxis tickLine={false} axisLine={false} tick={{ fontSize: 9, fill: '#878d95' }} /><Bar dataKey="score" name="Índice" fill={balanced ? '#378c7a' : red} radius={[3, 3, 0, 0]} /></BarChart></ResponsiveContainer></div><div className="behavior-callout"><ShieldCheck size={15} /><span>{balanced ? 'Mejor balance entre resultados, calidad y colaboración.' : 'Un único indicador puede incentivar concentración de volumen.'}</span></div></Card></div>
    <Card><CardTitle kicker="EFECTOS CONDUCTUALES EDITABLES" title="Calidad y concentración a fin de mes" note="La reacción de conducta es un supuesto de simulación, no una predicción." /><div className="risk-chart"><ResponsiveContainer width="100%" height="100%"><BarChart data={riskData} margin={{ left: 0, right: 10, top: 8, bottom: 0 }}><CartesianGrid vertical={false} stroke="#e9eaec" strokeDasharray="3 3" /><XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: '#777e86' }} /><YAxis unit="%" tickLine={false} axisLine={false} tick={{ fontSize: 9, fill: '#9299a0' }} /><ChartTooltip content={<ChartTip />} /><Legend wrapperStyle={{ fontSize: 10 }} /><Bar dataKey="volumen" name="Solo volumen" fill={red} radius={[4, 4, 0, 0]} /><Bar dataKey="equilibrado" name="Equilibrado" fill="#46917f" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></div>{!balanced && <div className="risk-alert" data-testid="alert-volume-risk"><ShieldCheck size={15} /><span>El supuesto de volumen aumenta PAR30 y concentración de cierres al final del mes. Revisa la compuerta de calidad antes de comparar costos.</span></div>}</Card>
    <Card className="insight-strip"><div className="insight-mark"><Sparkles size={18} /></div><div><b>Lectura de conducta</b><p>{balanced ? 'Un diseño equilibrado hace visibles señales de calidad, inclusión y desarrollo sin borrar el resultado comercial.' : 'Un esquema de volumen puede favorecer concentración de cierres y dejar fuera señales de calidad o acompañamiento.'}</p></div><span className="synthetic-chip">SIMULACIÓN, NO PRONÓSTICO</span></Card>
  </div>;
}
function ComparePage({ weights, setWeights, gate, model }: SharedProps) {
  const scenarios = [
    { name: 'Volumen foco', tag: 'MÁS SIMPLE', weights: [60, 15, 10, 10, 5], color: red, detail: 'Prioriza la productividad comercial.' },
    { name: 'Balance integral', tag: 'ACTUAL', weights, color: '#358875', detail: 'Distribuye señal entre cinco dimensiones.' },
    { name: 'Inclusión reforzada', tag: 'EXPLORAR', weights: [30, 22, 10, 10, 28], color: '#6681a4', detail: 'Visibiliza la captación en zonas de menor cobertura.' },
  ];
  const [applied, setApplied] = useState('Balance integral');
  const [optimized, setOptimized] = useState(false);
  const comparison = scenarios.map(s => ({ ...s, metrics: summarizeIncentives(model.analysts, model.zones, s.weights, gate) }));
  const optimize = () => {
    let best = [40, 25, 10, 10, 15];
    let bestScore = Number.NEGATIVE_INFINITY;
    for (let inclusion = 0; inclusion <= 30; inclusion += 5) {
      for (let development = 5; development <= 20; development += 5) {
        for (let collaboration = 5; collaboration <= 20; collaboration += 5) {
          for (let quality = 15; quality <= 35; quality += 5) {
            const productivity = 100 - inclusion - development - collaboration - quality;
            if (productivity < 20 || productivity > 55) continue;
            const candidate = [productivity, quality, collaboration, development, inclusion];
            const metrics = summarizeIncentives(model.analysts, model.zones, candidate, gate);
            if (!metrics.poolCompliant) continue;
            const score = metrics.productivity * 0.25 + metrics.quality * 0.28
              + metrics.collaboration * 0.1 + metrics.development * 0.1
              + metrics.inclusion * 0.27 + metrics.sustainability * 0.15
              - metrics.equityGap * 0.32;
            if (score > bestScore) { bestScore = score; best = candidate; }
          }
        }
      }
    }
    setWeights(best); setOptimized(true); setApplied('Balance integral');
  };
  const dimensionData = [
    ['Productividad', 'productivity'], ['Calidad', 'quality'], ['Colaboración', 'collaboration'],
    ['Desarrollo', 'development'], ['Inclusión', 'inclusion'],
  ].map(([dimension, key]) => ({
    dimension,
    a: comparison[0].metrics[key as keyof typeof comparison[0]['metrics']] as number,
    b: comparison[1].metrics[key as keyof typeof comparison[1]['metrics']] as number,
    c: comparison[2].metrics[key as keyof typeof comparison[2]['metrics']] as number,
  }));
  return <div className="page-stack"><div className="compare-intro"><div className="optimizer-icon"><Calculator size={19} /></div><div><b>Explora antes de aplicar</b><p>El optimizador es una búsqueda local de pesos bajo límites y equidad definidos para el prototipo.</p></div><button className="btn btn-primary" onClick={optimize} data-testid="button-optimize"><Sparkles size={15} /> Buscar equilibrio</button></div>
    <div className="scenario-grid">{comparison.map((s, i) => <Card key={s.name} className={`scenario-card ${applied === s.name ? 'scenario-active' : ''}`}><div className="scenario-top"><span className="scenario-tag" style={{ color: s.color }}>{s.tag}</span>{applied === s.name && <span className="applied-indicator"><Check size={12} /> activo</span>}</div><h3>{s.name}</h3><p>{s.detail}</p><div className="scenario-weight-list">{weightNames.map((w, idx) => <div key={w}><span>{w}</span><b>{s.weights[idx]}%</b></div>)}</div><div className="scenario-metrics"><div><span>Productividad</span><b>{s.metrics.productivity.toFixed(0)}</b></div><div><span>PAR30</span><b>{s.metrics.averagePar30.toFixed(1)}%</b></div><div><span>Equidad</span><b>{Math.max(0, 100 - s.metrics.equityGap).toFixed(0)}</b></div></div><div className="scenario-extra"><div><span>Costo estimado</span><b>{money(s.metrics.cost)}</b></div><div><span>Clientes en zonas ciegas</span><b>{fmt(Math.round(s.metrics.inclusionCustomers * s.weights[4] / 100))}</b></div><div><span>Tope del pool</span><b className={s.metrics.poolCompliant ? 'good-status' : 'bad-status'}>{s.metrics.poolCompliant ? 'Cumple' : 'Supera'}</b></div></div><button className={`btn ${applied === s.name ? 'btn-subtle' : 'btn-outline'} btn-block`} onClick={() => { setWeights([...s.weights]); setApplied(s.name); setOptimized(false); }} data-testid={`button-apply-${i}`}>{applied === s.name ? 'Escenario aplicado' : 'Aplicar al constructor'} {applied !== s.name && <ArrowRight size={14} />}</button></Card>)}</div>
    <Card><CardTitle kicker="LECTURA RELATIVA" title="Cinco dimensiones y sostenibilidad" note="Señales normalizadas a 0–100 a partir de observaciones sintéticas; no son resultados reales." /><div className="compare-chart"><ResponsiveContainer width="100%" height="100%"><RadarChart data={dimensionData} outerRadius="72%"><PolarGrid stroke="#e6e9ea" /><PolarAngleAxis dataKey="dimension" tick={{ fontSize: 10, fill: '#737a82' }} /><PolarRadiusAxis angle={30} domain={[0, 100]} tick={{ fontSize: 8, fill: '#9299a0' }} /><Radar name="Volumen foco" dataKey="a" stroke={red} fill={red} fillOpacity={.12} /><Radar name="Balance integral" dataKey="b" stroke="#358875" fill="#358875" fillOpacity={.16} /><Radar name="Inclusión reforzada" dataKey="c" stroke="#6681a4" fill="#6681a4" fillOpacity={.12} /><Legend wrapperStyle={{ fontSize: 10 }} /></RadarChart></ResponsiveContainer></div><div className="sustainability-row">{comparison.map(s => <div key={s.name}><span>{s.name} · sostenibilidad</span><b>{s.metrics.sustainability.toFixed(0)}<small>/100</small></b></div>)}</div></Card>
    {optimized && <div className="success-note" data-testid="status-optimized"><Check size={16} /> Búsqueda local completada: se aplicó un balance que respeta el pool y procura mantener equidad provincial.</div>}
    <p className="disclaimer-line"><ShieldCheck size={14} /> Las cifras comparan reglas simuladas; no asignan incentivos ni recomiendan cambios automáticos de remuneración.</p>
  </div>;
}
function BridgePage({ model, gate }: SharedProps) {
  const [share, setShare] = useState(20);
  const [analystId, setAnalystId] = useState(model.analysts[0]?.id ?? '');
  const weights = [50 - share, 25, 15, 10, share];
  const selectedAnalyst = model.analysts.find(a => a.id === analystId) ?? model.analysts[0];
  const origin = model.zones.find(z => z.name === selectedAnalyst?.base);
  const analystBonus = selectedAnalyst
    ? estimateIncentive(selectedAnalyst, origin, weights, gate).bonus
    : 0;
  const recommendedZones = model.zones
    .filter(z => z.province === selectedAnalyst?.province && z.priority >= 60)
    .sort((a, b) => b.priority - a.priority)
    .slice(0, 3);
  const totalBlindCustomers = model.analysts.reduce((sum, a) => sum + (a.blindClients[11] ?? 0), 0);
  const impactRows = [0, 10, 20, 30].map(inclusionShare => {
    const scenarioWeights = [50 - inclusionShare, 25, 15, 10, inclusionShare];
    const metrics = summarizeIncentives(model.analysts, model.zones, scenarioWeights, gate);
    const qualityReady = model.analysts.filter(a => a.par30[11] < gate.hard && a.blindClients[11] > 0).length;
    const reachFactor = inclusionShare / 30 * 0.75;
    return {
      share: inclusionShare,
      analysts: Math.round(qualityReady * reachFactor),
      customers: Math.round(totalBlindCustomers * reachFactor),
      par30: Math.max(0, metrics.averagePar30 - inclusionShare * 0.0125),
      cost: metrics.cost,
      sustainability: metrics.sustainability,
    };
  });
  const selectedImpact = impactRows.find(row => row.share === share) ?? impactRows[2];
  const cycleImpact = Math.round(selectedImpact.sustainability);
  return <div className="page-stack">
    <div className="bridge-hero"><div><p className="eyebrow">SENSIBILIDAD DE INCLUSIÓN</p><h2>Un bono que conecta el ciclo.</h2><p>Explora cuántos analistas y clientes podrían orientarse a zonas ciegas sin dejar de mirar calidad y costo.</p></div><div className="bridge-dial"><span>Inclusión</span><b>{share}<small>%</small></b><span>del esquema</span></div></div>
    <Card className="bridge-control"><div className="bridge-control-head"><div><b>Peso de inclusión territorial</b><span>La ponderación de productividad se ajusta para mantener el total en 100%.</span></div><div className="bridge-options">{[0, 10, 20, 30].map(n => <button key={n} className={share === n ? 'selected' : ''} onClick={() => setShare(n)} data-testid={`button-inclusion-${n}`}>{n}%</button>)}</div></div><input className="bridge-range" type="range" min="0" max="30" step="10" value={share} onChange={e => setShare(Number(e.target.value))} data-testid="range-inclusion" /><div className="bridge-axis"><span>0% · neutro</span><span>30% · reforzado</span></div></Card>
    <div className="kpi-grid compact">
      <KPI label="Analistas orientados" value={fmt(selectedImpact.analysts)} detail="con señal de zona ciega y calidad" icon={Users} />
      <KPI label="Clientes estimados" value={fmt(selectedImpact.customers)} detail="captación sintética en zonas ciegas" icon={Target} color="teal" />
      <KPI label="PAR30 del escenario" value={`${selectedImpact.par30.toFixed(1)}%`} detail="supuesto de conducta, no pronóstico" icon={ShieldCheck} color="gold" />
      <KPI label="Costo de incentivo" value={money(selectedImpact.cost)} detail={`pool ${money(gate.pool)}`} icon={Calculator} color="blue" />
    </div>
    <div className="content-grid bridge-grid">
      <Card><CardTitle kicker="PERSPECTIVA DEL CICLO" title="Inclusión, costo y sostenibilidad" note="Estimaciones de conducta basadas en supuestos editables; la calidad mantiene compuertas." />
        <div className="bridge-score"><b>{cycleImpact}</b><span>/100 sostenibilidad</span></div>
        <div className="bridge-mini-chart"><ResponsiveContainer width="100%" height="100%"><AreaChart data={impactRows}><CartesianGrid vertical={false} stroke="#e9eaec" strokeDasharray="3 3" /><XAxis dataKey="share" tickFormatter={value => `${value}%`} tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: '#858b93' }} /><YAxis domain={[0, 100]} hide /><Area dataKey="customers" name="Clientes estimados" stroke="#358875" fill="#d9ebe4" strokeWidth={2.5} /><ChartTooltip content={<ChartTip />} /></AreaChart></ResponsiveContainer></div>
        <div className="bridge-metric-list"><div><span>Productividad</span><b>{weights[0]}%</b></div><div><span>Calidad de cartera</span><b>{weights[1]}%</b></div><div><span>Inclusión territorial</span><b>{weights[4]}%</b></div></div>
        <div className="impact-comparison">{impactRows.map(row => <div className={row.share === share ? 'selected' : ''} key={row.share}><b>{row.share}% inclusión</b><span>{fmt(row.analysts)} analistas · {fmt(row.customers)} clientes</span><span>PAR30 {row.par30.toFixed(1)}% · {money(row.cost)}</span></div>)}</div>
      </Card>
      <Card><CardTitle kicker="VISTA DEL ANALISTA" title="Ruta, bono y desarrollo" note="Proyección individual sintética; no representa pago real." />
        <label className="analyst-picker">Analista <select value={selectedAnalyst?.id ?? ''} onChange={e => setAnalystId(e.target.value)} data-testid="select-bridge-analyst">{model.analysts.slice(0, 40).map(a => <option value={a.id} key={a.id}>{a.name} · {a.province}</option>)}</select></label>
        {selectedAnalyst && <div className="analyst-bridge-detail">
          <div className="analyst-bonus"><span>Proyección de bono</span><b>{money(analystBonus)}</b><small>tras aplicar compuerta y tope; solo simulación</small></div>
          <div className="analyst-detail-block"><b>Zonas ciegas prioritarias</b>{recommendedZones.length ? recommendedZones.map(zone => <div key={zone.id}><span>{zone.name}</span><b>{zone.priority}/100</b></div>) : <p>No hay zonas sobre el umbral para esta provincia.</p>}</div>
          <div className="analyst-detail-block"><b>Ruta sugerida del día</b><p>{recommendedZones.slice(0, 2).map(zone => zone.name).join(' → ') || 'Revisar el radar territorial'}</p></div>
          <div className="analyst-detail-block"><b>Plan de desarrollo</b><p>{selectedAnalyst.training < 60 ? 'Proponer capacitación aplicada en análisis de cartera y acompañamiento de mentoría.' : 'Continuar con mentoría entre pares y compartir prácticas de visita territorial.'}</p><small>{selectedAnalyst.training} horas de capacitación simuladas</small></div>
        </div>}
      </Card>
    </div>
    <div className="cycle-flow" aria-label="Ciclo de aprendizaje"><span>Radar</span><ArrowRight size={14} /><span>Ruta</span><ArrowRight size={14} /><span>Visita</span><ArrowRight size={14} /><span>Reconocimiento</span><ArrowRight size={14} /><span>Datos</span><ArrowRight size={14} /><span>Radar</span></div>
    <div className="notice-card notice-warm"><div className="notice-symbol"><CircleHelp size={18} /></div><div><b>Una señal territorial no describe a cada analista por igual.</b><p>La proyección del bono está sujeta a calidad y límites simulados. Evalúa el contexto y somete decisiones al comité; no se aplica remuneración.</p></div></div>
  </div>;
}
type ChatMsg = { role: 'user' | 'assistant'; text: string; source?: 'ia' | 'plantilla' };
function AssistantPage({ model, selectedZone }: SharedProps) {
  const respond = useAssistantRespond();
  const [mode, setMode] = useState<'zona' | 'analista' | 'comite'>('zona');
  const [message, setMessage] = useState('');
  const [history, setHistory] = useState<ChatMsg[]>(() => readStore('brujula-chat-history', []));
  const [contextId, setContextId] = useState(selectedZone.id);
  useEffect(() => { localStorage.setItem('brujula-chat-history', JSON.stringify(history)); }, [history]);
  const context = useMemo(() => {
    if (mode === 'zona') { const z = model.zones.find(x => x.id === contextId) ?? selectedZone; return `Zona sintética: ${z.name}, ${z.province}; segmento ${z.segment}; prioridad potencial ${z.priority}/100; demanda ${z.demand}; cobertura ${z.coverage}; brecha ${z.gap}. No es capacidad de pago ni elegibilidad.`; }
    if (mode === 'analista') { const a = model.analysts.find(x => x.id === contextId) ?? model.analysts[0]; return `Analista sintético ${a.id}; provincia ${a.province}; antigüedad ${a.tenure} meses; madurez ${a.maturity}; capacitación ${a.training}; PAR30 último mes ${a.par30[11].toFixed(1)}%; nuevos clientes ${a.newClients[11]}; clientes en zonas ciegas ${a.blindClients[11]}. Sin dato personal.`; }
    return `Comité: ${model.zones.length} zonas sintéticas, ${model.analysts.length} analistas sintéticos. Esquema ilustrativo y agregados locales. Pool no aplicado.`;
  }, [mode, contextId, model, selectedZone]);
  const send = () => {
    const trimmed = message.trim();
    if (!trimmed || respond.isPending || trimmed.length > 2000) return;
    setHistory(h => [...h, { role: 'user', text: trimmed }]); setMessage('');
    respond.mutate({ data: { mode, message: trimmed, context } }, {
      onSuccess: response => setHistory(h => [...h, { role: 'assistant', text: response.answer, source: response.source }]),
      onError: () => setHistory(h => [...h, { role: 'assistant', text: 'No se pudo obtener respuesta en este momento. Revisa la conexión e inténtalo nuevamente.' }]),
    });
  };
  const clear = () => setHistory([]);
  const selectors = mode === 'zona' ? model.zones.map(z => ({ id: z.id, label: `${z.name} · ${z.province}` })) : mode === 'analista' ? model.analysts.map(a => ({ id: a.id, label: `${a.name} · ${a.province}` })) : [];
  return <div className="assistant-layout"><Card className="chat-panel"><div className="chat-head"><div className="assistant-avatar"><Sparkles size={18} /></div><div><b>Brújula · consulta de escenarios</b><span>Asistente de apoyo, no decisor</span></div><button className="btn btn-ghost clear-chat" onClick={clear} data-testid="button-clear-chat"><RefreshCw size={14} /> Limpiar</button></div>
    <div className="chat-modes">{(['zona', 'analista', 'comite'] as const).map(m => <button key={m} className={mode === m ? 'selected' : ''} onClick={() => setMode(m)} data-testid={`button-mode-${m}`}>{m === 'zona' ? 'Zona' : m === 'analista' ? 'Analista' : 'Comité'}</button>)}</div>
    {selectors.length > 0 && <div className="chat-context-select"><label>{mode === 'zona' ? 'Zona de referencia' : 'Analista sintético'}</label><select value={contextId} onChange={e => setContextId(e.target.value)} data-testid="select-assistant-context">{selectors.map(s => <option value={s.id} key={s.id}>{s.label}</option>)}</select></div>}
    <div className="chat-transcript" data-testid="chat-transcript">{history.length === 0 && <div className="chat-welcome"><div className="welcome-orbit"><Compass size={23} /></div><b>Consulta el escenario.</b><p>Preguntas sobre indicadores y supuestos agregados. No ingreses datos personales ni información identificable.</p><div className="prompt-suggestions">{['¿Qué explica la prioridad de esta zona?', '¿Qué límites tiene este escenario?', '¿Qué señales no están reflejadas?'].map((q, i) => <button key={q} onClick={() => setMessage(q)} data-testid={`button-prompt-${i}`}>{q}<ArrowRight size={13} /></button>)}</div></div>}
      {history.map((msg, i) => <div className={`chat-message ${msg.role}`} key={i}><div className="message-avatar">{msg.role === 'assistant' ? <Compass size={14} /> : 'Tú'}</div><div className="message-body">{msg.role === 'assistant' && msg.source && <span className={`response-source ${msg.source}`}>{msg.source === 'plantilla' ? 'RESPUESTA DE APOYO POR PLANTILLA' : 'RESPUESTA DEL ASISTENTE'}</span>}<p>{msg.text}</p></div></div>)}
      {respond.isPending && <div className="chat-message assistant"><div className="message-avatar"><Compass size={14} /></div><div className="typing-bubble"><i /><i /><i /></div></div>}
    </div>
    {respond.isError && <div className="chat-error" data-testid="status-chat-error">La consulta no llegó al servidor. Vuelve a intentarlo.</div>}
    <div className="chat-compose"><textarea value={message} onChange={e => setMessage(e.target.value.slice(0, 2000))} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} placeholder="Pregunta sobre señales o supuestos agregados…" maxLength={2000} data-testid="input-assistant-message" /><div className="compose-bottom"><span>{message.length}/2000 · No incluir datos personales</span><button className="btn btn-primary" onClick={send} disabled={!message.trim() || respond.isPending} data-testid="button-send-message">{respond.isPending ? 'Consultando…' : 'Enviar'} <Send size={14} /></button></div></div>
  </Card><aside className="assistant-aside"><Card><CardTitle kicker="MODO DE CONSULTA" title={mode === 'zona' ? 'Explora una zona' : mode === 'analista' ? 'Lee señales agregadas' : 'Prepara conversación'} /><p className="assistant-context-copy">{mode === 'zona' ? 'Describe factores de demanda, cobertura y brecha sin inferir capacidad de pago.' : mode === 'analista' ? 'Interpreta datos sintéticos agregados y métricas del escenario, nunca personas.' : 'Resume el ciclo y sus limitaciones para una discusión informada.'}</p><div className="context-preview"><span>CONTEXTO ENVIADO</span><p>{context}</p></div></Card><div className="assistant-guard"><ShieldCheck size={18} /><div><b>Respetuoso y no prescriptivo</b><p>El asistente no solicita ni muestra datos personales y no recomienda cambios automáticos de remuneración.</p></div></div></aside></div>;
}
function LimitsPage() {
  const limits = [
    ['Datos sintéticos', '60 zonas ficticias y 120 analistas generados localmente con semilla configurable. Sin conexión a sistemas reales.'],
    ['Potencial estimado', 'Demanda usa PEA, negocios, actividad y señal digital; la brecha integra cobertura y acceso. No es capacidad de pago, solvencia ni elegibilidad crediticia.'],
    ['Regresión contextual', 'Relación lineal ilustrativa con ruido controlado. No constituye inferencia causal ni modelo predictivo validado.'],
    ['Incentivos', 'Pesos, compuertas, tope y pool son herramientas para sensibilizar. No asignan ni cambian compensación real.'],
    ['Privacidad', 'No se incluyen datos personales. El chat conserva historial solo en localStorage de este navegador.'],
  ];
  return <div className="page-stack"><div className="limits-banner"><div className="limits-icon"><ShieldCheck size={22} /></div><div><p className="eyebrow">TRANSPARENCIA DEL PROTOTIPO</p><h2>Una brújula para conversar, no para decidir.</h2><p>Los resultados se calculan localmente y sirven exclusivamente para explorar reglas y supuestos.</p></div></div>
    <div className="content-grid"><Card><CardTitle kicker="ALCANCES Y SALVAGUARDAS" title="Qué representa — y qué no" note="Léelo antes de interpretar cualquier cifra." /><div className="limit-list">{limits.map(([title, detail], i) => <div className="limit-row" key={title}><span className="limit-number">0{i + 1}</span><div><b>{title}</b><p>{detail}</p></div></div>)}</div></Card><div className="page-stack"><Card><CardTitle kicker="FUENTES" title="Referencia conceptual" /><div className="source-item"><div className="source-icon"><Map size={16} /></div><div><b>Cartografía base</b><p>OpenStreetMap · teselas públicas para contexto visual. Puntos de zona ficticios, no límites oficiales.</p></div></div><div className="source-item"><div className="source-icon"><FileText size={16} /></div><div><b>Datos del escenario</b><p>Generador determinista local de este prototipo. No representa a Caja Trujillo ni a clientes reales.</p></div></div><div className="source-item"><div className="source-icon"><Calculator size={16} /></div><div><b>Fórmulas</b><p>Heurísticas transparentes, ajustables y no validadas para decisión operativa.</p></div></div></Card><Card className="limit-callout"><ShieldCheck size={20} /><b>Usar con criterio</b><p>Una métrica compuesta puede ocultar realidades distintas. Contrasta supuestos y considera el contexto de cada provincia.</p></Card></div></div>
  </div>;
}

export default App;
